/**
 * FleetView — rendering from a mocked fleet.snapshot, covering the honesty
 * markers: true-empty vs a populated fleet, the truncated-snapshot cap note,
 * an unknown future kind/state rendered verbatim, and error+retry.
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let snapshotImpl: () => Promise<unknown> = () => Promise.resolve(FIXTURE_SNAPSHOT);
let approvalsImpl: () => Promise<unknown> = () => Promise.resolve({ approvals: [] });

/** Every operator call this test file's mocked sdk records, in invocation order. */
const calls: { steer: unknown[]; detach: unknown[]; watchersStop: unknown[] } = { steer: [], detach: [], watchersStop: [] };

mock.module('../../lib/goodvibes', () => ({
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  WEBUI_SURFACE_ID: 'goodvibes-webui',
  WEBUI_SURFACE_KIND: 'webui',
  sdk: {
    operator: {
      fleet: {
        snapshot: () => snapshotImpl(),
        list: () => Promise.resolve({ items: [], hasMore: false, capturedAt: Date.now() }),
      },
      approvals: {
        list: () => approvalsImpl(),
        approve: () => Promise.resolve({ approval: {} }),
        deny: () => Promise.resolve({ approval: {} }),
        claim: () => Promise.resolve({ approval: {} }),
        cancel: () => Promise.resolve({ approval: {} }),
      },
      sessions: {
        steer: (sessionId: string, input: unknown) => {
          calls.steer.push({ sessionId, input });
          return Promise.resolve({});
        },
        detach: (sessionId: string, surfaceId: string) => {
          calls.detach.push({ sessionId, surfaceId });
          return Promise.resolve({});
        },
      },
      watchers: {
        stop: (watcherId: string) => {
          calls.watchersStop.push({ watcherId });
          return Promise.resolve({ id: watcherId, kind: 'watcher', label: 'stopped', state: 'killed' });
        },
      },
    },
  },
}));

const { FleetView } = await import('./FleetView');
const { queryKeys } = await import('../../lib/queries');
const { ToastProvider } = await import('../../lib/toast');

const FIXTURE_SNAPSHOT = {
  capturedAt: 1000,
  truncated: false,
  totalCount: 4,
  nodes: [
    {
      id: 'root-agent', kind: 'agent', label: 'Root agent', state: 'thinking', elapsedMs: 5000,
      startedAt: 100, costUsd: 0.42, costState: 'priced',
      capabilities: { interruptible: true, killable: true, pausable: false, resumable: false, steerable: true },
      usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, llmCallCount: 1, turnCount: 1, toolCallCount: 0 },
      sessionRef: { sessionId: 's-agent-live', agentId: 'root-agent' },
    },
    {
      id: 'child-task', kind: 'wrfc-subtask', parentId: 'root-agent', label: 'Child subtask', state: 'executing-tool',
      elapsedMs: 2000, startedAt: 90, costUsd: null, costState: 'unpriced',
      capabilities: { interruptible: true, killable: true, pausable: false, resumable: false, steerable: false },
    },
    {
      id: 'future-node', kind: 'quantum-process', label: 'Future kind node', state: 'quantum-state', elapsedMs: 1000,
      startedAt: 80, costUsd: null, costState: 'unpriced',
      capabilities: { interruptible: false, killable: false, pausable: false, resumable: false, steerable: false },
    },
    {
      id: 'watcher-1', kind: 'watcher', label: 'Doc watcher', state: 'idle', elapsedMs: 0,
      costState: 'unpriced',
      capabilities: { interruptible: false, killable: true, pausable: false, resumable: false, steerable: false },
    },
  ],
};

/** Seed the query cache synchronously, avoiding a real async fetch round-trip. */
function render(seed: unknown = FIXTURE_SNAPSHOT): { el: HTMLElement; unmount: () => void; client: QueryClient } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.fleet, seed);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(ToastProvider, null, React.createElement(FleetView)),
    ));
  });
  return {
    el: container,
    client,
    unmount: () => {
      flushSync(() => root.unmount());
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

/** Render with NO seeded data, letting the real (mocked) queryFn drive the fetch. */
function renderUnseeded(): { el: HTMLElement; unmount: () => void } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(ToastProvider, null, React.createElement(FleetView)),
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

function click(el: Element | null | undefined) {
  flushSync(() => {
    el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
}

/** Poll with real timers until `predicate` is true or the timeout elapses. */
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
    flushSync(() => {});
  }
}

afterEach(() => {
  snapshotImpl = () => Promise.resolve(FIXTURE_SNAPSHOT);
  approvalsImpl = () => Promise.resolve({ approvals: [] });
  calls.steer.length = 0;
  calls.detach.length = 0;
  calls.watchersStop.length = 0;
});

describe('FleetView rendering', () => {
  test('renders every node including an unknown future kind/state, none dropped', () => {
    const { el, unmount } = render();
    const text = el.textContent ?? '';
    expect(text).toContain('Root agent');
    expect(text).toContain('Child subtask');
    expect(text).toContain('Future kind node');
    expect(text).toContain('quantum-process');
    expect(text).toContain('quantum-state');
    unmount();
  });

  test('unknown kind/state badges carry the honesty warning tone', () => {
    const { el, unmount } = render();
    const badges = [...el.querySelectorAll('.badge')].filter((b) => b.textContent === 'quantum-process' || b.textContent === 'quantum-state');
    expect(badges.length).toBe(2);
    for (const badge of badges) expect(badge.className).toContain('warning');
    unmount();
  });

  test('parent renders before its child (tree order)', () => {
    const { el, unmount } = render();
    const text = el.textContent ?? '';
    expect(text.indexOf('Root agent')).toBeLessThan(text.indexOf('Child subtask'));
    unmount();
  });

  test('selecting a row shows its detail pane', () => {
    const { el, unmount } = render();
    const row = [...el.querySelectorAll('.fleet-row')].find((r) => r.textContent?.includes('Root agent'));
    click(row);
    expect(el.textContent).toContain('Elapsed');
    expect(el.textContent).toContain('10 in');
    unmount();
  });

  test('a node with steer/detach actions shows the phone-tier honest note, matching the Checkpoints/Tasks convention', () => {
    const { el, unmount } = render();
    const row = [...el.querySelectorAll('.fleet-row')].find((r) => r.textContent?.includes('Root agent'));
    click(row);
    const note = el.querySelector('.fleet-detail__phone-actions-note');
    expect(note).not.toBeNull();
    expect(note!.getAttribute('role')).toBe('note');
    // Names all three actions the note's own condition covers, not just two.
    expect(note!.textContent).toBe('Steering, detaching, and stopping happen on a wider screen. This process\'s detail stays readable here.');
    unmount();
  });
});

describe('FleetView honest states', () => {
  test('a true-empty fleet says "No active processes"', () => {
    const { el, unmount } = render({ capturedAt: 1, truncated: false, totalCount: 0, nodes: [] });
    expect(el.textContent).toContain('No active processes');
    unmount();
  });

  test('a truncated snapshot shows the cap note naming the truncation, never implying completeness', () => {
    const { el, unmount } = render({ ...FIXTURE_SNAPSHOT, truncated: true, totalCount: 5000 });
    expect(el.textContent).toContain('truncated');
    expect(el.textContent).toContain('5000');
    unmount();
  });

  test('an error shows ErrorState with a working retry', async () => {
    let attempt = 0;
    snapshotImpl = () => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(FIXTURE_SNAPSHOT);
    };
    const { el, unmount } = renderUnseeded();
    await waitFor(() => (el.textContent ?? '').includes('Failed to load the fleet'));
    const retry = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
    expect(retry).toBeTruthy();
    click(retry);
    await waitFor(() => (el.textContent ?? '').includes('Root agent'));
    unmount();
  });
});

describe('FleetView node actions (WEBUI-FLEET-DEPTH)', () => {
  function selectRow(el: HTMLElement, label: string): void {
    const row = [...el.querySelectorAll('.fleet-row')].find((r) => r.textContent?.includes(label));
    click(row);
  }

  test('an agent node with a live sessionRef offers a steer box that calls sessions.steer with this surface stamped', async () => {
    const { el, unmount } = render();
    selectRow(el, 'Root agent');
    const input = el.querySelector<HTMLInputElement>('.fleet-steer-box__input');
    const form = el.querySelector<HTMLFormElement>('.fleet-steer-box__form');
    expect(input).toBeTruthy();
    expect(form).toBeTruthy();
    if (input && form) {
      flushSync(() => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input, 'keep going');
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
      flushSync(() => {
        form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      });
    }
    await waitFor(() => calls.steer.length > 0);
    expect(calls.steer[0]).toEqual({
      sessionId: 's-agent-live',
      input: { body: 'keep going', surfaceKind: 'webui', surfaceId: 'goodvibes-webui' },
    });
    unmount();
  });

  test('detach calls sessions.detach with this surface\'s id, not the process itself', async () => {
    const { el, unmount } = render();
    selectRow(el, 'Root agent');
    const detachButton = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Detach this browser'));
    click(detachButton);
    await waitFor(() => calls.detach.length > 0);
    expect(calls.detach).toEqual([{ sessionId: 's-agent-live', surfaceId: 'goodvibes-webui' }]);
    unmount();
  });

  test('a watcher node offers Stop, backed by watchers.stop keyed on the node id', async () => {
    const originalConfirm = window.confirm;
    window.confirm = () => true;
    const { el, unmount } = render();
    selectRow(el, 'Doc watcher');
    const stop = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Stop'));
    expect(stop).toBeTruthy();
    click(stop);
    await waitFor(() => calls.watchersStop.length > 0);
    expect(calls.watchersStop).toEqual([{ watcherId: 'watcher-1' }]);
    window.confirm = originalConfirm;
    unmount();
  });

  test('a wrfc-subtask node (killable/interruptible, no wire verb) gets an honest note, never a fabricated Stop button', () => {
    const { el, unmount } = render();
    selectRow(el, 'Child subtask');
    expect(el.textContent).toContain("no control verb for 'wrfc-subtask' processes yet");
    const stop = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Stop');
    expect(stop).toBeUndefined();
    unmount();
  });

  test('a node with no sessionRef offers neither steer nor detach', () => {
    const { el, unmount } = render();
    selectRow(el, 'Future kind node');
    expect(el.querySelector('.fleet-steer-box')).toBeNull();
    expect([...el.querySelectorAll('button')].some((b) => b.textContent?.includes('Detach'))).toBe(false);
    unmount();
  });

  test('a node correlated to a pending approval (matching sessionId) renders it inline, approvable from the tree', async () => {
    approvalsImpl = () => Promise.resolve({
      approvals: [{
        id: 'appr-1',
        callId: 'call-1',
        sessionId: 's-agent-live',
        status: 'pending',
        request: {
          callId: 'call-1',
          tool: 'bash',
          args: {},
          category: 'shell',
          analysis: { classification: 'x', riskLevel: 'medium', summary: 'Run the test suite', reasons: ['reason'] },
        },
        createdAt: 1,
        updatedAt: 1,
        metadata: {},
      }],
    });
    const { el, unmount } = render();
    selectRow(el, 'Root agent');
    await waitFor(() => (el.textContent ?? '').includes('Run the test suite'));
    expect(el.textContent).toContain('Pending approval');
    unmount();
  });

  test('a node with no correlated approval renders no approval card', async () => {
    const { el, unmount } = render();
    selectRow(el, 'Root agent');
    await new Promise((resolve) => setTimeout(resolve, 20));
    flushSync(() => {});
    expect(el.textContent).not.toContain('Pending approval');
    unmount();
  });
});
