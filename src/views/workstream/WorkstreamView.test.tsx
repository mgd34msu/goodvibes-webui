/**
 * WorkstreamView — rendering from a mocked fleet.snapshot, filtered
 * client-side to workstream/phase/work-item rows. Covers: the honest
 * true-empty state, a stalled work item shown stalled (never hidden), the
 * workstream/phase/work-item tree order, non-workstream/phase/work-item fleet
 * nodes (e.g. a plain agent) excluded from this view, and error+retry.
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let snapshotImpl: () => Promise<unknown> = () => Promise.resolve(FIXTURE_SNAPSHOT);

mock.module('../../lib/goodvibes', () => ({
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  sdk: {
    operator: {
      fleet: {
        snapshot: () => snapshotImpl(),
        list: () => Promise.resolve({ items: [], hasMore: false, capturedAt: Date.now() }),
      },
    },
  },
}));

const { WorkstreamView } = await import('./WorkstreamView');
const { queryKeys } = await import('../../lib/queries');

const FIXTURE_SNAPSHOT = {
  capturedAt: 1000,
  truncated: false,
  totalCount: 4,
  nodes: [
    {
      id: 'workstream:ws-1', kind: 'workstream', label: 'Stage 3 rollout', state: 'executing-tool', elapsedMs: 5000,
      startedAt: 100, costUsd: 1.2, costState: 'priced',
      capabilities: { interruptible: false, killable: true, pausable: false, resumable: false, steerable: false },
      usage: { inputTokens: 100, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, llmCallCount: 4, turnCount: 4, toolCallCount: 2 },
    },
    {
      id: 'phase:ws-1:build', kind: 'phase', parentId: 'workstream:ws-1', label: 'engineer (implementer)', state: 'executing-tool',
      elapsedMs: 0, startedAt: 100,
      capabilities: { interruptible: false, killable: false, pausable: false, resumable: false, steerable: false },
    },
    {
      id: 'work-item:item-1', kind: 'work-item', parentId: 'phase:ws-1:build', label: 'Ship the fleet view', state: 'stalled',
      elapsedMs: 3000, startedAt: 110, costUsd: null, costState: 'unpriced',
      currentActivity: { kind: 'phase', text: 'waiting on: item-0', at: 110 },
      capabilities: { interruptible: false, killable: true, pausable: false, resumable: false, steerable: false },
    },
    {
      id: 'root-agent', kind: 'agent', label: 'Unrelated agent', state: 'thinking', elapsedMs: 1000,
      startedAt: 90, costUsd: 0.1, costState: 'priced',
      capabilities: { interruptible: true, killable: true, pausable: false, resumable: false, steerable: true },
    },
  ],
};

function render(seed: unknown = FIXTURE_SNAPSHOT): { el: HTMLElement; unmount: () => void } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.workstream, seed);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(WorkstreamView)));
  });
  return {
    el: container,
    unmount: () => {
      flushSync(() => root.unmount());
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

function renderUnseeded(): { el: HTMLElement; unmount: () => void } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(WorkstreamView)));
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
});

describe('WorkstreamView rendering', () => {
  test('renders the workstream/phase/work-item rows but excludes an unrelated fleet agent', () => {
    const { el, unmount } = render();
    const text = el.textContent ?? '';
    expect(text).toContain('Stage 3 rollout');
    expect(text).toContain('engineer (implementer)');
    expect(text).toContain('Ship the fleet view');
    expect(text).not.toContain('Unrelated agent');
    unmount();
  });

  test('workstream renders before its phase, phase before its work item (tree order)', () => {
    const { el, unmount } = render();
    const text = el.textContent ?? '';
    expect(text.indexOf('Stage 3 rollout')).toBeLessThan(text.indexOf('engineer (implementer)'));
    expect(text.indexOf('engineer (implementer)')).toBeLessThan(text.indexOf('Ship the fleet view'));
    unmount();
  });

  test('a stalled work item is shown stalled, never hidden or silently relabeled', () => {
    const { el, unmount } = render();
    const row = [...el.querySelectorAll('.workstream-row')].find((r) => r.textContent?.includes('Ship the fleet view'));
    expect(row?.textContent).toContain('stalled');
    const badge = [...row!.querySelectorAll('.badge')].find((b) => b.textContent === 'stalled');
    expect(badge?.className).toContain('warning');
    unmount();
  });

  test('the toolbar summary counts one workstream and one stalled row', () => {
    const { el, unmount } = render();
    expect(el.textContent).toContain('1 workstream');
    expect(el.textContent).toContain('1 stalled');
    unmount();
  });

  test('selecting a work item shows its blocked-reason detail', () => {
    const { el, unmount } = render();
    const row = [...el.querySelectorAll('.workstream-row')].find((r) => r.textContent?.includes('Ship the fleet view'));
    click(row);
    expect(el.textContent).toContain('waiting on: item-0');
    unmount();
  });

  test('a phase node reports no usage/cost, and says so explicitly', () => {
    const { el, unmount } = render();
    const row = [...el.querySelectorAll('.workstream-row')].find((r) => r.textContent?.includes('engineer (implementer)'));
    click(row);
    expect(el.textContent).toContain('report no usage/cost');
    unmount();
  });

  test('a killable work-item (no wire verb for its kind) gets an honest unbackedCapabilityNote, never a fabricated control (WEBUI-FLEET-DEPTH)', () => {
    const { el, unmount } = render();
    const row = [...el.querySelectorAll('.workstream-row')].find((r) => r.textContent?.includes('Ship the fleet view'));
    click(row);
    expect(el.textContent).toContain("no control verb for 'work-item' processes yet");
    unmount();
  });

  test('a workstream node (only killable=true) gets the same honest note', () => {
    const { el, unmount } = render();
    const row = [...el.querySelectorAll('.workstream-row')].find((r) => r.textContent?.includes('Stage 3 rollout'));
    click(row);
    expect(el.textContent).toContain("no control verb for 'workstream' processes yet");
    unmount();
  });

  test('a phase node (every capability false) gets no unbacked note — nothing to be honest about', () => {
    const { el, unmount } = render();
    const row = [...el.querySelectorAll('.workstream-row')].find((r) => r.textContent?.includes('engineer (implementer)'));
    click(row);
    expect(el.textContent).not.toContain('no control verb for');
    unmount();
  });

  test('selecting a node shows a Back-to-workstreams affordance in the DOM (phone master/detail)', () => {
    const { el, unmount } = render();
    const row = [...el.querySelectorAll('.workstream-row')].find((r) => r.textContent?.includes('Stage 3 rollout'));
    click(row);
    expect(el.querySelector('.workstream-detail__back')).toBeTruthy();
    unmount();
  });
});

describe('WorkstreamView honest states', () => {
  test('no workstream rows says "No active workstreams"', () => {
    const { el, unmount } = render({ capturedAt: 1, truncated: false, totalCount: 1, nodes: [FIXTURE_SNAPSHOT.nodes[3]] });
    expect(el.textContent).toContain('No active workstreams');
    unmount();
  });

  test('an error shows ErrorState with a working retry', async () => {
    let attempt = 0;
    snapshotImpl = () => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(FIXTURE_SNAPSHOT);
    };
    const { el, unmount } = renderUnseeded();
    await waitFor(() => (el.textContent ?? '').includes('Failed to load workstreams'));
    const retry = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
    expect(retry).toBeTruthy();
    click(retry);
    await waitFor(() => (el.textContent ?? '').includes('Stage 3 rollout'));
    unmount();
  });
});

describe('WorkstreamView — read-model headline + stall tell (rounds 4-6)', () => {
  test('a work item with the derived tells renders the headline line and the stall marker', () => {
    const seed = {
      capturedAt: 1000,
      truncated: false,
      totalCount: 1,
      nodes: [{
        ...FIXTURE_SNAPSHOT.nodes[2],
        headline: { text: 'Wiring the fleet adapters', updatedAt: 120 },
        stall: { since: 1_700_000_000_000, quietForMs: 300_000 },
      }],
    };
    const { el, unmount } = render(seed);
    expect(el.querySelector('[data-testid="fleet-headline"]')?.textContent).toBe('Wiring the fleet adapters');
    expect(el.querySelector('[data-testid="fleet-stall"]')?.textContent).toContain('stalled · quiet 5m');
    unmount();
  });
});
