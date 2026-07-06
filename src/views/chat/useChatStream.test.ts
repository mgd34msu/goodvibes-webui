/**
 * Unit tests for useChatStream.
 *
 * Tests:
 * 1. isStreaming derives from turnState prop across all active states
 * 2. isStreaming is false for non-active states (idle, completed, error)
 * 3. isStreaming is false when turnState is omitted (defaults to 'idle')
 * 4. isStreaming is true during sending/submitted window (before first delta)
 * 5. stop() disconnects the stream and is idempotent
 * 6. stop() before .then resolves does NOT revive the subscription (race fix)
 *
 * Uses a manual renderHook pattern (createRoot + flushSync) matching the
 * project's DOM test convention (toast.dom.test.tsx).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import React, { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { UseChatStreamResult } from './useChatStream';
import { useChatStream } from './useChatStream';
import type { LocalCompanionMessage } from '../../lib/companion-chat';
import type { Dispatch, SetStateAction } from 'react';

// ---------------------------------------------------------------------------
// Mock sdk.chat.events.stream
// ---------------------------------------------------------------------------

type StreamDisconnect = () => void;
interface StreamOptions {
  onEvent: (eventName: string, payload: unknown) => void;
  onError: (error: unknown) => void;
  onReady?: () => void;
  onReconnect?: (input: { attempt: number; delayMs: number }) => void;
  onTerminate?: (input: { error: unknown; reconnectAttempts: number }) => void;
}
interface StreamOpenOptions {
  reconnect?: { enabled?: boolean; maxAttempts?: number };
}

/**
 * Controls for the mock stream:
 * - resolveFn: call to deliver the disconnect handle (resolves the .then)
 * - rejectFn: call to reject the stream promise
 * - disconnect: the mock disconnect fn (tracks call count)
 */
interface StreamControl {
  resolveFn: (disconnect: StreamDisconnect) => void;
  rejectFn: (err: unknown) => void;
  disconnect: ReturnType<typeof mock>;
  options: StreamOptions;
  openOptions: StreamOpenOptions | undefined;
}

let activeStreamControl: StreamControl | null = null;
// Every stream() opened this test, in order — the epoch/handshake-race tests need to
// hold BOTH the superseded stream and its successor at once (activeStreamControl only
// tracks the most recent).
let allStreamControls: StreamControl[] = [];
let streamCallCount = 0;

// Mock the SDK module
mock.module('../../lib/goodvibes', () => ({
  DEFAULT_SSE_RECONNECT: { enabled: true, baseDelayMs: 1_000, maxDelayMs: 30_000, backoffFactor: 2, maxAttempts: 10 },
  sdk: {
    chat: {
      events: {
        stream: mock(
          (_sessionId: string, options: StreamOptions, openOptions?: StreamOpenOptions): Promise<StreamDisconnect> => {
            streamCallCount += 1;
            const disconnect = mock(() => {});
            const promise = new Promise<StreamDisconnect>((resolve, reject) => {
              activeStreamControl = { resolveFn: resolve, rejectFn: reject, disconnect, options, openOptions };
              allStreamControls.push(activeStreamControl);
            });
            return promise;
          },
        ),
      },
    },
  },
}));

// ---------------------------------------------------------------------------
// Hook owner component
// ---------------------------------------------------------------------------

interface HookOwnerProps {
  activeSessionId: string;
  turnState?: string;
  setTurnState: Dispatch<SetStateAction<string>>;
  setTurnError: Dispatch<SetStateAction<string>>;
  onAuthExpired: () => void;
  onResult: (result: UseChatStreamResult) => void;
}

function HookOwner({ activeSessionId, turnState, setTurnState, setTurnError, onAuthExpired, onResult }: HookOwnerProps): null {
  // Stable across re-renders — matching the real caller (ChatView), where these are
  // useState setters / useCallback / a ref and therefore identity-stable. Creating fresh
  // mocks per render would make them change every render and spuriously re-run the
  // connect effect (a new SSE stream on every setTurnState), which is NOT how the hook
  // behaves in production and would mask the epoch/handshake behaviour under test.
  // Built via useMemo (not useRef) so nothing reads a hook ref's `.current` during render.
  const stable = React.useMemo(() => {
    const liveTextRef = createRef<string>() as React.RefObject<string>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (liveTextRef as any).current = '';
    return {
      liveTextRef,
      setLiveText: mock(() => {}),
      setLocalMessages: mock((_fn: SetStateAction<LocalCompanionMessage[]>) => {}),
      setPendingUserMessageId: mock(() => {}),
      invalidateChatState: mock(() => Promise.resolve()),
      onSessionMissing: mock(() => {}),
    };
  }, []);

  const result = useChatStream({
    activeSessionId,
    liveTextRef: stable.liveTextRef,
    turnState,
    setTurnState,
    setTurnError,
    setLiveText: stable.setLiveText,
    setLocalMessages: stable.setLocalMessages,
    setPendingUserMessageId: stable.setPendingUserMessageId,
    invalidateChatState: stable.invalidateChatState,
    onSessionMissing: stable.onSessionMissing,
    onAuthExpired,
  });

  React.useLayoutEffect(() => {
    onResult(result);
  });

  return null;
}

// ---------------------------------------------------------------------------
// renderHook helper
// ---------------------------------------------------------------------------

function renderHookHelper({
  activeSessionId = 'session-1',
  initialTurnState = 'idle',
  onAuthExpired = () => {},
}: {
  activeSessionId?: string;
  initialTurnState?: string;
  onAuthExpired?: () => void;
} = {}) {
  let result!: UseChatStreamResult;
  let currentTurnState = initialTurnState;
  let currentTurnError = '';
  const turnStates: string[] = [];
  const turnErrors: string[] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const setTurnState: Dispatch<SetStateAction<string>> = (next) => {
    currentTurnState = typeof next === 'function' ? next(currentTurnState) : next;
    turnStates.push(currentTurnState);
    flushSync(() => {
      root.render(
        React.createElement(HookOwner, {
          activeSessionId,
          turnState: currentTurnState,
          setTurnState,
          setTurnError,
          onAuthExpired,
          onResult: (r: UseChatStreamResult) => { result = r; },
        }),
      );
    });
  };

  const setTurnError: Dispatch<SetStateAction<string>> = (next) => {
    currentTurnError = typeof next === 'function' ? next(currentTurnError) : next;
    turnErrors.push(currentTurnError);
  };

  const rerender = (turnState: string) => {
    currentTurnState = turnState;
    flushSync(() => {
      root.render(
        React.createElement(HookOwner, {
          activeSessionId,
          turnState,
          setTurnState,
          setTurnError,
          onAuthExpired,
          onResult: (r: UseChatStreamResult) => { result = r; },
        }),
      );
    });
  };

  flushSync(() => {
    root.render(
      React.createElement(HookOwner, {
        activeSessionId,
        turnState: initialTurnState,
        setTurnState,
        setTurnError,
        onAuthExpired,
        onResult: (r: UseChatStreamResult) => { result = r; },
      }),
    );
  });

  return {
    get result() { return result; },
    rerender,
    get turnState() { return currentTurnState; },
    get turnStates() { return turnStates; },
    get turnError() { return currentTurnError; },
    get turnErrors() { return turnErrors; },
    unmount: () => {
      flushSync(() => { root.unmount(); });
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  activeStreamControl = null;
  allStreamControls = [];
  streamCallCount = 0;
});

afterEach(() => {
  activeStreamControl = null;
  allStreamControls = [];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useChatStream — isStreaming derivation from turnState prop', () => {
  test('isStreaming is false when turnState is omitted (defaults to idle)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    let result!: UseChatStreamResult;

    flushSync(() => {
      root.render(
        React.createElement(HookOwner, {
          activeSessionId: '',
          // turnState intentionally omitted
          setTurnState: mock(() => {}),
          setTurnError: mock(() => {}),
          onAuthExpired: mock(() => {}),
          onResult: (r: UseChatStreamResult) => { result = r; },
        }),
      );
    });

    expect(result.isStreaming).toBe(false);

    flushSync(() => { root.unmount(); });
    if (container.parentNode) container.parentNode.removeChild(container);
  });

  test('isStreaming is false for idle state', () => {
    const { result, unmount } = renderHookHelper({ activeSessionId: '', initialTurnState: 'idle' });
    expect(result.isStreaming).toBe(false);
    unmount();
  });

  test('isStreaming is false for completed state', () => {
    const { result, unmount } = renderHookHelper({ activeSessionId: '', initialTurnState: 'completed' });
    expect(result.isStreaming).toBe(false);
    unmount();
  });

  test('isStreaming is false for error state', () => {
    const { result, unmount } = renderHookHelper({ activeSessionId: '', initialTurnState: 'error' });
    expect(result.isStreaming).toBe(false);
    unmount();
  });

  test('isStreaming is true for sending (pre-token window)', () => {
    const { result, unmount } = renderHookHelper({ activeSessionId: '', initialTurnState: 'sending' });
    expect(result.isStreaming).toBe(true);
    unmount();
  });

  test('isStreaming is true for submitted (pre-token window)', () => {
    const { result, unmount } = renderHookHelper({ activeSessionId: '', initialTurnState: 'submitted' });
    expect(result.isStreaming).toBe(true);
    unmount();
  });

  test('isStreaming is true for running state', () => {
    const { result, unmount } = renderHookHelper({ activeSessionId: '', initialTurnState: 'running' });
    expect(result.isStreaming).toBe(true);
    unmount();
  });

  test('isStreaming is true for streaming state', () => {
    const { result, unmount } = renderHookHelper({ activeSessionId: '', initialTurnState: 'streaming' });
    expect(result.isStreaming).toBe(true);
    unmount();
  });

  test('isStreaming is true for tooling state', () => {
    const { result, unmount } = renderHookHelper({ activeSessionId: '', initialTurnState: 'tooling' });
    expect(result.isStreaming).toBe(true);
    unmount();
  });

  test('isStreaming updates reactively when turnState prop changes', () => {
    const ctx = renderHookHelper({ activeSessionId: '', initialTurnState: 'idle' });
    expect(ctx.result.isStreaming).toBe(false);

    ctx.rerender('streaming');
    expect(ctx.result.isStreaming).toBe(true);

    ctx.rerender('idle');
    expect(ctx.result.isStreaming).toBe(false);

    ctx.unmount();
  });
});

describe('useChatStream — stop() correctness', () => {
  /**
   * For stop() tests we use a simple non-reactive setTurnState mock to avoid
   * nested flushSync (stop() → setTurnState → flushSync(render) inside outer
   * flushSync would throw in React 19).
   */
  function renderForStop(activeSessionId: string) {
    let result!: UseChatStreamResult;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    // Simple mock: does not re-render, avoids nested flushSync
    const setTurnState = mock((_next: SetStateAction<string>) => {});
    const setTurnError = mock((_next: SetStateAction<string>) => {});

    flushSync(() => {
      root.render(
        React.createElement(HookOwner, {
          activeSessionId,
          turnState: 'streaming',
          setTurnState,
          setTurnError,
          onAuthExpired: mock(() => {}),
          onResult: (r: UseChatStreamResult) => { result = r; },
        }),
      );
    });

    return {
      get result() { return result; },
      unmount: () => {
        flushSync(() => { root.unmount(); });
        if (container.parentNode) container.parentNode.removeChild(container);
      },
    };
  }

  test('stop() calls disconnect and is idempotent', async () => {
    const { result, unmount } = renderForStop('session-stop');
    const ctrl = activeStreamControl;
    expect(ctrl).not.toBeNull();

    // Deliver disconnect handle
    const disconnectFn = ctrl!.disconnect;
    ctrl!.resolveFn(disconnectFn);
    await Promise.resolve();
    await Promise.resolve();

    // First stop call
    result.stop();
    expect(disconnectFn).toHaveBeenCalledTimes(1);

    // Second stop call — disconnectRef was set to undefined, so no-op on disconnect
    result.stop();
    expect(disconnectFn).toHaveBeenCalledTimes(1); // not called again

    unmount();
  });

  test('stop() before .then resolves prevents subscription revival (race fix)', async () => {
    const { result, unmount } = renderForStop('session-race');
    const ctrl = activeStreamControl;
    expect(ctrl).not.toBeNull();

    const disconnectFn = ctrl!.disconnect;

    // Call stop() BEFORE .then resolves — disconnectRef.current is still undefined
    result.stop();

    // Resolve the stream promise — .then must detect stoppedRef=true and call nextDisconnect()
    ctrl!.resolveFn(disconnectFn);
    await Promise.resolve();
    await Promise.resolve();

    // The .then path must call nextDisconnect() when stoppedRef is true
    expect(disconnectFn).toHaveBeenCalledTimes(1);

    unmount();
  });

  test('stop() before .then resolves does NOT store disconnectRef (no revived subscription)', async () => {
    const { result, unmount } = renderForStop('session-norevive');
    const ctrl = activeStreamControl;
    expect(ctrl).not.toBeNull();

    const disconnectFn = ctrl!.disconnect;

    // stop() before resolve
    result.stop();

    // Resolve and drain microtasks
    ctrl!.resolveFn(disconnectFn);
    await Promise.resolve();
    await Promise.resolve();

    // disconnect was called once (by the .then guard)
    expect(disconnectFn).toHaveBeenCalledTimes(1);

    // Call stop() again — disconnectRef was never stored, so this is a no-op on disconnect
    result.stop();
    expect(disconnectFn).toHaveBeenCalledTimes(1);

    unmount();
  });
});

// ---------------------------------------------------------------------------
// Resilience: reconnecting / stream paused / session expired / retry
// ---------------------------------------------------------------------------

describe('useChatStream — reconnect passed to the SDK', () => {
  test('opens the stream with DEFAULT_SSE_RECONNECT so a drop actually retries', () => {
    const ctx = renderHookHelper({ activeSessionId: 'session-reconnect-opt' });
    const ctrl = activeStreamControl;
    expect(ctrl).not.toBeNull();
    expect(ctrl!.openOptions?.reconnect?.enabled).toBe(true);
    expect(ctrl!.openOptions?.reconnect?.maxAttempts).toBe(10);
    ctx.unmount();
  });
});

describe('useChatStream — onReconnect: a daemon blip / SSE drop is honest, not a dead "stream error"', () => {
  test('onReconnect sets turnState to "reconnecting" with an attempt-count message', () => {
    const ctx = renderHookHelper({ activeSessionId: 'session-drop', initialTurnState: 'streaming' });
    const ctrl = activeStreamControl;
    expect(ctrl).not.toBeNull();

    ctrl!.options.onReconnect?.({ attempt: 2, delayMs: 4000 });

    expect(ctx.turnState).toBe('reconnecting');
    expect(ctx.turnError).toContain('attempt 2 of 10');
    // 'reconnecting' must count as an active turn state (Stop stays meaningful, the
    // 1s message-poll fallback keeps running) — never collapse to a dead stream error.
    expect(ctx.turnState).not.toBe('stream error');

    ctx.unmount();
  });

  test('"reconnecting" keeps isStreaming true (a mid-turn drop does not look "stopped")', () => {
    const ctx = renderHookHelper({ activeSessionId: 'session-drop-2', initialTurnState: 'reconnecting' });
    expect(ctx.result.isStreaming).toBe(true);
    ctx.unmount();
  });

  test('onReady after a drop clears the reconnecting message and moves on to "syncing"', () => {
    const ctx = renderHookHelper({ activeSessionId: 'session-recover' });
    const ctrl = activeStreamControl;
    expect(ctrl).not.toBeNull();

    ctrl!.options.onReconnect?.({ attempt: 1, delayMs: 1000 });
    expect(ctx.turnState).toBe('reconnecting');

    ctrl!.options.onReady?.();
    expect(ctx.turnState).toBe('syncing');
    expect(ctx.turnError).toBe('');

    ctx.unmount();
  });

  test('a genuine turn error mid-reconnect is NOT clobbered by onReady', () => {
    // onReady's functional updater only clears 'reconnecting' specifically — a
    // concurrent genuine 'error' (turn.error event) must survive.
    const ctx = renderHookHelper({ activeSessionId: 'session-guard' });
    const ctrl = activeStreamControl;
    expect(ctrl).not.toBeNull();

    ctrl!.options.onReconnect?.({ attempt: 1, delayMs: 1000 });
    ctrl!.options.onEvent('companion-chat.turn.error', { sessionId: 'session-guard', type: 'turn.error', error: 'boom' });
    expect(ctx.turnState).toBe('error');

    ctrl!.options.onReady?.();
    // Must stay 'error' — onReady only resets when turnState is still 'reconnecting'.
    expect(ctx.turnState).toBe('error');

    ctx.unmount();
  });
});

describe('useChatStream — onTerminate: the built-in reconnect gave up ("stream paused")', () => {
  test('onTerminate sets turnState to "stream paused" and isStreaming goes false', () => {
    const ctx = renderHookHelper({ activeSessionId: 'session-terminate', initialTurnState: 'streaming' });
    const ctrl = activeStreamControl;
    expect(ctrl).not.toBeNull();

    ctrl!.options.onTerminate?.({ error: new Error('boom'), reconnectAttempts: 10 });

    expect(ctx.turnState).toBe('stream paused');
    expect(ctx.turnError).toContain('10 reconnect attempts');
    expect(ctx.result.isStreaming).toBe(false);

    ctx.unmount();
  });

  test('the paired onError call right after onTerminate does not overwrite "stream paused"', () => {
    const ctx = renderHookHelper({ activeSessionId: 'session-terminate-2' });
    const ctrl = activeStreamControl;
    expect(ctrl).not.toBeNull();

    // Real SDK wiring: onReconnect fires for every attempt, THEN onTerminate +
    // onError both fire once attempts are exhausted (see sse-stream.js: onTerminate
    // is always called, then reportStreamError calls onError with the same error).
    ctrl!.options.onReconnect?.({ attempt: 10, delayMs: 30_000 });
    ctrl!.options.onTerminate?.({ error: new Error('boom'), reconnectAttempts: 10 });
    ctrl!.options.onError(new Error('boom'));

    expect(ctx.turnState).toBe('stream paused');

    ctx.unmount();
  });
});

describe('useChatStream — token expiry mid-session hands off, never loops', () => {
  test('a 401 on the first connect (before ever succeeding) hands off instead of "stream error"', () => {
    const onAuthExpired = mock(() => {});
    const ctx = renderHookHelper({ activeSessionId: 'session-expired-first', onAuthExpired });
    const ctrl = activeStreamControl;
    expect(ctrl).not.toBeNull();

    ctrl!.rejectFn(Object.assign(new Error('Unauthorized'), { category: 'authentication' }));

    return Promise.resolve().then(() => Promise.resolve()).then(() => {
      expect(onAuthExpired).toHaveBeenCalledTimes(1);
      expect(ctx.turnState).toBe('session expired');
      expect(ctx.turnState).not.toBe('stream error');
      ctx.unmount();
    });
  });

  test('a 401 mid-stream (via onError, paired with onReconnect) hands off and stops retrying', () => {
    const onAuthExpired = mock(() => {});
    const ctx = renderHookHelper({ activeSessionId: 'session-expired-mid', onAuthExpired });
    const ctrl = activeStreamControl;
    expect(ctrl).not.toBeNull();

    // Successful first connect — resolve so disconnectRef is populated (the auth-expiry
    // handler calls disconnectRef.current?.() to stop the built-in retry loop early).
    ctrl!.resolveFn(ctrl!.disconnect);

    return Promise.resolve().then(() => Promise.resolve()).then(() => {
      const authError = Object.assign(new Error('Unauthorized'), { category: 'authentication' });
      ctrl!.options.onReconnect?.({ attempt: 1, delayMs: 1000 });
      ctrl!.options.onError(authError);

      expect(onAuthExpired).toHaveBeenCalledTimes(1);
      expect(ctx.turnState).toBe('session expired');
      // The retry loop must be told to stop — not left burning attempts on a dead token.
      expect(ctrl!.disconnect).toHaveBeenCalled();

      // A further paired onError call (defensive — the real SDK never double-fires
      // for one failure) must not re-invoke the handoff a second time.
      ctrl!.options.onError(authError);
      expect(onAuthExpired).toHaveBeenCalledTimes(1);

      ctx.unmount();
    });
  });

  test('onTerminate carrying an auth error hands off to "session expired", not "stream paused"', () => {
    const onAuthExpired = mock(() => {});
    const ctx = renderHookHelper({ activeSessionId: 'session-expired-terminate', onAuthExpired });
    const ctrl = activeStreamControl;
    expect(ctrl).not.toBeNull();

    const authError = Object.assign(new Error('Unauthorized'), { category: 'authentication' });
    ctrl!.options.onTerminate?.({ error: authError, reconnectAttempts: 10 });

    expect(onAuthExpired).toHaveBeenCalledTimes(1);
    expect(ctx.turnState).toBe('session expired');
    expect(ctx.turnState).not.toBe('stream paused');

    ctx.unmount();
  });

  test('"session expired" is NOT an active turn state — isStreaming goes false', () => {
    const ctx = renderHookHelper({ activeSessionId: 'session-expired-active', initialTurnState: 'session expired' });
    expect(ctx.result.isStreaming).toBe(false);
    ctx.unmount();
  });
});

describe('useChatStream — retryStream() re-opens after "stream paused"', () => {
  test('calling retryStream triggers a fresh sdk.chat.events.stream connect', () => {
    const ctx = renderHookHelper({ activeSessionId: 'session-retry' });
    expect(streamCallCount).toBe(1);

    flushSync(() => { ctx.result.retryStream(); });
    expect(streamCallCount).toBe(2);

    ctx.unmount();
  });
});

// ---------------------------------------------------------------------------
// Per-effect epoch: a switch/retry DURING the handshake window (the SDK stream()
// promise only yields its disconnect handle post-handshake) must not let the OLD
// stream's late callbacks or late-resolving handle touch the NEW session (F1).
// ---------------------------------------------------------------------------

describe('useChatStream — session switch / retry mid-handshake is inert (epoch guard)', () => {
  /** Non-reactive render harness that can swap activeSessionId without nested flushSync. */
  function renderForSwitch(initialSessionId: string) {
    let result!: UseChatStreamResult;
    const turnStates: string[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const setTurnState = mock((next: SetStateAction<string>) => {
      turnStates.push(typeof next === 'function' ? next('streaming') : next);
    });
    const setTurnError = mock((_next: SetStateAction<string>) => {});

    function renderWith(sessionId: string) {
      flushSync(() => {
        root.render(
          React.createElement(HookOwner, {
            activeSessionId: sessionId,
            turnState: 'streaming',
            setTurnState,
            setTurnError,
            onAuthExpired: mock(() => {}),
            onResult: (r: UseChatStreamResult) => { result = r; },
          }),
        );
      });
    }

    renderWith(initialSessionId);

    return {
      get result() { return result; },
      renderWith,
      get turnStates() { return turnStates; },
      unmount: () => {
        flushSync(() => { root.unmount(); });
        if (container.parentNode) container.parentNode.removeChild(container);
      },
    };
  }

  test('switching sessions mid-handshake: the old stream is inert, its late handle is disconnected and never stored, the new session is untouched', async () => {
    const h = renderForSwitch('session-A');
    const ctrlA = allStreamControls[0];
    expect(ctrlA).toBeDefined();
    // ctrlA has NOT resolved — we are inside its handshake window.

    // Switch to session B while A is still handshaking.
    h.renderWith('session-B');
    const ctrlB = allStreamControls[1];
    expect(ctrlB).toBeDefined();
    expect(ctrlB).not.toBe(ctrlA);

    // Every late callback from the stale stream A must be a no-op now.
    const writesBefore = h.turnStates.length;
    ctrlA!.options.onReconnect?.({ attempt: 1, delayMs: 1000 });
    ctrlA!.options.onEvent('companion-chat.turn.delta', { sessionId: 'session-A', type: 'turn.delta', delta: 'stale' });
    ctrlA!.options.onError(new Error('late error from A'));
    ctrlA!.options.onTerminate?.({ error: new Error('late terminate from A'), reconnectAttempts: 3 });
    expect(h.turnStates.length).toBe(writesBefore);
    expect(h.turnStates).not.toContain('reconnecting');
    expect(h.turnStates).not.toContain('stream paused');

    // New stream B resolves first → its handle is the live one.
    ctrlB!.resolveFn(ctrlB!.disconnect);
    await Promise.resolve();
    await Promise.resolve();

    // Stale stream A resolves LATE → its handle must be disconnected immediately and
    // NEVER stored into the shared disconnectRef.
    ctrlA!.resolveFn(ctrlA!.disconnect);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctrlA!.disconnect).toHaveBeenCalledTimes(1);

    // Proof the live handle is B's, not A's: stop() disconnects B (A stays at 1).
    h.result.stop();
    expect(ctrlB!.disconnect).toHaveBeenCalledTimes(1);
    expect(ctrlA!.disconnect).toHaveBeenCalledTimes(1);

    h.unmount();
  });

  test('retryStream mid-handshake: the superseded stream is inert and its late handle is discarded', async () => {
    const ctx = renderHookHelper({ activeSessionId: 'session-retry-race' });
    const ctrlA = allStreamControls[0];
    expect(streamCallCount).toBe(1);

    // Retry BEFORE ctrlA resolves — a fresh connect supersedes it mid-handshake.
    flushSync(() => { ctx.result.retryStream(); });
    expect(streamCallCount).toBe(2);
    const ctrlB = allStreamControls[1];
    expect(ctrlB).not.toBe(ctrlA);

    // The superseded stream A must not move turn state.
    ctrlA!.options.onReconnect?.({ attempt: 1, delayMs: 1000 });
    expect(ctx.turnState).not.toBe('reconnecting');

    // B resolves and becomes live; A resolves late and is discarded + disconnected.
    ctrlB!.resolveFn(ctrlB!.disconnect);
    await Promise.resolve();
    await Promise.resolve();
    ctrlA!.resolveFn(ctrlA!.disconnect);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctrlA!.disconnect).toHaveBeenCalledTimes(1);

    ctx.result.stop();
    expect(ctrlB!.disconnect).toHaveBeenCalledTimes(1);
    expect(ctrlA!.disconnect).toHaveBeenCalledTimes(1);

    ctx.unmount();
  });
});
