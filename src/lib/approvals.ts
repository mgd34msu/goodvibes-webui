/**
 * approvals.ts — tolerant readers + display helpers for approvals.* (existing
 * verb family; per-hunk selection lives in packages/sdk/src/platform/
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

import type { ApprovalAuditRecord, ApprovalEditHunk, ApprovalRecord, ApprovalStatus } from './goodvibes';

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

/**
 * For a resolved, approved edit approval: was it a per-hunk subset rather
 * than the whole request? The daemon's `decision.modifiedArgs.edits` carries
 * the filtered hunk list only when a `selectedHunks` subset was sent
 * (APPROVAL_APPROVE_INPUT_SCHEMA's selectedHunks doc, operator-contract-
 * schemas-runtime.ts) — comparing its length against the original request's
 * hunk count is enough to say "partial (2/5 hunks)" from data already on the
 * record, no extra wire call. Returns null when not applicable: not
 * approved, no edit hunks on the request, or modifiedArgs absent/covers
 * every hunk (a full approval).
 */
export function partialApprovalLabel(record: ApprovalRecord): string | null {
  if (record.status !== 'approved') return null;
  const originalHunks = readApprovalEditHunks(record);
  if (!originalHunks || originalHunks.length === 0) return null;
  const modifiedEdits = record.decision?.modifiedArgs?.edits;
  if (!Array.isArray(modifiedEdits) || modifiedEdits.length >= originalHunks.length) return null;
  return `partial (${modifiedEdits.length}/${originalHunks.length} hunks)`;
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

/**
 * The full decision trail, oldest first (the wire already appends in
 * chronological order — see approval-broker.ts's `buildAudit` call sites —
 * but this never assumes ordering it does not itself guarantee). `audit` is
 * absent, never null, on a mixed-version or pre-audit record — never inferred
 * as "no history", just "not reported here".
 */
export function auditTrail(record: ApprovalRecord): readonly ApprovalAuditRecord[] {
  return record.audit ?? [];
}

/** One-line, human summary of a single decision-trail entry for the detail card. */
export function auditEntryLabel(entry: ApprovalAuditRecord): string {
  const surface = entry.actorSurface ? ` (${entry.actorSurface})` : '';
  const note = entry.note ? `: ${entry.note}` : '';
  return `${entry.action} by ${entry.actor}${surface}${note}`;
}
