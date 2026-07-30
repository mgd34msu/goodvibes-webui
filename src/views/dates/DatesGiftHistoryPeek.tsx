/**
 * DatesGiftHistoryPeekBody — the gift-history detail shown in the peek panel when
 * an upcoming occasion's "Gift history" button is pressed. Reads `occasions.gifts`,
 * which carries what the summary row cannot: what he landed on in previous years,
 * one record per occurrence — the same detail-fetch relationship
 * CalendarEventPeek/MailMessagePeek have to their own list views.
 *
 * Gift history is machine-owned state (docs/occasions.md §3), not something this
 * view can edit directly — a record is only ever written by closing an interview
 * (`occasions.interview.record`, wired in DatesView's Open items section). This
 * peek is read-only by construction: it has no mutation of its own.
 */
import { useQuery } from '@tanstack/react-query';
import { Gift } from 'lucide-react';
import { sdk } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';
import { formatRelative } from '../../lib/object';

export interface DatesGiftHistoryPeekProps {
  occasionId: string;
}

export function DatesGiftHistoryPeekBody({ occasionId }: DatesGiftHistoryPeekProps) {
  const gifts = useQuery({
    queryKey: queryKeys.occasionsGifts(occasionId),
    queryFn: () => sdk.operator.occasions.gifts(occasionId),
  });

  if (gifts.isPending) {
    return (
      <div className="dates-gift-peek-loading">
        <SkeletonBlock width="70%" height={18} />
        <SkeletonBlock width="100%" height={14} />
      </div>
    );
  }

  if (gifts.error) {
    return <ErrorState error={gifts.error} onRetry={() => void gifts.refetch()} title="Gift history failed to load" />;
  }

  const records = gifts.data?.gifts ?? [];

  if (records.length === 0) {
    return (
      <EmptyState
        icon={<Gift size={20} aria-hidden="true" />}
        title="No gift history yet"
        description="Nothing recorded for this occasion. A record is written when a 'yes' interview is closed with what you landed on."
      />
    );
  }

  return (
    <ul className="dates-gift-peek-list" data-testid="dates-gift-peek-list">
      {records.map((record) => (
        <li key={`${record.occasionId}-${record.occurrence}`} className="dates-gift-peek-item">
          <p className="dates-gift-peek-item__occurrence">{record.occurrence}</p>
          <p className="dates-gift-peek-item__landed-on">{record.landedOn}</p>
          <p className="dates-gift-peek-item__recorded-at">Recorded {formatRelative(record.recordedAt)}</p>
          {record.notes ? <p className="dates-gift-peek-item__notes">{record.notes}</p> : null}
        </li>
      ))}
    </ul>
  );
}
