/**
 * MemoryDiagnostics — the admin Memory panel. Covers loading/error/unavailable
 * (404/501)/populated states, the tier chip, the budget-vs-RSS bar, the per-cache
 * table, paused jobs, and the tripwire line.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

let mockDiagnostics: {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error?: unknown;
  data?: unknown;
  refetch: () => void;
} = { isPending: false, isError: false, isSuccess: false, data: undefined, refetch: () => {} };

mock.module('../../hooks/useMemoryDiagnostics', () => ({
  useMemoryDiagnostics: () => mockDiagnostics,
}));

const { MemoryDiagnostics } = await import('./MemoryDiagnostics');

function render(): { el: HTMLElement; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => { root.render(React.createElement(MemoryDiagnostics)); });
  return {
    el: container,
    unmount: () => {
      flushSync(() => { root.unmount(); });
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  mockDiagnostics = { isPending: false, isError: false, isSuccess: false, data: undefined, refetch: () => {} };
});

const NORMAL_SNAPSHOT = {
  tier: 'normal',
  budgetMb: 1024,
  rssMb: 256,
  heapUsedMb: 180,
  heapTotalMb: 400,
  usedPct: 25,
  refusingExpensiveWork: false,
  caches: [
    { id: 'knowledge-embeddings', name: 'Knowledge embeddings', entries: 4200, estimatedBytes: 15_728_640 },
  ],
  pausedJobs: [],
  tripwire: { armed: false, sustainedSec: 0, rateMbPerSec: 0 },
  thresholds: { elevatedPct: 60, highPct: 80, criticalPct: 92 },
};

describe('MemoryDiagnostics', () => {
  test('loading state renders a skeleton, no tier chip', () => {
    mockDiagnostics = { isPending: true, isError: false, isSuccess: false, data: undefined, refetch: () => {} };
    const { el, unmount } = render();
    cleanup = unmount;
    expect(el.querySelector('.badge')).toBeNull();
    expect(el.textContent).toContain('Memory');
  });

  test('unavailable (404 METHOD_NOT_FOUND) renders the honest "does not serve" state, not a scary error', () => {
    mockDiagnostics = {
      isPending: false,
      isError: true,
      isSuccess: false,
      error: Object.assign(new Error('Unknown gateway method'), { status: 404, code: 'METHOD_NOT_FOUND' }),
      refetch: () => {},
    };
    const { el, unmount } = render();
    cleanup = unmount;
    expect(el.textContent).toContain('This daemon does not serve memory diagnostics');
  });

  test('unavailable (501) renders the same honest "does not serve" state', () => {
    mockDiagnostics = {
      isPending: false,
      isError: true,
      isSuccess: false,
      error: Object.assign(new Error('Not wired'), { status: 501 }),
      refetch: () => {},
    };
    const { el, unmount } = render();
    cleanup = unmount;
    expect(el.textContent).toContain('This daemon does not serve memory diagnostics');
  });

  test('a genuine fetch error renders a retriable ErrorState, distinct from unavailable', () => {
    mockDiagnostics = {
      isPending: false,
      isError: true,
      isSuccess: false,
      error: Object.assign(new Error('network down'), { status: 0, category: 'network' }),
      refetch: () => {},
    };
    const { el, unmount } = render();
    cleanup = unmount;
    expect(el.textContent).toContain('Memory diagnostics unavailable');
    expect(el.textContent).not.toContain('This daemon does not serve memory diagnostics');
    expect(el.querySelector('.feedback-error-state__retry')).not.toBeNull();
  });

  test('normal tier renders a neutral chip, the budget-vs-rss bar, and per-cache table', () => {
    mockDiagnostics = { isPending: false, isError: false, isSuccess: true, data: NORMAL_SNAPSHOT, refetch: () => {} };
    const { el, unmount } = render();
    cleanup = unmount;
    const chip = el.querySelector('.badge');
    expect(chip?.className).toContain('neutral');
    expect(chip?.textContent).toBe('Normal');
    expect(el.textContent).toContain('256 MB of 1024 MB budget');
    expect(el.textContent).toContain('25%');
    const bar = el.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('25');
    expect(el.textContent).toContain('Knowledge embeddings');
    expect(el.textContent).toContain('15.0 MB');
    expect(el.textContent).toContain('No deferrable jobs currently paused.');
    expect(el.textContent).toContain('Leak tripwire: not armed.');
  });

  test('elevated tier gets the info tone (distinct from normal/high/critical)', () => {
    mockDiagnostics = { isPending: false, isError: false, isSuccess: true, data: { ...NORMAL_SNAPSHOT, tier: 'elevated', usedPct: 65 }, refetch: () => {} };
    const { el, unmount } = render();
    cleanup = unmount;
    expect(el.querySelector('.badge')?.className).toContain('info');
  });

  test('high tier gets the warning tone', () => {
    mockDiagnostics = { isPending: false, isError: false, isSuccess: true, data: { ...NORMAL_SNAPSHOT, tier: 'high', usedPct: 85 }, refetch: () => {} };
    const { el, unmount } = render();
    cleanup = unmount;
    expect(el.querySelector('.badge')?.className).toContain('warning');
  });

  test('critical tier gets the bad tone and shows the refusing-expensive-work note', () => {
    mockDiagnostics = {
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { ...NORMAL_SNAPSHOT, tier: 'critical', usedPct: 97, refusingExpensiveWork: true },
      refetch: () => {},
    };
    const { el, unmount } = render();
    cleanup = unmount;
    expect(el.querySelector('.badge')?.className).toContain('bad');
    expect(el.textContent).toContain('Refusing expensive work while under pressure.');
  });

  test('paused jobs render as a list', () => {
    mockDiagnostics = {
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { ...NORMAL_SNAPSHOT, pausedJobs: ['knowledge.reindex', 'memory.vector.rebuild'] },
      refetch: () => {},
    };
    const { el, unmount } = render();
    cleanup = unmount;
    const items = el.querySelectorAll('.memory-diagnostics__paused-jobs li');
    expect(items.length).toBe(2);
    expect(el.textContent).toContain('knowledge.reindex');
    expect(el.textContent).toContain('memory.vector.rebuild');
  });

  test('an armed tripwire renders the armed line with the danger styling hook', () => {
    mockDiagnostics = {
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { ...NORMAL_SNAPSHOT, tripwire: { armed: true, sustainedSec: 30, rateMbPerSec: 5.5 } },
      refetch: () => {},
    };
    const { el, unmount } = render();
    cleanup = unmount;
    expect(el.textContent).toContain('Leak tripwire: armed — sustained growth of 5.5 MB/s for 30s.');
    expect(el.querySelector('.memory-diagnostics__tripwire--armed')).not.toBeNull();
  });

  test('an empty cache list renders no table (never a fabricated empty row)', () => {
    mockDiagnostics = { isPending: false, isError: false, isSuccess: true, data: { ...NORMAL_SNAPSHOT, caches: [] }, refetch: () => {} };
    const { el, unmount } = render();
    cleanup = unmount;
    expect(el.querySelector('.memory-diagnostics__caches')).toBeNull();
  });
});
