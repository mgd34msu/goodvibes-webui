/**
 * approvals.ts — tolerant readers + display helpers for approvals.* (existing
 * verb family; per-hunk selection is W3-S3, packages/sdk/src/platform/
 * control-plane/approval-hunk-apply.ts).
 *
 * Edit hunks are read DEFENSIVELY off `request.args.edits` — mirrors the SDK's
 * own `readApprovalEditHunks` (approval-hunk-apply.ts): a request whose args
 * are not edit-shaped (no `edits` array, empty, or any entry missing
 * path/find/replace) simply has no hunks to render, never a crash.
 *
 * PARITY CONTRACT: this module never computes a modified-edit result. It only
 * reads hunks for display and packages a selected-index array for
 * `approvals.approve`. The daemon (S3's moved `buildModifiedEditArgs`) is the
 * single source of the applied result — see goodvibes.ts's ApprovalApproveInput
 * doc and the ApprovalsTasksView component, which sends indices only.
 */

import type { ApprovalEditHunk, ApprovalRecord, ApprovalStatus } from './goodvibes';

/** APPROVAL_STATUS_SCHEMA (operator-contract-schemas-runtime.ts) at time of writing. */
export const KNOWN_APPROVAL_STATUSES: readonly ApprovalStatus[] = [
  'pending',
  'claimed',
  'approved',
  'denied',
  'cancelled',
  'expired',
];

const TERMINAL_APPROVAL_STATUSES = new Set<ApprovalStatus>(['approved', 'denied', 'cancelled', 'expired']);

export function isTerminalApprovalStatus(status: ApprovalStatus): boolean {
  return TERMINAL_APPROVAL_STATUSES.has(status);
}

/** True only for a status this surface may act on directly (never claimed-by-another, never terminal). */
export function isActionableApproval(record: ApprovalRecord): boolean {
  return record.status === 'pending';
}

function isEditHunkLike(value: unknown): value is ApprovalEditHunk {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.path === 'string'
    && typeof candidate.find === 'string'
    && typeof candidate.replace === 'string'
    && (candidate.id === undefined || typeof candidate.id === 'string')
  );
}

/**
 * Extract a validated edit-hunk list from an approval's request args, or null
 * if the args are not edit-shaped. Mirrors the SDK's readApprovalEditHunks
 * exactly so "this approval has hunks to render" agrees with "the daemon will
 * accept a selectedHunks index array for it".
 */
export function readApprovalEditHunks(record: ApprovalRecord): ApprovalEditHunk[] | null {
  const edits = record.request.args.edits;
  if (!Array.isArray(edits) || edits.length === 0) return null;
  const items: ApprovalEditHunk[] = [];
  for (const entry of edits) {
    if (!isEditHunkLike(entry)) return null;
    items.push(entry);
  }
  return items;
}

export function isEditApproval(record: ApprovalRecord): boolean {
  return record.request.tool === 'edit' && readApprovalEditHunks(record) !== null;
}

export function riskTone(riskLevel: string): string {
  switch (riskLevel) {
    case 'critical':
      return 'bad';
    case 'high':
      return 'warning';
    case 'medium':
      return 'neutral';
    default:
      return 'ok';
  }
}

export function statusTone(status: ApprovalStatus): string {
  switch (status) {
    case 'pending':
      return 'warning';
    case 'claimed':
      return 'neutral';
    case 'approved':
      return 'ok';
    case 'denied':
    case 'expired':
      return 'bad';
    case 'cancelled':
      return 'neutral';
    default:
      return 'neutral';
  }
}

export function statusLabel(status: string): string {
  return status.trim() || 'unknown';
}

export function sortApprovalsNewestFirst(approvals: readonly ApprovalRecord[]): ApprovalRecord[] {
  return [...approvals].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A short, human summary of a hunk for the checkbox row label. */
export function hunkSummary(hunk: ApprovalEditHunk): string {
  const find = hunk.find.length > 60 ? `${hunk.find.slice(0, 60)}…` : hunk.find;
  return `${hunk.path}: "${find}"`;
}
