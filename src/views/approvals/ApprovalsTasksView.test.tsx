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

const approveCalls: unknown[] = [];
const denyCalls: unknown[] = [];
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
      React.createElement(ToastProvider, null, React.createElement(ApprovalsTasksView)),
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
    const resolved = cards.find((c) => c.textContent?.includes('operator') && c.textContent?.includes('approved'));
    expect(resolved).toBeTruthy();
    expect(resolved?.querySelectorAll('.approval-card__actions').length).toBe(0);
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
