/**
 * ApprovalsTasksView — Approvals + Tasks (W3-W2).
 *
 * Approvals: lists pending/claimed/historical approvals (approvals.list). The
 * hero interaction is per-hunk edit approval (W3-S3): a pending `edit` tool
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

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  Check,
  ClipboardCheck,
  ListTodo,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { sdk } from '../../lib/goodvibes';
import type { ApprovalRecord, RuntimeTaskSummary } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import {
  hunkSummary,
  isActionableApproval,
  isTerminalApprovalStatus,
  partialApprovalLabel,
  readApprovalEditHunks,
  riskTone,
  sortApprovalsNewestFirst,
  statusLabel,
  statusTone,
} from '../../lib/approvals';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';
import { formatError, isSessionClosedError } from '../../lib/errors';
import { formatRelative } from '../../lib/object';
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
              approving={approve.isPending && approve.variables?.id === record.id}
              denying={deny.isPending && deny.variables === record.id}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ApprovalCard({
  record,
  selected,
  onToggleHunk,
  onApprove,
  onDeny,
  approving,
  denying,
}: {
  record: ApprovalRecord;
  selected: ReadonlySet<number>;
  onToggleHunk: (index: number) => void;
  onApprove: (selectedHunks?: readonly number[]) => void;
  onDeny: () => void;
  approving: boolean;
  denying: boolean;
}) {
  const hunks = useMemo(() => readApprovalEditHunks(record), [record]);
  const actionable = isActionableApproval(record);
  const terminal = isTerminalApprovalStatus(record.status);
  const partialLabel = useMemo(() => partialApprovalLabel(record), [record]);

  return (
    <li className="approval-card">
      <header className="approval-card__header">
        <span className="approval-card__tool">{record.request.tool}</span>
        <span className="approval-card__badges">
          <span className={`badge ${riskTone(record.request.analysis.riskLevel)}`}>{record.request.analysis.riskLevel}</span>
          <span className={`badge ${statusTone(record.status)}`}>{statusLabel(record.status)}</span>
        </span>
      </header>
      <p className="approval-card__summary">{record.request.analysis.summary}</p>

      {record.status === 'claimed' && (
        <p className="approval-card__note" role="note">
          Claimed by {record.claimedBy ?? 'another surface'} — not actionable here.
        </p>
      )}

      {terminal && (
        <p className="approval-card__note" role="note">
          {statusLabel(record.status)}
          {record.resolvedAt ? ` ${formatRelative(record.resolvedAt)}` : ''}
          {record.resolvedBy ? ` by ${record.resolvedBy}` : ''}
          {partialLabel ? ` — ${partialLabel}` : ''}
        </p>
      )}

      {actionable && hunks && (
        <div className="approval-card__hunks">
          <ul className="hunk-rows">
            {hunks.map((hunk, index) => (
              <li key={hunk.id ?? index} className="hunk-row">
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(index)}
                    onChange={() => onToggleHunk(index)}
                  />
                  <span className="hunk-row__summary">{hunkSummary(hunk)}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="approval-card__actions">
            <button
              type="button"
              className="approval-card__approve-selected"
              disabled={selected.size === 0 || approving || denying}
              onClick={() => onApprove([...selected])}
              title="Approve only the checked hunks — the daemon computes the modified edit"
            >
              <Check size={14} /> Approve selected ({selected.size})
            </button>
            <button
              type="button"
              className="approval-card__approve-all"
              disabled={approving || denying}
              onClick={() => onApprove(undefined)}
            >
              <Check size={14} /> Approve all
            </button>
            <button
              type="button"
              className="approval-card__deny"
              disabled={approving || denying}
              onClick={onDeny}
            >
              <Ban size={14} /> Deny
            </button>
          </div>
        </div>
      )}

      {actionable && !hunks && (
        <div className="approval-card__actions">
          <button type="button" className="approval-card__approve-all" disabled={approving || denying} onClick={() => onApprove(undefined)}>
            <Check size={14} /> Approve
          </button>
          <button type="button" className="approval-card__deny" disabled={approving || denying} onClick={onDeny}>
            <Ban size={14} /> Deny
          </button>
        </div>
      )}

      <details className="approval-card__reasons">
        <summary>Why</summary>
        <ul>
          {record.request.analysis.reasons.map((reason, i) => <li key={i}>{reason}</li>)}
        </ul>
      </details>
    </li>
  );
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

function TasksSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
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

  return (
    <section className="tasks-section">
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
          if (!taskDraft.trim() || create.isPending) return;
          create.mutate();
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
              onCancel={() => cancel.mutate(task.id)}
              onRetry={() => retry.mutate(task.id)}
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
