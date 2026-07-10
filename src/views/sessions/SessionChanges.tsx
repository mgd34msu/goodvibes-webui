/**
 * SessionChanges — a read-only, hunk-selectable view of the file changes captured in
 * the workspace, wired so a single hunk can be commented on and that comment steered
 * into THIS session.
 *
 * DAEMON SURFACE (honest): the only file-diff the daemon exposes is workspace
 * checkpoints — checkpoints.list + checkpoints.diff (verified against the installed
 * operator contract; there is NO per-session file-diff verb, and a checkpoint carries
 * turnId/agentId but no sessionId). So this view is explicit that the diff is
 * WORKSPACE-WIDE (not filtered to this session) and is captured at a checkpoint vs. the
 * live working tree — the freshness/scope label states exactly that rather than
 * implying a per-session, up-to-the-second diff we cannot get.
 *
 * FLOW: pick a baseline checkpoint (default: the most recent) → checkpoints.diff gives a
 * unified diff → parseUnifiedDiff splits it into files + hunks → each hunk is a tap
 * target → the HunkCommentSheet composes a comment → it is sent through the SAME steer
 * path the SteerComposer/fleet needs-input flow use (sessions.steer when an agent is
 * bound, sessions.followUp otherwise), PREFIXED with a structured context block naming
 * the file, line ranges, capture source, and the hunk excerpt.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDiff, RefreshCw } from 'lucide-react';
import { sdk } from '../../lib/goodvibes';
import type { WorkspaceCheckpoint } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import { formatError, isSessionClosedError } from '../../lib/errors';
import { formatRelative } from '../../lib/object';
import { sortCheckpointsNewestFirst, kindLabel } from '../../lib/checkpoints';
import { buildHunkCommentSteer, parseUnifiedDiff, type DiffFile, type DiffHunk } from '../../lib/unified-diff';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';
import { ErrorState } from '../../components/feedback/ErrorState';
import { HunkCommentSheet } from './HunkCommentSheet';
import '../../styles/components/session-changes.css';

interface SessionChangesProps {
  sessionId: string;
  /** True while an agent is bound and the session is open — steer is available. */
  canSteer: boolean;
  /** True when the session is closed — comments queue as follow-ups, never steer. */
  closed: boolean;
  streamPaused?: boolean;
}

interface Selection {
  file: DiffFile;
  hunk: DiffHunk;
  capturedLabel: string;
}

type SendState = 'idle' | 'sending' | 'delivered' | 'failed';

export function SessionChanges({ sessionId, canSteer, closed, streamPaused = false }: SessionChangesProps) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [baselineId, setBaselineId] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [sendState, setSendState] = useState<SendState>('idle');
  const [sendError, setSendError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<string | null>(null);

  const list = useQuery({
    queryKey: queryKeys.checkpoints,
    queryFn: () => sdk.operator.checkpoints.list(),
    enabled: expanded,
  });

  const checkpoints = useMemo(
    () => sortCheckpointsNewestFirst(list.data?.checkpoints ?? []),
    [list.data],
  );

  // Default the baseline to the most recent checkpoint; if the chosen one disappears
  // from the list (GC / refetch), fall back to the newest rather than query a dangling id.
  useEffect(() => {
    if (!checkpoints.length) return;
    if (!baselineId || !checkpoints.some((c) => c.id === baselineId)) {
      setBaselineId(checkpoints[0].id);
    }
  }, [checkpoints, baselineId]);

  const baseline: WorkspaceCheckpoint | null = useMemo(
    () => checkpoints.find((c) => c.id === baselineId) ?? null,
    [checkpoints, baselineId],
  );

  const diff = useQuery({
    queryKey: [...queryKeys.checkpoints, baselineId, 'diff', 'working-tree'],
    queryFn: () => sdk.operator.checkpoints.diff({ a: baselineId }),
    enabled: expanded && Boolean(baselineId),
  });

  const files = useMemo(
    () => (diff.data ? parseUnifiedDiff(diff.data.diff.unifiedDiff) : []),
    [diff.data],
  );

  const capturedLabel = baseline
    ? `Workspace changes since checkpoint "${baseline.label || baseline.id}" (${kindLabel(baseline.kind)}, ${formatRelative(baseline.createdAt)}), compared to the live working tree. Workspace-wide — not filtered to this session.`
    : 'Workspace diff vs. the live working tree.';

  const mode: 'steer' | 'followUp' = canSteer && !closed ? 'steer' : 'followUp';

  const send = useMutation({
    mutationFn: (body: string) => (
      mode === 'steer'
        ? sdk.operator.sessions.steer(sessionId, { body })
        : sdk.operator.sessions.followUp(sessionId, { body })
    ),
    onSuccess: async () => {
      setSendState('delivered');
      setSelection(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
    onError: (error) => {
      setSendState('failed');
      setSendError(
        isSessionClosedError(error)
          ? 'This session is closed — reopen it to continue.'
          : formatError(error),
      );
      if (isSessionClosedError(error)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      }
    },
  });

  function openHunk(file: DiffFile, hunk: DiffHunk): void {
    setSendError(null);
    setSendState('idle');
    setSelection({ file, hunk, capturedLabel });
  }

  function submitComment(comment: string): void {
    if (!selection) return;
    const body = buildHunkCommentSteer({
      filePath: selection.file.path,
      hunk: selection.hunk,
      capturedLabel: selection.capturedLabel,
      comment,
    });
    setSendState('sending');
    setSendError(null);
    setLastSent(`${selection.file.path} · ${mode === 'steer' ? 'steered' : 'queued'}`);
    send.mutate(body);
  }

  const changedCount = files.length;

  return (
    <section className="session-changes">
      <button
        type="button"
        className="session-changes__toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <FileDiff size={15} aria-hidden="true" />
        <span>Changes</span>
        <span className="session-changes__toggle-hint">
          {expanded ? 'Comment on a hunk to steer' : 'View file changes and comment on a hunk'}
        </span>
      </button>

      {expanded && (
        <div className="session-changes__body">
          <div className="session-changes__toolbar">
            <label className="session-changes__baseline">
              Baseline
              <select
                value={baselineId}
                onChange={(e) => setBaselineId(e.target.value)}
                aria-label="Diff baseline checkpoint"
                disabled={!checkpoints.length}
              >
                {checkpoints.map((c) => (
                  <option key={c.id} value={c.id}>
                    {(c.label || c.id)} · {kindLabel(c.kind)} · {formatRelative(c.createdAt)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="icon-button"
              title="Refresh checkpoints and diff"
              onClick={() => { void list.refetch(); void diff.refetch(); }}
            >
              <RefreshCw size={14} />
            </button>
          </div>

          {lastSent && sendState === 'delivered' && (
            <p className="session-changes__sent" role="status">Comment sent — {lastSent}.</p>
          )}
          {sendState === 'failed' && sendError && !selection && (
            <p className="session-changes__send-error" role="alert">{sendError}</p>
          )}
          {streamPaused && (
            <p className="session-changes__stale" role="note">
              Live updates paused — this diff may lag the working tree until the stream reconnects.
            </p>
          )}

          {list.isPending && <SkeletonBlock variant="text" lines={3} />}
          {list.isError && (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load checkpoints" />
          )}
          {list.isSuccess && !checkpoints.length && (
            <div className="session-changes__empty" role="note">
              No workspace checkpoints yet — the daemon captures them per turn/agent-run (or create one from the
              Checkpoints view). Without one there is no file diff to show.
            </div>
          )}

          {baseline && (
            <>
              <p className="session-changes__captured">{capturedLabel}</p>

              {diff.isPending && <SkeletonBlock variant="text" lines={5} />}
              {diff.isError && (
                <ErrorState error={diff.error} onRetry={() => void diff.refetch()} title="Failed to load diff" />
              )}
              {diff.isSuccess && changedCount === 0 && (
                <div className="session-changes__empty" role="note">
                  No file differences between this checkpoint and the working tree.
                </div>
              )}

              {files.map((file) => (
                <div key={`${file.path}-${file.oldPath}`} className="session-changes__file">
                  <div className="session-changes__file-head">
                    <span className={`badge ${file.status === 'deleted' ? 'bad' : file.status === 'added' ? 'ok' : 'neutral'}`}>
                      {file.status}
                    </span>
                    <span className="session-changes__file-path">{file.path}</span>
                  </div>
                  {file.binary ? (
                    <p className="session-changes__binary" role="note">Binary file — no line diff to comment on.</p>
                  ) : file.hunks.length === 0 ? (
                    <p className="session-changes__binary" role="note">No textual hunks (metadata-only change).</p>
                  ) : (
                    file.hunks.map((hunk) => (
                      <button
                        key={hunk.id}
                        type="button"
                        className="session-changes__hunk"
                        onClick={() => openHunk(file, hunk)}
                        title="Comment on this hunk and steer the session"
                      >
                        <span className="session-changes__hunk-header">{hunk.header}</span>
                        <code className="session-changes__hunk-lines">
                          {hunk.lines.slice(0, 12).map((line, i) => (
                            <span key={i} className={`session-changes__line session-changes__line--${line.type}`}>
                              {line.type === 'add' ? '+' : line.type === 'del' ? '-' : line.type === 'meta' ? '' : ' '}
                              {line.text}
                            </span>
                          ))}
                          {hunk.lines.length > 12 && (
                            <span className="session-changes__line session-changes__line--more">
                              … {hunk.lines.length - 12} more lines — tap to comment
                            </span>
                          )}
                        </code>
                        <span className="session-changes__hunk-cta">Comment &amp; steer</span>
                      </button>
                    ))
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {selection && (
        <HunkCommentSheet
          open
          filePath={selection.file.path}
          hunk={selection.hunk}
          capturedLabel={selection.capturedLabel}
          mode={mode}
          pending={sendState === 'sending'}
          error={sendState === 'failed' ? sendError : null}
          onSubmit={submitComment}
          onCancel={() => { setSelection(null); setSendState('idle'); setSendError(null); }}
        />
      )}
    </section>
  );
}
