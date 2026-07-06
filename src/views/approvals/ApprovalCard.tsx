/**
 * ApprovalCard — one approval's full interactive card: per-hunk edit selection,
 * approve/deny/claim/cancel, decision trail, and the "why" reasons.
 *
 * Extracted out of ApprovalsTasksView.tsx (WEBUI-FLEET-DEPTH) so FleetView can render
 * the SAME card inline on a fleet node that has a live pending approval correlated to
 * it (lib/fleet.ts's approvalsForNode) — the "approve from the tree" depth the fleet
 * mega-panel offers in the TUI. Behavior is unchanged from the original inline
 * component except for two additions:
 *
 *   - Claim: approvals.claim locks a pending approval to "claimed" so a second surface
 *     sharing the same operator token doesn't also resolve it. `claimedBy` is whatever
 *     the daemon's authenticated-actor derivation resolves to (a real username, or the
 *     literal string 'shared-token'/'operator' under bearer-token auth) — this client
 *     has no reliable way to tell "claimed by THIS tab" from "claimed by another tab
 *     sharing the same token", so a claimed approval stays non-actionable here exactly
 *     like before (see isActionableApproval): claim is offered, but the view never
 *     auto-unlocks itself afterward. That is a deliberate, honest limitation, not a
 *     bug — two surfaces must never both resolve one approval.
 *   - Cancel: approvals.cancel withdraws a pending approval WITHOUT deciding it (denied
 *     means "no"; cancelled means "never mind, no decision needed") — a distinct
 *     terminal outcome the audit trail already renders (see auditEntryLabel).
 */

import { useMemo } from 'react';
import { Ban, Check, Hourglass, X } from 'lucide-react';
import type { ApprovalRecord } from '../../lib/goodvibes';
import {
  auditEntryLabel,
  auditTrail,
  hunkSummary,
  isActionableApproval,
  isTerminalApprovalStatus,
  partialApprovalLabel,
  readApprovalEditHunks,
  riskTone,
  statusLabel,
  statusTone,
} from '../../lib/approvals';
import { formatRelative } from '../../lib/object';

export interface ApprovalCardProps {
  record: ApprovalRecord;
  selected: ReadonlySet<number>;
  onToggleHunk: (index: number) => void;
  onApprove: (selectedHunks?: readonly number[]) => void;
  onDeny: () => void;
  approving: boolean;
  denying: boolean;
  /** Optional — omit to hide Claim/Cancel (e.g. a read-only surface). */
  onClaim?: () => void;
  onCancel?: () => void;
  claiming?: boolean;
  cancelling?: boolean;
}

export function ApprovalCard({
  record,
  selected,
  onToggleHunk,
  onApprove,
  onDeny,
  approving,
  denying,
  onClaim,
  onCancel,
  claiming = false,
  cancelling = false,
}: ApprovalCardProps) {
  const hunks = useMemo(() => readApprovalEditHunks(record), [record]);
  const actionable = isActionableApproval(record);
  const terminal = isTerminalApprovalStatus(record.status);
  const partialLabel = useMemo(() => partialApprovalLabel(record), [record]);
  const auditEntries = useMemo(() => auditTrail(record), [record]);
  const busy = approving || denying || claiming || cancelling;

  return (
    <li className="approval-card">
      <header className="approval-card__header">
        <span className="approval-card__tool">{record.request.tool}</span>
        <span className="approval-card__badges">
          <span className={`badge ${riskTone(record.request.analysis.riskLevel)}`}>{record.request.analysis.riskLevel}</span>
          <span className={`badge ${statusTone(record.status)}`}>{statusLabel(record.status)}</span>
        </span>
      </header>
      <p className="approval-card__summary">{record.request.analysis.summary}</p>

      {record.status === 'claimed' && (
        <p className="approval-card__note" role="note">
          Claimed by {record.claimedBy ?? 'another surface'} — not actionable here.
        </p>
      )}

      {terminal && (
        <p className="approval-card__note" role="note">
          {statusLabel(record.status)}
          {record.resolvedAt ? ` ${formatRelative(record.resolvedAt)}` : ''}
          {record.resolvedBy ? ` by ${record.resolvedBy}` : ''}
          {partialLabel ? ` — ${partialLabel}` : ''}
        </p>
      )}

      {terminal && (
        <details className="approval-card__audit">
          <summary>Decision trail</summary>
          {auditEntries.length > 0 ? (
            <ul>
              {auditEntries.map((entry) => (
                <li key={entry.id}>
                  {auditEntryLabel(entry)} — {formatRelative(entry.createdAt)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="approval-card__audit-empty">No decision trail recorded.</p>
          )}
        </details>
      )}

      {actionable && hunks && (
        <div className="approval-card__hunks">
          <ul className="hunk-rows">
            {hunks.map((hunk, index) => (
              <li key={hunk.id ?? index} className="hunk-row">
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(index)}
                    onChange={() => onToggleHunk(index)}
                  />
                  <span className="hunk-row__summary">{hunkSummary(hunk)}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="approval-card__actions">
            <button
              type="button"
              className="approval-card__approve-selected"
              disabled={selected.size === 0 || busy}
              onClick={() => onApprove([...selected])}
              title="Approve only the checked hunks — the daemon computes the modified edit"
            >
              <Check size={14} /> Approve selected ({selected.size})
            </button>
            <button
              type="button"
              className="approval-card__approve-all"
              disabled={busy}
              onClick={() => onApprove(undefined)}
            >
              <Check size={14} /> Approve all
            </button>
            <button type="button" className="approval-card__deny" disabled={busy} onClick={onDeny}>
              <Ban size={14} /> Deny
            </button>
            {onClaim && (
              <button type="button" className="approval-card__claim" disabled={busy} onClick={onClaim} title="Lock this approval to your surface">
                <Hourglass size={14} /> {claiming ? 'Claiming…' : 'Claim'}
              </button>
            )}
            {onCancel && (
              <button type="button" className="approval-card__cancel" disabled={busy} onClick={onCancel} title="Withdraw without a decision">
                <X size={14} /> {cancelling ? 'Cancelling…' : 'Cancel'}
              </button>
            )}
          </div>
        </div>
      )}

      {actionable && !hunks && (
        <div className="approval-card__actions">
          <button type="button" className="approval-card__approve-all" disabled={busy} onClick={() => onApprove(undefined)}>
            <Check size={14} /> Approve
          </button>
          <button type="button" className="approval-card__deny" disabled={busy} onClick={onDeny}>
            <Ban size={14} /> Deny
          </button>
          {onClaim && (
            <button type="button" className="approval-card__claim" disabled={busy} onClick={onClaim} title="Lock this approval to your surface">
              <Hourglass size={14} /> {claiming ? 'Claiming…' : 'Claim'}
            </button>
          )}
          {onCancel && (
            <button type="button" className="approval-card__cancel" disabled={busy} onClick={onCancel} title="Withdraw without a decision">
              <X size={14} /> {cancelling ? 'Cancelling…' : 'Cancel'}
            </button>
          )}
        </div>
      )}

      <details className="approval-card__reasons">
        <summary>Why</summary>
        <ul>
          {record.request.analysis.reasons.map((reason, i) => <li key={i}>{reason}</li>)}
        </ul>
      </details>
    </li>
  );
}
