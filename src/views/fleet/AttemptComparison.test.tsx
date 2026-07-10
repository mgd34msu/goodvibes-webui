/**
 * AttemptComparison.test.tsx — the best-of-N compare + pick surface.
 *
 * Renders candidates with their diffs, runs the judge (model judgment, clearly labelled),
 * picks a winner behind a confirm sheet (fleet.attempts.pick), and renders the honest
 * conflict state when the group is no longer ready (409 CONFLICT — never a partial merge).
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const pickCalls: { groupId: string; winnerItemId: string }[] = [];
const judgeCalls: string[] = [];
let pickError: unknown = null;

mock.module('../../lib/goodvibes', () => ({
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  sdk: {
    operator: {
      fleet: {
        attempts: {
          pick: (groupId: string, winnerItemId: string) => {
            pickCalls.push({ groupId, winnerItemId });
            return pickError ? Promise.reject(pickError) : Promise.resolve({ groupId, winnerItemId, loserItemIds: ['i-2'], auto: false });
          },
          judge: (groupId: string) => {
            judgeCalls.push(groupId);
            return Promise.resolve({ proposedWinnerItemId: 'i-2', reasons: ['fewer tool calls'], model: 'claude', scoredBy: 'model' });
          },
        },
      },
    },
  },
}));

const { AttemptComparison } = await import('./AttemptComparison');

const GROUP = {
  groupId: 'g-1', workstreamId: 'ws-1', sourceTitle: 'Build the widget', ready: true, autoAccept: false,
  candidates: [
    {
      itemId: 'i-1', attemptIndex: 0, state: 'held-merge', title: 'attempt A', worktreePath: '/wt/a', branch: 'a',
      usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, llmCallCount: 1, turnCount: 1, toolCallCount: 2, costUsd: 0.1, costState: 'priced' },
      failureReason: null,
      diff: { files: ['a.ts'], unifiedDiff: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1,2 @@\n x\n+y\n', stat: '1 file' },
    },
    {
      itemId: 'i-2', attemptIndex: 1, state: 'held-merge', title: 'attempt B', worktreePath: '/wt/b', branch: 'b',
      usage: { inputTokens: 12, outputTokens: 22, cacheReadTokens: 0, cacheWriteTokens: 0, llmCallCount: 1, turnCount: 1, toolCallCount: 1, costUsd: 0.12, costState: 'priced' },
      failureReason: null,
      diff: { files: ['a.ts'], unifiedDiff: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1,2 @@\n x\n+z\n', stat: '1 file' },
    },
  ],
  judgment: null,
};

function render(onPicked = () => {}, onClose = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(AttemptComparison, { open: true, group: GROUP as never, onClose, onPicked }),
    ));
  });
  return { container, unmount: () => { flushSync(() => root.unmount()); container.remove(); } };
}

async function settle(times = 4) {
  for (let i = 0; i < times; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
    flushSync(() => {});
  }
}

function click(el: Element | null) {
  flushSync(() => el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
}

afterEach(() => {
  pickCalls.length = 0;
  judgeCalls.length = 0;
  pickError = null;
});

describe('AttemptComparison', () => {
  test('renders both candidates and their diffs through the shared multibuffer', () => {
    const { container, unmount } = render();
    expect(container.textContent).toContain('attempt A');
    expect(container.textContent).toContain('attempt B');
    expect(container.querySelectorAll('.diff-mb__hunk').length).toBeGreaterThanOrEqual(2);
    unmount();
  });

  test('the judge proposal is labelled as model judgment and shows its reasons', async () => {
    const { container, unmount } = render();
    click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Ask the judge')) ?? null);
    await settle();

    expect(judgeCalls).toEqual(['g-1']);
    expect(container.textContent).toContain('Model judgment');
    expect(container.textContent).toContain('proposal only');
    expect(container.textContent).toContain('fewer tool calls');
    unmount();
  });

  test('picking a winner runs fleet.attempts.pick behind a confirm sheet', async () => {
    let picked = false;
    const { container, unmount } = render(() => { picked = true; });
    // default selection is the first held candidate (i-1)
    click(container.querySelector('.attempt-cmp__pick-btn'));
    await settle(2);
    click(container.querySelector('.confirm-sheet__confirm'));
    await settle(3);

    expect(pickCalls).toEqual([{ groupId: 'g-1', winnerItemId: 'i-1' }]);
    expect(picked).toBe(true);
    unmount();
  });

  test('a 409 conflict (group no longer ready) renders the honest state, never a partial merge', async () => {
    pickError = { status: 409, code: 'CONFLICT', message: 'group not ready' };
    const { container, unmount } = render();
    click(container.querySelector('.attempt-cmp__pick-btn'));
    await settle(2);
    click(container.querySelector('.confirm-sheet__confirm'));
    await settle(3);

    expect(pickCalls).toHaveLength(1);
    expect(container.textContent).toContain('no longer ready');
    unmount();
  });
});
