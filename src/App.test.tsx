/**
 * App — daemon-unreachable gate recovery (Wave-2 F3).
 *
 * DaemonUnreachableGate's copy promises the operator will "pick up where it left
 * off" once the daemon comes back. Before this fix, App.tsx early-returned the gate
 * IN PLACE of the workspace subtree, which unmounted SessionsView and SteerComposer —
 * discarding the selected session and any half-typed steer/follow-up draft. The fix
 * renders the gate as an overlay ON TOP of the still-mounted (inert) workspace, so
 * this is a regression test: it types a draft and selects a session, forces a daemon
 * blip (auth query rejects as unreachable), asserts the SAME textarea DOM node is
 * still present underneath (not a fresh remounted one) with its value intact, then
 * recovers the daemon and asserts the draft and selection are exactly where they
 * were.
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type AuthMode = 'ok' | 'unreachable';
let authMode: AuthMode = 'ok';

function unreachableError() {
  // Matches isDaemonUnreachableError's contract (errors.ts): category 'network'
  // (or status 0) marks a connection failure, distinct from a genuine 401.
  return Object.assign(new Error('fetch failed'), { category: 'network', status: 0 });
}

const SESSIONS_FIXTURE = {
  totals: { sessions: 1 },
  sessions: [
    {
      id: 's1',
      kind: 'tui',
      project: 'proj',
      title: 'Session One',
      status: 'active',
      updatedAt: 10,
      messageCount: 2,
      activeAgentId: 'agent-1',
    },
  ],
};

// Full replacement of src/lib/goodvibes.ts — App.tsx's whole reachable import graph
// (queries.ts, useSessionRealtime, useRealtimeInvalidation, SessionsView,
// SteerComposer, and the statically-imported-but-not-rendered other views) resolves
// through this one module, so every name any of them import must be present.
// StatusStrip (always-on chrome inside AppShell) calls useDaemonHealth(), which does
// a raw `fetch()` outside the sdk facade and polls sdk.operator.models.current() (not
// stubbed above). Neither matters to this test, so mock the whole hook the same way
// StatusStrip.test.tsx does — avoids real-network noise and an unstubbed method call.
mock.module('./hooks/useDaemonHealth', () => ({
  useDaemonHealth: () => ({
    connection: 'connected',
    signedIn: 'signed-in',
    working: 'working',
    latencyMs: 10,
    sse: 'active',
    activeTurns: 0,
    queuedTasks: 0,
    modelName: null,
  }),
}));

mock.module('./lib/goodvibes', () => ({
  WEBUI_TOKEN_STORE_KEY: 'test-token-key',
  GOODVIBES_BASE_URL: 'http://localhost/test',
  DEFAULT_SSE_RECONNECT: { enabled: true, baseDelayMs: 1, maxDelayMs: 2, backoffFactor: 2, maxAttempts: 1 },
  hasStoredTokenSync: () => true,
  getCurrentAuth: () => (
    authMode === 'unreachable' ? Promise.reject(unreachableError()) : Promise.resolve({ ok: true })
  ),
  login: () => Promise.resolve({}),
  setExplicitAuthToken: () => Promise.resolve({}),
  clearStoredAuthToken: () => Promise.resolve(undefined),
  invokeMethod: () => Promise.resolve({}),
  sdk: {
    operator: {
      control: { status: () => Promise.resolve({}), snapshot: () => Promise.resolve({}) },
      accounts: { snapshot: () => Promise.resolve({}) },
      providers: { list: () => Promise.resolve({}) },
      tasks: { list: () => Promise.resolve({}) },
      approvals: { list: () => Promise.resolve({}) },
      sessions: {
        list: () => Promise.resolve(SESSIONS_FIXTURE),
        messages: { list: () => Promise.resolve({ messages: [] }) },
        steer: () => Promise.resolve({}),
        followUp: () => Promise.resolve({}),
      },
    },
    knowledge: { status: () => Promise.resolve({}) },
    streams: { open: () => Promise.resolve(() => {}) },
    chat: { sessions: { list: () => Promise.resolve({}), delete: () => Promise.resolve({}) } },
  },
}));

const { default: App } = await import('./App');
const { queryKeys } = await import('./lib/queries');

function render(): { container: HTMLElement; client: QueryClient; unmount: () => void } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(App)));
  });
  return {
    container,
    client,
    unmount: () => {
      flushSync(() => root.unmount());
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

async function flushMicrotasks(times = 8) {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop -- deliberate sequential drain
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

afterEach(() => {
  authMode = 'ok';
});

describe('App: daemon-unreachable gate preserves in-progress work', () => {
  test('a daemon blip mid-typing does not reset the selected session or discard the steer draft', async () => {
    window.history.pushState({}, '', '/?view=sessions');
    const { container, client, unmount } = render();
    await flushMicrotasks();

    // Select the only session in the union.
    const row = [...container.querySelectorAll('.sessions-row')]
      .find((r) => r.textContent?.includes('Session One'));
    expect(row).toBeTruthy();
    flushSync(() => {
      row?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await flushMicrotasks();
    expect(container.textContent).toContain('Session One');

    // Type a draft into the steer composer without submitting it.
    const textarea = container.querySelector('.steer-composer textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    flushSync(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, 'half-typed steer draft');
      textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(textarea.value).toBe('half-typed steer draft');
    expect(container.querySelector('.daemon-gate-overlay')).toBeNull();

    // Simulate a daemon blip: the next auth probe fails as unreachable.
    authMode = 'unreachable';
    flushSync(() => {
      void client.refetchQueries({ queryKey: queryKeys.auth });
    });
    await flushMicrotasks();

    expect(container.querySelector('.daemon-gate-overlay')).toBeTruthy();
    expect(container.textContent).toContain('reach the daemon');

    // The workspace underneath must still be mounted (not remounted) — same DOM
    // node, same value, just hidden behind the inert overlay.
    const appShell = container.querySelector('.app-shell');
    expect(appShell?.hasAttribute('inert')).toBe(true);
    const textareaDuringOutage = container.querySelector('.steer-composer textarea') as HTMLTextAreaElement;
    expect(textareaDuringOutage).toBe(textarea);
    expect(textareaDuringOutage.value).toBe('half-typed steer draft');

    // Daemon comes back.
    authMode = 'ok';
    flushSync(() => {
      void client.refetchQueries({ queryKey: queryKeys.auth });
    });
    await flushMicrotasks();

    expect(container.querySelector('.daemon-gate-overlay')).toBeNull();
    expect(container.querySelector('.app-shell')?.hasAttribute('inert')).toBe(false);
    const textareaAfterRecovery = container.querySelector('.steer-composer textarea') as HTMLTextAreaElement;
    expect(textareaAfterRecovery).toBe(textarea);
    expect(textareaAfterRecovery.value).toBe('half-typed steer draft');
    expect(container.textContent).toContain('Session One');

    unmount();
  });
});
