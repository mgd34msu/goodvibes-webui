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
 * paginated union list is a Wave-3 contract item (sessions.search).
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
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
  canSteer,
  retentionLabel,
} from '../../lib/sessions-union';
import { companionMessagesFromListResponse } from '../../lib/companion-chat';
import { firstString, formatRelative } from '../../lib/object';
import { formatError } from '../../lib/errors';
import { SteerComposer } from './SteerComposer';
import '../../styles/components/sessions.css';

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

export function SessionsView() {
  const [selectedId, setSelectedId] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [includeClosed, setIncludeClosed] = useState(true);

  const list = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () => sdk.operator.sessions.list(),
  });

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

  return (
    <div className="sessions-view">
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
                          <span className={`badge ${isClosedStatus(record.status) ? 'neutral' : 'ok'}`}>
                            {isClosedStatus(record.status) ? 'closed · history' : statusLabel(record.status)}
                          </span>
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
        {selected ? <SessionDetail record={selected} /> : (
          <div className="sessions-detail-empty">Select a session to view and steer it.</div>
        )}
      </div>
    </div>
  );
}

function SessionDetail({ record }: { record: UnionSessionRecord }) {
  const messages = useQuery({
    queryKey: queryKeys.sessionMessages(record.id),
    queryFn: () => sdk.operator.sessions.messages.list(record.id),
    enabled: Boolean(record.id),
  });

  const items = useMemo(() => companionMessagesFromListResponse(messages.data), [messages.data]);
  const retention = retentionLabel(record);
  const closed = isClosedStatus(record.status);

  return (
    <div className="session-detail">
      <header className="session-detail__header">
        <h2>{record.title}</h2>
        <div className="session-detail__badges">
          <KindBadge kind={record.kind} />
          <span className="badge neutral">{projectLabel(record.project)}</span>
          <span className={`badge ${closed ? 'neutral' : 'ok'}`}>
            {closed ? 'closed · history' : statusLabel(record.status)}
          </span>
          <span className="badge neutral">{record.messageCount} msgs</span>
          {retention && <span className="badge warning">{retention}</span>}
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
      </div>

      <SteerComposer sessionId={record.id} canSteer={canSteer(record)} closed={closed} />
    </div>
  );
}
