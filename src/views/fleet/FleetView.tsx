/**
 * FleetView — the live process/session tree over fleet.*.
 *
 * Renders sdk.operator.fleet.snapshot() (a flat, parentId-linked node list,
 * daemon-capped at 2000 nodes) as a master/detail browser mirroring
 * SessionsView.tsx's list+detail pattern. The SDK now emits per-node lifecycle
 * deltas on the runtime-event `fleet` domain, which App subscribes to over the
 * existing multiplexed control-plane stream (useRealtimeInvalidation) and turns
 * into a revalidation of this view's snapshot — so the tree updates ON the event,
 * not only on the timer. The background poll stays as the HONEST FALLBACK: when
 * the subscription is live (`subscriptionActive`) it drops to a slow safety cadence;
 * when the stream is down it returns to the original 15s poll. A manual refresh
 * button is always available. See queryKeys.fleet (lib/queries.ts).
 *
 * Honest states: a truly empty fleet says so; a snapshot the daemon
 * truncated at its node cap says so (never silently implies completeness);
 * daemon-unreachable rides the app-level DaemonUnreachableGate overlay
 * (App.tsx) — this view does not duplicate that state.
 *
 * WEBUI-FLEET-DEPTH additions (the observability-layer vision in the browser):
 *   - Per-node capability actions, gated on lib/fleet.ts's wireBackedActions — steer
 *     (an 'agent' node with a live sessionRef.sessionId) and detach (any node with a
 *     live sessionRef) reuse the same sessions.steer/sessions.detach verbs the
 *     Sessions view already exercises; stop is offered ONLY for a 'watcher' node
 *     (watchers.stop — the one fleet-kind whose node id genuinely maps to a
 *     verb-addressable entity). Every other true killable/interruptible/pausable/
 *     resumable flag gets an honest note instead of a fabricated button — see
 *     unbackedCapabilityNote's header comment for exactly why.
 *   - "Approve from the tree": a node correlated to a real pending approval
 *     (lib/fleet.ts's approvalsForNode) renders that approval inline
 *     (FleetApprovalInline), reusing the same ApprovalCard the Approvals view uses.
 *   - Phone (≤980px): master/detail collapses to one pane at a time (mirrors
 *     SessionsView.tsx's pattern) and the new mutation actions above are desktop-only
 *     — an honest note says so rather than cramming a steer form into a 375px
 *     column. Browsing the tree remains fully available on phone.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Boxes, ChevronLeft, OctagonX, RefreshCw } from 'lucide-react';
import { PriceSourceNote } from '../../components/pricing/PriceSourceNote';
import { sdk } from '../../lib/goodvibes';
import type { FleetProcessNode, FleetAttemptGroup } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import {
  activeCount,
  attemptGroupIds,
  attentionReasonLabel,
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
  unbackedCapabilityNote,
  wireBackedActions,
} from '../../lib/fleet';
import { isMethodUnavailableError } from '../../lib/errors';
import { AttemptComparison } from './AttemptComparison';
import type { BadgeTone } from '../../lib/presentation-bridge';
import { contractStateForBadgeTone } from '../../lib/presentation-bridge';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';
import { compactJson, formatRelative } from '../../lib/object';
import { formatError } from '../../lib/errors';
import { useToast } from '../../lib/toast';
import { FleetSessionActions } from './FleetSessionActions';
import { FleetApprovalInline } from './FleetApprovalInline';
import { NodeHeadline, NodeStallBadge, NodeStallNote } from '../../components/fleet/NodeTells';
import { parseFleetFocusFromHash, stripFleetFocusFragment } from '../../lib/push/fleet-focus-link';
import '../../styles/components/fleet.css';

/**
 * Poll cadence. When the fleet subscription is DOWN this is the honest fallback —
 * the original 15s poll, so a stalled stream never silently freezes the tree. When
 * the subscription is LIVE, fleet events drive freshness and the poll recedes to a
 * slow safety net (a belt-and-suspenders re-sync in case a delta is ever missed).
 */
const FLEET_FALLBACK_POLL_MS = 15_000;
const FLEET_SAFETY_POLL_MS = 60_000;

function fleetPollInterval(subscriptionActive: boolean): number {
  return subscriptionActive ? FLEET_SAFETY_POLL_MS : FLEET_FALLBACK_POLL_MS;
}

/** A distinct badge for a node the daemon flagged as blocked on a human. */
function AttentionBadge({ reason, detail }: { reason: string; detail?: string }) {
  const label = attentionReasonLabel(reason);
  return (
    <span className="badge attention" data-attention-reason={reason} title={detail ? `${label}: ${detail}` : label}>
      {label}
    </span>
  );
}

function KindBadge({ kind }: { kind: string }) {
  const known = isKnownProcessKind(kind);
  return (
    <span className={`badge ${known ? 'neutral' : 'warning'}`} title={known ? undefined : 'Kind not known to this client — shown verbatim'}>
      {kindLabel(kind)}
    </span>
  );
}

/** Which fleet process states map to which severity is genuinely webui/fleet-local
 * business logic (stalled/awaiting-approval/failed/killed have no SDK-contract
 * analogue) — the presentation-bridge cannot derive this, so it stays hand-written.
 * Typed as BadgeTone (not `string`) so the tone this produces is exactly the same
 * vocabulary contractStateForBadgeTone below already has a 1:1 mapping for. */
function stateTone(state: string): BadgeTone {
  if (!isKnownProcessState(state)) return 'warning';
  if (isStalledState(state) || isAwaitingApprovalState(state)) return 'warning';
  if (state === 'failed' || state === 'killed') return 'bad';
  if (isTerminalState(state)) return 'neutral';
  return 'ok';
}

/** `data-contract-state` routes the tone through the shared presentation bridge
 * (contractStateForBadgeTone) instead of re-deriving the good/warn/bad/info bucket
 * locally — the same mapping StatusStrip's REACHABLE axis mounts, applied here too
 * (see status.css / this file's fleet.css sibling for the `::before` glyph rule that
 * consumes it). */
function StateBadge({ state }: { state: string }) {
  const tone = stateTone(state);
  return (
    <span className={`badge ${tone}`} data-contract-state={contractStateForBadgeTone(tone)}>
      {stateLabel(state)}
    </span>
  );
}

export function FleetView({ subscriptionActive = true }: { subscriptionActive?: boolean } = {}) {
  // needs-input deep link: a push notification tap opens this view at
  // `#fleet-node=<id>&fleet-session=<sid>` (notification-link.ts). Read the focus
  // target ONCE via a lazy initializer (no setState-in-effect cascade), seed it as
  // the initial selection in the live tree, then scrub the fragment in a mount
  // effect so a reload does not re-focus it. If the node is not in the snapshot yet,
  // seeding its id is harmless — the detail pane resolves the moment the node
  // appears (or stays on the picker).
  const [initialFocus] = useState(() =>
    typeof window !== 'undefined' ? parseFleetFocusFromHash(window.location.hash) : null,
  );
  const [selectedId, setSelectedId] = useState(() => initialFocus?.nodeId ?? '');
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [comparingGroupId, setComparingGroupId] = useState<string>('');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (initialFocus) stripFleetFocusFragment();
  }, [initialFocus]);

  const pollInterval = fleetPollInterval(subscriptionActive);
  const snapshot = useQuery({
    queryKey: queryKeys.fleet,
    queryFn: () => sdk.operator.fleet.snapshot(),
    refetchInterval: pollInterval,
  });
  const archivedList = useQuery({
    queryKey: queryKeys.fleetArchived,
    queryFn: () => sdk.operator.fleet.archivedList(),
    refetchInterval: pollInterval,
  });
  // Best-of-N held-merge groups (fleet.attempts.list) — polled with the fleet. An older
  // daemon that has never heard of the verb answers METHOD_NOT_FOUND; we degrade to "no
  // attempt groups" rather than surfacing a scary error (retry:false so it does not spin).
  const attempts = useQuery({
    queryKey: queryKeys.fleetAttempts,
    queryFn: () => sdk.operator.fleet.attempts.list(),
    refetchInterval: pollInterval,
    enabled: view === 'active',
    retry: false,
  });
  const attemptGroups: readonly FleetAttemptGroup[] = useMemo(
    () => (attempts.isError && isMethodUnavailableError(attempts.error) ? [] : attempts.data?.groups ?? []),
    [attempts.data, attempts.isError, attempts.error],
  );

  // The pane renders whichever collection the toggle selects; both share the
  // same row/detail machinery because archived nodes keep the full node shape.
  const current = view === 'archived' ? archivedList : snapshot;
  const rawNodes = useMemo(
    () => (view === 'archived' ? archivedList.data?.nodes : snapshot.data?.nodes) ?? [],
    [view, archivedList.data, snapshot.data],
  );
  // Collapse best-of-N sibling nodes out of the main tree: any node marked as an attempt
  // of a group that fleet.attempts.list is tracking is represented by the single group
  // node in the attempts section instead, so the tree shows one entry per group, not N.
  const groupIdSet = useMemo(() => new Set(attemptGroups.map((g) => g.groupId)), [attemptGroups]);
  const nodes = useMemo(() => {
    if (view === 'archived' || groupIdSet.size === 0) return rawNodes;
    const siblingIds = attemptGroupIds(rawNodes);
    if (siblingIds.size === 0) return rawNodes;
    return rawNodes.filter((n) => {
      const ref = (n as { attemptGroup?: { groupId?: unknown } }).attemptGroup;
      const gid = ref && typeof ref.groupId === 'string' ? ref.groupId : '';
      return !(gid && groupIdSet.has(gid));
    });
  }, [view, rawNodes, groupIdSet]);
  const rows = useMemo(() => buildFleetRows(nodes), [nodes]);
  const comparingGroup = useMemo(
    () => attemptGroups.find((g) => g.groupId === comparingGroupId) ?? null,
    [attemptGroups, comparingGroupId],
  );
  const selected = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId]);
  const running = useMemo(() => activeCount(nodes), [nodes]);
  // Optional-chain `nodes` too: an older daemon (or a degraded surface)
  // answers the unknown verb with an empty object — that must render as an
  // empty archive, never crash the whole Fleet view.
  const archivedCount = archivedList.data?.nodes?.length ?? 0;

  const invalidateFleet = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.fleet }),
      queryClient.invalidateQueries({ queryKey: queryKeys.fleetArchived }),
      queryClient.invalidateQueries({ queryKey: queryKeys.fleetAttempts }),
    ]);
  };

  const archiveFinished = useMutation({
    mutationFn: () => sdk.operator.fleet.archiveFinished(),
    onSuccess: async (result) => {
      toast({
        title: result.archivedCount > 0
          ? `Archived ${result.archivedCount} finished node${result.archivedCount === 1 ? '' : 's'}`
          : 'No fully-finished processes to archive',
        tone: 'info',
      });
      await invalidateFleet();
    },
    onError: (error: unknown) => {
      toast({ title: 'Archive failed', description: formatError(error), tone: 'danger' });
    },
  });

  return (
    <div className={selected ? 'fleet-view has-selection' : 'fleet-view'}>
      <div className="fleet-list-pane">
        <div className="fleet-toolbar">
          <span className="fleet-toolbar__summary">
            <Boxes size={14} /> {nodes.length} node{nodes.length === 1 ? '' : 's'}
            {view === 'active' ? ` · ${running} active` : ' archived'}
          </span>
          <button
            className="icon-button"
            type="button"
            title={view === 'active' ? `View archive (${archivedCount})` : 'View live fleet'}
            aria-label={view === 'active' ? `View archive (${archivedCount})` : 'View live fleet'}
            onClick={() => { setSelectedId(''); setView(view === 'active' ? 'archived' : 'active'); }}
          >
            {view === 'active' ? <Archive size={15} /> : <Boxes size={15} />}
          </button>
          {view === 'active' && (
            <button
              className="icon-button"
              type="button"
              title="Archive all finished"
              aria-label="Archive all finished"
              disabled={archiveFinished.isPending}
              onClick={() => archiveFinished.mutate()}
            >
              <ArchiveRestore size={15} style={{ transform: 'scaleY(-1)' }} />
            </button>
          )}
          <button className="icon-button" type="button" title="Refresh" onClick={() => void current.refetch()}>
            <RefreshCw size={15} className={current.isFetching ? 'spin' : undefined} />
          </button>
        </div>

        {view === 'active' && attemptGroups.length > 0 && (
          <div className="fleet-attempts">
            <div className="fleet-attempts__head">
              Best-of-N attempts <span className="fleet-attempts__count">{attemptGroups.length}</span>
            </div>
            <ul className="fleet-attempts__list">
              {attemptGroups.map((g) => {
                const held = g.candidates.filter((c) => c.state === 'held-merge').length;
                return (
                  <li key={g.groupId}>
                    <button
                      type="button"
                      className={`fleet-attempts__group${g.ready ? ' ready' : ''}`}
                      onClick={() => setComparingGroupId(g.groupId)}
                    >
                      <span className="fleet-attempts__group-title">{g.sourceTitle || g.groupId}</span>
                      <span className="fleet-attempts__group-badges">
                        {g.ready
                          ? <span className="badge attention">Ready — compare &amp; pick</span>
                          : <span className="badge neutral">Waiting for attempts</span>}
                        <span className="badge neutral">{held}/{g.candidates.length} held</span>
                        {g.judgment && <span className="badge neutral">judge ready</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {current.isPending && (
          <div className="fleet-loading">
            <SkeletonBlock variant="text" lines={4} />
          </div>
        )}

        {current.isError && (
          <ErrorState
            error={current.error}
            onRetry={() => void current.refetch()}
            title={view === 'archived' ? 'Failed to load the archive' : 'Failed to load the fleet'}
          />
        )}

        {view === 'active' && snapshot.isSuccess && snapshot.data.truncated && (
          <div className="fleet-cap-note" role="note">
            Showing {snapshot.data.nodes.length} of {snapshot.data.totalCount} nodes — truncated at the daemon's
            2000-node cap. Use a narrower fleet.list filter for the rest (not yet exposed in this view).
          </div>
        )}

        {current.isSuccess && !nodes.length && (view === 'archived' ? (
          <EmptyState
            icon={<Archive size={28} />}
            title="Archive is empty"
            description="Archive finished agents and swarms from the live fleet to keep the working view clean — they stay browsable here."
          />
        ) : (
          <EmptyState
            icon={<Boxes size={28} />}
            title="No active processes"
            description="Agents, WRFC chains, workflows, watchers, and background processes will appear here while they run."
          />
        ))}

        {current.isSuccess && nodes.length > 0 && (
          <ul className="fleet-rows">
            {rows.map(({ node, depth }) => (
              <li key={node.id} style={{ paddingLeft: `${depth * 14}px` }}>
                <button
                  type="button"
                  className={`fleet-row${node.id === selectedId ? ' active' : ''}`}
                  onClick={() => setSelectedId(node.id)}
                >
                  <span className="fleet-row__text">
                    <span className="fleet-row__title">{node.label || node.id}</span>
                    {/* The read-model's derived headline — ONE line replaced in
                        place on task/phase transitions, never an appended feed. */}
                    <NodeHeadline node={node} />
                  </span>
                  <span className="fleet-row__badges">
                    {node.needsAttention && (
                      <AttentionBadge reason={node.needsAttention.reason} detail={node.needsAttention.detail} />
                    )}
                    <NodeStallBadge node={node} />
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
        {selected ? (
          <FleetDetail
            node={selected}
            archived={view === 'archived'}
            onMutated={() => { setSelectedId(''); void invalidateFleet(); }}
            onBack={() => setSelectedId('')}
          />
        ) : (
          <div className="fleet-detail-empty">Select a process to view its detail.</div>
        )}
      </div>

      {comparingGroup && (
        <AttemptComparison
          open
          group={comparingGroup}
          onClose={() => setComparingGroupId('')}
          onPicked={() => { void invalidateFleet(); }}
        />
      )}
    </div>
  );
}

function FleetDetail({ node, archived, onMutated, onBack }: {
  node: FleetProcessNode;
  archived: boolean;
  onMutated: () => void;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const backed = useMemo(() => wireBackedActions(node), [node]);
  const unbackedNote = useMemo(() => unbackedCapabilityNote(node), [node]);
  const sessionId = node.sessionRef?.sessionId;

  const archiveNode = useMutation({
    mutationFn: (id: string) => sdk.operator.fleet.archive(id),
    onSuccess: (result) => {
      if (result.archived) {
        toast({ title: `Archived (${result.count} node${result.count === 1 ? '' : 's'})`, tone: 'info' });
        onMutated();
      } else {
        // Honest refusal from the daemon (e.g. a live member in the subtree).
        toast({ title: 'Not archived', description: result.reason ?? 'The daemon refused to archive this subtree.', tone: 'danger' });
      }
    },
    onError: (error: unknown) => {
      toast({ title: 'Archive failed', description: formatError(error), tone: 'danger' });
    },
  });

  const restoreNode = useMutation({
    mutationFn: (id: string) => sdk.operator.fleet.unarchive(id),
    onSuccess: (result) => {
      toast({
        title: result.restored > 0
          ? `Restored ${result.restored} node${result.restored === 1 ? '' : 's'} to the live fleet`
          : 'Nothing restored for this node',
        tone: 'info',
      });
      onMutated();
    },
    onError: (error: unknown) => {
      toast({ title: 'Restore failed', description: formatError(error), tone: 'danger' });
    },
  });

  const stopWatcher = useMutation({
    mutationFn: (watcherId: string) => sdk.operator.watchers.stop(watcherId),
    onSuccess: async () => {
      toast({ title: 'Stop requested', tone: 'info' });
      await queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
    },
    onError: (error: unknown) => {
      toast({ title: 'Stop failed', description: formatError(error), tone: 'danger' });
    },
  });

  return (
    <div className="fleet-detail">
      <button type="button" className="fleet-detail__back" onClick={onBack}>
        <ChevronLeft size={16} aria-hidden="true" />
        Back to processes
      </button>
      <header className="fleet-detail__header">
        <h2>{node.label || node.id}</h2>
        <div className="fleet-detail__badges">
          {node.needsAttention && (
            <AttentionBadge reason={node.needsAttention.reason} detail={node.needsAttention.detail} />
          )}
          <KindBadge kind={node.kind} />
          <StateBadge state={node.state} />
          <span className="badge neutral">
            {costLabel(node)}
            {/* Price provenance + the one-action path into manual pricing —
                only where a model identity exists to price. */}
          </span>
          {(node.model !== undefined || node.provider !== undefined) && (
            <PriceSourceNote
              provider={node.provider}
              model={node.model}
              costSource={node.costSource}
              pricingAsOf={node.pricingAsOf}
            />
          )}
        </div>
        <NodeHeadline node={node} block />
        <NodeStallNote node={node} />
        {node.task && <p className="fleet-detail__task">{node.task}</p>}
        <div className="fleet-detail__meta">
          <small>Elapsed {formatDurationMs(node.elapsedMs)}</small>
          {typeof node.startedAt === 'number' && <small>· started {formatRelative(node.startedAt)}</small>}
          {node.model && <small>· {node.provider ? `${node.provider}/` : ''}{node.model}</small>}
        </div>
      </header>

      <FleetApprovalInline node={node} />

      {archived ? (
        <div className="fleet-detail__actions">
          <button
            type="button"
            className="fleet-detail__stop"
            disabled={restoreNode.isPending}
            onClick={() => restoreNode.mutate(node.id)}
          >
            <ArchiveRestore size={14} /> {restoreNode.isPending ? 'Restoring…' : 'Restore to live fleet'}
          </button>
        </div>
      ) : isTerminalState(node.state) && (
        <div className="fleet-detail__actions">
          <button
            type="button"
            className="fleet-detail__stop"
            disabled={archiveNode.isPending}
            onClick={() => archiveNode.mutate(node.id)}
          >
            <Archive size={14} /> {archiveNode.isPending ? 'Archiving…' : 'Archive'}
          </button>
        </div>
      )}

      {(backed.has('steer') || backed.has('detach')) && sessionId && (
        <div className="fleet-detail__actions">
          <FleetSessionActions
            sessionId={sessionId}
            steerable={backed.has('steer')}
            detachable={backed.has('detach')}
          />
        </div>
      )}

      {backed.has('stop') && (
        <div className="fleet-detail__actions">
          <button
            type="button"
            className="fleet-detail__stop"
            disabled={stopWatcher.isPending}
            onClick={() => {
              if (!window.confirm(`Stop "${node.label || node.id}"?`)) return;
              stopWatcher.mutate(node.id);
            }}
          >
            <OctagonX size={14} /> {stopWatcher.isPending ? 'Stopping…' : 'Stop'}
          </button>
        </div>
      )}

      {/* Phone-only honest note (view-only tier) — matches the Checkpoints/Tasks
          pattern verbatim: "X happens on a wider screen. [reassurance] here.", role="note".
          Names all three actions the condition above actually covers (steer, detach,
          stop), not just two of them. */}
      {(backed.has('steer') || backed.has('detach') || backed.has('stop')) && (
        <p className="fleet-detail__phone-actions-note" role="note">
          Steering, detaching, and stopping happen on a wider screen. This process's detail stays readable here.
        </p>
      )}

      {unbackedNote && (
        <p className="fleet-detail__unbacked-note" role="note">{unbackedNote}</p>
      )}

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
