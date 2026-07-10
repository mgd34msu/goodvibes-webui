/**
 * SessionChanges — a read-only, hunk-selectable view of the file changes a session made,
 * wired so a single hunk can be commented on and that comment steered into THIS session.
 *
 * DAEMON SURFACE: sessions.changes.get (SDK 1.6.1) returns a session's aggregate
 * workspace diff, joined over the workspace checkpoints stamped with that session's id —
 * the net change from before the session's earliest stamped checkpoint to its latest.
 * That is the PRIMARY, default source this view reads: genuinely session-scoped, not a
 * workspace-wide diff dressed up with a caveat label. A session with no stamped
 * checkpoints answers honestly with `checkpointCount: 0` and an empty diff
 * (`from`/`to`: "EMPTY") — this view renders that as an explicit "no captured changes for
 * this session" state with a one-tap fallback, never a blank panel.
 *
 * FALLBACK (explicit secondary mode, not silently blended in): older sessions predate
 * sessionId stamping on checkpoints, so their aggregate is always the honest-empty
 * result above. For them (or any session where a manual read of the raw checkpoint
 * timeline is wanted), the workspace-wide checkpoint-baseline picker this view used to be
 * built on entirely is kept as a toggle: pick a baseline checkpoint → checkpoints.diff
 * gives a unified diff against the live working tree. It is explicitly labeled
 * "workspace-scoped (fallback)" wherever its output is shown — capture provenance stays
 * truthful in both modes.
 *
 * FLOW (either mode): the answering unified diff is parsed by parseUnifiedDiff into
 * files + hunks → each hunk is a tap target → the HunkCommentSheet composes a comment →
 * it is sent through the SAME steer path the SteerComposer/fleet needs-input flow use
 * (sessions.steer when an agent is bound, sessions.followUp otherwise), PREFIXED with a
 * structured context block naming the file, line ranges, capture source, and the hunk
 * excerpt.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDiff, RefreshCw } from 'lucide-react';
import { sdk } from '../../lib/goodvibes';
import type { WorkspaceCheckpoint } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import { formatError, isMethodUnavailableError, isSessionClosedError } from '../../lib/errors';
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
/** 'session' (default, primary) reads sessions.changes.get. 'workspace' (explicit
 * secondary/fallback) reads the checkpoint-baseline picker. */
type ViewMode = 'session' | 'workspace';

export function SessionChanges({ sessionId, canSteer, closed, streamPaused = false }: SessionChangesProps) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<ViewMode>('session');
  const [baselineId, setBaselineId] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [sendState, setSendState] = useState<SendState>('idle');
  const [sendError, setSendError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<string | null>(null);

  // ── Primary: sessions.changes.get — genuinely session-scoped ──────────────────
  const sessionChanges = useQuery({
    queryKey: queryKeys.sessionChanges(sessionId),
    queryFn: () => sdk.operator.sessions.changes.get(sessionId),
    enabled: expanded && mode === 'session',
  });
  // An un-upgraded daemon that has never heard of this verb — not the same as the
  // honest checkpointCount:0 empty result a current daemon returns for an unstamped
  // session. Both land the caller on the workspace-scoped fallback, with different text.
  const sessionChangesUnavailable = sessionChanges.isError && isMethodUnavailableError(sessionChanges.error);
  const sessionChangesFailed = sessionChanges.isError && !sessionChangesUnavailable;
  const sessionHasNoCapturedChanges = sessionChanges.isSuccess && sessionChanges.data.checkpointCount === 0;

  // ── Secondary/fallback: checkpoints.list + checkpoints.diff (workspace-wide, vs the
  //    live working tree) — the ORIGINAL source this view was built on before
  //    sessions.changes.get existed, kept as an explicit, separately-labeled mode. ──
  const list = useQuery({
    queryKey: queryKeys.checkpoints,
    queryFn: () => sdk.operator.checkpoints.list(),
    enabled: expanded && mode === 'workspace',
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
    enabled: expanded && mode === 'workspace' && Boolean(baselineId),
  });

  const files = useMemo(() => {
    if (mode === 'session') {
      return sessionChanges.data && !sessionHasNoCapturedChanges ? parseUnifiedDiff(sessionChanges.data.unifiedDiff) : [];
    }
    return diff.data ? parseUnifiedDiff(diff.data.diff.unifiedDiff) : [];
  }, [mode, sessionChanges.data, sessionHasNoCapturedChanges, diff.data]);

  const capturedLabel = useMemo(() => {
    if (mode === 'session') {
      if (!sessionChanges.data) return "Session changes, aggregated over this session's own captured checkpoints.";
      if (sessionHasNoCapturedChanges) {
        return "No captured changes for this session — no workspace checkpoints have been stamped with this session's id.";
      }
      const { checkpointCount, from, to } = sessionChanges.data;
      return `Session changes across ${checkpointCount} checkpoint${checkpointCount === 1 ? '' : 's'} this session made (from "${from}" to "${to}"). Session-scoped — filtered to this session's own checkpoints only.`;
    }
    return baseline
      ? `Workspace changes since checkpoint "${baseline.label || baseline.id}" (${kindLabel(baseline.kind)}, ${formatRelative(baseline.createdAt)}), compared to the live working tree. Workspace-scoped (fallback) — not filtered to this session.`
      : 'Workspace diff vs. the live working tree. Workspace-scoped (fallback) — not filtered to this session.';
  }, [mode, sessionChanges.data, sessionHasNoCapturedChanges, baseline]);

  const mutationMode: 'steer' | 'followUp' = canSteer && !closed ? 'steer' : 'followUp';

  const send = useMutation({
    mutationFn: (body: string) => (
      mutationMode === 'steer'
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
    setLastSent(`${selection.file.path} · ${mutationMode === 'steer' ? 'steered' : 'queued'}`);
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
            {mode === 'session' ? (
              <button
                type="button"
                className="session-changes__mode-toggle"
                onClick={() => setMode('workspace')}
                title="Older sessions predate session-id stamping on checkpoints — this reads the raw workspace checkpoint timeline instead"
              >
                Workspace-scoped view (fallback)
              </button>
            ) : (
              <>
                <button type="button" className="session-changes__mode-toggle" onClick={() => setMode('session')}>
                  ← Back to session changes
                </button>
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
              </>
            )}
            <button
              type="button"
              className="icon-button"
              title={mode === 'session' ? 'Refresh session changes' : 'Refresh checkpoints and diff'}
              onClick={() => {
                if (mode === 'session') void sessionChanges.refetch();
                else { void list.refetch(); void diff.refetch(); }
              }}
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

          {mode === 'session' && (
            <>
              {sessionChanges.isPending && <SkeletonBlock variant="text" lines={3} />}
              {sessionChangesFailed && (
                <ErrorState error={sessionChanges.error} onRetry={() => void sessionChanges.refetch()} title="Failed to load session changes" />
              )}
              {sessionChangesUnavailable && (
                <div className="session-changes__empty" role="note">
                  This daemon doesn&apos;t serve session-scoped changes (sessions.changes.get) yet.
                  {' '}
                  <button type="button" className="session-changes__inline-link" onClick={() => setMode('workspace')}>
                    View workspace-wide changes instead
                  </button>
                </div>
              )}
              {sessionHasNoCapturedChanges && (
                <div className="session-changes__empty" role="note">
                  No captured changes for this session — no workspace checkpoints have been stamped with this
                  session&apos;s id yet (older sessions predate session-id stamping).
                  {' '}
                  <button type="button" className="session-changes__inline-link" onClick={() => setMode('workspace')}>
                    View workspace-wide changes instead
                  </button>
                </div>
              )}
              {sessionChanges.isSuccess && !sessionHasNoCapturedChanges && (
                <>
                  <p className="session-changes__captured">{capturedLabel}</p>
                  {changedCount === 0 && (
                    <div className="session-changes__empty" role="note">
                      No file differences in this session&apos;s captured checkpoints.
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {mode === 'workspace' && (
            <>
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
                </>
              )}
            </>
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
        </div>
      )}

      {selection && (
        <HunkCommentSheet
          open
          filePath={selection.file.path}
          hunk={selection.hunk}
          capturedLabel={selection.capturedLabel}
          mode={mutationMode}
          pending={sendState === 'sending'}
          error={sendState === 'failed' ? sendError : null}
          onSubmit={submitComment}
          onCancel={() => { setSelection(null); setSendState('idle'); setSendError(null); }}
        />
      )}
    </section>
  );
}
