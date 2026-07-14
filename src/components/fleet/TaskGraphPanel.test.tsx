/**
 * TaskGraphPanel — the fix-phase task graph (fleet.graph.get, SDK 1.8.0).
 * Covers every state tell the brief calls out (ready/running/blocked/at-cap/
 * stalled), the pool summary line, loading/error states, and phone-width
 * legibility (a vertical list, not a diagram).
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let graphImpl: (workstreamId: string) => Promise<unknown> = (workstreamId) => Promise.resolve({
  workstreamId,
  title: 'Fix findings from the review',
  nodes: [
    { id: 'wi-1', title: 'Ready item', state: 'pending', files: ['a.ts'], orphaned: false, remainingDepth: 1, stalled: false },
    { id: 'wi-2', title: 'Running item', state: 'in-phase', files: ['b.ts'], orphaned: false, remainingDepth: 0, stalled: false },
    { id: 'wi-3', title: 'Blocked item', state: 'blocked-dependency', blockedReason: 'waiting on: Ready item', files: [], orphaned: false, remainingDepth: 0, stalled: false },
    { id: 'wi-4', title: 'Stalled item', state: 'in-phase', files: [], orphaned: false, remainingDepth: 0, stalled: true },
    { id: 'wi-5', title: 'Done item', state: 'passed', files: [], orphaned: false, remainingDepth: 0, stalled: false },
  ],
  edges: [{ from: 'wi-3', to: 'wi-1' }],
  pool: { ready: 1, running: 2, atCap: true, capKey: 'fleet.maxSize', maxSize: 2 },
});

mock.module('../../lib/goodvibes', () => ({
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  sdk: {
    operator: {
      fleet: {
        graph: {
          get: (workstreamId: string) => graphImpl(workstreamId),
        },
      },
    },
  },
}));

const { TaskGraphPanel } = await import('./TaskGraphPanel');

function render(workstreamId = 'ws-1'): { el: HTMLElement; unmount: () => void } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(TaskGraphPanel, { workstreamId })));
  });
  return {
    el: container,
    unmount: () => {
      flushSync(() => { root.unmount(); });
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
    flushSync(() => {});
  }
}

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  graphImpl = (workstreamId) => Promise.resolve({
    workstreamId,
    title: 'Fix findings from the review',
    nodes: [],
    edges: [],
    pool: null,
  });
});

describe('TaskGraphPanel', () => {
  test('renders every node state as its own legible row: ready/running/blocked/stalled/done', async () => {
    graphImpl = (workstreamId) => Promise.resolve({
      workstreamId,
      title: 'Fix findings',
      nodes: [
        { id: 'wi-1', title: 'Ready item', state: 'pending', files: ['a.ts'], orphaned: false, remainingDepth: 1, stalled: false },
        { id: 'wi-2', title: 'Running item', state: 'in-phase', files: ['b.ts'], orphaned: false, remainingDepth: 0, stalled: false },
        { id: 'wi-3', title: 'Blocked item', state: 'blocked-dependency', blockedReason: 'waiting on: Ready item', files: [], orphaned: false, remainingDepth: 0, stalled: false },
        { id: 'wi-4', title: 'Stalled item', state: 'in-phase', files: [], orphaned: false, remainingDepth: 0, stalled: true },
        { id: 'wi-5', title: 'Done item', state: 'passed', files: [], orphaned: false, remainingDepth: 0, stalled: false },
      ],
      edges: [],
      pool: null,
    });
    const { el, unmount } = render();
    cleanup = unmount;
    await waitFor(() => el.querySelectorAll('[data-testid="task-graph-node"]').length === 5);

    const rows = [...el.querySelectorAll('[data-testid="task-graph-node"]')];
    const byTitle = (title: string) => rows.find((r) => r.textContent?.includes(title));

    expect(byTitle('Ready item')?.textContent).toContain('Ready');
    expect(byTitle('Running item')?.textContent).toContain('Running');
    expect(byTitle('Blocked item')?.textContent).toContain('Blocked');
    expect(byTitle('Blocked item')?.textContent).toContain('waiting on: Ready item');
    expect(byTitle('Stalled item')?.textContent).toContain('Stalled');
    expect(byTitle('Done item')?.textContent).toContain('Done');
  });

  test('the at-cap pool state renders the brief\'s own vocabulary verbatim', async () => {
    graphImpl = (workstreamId) => Promise.resolve({
      workstreamId, title: 't', nodes: [], edges: [],
      pool: { ready: 1, running: 2, atCap: true, capKey: 'fleet.maxSize', maxSize: 2 },
    });
    const { el, unmount } = render();
    cleanup = unmount;
    await waitFor(() => Boolean(el.querySelector('[data-testid="task-graph-pool"]')));
    expect(el.querySelector('[data-testid="task-graph-pool"]')?.textContent).toBe('1 ready, 2 running, at cap (fleet.maxSize=2)');
  });

  test('a pool not at cap omits the "at cap" clause', async () => {
    graphImpl = (workstreamId) => Promise.resolve({
      workstreamId, title: 't', nodes: [], edges: [],
      pool: { ready: 3, running: 1, atCap: false, capKey: 'fleet.maxSize', maxSize: 5 },
    });
    const { el, unmount } = render();
    cleanup = unmount;
    await waitFor(() => Boolean(el.querySelector('[data-testid="task-graph-pool"]')));
    expect(el.querySelector('[data-testid="task-graph-pool"]')?.textContent).toBe('3 ready, 1 running');
  });

  test('pool:null renders no summary line at all (never a fabricated 0/0)', async () => {
    graphImpl = (workstreamId) => Promise.resolve({ workstreamId, title: 't', nodes: [], edges: [], pool: null });
    const { el, unmount } = render();
    cleanup = unmount;
    await waitFor(() => Boolean(el.querySelector('.task-graph-panel')));
    expect(el.querySelector('[data-testid="task-graph-pool"]')).toBeNull();
  });

  test('an unknown-to-this-client node state renders verbatim with the honesty warning tone', async () => {
    graphImpl = (workstreamId) => Promise.resolve({
      workstreamId, title: 't', pool: null, edges: [],
      nodes: [{ id: 'wi-9', title: 'Future item', state: 'quantum-superposed', files: [], orphaned: false, remainingDepth: 0, stalled: false }],
    });
    const { el, unmount } = render();
    cleanup = unmount;
    await waitFor(() => Boolean(el.querySelector('[data-testid="task-graph-node"]')));
    const row = el.querySelector('[data-testid="task-graph-node"]');
    expect(row?.textContent).toContain('quantum-superposed');
    expect(row?.querySelector('.badge')?.className).toContain('warning');
  });

  test('loading state renders a skeleton, no node rows', () => {
    const { el, unmount } = render();
    cleanup = unmount;
    expect(el.querySelectorAll('[data-testid="task-graph-node"]').length).toBe(0);
    expect(el.textContent).toContain('Task graph');
  });

  test('error state renders ErrorState with a retry affordance', async () => {
    graphImpl = () => Promise.reject(new Error('workstream not found'));
    const { el, unmount } = render();
    cleanup = unmount;
    await waitFor(() => (el.textContent ?? '').includes('Task graph unavailable'));
    expect(el.textContent).toContain('workstream not found');
  });

  test('an empty node list renders an honest "no nodes yet" note, not a blank panel', async () => {
    graphImpl = (workstreamId) => Promise.resolve({ workstreamId, title: 't', nodes: [], edges: [], pool: null });
    const { el, unmount } = render();
    cleanup = unmount;
    await waitFor(() => (el.textContent ?? '').includes('No task-graph nodes yet'));
  });

  test('renders as a vertical list (phone-width legible), not a canvas/diagram element', async () => {
    graphImpl = (workstreamId) => Promise.resolve({
      workstreamId, title: 't', pool: null, edges: [],
      nodes: [{ id: 'wi-1', title: 'Ready item', state: 'pending', files: [], orphaned: false, remainingDepth: 0, stalled: false }],
    });
    const { el, unmount } = render();
    cleanup = unmount;
    await waitFor(() => Boolean(el.querySelector('.task-graph-nodes')));
    expect(el.querySelector('.task-graph-nodes')?.tagName).toBe('UL');
    // No diagram/canvas rendering — a small lucide <svg> icon in the panel title
    // is expected and fine; a <canvas> (a real node-link diagram) is not.
    expect(el.querySelector('canvas')).toBeNull();
  });
});
