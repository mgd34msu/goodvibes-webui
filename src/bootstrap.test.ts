/**
 * bootstrap / insecure-origin guard — Finding 3 (plain-http LAN white screen).
 *
 * Proves the entry guard: on an insecure non-local origin the honest "needs HTTPS"
 * message renders and the app graph (mount-app, which pulls the throwing SDK transport at
 * module load) is NEVER imported; on a secure origin the app mounts normally.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';

// Stub the app-mount path so the secure branch does not drag in the whole App/SDK graph.
let mountAppCalls = 0;
mock.module('./mount-app', () => ({
  mountApp: () => {
    mountAppCalls += 1;
  },
}));

const { bootstrap, renderInsecureOriginNotice } = await import('./bootstrap');
const { isInsecureTransportOrigin, INSECURE_ORIGIN_TITLE } = await import('./lib/insecure-origin');

function setOrigin(url: string): void {
  (globalThis as unknown as { happyDOM: { setURL: (u: string) => void } }).happyDOM.setURL(url);
}

afterEach(() => {
  setOrigin('http://localhost/');
  mountAppCalls = 0;
});

describe('isInsecureTransportOrigin', () => {
  test('plain http on localhost is NOT insecure (local dev)', () => {
    setOrigin('http://localhost:4360/');
    expect(isInsecureTransportOrigin()).toBe(false);
  });

  test('plain http on a 127.x loopback is NOT insecure', () => {
    setOrigin('http://127.0.0.1:4360/');
    expect(isInsecureTransportOrigin()).toBe(false);
  });

  test('plain http on a LAN IP IS insecure', () => {
    setOrigin('http://192.168.0.131:4360/');
    expect(isInsecureTransportOrigin()).toBe(true);
  });

  test('https on a LAN IP is NOT insecure (the supported tailscale path)', () => {
    setOrigin('https://192.168.0.131:4363/');
    expect(isInsecureTransportOrigin()).toBe(false);
  });
});

describe('bootstrap entry guard', () => {
  test('renderInsecureOriginNotice paints the honest HTTPS message with an alert role', () => {
    const root = document.createElement('div');
    renderInsecureOriginNotice(root);
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    expect(root.textContent).toContain(INSECURE_ORIGIN_TITLE);
    expect(root.textContent).toContain('HTTPS');
  });

  test('an insecure non-local origin renders the message and never mounts the app', async () => {
    setOrigin('http://192.168.0.131:4360/');
    const root = document.createElement('div');
    await bootstrap(root);
    expect(root.textContent).toContain(INSECURE_ORIGIN_TITLE);
    expect(mountAppCalls).toBe(0);
  });

  test('a secure origin mounts the app and shows no HTTPS notice', async () => {
    setOrigin('http://localhost:4360/');
    const root = document.createElement('div');
    await bootstrap(root);
    expect(mountAppCalls).toBe(1);
    expect(root.textContent).not.toContain(INSECURE_ORIGIN_TITLE);
  });
});
