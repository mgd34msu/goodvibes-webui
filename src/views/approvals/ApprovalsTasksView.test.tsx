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
// The decision the mocked approve() returns on the record — lets a test drive
// the response-verified remember/answer honesty via the back-compat fallback.
let approveResultDecision: Record<string, unknown> | undefined;
// The authoritative `recorded` block the mocked approve()/deny() return — lets a
// test prove the UI trusts the block over what it sent or the decision snapshot.
let approveResultRecorded: Record<string, unknown> | undefined;
let denyResultRecorded: Record<string, unknown> | undefined;
const ruleDeleteCalls: string[] = [];
let rulesFixture: { id: string; effect: string; tier: string; tool: string; description?: string; createdAt: number }[] = [];
let ruleDeleteResult = true;

mock.module('../../lib/goodvibes', () => ({
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  sdk: {
    operator: {
      approvals: {
        list: () => approvalsListImpl(),
        approve: (approvalId: string, input?: unknown) => {
          approveCalls.push({ approvalId, ...(input as object ?? {}) });
          return Promise.resolve({
            approval: {
              id: approvalId,
              status: 'approved',
              ...(approveResultDecision ? { decision: approveResultDecision } : {}),
            },
            ...(approveResultRecorded ? { recorded: approveResultRecorded } : {}),
          });
        },
        deny: (approvalId: string, input?: unknown) => {
          denyCalls.push({ approvalId, ...(input as object ?? {}) });
          return Promise.resolve({
            approval: { id: approvalId, status: 'denied' },
            ...(denyResultRecorded ? { recorded: denyResultRecorded } : {}),
          });
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
      permissions: {
        rules: {
          list: () => Promise.resolve({ rules: rulesFixture }),
          delete: (ruleId: string) => {
            ruleDeleteCalls.push(ruleId);
            if (ruleDeleteResult) rulesFixture = rulesFixture.filter((r) => r.id !== ruleId);
            return Promise.resolve({ deleted: ruleDeleteResult });
          },
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
  approveResultDecision = undefined;
  approveResultRecorded = undefined;
  denyResultRecorded = undefined;
  ruleDeleteCalls.length = 0;
  rulesFixture = [];
  ruleDeleteResult = true;
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
    expect(denyCalls[0]).toEqual({ approvalId: 'appr-cmd' });
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

// ─── Remember tiers, deny reason, exec-prompt, durable rules (rounds 4-6) ────

const REMEMBER_OPTIONS = [
  { tier: 'session', label: 'for the rest of this session', detail: 'in-memory only; forgotten on restart' },
  { tier: 'exact', label: 'this exact command', detail: 'bun test' },
  { tier: 'command-class', label: 'every bun command', detail: 'bun ...' },
  { tier: 'tool', label: 'always for the bash tool in this project', detail: 'every bash call, any arguments' },
];

const REMEMBER_FIXTURE = {
  ...APPROVALS_FIXTURE,
  approvals: [{
    id: 'appr-remember', callId: 'call-r1', status: 'pending', createdAt: 300, updatedAt: 300, metadata: {},
    request: {
      callId: 'call-r1', tool: 'bash', args: { commands: ['bun test'] }, category: 'execute',
      analysis: analysis({ summary: 'run bun test' }),
      rememberOptions: REMEMBER_OPTIONS,
    },
  }],
};

const EXEC_PROMPT_FIXTURE = {
  ...APPROVALS_FIXTURE,
  approvals: [{
    id: 'appr-exec-prompt', callId: 'exec-prompt-1', status: 'pending', createdAt: 300, updatedAt: 300,
    metadata: { source: 'exec-prompt', command: 'ssh host' },
    request: {
      callId: 'exec-prompt-1', tool: 'exec:prompt',
      args: { command: 'ssh host', prompt: 'Continue connecting (yes/no)?', recentOutput: 'fingerprint…\nContinue connecting (yes/no)?' },
      category: 'execute',
      analysis: analysis({ summary: 'A running command is waiting on its terminal' }),
      attribution: { kind: 'exec-prompt', command: 'ssh host', prompt: 'Continue connecting (yes/no)?' },
    },
  }],
};

function renderWith(fixture: unknown): { el: HTMLElement; unmount: () => void } {
  approvalsListImpl = () => Promise.resolve(fixture);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.approvals, fixture);
  client.setQueryData(queryKeys.tasks, TASKS_FIXTURE);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(ToastProvider, null, React.createElement(ApprovalsTasksView), React.createElement(ToastViewport)),
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

function setInput(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error('input not found');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  flushSync(() => {
    setter?.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

function setSelect(select: HTMLSelectElement | null, value: string) {
  if (!select) throw new Error('select not found');
  flushSync(() => {
    select.value = value;
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}

describe('ApprovalsTasksView — remember tiers', () => {
  test('the ask\'s rememberOptions render verbatim with "just this once" as the default', () => {
    const { el, unmount } = renderWith(REMEMBER_FIXTURE);
    const select = el.querySelector('.approval-card__remember select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    const optionTexts = [...select.querySelectorAll('option')].map((o) => o.textContent);
    expect(optionTexts[0]).toBe('just this once');
    expect(optionTexts.some((t) => t?.includes('every bun command'))).toBe(true);
    expect(optionTexts.some((t) => t?.includes('this exact command'))).toBe(true);
    // Durable tiers say they persist; session does not.
    expect(optionTexts.find((t) => t?.includes('every bun command'))).toContain('(saved as a rule)');
    expect(optionTexts.find((t) => t?.includes('for the rest of this session'))).not.toContain('(saved as a rule)');
    expect(select.value).toBe('');
    unmount();
  });

  test('approving with a tier sends rememberTier+remember, and a recording daemon yields the remembered toast', async () => {
    approveResultDecision = { approved: true, remember: true, rememberTier: 'command-class' };
    const { el, unmount } = renderWith(REMEMBER_FIXTURE);
    setSelect(el.querySelector('.approval-card__remember select'), 'command-class');
    click(el.querySelector('.approval-card__approve-all'));
    await waitFor(() => approveCalls.length > 0);
    expect(approveCalls[0]).toEqual({
      approvalId: 'appr-remember',
      remember: true,
      rememberTier: 'command-class',
    });
    await waitFor(() => Boolean(document.querySelector('.toast')));
    expect(document.body.textContent).toContain('Remembered (command-class)');
    unmount();
  });

  test('a daemon that does not record the remember request gets reported honestly, never claimed', async () => {
    approveResultDecision = { approved: true };
    const { el, unmount } = renderWith(REMEMBER_FIXTURE);
    setSelect(el.querySelector('.approval-card__remember select'), 'tool');
    click(el.querySelector('.approval-card__approve-all'));
    await waitFor(() => approveCalls.length > 0);
    await waitFor(() => Boolean(document.querySelector('.toast')));
    expect(document.body.textContent).toContain('did not record the remember request');
    expect(document.body.textContent).not.toContain('Remembered (');
    unmount();
  });

  test('the response `recorded` block is authoritative — a tier it reports drives the toast even with a silent decision snapshot', async () => {
    approveResultDecision = undefined; // decision carries no tier
    approveResultRecorded = { approved: true, rememberTier: 'command-class', reasonStored: false, modifiedArgsDelivered: false };
    const { el, unmount } = renderWith(REMEMBER_FIXTURE);
    setSelect(el.querySelector('.approval-card__remember select'), 'command-class');
    click(el.querySelector('.approval-card__approve-all'));
    await waitFor(() => approveCalls.length > 0);
    await waitFor(() => Boolean(document.querySelector('.toast')));
    expect(document.body.textContent).toContain('Remembered (command-class)');
    unmount();
  });

  test('a recorded block that recorded no tier is honest even when the client asked for one', async () => {
    // The block is authoritative: it explicitly recorded null, so no claim is made.
    approveResultRecorded = { approved: true, rememberTier: null, reasonStored: false, modifiedArgsDelivered: false };
    const { el, unmount } = renderWith(REMEMBER_FIXTURE);
    setSelect(el.querySelector('.approval-card__remember select'), 'tool');
    click(el.querySelector('.approval-card__approve-all'));
    await waitFor(() => approveCalls.length > 0);
    await waitFor(() => Boolean(document.querySelector('.toast')));
    expect(document.body.textContent).toContain('did not record the remember request');
    expect(document.body.textContent).not.toContain('Remembered (');
    unmount();
  });

  test('approving without touching the picker sends no remember fields', async () => {
    const { el, unmount } = renderWith(REMEMBER_FIXTURE);
    click(el.querySelector('.approval-card__approve-all'));
    await waitFor(() => approveCalls.length > 0);
    expect(approveCalls[0]).toEqual({ approvalId: 'appr-remember' });
    unmount();
  });
});

describe('ApprovalsTasksView — deny carries an optional reason', () => {
  test('a typed reason rides the deny call as note AND reason (one text, both wire fields)', async () => {
    const { el, unmount } = renderWith(REMEMBER_FIXTURE);
    const details = el.querySelector('.approval-card__deny-reason') as HTMLDetailsElement;
    expect(details).not.toBeNull();
    details.open = true;
    setInput(el.querySelector('.approval-card__deny-reason input'), 'wrong branch — run it on main');
    click(el.querySelector('.approval-card__deny'));
    await waitFor(() => denyCalls.length > 0);
    expect(denyCalls[0]).toEqual({
      approvalId: 'appr-remember',
      note: 'wrong branch — run it on main',
      reason: 'wrong branch — run it on main',
    });
    unmount();
  });

  test('the denial toast claims the reason was fed back only when the recorded block stored it', async () => {
    denyResultRecorded = { approved: false, rememberTier: null, reasonStored: true, modifiedArgsDelivered: false };
    const { el, unmount } = renderWith(REMEMBER_FIXTURE);
    (el.querySelector('.approval-card__deny-reason') as HTMLDetailsElement).open = true;
    setInput(el.querySelector('.approval-card__deny-reason input'), 'wrong branch');
    click(el.querySelector('.approval-card__deny'));
    await waitFor(() => denyCalls.length > 0);
    await waitFor(() => Boolean(document.querySelector('.toast')));
    expect(document.body.textContent).toContain('Reason fed back with the denial.');
    unmount();
  });

  test('a reason the daemon did not store is not claimed as fed back', async () => {
    denyResultRecorded = { approved: false, rememberTier: null, reasonStored: false, modifiedArgsDelivered: false };
    const { el, unmount } = renderWith(REMEMBER_FIXTURE);
    (el.querySelector('.approval-card__deny-reason') as HTMLDetailsElement).open = true;
    setInput(el.querySelector('.approval-card__deny-reason input'), 'wrong branch');
    click(el.querySelector('.approval-card__deny'));
    await waitFor(() => denyCalls.length > 0);
    await waitFor(() => Boolean(document.querySelector('.toast')));
    expect(document.body.textContent).toContain('Denied');
    expect(document.body.textContent).not.toContain('Reason fed back');
    unmount();
  });

  test('a resolved denial with a recorded reason renders it on the history card', () => {
    const fixture = {
      ...APPROVALS_FIXTURE,
      approvals: [{
        id: 'appr-denied-reason', callId: 'c', status: 'denied', resolvedAt: 100, resolvedBy: 'operator',
        createdAt: 90, updatedAt: 100, metadata: {},
        request: { callId: 'c', tool: 'exec', args: {}, category: 'execute', analysis: analysis() },
        decision: { approved: false, reason: 'too broad' },
      }],
    };
    const { el, unmount } = renderWith(fixture);
    expect(el.querySelector('.approval-card__note')?.textContent).toContain('reason: too broad');
    unmount();
  });
});

describe('ApprovalsTasksView — exec-prompt answerable card', () => {
  test('renders the waiting command, the prompt line, and the recent output', () => {
    const { el, unmount } = renderWith(EXEC_PROMPT_FIXTURE);
    const card = el.querySelector('[data-testid="exec-prompt-card"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('ssh host');
    expect(card?.textContent).toContain('Continue connecting (yes/no)?');
    expect(card?.querySelector('.approval-card__exec-output')?.textContent).toContain('fingerprint…');
    unmount();
  });

  test('Send answer is gated on text and approves with modifiedArgs.answer feeding the run', async () => {
    approveResultDecision = { approved: true, modifiedArgs: { answer: 'yes' } };
    const { el, unmount } = renderWith(EXEC_PROMPT_FIXTURE);
    const send = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Send answer'));
    expect(send?.disabled).toBe(true);
    setInput(el.querySelector('.approval-card__exec-answer input'), 'yes');
    expect(send?.disabled).toBe(false);
    click(send);
    await waitFor(() => approveCalls.length > 0);
    expect(approveCalls[0]).toEqual({ approvalId: 'appr-exec-prompt', modifiedArgs: { answer: 'yes' } });
    await waitFor(() => Boolean(document.querySelector('.toast')));
    expect(document.body.textContent).toContain('Answer sent');
    unmount();
  });

  test('the recorded block drives the answer-sent claim — delivered only when it says so', async () => {
    // Decision snapshot is silent; the authoritative block reports delivery.
    approveResultRecorded = { approved: true, rememberTier: null, reasonStored: false, modifiedArgsDelivered: true };
    const { el, unmount } = renderWith(EXEC_PROMPT_FIXTURE);
    setInput(el.querySelector('.approval-card__exec-answer input'), 'yes');
    click([...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Send answer')));
    await waitFor(() => approveCalls.length > 0);
    await waitFor(() => Boolean(document.querySelector('.toast')));
    expect(document.body.textContent).toContain('Answer sent');
    unmount();
  });

  test('an answer the daemon did not deliver is reported honestly, not claimed as sent', async () => {
    approveResultRecorded = { approved: true, rememberTier: null, reasonStored: false, modifiedArgsDelivered: false };
    const { el, unmount } = renderWith(EXEC_PROMPT_FIXTURE);
    setInput(el.querySelector('.approval-card__exec-answer input'), 'yes');
    click([...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Send answer')));
    await waitFor(() => approveCalls.length > 0);
    await waitFor(() => Boolean(document.querySelector('.toast')));
    expect(document.body.textContent).toContain('did not record the answer');
    unmount();
  });

  test('Stop command denies the ask (optionally with a reason)', async () => {
    const { el, unmount } = renderWith(EXEC_PROMPT_FIXTURE);
    const stop = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Stop command'));
    click(stop);
    await waitFor(() => denyCalls.length > 0);
    expect(denyCalls[0]).toEqual({ approvalId: 'appr-exec-prompt' });
    unmount();
  });
});

describe('PermissionRulesSection — durable approval rules', () => {
  test('lists every rule with effect, tier, tool, and delete; delete revokes', async () => {
    rulesFixture = [
      { id: 'rule-1', effect: 'allow', tier: 'command-class', tool: 'bash', description: 'bun ...', createdAt: 400 },
      { id: 'rule-2', effect: 'deny', tier: 'tool', tool: 'fetch', createdAt: 500 },
    ];
    const { el, unmount } = renderWith(APPROVALS_FIXTURE);
    await waitFor(() => el.querySelectorAll('.permission-rule-row').length === 2);
    const rows = [...el.querySelectorAll('.permission-rule-row')];
    expect(rows[0].textContent).toContain('Allow · command-class · bash');
    expect(rows[0].textContent).toContain('bun ...');
    expect(rows[1].textContent).toContain('Deny · tool · fetch');
    click(rows[0].querySelector('.permission-rule-row__delete'));
    await waitFor(() => ruleDeleteCalls.length > 0);
    expect(ruleDeleteCalls[0]).toBe('rule-1');
    await waitFor(() => el.querySelectorAll('.permission-rule-row').length === 1);
    unmount();
  });

  test('an empty rule store renders the honest empty state, never a fake row', async () => {
    const { el, unmount } = renderWith(APPROVALS_FIXTURE);
    await waitFor(() => Boolean(el.querySelector('[data-testid="permission-rules"]')));
    await waitFor(() => (el.querySelector('[data-testid="permission-rules"]')?.textContent ?? '').includes('No durable approval rules'));
    expect(el.querySelectorAll('.permission-rule-row').length).toBe(0);
    unmount();
  });

  test('deleted:false (already gone) surfaces as info, not success or error', async () => {
    rulesFixture = [{ id: 'rule-gone', effect: 'allow', tier: 'exact', tool: 'bash', createdAt: 400 }];
    ruleDeleteResult = false;
    const { el, unmount } = renderWith(APPROVALS_FIXTURE);
    await waitFor(() => el.querySelectorAll('.permission-rule-row').length === 1);
    click(el.querySelector('.permission-rule-row__delete'));
    await waitFor(() => ruleDeleteCalls.length > 0);
    await waitFor(() => Boolean(document.querySelector('.toast')));
    expect(document.body.textContent).toContain('Rule already gone');
    unmount();
  });
});
