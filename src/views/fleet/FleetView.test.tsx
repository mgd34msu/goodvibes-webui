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

const { FleetView } = await import('./FleetView');
const { queryKeys } = await import('../../lib/queries');

const FIXTURE_SNAPSHOT = {
  capturedAt: 1000,
  truncated: false,
  totalCount: 3,
  nodes: [
    {
      id: 'root-agent', kind: 'agent', label: 'Root agent', state: 'thinking', elapsedMs: 5000,
      startedAt: 100, costUsd: 0.42, costState: 'priced',
      capabilities: { interruptible: true, killable: true, pausable: false, resumable: false, steerable: true },
      usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, llmCallCount: 1, turnCount: 1, toolCallCount: 0 },
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
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(FleetView)));
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
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(FleetView)));
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
