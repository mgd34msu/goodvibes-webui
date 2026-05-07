import { bestId, bestStatus, bestTitle } from '../lib/object';
import { StatusBadge } from './StatusBadge';

interface RecordListProps {
  items: unknown[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  empty?: string;
}

export function RecordList({ items, selectedId, onSelect, empty = 'No records' }: RecordListProps) {
  if (!items.length) return <p className="empty-state">{empty}</p>;

  return (
    <div className="record-list">
      {items.map((item, index) => {
        const id = bestId(item) || String(index);
        const selected = selectedId === id;
        const content = (
          <>
            <strong>{bestTitle(item, id)}</strong>
            <span>{id}</span>
            <StatusBadge value={bestStatus(item)} />
          </>
        );

        return onSelect ? (
          <button
            key={`${id}-${index}`}
            type="button"
            className={selected ? 'record-row selected' : 'record-row'}
            onClick={() => onSelect(id)}
          >
            {content}
          </button>
        ) : (
          <div key={`${id}-${index}`} className="record-row">
            {content}
          </div>
        );
      })}
    </div>
  );
}
