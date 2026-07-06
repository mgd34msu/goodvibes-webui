/**
 * CheckpointsView — the workspace checkpoints browser over checkpoints.* (W3-S2).
 *
 * Master/detail: list checkpoints (checkpoints.list), select one to see its
 * diff against the live working tree (checkpoints.diff), create a new
 * checkpoint, and restore a selected one (checkpoints.restore).
 *
 * checkpoints.restore is DESTRUCTIVE (a git-backed workspace rewrite) and the
 * wire verb executes with NO server-side confirmation by design (S2 ruling —
 * the calling surface owns the confirm UX). This view gates every restore
 * behind an explicit window.confirm() naming exactly what gets overwritten,
 * matching the confirm pattern App.tsx already uses for destructive chat
 * session deletes. checkpoints.create's honest noop:true result ("tree
 * unchanged") is rendered as an info toast, never as an error and never as a
 * fabricated checkpoint.
 *
 * checkpoints.* emits NO wire event yet (pinned by the SDK's own W3-S2 test
 * suite) — freshness comes from mutation-driven invalidation (create/restore
 * refetch the list) plus a manual refresh, not realtime invalidation.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, History, RefreshCw, RotateCcw } from 'lucide-react';
import { sdk } from '../../lib/goodvibes';
import type { WorkspaceCheckpoint } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import {
  CHECKPOINT_NOOP_MESSAGE,
  formatBytes,
  kindLabel,
  restoreConfirmMessage,
  retentionLabel,
  sortCheckpointsNewestFirst,
} from '../../lib/checkpoints';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';
import { formatError, errorCode } from '../../lib/errors';
import { formatRelative } from '../../lib/object';
import { useToast } from '../../lib/toast';
import '../../styles/components/checkpoints.css';

function isNotFound(error: unknown): boolean {
  return errorCode(error) === 'NOT_FOUND';
}

export function CheckpointsView() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState('');
  const [labelDraft, setLabelDraft] = useState('');

  const list = useQuery({
    queryKey: queryKeys.checkpoints,
    queryFn: () => sdk.operator.checkpoints.list(),
  });

  const checkpoints = useMemo(
    () => sortCheckpointsNewestFirst(list.data?.checkpoints ?? []),
    [list.data],
  );
  const selected = useMemo(() => checkpoints.find((c) => c.id === selectedId) ?? null, [checkpoints, selectedId]);

  const diff = useQuery({
    queryKey: [...queryKeys.checkpoints, selectedId, 'diff'],
    queryFn: () => sdk.operator.checkpoints.diff({ a: selectedId }),
    enabled: Boolean(selectedId),
  });

  const create = useMutation({
    mutationFn: () => {
      const trimmed = labelDraft.trim();
      return sdk.operator.checkpoints.create({ kind: 'manual', label: trimmed ? trimmed : undefined });
    },
    onSuccess: async (result) => {
      if (result.noop) {
        toast({ title: 'No checkpoint created', description: CHECKPOINT_NOOP_MESSAGE, tone: 'info' });
        return;
      }
      setLabelDraft('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.checkpoints });
      const created = result.checkpoint;
      if (created) {
        setSelectedId(created.id);
        toast({ title: 'Checkpoint created', description: created.label || created.id, tone: 'success' });
      }
    },
    onError: (error: unknown) => {
      toast({ title: 'Failed to create checkpoint', description: formatError(error), tone: 'danger' });
    },
  });

  const restore = useMutation({
    mutationFn: (checkpoint: WorkspaceCheckpoint) => sdk.operator.checkpoints.restore({ id: checkpoint.id }),
    onSuccess: async (_result, checkpoint) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.checkpoints });
      toast({ title: 'Workspace restored', description: checkpoint.label || checkpoint.id, tone: 'success' });
    },
    onError: (error: unknown, checkpoint) => {
      toast({
        title: isNotFound(error) ? 'Checkpoint no longer exists' : 'Restore failed',
        description: isNotFound(error)
          ? `"${checkpoint.label || checkpoint.id}" was not found — it may have been garbage-collected.`
          : formatError(error),
        tone: 'danger',
      });
    },
  });

  const [restoringId, setRestoringId] = useState('');

  function handleRestore(checkpoint: WorkspaceCheckpoint): void {
    if (!window.confirm(restoreConfirmMessage(checkpoint))) return;
    setRestoringId(checkpoint.id);
    restore.mutate(checkpoint);
  }

  return (
    <div className="checkpoints-view">
      <div className="checkpoints-list-pane">
        <div className="checkpoints-toolbar">
          <input
            type="text"
            className="checkpoints-label-input"
            placeholder="Checkpoint label (optional)"
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            disabled={create.isPending}
          />
          <button
            type="button"
            className="checkpoints-create-button"
            onClick={() => create.mutate()}
            disabled={create.isPending}
            title="Create a checkpoint of the current workspace"
          >
            <Camera size={14} /> {create.isPending ? 'Snapshotting…' : 'Snapshot'}
          </button>
          <button className="icon-button" type="button" title="Refresh" onClick={() => void list.refetch()}>
            <RefreshCw size={15} />
          </button>
        </div>

        {list.isPending && (
          <div className="checkpoints-loading">
            <SkeletonBlock variant="text" lines={4} />
          </div>
        )}

        {list.isError && (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load checkpoints" />
        )}

        {list.isSuccess && !checkpoints.length && (
          <EmptyState
            icon={<History size={28} />}
            title="No checkpoints yet"
            description="Create one to capture the current workspace tree, or checkpoints are created automatically per turn/agent-run depending on daemon config."
            action={{ label: 'Snapshot now', onClick: () => create.mutate() }}
          />
        )}

        {list.isSuccess && checkpoints.length > 0 && (
          <ul className="checkpoints-rows">
            {checkpoints.map((checkpoint) => (
              <li key={checkpoint.id}>
                <button
                  type="button"
                  className={`checkpoints-row${checkpoint.id === selectedId ? ' active' : ''}`}
                  onClick={() => setSelectedId(checkpoint.id)}
                >
                  <span className="checkpoints-row__title">{checkpoint.label || checkpoint.id}</span>
                  <span className="checkpoints-row__badges">
                    <span className="badge neutral">{kindLabel(checkpoint.kind)}</span>
                    <span className="badge neutral">{retentionLabel(checkpoint.retentionClass)}</span>
                    <span className="checkpoints-row__meta">{formatRelative(checkpoint.createdAt)} · {formatBytes(checkpoint.sizeBytes)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="checkpoints-detail-pane">
        {selected ? (
          <CheckpointDetail
            checkpoint={selected}
            diff={diff.data ?? null}
            diffPending={diff.isPending}
            diffError={diff.isError ? diff.error : null}
            onRetryDiff={() => void diff.refetch()}
            onRestore={() => handleRestore(selected)}
            restoring={restore.isPending && restoringId === selected.id}
          />
        ) : (
          <div className="checkpoints-detail-empty">Select a checkpoint to view its diff.</div>
        )}
      </div>
    </div>
  );
}

function CheckpointDetail({
  checkpoint,
  diff,
  diffPending,
  diffError,
  onRetryDiff,
  onRestore,
  restoring,
}: {
  checkpoint: WorkspaceCheckpoint;
  diff: { diff: { from: string; to: string; files: readonly string[]; unifiedDiff: string; stat: string } } | null;
  diffPending: boolean;
  diffError: unknown;
  onRetryDiff: () => void;
  onRestore: () => void;
  restoring: boolean;
}) {
  return (
    <div className="checkpoint-detail">
      <header className="checkpoint-detail__header">
        <h2>{checkpoint.label || checkpoint.id}</h2>
        <div className="checkpoint-detail__badges">
          <span className="badge neutral">{kindLabel(checkpoint.kind)}</span>
          <span className="badge neutral">{retentionLabel(checkpoint.retentionClass)}</span>
          <span className="badge neutral">{formatBytes(checkpoint.sizeBytes)}</span>
        </div>
        <div className="checkpoint-detail__meta">
          <small>Created {formatRelative(checkpoint.createdAt)}</small>
          <small>· commit {checkpoint.commit.slice(0, 12) || 'unknown'}</small>
          {checkpoint.parentId && <small>· parent {checkpoint.parentId}</small>}
        </div>
        <button
          type="button"
          className="checkpoint-detail__restore"
          onClick={onRestore}
          disabled={restoring}
          title="Restore the workspace to this checkpoint (destructive — confirms first)"
        >
          <RotateCcw size={14} /> {restoring ? 'Restoring…' : 'Restore this checkpoint'}
        </button>
      </header>

      <div className="checkpoint-detail__diff">
        <strong>Diff vs. working tree</strong>
        {diffPending && <SkeletonBlock variant="text" lines={6} />}
        {diffError ? (
          isNotFound(diffError)
            ? <div className="checkpoints-empty" role="note">This checkpoint no longer exists (it may have been garbage-collected).</div>
            : <ErrorState error={diffError} onRetry={onRetryDiff} title="Failed to load diff" />
        ) : null}
        {diff && !diffError && (
          <>
            {diff.diff.files.length === 0 ? (
              <div className="checkpoints-empty" role="note">No file differences from the working tree.</div>
            ) : (
              <p className="checkpoint-detail__diff-files">{diff.diff.files.length} file{diff.diff.files.length === 1 ? '' : 's'} changed: {diff.diff.files.join(', ')}</p>
            )}
            {diff.diff.unifiedDiff && <pre className="checkpoint-detail__diff-pre">{diff.diff.unifiedDiff}</pre>}
          </>
        )}
      </div>
    </div>
  );
}
