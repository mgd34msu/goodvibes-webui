/**
 * MicButton — the microphone capability label.
 *
 * When the mic is unavailable because the page is on an insecure origin
 * (support === 'insecure-context'), the note renders the DAEMON's own reason text from
 * pairing.posture.get ("needs https — available via tailscale") once it has loaded,
 * honestly falling back to a still-true generic HTTPS pointer before it answers — never
 * a blank label, never a dead button, never a client-fabricated guess.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

type MicSupport = 'ok' | 'insecure-context' | 'unsupported';
let supportValue: MicSupport = 'insecure-context';

mock.module('../../lib/voice/useVoice', () => ({
  useVoiceInput: () => ({
    support: supportValue,
    availability: { sttAvailable: true },
    phase: 'idle',
    error: null,
    start: () => Promise.resolve(),
    stopAndTranscribe: () => Promise.resolve(),
  }),
}));

let postureCapabilities: readonly { capability: string; available: boolean; reason?: string }[] = [
  { capability: 'microphone', available: false, reason: 'needs https — available via tailscale' },
];
let posturePending = false;

mock.module('../../hooks/useOriginPosture', () => ({
  useOriginPosture: () => ({
    posture: posturePending ? undefined : { origin: 'http://192.168.0.131:3423', scheme: 'http', privateNetwork: true, secureContext: false, capabilities: postureCapabilities },
    isLoading: posturePending,
  }),
  capabilityReason: (
    posture: { capabilities: readonly { capability: string; available: boolean; reason?: string }[] } | undefined,
    capability: string,
  ) => {
    const entry = posture?.capabilities.find((c) => c.capability === capability);
    return !entry || entry.available ? undefined : entry.reason;
  },
}));

const { MicButton } = await import('./MicButton');

function render(): { el: HTMLElement; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(MicButton, { onTranscript: () => {} }));
  });
  return { el: container, unmount: () => { flushSync(() => root.unmount()); container.remove(); } };
}

afterEach(() => {
  supportValue = 'insecure-context';
  postureCapabilities = [{ capability: 'microphone', available: false, reason: 'needs https — available via tailscale' }];
  posturePending = false;
});

describe('MicButton capability label', () => {
  test('insecure-context: renders the daemon posture reason once loaded', () => {
    const { el, unmount } = render();
    expect(el.textContent).toContain('needs https — available via tailscale');
    expect(el.querySelector('button')?.hasAttribute('disabled')).toBe(true);
    unmount();
  });

  test('insecure-context: falls back to the honest generic HTTPS pointer while posture is loading', () => {
    posturePending = true;
    const { el, unmount } = render();
    expect(el.textContent).toContain('secure (HTTPS) connection');
    expect(el.textContent).not.toContain('needs https — available via tailscale');
    unmount();
  });

  test('unsupported: shows the honest unsupported note, never the HTTPS pointer', () => {
    supportValue = 'unsupported';
    const { el, unmount } = render();
    expect(el.textContent).toContain('cannot capture the microphone');
    expect(el.textContent).not.toContain('HTTPS');
    unmount();
  });

  test('ok: renders the real dictate button with no note', () => {
    supportValue = 'ok';
    const { el, unmount } = render();
    expect(el.querySelector('button')?.hasAttribute('disabled')).toBe(false);
    expect(el.querySelector('.voice-mic-note')).toBeNull();
    unmount();
  });
});
