/**
 * SessionsView — the cross-surface session union.
 *
 * Renders sdk.operator.sessions.list() (GET /api/sessions → {totals, sessions}), the
 * spine union over every surface kind, with honest badges: kind (verbatim for unknown
 * kinds, never dropped), project ('unknown' for home-scoped surfaces), status
 * (active vs closed-as-history), and the retainedMessageCount truncation marker where
 * the wire reports it.
 *
 * This is a NEW surface, distinct from the companion-only Chat view. Live freshness is
 * driven by useSessionRealtime (the raw session-update stream), not by polling.
 *
 * Honest limits: GET /api/sessions ignores ?limit/?cursor and is capped at 50 by the
 * daemon, so the view shows "50 most recent" rather than faking completeness. A
 * paginated union list is a planned contract item (sessions.search).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, RefreshCw, Shield } from 'lucide-react';
import { sdk } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import {
  type UnionSessionRecord,
  unionSessionsFromListResponse,
  unionSessionsTotal,
  sortUnionSessions,
  isKnownKind,
  kindLabel,
  projectLabel,
  statusLabel,
  isClosedStatus,
  isReapedStatus,
  canSteer,
  retentionLabel,
} from '../../lib/sessions-union';
import { companionMessagesFromListResponse } from '../../lib/companion-chat';
import { firstString, formatRelative } from '../../lib/object';
import { formatError, isMethodUnavailableError, isSessionNotFoundError } from '../../lib/errors';
import { currentPermissionMode, permissionModeLabel, type PermissionMode } from '../../lib/permission-mode';
import { checkUsagePct, outcomeLabel, outcomeTone, type CompactionCheck, type CompactionReceipt } from '../../lib/compaction';
import { useCompactionReceipts } from '../../hooks/useCompactionReceipts';
import { PermissionModeSheet } from '../../components/confirm/PermissionModeSheet';
import { SteerComposer } from './SteerComposer';
import '../../styles/components/sessions.css';

/**
 * PermissionModeControl — the session-view chip + picker for the daemon's
 * permission mode. Lives in the toolbar (not per-session-row) because the mode
 * is daemon-wide (lib/permission-mode.ts) — showing it once, clearly labeled,
 * is honest; repeating it on every session row would imply a per-session value
 * that does not exist on the wire.
 */
function PermissionModeControl() {
  const queryClient = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);

  const config = useQuery({
    queryKey: queryKeys.config,
    queryFn: () => sdk.operator.config.get(),
    staleTime: 15_000,
    retry: false,
  });
  const mode = currentPermissionMode(config.data);

  const setMode = useMutation({
    mutationFn: (nextMode: PermissionMode) => sdk.operator.config.set('permissions.mode', nextMode),
    onSuccess: async () => {
      setSheetOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.config });
    },
  });

  return (
    <>
      <button
        type="button"
        className="permission-mode-chip"
        onClick={() => setSheetOpen(true)}
        title="Change the daemon's permission mode"
      >
        <Shield size={13} aria-hidden="true" />
        <span className="permission-mode-chip__label">Mode:</span>
        {mode ? permissionModeLabel(mode) : (config.isLoading ? 'Loading…' : 'Unknown')}
      </button>
      <PermissionModeSheet
        open={sheetOpen}
        currentMode={mode}
        pendingMode={setMode.isPending ? setMode.variables : undefined}
        onSelect={(nextMode) => setMode.mutate(nextMode)}
        onCancel={() => setSheetOpen(false)}
      />
      {setMode.isError && (
        <span className="session-detail__action-note" role="alert">{formatError(setMode.error)}</span>
      )}
    </>
  );
}

/**
 * ContextUsageChip — the compact context-usage indicator (task: mirror the SDK's
 * auto-compaction state). Fed exclusively by the live COMPACTION_CHECK frames
 * useCompactionReceipts observes for this session; usagePct is null (and this
 * renders an honest "not observed yet" chip) until the daemon has actually
 * reported one — never a computed-from-nowhere percentage.
 */
function ContextUsageChip({ usagePct, check }: { usagePct: number | null; check: CompactionCheck | null }) {
  if (!check || usagePct === null) {
    return <span className="context-usage-chip" title="No compaction check observed yet for this session">Context: —</span>;
  }
  const warn = usagePct >= 80;
  return (
    <span
      className={`context-usage-chip${warn ? ' context-usage-chip--warning' : ''}`}
      title={`${check.tokenCount.toLocaleString()} tokens of a ${check.threshold.toLocaleString()}-token auto-compact threshold`}
    >
      Context: {usagePct}%
    </span>
  );
}

/** CompactionReceiptBlock — a distinct card for one COMPACTION_RECEIPT, the SDK's
 *  mandatory post-compaction summary (lib/compaction.ts). Never folded into the
 *  plain .session-message rows above it. */
function CompactionReceiptBlock({ receipt }: { receipt: CompactionReceipt }) {
  const tone = outcomeTone(receipt);
  return (
    <div className="compaction-receipt" role="note">
      <div className="compaction-receipt__header">
        <span className={`badge ${tone}`}>{outcomeLabel(receipt.outcome)}</span>
        <span>Compaction · {receipt.trigger} · {receipt.strategy || 'unknown strategy'}</span>
        {receipt.qualityGrade && (
          <span className={`badge ${receipt.lowQuality ? 'warning' : 'neutral'}`}>
            grade {receipt.qualityGrade} ({Math.round(receipt.qualityScore * 100)}%)
          </span>
        )}
      </div>
      <div className="compaction-receipt__stats">
        <span>{receipt.tokensBefore.toLocaleString()} → {receipt.tokensAfter.toLocaleString()} tokens</span>
        <span>{receipt.messagesBefore} → {receipt.messagesAfter} messages</span>
        <span>{receipt.instructionsReinjected ? 'instructions reinjected' : 'instructions not reinjected'}</span>
        <span>{receipt.validationPassed ? 'validation passed' : 'validation failed'}</span>
      </div>
      {receipt.detail && <p className="compaction-receipt__detail">{receipt.detail}</p>}
    </div>
  );
}

const SNAPSHOT_CAP = 50;

function KindBadge({ kind }: { kind: string }) {
  const known = isKnownKind(kind);
  return (
    <span
      className={`badge ${known ? 'neutral' : 'warning'}`}
      title={known ? undefined : 'Kind not known to this client — shown verbatim'}
    >
      {kindLabel(kind)}
    </span>
  );
}

/**
 * Reaped-as-reaped (D-TUI/#B1): an idle-reaped closed session auto-reopens on
 * the next heartbeat from any surface — a GC housekeeping event, not a
 * deliberate close — so it gets its own tone/wording rather than folding into
 * "closed · history". Tolerant of records without `closeReason` (pre-feature
 * builds render exactly as before).
 */
function StatusBadge({ record }: { record: Pick<UnionSessionRecord, 'status' | 'closeReason'> }) {
  const reaped = isReapedStatus(record);
  const closed = isClosedStatus(record.status);
  const tone = reaped ? 'info' : closed ? 'neutral' : 'ok';
  const label = reaped ? 'reaped' : closed ? 'closed · history' : statusLabel(record.status);
  return (
    <span
      className={`badge ${tone}`}
      title={reaped ? 'Closed by the idle-session sweep — reopens automatically on the next activity' : undefined}
    >
      {label}
    </span>
  );
}

interface SessionsViewProps {
  /**
   * True when the live session-update stream is paused/reconnecting. Threaded
   * straight through to the SteerComposer so a steer sent during an outage says so.
   */
  streamPaused?: boolean;
}

export function SessionsView({ streamPaused = false }: SessionsViewProps = {}) {
  const [selectedId, setSelectedId] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [includeClosed, setIncludeClosed] = useState(true);

  const list = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () => sdk.operator.sessions.list(),
  });

  // DELETE-MEANS-DELETE: an honest, read-only capability probe, not a guess.
  // sessions.delete is a real verb in the SDK's own source at the time of writing, but
  // it is still in flight there (uncommitted) and is NOT in the webui's installed
  // contracts package — an un-upgraded daemon genuinely does not have this route.
  // control.methods.get 404s with "Unknown gateway method" for an unregistered id
  // (verified live), which isMethodUnavailableError recognizes.
  //
  // staleTime is CAPPED (not Infinity): the probe answer can change under us — a daemon
  // upgrade adds the verb, or the first probe failed transiently — so a forever-cached
  // result would be dishonest. It is also re-probed on reconnect (see the effect below).
  const deleteCapability = useQuery({
    queryKey: ['capability', 'sessions.delete'],
    queryFn: () => sdk.operator.control.methodInfo('sessions.delete'),
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Honest tri/quad-state — the probe's success ISN'T the only signal that matters, and
  // a bare `isSuccess` gate conflated a transient failure with a genuine absence:
  //   'available'   — the probe succeeded → offer Delete.
  //   'unavailable' — the probe returned the daemon's "Unknown gateway method" 404
  //                   (isMethodUnavailableError specifically) → this daemon really lacks
  //                   the verb. NOT any error: a 500/network blip is not an absence.
  //   'uncertain'   — the probe failed for some OTHER reason (network/5xx) → we can't
  //                   say; show a neutral "couldn't check" with a retry, never a false
  //                   "delete isn't available".
  //   'checking'    — first probe still in flight.
  const deleteCapabilityState: 'available' | 'unavailable' | 'uncertain' | 'checking' =
    deleteCapability.isSuccess
      ? 'available'
      : deleteCapability.isError
        ? (isMethodUnavailableError(deleteCapability.error) ? 'unavailable' : 'uncertain')
        : 'checking';

  // Re-probe on reconnect: streamPaused is the threaded live-stream health signal (it
  // clears when the session-update SSE reconnects). A true→false transition means the
  // daemon is reachable again — the moment to re-run a capability probe that may have
  // failed transiently, or that a daemon upgrade has since changed.
  const { refetch: refetchDeleteCapability } = deleteCapability;
  const prevStreamPausedRef = useRef(streamPaused);
  useEffect(() => {
    if (prevStreamPausedRef.current && !streamPaused) {
      void refetchDeleteCapability();
    }
    prevStreamPausedRef.current = streamPaused;
  }, [streamPaused, refetchDeleteCapability]);

  const records = useMemo(() => sortUnionSessions(unionSessionsFromListResponse(list.data)), [list.data]);
  const total = useMemo(() => unionSessionsTotal(list.data), [list.data]);

  const kinds = useMemo(() => [...new Set(records.map((r) => r.kind).filter(Boolean))].sort(), [records]);
  const projects = useMemo(() => [...new Set(records.map((r) => r.project).filter(Boolean))].sort(), [records]);

  const filtered = useMemo(
    () => records.filter((r) => {
      if (kindFilter && r.kind !== kindFilter) return false;
      if (projectFilter && r.project !== projectFilter) return false;
      if (!includeClosed && isClosedStatus(r.status)) return false;
      return true;
    }),
    [records, kindFilter, projectFilter, includeClosed],
  );

  // Group by project for the list, preserving newest-first order within each group.
  const groups = useMemo(() => {
    const byProject = new Map<string, UnionSessionRecord[]>();
    for (const record of filtered) {
      const key = projectLabel(record.project);
      const bucket = byProject.get(key) ?? [];
      bucket.push(record);
      byProject.set(key, bucket);
    }
    return [...byProject.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const selected = useMemo(() => records.find((r) => r.id === selectedId) ?? null, [records, selectedId]);

  const atCap = records.length >= SNAPSHOT_CAP;

  // Master-detail on a phone (≤980px, styled in sessions.css): the list and the detail
  // can't both fit side-by-side, so the stylesheet shows ONE at a time. Selecting a
  // session flips to the detail; the "Back to sessions" affordance below flips back —
  // never a dead-end single-column stack you can't climb out of.
  return (
    <div className={selected ? 'sessions-view has-selection' : 'sessions-view'}>
      <div className="sessions-list-pane">
        <div className="sessions-toolbar">
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} aria-label="Filter by kind">
            <option value="">All kinds</option>
            {kinds.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
          </select>
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} aria-label="Filter by project">
            <option value="">All projects</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <label className="sessions-toggle">
            <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />
            Closed
          </label>
          <button className="icon-button" type="button" title="Refresh" onClick={() => void list.refetch()}>
            <RefreshCw size={15} />
          </button>
          <PermissionModeControl />
        </div>

        {list.isError && (
          <div className="banner warning" role="alert">{formatError(list.error)}</div>
        )}

        {atCap && (
          <div className="sessions-cap-note" role="note">
            Showing {records.length} most recent{total !== null && total > records.length ? ` of ${total}` : ''}. The
            union list is capped by the daemon; full history and pagination arrive with
            sessions.search (Wave&nbsp;3).
          </div>
        )}

        {list.isSuccess && !records.length && (
          <div className="sessions-empty">No sessions in the union yet.</div>
        )}

        {list.isSuccess && records.length > 0 && !filtered.length && (
          <div className="sessions-empty">
            No sessions match the current filters.
            <button
              type="button"
              className="sessions-empty__clear"
              onClick={() => {
                setKindFilter('');
                setProjectFilter('');
                setIncludeClosed(true);
              }}
            >
              Clear filters
            </button>
          </div>
        )}

        <div className="sessions-groups">
          {groups.map(([project, bucket]) => (
            <section key={project} className="sessions-group">
              <div className="sessions-group__header">
                <span className="badge neutral">{project}</span>
                <small>{bucket.length}</small>
              </div>
              <ul className="sessions-rows">
                {bucket.map((record) => {
                  const retention = retentionLabel(record);
                  return (
                    <li key={record.id}>
                      <button
                        type="button"
                        className={`sessions-row${record.id === selectedId ? ' active' : ''}`}
                        onClick={() => setSelectedId(record.id)}
                      >
                        <span className="sessions-row__title">{record.title}</span>
                        <span className="sessions-row__badges">
                          <KindBadge kind={record.kind} />
                          <StatusBadge record={record} />
                          {retention && <span className="badge warning" title="Older message bodies were dropped from retention">{retention}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>

      <div className="sessions-detail-pane">
        {selected ? (
          <SessionDetail
            record={selected}
            deleteCapabilityState={deleteCapabilityState}
            onRetryDeleteCapability={() => void refetchDeleteCapability()}
            streamPaused={streamPaused}
            onBack={() => setSelectedId('')}
          />
        ) : (
          <div className="sessions-detail-empty">Select a session to view and steer it.</div>
        )}
      </div>
    </div>
  );
}

function SessionDetail({
  record,
  deleteCapabilityState,
  onRetryDeleteCapability,
  streamPaused,
  onBack,
}: {
  record: UnionSessionRecord;
  deleteCapabilityState: 'available' | 'unavailable' | 'uncertain' | 'checking';
  onRetryDeleteCapability: () => void;
  streamPaused: boolean;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const messages = useQuery({
    queryKey: queryKeys.sessionMessages(record.id),
    queryFn: () => sdk.operator.sessions.messages.list(record.id),
    enabled: Boolean(record.id),
  });

  const items = useMemo(() => companionMessagesFromListResponse(messages.data), [messages.data]);
  const retention = retentionLabel(record);
  const closed = isClosedStatus(record.status);

  // Live compaction signal for THIS session only (lib/compaction.ts) — feeds both
  // the context-usage chip below and the post-compaction receipt blocks appended
  // to the transcript. Closes when the operator leaves this session's detail.
  const compaction = useCompactionReceipts(record.id, Boolean(record.id));
  const usagePct = compaction.latestCheck ? checkUsagePct(compaction.latestCheck) : null;

  const invalidateSessions = () => queryClient.invalidateQueries({ queryKey: queryKeys.sessions });

  // Close/Reopen: DISTINCT, reversible, history-preserving actions — sessions.close /
  // sessions.reopen have been in the facade since before this brief and are idempotent
  // on the daemon (closing an already-closed session, or reopening an already-open
  // one, is a no-op success), so no extra guarding is needed here.
  const closeSession = useMutation({
    mutationFn: (sessionId: string) => sdk.operator.sessions.close(sessionId),
    onSuccess: invalidateSessions,
  });
  const reopenSession = useMutation({
    mutationFn: (sessionId: string) => sdk.operator.sessions.reopen(sessionId),
    onSuccess: invalidateSessions,
  });

  // Delete: a real hard-delete (sessions.delete), PERMANENT and distinct from close.
  // The verb requires the session to already be closed (409 SESSION_ACTIVE otherwise),
  // so this closes first (idempotent, per above) and never trusts the delete call's
  // 200 at face value — it reconciles against a fresh sessions.list() (which already
  // includes closed sessions with no separate includeClosed param — see the view's own
  // header comment on GET /api/sessions) and only succeeds once the record is
  // genuinely absent from it.
  const deleteSession = useMutation({
    mutationFn: async (sessionId: string) => {
      try {
        await sdk.operator.sessions.close(sessionId);
      } catch (error) {
        if (!isSessionNotFoundError(error)) throw error;
      }
      try {
        await sdk.operator.sessions.delete(sessionId);
      } catch (error) {
        if (!isSessionNotFoundError(error)) throw error;
      }
      const reconciled = await sdk.operator.sessions.list();
      const stillPresent = unionSessionsFromListResponse(reconciled).some((r) => r.id === sessionId);
      if (stillPresent) {
        throw Object.assign(
          new Error('Delete did not complete — the record still exists'),
          { code: 'DELETE_INCOMPLETE' },
        );
      }
    },
    onSuccess: invalidateSessions,
  });

  const actionError = closeSession.error ?? reopenSession.error ?? deleteSession.error;

  return (
    <div className="session-detail">
      <button type="button" className="session-detail__back" onClick={onBack}>
        <ChevronLeft size={16} aria-hidden="true" />
        Back to sessions
      </button>
      <header className="session-detail__header">
        <h2>{record.title}</h2>
        <div className="session-detail__badges">
          <KindBadge kind={record.kind} />
          <span className="badge neutral">{projectLabel(record.project)}</span>
          <StatusBadge record={record} />
          <span className="badge neutral">{record.messageCount} msgs</span>
          {retention && <span className="badge warning">{retention}</span>}
          <ContextUsageChip usagePct={usagePct} check={compaction.latestCheck} />
        </div>
        {record.surfaceKinds.length > 0 && (
          <div className="session-detail__surfaces">
            <small>Surfaces:</small>
            {record.surfaceKinds.map((s) => <span key={s} className="badge neutral">{s}</span>)}
          </div>
        )}
        <div className="session-detail__meta">
          <small>Updated {formatRelative(record.updatedAt)}</small>
          {record.activeAgentId && <small>· agent {record.activeAgentId}</small>}
          {record.pendingInputCount > 0 && <small>· {record.pendingInputCount} pending</small>}
        </div>
        <div className="session-detail__actions">
          {!closed && (
            <button
              type="button"
              className="session-detail__action"
              disabled={closeSession.isPending}
              title="Close — keeps history, reopenable"
              onClick={() => {
                if (!window.confirm(`Close "${record.title}"? It stays visible in history and can be reopened.`)) return;
                closeSession.mutate(record.id);
              }}
            >
              {closeSession.isPending ? 'Closing…' : 'Close'}
            </button>
          )}
          {closed && (
            <button
              type="button"
              className="session-detail__action"
              disabled={reopenSession.isPending}
              title="Reopen this session"
              onClick={() => reopenSession.mutate(record.id)}
            >
              {reopenSession.isPending ? 'Reopening…' : 'Reopen'}
            </button>
          )}
          {deleteCapabilityState === 'checking' && (
            <small className="session-detail__action-note">Checking delete availability…</small>
          )}
          {deleteCapabilityState === 'available' && (
            <button
              type="button"
              className="session-detail__action danger"
              disabled={deleteSession.isPending}
              title={`Delete "${record.title}" permanently — this removes the record, it cannot be reopened`}
              onClick={() => {
                if (!window.confirm(
                  `Delete "${record.title}" permanently?\n\nThis removes the session record — it cannot be reopened.`,
                )) return;
                deleteSession.mutate(record.id);
              }}
            >
              {deleteSession.isPending ? 'Deleting…' : 'Delete'}
            </button>
          )}
          {deleteCapabilityState === 'unavailable' && (
            <small className="session-detail__action-note">
              Permanent delete isn&apos;t available on this daemon yet — close is the only removal available.
            </small>
          )}
          {deleteCapabilityState === 'uncertain' && (
            <span className="session-detail__action-note">
              Couldn&apos;t check whether permanent delete is available.
              {' '}
              <button
                type="button"
                className="session-detail__action-retry"
                onClick={onRetryDeleteCapability}
              >
                Retry
              </button>
            </span>
          )}
        </div>
        {actionError && (
          <div className="banner warning" role="alert">{formatError(actionError)}</div>
        )}
        {record.lastError && (
          <div className="banner warning" role="alert">Last error: {record.lastError}</div>
        )}
      </header>

      <div className="session-detail__transcript">
        {messages.isError && <div className="banner warning" role="alert">{formatError(messages.error)}</div>}
        {messages.isSuccess && !items.length && <div className="sessions-empty">No retained messages.</div>}
        {items.map((message, index) => (
          <div key={firstString(message, ['id', 'messageId']) || String(index)} className="session-message">
            <span className="session-message__role">{firstString(message, ['role', 'author', 'kind']) || 'message'}</span>
            <span className="session-message__body">{firstString(message, ['body', 'content', 'text', 'message'])}</span>
          </div>
        ))}
        {/* Post-compaction receipts observed live while this detail is open (there is
            no history endpoint for them — see useCompactionReceipts's header) — a
            distinct block per receipt, appended in arrival order after the loaded
            transcript. */}
        {compaction.receipts.map((receipt, index) => (
          <CompactionReceiptBlock key={`${receipt.receivedAt}-${index}`} receipt={receipt} />
        ))}
      </div>

      <SteerComposer sessionId={record.id} canSteer={canSteer(record)} closed={closed} streamPaused={streamPaused} />
    </div>
  );
}
