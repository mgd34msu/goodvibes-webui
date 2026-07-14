/**
 * ConsolidationReceipts — makes memory consolidation's judgment proposals actionable
 * (memory.consolidation.receipts, SDK 1.8.0's consolidation-reaches-the-review-queue
 * work). Idle/scheduled consolidation performs only REVERSIBLE operations on its own
 * (merge exact duplicates into a survivor, decay never-referenced aged records) —
 * anything that needs a human call (a contradiction, a cross-scope duplicate, a
 * long-stale delete) is emitted as a PROPOSAL instead of applied automatically.
 *
 * The records a proposal references are already marked into the review queue by the
 * consolidation pass itself (reviewState set to 'fresh' or 'contradicted' —
 * packages/sdk/src/platform/state/memory-consolidation.ts), so this panel's job is
 * to make those proposals legible (what kind, which records, why) and ONE-TAP
 * jumpable to the existing review queue below — never a second resolution path.
 * `route` on the wire is an internal agent-tool invocation string
 * (`memory action:"curator" query:"consolidation"`), never a browser route or link.
 *
 * Honest states: a daemon build with no memory.consolidation.receipts id at all
 * (isMethodUnavailableError, 404) and a build that HAS the id but no consolidation
 * scheduler wired (isConsolidationUnavailableError, 501 — the descriptor's own
 * documented refusal) both render the same honest "not available" state, never a
 * blank panel that reads as "nothing pending." Zero runs ever having happened is a
 * genuinely different, honest empty state.
 */
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, GitMerge } from 'lucide-react';
import { sdk } from '../../lib/goodvibes';
import type { MemoryConsolidationProposal } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import { isConsolidationUnavailableError, isMethodUnavailableError } from '../../lib/errors';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';
import { formatRelative } from '../../lib/object';

const PROPOSAL_KIND_LABEL: Record<MemoryConsolidationProposal['kind'], string> = {
  contradiction: 'Contradiction',
  'cross-scope-duplicate': 'Cross-scope duplicate',
  'stale-delete': 'Stale — propose delete',
};

function proposalKey(proposal: MemoryConsolidationProposal, index: number): string {
  return `${proposal.kind}-${proposal.ids.join(',')}-${index}`;
}

interface ConsolidationReceiptsProps {
  /** Jump to the review queue below, highlighting exactly these record ids. */
  onReviewIds: (ids: readonly string[]) => void;
}

export function ConsolidationReceipts({ onReviewIds }: ConsolidationReceiptsProps) {
  const receipts = useQuery({
    queryKey: queryKeys.memoryConsolidationReceipts,
    queryFn: () => sdk.operator.memory.consolidation.receipts(),
  });

  const unavailable = receipts.isError
    && (isMethodUnavailableError(receipts.error) || isConsolidationUnavailableError(receipts.error));

  return (
    <section className="panel consolidation-receipts-panel" aria-label="Consolidation receipts" data-testid="consolidation-receipts">
      <div className="panel-title">
        <h2>Consolidation</h2>
        <GitMerge size={18} aria-hidden="true" />
      </div>
      <p className="form-note">
        Idle-time consolidation merges exact duplicates and decays never-referenced records
        automatically — reversible, nothing ever deleted. Anything needing a human call is
        proposed here instead; the referenced records are already waiting in the review queue.
      </p>

      {receipts.isPending && (
        <div aria-label="Loading consolidation receipts" aria-busy="true">
          <SkeletonBlock variant="text" lines={3} />
        </div>
      )}

      {unavailable && (
        <EmptyState
          icon={<GitMerge size={24} />}
          title="This daemon does not run consolidation"
          description="The connected daemon build has no idle-time memory consolidation scheduler. Upgrade it to see what consolidation proposes here."
        />
      )}

      {receipts.isError && !unavailable && (
        <ErrorState error={receipts.error} onRetry={() => void receipts.refetch()} title="Consolidation receipts unavailable" />
      )}

      {receipts.isSuccess && (() => {
        const pending = receipts.data.pendingProposals;
        const runs = receipts.data.receipts;

        if (pending.length === 0 && runs.length === 0) {
          return (
            <EmptyState
              icon={<ClipboardCheck size={24} />}
              title="No consolidation runs yet"
              description="This daemon has not run an idle or scheduled consolidation pass yet."
            />
          );
        }

        return (
          <>
            {pending.length > 0 && (
              <ul className="consolidation-receipts-proposals">
                {pending.map((proposal, index) => (
                  <li key={proposalKey(proposal, index)} className="consolidation-proposal-row">
                    <div className="consolidation-proposal-row__main">
                      <span className="badge warning">{PROPOSAL_KIND_LABEL[proposal.kind]}</span>
                      <p>{proposal.reason}</p>
                      <small>
                        {proposal.ids.length} record{proposal.ids.length === 1 ? '' : 's'}: {proposal.ids.join(', ')}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => onReviewIds(proposal.ids)}
                    >
                      Review
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {pending.length === 0 && runs.length > 0 && (
              <p className="form-note">Nothing currently pending a human call — every prior proposal has been resolved.</p>
            )}

            {runs.length > 0 && (
              <details className="consolidation-receipts-runs">
                <summary>{runs.length} run{runs.length === 1 ? '' : 's'} recorded</summary>
                <ul>
                  {runs.map((receipt) => (
                    <li key={receipt.runId} className="consolidation-run-row">
                      <strong>{receipt.trigger}{receipt.idle ? ' (idle)' : ''}</strong>{' '}
                      <span>{formatRelative(new Date(receipt.ranAt).getTime())}</span>
                      <p className="form-note">
                        Scanned {receipt.scanned} · merged {receipt.merged.length} · archived {receipt.archived.length} ·
                        decayed {receipt.decayed.length} · proposed {receipt.proposed.length}
                      </p>
                      {!receipt.usageSignalAvailable && (
                        <p className="form-note" role="note">
                          No usage instrumentation available for this run — decay ordering was best-effort.
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        );
      })()}
    </section>
  );
}
