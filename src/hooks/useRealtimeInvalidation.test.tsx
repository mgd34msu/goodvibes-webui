/**
 * useRealtimeInvalidation — the connection-budget regression test.
 *
 * The bug this pins: the hook used to open ONE SSE connection PER domain (five of them)
 * via sdk.realtime.viaSse(). Together with useSessionRealtime's own stream that reached
 * six long-lived connections and saturated the browser's per-origin socket pool, so the
 * next fetch (SessionsView's sessions.list) hung forever and the Sessions view rendered
 * zero rows. The fix opens a SINGLE multiplexed raw stream (?domains=a,b,c) and routes by
 * the frame's event name (the domain). These tests assert exactly ONE stream is opened,
 * that it carries every invalidated domain, and that each domain frame invalidates the
 * right query keys.
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ServerSentEventHandlers } from '@pellux/goodvibes-transport-http';

let capturedHandlers: ServerSentEventHandlers | null = null;
const openCalls: string[] = [];

mock.module('../lib/goodvibes', () => ({
  DEFAULT_SSE_RECONNECT: { enabled: true, baseDelayMs: 1, maxDelayMs: 2, backoffFactor: 2, maxAttempts: 3 },
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  sdk: {
    streams: {
      open: (pathOrUrl: string, handlers: ServerSentEventHandlers) => {
        openCalls.push(pathOrUrl);
        capturedHandlers = handlers;
        return Promise.resolve(() => {});
      },
    },
  },
}));

const { useRealtimeInvalidation } = await import('./useRealtimeInvalidation');

function renderHook(): { invalidate: ReturnType<typeof mock>; unmount: () => void } {
  const client = new QueryClient();
  const invalidate = mock(() => Promise.resolve());
  (client as unknown as { invalidateQueries: unknown }).invalidateQueries = invalidate;

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  function Harness() {
    useRealtimeInvalidation(true);
    return null;
  }

  flushSync(() => {
    root.render(
      React.createElement(QueryClientProvider, { client }, React.createElement(Harness)),
    );
  });

  return {
    invalidate,
    unmount: () => {
      flushSync(() => root.unmount());
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

function invalidatedKeys(invalidate: ReturnType<typeof mock>): unknown[] {
  return invalidate.mock.calls.map((call) => (call[0] as { queryKey: unknown }).queryKey);
}

afterEach(() => {
  capturedHandlers = null;
  openCalls.length = 0;
});

describe('useRealtimeInvalidation', () => {
  test('opens EXACTLY ONE multiplexed control-plane stream, not one per domain', () => {
    const { unmount } = renderHook();
    expect(openCalls.length).toBe(1);
    expect(openCalls[0]).toContain('/api/control-plane/events');
    // Every invalidated domain rides the single stream.
    for (const domain of ['tasks', 'permissions', 'providers', 'knowledge', 'control-plane']) {
      expect(openCalls[0]).toContain(domain);
    }
    unmount();
  });

  test('a `tasks` domain frame invalidates the tasks query', () => {
    const { invalidate, unmount } = renderHook();
    capturedHandlers?.onEvent?.('tasks', { payload: { type: 'TASK_UPDATED' } });
    expect(invalidatedKeys(invalidate)).toEqual([['tasks']]);
    unmount();
  });

  test('a `permissions` frame invalidates approvals; `providers` invalidates providers', () => {
    const { invalidate, unmount } = renderHook();
    capturedHandlers?.onEvent?.('permissions', {});
    capturedHandlers?.onEvent?.('providers', {});
    expect(invalidatedKeys(invalidate)).toEqual([['approvals'], ['providers']]);
    unmount();
  });

  test('a `knowledge` frame invalidates all three knowledge query keys', () => {
    const { invalidate, unmount } = renderHook();
    capturedHandlers?.onEvent?.('knowledge', {});
    expect(invalidatedKeys(invalidate)).toEqual([
      ['knowledge', 'status'],
      ['knowledge', 'sources'],
      ['knowledge', 'refinement'],
    ]);
    unmount();
  });

  test('a `control-plane` frame invalidates the control snapshot', () => {
    const { invalidate, unmount } = renderHook();
    capturedHandlers?.onEvent?.('control-plane', {});
    expect(invalidatedKeys(invalidate)).toEqual([['control', 'snapshot']]);
    unmount();
  });

  test('an unknown domain frame is ignored (no invalidation)', () => {
    const { invalidate, unmount } = renderHook();
    capturedHandlers?.onEvent?.('session', {});
    capturedHandlers?.onEvent?.('heartbeat', {});
    expect(invalidate).not.toHaveBeenCalled();
    unmount();
  });
});
