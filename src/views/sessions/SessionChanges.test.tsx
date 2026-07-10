/**
 * SessionChanges.test.tsx — the hunk-selectable session changes view end to end.
 *
 * Drives the PRIMARY, default source (sessions.changes.get — genuinely session-scoped)
 * and the explicit secondary/fallback mode (checkpoints.list + checkpoints.diff,
 * workspace-scoped, toggled manually or reached automatically from the honest-empty
 * state): expand → the session's aggregate diff is parsed into a tappable hunk →
 * tapping opens the comment sheet → the comment is sent through sessions.steer PREFIXED
 * with the structured context block (file + line ranges + captured label + the hunk
 * excerpt + the comment). Also covers the follow-up fallback when no agent is bound, the
 * honest-empty state when a session has no stamped checkpoints (with its fallback CTA),
 * and the workspace-scoped mode toggle.
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const SESSION_UNIFIED = `diff --git a/src/foo.ts b/src/foo.ts
index 111..222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -40,3 +40,4 @@ export function foo() {
 const a = 1;
+  const c = 3;
 const b = 2;
`;

const WORKSPACE_UNIFIED = `diff --git a/src/bar.ts b/src/bar.ts
index 333..444 100644
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -1,2 +1,3 @@
 const x = 1;
+  const y = 2;
`;

let checkpoints: unknown[] = [];
let sessionChangesResult: {
  sessionId: string;
  checkpointCount: number;
  checkpointIds: string[];
  from: string;
  to: string;
  files: string[];
  unifiedDiff: string;
  stat: string;
} = {
  sessionId: 's-1', checkpointCount: 2, checkpointIds: ['cp-1', 'cp-2'],
  from: 'cp-0', to: 'cp-2', files: ['src/foo.ts'], unifiedDiff: SESSION_UNIFIED, stat: '1 file changed',
};
let sessionChangesError: unknown = null;
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
          diff: { from: 'cp-1', to: 'working-tree', files: ['src/bar.ts'], unifiedDiff: WORKSPACE_UNIFIED, stat: '1 file changed' },
        }),
      },
      sessions: {
        steer: (sessionId: string, input: { body: string }) => { steerCalls.push({ sessionId, input }); return Promise.resolve({}); },
        followUp: (sessionId: string, input: { body: string }) => { followUpCalls.push({ sessionId, input }); return Promise.resolve({}); },
        changes: {
          get: (_sessionId: string) => (
            sessionChangesError ? Promise.reject(sessionChangesError) : Promise.resolve(sessionChangesResult)
          ),
        },
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
  sessionChangesResult = {
    sessionId: 's-1', checkpointCount: 2, checkpointIds: ['cp-1', 'cp-2'],
    from: 'cp-0', to: 'cp-2', files: ['src/foo.ts'], unifiedDiff: SESSION_UNIFIED, stat: '1 file changed',
  };
  sessionChangesError = null;
  steerCalls.length = 0;
  followUpCalls.length = 0;
});

const ONE_CHECKPOINT = [{
  id: 'cp-1', kind: 'turn', label: 'turn one', createdAt: Date.now() - 120_000,
  parentId: null, retentionClass: 'standard', commit: 'abcdef123456', sizeBytes: 1024,
}];

describe('SessionChanges', () => {
  test('expands and renders the session-scoped diff by default (sessions.changes.get)', async () => {
    const { container, unmount } = render({ canSteer: true, closed: false });
    click(container.querySelector('.session-changes__toggle'));
    await settle();

    expect(container.textContent).toContain('src/foo.ts');
    expect(container.textContent).toContain('Session-scoped — filtered to this session\'s own checkpoints only');
    const hunk = container.querySelector('.session-changes__hunk');
    expect(hunk).not.toBeNull();
    expect(hunk?.textContent).toContain('const c = 3;');
    unmount();
  });

  test('commenting on a hunk steers the session with the structured context block', async () => {
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
    expect(body).toContain('Session-scoped');
    unmount();
  });

  test('with no bound agent the comment queues a follow-up instead of steering', async () => {
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

  test('a session with no stamped checkpoints (checkpointCount:0) renders an honest empty state, never a blank, with a workspace-scoped fallback CTA', async () => {
    sessionChangesResult = {
      sessionId: 's-1', checkpointCount: 0, checkpointIds: [], from: 'EMPTY', to: 'EMPTY',
      files: [], unifiedDiff: '', stat: '',
    };
    const { container, unmount } = render({ canSteer: true, closed: false });
    click(container.querySelector('.session-changes__toggle'));
    await settle();

    expect(container.textContent).toContain('No captured changes for this session');
    expect(container.querySelector('.session-changes__hunk')).toBeNull();
    const fallbackLink = container.querySelector('.session-changes__inline-link');
    expect(fallbackLink).not.toBeNull();
    expect(fallbackLink?.textContent).toContain('View workspace-wide changes instead');
    unmount();
  });

  test('tapping the honest-empty fallback CTA switches to the workspace-scoped checkpoint picker', async () => {
    sessionChangesResult = {
      sessionId: 's-1', checkpointCount: 0, checkpointIds: [], from: 'EMPTY', to: 'EMPTY',
      files: [], unifiedDiff: '', stat: '',
    };
    checkpoints = ONE_CHECKPOINT;
    const { container, unmount } = render({ canSteer: true, closed: false });
    click(container.querySelector('.session-changes__toggle'));
    await settle();
    click(container.querySelector('.session-changes__inline-link'));
    await settle();

    expect(container.textContent).toContain('Workspace-scoped (fallback)');
    expect(container.textContent).toContain('src/bar.ts');
    unmount();
  });

  test('the explicit workspace-scoped toggle switches away from session changes even when session data is present', async () => {
    checkpoints = ONE_CHECKPOINT;
    const { container, unmount } = render({ canSteer: true, closed: false });
    click(container.querySelector('.session-changes__toggle'));
    await settle();
    expect(container.textContent).toContain('src/foo.ts');

    click(container.querySelector('.session-changes__mode-toggle'));
    await settle();

    expect(container.textContent).toContain('Workspace-scoped (fallback)');
    expect(container.textContent).toContain('src/bar.ts');
    expect(container.textContent).not.toContain('src/foo.ts');
    unmount();
  });

  test('a daemon that has never heard of sessions.changes.get (METHOD_NOT_FOUND) offers the workspace-scoped fallback rather than an error wall', async () => {
    sessionChangesError = { status: 404, code: 'METHOD_NOT_FOUND', message: 'Unknown gateway method' };
    const { container, unmount } = render({ canSteer: true, closed: false });
    click(container.querySelector('.session-changes__toggle'));
    await settle();

    expect(container.textContent).toContain("doesn't serve session-scoped changes");
    const fallbackLink = container.querySelector('.session-changes__inline-link');
    expect(fallbackLink).not.toBeNull();
    unmount();
  });

  test('the session-changes query is not fired until the section is expanded', async () => {
    const { container, client, unmount } = render({ canSteer: true, closed: false });
    await settle(2);
    // collapsed → the enabled:expanded gate keeps the query idle with no data fetched
    const idle = client.getQueryState(queryKeys.sessionChanges('s-1'));
    expect(idle?.fetchStatus).toBe('idle');
    expect(idle?.data).toBeUndefined();
    click(container.querySelector('.session-changes__toggle'));
    await settle();
    expect(client.getQueryState(queryKeys.sessionChanges('s-1'))?.data).toBeDefined();
    unmount();
  });
});
