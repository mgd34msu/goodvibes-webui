/**
 * ChatView, turn-lifecycle reset on session switch.
 *
 * turnState and turnError are ONE value (TurnPhase, see message-utils.ts), not two
 * independently-mutated useState strings. Before that fix, a terminal turnState left
 * over from a prior session's dropped/failed turn (e.g. an 'error' from a stream
 * event) survived a session switch and rendered in the NEW session's header, because
 * only turnError was cleared on switch (useChatStream's per-session connect effect),
 * never turnState. App.tsx mounts ChatView without `key={activeSessionId}`, so this
 * test switches sessions via a PROP change on an already-mounted instance, matching
 * production: a remount would reset state trivially and prove nothing.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChatViewProps } from './chat/types';

// ---------------------------------------------------------------------------
// sdk mock: chat.events.stream is controllable per call, so the test can fire a
// live turn.error event for one session, then prove it does not survive a switch
// to another. Every other route ChatView (or a child it mounts, e.g. the composer's
// mic/voice controls) touches is stubbed to a benign, immediately-resolved value —
// none of it is what this test is about.
// ---------------------------------------------------------------------------

interface StreamCall {
  readonly sessionId: string;
  readonly options: {
    onEvent: (eventName: string, payload: unknown) => void;
    onError: (error: unknown) => void;
    onReady?: () => void;
  };
}

const streamCalls: StreamCall[] = [];
const streamMock = mock((sessionId: string, options: StreamCall['options']) => {
  streamCalls.push({ sessionId, options });
  // Never resolves in these tests: onEvent is invoked directly against the
  // captured options, the disconnect handle is not needed.
  return new Promise(() => {});
});

mock.module('../lib/goodvibes', () => ({
  DEFAULT_SSE_RECONNECT: { enabled: true, baseDelayMs: 1_000, maxDelayMs: 30_000, backoffFactor: 2, maxAttempts: 10 },
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  GOODVIBES_BASE_URL: 'http://daemon.test',
  WEBUI_VERSION: 'test',
  sdk: {
    chat: {
      turns: { cancel: mock(() => Promise.resolve({})) },
      events: { stream: streamMock },
      messages: { list: mock(() => Promise.resolve({ messages: [] })) },
      sessions: { update: mock(() => Promise.resolve({})) },
    },
    operator: {
      providers: { list: mock(() => Promise.resolve([])) },
      models: {
        list: mock(() => Promise.resolve({})),
        current: { get: mock(() => Promise.resolve({})) },
      },
      sessions: { toolCalls: { cancel: mock(() => Promise.resolve({ cancelled: true })) } },
    },
  },
}));

const { ChatView } = await import('./ChatView');

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const SESSION_A = { id: 'session-a', title: 'Session A' };
const SESSION_B = { id: 'session-b', title: 'Session B' };

function noop(): void {}

function baseProps(activeSessionId: string): ChatViewProps {
  return {
    activeSessionId,
    sessionItems: [SESSION_A, SESSION_B],
    onActiveSessionChange: noop,
    onDraftSessionRequestedChange: noop,
    onLocalSessionCreated: noop,
    onLocalSessionUpdated: noop,
    onSessionMissing: noop,
  };
}

let container: HTMLElement;
let root: Root;
let client: QueryClient;

function renderChatView(props: ChatViewProps): void {
  flushSync(() => {
    root.render(
      React.createElement(QueryClientProvider, { client }, React.createElement(ChatView, props)),
    );
  });
}

function badgeText(): string | null {
  return container.querySelector('.badge')?.textContent ?? null;
}

function composerErrorText(): string | null {
  return container.querySelector('.composer-error')?.textContent ?? null;
}

/**
 * flushSync forces a synchronous render + layout-effect flush, but NOT passive
 * effects (useEffect callbacks are scheduled via the Scheduler and run in a
 * later microtask/macrotask even inside flushSync). The session-switch reset
 * lives in a useEffect, so give it real ticks to run, same pattern as
 * ProvidersView.test.tsx's waitFor.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync(() => {});
  }
}

beforeEach(() => {
  streamCalls.length = 0;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  flushSync(() => root.unmount());
  if (container.parentNode) container.parentNode.removeChild(container);
});

describe('ChatView: turn lifecycle resets atomically on session switch', () => {
  test('a terminal turnState from a stream error in session A does not bleed into session B', async () => {
    renderChatView(baseProps(SESSION_A.id));
    await waitFor(() => streamCalls.some((call) => call.sessionId === SESSION_A.id));

    const callForA = streamCalls.find((call) => call.sessionId === SESSION_A.id);
    expect(callForA).toBeDefined();

    // A live turn.error event lands for session A: turnState -> 'error',
    // turnError -> the message. Both wrapped in one act() via flushSync.
    flushSync(() => {
      callForA?.options.onEvent('companion-chat.turn.error', {
        sessionId: SESSION_A.id,
        type: 'turn.error',
        error: 'the daemon lost the connection',
      });
    });

    expect(badgeText()).toBe('error');
    expect(composerErrorText()).toBe('the daemon lost the connection');

    // Session switch: a PROP change on the same mounted instance, exactly how
    // App.tsx drives ChatView (no key={activeSessionId}, so component state is
    // NOT reset by a remount — the reset has to come from the fix itself).
    renderChatView(baseProps(SESSION_B.id));
    await waitFor(() => streamCalls.some((call) => call.sessionId === SESSION_B.id));
    // The reset effect's setTurn(IDLE_TURN_PHASE) is a second-order update fired
    // FROM a passive effect: flushSync flushes the render and that first round of
    // effects, but the re-render this setTurn call schedules lands on a later
    // tick, so wait on the actual outcome rather than on the effect having merely
    // started.
    await waitFor(() => badgeText() === null);

    // The stale 'error' badge and its message must not survive into session B,
    // which has done nothing. Before the fix, turnState stayed 'error' here
    // (only turnError was cleared by useChatStream's per-session effect).
    expect(badgeText()).toBeNull();
    expect(composerErrorText()).toBeNull();
  });
});
