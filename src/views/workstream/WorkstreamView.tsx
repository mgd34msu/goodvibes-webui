/**
 * WorkstreamView — orchestration workstream/phase/work-item rows over fleet.*.
 * By design, this rides fleet.snapshot() filtered client-side to the
 * 'workstream' | 'phase' | 'work-item' kinds — no new SDK contract landed for
 * this, since a dedicated fleet filter param does not exist yet.
 *
 * VERIFIED data shape (packages/sdk/src/platform/runtime/fleet/adapters/
 * orchestration.ts adaptWorkstream/adaptPhase/adaptWorkItem): a workstream is
 * a root ProcessNode (kind 'workstream', no parentId), its phases are pure
 * grouping children (kind 'phase', no usage/cost — reported as such, never
 * fabricated), and its work-items are leaves (kind 'work-item') nested under
 * either their current phase or the workstream directly. fleet.snapshot's
 * flat parentId-linked list already carries this tree, so buildFleetRows
 * (lib/fleet.ts, generic over any parentId-linked subset) renders it exactly
 * like FleetView's process tree, just scoped to these three kinds.
 *
 * No wire event exists for fleet.* yet (same gap FleetView documents) —
 * poll + manual refresh, not realtime invalidation.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Workflow } from 'lucide-react';
import { sdk } from '../../lib/goodvibes';
import type { FleetProcessNode } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import {
  buildFleetRows,
  costLabel,
  formatDurationMs,
  isAwaitingApprovalState,
  isKnownProcessState,
  isStalledState,
  isTerminalState,
  stateLabel,
} from '../../lib/fleet';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';
import { compactJson, formatRelative } from '../../lib/object';
import '../../styles/components/workstream.css';

const WORKSTREAM_POLL_INTERVAL_MS = 15_000;
const WORKSTREAM_KINDS = new Set(['workstream', 'phase', 'work-item']);

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

function KindBadge({ kind }: { kind: string }) {
  return <span className="badge neutral">{kind}</span>;
}

export function WorkstreamView() {
  const [selectedId, setSelectedId] = useState('');

  const snapshot = useQuery({
    queryKey: queryKeys.workstream,
    queryFn: () => sdk.operator.fleet.snapshot(),
    refetchInterval: WORKSTREAM_POLL_INTERVAL_MS,
  });

  const nodes = useMemo(
    () => (snapshot.data?.nodes ?? []).filter((n) => WORKSTREAM_KINDS.has(n.kind)),
    [snapshot.data],
  );
  const rows = useMemo(() => buildFleetRows(nodes), [nodes]);
  const selected = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId]);
  const workstreamCount = useMemo(() => nodes.filter((n) => n.kind === 'workstream').length, [nodes]);
  const stalledCount = useMemo(() => nodes.filter((n) => isStalledState(n.state)).length, [nodes]);

  return (
    <div className="workstream-view">
      <div className="workstream-list-pane">
        <div className="workstream-toolbar">
          <span className="workstream-toolbar__summary">
            <Workflow size={14} /> {workstreamCount} workstream{workstreamCount === 1 ? '' : 's'}
            {stalledCount > 0 ? ` · ${stalledCount} stalled` : ''}
          </span>
          <button className="icon-button" type="button" title="Refresh" onClick={() => void snapshot.refetch()}>
            <RefreshCw size={15} className={snapshot.isFetching ? 'spin' : undefined} />
          </button>
        </div>

        {snapshot.isPending && (
          <div className="workstream-loading">
            <SkeletonBlock variant="text" lines={4} />
          </div>
        )}

        {snapshot.isError && (
          <ErrorState error={snapshot.error} onRetry={() => void snapshot.refetch()} title="Failed to load workstreams" />
        )}

        {snapshot.isSuccess && snapshot.data.truncated && (
          <div className="workstream-cap-note" role="note">
            The underlying fleet snapshot was truncated at the daemon's node cap — some workstream rows may be missing.
          </div>
        )}

        {snapshot.isSuccess && nodes.length === 0 && (
          <EmptyState
            icon={<Workflow size={28} />}
            title="No active workstreams"
            description="Multi-phase orchestration runs (workstreams, phases, and their work items) will appear here while they run."
          />
        )}

        {snapshot.isSuccess && nodes.length > 0 && (
          <ul className="workstream-rows">
            {rows.map(({ node, depth }) => (
              <li key={node.id} style={{ paddingLeft: `${depth * 14}px` }}>
                <button
                  type="button"
                  className={`workstream-row${node.id === selectedId ? ' active' : ''}`}
                  onClick={() => setSelectedId(node.id)}
                >
                  <span className="workstream-row__title">{node.label || node.id}</span>
                  <span className="workstream-row__badges">
                    <KindBadge kind={node.kind} />
                    <StateBadge state={node.state} />
                    {node.kind === 'workstream' && <span className="badge neutral">{costLabel(node)}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="workstream-detail-pane">
        {selected ? <WorkstreamDetail node={selected} /> : (
          <div className="workstream-detail-empty">Select a workstream, phase, or work item to view its detail.</div>
        )}
      </div>
    </div>
  );
}

function WorkstreamDetail({ node }: { node: FleetProcessNode }) {
  return (
    <div className="workstream-detail">
      <header className="workstream-detail__header">
        <h2>{node.label || node.id}</h2>
        <div className="workstream-detail__badges">
          <KindBadge kind={node.kind} />
          <StateBadge state={node.state} />
          {node.kind === 'workstream' && <span className="badge neutral">{costLabel(node)}</span>}
        </div>
        {node.task && <p className="workstream-detail__task">{node.task}</p>}
        <div className="workstream-detail__meta">
          <small>Elapsed {formatDurationMs(node.elapsedMs)}</small>
          {typeof node.startedAt === 'number' && <small>· started {formatRelative(node.startedAt)}</small>}
        </div>
      </header>

      {node.currentActivity && (
        <div className="workstream-detail__activity">
          <strong>Current activity</strong>
          <p>{node.currentActivity.text}</p>
        </div>
      )}

      {node.kind !== 'phase' && node.usage && (
        <div className="workstream-detail__usage">
          <strong>Usage</strong>
          <div className="workstream-detail__usage-grid">
            <span>{node.usage.inputTokens} in</span>
            <span>{node.usage.outputTokens} out</span>
            <span>{node.usage.llmCallCount} calls</span>
            <span>{node.usage.turnCount} turns</span>
          </div>
        </div>
      )}

      {node.kind === 'phase' && (
        <p className="workstream-detail__note" role="note">
          Phases report no usage/cost of their own — a work item's usage is cumulative across every phase it
          visits, so attributing it to whichever phase it currently occupies would double-count.
        </p>
      )}

      {node.sessionRef?.agentId && (
        <div className="workstream-detail__session">
          <small>Agent: {node.sessionRef.agentId}</small>
        </div>
      )}

      <details className="workstream-detail__raw">
        <summary>Raw node</summary>
        <pre>{compactJson(node)}</pre>
      </details>
    </div>
  );
}
