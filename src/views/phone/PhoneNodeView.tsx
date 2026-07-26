/**
 * PhoneNodeView — this browser acting as a paired device node.
 *
 * Open it on a phone, pair once, and the phone's cameras, screen, location,
 * clipboard, and device commands become capabilities the agent can ask for.
 * The agent never gets them silently: the host confirms every capture and
 * effect with the person before any work reaches this page, and this page shows
 * an honest log of everything it served.
 *
 * What is announced is what this browser can actually do. A capability whose
 * API is missing, or that a browser gates behind a secure context this origin
 * does not have, is not announced at all — the desktop then says why it is
 * unavailable instead of offering a control that would fail.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { GOODVIBES_BASE_URL } from '../../lib/goodvibes';
import {
  PhoneNodeClient,
  browserPhoneNodeStorage,
  type PhoneNodeState,
} from '../../lib/device-node/phone-node-client';
import { DeviceGrants } from '../../components/settings/DeviceGrants';
import '../../styles/components/device.css';

const CAPABILITY_LABELS: Readonly<Record<string, string>> = {
  'device.camera.rear.capture': 'Rear camera picture',
  'device.camera.front.capture': 'Front camera picture',
  'device.screen.capture': 'Screen picture',
  'device.location.coarse': 'Approximate location',
  'device.location.precise': 'Precise location',
  'device.clipboard.read': 'Read the clipboard',
  'device.clipboard.write': 'Put text on the clipboard',
  'device.command.notify': 'Show a notification',
  'device.command.open_url': 'Open a link',
  'device.command.vibrate': 'Vibrate',
};

function defaultLabel(): string {
  if (typeof navigator === 'undefined') return 'Phone';
  const platform = navigator.platform || '';
  return platform ? `Phone (${platform})` : 'Phone';
}

export function PhoneNodeView() {
  const label = useMemo(defaultLabel, []);
  const clientRef = useRef<PhoneNodeClient | null>(null);
  const [state, setState] = useState<PhoneNodeState | null>(null);

  useEffect(() => {
    const client = new PhoneNodeClient({
      baseUrl: GOODVIBES_BASE_URL,
      label,
      storage: browserPhoneNodeStorage(),
      onState: (next) => setState(next),
    });
    clientRef.current = client;
    setState(client.getState());
    if (client.getState().status === 'connected') client.start();
    return () => {
      client.stop();
      clientRef.current = null;
    };
  }, [label]);

  useEffect(() => {
    if (state?.status === 'connected') clientRef.current?.start();
  }, [state?.status]);

  if (!state) return null;

  const secureContextOk = typeof window !== 'undefined' && window.isSecureContext;

  return (
    <div className="view phone-node-view">
      <section className="panel device-panel">
        <div className="panel-title">
          <h2>This phone as a capability</h2>
          <Smartphone size={18} aria-hidden="true" />
        </div>

        <p className="device-panel__description">{state.message}</p>

        {!secureContextOk ? (
          <p role="note" className="device-panel__notice">
            This page is not on a secure connection, so the browser will not give it the camera,
            the screen, location, or the clipboard. Everything else still works. An https address
            (Tailscale gives you one without minting certificates) unlocks the rest.
          </p>
        ) : null}

        <div className="device-panel__actions">
          {state.status === 'unpaired' || state.status === 'error' ? (
            <button type="button" onClick={() => void clientRef.current?.requestPairing()}>
              Pair this phone
            </button>
          ) : null}
          {state.status === 'awaiting-approval' ? (
            <button type="button" onClick={() => void clientRef.current?.verifyPairing()}>
              Finish pairing
            </button>
          ) : null}
          {state.status === 'connected' ? (
            <button type="button" onClick={() => clientRef.current?.unpair()}>
              Unpair this phone
            </button>
          ) : null}
        </div>

        <h3 className="device-panel__heading">What this phone offers</h3>
        {state.announced.length === 0 ? (
          <p>Nothing yet — this browser offers none of the device capabilities on this connection.</p>
        ) : (
          <ul className="device-list">
            {state.announced.map((id) => (
              <li key={id} className="device-list__row">
                <span>{CAPABILITY_LABELS[id] ?? id}</span>
                <span className="device-list__detail">asks before every use</span>
              </li>
            ))}
          </ul>
        )}

        <h3 className="device-panel__heading">What this phone has served</h3>
        {state.activity.length === 0 ? (
          <p>Nothing yet.</p>
        ) : (
          <ul className="device-list">
            {state.activity.map((entry) => (
              <li key={`${String(entry.at)}-${entry.capabilityId}`} className="device-list__row">
                <span>{CAPABILITY_LABELS[entry.capabilityId] ?? entry.capabilityId}</span>
                <span className="device-list__detail">
                  {entry.ok ? 'served' : 'refused'} · {entry.detail} · {new Date(entry.at).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DeviceGrants />
    </div>
  );
}
