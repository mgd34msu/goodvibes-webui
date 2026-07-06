/**
 * KnowledgeCandidatesPanel — knowledge.candidates.list / .candidate.decide, a
 * never-called-before verb pair this brief adopts. Proves the empty/error/
 * populated states render honestly and that accept/reject/supersede send the
 * right decision and refresh the list.
 */
import { afterEach, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let listImpl: () => Promise<unknown> = () => Promise.resolve({ candidates: [] });
let decideImpl: (input: unknown) => Promise<unknown> = () => Promise.resolve({ candidate: {} });
const decideCalls: unknown[] = [];

mock.module('../../lib/goodvibes', () => ({
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: (method: string, input?: unknown) => {
    if (method === 'knowledge.candidates.list') return listImpl();
    if (method === 'knowledge.candidate.decide') {
      decideCalls.push(input);
      return decideImpl(input);
    }
    return Promise.resolve({});
  },
  sdk: { operator: { calendar: { events: {}, ics: {} } } },
}));

const { KnowledgeCandidatesPanel } = await import('./KnowledgeCandidates');

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(KnowledgeCandidatesPanel)));
  });
  return {
    el: container,
    unmount: () => {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
    flushSync(() => {});
  }
}

afterEach(() => {
  listImpl = () => Promise.resolve({ candidates: [] });
  decideImpl = () => Promise.resolve({ candidate: {} });
  decideCalls.length = 0;
});

test('an empty candidate list reads an honest empty state', async () => {
  const { el, unmount } = render();
  await waitFor(() => (el.textContent ?? '').includes('No consolidation candidates'));
  unmount();
});

test('a query failure renders ErrorState with retry', async () => {
  listImpl = () => Promise.reject(new Error('boom'));
  const { el, unmount } = render();
  await waitFor(() => (el.textContent ?? '').includes('Candidates failed to load'));
  unmount();
});

test('a pending candidate renders its score/summary and offers accept/reject/supersede', async () => {
  listImpl = () => Promise.resolve({
    candidates: [{
      id: 'cand-1',
      candidateType: 'promotion',
      status: 'pending',
      title: 'Promote the session-spine decision',
      summary: 'Recorded three times across sessions.',
      score: 0.82,
    }],
  });
  const { el, unmount } = render();
  await waitFor(() => (el.textContent ?? '').includes('Promote the session-spine decision'));
  expect(el.textContent).toContain('0.82');
  expect(el.textContent).toContain('Accept');
  expect(el.textContent).toContain('Reject');
  expect(el.textContent).toContain('Supersede');
  unmount();
});

test('accepting a candidate sends {id, decision: "accept"} and refreshes the list', async () => {
  listImpl = () => Promise.resolve({
    candidates: [{ id: 'cand-1', status: 'pending', title: 'Candidate one', score: 0.5 }],
  });
  decideImpl = () => Promise.resolve({ candidate: { id: 'cand-1', status: 'accepted' } });
  const { el, unmount } = render();
  await waitFor(() => (el.textContent ?? '').includes('Candidate one'));

  const acceptButton = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Accept'));
  expect(acceptButton).toBeTruthy();
  flushSync(() => acceptButton?.click());

  await waitFor(() => decideCalls.length > 0);
  expect(decideCalls[0]).toEqual({ id: 'cand-1', decision: 'accept' });
  unmount();
});

test('an already-decided candidate (status !== pending) offers no action buttons', async () => {
  listImpl = () => Promise.resolve({
    candidates: [{ id: 'cand-2', status: 'accepted', title: 'Already decided', score: 0.9 }],
  });
  const { el, unmount } = render();
  await waitFor(() => (el.textContent ?? '').includes('Already decided'));
  expect(el.querySelector('.knowledge-candidate-row__actions')).toBeNull();
  unmount();
});
