/**
 * HostedSessionsView — list rendering (incl. the includeTerminated toggle and
 * the terminatedReason honesty line), attach/history rendering, and the
 * honesty-bar degrade for an unmodeled sessions.hosted.list response.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../lib/toast';
import { ToastViewport } from '../../components/toast/ToastViewport';

const RUNNING = {
  id: 'hosted-1', workspaceRoot: '/home/operator/project-a', title: 'Refactor the parser',
  status: 'running', detachPolicy: null, effectiveDetachPolicy: 'survive', attachedClients: ['other-client'],
  createdAt: 1, updatedAt: 100, turnCount: 3, messageCount: 6, restoredFromDisk: false,
};
const TERMINATED = {
  id: 'hosted-2', workspaceRoot: '/home/operator/project-b', title: 'One-off cleanup',
  status: 'terminated', detachPolicy: 'kill', effectiveDetachPolicy: 'kill', attachedClients: [],
  createdAt: 1, updatedAt: 50, turnCount: 1, messageCount: 2, terminatedAt: 60, terminatedReason: 'killed',
  restoredFromDisk: false,
};

let listImpl: (input?: { includeTerminated?: boolean }) => Promise<unknown> =
  () => Promise.resolve({ sessions: [RUNNING] });
let attachImpl: (sessionId: string, clientId: string) => Promise<unknown> =
  (sessionId) => Promise.resolve({ session: { ...RUNNING, id: sessionId }, history: [{ role: 'user', content: 'hello', at: 1 }] });
let detachImpl: (sessionId: string) => Promise<unknown> =
  (sessionId) => Promise.resolve({ session: { ...RUNNING, id: sessionId, attachedClients: [] } });
let createImpl: (input: unknown) => Promise<unknown> = () => Promise.resolve({ session: RUNNING });
let killImpl: (sessionId: string) => Promise<unknown> = () => Promise.resolve({ session: TERMINATED });
const detachCalls: { sessionId: string; clientId: string }[] = [];
const steerCalls: { sessionId: string; body: unknown }[] = [];
const createCalls: unknown[] = [];
const killCalls: string[] = [];
const beaconCalls: { sessionId: string; clientId: string }[] = [];

mock.module('../../lib/goodvibes', () => ({
  DEFAULT_SSE_RECONNECT: { enabled: true, baseDelayMs: 1, maxDelayMs: 2, backoffFactor: 2, maxAttempts: 3 },
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  hostedSessionDetachBeacon: (sessionId: string, clientId: string) => {
    beaconCalls.push({ sessionId, clientId });
  },
  sdk: {
    streams: { open: () => Promise.resolve(() => {}) },
    operator: {
      sessions: {
        hosted: {
          list: (input?: { includeTerminated?: boolean }) => listImpl(input),
          attach: (sessionId: string, clientId: string) => attachImpl(sessionId, clientId),
          detach: (sessionId: string, clientId: string) => {
            detachCalls.push({ sessionId, clientId });
            return detachImpl(sessionId);
          },
          create: (input: unknown) => {
            createCalls.push(input);
            return createImpl(input);
          },
          kill: (sessionId: string) => {
            killCalls.push(sessionId);
            return killImpl(sessionId);
          },
        },
        steer: (sessionId: string, input: unknown) => {
          steerCalls.push({ sessionId, body: input });
          return Promise.resolve({ session: null, message: {}, input: {}, mode: 'continued-live', agentId: null });
        },
        followUp: (sessionId: string, input: unknown) => {
          steerCalls.push({ sessionId, body: input });
          return Promise.resolve({ session: null, message: {}, input: {}, mode: 'queued-follow-up', agentId: null });
        },
      },
    },
  },
}));

const { HostedSessionsView } = await import('./HostedSessionsView');

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function render(): { el: HTMLElement; unmount: () => void } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(
        ToastProvider,
        null,
        React.createElement(HostedSessionsView),
        React.createElement(ToastViewport),
      ),
    ));
  });
  return {
    el: container,
    unmount: () => {
      flushSync(() => root.unmount());
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

afterEach(() => {
  listImpl = () => Promise.resolve({ sessions: [RUNNING] });
  attachImpl = (sessionId) => Promise.resolve({ session: { ...RUNNING, id: sessionId }, history: [{ role: 'user', content: 'hello', at: 1 }] });
  detachImpl = (sessionId) => Promise.resolve({ session: { ...RUNNING, id: sessionId, attachedClients: [] } });
  createImpl = () => Promise.resolve({ session: RUNNING });
  killImpl = () => Promise.resolve({ session: TERMINATED });
  detachCalls.length = 0;
  steerCalls.length = 0;
  createCalls.length = 0;
  killCalls.length = 0;
  beaconCalls.length = 0;
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('HostedSessionsView — list', () => {
  test('renders a hosted session row with title, status, workspace, detach policy and counts', async () => {
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Refactor the parser') ?? false);
    expect(el.textContent).toContain('Refactor the parser');
    expect(el.textContent).toContain('/home/operator/project-a');
    expect(el.textContent).toContain('running');
    expect(el.textContent).toContain('detach: survive');
    expect(el.textContent).toContain('3 turns');
    expect(el.textContent).toContain('6 messages');
    expect(el.textContent).toContain('1 attached client');
    unmount();
  });

  test('a true-empty list (includeTerminated off, nothing active) says so honestly', async () => {
    listImpl = () => Promise.resolve({ sessions: [] });
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('No active hosted sessions') ?? false);
    unmount();
  });

  test('terminated rows show the terminatedReason line, hidden until includeTerminated is checked', async () => {
    listImpl = (input) => Promise.resolve({ sessions: input?.includeTerminated ? [RUNNING, TERMINATED] : [RUNNING] });
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Refactor the parser') ?? false);
    expect(el.textContent).not.toContain('One-off cleanup');

    const toggle = el.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(toggle).not.toBeNull();
    flushSync(() => toggle?.click());
    await waitFor(() => el.textContent?.includes('One-off cleanup') ?? false);
    expect(el.textContent).toContain('terminated — ended with sessions.hosted.kill');
    unmount();
  });

  test('honesty bar: an unmodeled sessions.hosted.list response ({}) renders a stated "could not be read" message, never an empty list', async () => {
    listImpl = () => Promise.resolve({});
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Could not read hosted sessions') ?? false);
    expect(el.textContent).not.toContain('No active hosted sessions');
    unmount();
  });
});

describe('HostedSessionsView — attach/steer', () => {
  test('selecting a row attaches with a stable client id and renders the history', async () => {
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Refactor the parser') ?? false);

    const row = el.querySelector('.hosted-session-row__button');
    expect(row).not.toBeNull();
    flushSync(() => (row as HTMLButtonElement).click());

    await waitFor(() => el.textContent?.includes('hello') ?? false);
    expect(el.querySelector('.hosted-session-transcript')).not.toBeNull();
    // The steer composer renders for the attached session.
    expect(el.querySelector('.steer-composer')).not.toBeNull();
    unmount();
  });

  test('submitting the steer composer calls sessions.steer for the attached session', async () => {
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Refactor the parser') ?? false);
    const row = el.querySelector('.hosted-session-row__button');
    flushSync(() => (row as HTMLButtonElement).click());
    await waitFor(() => Boolean(el.querySelector('.steer-composer__input')));

    const textarea = el.querySelector('.steer-composer__input') as HTMLTextAreaElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    flushSync(() => {
      nativeSetter?.call(textarea, 'do the thing');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = el.querySelector('.steer-composer__form') as HTMLFormElement;
    flushSync(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

    await waitFor(() => steerCalls.length > 0);
    expect(steerCalls[0].sessionId).toBe('hosted-1');
    unmount();
  });

  test('an attach failure (unmodeled response) renders an honest "could not attach" state', async () => {
    attachImpl = () => Promise.resolve({});
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Refactor the parser') ?? false);
    const row = el.querySelector('.hosted-session-row__button');
    flushSync(() => (row as HTMLButtonElement).click());
    await waitFor(() => el.textContent?.includes('Could not attach') ?? false);
    unmount();
  });
});

describe('HostedSessionsView — passive detach honesty', () => {
  test('a passive detach failure (switching rows) is logged and toasted, never silent', async () => {
    detachImpl = () => Promise.reject(new Error('daemon unreachable'));
    const consoleWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => { warnings.push(args); };
    listImpl = () => Promise.resolve({ sessions: [RUNNING, TERMINATED] });

    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Refactor the parser') ?? false);
    const rows = el.querySelectorAll('.hosted-session-row__button');
    flushSync(() => (rows[0] as HTMLButtonElement).click());
    await waitFor(() => el.textContent?.includes('hello') ?? false);

    // Switching to the OTHER row passively detaches the first — which is rigged
    // above to fail.
    flushSync(() => (rows[1] as HTMLButtonElement).click());

    await waitFor(() => warnings.length > 0);
    expect(String(warnings[0][0])).toContain('passive detach failed');
    await waitFor(() => el.textContent?.includes('Could not detach from a hosted session') ?? false);

    console.warn = consoleWarn;
    unmount();
  });
});

describe('HostedSessionsView — the attached session reconciles against a fresher list row', () => {
  test('a session that terminates while the stream is down updates the attached view on the next list refresh', async () => {
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Refactor the parser') ?? false);
    const row = el.querySelector('.hosted-session-row__button');
    flushSync(() => (row as HTMLButtonElement).click());
    await waitFor(() => Boolean(el.querySelector('.steer-composer')));
    expect(el.querySelector('.steer-composer .badge.neutral')).toBeNull();

    // The daemon terminated hosted-1 while no lifecycle frame reached this client
    // (the scenario the stream-down fallback poll targets) — the next list
    // read reflects it.
    listImpl = () => Promise.resolve({
      sessions: [{ ...RUNNING, status: 'terminated', terminatedReason: 'killed', updatedAt: 999 }],
    });
    const refresh = el.querySelector('.hosted-sessions-refresh');
    flushSync(() => (refresh as HTMLButtonElement).click());

    await waitFor(() => el.textContent?.includes('Session closed') ?? false);
    unmount();
  });
});

describe('HostedSessionsView — create a hosted session', () => {
  test('the create form is hidden until "New session" is toggled', async () => {
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Refactor the parser') ?? false);
    expect(el.querySelector('.hosted-sessions-create-form')).toBeNull();
    unmount();
  });

  test('submitting sends the workspace path, title, and omits detachPolicy for "Use daemon default"', async () => {
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Refactor the parser') ?? false);

    const toggle = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('New session'));
    flushSync(() => (toggle as HTMLButtonElement).click());
    await waitFor(() => Boolean(el.querySelector('.hosted-sessions-create-form')));

    const workspaceInput = el.querySelector('input[aria-label="Workspace path"]') as HTMLInputElement;
    const titleInput = el.querySelector('input[aria-label="Title"]') as HTMLInputElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    flushSync(() => {
      nativeSetter?.call(workspaceInput, '/home/operator/new-project');
      workspaceInput.dispatchEvent(new Event('input', { bubbles: true }));
      nativeSetter?.call(titleInput, 'Investigate the flake');
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = el.querySelector('.hosted-sessions-create-form') as HTMLFormElement;
    flushSync(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

    await waitFor(() => createCalls.length > 0);
    expect(createCalls[0]).toEqual({ workspaceRoot: '/home/operator/new-project', title: 'Investigate the flake' });
    unmount();
  });

  test('choosing a detach policy sends it explicitly', async () => {
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Refactor the parser') ?? false);
    const toggle = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('New session'));
    flushSync(() => (toggle as HTMLButtonElement).click());
    await waitFor(() => Boolean(el.querySelector('.hosted-sessions-create-form')));

    const workspaceInput = el.querySelector('input[aria-label="Workspace path"]') as HTMLInputElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    flushSync(() => {
      nativeSetter?.call(workspaceInput, '/ws');
      workspaceInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const select = el.querySelector('select[aria-label="Detach policy"]') as HTMLSelectElement;
    const nativeSelectSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
    flushSync(() => {
      nativeSelectSetter?.call(select, 'survive');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const form = el.querySelector('.hosted-sessions-create-form') as HTMLFormElement;
    flushSync(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

    await waitFor(() => createCalls.length > 0);
    expect(createCalls[0]).toEqual({ workspaceRoot: '/ws', detachPolicy: 'survive' });
    unmount();
  });

  test('a successful create attaches the new session and closes the form', async () => {
    createImpl = () => Promise.resolve({ session: { ...RUNNING, id: 'hosted-new', title: 'Brand new session' } });
    attachImpl = (sessionId) => Promise.resolve({
      session: { ...RUNNING, id: sessionId, title: 'Brand new session' },
      history: [],
    });
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Refactor the parser') ?? false);
    const toggle = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('New session'));
    flushSync(() => (toggle as HTMLButtonElement).click());
    await waitFor(() => Boolean(el.querySelector('.hosted-sessions-create-form')));

    const workspaceInput = el.querySelector('input[aria-label="Workspace path"]') as HTMLInputElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    flushSync(() => {
      nativeSetter?.call(workspaceInput, '/ws');
      workspaceInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = el.querySelector('.hosted-sessions-create-form') as HTMLFormElement;
    flushSync(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

    await waitFor(() => el.textContent?.includes('Brand new session') ?? false);
    expect(el.querySelector('.hosted-sessions-create-form')).toBeNull();
    expect(el.querySelector('.steer-composer')).not.toBeNull();
    unmount();
  });

  test('a create failure toasts honestly and leaves the form open', async () => {
    createImpl = () => Promise.reject(new Error('workspace does not exist'));
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Refactor the parser') ?? false);
    const toggle = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('New session'));
    flushSync(() => (toggle as HTMLButtonElement).click());
    await waitFor(() => Boolean(el.querySelector('.hosted-sessions-create-form')));

    const workspaceInput = el.querySelector('input[aria-label="Workspace path"]') as HTMLInputElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    flushSync(() => {
      nativeSetter?.call(workspaceInput, '/ws');
      workspaceInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = el.querySelector('.hosted-sessions-create-form') as HTMLFormElement;
    flushSync(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

    await waitFor(() => el.textContent?.includes('Could not create hosted session') ?? false);
    expect(el.querySelector('.hosted-sessions-create-form')).not.toBeNull();
    unmount();
  });
});

describe('HostedSessionsView — end (kill) a hosted session, including a survive-policy one', () => {
  test('a survive-policy session shows an End session button, confirmed before it fires', async () => {
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Refactor the parser') ?? false);
    const row = el.querySelector('.hosted-session-row__button');
    flushSync(() => (row as HTMLButtonElement).click());
    await waitFor(() => Boolean(el.querySelector('.steer-composer')));

    const endButton = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('End session'));
    expect(endButton).not.toBeUndefined();
    flushSync(() => endButton?.click());
    await waitFor(() => Boolean(el.querySelector('.confirm-sheet__confirm')));
    expect(killCalls).toHaveLength(0);

    flushSync(() => (el.querySelector('.confirm-sheet__confirm') as HTMLButtonElement).click());
    await waitFor(() => killCalls.length > 0);
    expect(killCalls[0]).toBe('hosted-1');
    await waitFor(() => el.textContent?.includes('Session closed') ?? false);
    unmount();
  });

  test('no End session button once the session is already terminated', async () => {
    // attach and the list agree: hosted-1 is terminated (a fresher list row would
    // otherwise win the reconciliation effect and clobber this with a stale 'running').
    listImpl = () => Promise.resolve({ sessions: [{ ...RUNNING, status: 'terminated', updatedAt: 200 }] });
    attachImpl = (sessionId) => Promise.resolve({ session: { ...TERMINATED, id: sessionId, updatedAt: 200 }, history: [] });
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Refactor the parser') ?? false);
    const row = el.querySelector('.hosted-session-row__button');
    flushSync(() => (row as HTMLButtonElement).click());
    await waitFor(() => Boolean(el.querySelector('.hosted-session-detail__terminated')));
    const endButton = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('End session'));
    expect(endButton).toBeUndefined();
    unmount();
  });
});

describe('HostedSessionsView — a closed tab detaches via keepalive beacon', () => {
  test('pagehide fires the keepalive beacon for the attached session', async () => {
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Refactor the parser') ?? false);
    const row = el.querySelector('.hosted-session-row__button');
    flushSync(() => (row as HTMLButtonElement).click());
    await waitFor(() => Boolean(el.querySelector('.steer-composer')));

    flushSync(() => window.dispatchEvent(new Event('pagehide')));

    expect(beaconCalls).toHaveLength(1);
    expect(beaconCalls[0].sessionId).toBe('hosted-1');
    unmount();
  });

  test('the tab backgrounding (visibilitychange to hidden) also fires the beacon', async () => {
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Refactor the parser') ?? false);
    const row = el.querySelector('.hosted-session-row__button');
    flushSync(() => (row as HTMLButtonElement).click());
    await waitFor(() => Boolean(el.querySelector('.steer-composer')));

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    flushSync(() => document.dispatchEvent(new Event('visibilitychange')));

    expect(beaconCalls).toHaveLength(1);
    expect(beaconCalls[0].sessionId).toBe('hosted-1');
    unmount();
  });

  test('visibilitychange to visible does not fire the beacon', async () => {
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Refactor the parser') ?? false);
    const row = el.querySelector('.hosted-session-row__button');
    flushSync(() => (row as HTMLButtonElement).click());
    await waitFor(() => Boolean(el.querySelector('.steer-composer')));

    flushSync(() => document.dispatchEvent(new Event('visibilitychange')));

    expect(beaconCalls).toHaveLength(0);
    unmount();
  });

  test('pagehide with nothing attached is a no-op', async () => {
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Refactor the parser') ?? false);
    flushSync(() => window.dispatchEvent(new Event('pagehide')));
    expect(beaconCalls).toHaveLength(0);
    unmount();
  });

  test('pagehide never fires the ordinary async detach — only the beacon', async () => {
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Refactor the parser') ?? false);
    const row = el.querySelector('.hosted-session-row__button');
    flushSync(() => (row as HTMLButtonElement).click());
    await waitFor(() => Boolean(el.querySelector('.steer-composer')));

    flushSync(() => window.dispatchEvent(new Event('pagehide')));

    expect(beaconCalls).toHaveLength(1);
    expect(detachCalls).toHaveLength(0);
    unmount();
  });
});
