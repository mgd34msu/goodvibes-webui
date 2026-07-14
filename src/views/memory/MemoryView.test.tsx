/**
 * MemoryView — component-state coverage for the recall-honesty contract
 * (memory-recall-contract.ts, surfaced verbatim via MemorySearchHonestyNote) and the
 * whole-view honest degrade (METHOD_NOT_FOUND → "this daemon does not serve memory").
 * The add/list/delete/review-queue wire-round-trip journey is covered end to end by
 * e2e/memory-journey.e2e.ts against the hermetic mock daemon; this file is about what
 * each component STATE renders given a controlled sdk response.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PeekProvider } from '../../components/peek/PeekPanel';

interface FakeMemoryRecord {
  id: string;
  scope: string;
  cls: string;
  summary: string;
  detail?: string;
  tags: string[];
  provenance: { kind: string; ref: string; label?: string }[];
  reviewState: string;
  confidence: number;
  staleReason?: string;
  createdAt: number;
  updatedAt: number;
}

function memoryRecord(overrides: Partial<FakeMemoryRecord> = {}): FakeMemoryRecord {
  return {
    id: 'r1',
    scope: 'project',
    cls: 'fact',
    summary: 'The daemon is the single writer for the memory store',
    tags: [],
    provenance: [],
    reviewState: 'fresh',
    confidence: 60,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function searchResult(overrides: Partial<{
  records: FakeMemoryRecord[];
  mode: 'literal' | 'semantic';
  requestedSemantic: boolean;
  indexUnavailableReason: string | null;
  caveat: string | null;
  recallFiltered: boolean;
  excludedFlaggedCount: number;
  excludedBelowFloorCount: number;
  totalBeforeRecallFilter: number;
  recallFloor: number;
}> = {}) {
  return {
    records: [],
    mode: 'literal' as const,
    requestedSemantic: false,
    indexUnavailableReason: null,
    caveat: null,
    recallFiltered: false,
    excludedFlaggedCount: 0,
    excludedBelowFloorCount: 0,
    totalBeforeRecallFilter: 0,
    recallFloor: 60,
    ...overrides,
  };
}

function rejection(status: number, body: unknown): Promise<never> {
  return Promise.reject(Object.assign(new Error('memory.records.search failed'), { status, body }));
}

function isPersonaFilter(input: unknown): boolean {
  const record = (input ?? {}) as { cls?: string; tags?: string[] };
  return record.cls === 'constraint' && Boolean(record.tags?.includes('vibe'));
}

let listResult: unknown = searchResult();
let personaResult: unknown = searchResult();
let searchImpl: (input?: unknown) => Promise<unknown> = (input) =>
  Promise.resolve(isPersonaFilter(input) ? personaResult : listResult);
let reviewQueueImpl: () => Promise<unknown> = () => Promise.resolve({ records: [] });
let addImpl: (input: unknown) => Promise<unknown> = () => Promise.resolve({ record: memoryRecord() });
let deleteImpl: (id: string) => Promise<unknown> = (id) => Promise.resolve({ id, deleted: true });
let updateReviewImpl: (id: string, input: unknown) => Promise<unknown> = () => Promise.resolve({ record: memoryRecord() });

mock.module('../../lib/goodvibes', () => ({
  VIBE_PERSONA_TAG: 'vibe',
  // Not called by anything MemoryView renders, but src/lib/queries.ts (imported for
  // queryKeys) statically imports these two names from this module — they must
  // resolve or the import itself fails before any test runs.
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  sdk: {
    operator: {
      memory: {
        search: (input?: unknown) => searchImpl(input),
        add: (input: unknown) => addImpl(input),
        delete: (id: string) => deleteImpl(id),
        updateReview: (id: string, input: unknown) => updateReviewImpl(id, input),
        reviewQueue: () => reviewQueueImpl(),
      },
    },
  },
}));

const { MemoryView } = await import('./MemoryView');

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(PeekProvider, null, React.createElement(MemoryView)),
      ),
    );
  });
  return {
    el: container,
    unmount: () => {
      flushSync(() => root.unmount());
      container.remove();
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

afterEach(() => {
  listResult = searchResult();
  personaResult = searchResult();
  searchImpl = (input) => Promise.resolve(isPersonaFilter(input) ? personaResult : listResult);
  reviewQueueImpl = () => Promise.resolve({ records: [] });
  addImpl = () => Promise.resolve({ record: memoryRecord() });
  deleteImpl = (id) => Promise.resolve({ id, deleted: true });
  updateReviewImpl = () => Promise.resolve({ record: memoryRecord() });
});

describe('MemoryView — results state', () => {
  test('a genuinely empty store says "No memory recorded yet", not a blank panel', async () => {
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('No memory recorded yet'));
    unmount();
  });

  test('records render with their type/scope/review-state/confidence badges', async () => {
    listResult = searchResult({
      records: [memoryRecord({ id: 'r1', summary: 'Deploys use blue-green', cls: 'decision', scope: 'team', confidence: 88 })],
    });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('Deploys use blue-green'));
    expect(el.textContent).toContain('decision');
    expect(el.textContent).toContain('team');
    expect(el.textContent).toContain('88%');
    unmount();
  });
});

describe('MemoryView — the recall-honesty note', () => {
  test('literal mode is labeled plainly when semantic was not requested', async () => {
    listResult = searchResult({ mode: 'literal', requestedSemantic: false });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('Literal search'));
    unmount();
  });

  test('an unavailable semantic index states the reason VERBATIM — never a silent empty result', async () => {
    const reason = 'Semantic index unavailable: sqlite-vec extension failed to load — falling back to a literal scan';
    listResult = searchResult({ mode: 'literal', requestedSemantic: true, indexUnavailableReason: reason, records: [] });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes(reason));
    // The degraded reason must be visible even though the record list itself is empty —
    // the honesty note and the empty-records state are not the same thing, and neither
    // may substitute for the other.
    expect(el.textContent).toContain('No memory recorded yet');
    unmount();
  });

  test('the hashed-provider caveat is shown verbatim as a softer note than the hard-unavailable banner', async () => {
    const caveat = 'Ran on the built-in hashed-only embedding provider — real matches rank better with a modeled provider';
    listResult = searchResult({ mode: 'semantic', requestedSemantic: true, caveat });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes(caveat));
    unmount();
  });

  test('recall-filtered results surface the exclusion counts, not just the survivors', async () => {
    listResult = searchResult({
      records: [memoryRecord()],
      recallFiltered: true,
      excludedFlaggedCount: 2,
      excludedBelowFloorCount: 3,
      totalBeforeRecallFilter: 6,
    });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('excluded (flagged'));
    expect(el.textContent).toContain('2 excluded (flagged');
    // The floor now travels on the wire as recallFloor — the label states the exact
    // value the search fixture carries, not a hardcoded percentage (see cohesion
    // review finding 9, now resolved by the SDK's recallFloor field).
    expect(el.textContent).toContain('3 excluded (below the 60% recall floor)');
    // MemoryView always searches with limit: 100 (DEFAULT_FILTERS) — the label says so
    // rather than implying totalBeforeRecallFilter is every matching record.
    expect(el.textContent).toContain('6 of the first 100 matches before the recall filter');
    unmount();
  });
});

describe('MemoryView — honest degrade', () => {
  test('METHOD_NOT_FOUND replaces the whole view with "this daemon does not serve memory"', async () => {
    searchImpl = () => rejection(404, { code: 'METHOD_NOT_FOUND', error: 'Unknown gateway method: memory.records.search' });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('This daemon does not serve memory'));
    // The degraded state replaces the search form/panels entirely — it is not layered
    // as one more banner alongside a workspace that still looks otherwise functional.
    expect(el.querySelector('.memory-search')).toBeFalsy();
    unmount();
  });

  test('a non-capability error (e.g. a 500) is a normal retryable failure, not the degraded state', async () => {
    searchImpl = () => rejection(500, { error: 'Internal error' });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('Search failed'));
    expect(el.textContent).not.toContain('This daemon does not serve memory');
    unmount();
  });
});

describe('MemoryView — personas (VIBE.md read surface)', () => {
  test('a constraint record tagged "vibe" renders under Personas, not just Records', async () => {
    const persona = memoryRecord({ id: 'p1', cls: 'constraint', tags: ['vibe'], summary: 'Prefer plain language over jargon' });
    personaResult = searchResult({ records: [persona] });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('Prefer plain language over jargon'));
    const personasPanel = el.querySelector('[aria-label="Personas"]');
    expect(personasPanel?.textContent).toContain('Prefer plain language over jargon');
    unmount();
  });

  test('no persona records renders an honest empty state, not a silent gap', async () => {
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('No persona records'));
    unmount();
  });
});

describe('MemoryView — chat-provenance setting (owner-ruled, default OFF)', () => {
  afterEach(() => {
    window.localStorage.removeItem('goodvibes.webui.preferences');
  });

  test('the toggle defaults to unchecked', async () => {
    const { el, unmount } = render();
    await waitFor(() => Boolean(el.querySelector('.memory-provenance-settings')));
    const toggle = el.querySelector('.memory-provenance-settings input[type="checkbox"]') as HTMLInputElement | null;
    expect(toggle).not.toBeNull();
    expect(toggle?.checked).toBe(false);
    unmount();
  });

  test('toggling it on persists to the shared webui-preferences store', async () => {
    const { el, unmount } = render();
    await waitFor(() => Boolean(el.querySelector('.memory-provenance-settings')));
    const toggle = el.querySelector('.memory-provenance-settings input[type="checkbox"]') as HTMLInputElement;
    flushSync(() => { toggle.click(); });
    expect(toggle.checked).toBe(true);
    const stored = JSON.parse(window.localStorage.getItem('goodvibes.webui.preferences') ?? '{}');
    expect(stored.memoryProvenanceChipEnabled).toBe(true);
    unmount();
  });
});
