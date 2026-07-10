/**
 * SessionChanges.test.tsx — the hunk-selectable session changes view end to end.
 *
 * Drives the real daemon surface this feature runs on (checkpoints.list +
 * checkpoints.diff, both mocked here to the exact wire shapes) and asserts the whole
 * flow: expand → a checkpoint diff is parsed into a tappable hunk → tapping opens the
 * comment sheet → the comment is sent through sessions.steer PREFIXED with the
 * structured context block (file + line ranges + captured label + the hunk excerpt +
 * the comment). Also covers the follow-up fallback when no agent is bound, and the
 * honest empty state when there are no checkpoints.
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const UNIFIED = `diff --git a/src/foo.ts b/src/foo.ts
index 111..222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -40,3 +40,4 @@ export function foo() {
 const a = 1;
+  const c = 3;
 const b = 2;
`;

let checkpoints: unknown[] = [];
const steerCalls: { sessionId: string; input: { body: string } }[] = [];
const followUpCalls: { sessionId: string; input: { body: string } }[] = [];

mock.module('../../lib/goodvibes', () => ({
  // queries.ts (imported transitively) pulls these named exports at module-eval —
  // stub them so the mocked module satisfies the whole graph.
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  sdk: {
    operator: {
      checkpoints: {
        list: () => Promise.resolve({ checkpoints }),
        diff: (_input: { a: string }) => Promise.resolve({
          diff: { from: 'cp-1', to: 'working-tree', files: ['src/foo.ts'], unifiedDiff: UNIFIED, stat: '1 file changed' },
        }),
      },
      sessions: {
        steer: (sessionId: string, input: { body: string }) => { steerCalls.push({ sessionId, input }); return Promise.resolve({}); },
        followUp: (sessionId: string, input: { body: string }) => { followUpCalls.push({ sessionId, input }); return Promise.resolve({}); },
      },
    },
  },
}));

const { SessionChanges } = await import('./SessionChanges');
const { queryKeys } = await import('../../lib/queries');

function render(props: { canSteer: boolean; closed: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(SessionChanges, { sessionId: 's-1', ...props }),
    ));
  });
  return {
    container,
    client,
    unmount: () => { flushSync(() => root.unmount()); container.remove(); },
  };
}

async function settle(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
    flushSync(() => {});
  }
}

function click(el: Element | null) {
  flushSync(() => el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
}

afterEach(() => {
  checkpoints = [];
  steerCalls.length = 0;
  followUpCalls.length = 0;
});

const ONE_CHECKPOINT = [{
  id: 'cp-1', kind: 'turn', label: 'turn one', createdAt: Date.now() - 120_000,
  parentId: null, retentionClass: 'standard', commit: 'abcdef123456', sizeBytes: 1024,
}];

describe('SessionChanges', () => {
  test('expands, loads the checkpoint diff, and renders a tappable hunk', async () => {
    checkpoints = ONE_CHECKPOINT;
    const { container, unmount } = render({ canSteer: true, closed: false });
    click(container.querySelector('.session-changes__toggle'));
    await settle();

    expect(container.textContent).toContain('src/foo.ts');
    expect(container.textContent).toContain('Workspace-wide — not filtered to this session');
    const hunk = container.querySelector('.session-changes__hunk');
    expect(hunk).not.toBeNull();
    expect(hunk?.textContent).toContain('const c = 3;');
    unmount();
  });

  test('commenting on a hunk steers the session with the structured context block', async () => {
    checkpoints = ONE_CHECKPOINT;
    const { container, unmount } = render({ canSteer: true, closed: false });
    click(container.querySelector('.session-changes__toggle'));
    await settle();

    click(container.querySelector('.session-changes__hunk'));
    await settle(2);

    const textarea = container.querySelector('.hunk-sheet__input') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    flushSync(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, 'use a named constant');
      textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    const form = container.querySelector('.hunk-sheet__form') as HTMLFormElement;
    flushSync(() => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    await settle();

    expect(steerCalls).toHaveLength(1);
    expect(followUpCalls).toHaveLength(0);
    const body = steerCalls[0].input.body;
    expect(steerCalls[0].sessionId).toBe('s-1');
    expect(body).toContain('Comment on a specific code change:');
    expect(body).toContain('- File: src/foo.ts');
    expect(body).toContain('new 40–43');
    expect(body).toContain('```diff');
    expect(body).toContain('+  const c = 3;');
    expect(body).toContain('My comment: use a named constant');
    // captured-label provenance rides along
    expect(body).toContain('checkpoint "turn one"');
    unmount();
  });

  test('with no bound agent the comment queues a follow-up instead of steering', async () => {
    checkpoints = ONE_CHECKPOINT;
    const { container, unmount } = render({ canSteer: false, closed: false });
    click(container.querySelector('.session-changes__toggle'));
    await settle();
    click(container.querySelector('.session-changes__hunk'));
    await settle(2);

    const textarea = container.querySelector('.hunk-sheet__input') as HTMLTextAreaElement;
    flushSync(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, 'reconsider this');
      textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    const form = container.querySelector('.hunk-sheet__form') as HTMLFormElement;
    flushSync(() => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    await settle();

    expect(followUpCalls).toHaveLength(1);
    expect(steerCalls).toHaveLength(0);
    unmount();
  });

  test('no checkpoints yields an honest empty state, no diff query', async () => {
    checkpoints = [];
    const { container, unmount } = render({ canSteer: true, closed: false });
    click(container.querySelector('.session-changes__toggle'));
    await settle();
    expect(container.textContent).toContain('No workspace checkpoints yet');
    expect(container.querySelector('.session-changes__hunk')).toBeNull();
    unmount();
  });

  test('the checkpoints query is not fired until the section is expanded', async () => {
    checkpoints = ONE_CHECKPOINT;
    const { container, client, unmount } = render({ canSteer: true, closed: false });
    await settle(2);
    // collapsed → the enabled:expanded gate keeps the query idle with no data fetched
    const idle = client.getQueryState(queryKeys.checkpoints);
    expect(idle?.fetchStatus).toBe('idle');
    expect(idle?.data).toBeUndefined();
    click(container.querySelector('.session-changes__toggle'));
    await settle();
    expect(client.getQueryState(queryKeys.checkpoints)?.data).toBeDefined();
    unmount();
  });
});
