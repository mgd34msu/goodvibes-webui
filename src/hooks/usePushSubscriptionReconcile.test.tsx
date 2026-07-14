/**
 * usePushSubscriptionReconcile — fires on the rising edge into `enabled`, and
 * again on a service-worker `goodvibes-push-subscription-changed` message.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

let reconcileCalls = 0;

mock.module('../lib/push/push-client', () => ({
  reconcilePushSubscriptionOnOpen: () => {
    reconcileCalls += 1;
    return Promise.resolve({ drift: 'unchanged', subscription: null });
  },
}));

const { usePushSubscriptionReconcile } = await import('./usePushSubscriptionReconcile');

function Probe({ enabled }: { enabled: boolean }) {
  usePushSubscriptionReconcile(enabled);
  return null;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function render(enabled: boolean): void {
  flushSync(() => {
    root.render(React.createElement(Probe, { enabled }));
  });
}

async function tick() {
  await new Promise((r) => setTimeout(r, 10));
}

/** A minimal EventTarget stand-in for navigator.serviceWorker in this test. */
class FakeServiceWorkerContainer extends EventTarget {}

let fakeServiceWorker: FakeServiceWorkerContainer;

beforeEach(() => {
  reconcileCalls = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  fakeServiceWorker = new FakeServiceWorkerContainer();
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: fakeServiceWorker });
});

afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
});

describe('usePushSubscriptionReconcile', () => {
  test('does nothing while disabled', async () => {
    render(false);
    await tick();
    expect(reconcileCalls).toBe(0);
  });

  test('reconciles once on the rising edge into enabled', async () => {
    render(false);
    await tick();
    render(true);
    await tick();
    expect(reconcileCalls).toBe(1);
    // Re-rendering with the SAME enabled value is not a new edge.
    render(true);
    await tick();
    expect(reconcileCalls).toBe(1);
  });

  test('reconciles again on a service-worker subscription-changed message while enabled', async () => {
    render(true);
    await tick();
    expect(reconcileCalls).toBe(1);
    fakeServiceWorker.dispatchEvent(
      Object.assign(new Event('message'), { data: { type: 'goodvibes-push-subscription-changed', endpoint: 'x', keys: {} } }),
    );
    await tick();
    expect(reconcileCalls).toBe(2);
  });

  test('an unrelated service-worker message is ignored', async () => {
    render(true);
    await tick();
    expect(reconcileCalls).toBe(1);
    fakeServiceWorker.dispatchEvent(Object.assign(new Event('message'), { data: { type: 'some-other-message' } }));
    await tick();
    expect(reconcileCalls).toBe(1);
  });
});
