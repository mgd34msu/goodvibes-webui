/**
 * ApprovalCard — one approval's full interactive card: per-hunk edit selection,
 * approve/deny/claim/cancel, remember tiers, deny-with-reason, the exec-prompt
 * answer path, decision trail, and the "why" reasons.
 *
 * Extracted out of ApprovalsTasksView.tsx (fleet-depth work) so FleetView can render
 * the SAME card inline on a fleet node that has a live pending approval correlated to
 * it (lib/fleet.ts's approvalsForNode) — approve-from-the-tree parity with the TUI.
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
 *   - Remember tiers (snapshot rounds 4-6): the ask's own rememberOptions render
 *     VERBATIM as a scope picker, defaulting to "just this once". The chosen tier
 *     rides the approve call; whether it was actually recorded is the CALLER's job
 *     to verify from the response (see recordedRememberTier) — this card never
 *     claims a rule was created.
 *   - Deny reason: optional free text; on the wire it rides both `note` (audit
 *     trail) and `reason` (structured user-declined feedback to the model).
 *   - Exec prompt: a running command blocked on its own terminal (tool
 *     'exec:prompt', attribution kind 'exec-prompt') renders as an ANSWERABLE
 *     card — the typed answer feeds the waiting run via the approve decision's
 *     modifiedArgs.answer; Deny stops the run honestly.
 */

import { useMemo, useState } from 'react';
import { Ban, Check, Hourglass, SendHorizonal, X } from 'lucide-react';
import type { ApprovalRecord } from '../../lib/goodvibes';
import {
  attributionLabel,
  auditEntryLabel,
  auditTrail,
  hunkSummary,
  isActionableApproval,
  isDurableRememberTier,
  isTerminalApprovalStatus,
  judgmentLabel,
  judgmentTone,
  judgmentVerdict,
  partialApprovalLabel,
  readApprovalEditHunks,
  readExecPromptAsk,
  readRememberOptions,
  riskTone,
  statusLabel,
  statusTone,
} from '../../lib/approvals';
import { formatRelative } from '../../lib/object';

/** What an approve action carries beyond the id — assembled by this card. */
export interface ApprovalCardApproveInput {
  readonly selectedHunks?: readonly number[];
  /** The remember tier the user picked (undefined = just this once). */
  readonly rememberTier?: string;
  /** Exec-prompt answer text feeding the waiting command. */
  readonly answer?: string;
}

export interface ApprovalCardProps {
  record: ApprovalRecord;
  selected: ReadonlySet<number>;
  onToggleHunk: (index: number) => void;
  onApprove: (input?: ApprovalCardApproveInput) => void;
  onDeny: (reason?: string) => void;
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
  const attribution = useMemo(() => attributionLabel(record.request.attribution), [record]);
  const verdict = useMemo(() => judgmentVerdict(record), [record]);
  const rememberOptions = useMemo(() => readRememberOptions(record), [record]);
  const execPrompt = useMemo(() => readExecPromptAsk(record), [record]);
  const busy = approving || denying || claiming || cancelling;

  // '' = just this once (no remembering requested).
  const [rememberTier, setRememberTier] = useState('');
  const [denyReason, setDenyReason] = useState('');
  const [execAnswer, setExecAnswer] = useState('');

  const approveExtras = rememberTier ? { rememberTier } : {};
  const deny = () => onDeny(denyReason.trim() || undefined);

  const rememberPicker = rememberOptions.length > 0 && !execPrompt && (
    <label className="approval-card__remember">
      <span className="approval-card__remember-label">Remember</span>
      <select
        aria-label={`Remember scope for ${record.request.tool}`}
        value={rememberTier}
        disabled={busy}
        onChange={(e) => setRememberTier(e.target.value)}
      >
        <option value="">just this once</option>
        {rememberOptions.map((option) => (
          <option key={option.tier} value={option.tier} title={option.detail}>
            {option.label}
            {isDurableRememberTier(option.tier) ? ' (saved as a rule)' : ''}
          </option>
        ))}
      </select>
      {rememberTier && (
        <small className="approval-card__remember-detail">
          {rememberOptions.find((o) => o.tier === rememberTier)?.detail}
        </small>
      )}
    </label>
  );

  const denyReasonField = (
    <details className="approval-card__deny-reason">
      <summary>Deny reason (optional)</summary>
      <input
        type="text"
        aria-label={`Deny reason for ${record.request.tool}`}
        placeholder="Fed back to the model with the denial"
        value={denyReason}
        disabled={busy}
        onChange={(e) => setDenyReason(e.target.value)}
      />
    </details>
  );

  const claimCancelButtons = (
    <>
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
    </>
  );

  return (
    <li className="approval-card">
      <header className="approval-card__header">
        <span className="approval-card__tool">{record.request.tool}</span>
        <span className="approval-card__badges">
          <span className={`badge ${riskTone(record.request.analysis.riskLevel)}`}>{record.request.analysis.riskLevel}</span>
          <span className={`badge ${statusTone(record.status)}`}>{statusLabel(record.status)}</span>
          {verdict && (
            <span className={`badge ${judgmentTone(verdict)}`} title="Proposed by the sandbox model-judgment tier — annotate-only, the human still decides">
              {judgmentLabel(verdict)}
            </span>
          )}
        </span>
      </header>
      <p className="approval-card__summary">{record.request.analysis.summary}</p>

      {attribution && (
        <p className="approval-card__attribution" role="note">
          {attribution}
        </p>
      )}

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
          {record.decision?.reason ? ` — reason: ${record.decision.reason}` : ''}
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

      {actionable && execPrompt && (
        <div className="approval-card__exec-prompt" data-testid="exec-prompt-card">
          <p className="approval-card__exec-command">
            <code>{execPrompt.command || '(command unknown)'}</code>
          </p>
          <p className="approval-card__exec-question">
            Waiting on: <strong>{execPrompt.prompt || '(prompt text unavailable)'}</strong>
          </p>
          {execPrompt.recentOutput && (
            <pre className="approval-card__exec-output">{execPrompt.recentOutput}</pre>
          )}
          <div className="approval-card__exec-answer">
            <input
              type="text"
              aria-label={`Answer for ${execPrompt.command || record.request.tool}`}
              placeholder="Type the reply the command is waiting for"
              value={execAnswer}
              disabled={busy}
              onChange={(e) => setExecAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && execAnswer.length > 0) onApprove({ answer: execAnswer });
              }}
            />
            <button
              type="button"
              className="approval-card__approve-all"
              disabled={busy || execAnswer.length === 0}
              onClick={() => onApprove({ answer: execAnswer })}
              title="Approve with this answer — it feeds the waiting command"
            >
              <SendHorizonal size={14} /> Send answer
            </button>
            <button type="button" className="approval-card__deny" disabled={busy} onClick={deny} title="Stop the command without answering">
              <Ban size={14} /> Stop command
            </button>
            {claimCancelButtons}
          </div>
          {denyReasonField}
        </div>
      )}

      {actionable && !execPrompt && hunks && (
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
          {rememberPicker}
          <div className="approval-card__actions">
            <button
              type="button"
              className="approval-card__approve-selected"
              disabled={selected.size === 0 || busy}
              onClick={() => onApprove({ selectedHunks: [...selected], ...approveExtras })}
              title="Approve only the checked hunks — the daemon computes the modified edit"
            >
              <Check size={14} /> Approve selected ({selected.size})
            </button>
            <button
              type="button"
              className="approval-card__approve-all"
              disabled={busy}
              onClick={() => onApprove({ ...approveExtras })}
            >
              <Check size={14} /> Approve all
            </button>
            <button type="button" className="approval-card__deny" disabled={busy} onClick={deny}>
              <Ban size={14} /> Deny
            </button>
            {claimCancelButtons}
          </div>
          {denyReasonField}
        </div>
      )}

      {actionable && !execPrompt && !hunks && (
        <div className="approval-card__plain-actions">
          {rememberPicker}
          <div className="approval-card__actions">
            <button type="button" className="approval-card__approve-all" disabled={busy} onClick={() => onApprove({ ...approveExtras })}>
              <Check size={14} /> Approve
            </button>
            <button type="button" className="approval-card__deny" disabled={busy} onClick={deny}>
              <Ban size={14} /> Deny
            </button>
            {claimCancelButtons}
          </div>
          {denyReasonField}
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
