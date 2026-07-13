/**
 * NodeTells — the read-model's two derived per-node projections, rendered
 * identically wherever agent activity shows (FleetView, WorkstreamView):
 *
 *   - headline: ONE line derived from the node's task/phase identity, replaced
 *     in place on transitions (never an appended feed — the daemon enforces the
 *     anti-feed contract and the 80-char cap at the read-model).
 *   - stall tell: a pure timestamp comparison ("no activity for N minutes on a
 *     live node"), rendered as a marker with the raw facts — not a judgment.
 *
 * Both read defensively via lib/fleet.ts (the generated contract type does not
 * declare the fields yet; they ride the node's open index signature).
 */
import type { FleetProcessNode } from '../../lib/goodvibes';
import { readHeadline, readStallTell, stallTellLabel } from '../../lib/fleet';
import { formatRelative } from '../../lib/object';

export function NodeHeadline({ node, block = false }: { readonly node: FleetProcessNode; readonly block?: boolean }) {
  const headline = readHeadline(node);
  if (!headline) return null;
  if (block) {
    return <p className="node-headline node-headline--block" data-testid="fleet-detail-headline">{headline.text}</p>;
  }
  return <span className="node-headline" data-testid="fleet-headline">{headline.text}</span>;
}

export function NodeStallBadge({ node }: { readonly node: FleetProcessNode }) {
  const stall = readStallTell(node);
  if (!stall) return null;
  return (
    <span
      className="badge warning node-stall-badge"
      data-testid="fleet-stall"
      title={`No activity since ${new Date(stall.since).toLocaleTimeString()} — a timestamp comparison, not a judgment`}
    >
      {stallTellLabel(stall)}
    </span>
  );
}

export function NodeStallNote({ node }: { readonly node: FleetProcessNode }) {
  const stall = readStallTell(node);
  if (!stall) return null;
  return (
    <p className="node-stall-note" role="note" data-testid="fleet-detail-stall">
      {stallTellLabel(stall)} — last activity {formatRelative(stall.since)}
    </p>
  );
}
