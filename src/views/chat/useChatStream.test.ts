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
}

let activeStreamControl: StreamControl | null = null;

// Mock the SDK module
mock.module('../../lib/goodvibes', () => ({
  sdk: {
    chat: {
      events: {
        stream: mock(
          (_sessionId: string, options: StreamOptions): Promise<StreamDisconnect> => {
            const disconnect = mock(() => {});
            const promise = new Promise<StreamDisconnect>((resolve, reject) => {
              activeStreamControl = { resolveFn: resolve, rejectFn: reject, disconnect, options };
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
  onResult: (result: UseChatStreamResult) => void;
}

function HookOwner({ activeSessionId, turnState, setTurnState, onResult }: HookOwnerProps): null {
  const liveTextRef = createRef<string>() as React.RefObject<string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (liveTextRef as any).current = '';

  const result = useChatStream({
    activeSessionId,
    liveTextRef,
    turnState,
    setTurnState,
    setTurnError: mock(() => {}),
    setLiveText: mock(() => {}),
    setLocalMessages: mock(
      (_fn: SetStateAction<LocalCompanionMessage[]>) => {},
    ),
    setPendingUserMessageId: mock(() => {}),
    invalidateChatState: mock(() => Promise.resolve()),
    onSessionMissing: mock(() => {}),
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
}: {
  activeSessionId?: string;
  initialTurnState?: string;
} = {}) {
  let result!: UseChatStreamResult;
  let currentTurnState = initialTurnState;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const setTurnState: Dispatch<SetStateAction<string>> = (next) => {
    currentTurnState = typeof next === 'function' ? next(currentTurnState) : next;
    flushSync(() => {
      root.render(
        React.createElement(HookOwner, {
          activeSessionId,
          turnState: currentTurnState,
          setTurnState,
          onResult: (r: UseChatStreamResult) => { result = r; },
        }),
      );
    });
  };

  const rerender = (turnState: string) => {
    currentTurnState = turnState;
    flushSync(() => {
      root.render(
        React.createElement(HookOwner, {
          activeSessionId,
          turnState,
          setTurnState,
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
        onResult: (r: UseChatStreamResult) => { result = r; },
      }),
    );
  });

  return {
    get result() { return result; },
    rerender,
    get turnState() { return currentTurnState; },
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
});

afterEach(() => {
  activeStreamControl = null;
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

    flushSync(() => {
      root.render(
        React.createElement(HookOwner, {
          activeSessionId,
          turnState: 'streaming',
          setTurnState,
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
