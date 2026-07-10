/**
 * relay-connection.ts — the active-route store and routedFetch's routing decisions.
 *
 * Deliberately does NOT exercise a real relay handshake (createRelayClient talks real
 * WebSocket/E2E crypto) — that belongs to an integration test against a real or stubbed
 * relay server. These cases cover what is unit-testable without one: the route store's
 * pub/sub, routedFetch falling through to the plain fetch on the direct route (the
 * common, unchanged case), and the immediate honest rejection of a stream request while
 * routed over relay — the one behavior this file adds that a consumer can observe
 * without ever standing up a relay.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import {
  getActiveRoute,
  routedFetch,
  setActiveRoute,
  subscribeActiveRoute,
} from './relay-connection';
import { RELAY_PAIRING_STORAGE_KEY } from './relay-pairing';

/** A minimal, correctly-typed fetch stub (see relay-connection.ts's own note on why
 * `typeof fetch` needs a `preconnect` static in this project's bun-typed globals). */
function stubFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch {
  return Object.assign(handler, {
    preconnect: () => {},
  }) as typeof fetch;
}

afterEach(() => {
  setActiveRoute('direct');
  window.localStorage.removeItem(RELAY_PAIRING_STORAGE_KEY);
});

describe('active route store', () => {
  test('defaults to direct', () => {
    expect(getActiveRoute()).toBe('direct');
  });

  test('setActiveRoute updates the snapshot', () => {
    setActiveRoute('relay');
    expect(getActiveRoute()).toBe('relay');
  });

  test('subscribeActiveRoute notifies listeners only on an actual change', () => {
    let calls = 0;
    const unsubscribe = subscribeActiveRoute(() => { calls += 1; });
    setActiveRoute('direct'); // already direct — no-op, no notify
    expect(calls).toBe(0);
    setActiveRoute('relay');
    expect(calls).toBe(1);
    setActiveRoute('relay'); // unchanged — no notify
    expect(calls).toBe(1);
    unsubscribe();
    setActiveRoute('direct');
    expect(calls).toBe(1); // unsubscribed — no further notifications
  });
});

describe('routedFetch', () => {
  test('delegates to the global fetch on the direct route (unchanged default behavior)', async () => {
    setActiveRoute('direct');
    let sawUrl: unknown;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch((input) => {
      sawUrl = input;
      return Promise.resolve(new Response('ok'));
    });
    try {
      const res = await routedFetch('https://daemon.example/api/x');
      expect(sawUrl).toBe('https://daemon.example/api/x');
      expect(await res.text()).toBe('ok');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('rejects an event-stream request immediately when routed over relay, without touching the network', async () => {
    setActiveRoute('relay');
    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch(() => {
      fetchCalled = true;
      return Promise.resolve(new Response('should not be reached'));
    });
    try {
      await expect(
        routedFetch('https://daemon.example/api/control-plane/events', {
          headers: { Accept: 'text/event-stream' },
        }),
      ).rejects.toThrow();
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('rejects an event-stream request built as a Headers instance too', async () => {
    setActiveRoute('relay');
    await expect(
      routedFetch('https://daemon.example/api/control-plane/events', {
        headers: new Headers({ Accept: 'text/event-stream' }),
      }),
    ).rejects.toThrow();
  });

  test('falls back to the global fetch on relay route with no pairing stored (no client to route through)', async () => {
    setActiveRoute('relay');
    let sawUrl: unknown;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch((input) => {
      sawUrl = input;
      return Promise.resolve(new Response('ok'));
    });
    try {
      const res = await routedFetch('https://daemon.example/api/x');
      expect(sawUrl).toBe('https://daemon.example/api/x');
      expect(res.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
