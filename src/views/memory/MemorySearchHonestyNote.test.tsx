/**
 * MemorySearchHonestyNote — direct coverage for the `limit` prop's effect on the
 * `totalBeforeRecallFilter` label (cohesion review finding 3): the count is capped by
 * whatever `limit` the caller searched with, so it must never read as "every matching
 * record" when a limit was actually applied, and must fall back to an honest "total"
 * when the caller genuinely searched with no limit at all.
 */
import { expect, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { MemorySearchResult } from '../../lib/goodvibes';
import { MemorySearchHonestyNote } from './MemorySearchHonestyNote';

function baseResult(overrides: Partial<MemorySearchResult> = {}): MemorySearchResult {
  return {
    records: [],
    mode: 'literal',
    requestedSemantic: false,
    indexUnavailableReason: null,
    caveat: null,
    recallFiltered: true,
    excludedFlaggedCount: 2,
    excludedBelowFloorCount: 3,
    totalBeforeRecallFilter: 6,
    ...overrides,
  };
}

function renderNote(result: MemorySearchResult, limit?: number) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => root.render(React.createElement(MemorySearchHonestyNote, { result, limit })));
  const text = container.textContent ?? '';
  flushSync(() => root.unmount());
  container.remove();
  return text;
}

test('a limited search labels the count "of the first N matches", not a bare total', () => {
  const text = renderNote(baseResult(), 100);
  expect(text).toContain('6 of the first 100 matches before the recall filter');
  expect(text).not.toContain('total before filtering');
});

test('a search with no limit falls back to an honest "total" label', () => {
  const text = renderNote(baseResult(), undefined);
  expect(text).toContain('6 total before the recall filter');
});

test('the recall-floor exclusion never states a specific percentage — the floor is not on the wire', () => {
  const text = renderNote(baseResult());
  expect(text).toContain("3 excluded (below the store's configured recall floor)");
  expect(text).not.toMatch(/\d+% recall floor/);
});
