/**
 * ApprovalsTasksView — rendering from a mocked approvals.* and tasks.* client,
 * covering the honesty markers: the per-hunk approve flow sends ONLY
 * selected indices (never a computed diff), approve-all omits selectedHunks
 * (back-compat), a claimed-by-another approval is not actionable, a resolved
 * approval renders as history (no buttons), and tasks show honest statuses
 * with cancel/retry gated by the record's own flags.
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../lib/toast';
import { ToastViewport } from '../../components/toast/ToastViewport';

const approveCalls: unknown[] = [];
const denyCalls: unknown[] = [];
const claimCalls: string[] = [];
const cancelCalls: string[] = [];
const taskCreateCalls: unknown[] = [];
const taskCancelCalls: string[] = [];
const taskRetryCalls: string[] = [];

let approvalsListImpl: () => Promise<unknown> = () => Promise.resolve(APPROVALS_FIXTURE);
let tasksListImpl: () => Promise<unknown> = () => Promise.resolve(TASKS_FIXTURE);

mock.module('../../lib/goodvibes', () => ({
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  sdk: {
    operator: {
      approvals: {
        list: () => approvalsListImpl(),
        approve: (approvalId: string, input?: unknown) => {
          approveCalls.push({ approvalId, ...(input as object ?? {}) });
          return Promise.resolve({ approval: { id: approvalId, status: 'approved' } });
        },
        deny: (approvalId: string) => {
          denyCalls.push(approvalId);
          return Promise.resolve({ approval: { id: approvalId, status: 'denied' } });
        },
        claim: (approvalId: string) => {
          claimCalls.push(approvalId);
          return Promise.resolve({ approval: { id: approvalId, status: 'claimed', claimedBy: 'operator' } });
        },
        cancel: (approvalId: string) => {
          cancelCalls.push(approvalId);
          return Promise.resolve({ approval: { id: approvalId, status: 'cancelled' } });
        },
      },
      tasks: {
        list: () => tasksListImpl(),
        create: (input: unknown) => { taskCreateCalls.push(input); return Promise.resolve({ acknowledged: true }); },
        cancel: (taskId: string) => { taskCancelCalls.push(taskId); return Promise.resolve({ task: { id: taskId, status: 'cancelled' } }); },
        retry: (taskId: string) => { taskRetryCalls.push(taskId); return Promise.resolve({ retried: true, task: { id: taskId, status: 'queued' } }); },
      },
    },
  },
}));

const { ApprovalsTasksView } = await import('./ApprovalsTasksView');
const { queryKeys } = await import('../../lib/queries');

function analysis(overrides: Partial<{ riskLevel: string; summary: string; reasons: string[] }> = {}) {
  return {
    classification: 'edit',
    riskLevel: overrides.riskLevel ?? 'medium',
    summary: overrides.summary ?? 'edit files',
    reasons: overrides.reasons ?? ['multi-edit'],
  };
}

const EDIT_HUNKS = [
  { path: 'a.ts', find: 'foo', replace: 'FOO' },
  { path: 'a.ts', find: 'bar', replace: 'BAR' },
  { path: 'b.ts', find: 'baz', replace: 'BAZ' },
];

const APPROVALS_FIXTURE = {
  awaitingDecision: true,
  mode: 'ask',
  approvalCount: 0,
  denialCount: 0,
  cachedChecks: 0,
  totalChecks: 0,
  approvals: [
    {
      id: 'appr-edit', callId: 'call-1', status: 'pending', createdAt: 300, updatedAt: 300, metadata: {},
      request: { callId: 'call-1', tool: 'edit', args: { edits: EDIT_HUNKS }, category: 'write', analysis: analysis() },
    },
    {
      id: 'appr-cmd', callId: 'call-2', status: 'pending', createdAt: 200, updatedAt: 200, metadata: {},
      request: { callId: 'call-2', tool: 'exec', args: { command: 'ls' }, category: 'execute', analysis: analysis({ riskLevel: 'high', summary: 'run a shell command', reasons: ['shell'] }) },
    },
    {
      id: 'appr-claimed', callId: 'call-3', status: 'claimed', claimedBy: 'surface:tui-A', createdAt: 150, updatedAt: 150, metadata: {},
      request: { callId: 'call-3', tool: 'exec', args: {}, category: 'execute', analysis: analysis() },
    },
    {
      id: 'appr-done', callId: 'call-4', status: 'approved', resolvedAt: 120, resolvedBy: 'operator', createdAt: 100, updatedAt: 120, metadata: {},
      request: { callId: 'call-4', tool: 'exec', args: {}, category: 'execute', analysis: analysis() },
    },
    {
      id: 'appr-edit-partial', callId: 'call-5', status: 'approved', resolvedAt: 130, resolvedBy: 'operator', createdAt: 100, updatedAt: 130, metadata: {},
      request: { callId: 'call-5', tool: 'edit', args: { edits: EDIT_HUNKS }, category: 'write', analysis: analysis() },
      decision: { approved: true, modifiedArgs: { edits: [EDIT_HUNKS[0]] } },
    },
    {
      id: 'appr-audited', callId: 'call-6', status: 'denied', resolvedAt: 220, resolvedBy: 'operator', createdAt: 200, updatedAt: 220, metadata: {},
      request: { callId: 'call-6', tool: 'exec', args: { command: 'rm -rf /tmp/x' }, category: 'execute', analysis: analysis({ summary: 'delete a temp path' }) },
      audit: [
        { id: 'aud-1', action: 'created', actor: 'agent-1', actorSurface: 'agent', createdAt: 200 },
        { id: 'aud-2', action: 'claimed', actor: 'operator', actorSurface: 'webui', createdAt: 210 },
        { id: 'aud-3', action: 'denied', actor: 'operator', actorSurface: 'webui', createdAt: 220, note: 'too risky' },
      ],
    },
  ],
};

const TASKS_FIXTURE = {
  queued: 1, running: 1, blocked: 0,
  totals: { created: 3, completed: 1, failed: 1, cancelled: 0 },
  tasks: [
    { id: 't-1', kind: 'agent', title: 'Running task', status: 'running', owner: 'operator', cancellable: true, queuedAt: 100 },
    { id: 't-2', kind: 'exec', title: 'Failed task', status: 'failed', owner: 'operator', cancellable: false, queuedAt: 90, error: 'boom' },
    { id: 't-3', kind: 'exec', title: 'Queued task', status: 'queued', owner: 'operator', cancellable: true, queuedAt: 80 },
  ],
};

function render(): { el: HTMLElement; unmount: () => void } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.approvals, APPROVALS_FIXTURE);
  client.setQueryData(queryKeys.tasks, TASKS_FIXTURE);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(
        ToastProvider,
        null,
        React.createElement(ApprovalsTasksView),
        React.createElement(ToastViewport),
      ),
    ));
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

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
    flushSync(() => {});
  }
}

afterEach(() => {
  approveCalls.length = 0;
  denyCalls.length = 0;
  claimCalls.length = 0;
  cancelCalls.length = 0;
  taskCreateCalls.length = 0;
  taskCancelCalls.length = 0;
  taskRetryCalls.length = 0;
  approvalsListImpl = () => Promise.resolve(APPROVALS_FIXTURE);
  tasksListImpl = () => Promise.resolve(TASKS_FIXTURE);
});

describe('ApprovalsTasksView — approvals rendering', () => {
  test('renders every approval hunk for an edit-tool approval', () => {
    const { el, unmount } = render();
    expect(el.querySelectorAll('.hunk-row').length).toBe(3);
    unmount();
  });

  test('a claimed-by-another approval shows the claim note and no action buttons', () => {
    const { el, unmount } = render();
    const card = [...el.querySelectorAll('.approval-card')].find((c) => c.textContent?.includes('surface:tui-A'));
    expect(card?.textContent).toContain('Claimed by surface:tui-A');
    expect(card?.querySelectorAll('.approval-card__actions').length).toBe(0);
    unmount();
  });

  test('a resolved approval renders as history with no action buttons', () => {
    const { el, unmount } = render();
    const cards = [...el.querySelectorAll('.approval-card')];
    const resolved = cards.find((c) => c.textContent?.includes('operator') && c.textContent?.includes('approved') && !c.textContent?.includes('partial'));
    expect(resolved).toBeTruthy();
    expect(resolved?.querySelectorAll('.approval-card__actions').length).toBe(0);
    unmount();
  });

  test('a resolved whole-request approval (no modifiedArgs subset) never shows a "partial" note', () => {
    const { el, unmount } = render();
    const cards = [...el.querySelectorAll('.approval-card')];
    const resolved = cards.find((c) => c.querySelector('.approval-card__tool')?.textContent === 'exec' && c.textContent?.includes('operator'));
    expect(resolved).toBeTruthy();
    expect(resolved?.textContent).not.toContain('partial');
    unmount();
  });

  test('a resolved edit approval whose decision.modifiedArgs covers fewer hunks than the request shows a partial note', () => {
    const { el, unmount } = render();
    const cards = [...el.querySelectorAll('.approval-card')];
    const partial = cards.find((c) => c.querySelectorAll('.hunk-row').length === 0 && c.textContent?.includes('approved') && c.textContent?.includes('partial'));
    expect(partial?.textContent).toContain('partial (1/3 hunks)');
    unmount();
  });

  // B2: the SDK's approval audit trail (SharedApprovalAuditRecord) rides the
  // wire as `audit` — the webui's ApprovalRecord type previously omitted it
  // entirely. It belongs on the resolved card's detail as decision provenance.
  test('a resolved approval with an audit trail renders every entry (action, actor, surface, note)', () => {
    const { el, unmount } = render();
    const card = [...el.querySelectorAll('.approval-card')].find((c) => c.textContent?.includes('delete a temp path'));
    expect(card).toBeTruthy();
    const trail = card?.querySelector('.approval-card__audit');
    expect(trail?.textContent).toContain('created by agent-1 (agent)');
    expect(trail?.textContent).toContain('claimed by operator (webui)');
    expect(trail?.textContent).toContain('denied by operator (webui): too risky');
    unmount();
  });

  test('a resolved approval with no audit field shows the honest empty state, not a fabricated trail', () => {
    const { el, unmount } = render();
    const cards = [...el.querySelectorAll('.approval-card')];
    const resolved = cards.find((c) => c.textContent?.includes('operator') && c.textContent?.includes('approved') && !c.textContent?.includes('partial'));
    const trail = resolved?.querySelector('.approval-card__audit');
    expect(trail?.textContent).toContain('No decision trail recorded.');
    unmount();
  });

  test('a pending (non-terminal) approval renders no decision-trail section at all', () => {
    const { el, unmount } = render();
    const card = [...el.querySelectorAll('.approval-card')].find((c) => c.textContent?.includes('run a shell command'));
    expect(card?.querySelector('.approval-card__audit')).toBeFalsy();
    unmount();
  });
});

describe('ApprovalsTasksView — per-hunk approve (the S3 parity contract)', () => {
  test('approving with two checked hunks sends exactly those indices, never a computed diff', async () => {
    const { el, unmount } = render();
    const card = [...el.querySelectorAll('.approval-card')].find((c) => c.querySelectorAll('.hunk-row').length === 3)!;
    const checkboxes = [...card.querySelectorAll('input[type="checkbox"]')];
    click(checkboxes[0]);
    click(checkboxes[2]);
    const approveSelected = [...card.querySelectorAll('button')].find((b) => b.textContent?.includes('Approve selected'));
    click(approveSelected);
    await waitFor(() => approveCalls.length > 0);
    expect(approveCalls[0]).toMatchObject({ approvalId: 'appr-edit', selectedHunks: [0, 2] });
    unmount();
  });

  test('"Approve all" omits selectedHunks entirely (exact back-compat)', async () => {
    const { el, unmount } = render();
    const card = [...el.querySelectorAll('.approval-card')].find((c) => c.querySelectorAll('.hunk-row').length === 3)!;
    const approveAll = [...card.querySelectorAll('button')].find((b) => b.textContent?.includes('Approve all'));
    click(approveAll);
    await waitFor(() => approveCalls.length > 0);
    expect(approveCalls[0]).toMatchObject({ approvalId: 'appr-edit' });
    expect((approveCalls[0] as { selectedHunks?: unknown }).selectedHunks).toBeUndefined();
    unmount();
  });

  test('"Approve selected" is disabled until at least one hunk is checked', () => {
    const { el, unmount } = render();
    const card = [...el.querySelectorAll('.approval-card')].find((c) => c.querySelectorAll('.hunk-row').length === 3)!;
    const approveSelected = [...card.querySelectorAll('button')].find((b) => b.textContent?.includes('Approve selected')) as HTMLButtonElement;
    expect(approveSelected.disabled).toBe(true);
    unmount();
  });

  test('a non-edit approval has no hunk checkboxes but still offers whole-request approve/deny', async () => {
    const { el, unmount } = render();
    const card = [...el.querySelectorAll('.approval-card')].find((c) => c.textContent?.includes('run a shell command'))!;
    expect(card.querySelectorAll('.hunk-row').length).toBe(0);
    const approve = [...card.querySelectorAll('button')].find((b) => b.textContent?.includes('Approve'));
    click(approve);
    await waitFor(() => approveCalls.length > 0);
    expect(approveCalls[0]).toMatchObject({ approvalId: 'appr-cmd' });
    unmount();
  });

  test('deny calls approvals.deny with the approval id', async () => {
    const { el, unmount } = render();
    const card = [...el.querySelectorAll('.approval-card')].find((c) => c.textContent?.includes('run a shell command'))!;
    const deny = [...card.querySelectorAll('button')].find((b) => b.textContent?.includes('Deny'));
    click(deny);
    await waitFor(() => denyCalls.length > 0);
    expect(denyCalls[0]).toBe('appr-cmd');
    unmount();
  });

  test('claim calls approvals.claim with the approval id (WEBUI-FLEET-DEPTH)', async () => {
    const { el, unmount } = render();
    const card = [...el.querySelectorAll('.approval-card')].find((c) => c.textContent?.includes('run a shell command'))!;
    const claim = [...card.querySelectorAll('button')].find((b) => b.textContent?.includes('Claim'));
    click(claim);
    await waitFor(() => claimCalls.length > 0);
    expect(claimCalls[0]).toBe('appr-cmd');
    unmount();
  });

  test('cancel calls approvals.cancel with the approval id, distinct from deny (WEBUI-FLEET-DEPTH)', async () => {
    const { el, unmount } = render();
    const card = [...el.querySelectorAll('.approval-card')].find((c) => c.textContent?.includes('run a shell command'))!;
    const cancel = [...card.querySelectorAll('button')].find((b) => b.textContent?.includes('Cancel'));
    click(cancel);
    await waitFor(() => cancelCalls.length > 0);
    expect(cancelCalls[0]).toBe('appr-cmd');
    expect(denyCalls.length).toBe(0);
    unmount();
  });

  test('claimed/resolved approvals offer no Claim/Cancel — only a pending approval is actionable', () => {
    const { el, unmount } = render();
    const claimedCard = [...el.querySelectorAll('.approval-card')].find((c) => c.textContent?.includes('surface:tui-A'))!;
    expect([...claimedCard.querySelectorAll('button')].some((b) => b.textContent?.includes('Claim'))).toBe(false);
    const resolvedCard = [...el.querySelectorAll('.approval-card')].find((c) => c.textContent?.includes('delete a temp path'))!;
    expect([...resolvedCard.querySelectorAll('button')].some((b) => b.textContent?.includes('Cancel'))).toBe(false);
    unmount();
  });
});

describe('ApprovalsTasksView — approval-class matrix (WEBUI-FLEET-DEPTH)', () => {
  test('breaks the loaded approvals down by category with a risk-level count per category', () => {
    const { el, unmount } = render();
    const matrix = el.querySelector('.approval-class-matrix');
    expect(matrix).toBeTruthy();
    const text = matrix?.textContent ?? '';
    // 4 'execute'-category approvals in the fixture (appr-cmd/appr-claimed/appr-done/appr-audited)
    // and 2 'write'-category (appr-edit/appr-edit-partial).
    expect(text).toContain('execute');
    expect(text).toContain('write');
    expect(text).toContain('medium × '); // appr-edit + appr-claimed + appr-edit-partial are 'medium'
    unmount();
  });

  test('an empty approvals list renders no matrix (nothing to break down)', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.approvals, { ...APPROVALS_FIXTURE, approvals: [] });
    client.setQueryData(queryKeys.tasks, TASKS_FIXTURE);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    flushSync(() => {
      root.render(React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(ToastProvider, null, React.createElement(ApprovalsTasksView)),
      ));
    });
    expect(container.querySelector('.approval-class-matrix')).toBeNull();
    flushSync(() => root.unmount());
    container.remove();
  });
});

describe('ApprovalsTasksView — approve toast carries a subset count', () => {
  test('approving 2 of 3 hunks shows "Approved 2 of 3 hunks", not the generic toast', async () => {
    const { el, unmount } = render();
    const card = [...el.querySelectorAll('.approval-card')].find((c) => c.querySelectorAll('.hunk-row').length === 3)!;
    const checkboxes = [...card.querySelectorAll('input[type="checkbox"]')];
    click(checkboxes[0]);
    click(checkboxes[2]);
    const approveSelected = [...card.querySelectorAll('button')].find((b) => b.textContent?.includes('Approve selected'));
    click(approveSelected);
    await waitFor(() => approveCalls.length > 0);
    await waitFor(() => el.textContent?.includes('Approved 2 of 3 hunks') ?? false);
    expect(el.textContent).toContain('Approved 2 of 3 hunks');
    unmount();
  });

  test('"Approve all" on a hunked edit approval shows the plain "Approved" toast, not a fake "3 of 3"', async () => {
    const { el, unmount } = render();
    const card = [...el.querySelectorAll('.approval-card')].find((c) => c.querySelectorAll('.hunk-row').length === 3)!;
    const approveAll = [...card.querySelectorAll('button')].find((b) => b.textContent?.includes('Approve all'));
    click(approveAll);
    await waitFor(() => approveCalls.length > 0);
    await waitFor(() => [...el.querySelectorAll('.toast__title')].some((t) => t.textContent === 'Approved'));
    expect([...el.querySelectorAll('.toast__title')].some((t) => t.textContent === 'Approved')).toBe(true);
    expect(el.textContent).not.toContain('of 3 hunks');
    unmount();
  });

  test('approving a non-edit (no-hunks) request shows the plain "Approved" toast', async () => {
    const { el, unmount } = render();
    const card = [...el.querySelectorAll('.approval-card')].find((c) => c.textContent?.includes('run a shell command'))!;
    const approve = [...card.querySelectorAll('button')].find((b) => b.textContent?.includes('Approve'));
    click(approve);
    await waitFor(() => approveCalls.length > 0);
    await waitFor(() => [...el.querySelectorAll('.toast__title')].some((t) => t.textContent === 'Approved'));
    expect([...el.querySelectorAll('.toast__title')].some((t) => t.textContent === 'Approved')).toBe(true);
    unmount();
  });
});

describe('ApprovalsTasksView — approvals honest empty/error', () => {
  test('a true-empty approvals list says "No pending approvals"', () => {
    approvalsListImpl = () => Promise.resolve({ ...APPROVALS_FIXTURE, approvals: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.approvals, { ...APPROVALS_FIXTURE, approvals: [] });
    client.setQueryData(queryKeys.tasks, TASKS_FIXTURE);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    flushSync(() => {
      root.render(React.createElement(
        QueryClientProvider, { client },
        React.createElement(ToastProvider, null, React.createElement(ApprovalsTasksView)),
      ));
    });
    expect(container.textContent).toContain('No pending approvals');
    flushSync(() => root.unmount());
  });
});

describe('ApprovalsTasksView — tasks rendering', () => {
  test('renders honest statuses verbatim, including a failed task\'s error', () => {
    const { el, unmount } = render();
    const text = el.textContent ?? '';
    expect(text).toContain('running');
    expect(text).toContain('failed');
    expect(text).toContain('boom');
    unmount();
  });

  test('cancel is offered only for a cancellable task', () => {
    const { el, unmount } = render();
    const runningRow = [...el.querySelectorAll('.task-row')].find((r) => r.textContent?.includes('Running task'));
    const failedRow = [...el.querySelectorAll('.task-row')].find((r) => r.textContent?.includes('Failed task'));
    expect([...runningRow!.querySelectorAll('button')].some((b) => b.textContent?.includes('Cancel'))).toBe(true);
    expect([...failedRow!.querySelectorAll('button')].some((b) => b.textContent?.includes('Cancel'))).toBe(false);
    unmount();
  });

  test('retry is offered only for a failed/cancelled task', () => {
    const { el, unmount } = render();
    const runningRow = [...el.querySelectorAll('.task-row')].find((r) => r.textContent?.includes('Running task'));
    const failedRow = [...el.querySelectorAll('.task-row')].find((r) => r.textContent?.includes('Failed task'));
    expect([...runningRow!.querySelectorAll('button')].some((b) => b.textContent?.includes('Retry'))).toBe(false);
    expect([...failedRow!.querySelectorAll('button')].some((b) => b.textContent?.includes('Retry'))).toBe(true);
    unmount();
  });

  test('clicking cancel calls tasks.cancel with the task id', async () => {
    const { el, unmount } = render();
    const runningRow = [...el.querySelectorAll('.task-row')].find((r) => r.textContent?.includes('Running task'));
    const cancelButton = [...runningRow!.querySelectorAll('button')].find((b) => b.textContent?.includes('Cancel'));
    click(cancelButton);
    await waitFor(() => taskCancelCalls.length > 0);
    expect(taskCancelCalls[0]).toBe('t-1');
    unmount();
  });

  test('clicking retry calls tasks.retry with the task id', async () => {
    const { el, unmount } = render();
    const failedRow = [...el.querySelectorAll('.task-row')].find((r) => r.textContent?.includes('Failed task'));
    const retryButton = [...failedRow!.querySelectorAll('button')].find((b) => b.textContent?.includes('Retry'));
    click(retryButton);
    await waitFor(() => taskRetryCalls.length > 0);
    expect(taskRetryCalls[0]).toBe('t-2');
    unmount();
  });

  test('submitting the create form calls tasks.create with the typed task text', async () => {
    const { el, unmount } = render();
    const input = el.querySelector('.tasks-create__input') as HTMLInputElement;
    flushSync(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'do the thing');
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    const submit = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Submit'));
    click(submit);
    await waitFor(() => taskCreateCalls.length > 0);
    expect(taskCreateCalls[0]).toMatchObject({ task: 'do the thing' });
    unmount();
  });
});
