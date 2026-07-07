import { Trash2 } from 'lucide-react';
import type { MemoryRecord } from '../../lib/goodvibes';
import { formatConfidence, isBelowRecallFloor, reviewStateTone } from './memory-helpers';

interface MemoryRecordRowProps {
  record: MemoryRecord;
  /** The wire recall floor (MemorySearchResult.recallFloor) the search that produced
   * this record ran against — required so the badge title states the store's actual
   * configured floor, never a hardcoded/duplicated number. */
  recallFloor: number;
  onOpen: (record: MemoryRecord) => void;
  onDelete: (record: MemoryRecord) => void;
  deleting?: boolean;
}

/** One record row: summary + cls/scope/review-state/confidence badges + delete.
 * Never renders `detail` here (that is the peek's job) — the list stays scannable. */
export function MemoryRecordRow({ record, recallFloor, onOpen, onDelete, deleting = false }: MemoryRecordRowProps) {
  const tone = reviewStateTone(record.reviewState);
  const belowFloor = isBelowRecallFloor(record, recallFloor);

  return (
    <div className="record-row memory-record-row">
      <button
        type="button"
        className="memory-record-row__main"
        onClick={() => onOpen(record)}
      >
        <strong>{record.summary}</strong>
        <span className="memory-record-row__meta">
          <span className={`badge neutral`}>{record.cls}</span>
          <span className="badge neutral">{record.scope}</span>
          <span className={`badge ${tone}`}>{record.reviewState}</span>
          <span
            className={`badge ${belowFloor ? 'warning' : 'neutral'}`}
            title={belowFloor ? `Below the ${recallFloor}% recall floor — never injected into a prompt` : undefined}
          >
            {formatConfidence(record.confidence)}
          </span>
          {record.tags.map((tag) => (
            <span key={tag} className="memory-tag-chip">{tag}</span>
          ))}
        </span>
      </button>
      <button
        type="button"
        className="memory-record-row__delete"
        title={deleting ? 'Deleting…' : `Delete "${record.summary}" permanently — this removes the record, it cannot be undone`}
        aria-label={`Delete ${record.summary}`}
        disabled={deleting}
        onClick={(event) => {
          event.stopPropagation();
          onDelete(record);
        }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
