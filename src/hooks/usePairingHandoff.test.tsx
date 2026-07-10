/**
 * usePairingHandoff — fragment consumption + history cleanup + status flow.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const tokenCalls: string[] = [];
let tokenShouldReject = false;

mock.module('../lib/goodvibes', () => ({
  setExplicitAuthToken: (raw: string) => {
    tokenCalls.push(raw);
    return tokenShouldReject
      ? Promise.reject(Object.assign(new Error('rejected'), { status: 401 }))
      : Promise.resolve({ authenticated: true });
  },
}));

const { usePairingHandoff, resetPairingCaptureForTest } = await import('./usePairingHandoff');

let lastStatus = '';
let lastError: unknown = null;

function Probe() {
  const { status, error } = usePairingHandoff();
  lastStatus = status;
  lastError = error;
  return null;
}

function render(): () => void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Probe)));
  });
  return () => {
    flushSync(() => root.unmount());
    container.remove();
  };
}

async function tick() {
  await new Promise((r) => setTimeout(r, 10));
}

beforeEach(() => {
  tokenCalls.length = 0;
  tokenShouldReject = false;
  lastStatus = '';
  lastError = null;
  // The token is captured once at module scope — reset it, and set the URL, BEFORE
  // each render so every case starts from a clean, un-captured state.
  resetPairingCaptureForTest();
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('usePairingHandoff', () => {
  test('idle when there is no pairing fragment', async () => {
    window.history.replaceState(null, '', '/?view=chat');
    const unmount = render();
    expect(lastStatus).toBe('idle');
    await tick();
    expect(tokenCalls).toHaveLength(0);
    unmount();
  });

  test('consumes the token, strips the fragment immediately, and lands signed in', async () => {
    window.history.replaceState(null, '', '/?view=chat#pair=tok_live');
    const unmount = render();
    // First paint already knows a pairing is in flight.
    expect(lastStatus).toBe('pending');
    // The secret is stripped from the URL synchronously, before validation resolves.
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('?view=chat');
    await tick();
    expect(tokenCalls).toEqual(['tok_live']);
    expect(lastStatus).toBe('idle');
    unmount();
  });

  test('a rejected token surfaces as error status and the fragment is still stripped', async () => {
    tokenShouldReject = true;
    window.history.replaceState(null, '', '/#pair=bad');
    const unmount = render();
    expect(window.location.hash).toBe('');
    await tick();
    expect(tokenCalls).toEqual(['bad']);
    expect(lastStatus).toBe('error');
    expect(lastError).toBeInstanceOf(Error);
    unmount();
  });
});
