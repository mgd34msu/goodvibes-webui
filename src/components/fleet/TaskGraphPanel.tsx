/**
 * TaskGraphPanel — the fix-phase task graph for one workstream
 * (fleet.graph.get, SDK 1.8.0), rendered in the workstream/fleet detail pane.
 *
 * Deliberately a vertical list, not a node-link diagram: legible at phone
 * width is the bar (per the brief), and every state tell (ready/running/
 * blocked/at-cap/stalled) is expressible as text + a badge — a diagram earns
 * its complexity only once this list stops being readable, which it is not.
 *
 * The pool summary line renders the brief's own vocabulary verbatim: "N
 * ready, M running, at cap (fleet.maxSize=N)" — the "at cap" clause only
 * when the daemon reports it. `pool` is null for a workstream with no
 * elastic pool (a fixed-capacity/single-agent run); no summary line renders
 * then, never a fabricated "0 ready, 0 running".
 */
import { useQuery } from '@tanstack/react-query';
import { GitBranch } from 'lucide-react';
import { sdk } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import {
  graphNodeStateLabel,
  graphNodeStateTone,
  isKnownGraphNodeState,
  poolSummaryLabel,
  type FleetGraphNode,
} from '../../lib/fleet-graph';
import { contractStateForBadgeTone } from '../../lib/presentation-bridge';
import { ErrorState } from '../feedback/ErrorState';
import { SkeletonBlock } from '../feedback/SkeletonBlock';
import '../../styles/components/task-graph.css';

export interface TaskGraphPanelProps {
  workstreamId: string;
}

function GraphNodeRow({ node }: { node: FleetGraphNode }) {
  const tone = graphNodeStateTone(node.state);
  return (
    <li className="task-graph-node" data-testid="task-graph-node">
      <div className="task-graph-node__head">
        <span className="task-graph-node__title">{node.title}</span>
        <span
          className={`badge ${tone}`}
          data-contract-state={contractStateForBadgeTone(tone)}
          title={isKnownGraphNodeState(node.state) ? undefined : 'State not known to this client — shown verbatim'}
        >
          {graphNodeStateLabel(node.state)}
        </span>
        {node.stalled && <span className="badge warning">Stalled</span>}
      </div>
      {node.blockedReason && (
        <p className="task-graph-node__blocked-reason">{node.blockedReason}</p>
      )}
      {node.files.length > 0 && (
        <p className="task-graph-node__files">{node.files.join(', ')}</p>
      )}
    </li>
  );
}

export function TaskGraphPanel({ workstreamId }: TaskGraphPanelProps) {
  const graph = useQuery({
    queryKey: queryKeys.fleetGraph(workstreamId),
    queryFn: () => sdk.operator.fleet.graph.get(workstreamId),
    enabled: Boolean(workstreamId),
  });

  if (graph.isPending) {
    return (
      <section className="task-graph-panel" aria-label="Task graph">
        <div className="panel-title">
          <h3>Task graph</h3>
          <GitBranch size={16} aria-hidden="true" />
        </div>
        <SkeletonBlock variant="text" lines={3} />
      </section>
    );
  }

  if (graph.isError) {
    return (
      <section className="task-graph-panel" aria-label="Task graph">
        <div className="panel-title">
          <h3>Task graph</h3>
          <GitBranch size={16} aria-hidden="true" />
        </div>
        <ErrorState error={graph.error} title="Task graph unavailable" onRetry={() => void graph.refetch()} />
      </section>
    );
  }

  const { nodes, pool } = graph.data;

  return (
    <section className="task-graph-panel" aria-label="Task graph">
      <div className="panel-title">
        <h3>Task graph</h3>
        <GitBranch size={16} aria-hidden="true" />
      </div>
      {pool && (
        <p className="task-graph-panel__pool" data-testid="task-graph-pool">
          {poolSummaryLabel(pool)}
          {pool.refusal && ` — ${pool.refusal}`}
        </p>
      )}
      {nodes.length === 0 ? (
        <p className="form-note">No task-graph nodes yet.</p>
      ) : (
        <ul className="task-graph-nodes">
          {nodes.map((node) => <GraphNodeRow key={node.id} node={node} />)}
        </ul>
      )}
    </section>
  );
}
