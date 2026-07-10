/**
 * ApprovalsTasksView — Approvals + Tasks.
 *
 * Approvals: lists pending/claimed/historical approvals (approvals.list). The
 * hero interaction is per-hunk edit approval: a pending `edit` tool
 * approval's `request.args.edits` are rendered as individually selectable
 * hunks. "Approve selected" sends `approvals.approve({ selectedHunks })` — an
 * INDEX ARRAY ONLY. This view never computes the modified edit itself; the
 * daemon's moved `buildModifiedEditArgs` (approval-hunk-apply.ts) is the single
 * source of the applied result, so the webui and the TUI always agree. Omitting
 * a selection ("Approve all") is exact back-compat with the pre-S3 whole-request
 * approve. A claimed-by-another-surface approval renders as claimed and is
 * NOT actionable here (two surfaces must never both resolve one approval); a
 * resolved (approved/denied/cancelled/expired) approval renders as history,
 * never with action buttons.
 *
 * Claim locks a pending approval (still not actionable-by-self afterward — see
 * ApprovalCard.tsx); Cancel withdraws a pending approval without deciding it.
 * ApprovalClassMatrix (above the list) breaks the loaded set down by category ×
 * risk level (WEBUI-FLEET-DEPTH).
 *
 * Tasks: list/create/cancel/retry over the existing tasks.* verbs
 * (method-catalog-control-core.ts). Statuses are rendered verbatim — no
 * invented "in progress" percentage, no synthesized ETA. Cancel is offered
 * only when the task reports itself cancellable; retry only for a
 * failed/cancelled task (TaskManager.retryTask's own transition guard).
 *
 * Realtime: approval-update rides the `permissions` domain and task events
 * ride the `tasks` domain — both already wired into
 * useRealtimeInvalidation's DOMAIN_INVALIDATIONS (W1); this view adds no new
 * subscription, it only benefits from the existing one.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardCheck,
  ListTodo,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { sdk } from '../../lib/goodvibes';
import type { RuntimeTaskSummary } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import { readApprovalEditHunks, riskTone, sortApprovalsNewestFirst } from '../../lib/approvals';
import { parseApprovalActionFromHash, stripApprovalActionFragment } from '../../lib/push/approval-action-link';
import { ApprovalCard } from './ApprovalCard';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';
import { useConfirmSheet } from '../../components/confirm/useConfirmSheet';
import { useIsPhoneViewport } from '../../hooks/useIsPhoneViewport';
import { formatError, isSessionClosedError } from '../../lib/errors';
import { useToast } from '../../lib/toast';
import '../../styles/components/approvals.css';

/** Neither approvals.* nor tasks.* emits an event this view doesn't already
 * subscribe to (permissions/tasks domains, W1) — no extra poll needed beyond
 * the default staleness the realtime invalidation keeps fresh. A slow manual
 * refresh button is offered for the honest "nothing has arrived yet" case. */

function friendlyError(error: unknown): string {
  if (isSessionClosedError(error)) return 'That session is closed — the approval or task can no longer be actioned.';
  return formatError(error);
}

export function ApprovalsTasksView() {
  return (
    <div className="approvals-tasks-view">
      <ApprovalsSection />
      <TasksSection />
    </div>
  );
}

// ─── Approvals ───────────────────────────────────────────────────────────────

function ApprovalsSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selections, setSelections] = useState<Record<string, ReadonlySet<number>>>({});

  const approvals = useQuery({
    queryKey: queryKeys.approvals,
    queryFn: () => sdk.operator.approvals.list(),
  });

  const rows = useMemo(
    () => sortApprovalsNewestFirst(approvals.data?.approvals ?? []),
    [approvals.data],
  );

  function toggleHunk(approvalId: string, index: number): void {
    setSelections((current) => {
      const existing = new Set(current[approvalId] ?? []);
      if (existing.has(index)) existing.delete(index);
      else existing.add(index);
      return { ...current, [approvalId]: existing };
    });
  }

  const approve = useMutation({
    mutationFn: ({ id, selectedHunks }: { id: string; selectedHunks?: readonly number[]; totalHunks?: number }) =>
      sdk.operator.approvals.approve(id, selectedHunks && selectedHunks.length > 0 ? { selectedHunks } : undefined),
    onSuccess: async (_result, variables) => {
      setSelections((current) => {
        const { [variables.id]: _removed, ...rest } = current;
        return rest;
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.approvals });
      // A subset was sent only when selectedHunks is non-empty AND shorter than
      // the full hunk count on the request — selecting every hunk (or omitting
      // selectedHunks entirely, "Approve all") is a full approval, not a subset.
      const selectedCount = variables.selectedHunks?.length ?? 0;
      const isPartial = selectedCount > 0
        && variables.totalHunks !== undefined
        && selectedCount < variables.totalHunks;
      toast({
        title: isPartial ? `Approved ${selectedCount} of ${variables.totalHunks} hunks` : 'Approved',
        tone: 'success',
      });
    },
    onError: (error: unknown) => {
      toast({ title: 'Approve failed', description: friendlyError(error), tone: 'danger' });
    },
  });

  const deny = useMutation({
    mutationFn: (id: string) => sdk.operator.approvals.deny(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.approvals });
      toast({ title: 'Denied', tone: 'info' });
    },
    onError: (error: unknown) => {
      toast({ title: 'Deny failed', description: friendlyError(error), tone: 'danger' });
    },
  });

  // Claim/cancel (WEBUI-FLEET-DEPTH — approvals depth): both operate on 'pending'
  // approvals only, same as approve/deny. Claim does NOT unlock further action here —
  // see ApprovalCard's header comment on why "claimed by me" can't be told apart from
  // "claimed by another surface sharing the same token".
  const claim = useMutation({
    mutationFn: (id: string) => sdk.operator.approvals.claim(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.approvals });
      toast({ title: 'Claimed', tone: 'info' });
    },
    onError: (error: unknown) => {
      toast({ title: 'Claim failed', description: friendlyError(error), tone: 'danger' });
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => sdk.operator.approvals.cancel(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.approvals });
      toast({ title: 'Cancelled', tone: 'info' });
    },
    onError: (error: unknown) => {
      toast({ title: 'Cancel failed', description: friendlyError(error), tone: 'danger' });
    },
  });

  // Push-notification action hand-off: an "Allow"/"Deny" tap opens the app at
  // #approval-action=…&approval-id=… (the service worker cannot approve itself).
  // This authenticated surface completes the real call on mount, once. The ref
  // guards it across React StrictMode's double effect; the fragment is scrubbed
  // so a reload does not re-fire it. approve/deny surface their own toasts.
  const handoffDoneRef = useRef(false);
  useEffect(() => {
    if (handoffDoneRef.current) return;
    const intent = parseApprovalActionFromHash(window.location.hash);
    if (!intent) return;
    handoffDoneRef.current = true;
    stripApprovalActionFragment();
    if (intent.action === 'approve') approve.mutate({ id: intent.approvalId });
    else deny.mutate(intent.approvalId);
    // Mount-once hand-off; approve/deny are stable mutation handles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="approvals-section">
      <div className="approvals-toolbar">
        <span className="approvals-toolbar__summary">
          <ClipboardCheck size={14} /> Approvals
          {approvals.isSuccess && ` · ${rows.filter((r) => r.status === 'pending').length} pending`}
        </span>
        <button className="icon-button" type="button" title="Refresh" onClick={() => void approvals.refetch()}>
          <RefreshCw size={15} className={approvals.isFetching ? 'spin' : undefined} />
        </button>
      </div>

      {approvals.isSuccess && rows.length > 0 && <ApprovalClassMatrix rows={rows} />}

      {approvals.isPending && <SkeletonBlock variant="text" lines={4} />}

      {approvals.isError && (
        <ErrorState error={approvals.error} onRetry={() => void approvals.refetch()} title="Failed to load approvals" />
      )}

      {approvals.isSuccess && rows.length === 0 && (
        <EmptyState
          icon={<ClipboardCheck size={28} />}
          title="No pending approvals"
          description="Approval requests from agents and tools will appear here while they wait for a decision."
        />
      )}

      {approvals.isSuccess && rows.length > 0 && (
        <ul className="approvals-rows">
          {rows.map((record) => (
            <ApprovalCard
              key={record.id}
              record={record}
              selected={selections[record.id] ?? new Set<number>()}
              onToggleHunk={(index) => toggleHunk(record.id, index)}
              onApprove={(selectedHunks) => approve.mutate({
                id: record.id,
                selectedHunks,
                totalHunks: readApprovalEditHunks(record)?.length,
              })}
              onDeny={() => deny.mutate(record.id)}
              onClaim={() => claim.mutate(record.id)}
              onCancel={() => cancel.mutate(record.id)}
              approving={approve.isPending && approve.variables?.id === record.id}
              denying={deny.isPending && deny.variables === record.id}
              claiming={claim.isPending && claim.variables === record.id}
              cancelling={cancel.isPending && cancel.variables === record.id}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * ApprovalClassMatrix — an at-a-glance category × risk breakdown of the approvals
 * currently loaded, the "approval-class matrix" parity depth the TUI's fleet
 * mega-panel offers. Grounded entirely in fields already on ApprovalRecord
 * (request.category, request.analysis.riskLevel) — no new wire call. Both are open
 * strings (a daemon-defined vocabulary this client renders verbatim, never drops an
 * unrecognized value), so the matrix groups by whatever strings are actually present
 * rather than a fixed enum.
 */
function ApprovalClassMatrix({ rows }: { rows: readonly import('../../lib/goodvibes').ApprovalRecord[] }) {
  const matrix = useMemo(() => {
    const byCategory = new Map<string, Map<string, number>>();
    for (const record of rows) {
      const category = record.request.category || 'uncategorized';
      const risk = record.request.analysis.riskLevel || 'unknown';
      const byRisk = byCategory.get(category) ?? new Map<string, number>();
      byRisk.set(risk, (byRisk.get(risk) ?? 0) + 1);
      byCategory.set(category, byRisk);
    }
    return [...byCategory.entries()]
      .map(([category, byRisk]) => ({
        category,
        total: [...byRisk.values()].reduce((sum, n) => sum + n, 0),
        byRisk: [...byRisk.entries()].sort((a, b) => b[1] - a[1]),
      }))
      .sort((a, b) => b.total - a.total);
  }, [rows]);

  if (matrix.length === 0) return null;

  return (
    <div className="approval-class-matrix" role="table" aria-label="Approvals by category and risk">
      {matrix.map(({ category, total, byRisk }) => (
        <div key={category} className="approval-class-matrix__row" role="row">
          <span className="approval-class-matrix__category" role="cell">{category}</span>
          <span className="approval-class-matrix__total badge neutral" role="cell">{total}</span>
          <span className="approval-class-matrix__risks" role="cell">
            {byRisk.map(([risk, count]) => (
              <span key={risk} className={`badge ${riskTone(risk)}`}>{risk} × {count}</span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

function TasksSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isPhone = useIsPhoneViewport();
  const confirm = useConfirmSheet();
  const [taskDraft, setTaskDraft] = useState('');

  const tasks = useQuery({
    queryKey: queryKeys.tasks,
    queryFn: () => sdk.operator.tasks.list(),
  });

  const rows = useMemo(() => tasks.data?.tasks ?? [], [tasks.data]);

  const create = useMutation({
    mutationFn: () => sdk.operator.tasks.create({ task: taskDraft.trim() }),
    onSuccess: async () => {
      setTaskDraft('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      toast({ title: 'Task submitted', tone: 'success' });
    },
    onError: (error: unknown) => {
      toast({ title: 'Failed to submit task', description: friendlyError(error), tone: 'danger' });
    },
  });

  const cancel = useMutation({
    mutationFn: (taskId: string) => sdk.operator.tasks.cancel(taskId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      toast({ title: 'Task cancelled', tone: 'info' });
    },
    onError: (error: unknown) => {
      toast({ title: 'Cancel failed', description: friendlyError(error), tone: 'danger' });
    },
  });

  const retry = useMutation({
    mutationFn: (taskId: string) => sdk.operator.tasks.retry(taskId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      toast({ title: 'Task retried', tone: 'success' });
    },
    onError: (error: unknown) => {
      toast({ title: 'Retry failed', description: friendlyError(error), tone: 'danger' });
    },
  });

  // Task submit/cancel/retry are AVAILABLE on phone now (no longer hidden). On a
  // phone each routes through a confirm sheet first, naming the task; desktop keeps
  // its existing bare one-click behavior.
  async function handleSubmit(): Promise<void> {
    const task = taskDraft.trim();
    if (!task || create.isPending) return;
    if (isPhone && !(await confirm.ask({ title: 'Submit this task', target: task, confirmLabel: 'Submit' }))) return;
    create.mutate();
  }

  async function handleCancel(task: RuntimeTaskSummary): Promise<void> {
    if (isPhone && !(await confirm.ask({
      title: 'Cancel this task',
      target: task.title || task.id,
      confirmLabel: 'Cancel task',
      cancelLabel: 'Keep running',
      tone: 'danger',
    }))) return;
    cancel.mutate(task.id);
  }

  async function handleRetry(task: RuntimeTaskSummary): Promise<void> {
    if (isPhone && !(await confirm.ask({
      title: 'Retry this task',
      target: task.title || task.id,
      confirmLabel: 'Retry',
    }))) return;
    retry.mutate(task.id);
  }

  return (
    <section className="tasks-section">
      {confirm.element}
      <div className="tasks-toolbar">
        <span className="tasks-toolbar__summary">
          <ListTodo size={14} /> Tasks
          {tasks.isSuccess && ` · ${tasks.data.queued} queued · ${tasks.data.running} running · ${tasks.data.blocked} blocked`}
        </span>
        <button className="icon-button" type="button" title="Refresh" onClick={() => void tasks.refetch()}>
          <RefreshCw size={15} className={tasks.isFetching ? 'spin' : undefined} />
        </button>
      </div>

      <form
        className="tasks-create"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
      >
        <input
          type="text"
          className="tasks-create__input"
          placeholder="Describe a task to submit"
          value={taskDraft}
          onChange={(e) => setTaskDraft(e.target.value)}
          disabled={create.isPending}
        />
        <button type="submit" className="tasks-create__button" disabled={!taskDraft.trim() || create.isPending}>
          <PlusCircle size={14} /> {create.isPending ? 'Submitting…' : 'Submit'}
        </button>
      </form>

      {tasks.isPending && <SkeletonBlock variant="text" lines={4} />}

      {tasks.isError && (
        <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} title="Failed to load tasks" />
      )}

      {tasks.isSuccess && rows.length === 0 && (
        <EmptyState icon={<ListTodo size={28} />} title="No tasks" description="Submitted and running runtime tasks will appear here." />
      )}

      {tasks.isSuccess && rows.length > 0 && (
        <ul className="tasks-rows">
          {rows.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onCancel={() => void handleCancel(task)}
              onRetry={() => void handleRetry(task)}
              cancelling={cancel.isPending && cancel.variables === task.id}
              retrying={retry.isPending && retry.variables === task.id}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function TaskRow({
  task,
  onCancel,
  onRetry,
  cancelling,
  retrying,
}: {
  task: RuntimeTaskSummary;
  onCancel: () => void;
  onRetry: () => void;
  cancelling: boolean;
  retrying: boolean;
}) {
  const canRetry = task.status === 'failed' || task.status === 'cancelled';
  return (
    <li className="task-row">
      <div className="task-row__main">
        <span className="task-row__title">{task.title || task.id}</span>
        <span className="task-row__badges">
          <span className="badge neutral">{task.kind}</span>
          <span className={`badge ${task.status === 'failed' ? 'bad' : task.status === 'completed' ? 'ok' : 'neutral'}`}>{task.status}</span>
        </span>
      </div>
      <div className="task-row__meta">
        <small>owner {task.owner}</small>
        {task.error && <small className="task-row__error">· {task.error}</small>}
      </div>
      <div className="task-row__actions">
        {task.cancellable && (
          <button type="button" className="task-row__cancel" disabled={cancelling} onClick={onCancel}>
            <XCircle size={13} /> Cancel
          </button>
        )}
        {canRetry && (
          <button type="button" className="task-row__retry" disabled={retrying} onClick={onRetry}>
            <RotateCcw size={13} /> Retry
          </button>
        )}
      </div>
    </li>
  );
}
