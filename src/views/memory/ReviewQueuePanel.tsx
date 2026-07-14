import { useState } from 'react';
import type { MemoryRecord, MemoryUpdateReviewInput } from '../../lib/goodvibes';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';
import { MEMORY_REVIEW_STATES, formatConfidence, isFlaggedReviewState, reviewStateTone } from './memory-helpers';
import { ClipboardList } from 'lucide-react';

interface ReviewQueueRowProps {
  record: MemoryRecord;
  saving: boolean;
  onSave: (input: MemoryUpdateReviewInput) => void;
  /** True when a consolidation proposal's "Review" jump referenced this exact record. */
  highlighted?: boolean;
}

/** One review-queue row's own draft state — reviewState/confidence/staleReason are only
 * committed to the daemon when the operator explicitly hits Save (memory.records.update-review). */
function ReviewQueueRow({ record, saving, onSave, highlighted }: ReviewQueueRowProps) {
  const [state, setState] = useState(record.reviewState);
  const [confidence, setConfidence] = useState(record.confidence);
  const [staleReason, setStaleReason] = useState(record.staleReason ?? '');
  const flagged = isFlaggedReviewState(state);

  return (
    <li
      className={highlighted ? 'memory-review-row memory-review-row--highlighted' : 'memory-review-row'}
      data-record-id={record.id}
    >
      {highlighted && (
        <p className="memory-review-row__highlight-note" role="status">
          Referenced by a consolidation proposal
        </p>
      )}
      <div className="memory-review-row__summary">
        <strong>{record.summary}</strong>
        <span className="memory-review-row__meta">
          <span className="badge neutral">{record.cls}</span>
          <span className="badge neutral">{record.scope}</span>
          <span className={`badge ${reviewStateTone(record.reviewState)}`}>current: {record.reviewState}</span>
          <span className="badge neutral">{formatConfidence(record.confidence)}</span>
        </span>
      </div>
      <form
        className="memory-review-row__form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            state,
            confidence,
            ...(flagged && staleReason.trim() ? { staleReason: staleReason.trim() } : {}),
          });
        }}
      >
        <label>
          Review state
          <select
            value={state}
            aria-label={`Review state for ${record.summary}`}
            onChange={(event) => setState(event.target.value as typeof state)}
          >
            {MEMORY_REVIEW_STATES.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label>
          Confidence
          <input
            type="number"
            min={0}
            max={100}
            value={confidence}
            aria-label={`Confidence for ${record.summary}`}
            onChange={(event) => setConfidence(Number(event.target.value))}
          />
        </label>
        {flagged && (
          <label className="memory-review-row__stale-reason">
            Reason
            <input
              value={staleReason}
              placeholder="Why is this flagged?"
              aria-label={`Stale/contradicted reason for ${record.summary}`}
              onChange={(event) => setStaleReason(event.target.value)}
            />
          </label>
        )}
        <button className="secondary-button" type="submit" disabled={saving} aria-busy={saving}>
          {saving ? 'Saving…' : 'Save review'}
        </button>
      </form>
    </li>
  );
}

interface ReviewQueuePanelProps {
  records: readonly MemoryRecord[];
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  savingId: string | null;
  onSave: (id: string, input: MemoryUpdateReviewInput) => void;
  /** Record ids a consolidation proposal's "Review" jump referenced — highlighted, never filtered
   * out (a jump must land on the row, not hide the rest of the queue). */
  highlightIds?: ReadonlySet<string>;
}

export function ReviewQueuePanel({ records, isPending, error, onRetry, savingId, onSave, highlightIds }: ReviewQueuePanelProps) {
  if (isPending) {
    return (
      <div className="memory-skeleton-group">
        <SkeletonBlock width="100%" height={40} />
        <SkeletonBlock width="100%" height={40} />
      </div>
    );
  }

  if (error) {
    return <ErrorState error={error} onRetry={onRetry} title="Review queue unavailable" />;
  }

  if (!records.length) {
    return (
      <EmptyState
        icon={<ClipboardList size={24} />}
        title="Nothing waiting for review"
        description="Records the store prioritizes for review appear here."
      />
    );
  }

  return (
    <ul className="memory-review-queue">
      {records.map((record) => (
        <ReviewQueueRow
          key={record.id}
          record={record}
          saving={savingId === record.id}
          onSave={(input) => onSave(record.id, input)}
          highlighted={highlightIds?.has(record.id)}
        />
      ))}
    </ul>
  );
}
