/**
 * NotificationSettings — the push + install capability labels.
 *
 * Both the push banner (support === 'insecure-context') and the install section's
 * insecure-origin banner render the DAEMON's own reason text from pairing.posture.get
 * ("needs https — available via tailscale") once it has loaded, honestly falling back to
 * a still-true generic HTTPS pointer before it answers or if the fetch fails — never a
 * blank label, never a dead button, never a client-fabricated guess about the daemon's
 * own deployment.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../lib/toast';

let postureResult: unknown = { posture: { origin: 'http://192.168.0.131:3423', scheme: 'http', privateNetwork: true, secureContext: false, notice: 'lan notice', capabilities: [
  { capability: 'service-worker', available: false, reason: 'needs https — available via tailscale' },
  { capability: 'push', available: false, reason: 'needs https — available via tailscale' },
  { capability: 'microphone', available: false, reason: 'needs https — available via tailscale' },
] } };
let postureRejects = false;

mock.module('../../lib/goodvibes', () => ({
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  sdk: {
    operator: {
      pairing: {
        posture: {
          get: () => (postureRejects ? Promise.reject(new Error('network down')) : Promise.resolve(postureResult)),
        },
      },
    },
  },
}));

mock.module('../../lib/push/push-client', () => ({
  currentSubscription: () => Promise.resolve(null),
  describePushSubscribeError: (e: unknown) => String(e),
  sendTestPush: () => Promise.resolve(),
  subscribeToPush: () => Promise.resolve(),
  unsubscribeFromPush: () => Promise.resolve(),
}));

let pushSupportValue: 'ok' | 'insecure-context' | 'unsupported' = 'insecure-context';
mock.module('../../lib/push/push-support', () => ({
  detectPushSupport: () => pushSupportValue,
  readNotificationPermission: () => 'default',
}));

let installAffordanceValue: 'prompt' | 'ios-instructions' | 'installed' | 'none' = 'none';
mock.module('../../lib/pwa/install-prompt', () => ({
  useInstallPrompt: () => ({ affordance: installAffordanceValue, promptInstall: () => Promise.resolve('unavailable') }),
}));

const { NotificationSettings } = await import('./NotificationSettings');

function render(): { el: HTMLElement; unmount: () => void } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(ToastProvider, null, React.createElement(NotificationSettings)),
    ));
  });
  return { el: container, unmount: () => { flushSync(() => root.unmount()); container.remove(); } };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
    flushSync(() => {});
  }
}

afterEach(() => {
  postureRejects = false;
  pushSupportValue = 'insecure-context';
  installAffordanceValue = 'none';
});

describe('push capability label', () => {
  test('renders the daemon posture reason once pairing.posture.get answers', async () => {
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('needs https — available via tailscale') === true);
    expect(el.textContent).toContain('needs https — available via tailscale');
    unmount();
  });

  test('falls back to the honest generic HTTPS pointer while posture is loading or on failure', async () => {
    postureRejects = true;
    const { el, unmount } = render();
    // Never blank: the fallback copy is present immediately, and stays present
    // once the rejected fetch settles (never a crash, never an empty banner).
    expect(el.textContent).toContain('secure (HTTPS) connection');
    await new Promise((r) => setTimeout(r, 20));
    flushSync(() => {});
    expect(el.textContent).toContain('secure (HTTPS) connection');
    expect(el.textContent).not.toContain('needs https — available via tailscale');
    unmount();
  });

  test('an "ok" support state shows the real push controls, not a banner', () => {
    pushSupportValue = 'ok';
    const { el, unmount } = render();
    expect(el.textContent).toContain('Turn on notifications');
    unmount();
  });

  test('an unsupported browser shows the honest unsupported note, not the HTTPS pointer', () => {
    pushSupportValue = 'unsupported';
    const { el, unmount } = render();
    expect(el.textContent).toContain('does not support Web Push');
    unmount();
  });
});

describe('install (service-worker) capability label', () => {
  test('a private-network origin (insecure context, no install prompt available) shows the daemon reason, never a dead generic fallback', async () => {
    installAffordanceValue = 'none';
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('needs https — available via tailscale') === true);
    // The two capability labels ("push" and "service-worker") both render the same
    // daemon reason text; this proves the install section specifically ALSO renders
    // it (not just the push section) by checking it appears at least twice.
    const occurrences = el.textContent?.split('needs https — available via tailscale').length ?? 1;
    expect(occurrences - 1).toBeGreaterThanOrEqual(2);
    expect(el.textContent).not.toContain('Use your browser’s menu to add this app');
    unmount();
  });

  test('a secure origin with no captured prompt event shows the honest generic fallback, not an insecure-origin label', async () => {
    postureResult = { posture: { origin: 'https://mybox.example.ts.net', scheme: 'https', privateNetwork: false, secureContext: true, capabilities: [
      { capability: 'service-worker', available: true },
      { capability: 'push', available: true },
      { capability: 'microphone', available: true },
    ] } };
    pushSupportValue = 'ok';
    installAffordanceValue = 'none';
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Turn on notifications') === true);
    expect(el.textContent).toContain('Use your browser’s menu to add this app');
    unmount();
  });

  test('a captured beforeinstallprompt event always shows the real Install button, regardless of posture', () => {
    installAffordanceValue = 'prompt';
    const { el, unmount } = render();
    expect(el.textContent).toContain('Add to Home Screen');
    unmount();
  });
});
