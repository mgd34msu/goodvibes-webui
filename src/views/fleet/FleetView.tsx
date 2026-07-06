/**
 * FleetView — the live process/session tree over fleet.*.
 *
 * Renders sdk.operator.fleet.snapshot() (a flat, parentId-linked node list,
 * daemon-capped at 2000 nodes) as a master/detail browser mirroring
 * SessionsView.tsx's list+detail pattern. fleet.* emits NO wire event yet
 * (pinned by the SDK's own fleet test suite), so freshness comes from a
 * background poll + a manual refresh button, not realtime invalidation —
 * see the comment on queryKeys.fleet (lib/queries.ts).
 *
 * Honest states: a truly empty fleet says so; a snapshot the daemon
 * truncated at its node cap says so (never silently implies completeness);
 * daemon-unreachable rides the app-level DaemonUnreachableGate overlay
 * (App.tsx) — this view does not duplicate that state.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Boxes, RefreshCw } from 'lucide-react';
import { sdk } from '../../lib/goodvibes';
import type { FleetProcessNode } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import {
  activeCount,
  buildFleetRows,
  costLabel,
  formatDurationMs,
  isAwaitingApprovalState,
  isKnownProcessKind,
  isKnownProcessState,
  isStalledState,
  isTerminalState,
  kindLabel,
  stateLabel,
} from '../../lib/fleet';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';
import { compactJson, formatRelative } from '../../lib/object';
import '../../styles/components/fleet.css';

/** No live wire event exists for fleet.* yet — poll instead of going stale silently. */
const FLEET_POLL_INTERVAL_MS = 15_000;

function KindBadge({ kind }: { kind: string }) {
  const known = isKnownProcessKind(kind);
  return (
    <span className={`badge ${known ? 'neutral' : 'warning'}`} title={known ? undefined : 'Kind not known to this client — shown verbatim'}>
      {kindLabel(kind)}
    </span>
  );
}

function stateTone(state: string): string {
  if (!isKnownProcessState(state)) return 'warning';
  if (isStalledState(state) || isAwaitingApprovalState(state)) return 'warning';
  if (state === 'failed' || state === 'killed') return 'bad';
  if (isTerminalState(state)) return 'neutral';
  return 'ok';
}

function StateBadge({ state }: { state: string }) {
  return <span className={`badge ${stateTone(state)}`}>{stateLabel(state)}</span>;
}

export function FleetView() {
  const [selectedId, setSelectedId] = useState('');

  const snapshot = useQuery({
    queryKey: queryKeys.fleet,
    queryFn: () => sdk.operator.fleet.snapshot(),
    refetchInterval: FLEET_POLL_INTERVAL_MS,
  });

  const nodes = useMemo(() => snapshot.data?.nodes ?? [], [snapshot.data]);
  const rows = useMemo(() => buildFleetRows(nodes), [nodes]);
  const selected = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId]);
  const running = useMemo(() => activeCount(nodes), [nodes]);

  return (
    <div className="fleet-view">
      <div className="fleet-list-pane">
        <div className="fleet-toolbar">
          <span className="fleet-toolbar__summary">
            <Boxes size={14} /> {nodes.length} node{nodes.length === 1 ? '' : 's'} · {running} active
          </span>
          <button className="icon-button" type="button" title="Refresh" onClick={() => void snapshot.refetch()}>
            <RefreshCw size={15} className={snapshot.isFetching ? 'spin' : undefined} />
          </button>
        </div>

        {snapshot.isPending && (
          <div className="fleet-loading">
            <SkeletonBlock variant="text" lines={4} />
          </div>
        )}

        {snapshot.isError && (
          <ErrorState error={snapshot.error} onRetry={() => void snapshot.refetch()} title="Failed to load the fleet" />
        )}

        {snapshot.isSuccess && snapshot.data.truncated && (
          <div className="fleet-cap-note" role="note">
            Showing {snapshot.data.nodes.length} of {snapshot.data.totalCount} nodes — truncated at the daemon's
            2000-node cap. Use a narrower fleet.list filter for the rest (not yet exposed in this view).
          </div>
        )}

        {snapshot.isSuccess && !nodes.length && (
          <EmptyState
            icon={<Boxes size={28} />}
            title="No active processes"
            description="Agents, WRFC chains, workflows, watchers, and background processes will appear here while they run."
          />
        )}

        {snapshot.isSuccess && nodes.length > 0 && (
          <ul className="fleet-rows">
            {rows.map(({ node, depth }) => (
              <li key={node.id} style={{ paddingLeft: `${depth * 14}px` }}>
                <button
                  type="button"
                  className={`fleet-row${node.id === selectedId ? ' active' : ''}`}
                  onClick={() => setSelectedId(node.id)}
                >
                  <span className="fleet-row__title">{node.label || node.id}</span>
                  <span className="fleet-row__badges">
                    <KindBadge kind={node.kind} />
                    <StateBadge state={node.state} />
                    <span className="badge neutral">{costLabel(node)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="fleet-detail-pane">
        {selected ? <FleetDetail node={selected} /> : (
          <div className="fleet-detail-empty">Select a process to view its detail.</div>
        )}
      </div>
    </div>
  );
}

function FleetDetail({ node }: { node: FleetProcessNode }) {
  return (
    <div className="fleet-detail">
      <header className="fleet-detail__header">
        <h2>{node.label || node.id}</h2>
        <div className="fleet-detail__badges">
          <KindBadge kind={node.kind} />
          <StateBadge state={node.state} />
          <span className="badge neutral">{costLabel(node)}</span>
        </div>
        {node.task && <p className="fleet-detail__task">{node.task}</p>}
        <div className="fleet-detail__meta">
          <small>Elapsed {formatDurationMs(node.elapsedMs)}</small>
          {typeof node.startedAt === 'number' && <small>· started {formatRelative(node.startedAt)}</small>}
          {node.model && <small>· {node.provider ? `${node.provider}/` : ''}{node.model}</small>}
        </div>
      </header>

      {node.currentActivity && (
        <div className="fleet-detail__activity">
          <strong>Current activity</strong>
          <p>{node.currentActivity.toolName ? `${node.currentActivity.toolName}: ` : ''}{node.currentActivity.text}</p>
        </div>
      )}

      {node.usage && (
        <div className="fleet-detail__usage">
          <strong>Usage</strong>
          <div className="fleet-detail__usage-grid">
            <span>{node.usage.inputTokens} in</span>
            <span>{node.usage.outputTokens} out</span>
            <span>{node.usage.cacheReadTokens} cache-read</span>
            <span>{node.usage.cacheWriteTokens} cache-write</span>
            <span>{node.usage.llmCallCount} calls</span>
            <span>{node.usage.turnCount} turns</span>
            <span>{node.usage.toolCallCount} tool calls</span>
          </div>
        </div>
      )}

      {node.sessionRef?.sessionId && (
        <div className="fleet-detail__session">
          <small>Session: {node.sessionRef.sessionId}</small>
          {node.sessionRef.agentId && <small> · agent {node.sessionRef.agentId}</small>}
        </div>
      )}

      <details className="fleet-detail__raw">
        <summary>Raw node</summary>
        <pre>{compactJson(node)}</pre>
      </details>
    </div>
  );
}
