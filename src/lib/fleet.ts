/**
 * fleet.ts — tolerant readers + display helpers for fleet.snapshot / fleet.list
 * (packages/sdk/src/platform/control-plane/method-catalog-fleet.ts).
 *
 * Mirrors the sessions-union.ts pattern: kind/state are read as OPEN STRINGS
 * even though the wire enum (PROCESS_KIND_SCHEMA / PROCESS_STATE_SCHEMA,
 * operator-contract-schemas-fleet.ts) is closed, because these types are
 * hand-mirrored from the SDK source rather than generated (the pinned
 * @pellux/goodvibes-contracts codegen package predates fleet.* — see the
 * invokeGatewayMethod comment in goodvibes.ts) and a daemon newer than this
 * client may introduce a kind/state we have never seen. Render it verbatim,
 * never drop it.
 */

import type { ApprovalRecord, FleetProcessNode } from './goodvibes';

/** PROCESS_KIND_SCHEMA (operator-contract-schemas-fleet.ts) at the time this was written. */
export const KNOWN_PROCESS_KINDS = [
  'agent',
  'wrfc-chain',
  'wrfc-subtask',
  'workflow',
  'trigger',
  'schedule',
  'watcher',
  'background-process',
  'workstream',
  'phase',
  'work-item',
  'code-index',
] as const;

/** PROCESS_STATE_SCHEMA (operator-contract-schemas-fleet.ts) at the time this was written. */
export const KNOWN_PROCESS_STATES = [
  'thinking',
  'executing-tool',
  'awaiting-approval',
  'streaming',
  'stalled',
  'retrying',
  'done',
  'failed',
  'killed',
  'interrupted',
  'idle',
  'queued',
  'paused',
] as const;

/** States that represent a process no longer live — used for "N active" honesty. */
const TERMINAL_STATES = new Set(['done', 'failed', 'killed', 'interrupted']);

export function isKnownProcessKind(kind: string): boolean {
  return (KNOWN_PROCESS_KINDS as readonly string[]).includes(kind);
}

export function isKnownProcessState(state: string): boolean {
  return (KNOWN_PROCESS_STATES as readonly string[]).includes(state);
}

export function kindLabel(kind: string): string {
  return kind.trim() || 'unknown';
}

export function stateLabel(state: string): string {
  return state.trim() || 'unknown';
}

export function isTerminalState(state: string): boolean {
  return TERMINAL_STATES.has(state.trim());
}

export function isStalledState(state: string): boolean {
  return state.trim() === 'stalled';
}

export function isAwaitingApprovalState(state: string): boolean {
  return state.trim() === 'awaiting-approval';
}

/**
 * Honest cost label. costState is one of 'priced' | 'unpriced' | 'estimated'
 * (PROCESS_COST_STATE_SCHEMA) — never silently show $0.00 for a node the
 * daemon could not price.
 */
export function costLabel(node: FleetProcessNode): string {
  if (node.costState === 'unpriced') return 'unpriced';
  if (node.costUsd == null) return node.costState === 'estimated' ? 'estimating…' : 'unpriced';
  const amount = `$${node.costUsd.toFixed(node.costUsd < 1 ? 4 : 2)}`;
  return node.costState === 'estimated' ? `~${amount}` : amount;
}

export function formatDurationMs(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return 'unknown';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m`;
}

export interface FleetRow {
  readonly node: FleetProcessNode;
  readonly depth: number;
}

/**
 * Flatten the flat, parentId-linked node list (fleet.snapshot's shape) into a
 * depth-annotated display order: roots first (no parentId, or parentId not
 * present in this snapshot), each followed immediately by its descendants
 * (depth-first, newest-started-first within a sibling group). Guards against
 * a parentId cycle (defensive — the daemon should never produce one) by
 * tracking visited ids so a malformed snapshot degrades to a flat list
 * instead of hanging the tab.
 */
export function buildFleetRows(nodes: readonly FleetProcessNode[]): FleetRow[] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const childrenByParent = new Map<string, FleetProcessNode[]>();
  const roots: FleetProcessNode[] = [];

  for (const node of nodes) {
    const parentId = node.parentId;
    if (parentId && byId.has(parentId)) {
      const bucket = childrenByParent.get(parentId) ?? [];
      bucket.push(node);
      childrenByParent.set(parentId, bucket);
    } else {
      roots.push(node);
    }
  }

  const byRecency = (a: FleetProcessNode, b: FleetProcessNode) => (b.startedAt ?? 0) - (a.startedAt ?? 0);
  roots.sort(byRecency);
  for (const bucket of childrenByParent.values()) bucket.sort(byRecency);

  const rows: FleetRow[] = [];
  const visited = new Set<string>();

  function visit(node: FleetProcessNode, depth: number): void {
    if (visited.has(node.id)) return; // cycle guard
    visited.add(node.id);
    rows.push({ node, depth });
    for (const child of childrenByParent.get(node.id) ?? []) visit(child, depth + 1);
  }

  for (const root of roots) visit(root, 0);
  // Any node whose parent chain cycles back on itself (never visited above)
  // still renders, at depth 0, rather than silently vanishing.
  for (const node of nodes) {
    if (!visited.has(node.id)) visit(node, 0);
  }

  return rows;
}

export function activeCount(nodes: readonly FleetProcessNode[]): number {
  return nodes.filter((n) => !isTerminalState(n.state)).length;
}

// ─── Actions the browser can genuinely back over the wire ─────────────────────
//
// fleet.snapshot's per-node `capabilities` (interruptible/killable/pausable/
// resumable/steerable) describe what the underlying process CAN do — but the SDK's own
// fleet registry (packages/sdk/src/platform/runtime/fleet/registry.ts killNode/
// interrupt/resume) performs those actions with DIRECT, same-process calls into
// per-kind managers (agentManager.cancel, watcherRegistry.stopWatcher,
// workflowManager.cancel, triggerManager.remove, automationManager.removeJob, ...) —
// none of that is exposed as an operator wire verb today except two cases:
//   - steer: sessions.steer, for an 'agent' node with a live sessionRef.sessionId
//     (verified: adaptAgent sets capabilities.steerable = active && messageBusPresent,
//     and sessions.steer is a real, existing HTTP route this client already uses from
//     SessionsView).
//   - stop: watchers.stop, for a 'watcher' node only — WatcherRecord.id IS the node id
//     (adaptWatcher: `id: record.id`, no namespacing), so `watchers.stop({ watcherId:
//     node.id })` genuinely targets the right watcher. No other kind's node id maps to
//     a verb-addressable entity this confidently (schedule/trigger nodes exist with NO
//     control verb on the wire at all; wrfc-chain/workflow/background-process kills
//     cascade over members the wire has no bulk-cancel for).
// Every other killable/interruptible/pausable/resumable flag is real but UNBACKED —
// `unbackedCapabilityNote` says so plainly instead of a button that would either
// no-op or 404.
export type FleetWireAction = 'steer' | 'detach' | 'stop';

export function wireBackedActions(node: FleetProcessNode): ReadonlySet<FleetWireAction> {
  const actions = new Set<FleetWireAction>();
  const hasSession = Boolean(node.sessionRef?.sessionId);
  if (node.kind === 'agent' && node.capabilities.steerable && hasSession) {
    actions.add('steer');
  }
  if (hasSession) {
    // detach is a session-level action (remove this browser's participant entry),
    // independent of the node's own kind — any node with a live sessionRef qualifies.
    actions.add('detach');
  }
  if (node.kind === 'watcher' && node.capabilities.killable) {
    actions.add('stop');
  }
  return actions;
}

/**
 * An honest note for a capability the daemon reports but the browser cannot act on —
 * null when every true capability flag on this node is already wire-backed (see
 * wireBackedActions above). Never silently drops the gap; never fabricates a button.
 */
export function unbackedCapabilityNote(node: FleetProcessNode): string | null {
  const backed = wireBackedActions(node);
  const hasUnbackedStop = node.capabilities.killable && !(node.kind === 'watcher' && backed.has('stop'));
  const hasUnbackedInterrupt = node.capabilities.interruptible;
  const hasUnbackedPauseResume = node.capabilities.pausable || node.capabilities.resumable;
  if (!hasUnbackedStop && !hasUnbackedInterrupt && !hasUnbackedPauseResume) return null;
  const verbs = [
    hasUnbackedStop && 'stop',
    hasUnbackedInterrupt && 'interrupt',
    hasUnbackedPauseResume && 'pause/resume',
  ].filter((v): v is string => Boolean(v));
  return `The daemon reports this ${kindLabel(node.kind)} process as ${verbs.join('/')}-able, `
    + `but the browser has no control verb for '${node.kind}' processes yet — use the TUI.`;
}

/**
 * Correlate a fleet node to any approvals awaiting a decision on it, so a node in
 * 'awaiting-approval' state can show (and act on) the real request inline instead of
 * sending the operator to a different view. Matches the SAME two signals the SDK's own
 * fleet registry uses to derive the 'awaiting-approval' state in the first place
 * (packages/sdk/src/platform/runtime/fleet/registry.ts collectPendingApprovals):
 *   - approval.sessionId === node.sessionRef.sessionId (either may be absent), or
 *   - node.kind === 'agent' && approval.metadata['agentId'] === node.id (metadata.agentId
 *     is an untyped, optional string on the wire — read defensively).
 * Not a guess: this is the exact correlation the daemon itself performs to light up
 * the node's `awaiting-approval` state, so a node showing that state always has at
 * least one match here (absent a race against a decision landing between the two reads).
 */
export function approvalsForNode(
  node: FleetProcessNode,
  approvals: readonly ApprovalRecord[],
): ApprovalRecord[] {
  const sessionId = node.sessionRef?.sessionId;
  return approvals.filter((approval) => {
    if (sessionId && approval.sessionId === sessionId) return true;
    if (node.kind === 'agent') {
      const metaAgentId = approval.metadata.agentId;
      if (typeof metaAgentId === 'string' && metaAgentId === node.id) return true;
    }
    return false;
  });
}
