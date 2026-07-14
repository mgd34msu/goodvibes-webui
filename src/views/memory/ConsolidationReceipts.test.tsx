/**
 * ConsolidationReceipts — memory.consolidation.receipts (SDK 1.8.0). Covers every
 * honest state (pending, unavailable via 404 and 501, genuinely empty, pending
 * proposals present, resolved runs with no pending proposals) in isolation. The
 * one-tap route to the review queue is covered end to end in MemoryView.test.tsx
 * (this component only calls the onReviewIds callback it is handed).
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let receiptsImpl: () => Promise<unknown> = () => Promise.resolve({ receipts: [], pendingProposals: [] });

mock.module('../../lib/goodvibes', () => ({
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  sdk: {
    operator: {
      memory: {
        consolidation: {
          receipts: () => receiptsImpl(),
        },
      },
    },
  },
}));

const { ConsolidationReceipts } = await import('./ConsolidationReceipts');

let reviewIdsCalls: (readonly string[])[] = [];

function render(): { el: HTMLElement; unmount: () => void } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(ConsolidationReceipts, { onReviewIds: (ids: readonly string[]) => { reviewIdsCalls.push(ids); } }),
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

function click(el: Element | null | undefined): void {
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
  receiptsImpl = () => Promise.resolve({ receipts: [], pendingProposals: [] });
  reviewIdsCalls = [];
});

describe('ConsolidationReceipts — honest states', () => {
  test('a genuinely empty store (no runs ever) says so, distinct from unavailable', async () => {
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('No consolidation runs yet'));
    expect(el.textContent).not.toContain('does not run consolidation');
    unmount();
  });

  test('a 404 METHOD_NOT_FOUND (id unregistered on an older daemon) renders the honest unavailable state', async () => {
    receiptsImpl = () => Promise.reject(Object.assign(new Error('unknown'), { status: 404, body: { code: 'METHOD_NOT_FOUND' } }));
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('This daemon does not run consolidation'));
    unmount();
  });

  test('a 501 (verb registered, scheduler not wired) renders the SAME honest unavailable state', async () => {
    receiptsImpl = () => Promise.reject(Object.assign(new Error('no scheduler'), { status: 501 }));
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('This daemon does not run consolidation'));
    unmount();
  });

  test('a genuine 500 is a normal retryable failure, not the "unavailable" state', async () => {
    receiptsImpl = () => Promise.reject(Object.assign(new Error('boom'), { status: 500 }));
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('Consolidation receipts unavailable'));
    expect(el.textContent).not.toContain('does not run consolidation');
    unmount();
  });
});

describe('ConsolidationReceipts — pending proposals', () => {
  test('renders kind, reason, and referenced record ids; Review fires onReviewIds with exactly those ids', async () => {
    receiptsImpl = () => Promise.resolve({
      receipts: [],
      pendingProposals: [{
        kind: 'cross-scope-duplicate',
        ids: ['mem-a', 'mem-b'],
        route: 'memory action:"curator" query:"consolidation"',
        reason: 'Same-summary records span multiple scopes; merging across scope needs review.',
      }],
    });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('Cross-scope duplicate'));
    expect(el.textContent).toContain('Same-summary records span multiple scopes');
    expect(el.textContent).toContain('mem-a, mem-b');
    // The internal agent-tool route string is never rendered as a browser link or route.
    expect(el.querySelector('a')).toBeNull();
    click(el.querySelector('.consolidation-proposal-row button'));
    expect(reviewIdsCalls).toEqual([['mem-a', 'mem-b']]);
    unmount();
  });

  test('no pending proposals but prior runs exist: says nothing is pending, still lists the runs', async () => {
    receiptsImpl = () => Promise.resolve({
      receipts: [{
        runId: 'mcon-1',
        ranAt: new Date(1_700_000_000_000).toISOString(),
        trigger: 'idle',
        idle: true,
        scanned: 12,
        merged: [{ survivorId: 'mem-a', duplicateIds: ['mem-b'] }],
        archived: [],
        decayed: [],
        proposed: [],
        usageSignalAvailable: true,
        note: 'Idle consolidation performs only reversible merges.',
      }],
      pendingProposals: [],
    });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('Nothing currently pending'));
    click(el.querySelector('.consolidation-receipts-runs summary'));
    expect(el.textContent).toContain('1 run recorded');
    expect(el.textContent).toContain('Scanned 12');
    unmount();
  });
});
