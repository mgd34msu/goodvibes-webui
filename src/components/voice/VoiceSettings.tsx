/**
 * VoiceSettings — the shared spoken-voice config surface.
 *
 * There is ONE voice config across terminal, desktop, and agent: the tts.provider /
 * tts.voice keys now resolve from the surface-root-independent shared tier
 * (~/.goodvibes/shared/settings.json — ConfigManager's shared-config-tier.ts), so every
 * surface reads and writes the same voice regardless of its own surface root. This
 * popover READS those keys (config.get) and WRITES them (config.set) through the daemon,
 * whose ConfigManager persists to that same shared file — so choosing a voice here
 * changes it on the TUI, desktop, and agent too, never a web-only voice. Availability and
 * the provider list come straight from voice.status, rendered with the shared
 * presentation-contract tone/glyph so the state reads the same as it does on every other
 * surface.
 *
 * Local voice setup (SDK 1.9.0-dev's memory-relay-voice-hardening work): the 'local'
 * provider only appears in the dropdown above once it has at least one configured
 * capability (provider-registry.ts's `status()` reports `capabilities: []` for a fully
 * unprovisioned install) — so on a fresh daemon it is invisible there, with nothing
 * pointing at how to get it. This section is driven independently by
 * voice.local.status (the managed-runtime provisioning state, distinct from
 * voice.status's provider-availability posture) and offers the one-act
 * voice.local.install setup whenever the resting state isn't 'provisioned'. See
 * lib/voice/voice-local-setup.ts's header comment for the exact wire states rendered
 * (and this round's adoption note: no streamed per-step progress exists on the wire —
 * install is a single request/response call).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Settings2, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeMethod, sdk } from '../../lib/goodvibes';
import { formatError, isMethodNotInvokableError, isMethodUnavailableError } from '../../lib/errors';
import { asRecord, formatBytes } from '../../lib/object';
import { classifyBadgeTone, contractGlyphForBadgeTone } from '../../lib/presentation-bridge';
import { useSharedVoiceConfig, useVoiceStatus } from '../../lib/voice/useVoice';
import { TTS_UNAVAILABLE_MESSAGE, describeSharedVoice } from '../../lib/voice/voice-config';
import {
  voiceLocalInstallIsRetriable,
  voiceLocalInstallStateLabel,
  voiceLocalNeedsSetup,
  voiceLocalPhaseLabel,
  voiceLocalStateLabel,
} from '../../lib/voice/voice-local-setup';
import { useVoiceLocalInstall, useVoiceLocalStatus } from '../../hooks/useVoiceLocalSetup';

interface VoiceOption {
  id: string;
  label: string;
}

function readVoices(data: unknown): VoiceOption[] {
  const list = asRecord(data).voices;
  if (!Array.isArray(list)) return [];
  return list.map((entry) => {
    const v = asRecord(entry);
    const id = typeof v.id === 'string' ? v.id : '';
    const label = typeof v.label === 'string' ? v.label : id;
    return { id, label };
  }).filter((v) => v.id);
}

export function VoiceSettings() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { availability } = useVoiceStatus();
  const { config } = useSharedVoiceConfig();

  const ttsProviders = useMemo(
    () => availability.providers.filter((p) => p.capabilities.includes('tts') || p.capabilities.includes('tts-stream')),
    [availability.providers],
  );
  // Empty string means "unset" here, so fall through to the derived default (?? only
  // catches null/undefined, which is why an explicit non-empty check leads).
  const selectedProvider = config.provider !== ''
    ? config.provider
    : (availability.defaultTtsProviderId ?? ttsProviders[0]?.id ?? '');

  const voicesQuery = useQuery({
    queryKey: ['voice', 'voices', selectedProvider],
    queryFn: () => sdk.operator.voice.voices(selectedProvider || undefined),
    enabled: open && availability.ttsAvailable,
    staleTime: 60_000,
  });
  const voices = useMemo(() => readVoices(voicesQuery.data), [voicesQuery.data]);

  const setKey = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => invokeMethod('config.set', { key, value }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['voice', 'config'] });
    },
  });

  const localInstall = useVoiceLocalInstall();
  // While the install mutation is in flight the status query polls: the daemon serves
  // an OPTIONAL installInProgress section during an active install (SDK 5357f09e) and
  // this is the window it exists in. Absent (an older daemon, or the first poll not
  // landed yet) the card keeps its plain busy state.
  const localStatus = useVoiceLocalStatus(open, localInstall.isPending);
  const localUnavailable = localStatus.isError
    && (isMethodUnavailableError(localStatus.error) || isMethodNotInvokableError(localStatus.error));

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const tone = classifyBadgeTone(availability.ttsAvailable ? 'ready' : 'unconfigured');
  const glyph = contractGlyphForBadgeTone(tone);

  return (
    <div className="voice-settings" ref={containerRef}>
      <button
        type="button"
        className="composer-tool voice-settings-btn"
        title="Voice settings"
        aria-label="Voice settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Settings2 size={16} aria-hidden />
      </button>

      {open && (
        <div className="voice-settings-popover" role="dialog" aria-label="Voice settings">
          <div className="voice-settings-header">
            <span className={`voice-settings-tone tone-${tone}`} aria-hidden>{glyph}</span>
            <span className="voice-settings-title">Spoken voice</span>
            {/* On a phone this popover becomes a full-screen sheet (voice.css, matching
                the shared Modal's <=480px convention) with no "tap outside" area to close
                it, so an explicit close button is required, not optional chrome. */}
            <button
              type="button"
              className="voice-settings-close"
              aria-label="Close voice settings"
              onClick={() => setOpen(false)}
            >
              <X size={16} aria-hidden />
            </button>
          </div>

          {availability.ttsAvailable ? (
            <>
              <p className="voice-settings-shared">
                Current voice: <strong>{describeSharedVoice(config)}</strong>
              </p>
              <label className="voice-settings-field">
                <span>Provider</span>
                <select
                  value={selectedProvider}
                  disabled={setKey.isPending}
                  onChange={(event) => setKey.mutate({ key: 'tts.provider', value: event.target.value })}
                >
                  {ttsProviders.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </label>
              <label className="voice-settings-field">
                <span>Voice</span>
                <select
                  value={config.voice}
                  disabled={setKey.isPending || voicesQuery.isLoading || !voices.length}
                  onChange={(event) => setKey.mutate({ key: 'tts.voice', value: event.target.value })}
                >
                  <option value="">Provider default</option>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
              </label>
              {voicesQuery.isLoading && <p className="voice-settings-hint">Loading voices…</p>}
              <p className="voice-settings-hint">One voice across terminal, desktop, and agent.</p>
            </>
          ) : (
            <p className="voice-settings-unavailable">{TTS_UNAVAILABLE_MESSAGE}</p>
          )}

          {/* Local voice setup — independent of the provider dropdown above, since a
              fully-unprovisioned 'local' provider has no capabilities yet and so is
              invisible there (see this component's header comment). Skipped entirely
              (not even a "not available" line) only for a daemon build old enough that
              voice.local.status itself 404s/501s — genuinely nothing to offer there,
              same honest-omission call ConsolidationReceipts documents for a verb the
              connected build has never heard of. */}
          {!localUnavailable && (
            <div className="voice-settings-local" data-testid="voice-settings-local">
              <p className="voice-settings-title">Local voice (free, offline)</p>

              {localStatus.isPending && (
                <p className="voice-settings-hint">Checking local voice…</p>
              )}

              {localStatus.isError && (
                <p className="voice-settings-hint" role="alert">
                  Local voice status unavailable — {formatError(localStatus.error)}
                </p>
              )}

              {localStatus.isSuccess && (() => {
                const status = localStatus.data;
                const needsSetup = voiceLocalNeedsSetup(status);
                const result = localInstall.isSuccess ? localInstall.data : null;
                const retriable = result !== null
                  && (voiceLocalInstallIsRetriable(result.tts.state) || voiceLocalInstallIsRetriable(result.stt.state));

                return (
                  <>
                    {/* The resting line — a successful install's status refetch flips this
                        to "Installed" live while the receipt below stays visible. */}
                    {!needsSetup && (
                      <p className="voice-settings-hint">
                        {status.state === 'provisioned'
                          ? `Installed — TTS: ${status.tts.engine}${status.stt.supported ? `, STT: ${status.stt.engine}` : ''}.`
                          : `${voiceLocalStateLabel(status.state)} — no pinned engine build exists for this host.`}
                      </p>
                    )}

                    {/* The one-act setup action. Hidden while a retriable failure's own
                        Retry (below) is the offered action — one button, not two twins. */}
                    {needsSetup && !retriable && (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={localInstall.isPending}
                        onClick={() => localInstall.mutate()}
                      >
                        {localInstall.isPending
                          ? 'Installing…'
                          : `Set up local voice${typeof status.offerBytes === 'number' ? ` (~${formatBytes(status.offerBytes)})` : ''}`}
                      </button>
                    )}

                    {/* Live per-component progress of the ACTIVE install run, from
                        voice.local.status's installInProgress section (polled while
                        the mutation is in flight). Absent — an older daemon, or the
                        first poll not landed yet — the 'Installing…' busy label above
                        stays the whole story. Bytes render only where the wire
                        genuinely carries them (completion boundaries; downloads
                        verify whole-file), never a fabricated live percentage. */}
                    {localInstall.isPending && status.installInProgress && status.installInProgress.components.length > 0 && (
                      <ul className="voice-settings-local-progress" data-testid="voice-local-progress" role="status">
                        {status.installInProgress.components.map((component) => (
                          <li key={component.component} data-phase={component.phase}>
                            <span className="voice-settings-local-progress__name">{component.component}</span>
                            <span className="voice-settings-local-progress__phase">
                              {voiceLocalPhaseLabel(component.phase)}
                              {typeof component.bytesDone === 'number' && typeof component.bytesTotal === 'number'
                                ? ` — ${formatBytes(component.bytesDone)} of ${formatBytes(component.bytesTotal)}`
                                : typeof component.bytesTotal === 'number'
                                  ? ` — ${formatBytes(component.bytesTotal)}`
                                  : ''}
                            </span>
                            {component.phase === 'error' && component.message && (
                              <span className="voice-settings-local-progress__error">{component.message}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {localInstall.isError && (
                      <p className="voice-settings-hint" role="alert">{formatError(localInstall.error)}</p>
                    )}

                    {/* The install receipt — rendered OUTSIDE the needs-setup gate so a
                        successful attempt's receipt survives the resting-state flip to
                        Installed (the whole point of a receipt). */}
                    {result !== null && (
                      <div className="voice-settings-local-receipt" role="status">
                        <p>
                          TTS ({result.tts.engine}): {voiceLocalInstallStateLabel(result.tts.state)}
                          {result.tts.reason ? ` — ${result.tts.reason}` : ''}
                        </p>
                        <p>
                          STT ({result.stt.engine}): {voiceLocalInstallStateLabel(result.stt.state)}
                          {result.stt.reason ? ` — ${result.stt.reason}` : ''}
                        </p>
                        {result.configured.set.length > 0 && (
                          <p className="voice-settings-hint">
                            Configured: {result.configured.set.map((entry) => entry.key).join(', ')}
                          </p>
                        )}
                        {result.configured.skipped.length > 0 && (
                          <p className="voice-settings-hint">
                            Left as you set them: {result.configured.skipped.map((entry) => entry.key).join(', ')}
                          </p>
                        )}
                        {retriable && needsSetup && (
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={localInstall.isPending}
                            onClick={() => localInstall.mutate()}
                          >
                            {localInstall.isPending ? 'Installing…' : 'Retry'}
                          </button>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
