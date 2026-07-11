/**
 * StepUpSettings — the operator-facing passkey management surface for relay step-up.
 *
 * Two ceremonies, wired honestly:
 *   - Register a passkey: navigator.credentials.create (the daemon accepts 'none' attestation),
 *     then persist the resulting COSE public key via the stepup.credentials.register verb so the
 *     daemon can verify later assertions. The credential id is remembered on this device so the
 *     assert ceremony can hint the right passkey.
 *   - Verify now: mint a server challenge and run navigator.credentials.get against it, proving
 *     the passkey produces a valid assertion on this device. (Full server-side verification runs
 *     on every real mutating relay call — this button confirms the local ceremony works.)
 *
 * Every failure — unsupported browser, no authenticator, user cancel, register/verify error — is
 * rendered plainly with a specific message; nothing is faked or silently swallowed.
 */
import { useState } from 'react';
import { KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { useToast } from '../../lib/toast';
import { sdk } from '../../lib/goodvibes';
import {
  clearRegisteredCredential,
  describeStepUpError,
  getRegisteredCredential,
  registerPasskey,
  runAssertion,
  setRegisteredCredential,
  stepUpAvailability,
  type RegisteredCredentialRecord,
} from '../../lib/stepup';

export function StepUpSettings() {
  const { toast } = useToast();
  const availability = stepUpAvailability();
  const [registered, setRegistered] = useState<RegisteredCredentialRecord | null>(() => getRegisteredCredential());
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<'register' | 'verify' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRegister = async () => {
    setBusy('register');
    setError(null);
    try {
      const ceremony = await registerPasskey({
        userName: typeof window === 'undefined' ? 'operator' : window.location.host,
        userDisplayName: 'GoodVibes operator',
        label: label.trim() || undefined,
      });
      const result = await sdk.operator.stepup.registerCredential({
        rpId: ceremony.rpId,
        origin: ceremony.origin,
        credentialId: ceremony.credentialId,
        publicKeyCose: ceremony.publicKeyCose,
        signCount: ceremony.signCount,
        userVerification: 'required',
        label: label.trim() || undefined,
      });
      const record: RegisteredCredentialRecord = {
        credentialId: result.credential.credentialId,
        label: result.credential.label ?? (label.trim() || undefined),
        registeredAt: Date.now(),
      };
      setRegisteredCredential(record); // persist to this device
      setRegistered(record);
      setLabel('');
      toast({ title: 'Passkey registered', description: 'This device can now confirm relay actions.', tone: 'success' });
    } catch (registerError) {
      setError(describeStepUpError(registerError));
    } finally {
      setBusy(null);
    }
  };

  const handleVerify = async () => {
    setBusy('verify');
    setError(null);
    try {
      const challenge = await sdk.operator.stepup.mintChallenge({});
      await runAssertion({ challenge: challenge.challenge, credentialId: registered?.credentialId });
      toast({
        title: 'Passkey verified',
        description: 'Your passkey produced a valid assertion. The daemon verifies it on every real relay action.',
        tone: 'success',
      });
    } catch (verifyError) {
      setError(describeStepUpError(verifyError));
    } finally {
      setBusy(null);
    }
  };

  const handleForget = () => {
    clearRegisteredCredential();
    setRegistered(null);
    toast({ title: 'Passkey forgotten on this device', description: 'The daemon still holds any registered credential.' });
  };

  return (
    <section className="settings-stepup panel">
      <div className="panel-title">
        <h2>Security — step-up verification</h2>
        <ShieldCheck size={16} aria-hidden="true" />
      </div>

      <p className="stepup-note">
        When GoodVibes reaches the daemon over the relay, actions that change state (sending a
        message, responding to a permission ask, controlling a session) require a passkey
        confirmation. Register a passkey on this device to confirm them inline.
      </p>

      {!availability.supported ? (
        <div className="banner warning" role="status">
          {availability.reason ?? 'Passkeys are not supported in this browser.'}
        </div>
      ) : (
        <>
          <div className="stepup-status" role="status">
            {registered ? (
              <span>
                <KeyRound size={14} aria-hidden="true" />{' '}
                A passkey is registered on this device
                {registered.label ? ` (${registered.label})` : ''}.
              </span>
            ) : (
              <span>No passkey is registered on this device yet.</span>
            )}
          </div>

          <div className="form-grid">
            <label>
              Passkey label (optional)
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="e.g. My laptop"
                disabled={busy !== null}
              />
            </label>
          </div>

          <div className="stepup-actions">
            <button type="button" className="primary-button" onClick={() => void handleRegister()} disabled={busy !== null}>
              {busy === 'register' ? 'Waiting for passkey…' : registered ? 'Register a new passkey' : 'Register a passkey'}
            </button>
            <button type="button" className="secondary-button" onClick={() => void handleVerify()} disabled={busy !== null}>
              {busy === 'verify' ? 'Waiting for passkey…' : 'Verify now'}
            </button>
            {registered && (
              <button type="button" className="secondary-button" onClick={handleForget} disabled={busy !== null}>
                <Trash2 size={14} aria-hidden="true" /> Forget on this device
              </button>
            )}
          </div>
        </>
      )}

      {error && (
        <div className="banner warning" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
