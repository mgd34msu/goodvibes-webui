/**
 * fleet.ts — tolerant readers + display helpers for fleet.snapshot / fleet.list
 * (W3-S2, packages/sdk/src/platform/control-plane/method-catalog-fleet.ts).
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

import type { FleetProcessNode } from './goodvibes';

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
