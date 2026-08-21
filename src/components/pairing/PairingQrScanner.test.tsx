/**
 * PairingQrScanner, camera lifecycle and failure states.
 *
 * The camera, the preview and the frame grab all arrive through the injected
 * PairingScannerBindings (the same seam device-node/capability-bindings.ts uses),
 * so these run with no camera and no canvas: happy-dom's 2D context is null and
 * its HTMLMediaElement rejects a srcObject that is not a real MediaStream, which
 * is exactly why those two operations sit behind the bindings rather than being
 * called directly from the component.
 *
 * The assertions that matter here are the ones a person feels: every way this
 * can fail says something actionable, a good scan reaches the join flow with a
 * parsed payload, and the camera is never left running.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { ScannedPairing } from '../../lib/pairing-qr';
import type { PairingScannerBindings } from '../../lib/pairing-qr-camera';
import type { QrDetector } from '../../lib/pairing-qr-detector';
import { PairingQrScanner } from './PairingQrScanner';

const TOKEN = 'op_tok_5f3a9c21b7';
const COMPANION_JSON = JSON.stringify({
  url: 'http://127.0.0.1:3421',
  token: TOKEN,
  username: 'admin',
  version: '2.0.17',
  surface: 'daemon',
});

interface FakeTrack {
  stopped: boolean;
  stop: () => void;
}

function fakeStream(): { stream: MediaStream; tracks: FakeTrack[] } {
  const tracks: FakeTrack[] = [
    { stopped: false, stop() { this.stopped = true; } },
    { stopped: false, stop() { this.stopped = true; } },
  ];
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  return { stream, tracks };
}

/** A one-pixel frame. The stub detector ignores the pixels; only the shape matters. */
function fakeFrame(): ImageData {
  return { data: new Uint8ClampedArray(4), width: 1, height: 1 } as unknown as ImageData;
}

interface Harness {
  readonly bindings: PairingScannerBindings;
  readonly tracks: FakeTrack[];
  readonly getUserMediaCalls: number[];
}

function harness(overrides: {
  isSecureContext?: boolean;
  getUserMedia?: (() => Promise<MediaStream>) | null;
  detector?: QrDetector | null;
  frame?: ImageData | null;
} = {}): Harness {
  const { stream, tracks } = fakeStream();
  const getUserMediaCalls: number[] = [];
  const detector: QrDetector | null =
    overrides.detector === undefined
      ? { backend: 'jsqr', detect: () => Promise.resolve(COMPANION_JSON) }
      : overrides.detector;

  const mediaDevices =
    overrides.getUserMedia === null
      ? undefined
      : ({
          getUserMedia: () => {
            getUserMediaCalls.push(Date.now());
            return overrides.getUserMedia ? overrides.getUserMedia() : Promise.resolve(stream);
          },
        } as unknown as MediaDevices);

  return {
    tracks,
    getUserMediaCalls,
    bindings: {
      isSecureContext: overrides.isSecureContext ?? true,
      mediaDevices,
      createDetector: () => Promise.resolve(detector),
      attachPreview: () => Promise.resolve(),
      grabFrame: () => (overrides.frame === undefined ? fakeFrame() : overrides.frame),
    },
  };
}

const mounted: (() => void)[] = [];

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.();
  document.body.innerHTML = '';
});

interface Rendered {
  readonly el: HTMLElement;
  readonly scans: ScannedPairing[];
  readonly cancelled: { count: number };
  readonly unmount: () => void;
}

/**
 * Let pending promises resolve, then flush whatever state they set. The scanner
 * opens the camera and picks a decoder asynchronously, so nothing is on screen
 * until this has run at least once.
 */
async function settle(ms = 20): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  flushSync(() => {});
}

/** Long enough for the scan loop's own timer to fire at least once. */
async function advance(): Promise<void> {
  await settle(250);
}

async function render(bindings: PairingScannerBindings): Promise<Rendered> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const scans: ScannedPairing[] = [];
  const cancelled = { count: 0 };

  flushSync(() => {
    root.render(
      React.createElement(PairingQrScanner, {
        onScanned: (scanned: ScannedPairing) => scans.push(scanned),
        onCancel: () => { cancelled.count += 1; },
        bindings,
      }),
    );
  });

  const unmount = () => {
    flushSync(() => root.unmount());
    container.remove();
  };
  mounted.push(unmount);
  await settle();
  return { el: container, scans, cancelled, unmount };
}

describe('PairingQrScanner: the success path', () => {
  test('hands the join flow a parsed payload, not the raw QR text', async () => {
    const { bindings } = harness();
    const view = await render(bindings);
    await advance();

    expect(view.scans).toHaveLength(1);
    expect(view.scans[0]).toEqual({ kind: 'token', token: TOKEN, url: 'http://127.0.0.1:3421' });
  });

  test('stops the camera as soon as a scan succeeds, without waiting to be unmounted', async () => {
    const h = harness();
    const view = await render(h.bindings);
    await advance();

    expect(view.scans).toHaveLength(1);
    expect(h.tracks.every((track) => track.stopped)).toBe(true);
  });

  test('reports the scan exactly once even though the loop would keep ticking', async () => {
    const { bindings } = harness();
    const view = await render(bindings);
    await advance();
    await advance();

    expect(view.scans).toHaveLength(1);
  });

  test('never renders the scanned token', async () => {
    const { bindings } = harness();
    const view = await render(bindings);
    await advance();

    expect(view.el.textContent ?? '').not.toContain(TOKEN);
  });
});

describe('PairingQrScanner: camera hygiene', () => {
  test('stops every track when unmounted mid-scan', async () => {
    // No frames ever arrive, so the loop is still running when this unmounts.
    const h = harness({ frame: null });
    const view = await render(h.bindings);
    expect(h.tracks.some((track) => track.stopped)).toBe(false);

    view.unmount();
    expect(h.tracks.every((track) => track.stopped)).toBe(true);
  });

  test('does not open the camera at all when the context is not secure', async () => {
    const h = harness({ isSecureContext: false });
    await render(h.bindings);
    expect(h.getUserMediaCalls).toHaveLength(0);
  });
});

describe('PairingQrScanner: failure states', () => {
  test('plain http points at serving the app over HTTPS via Tailscale', async () => {
    const h = harness({ isSecureContext: false });
    const view = await render(h.bindings);
    const text = view.el.textContent ?? '';

    expect(text).toContain('secure (HTTPS) connection');
    expect(text).toContain('tailscale serve');
    expect(text).toContain('docs/deployment.md');
  });

  test('a denied camera permission says how to grant it', async () => {
    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    const h = harness({ getUserMedia: () => Promise.reject(denied) });
    const view = await render(h.bindings);
    const text = view.el.textContent ?? '';

    expect(text).toContain('permission to use the camera');
    expect(text).toContain('paste the operator token');
  });

  test('a browser with no camera API says so instead of asking for permission', async () => {
    const h = harness({ getUserMedia: null });
    const view = await render(h.bindings);
    expect(view.el.textContent ?? '').toContain('does not offer camera access');
  });

  test('a device with no camera is distinguished from a refused one', async () => {
    const missing = Object.assign(new Error('nope'), { name: 'NotFoundError' });
    const h = harness({ getUserMedia: () => Promise.reject(missing) });
    const view = await render(h.bindings);
    expect(view.el.textContent ?? '').toContain('No camera was found');
  });

  test('no available decoder is reported, and the camera is released', async () => {
    const h = harness({ detector: null });
    const view = await render(h.bindings);

    expect(view.el.textContent ?? '').toContain('no QR decoder available');
    // Nothing can be scanned, so holding the camera open would be a live camera
    // sitting behind a dead-end message.
    expect(h.tracks.every((track) => track.stopped)).toBe(true);
  });

  test('a failed start shows no camera preview', async () => {
    const h = harness({ isSecureContext: false });
    const view = await render(h.bindings);
    expect(view.el.querySelector('video')).toBeNull();
  });
});

describe('PairingQrScanner: an unreadable payload', () => {
  test('says the QR was not a pairing code and offers another go', async () => {
    const h = harness({
      detector: { backend: 'jsqr', detect: () => Promise.resolve('WIFI:S=coffee;T=WPA;P=letmein;;') },
    });
    const view = await render(h.bindings);
    await advance();

    const text = view.el.textContent ?? '';
    expect(text).toContain('not a GoodVibes pairing code');
    expect(view.scans).toHaveLength(0);
    expect(text).toContain('Try again');
  });

  test('never echoes the contents of a QR it could not use', async () => {
    const h = harness({
      detector: { backend: 'jsqr', detect: () => Promise.resolve('WIFI:S=coffee;T=WPA;P=letmein;;') },
    });
    const view = await render(h.bindings);
    await advance();

    // An unrecognized QR may be somebody's credential; it must not be reflected
    // back onto the screen.
    expect(view.el.textContent ?? '').not.toContain('letmein');
  });

  test('keeps the camera open so "Try again" does not re-prompt for permission', async () => {
    const h = harness({
      detector: { backend: 'jsqr', detect: () => Promise.resolve('not-a-pairing-code') },
    });
    await render(h.bindings);
    await advance();

    expect(h.tracks.some((track) => track.stopped)).toBe(false);
    expect(h.getUserMediaCalls).toHaveLength(1);
  });

  test('a good QR after a bad one still reaches the join flow', async () => {
    let next = 'not-a-pairing-code';
    const h = harness({
      detector: { backend: 'jsqr', detect: () => Promise.resolve(next) },
    });
    const view = await render(h.bindings);
    await advance();
    expect(view.scans).toHaveLength(0);

    const retry = Array.from(view.el.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Try again'),
    );
    expect(retry).toBeDefined();

    next = COMPANION_JSON;
    retry?.click();
    await advance();

    expect(view.scans).toHaveLength(1);
    expect(view.scans[0]).toMatchObject({ kind: 'token', token: TOKEN });
  });
});

describe('PairingQrScanner: cancelling', () => {
  test('the cancel button releases the camera', async () => {
    const h = harness({ frame: null });
    const view = await render(h.bindings);

    const cancel = Array.from(view.el.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Cancel'),
    );
    expect(cancel).toBeDefined();
    cancel?.click();
    await settle();

    expect(view.cancelled.count).toBe(1);
    // The parent closes the dialog on cancel, which unmounts this component.
    view.unmount();
    expect(h.tracks.every((track) => track.stopped)).toBe(true);
  });
});
