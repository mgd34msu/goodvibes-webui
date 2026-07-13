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
let attemptsImpl: () => Promise<unknown> = () => Promise.resolve({ groups: [] });

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
        archivedList: () => Promise.resolve({ capturedAt: Date.now(), nodes: [] }),
        attempts: {
          list: () => attemptsImpl(),
          pick: () => Promise.resolve({ groupId: 'g-1', winnerItemId: 'i-1', loserItemIds: [], auto: false }),
          judge: () => Promise.resolve({ proposedWinnerItemId: 'i-1', reasons: [], model: 'm', scoredBy: 'model' }),
        },
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
  attemptsImpl = () => Promise.resolve({ groups: [] });
  calls.steer.length = 0;
  calls.detach.length = 0;
  calls.watchersStop.length = 0;
});

const ATTEMPT_GROUP = {
  groupId: 'g-1', workstreamId: 'ws-1', sourceTitle: 'Implement the parser', ready: true,
  autoAccept: false,
  candidates: [
    {
      itemId: 'i-1', attemptIndex: 0, state: 'held-merge', title: 'attempt A',
      worktreePath: '/wt/a', branch: 'attempt/a',
      usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, llmCallCount: 1, turnCount: 1, toolCallCount: 2, costUsd: 0.1, costState: 'priced' },
      failureReason: null,
      diff: { files: ['src/a.ts'], unifiedDiff: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,2 @@\n const a = 1;\n+const b = 2;\n', stat: '1 file' },
    },
    {
      itemId: 'i-2', attemptIndex: 1, state: 'held-merge', title: 'attempt B',
      worktreePath: '/wt/b', branch: 'attempt/b',
      usage: { inputTokens: 15, outputTokens: 25, cacheReadTokens: 0, cacheWriteTokens: 0, llmCallCount: 2, turnCount: 1, toolCallCount: 3, costUsd: 0.2, costState: 'priced' },
      failureReason: null,
      diff: { files: ['src/a.ts'], unifiedDiff: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,2 @@\n const a = 1;\n+const c = 3;\n', stat: '1 file' },
    },
  ],
  judgment: { proposedWinnerItemId: 'i-1', reasons: ['smaller, cleaner diff'], model: 'claude', scoredBy: 'model' },
};

describe('FleetView best-of-N attempts', () => {
  test('renders a ready attempt group with the compare-and-pick affordance and opens the comparison', async () => {
    attemptsImpl = () => Promise.resolve({ groups: [ATTEMPT_GROUP] });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('Best-of-N attempts'));

    expect(el.textContent).toContain('Implement the parser');
    expect(el.textContent).toContain('Ready — compare & pick');
    expect(el.textContent).toContain('2/2 held');

    flushSync(() => el.querySelector('.fleet-attempts__group')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    await waitFor(() => (el.textContent ?? '').includes('Compare attempts'));

    // both candidates and the model-judgment proposal (clearly labelled) render
    expect(el.textContent).toContain('attempt A');
    expect(el.textContent).toContain('attempt B');
    expect(el.textContent).toContain('Model judgment');
    expect(el.textContent).toContain('smaller, cleaner diff');
    // per-candidate diffs render through the shared multibuffer
    expect(el.querySelector('.diff-mb__hunk')).not.toBeNull();
    unmount();
  });
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

  test('a needsAttention node shows a distinct attention badge with the reason, and floats to the top', () => {
    const seed = {
      capturedAt: 1000,
      truncated: false,
      totalCount: 2,
      nodes: [
        {
          id: 'busy', kind: 'agent', label: 'Busy agent', state: 'thinking', elapsedMs: 100,
          startedAt: 200, costState: 'unpriced',
          capabilities: { interruptible: true, killable: true, pausable: false, resumable: false, steerable: false },
        },
        {
          id: 'blocked', kind: 'agent', label: 'Blocked agent', state: 'awaiting-approval', elapsedMs: 100,
          startedAt: 10, costState: 'unpriced',
          capabilities: { interruptible: true, killable: true, pausable: false, resumable: false, steerable: false },
          needsAttention: { reason: 'input', detail: 'Answer the prompt' },
        },
      ],
    };
    const { el, unmount } = render(seed);
    const attention = el.querySelector('.fleet-row .badge.attention');
    expect(attention).not.toBeNull();
    expect(attention!.textContent).toBe('Needs input');
    expect(attention!.getAttribute('data-attention-reason')).toBe('input');
    // Despite starting earlier, the blocked node sorts ahead of the busier newer one.
    const labels = [...el.querySelectorAll('.fleet-row__title')].map((n) => n.textContent);
    expect(labels[0]).toBe('Blocked agent');
    unmount();
  });

  test('a needs-input deep link focuses the node on mount and scrubs the fragment', async () => {
    // A push tap lands here: /?view=fleet#fleet-node=child-task&fleet-session=...
    window.history.replaceState(null, '', '/?view=fleet#fleet-node=child-task&fleet-session=s-child');
    const { el, unmount } = render();
    // The mount effect focuses the deep-linked node (a passive effect → flush it).
    await waitFor(() => el.querySelector('.fleet-detail') !== null);
    const detail = el.querySelector('.fleet-detail');
    expect(detail).not.toBeNull();
    expect(detail!.textContent).toContain('Child subtask');
    // The fragment is scrubbed so a reload does not re-focus it.
    expect(window.location.hash).toBe('');
    unmount();
    window.history.replaceState(null, '', '/');
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

describe('FleetView — read-model headline + stall tell (rounds 4-6)', () => {
  const TELLS_SNAPSHOT = {
    capturedAt: 1000,
    truncated: false,
    totalCount: 2,
    nodes: [
      {
        id: 'headlined', kind: 'agent', label: 'Session-spine agent', state: 'executing-tool', elapsedMs: 5000,
        startedAt: 100, costUsd: 0.1, costState: 'priced',
        capabilities: { interruptible: true, killable: true, pausable: false, resumable: false, steerable: false },
        headline: { text: 'Migrating the session spine to the new store', updatedAt: 110 },
        stall: { since: 1_700_000_000_000, quietForMs: 6 * 60_000 },
      },
      {
        id: 'plain', kind: 'agent', label: 'Fresh agent', state: 'thinking', elapsedMs: 100,
        startedAt: 200, costState: 'unpriced',
        capabilities: { interruptible: true, killable: true, pausable: false, resumable: false, steerable: false },
      },
    ],
  };

  /** Seed BOTH the cache and the fetch mock — the mount refetch must serve the
   * same snapshot or it clobbers the seeded tells with the default fixture. */
  function renderTells(seed: unknown = TELLS_SNAPSHOT) {
    snapshotImpl = () => Promise.resolve(seed);
    return render(seed);
  }

  test('a node headline renders ON the row (one line, replace-in-place — never an appended feed)', () => {
    const { el, unmount } = renderTells();
    const headlines = [...el.querySelectorAll('[data-testid="fleet-headline"]')];
    expect(headlines.length).toBe(1);
    expect(headlines[0].textContent).toBe('Migrating the session spine to the new store');
    // The row shows the CURRENT headline only — no history list exists.
    const row = headlines[0].closest('.fleet-row');
    expect(row?.querySelectorAll('[data-testid="fleet-headline"]').length).toBe(1);
    unmount();
  });

  test('a replaced headline REPLACES the row text — the old line is gone', async () => {
    const { el, unmount, client } = renderTells();
    // Let the mount-time refetch resolve FIRST — otherwise it lands after the
    // replacement below and restores the original snapshot.
    await new Promise((resolve) => setTimeout(resolve, 20));
    flushSync(() => {});
    const replaced = {
      ...TELLS_SNAPSHOT,
      nodes: [
        { ...TELLS_SNAPSHOT.nodes[0], headline: { text: 'Verifying the migrated store', updatedAt: 220 } },
        TELLS_SNAPSHOT.nodes[1],
      ],
    };
    // The view's own refetch must serve the REPLACED snapshot too, or the
    // poll would clobber the cache write with the stale fixture.
    snapshotImpl = () => Promise.resolve(replaced);
    client.setQueryData(queryKeys.fleet, replaced);
    // react-query notifies subscribers on a microtask — settle before asserting.
    await new Promise((resolve) => setTimeout(resolve, 20));
    flushSync(() => {});
    const headlines = [...el.querySelectorAll('[data-testid="fleet-headline"]')];
    expect(headlines.length).toBe(1);
    expect(headlines[0].textContent).toBe('Verifying the migrated store');
    expect(el.textContent).not.toContain('Migrating the session spine');
    unmount();
  });

  test('the stall tell renders as a marker with the quiet duration, only on the stalled node', () => {
    const { el, unmount } = renderTells();
    const stalls = [...el.querySelectorAll('[data-testid="fleet-stall"]')];
    expect(stalls.length).toBe(1);
    expect(stalls[0].textContent).toContain('stalled · quiet 6m');
    unmount();
  });

  test('the detail pane repeats the headline and states the stall facts', () => {
    const { el, unmount } = renderTells();
    click([...el.querySelectorAll('.fleet-row')].find((r) => r.textContent?.includes('Session-spine agent')));
    expect(el.querySelector('[data-testid="fleet-detail-headline"]')?.textContent).toBe('Migrating the session spine to the new store');
    expect(el.querySelector('[data-testid="fleet-detail-stall"]')?.textContent).toContain('stalled · quiet 6m');
    unmount();
  });

  test('nodes without the new fields render exactly as before — no fabricated tells', () => {
    const { el, unmount } = renderTells();
    const row = [...el.querySelectorAll('.fleet-row')].find((r) => r.textContent?.includes('Fresh agent'));
    expect(row?.querySelector('[data-testid="fleet-headline"]')).toBeFalsy();
    expect(row?.querySelector('[data-testid="fleet-stall"]')).toBeFalsy();
    unmount();
  });

  test('malformed tell shapes are dropped, never rendered as garbage', () => {
    const seed = {
      ...TELLS_SNAPSHOT,
      nodes: [{
        ...TELLS_SNAPSHOT.nodes[1],
        id: 'weird',
        label: 'Weird agent',
        headline: { text: 42, updatedAt: 'later' },
        stall: { since: 'yesterday' },
      }],
    };
    const { el, unmount } = renderTells(seed);
    expect(el.querySelector('[data-testid="fleet-headline"]')).toBeFalsy();
    expect(el.querySelector('[data-testid="fleet-stall"]')).toBeFalsy();
    unmount();
  });
});
