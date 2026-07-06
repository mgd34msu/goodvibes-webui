/**
 * CalendarEventPeek — the event-detail body shown in the peek panel when a
 * calendar event row is selected. Reads `calendar.events.get`, which carries
 * fields the summary list does not (uid, recurrence) — a genuine detail
 * fetch, not a re-render of the row's own data.
 */
import { useQuery } from '@tanstack/react-query';
import { sdk } from '../../lib/goodvibes';
import { ErrorState } from '../../components/feedback/ErrorState';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';

export interface CalendarEventPeekProps {
  eventId: string;
  calendarId?: string;
}

export function CalendarEventPeekBody({ eventId, calendarId }: CalendarEventPeekProps) {
  const detail = useQuery({
    queryKey: ['calendar', 'event', eventId, calendarId ?? ''],
    enabled: Boolean(eventId),
    queryFn: () => sdk.operator.calendar.events.get(eventId, calendarId),
  });

  if (detail.isPending) {
    return (
      <div className="calendar-peek-loading">
        <SkeletonBlock width="70%" height={18} />
        <SkeletonBlock width="100%" height={14} />
        <SkeletonBlock width="90%" height={14} />
      </div>
    );
  }

  if (detail.error) {
    return (
      <div className="calendar-peek-body">
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} title="Event failed to load" />
      </div>
    );
  }

  const event = detail.data;
  return (
    <div className="calendar-peek-body">
      <h3>{event.title}</h3>
      <p className="calendar-peek-body__range">
        {new Date(event.start).toLocaleString()} – {new Date(event.end).toLocaleString()}
      </p>
      {event.location && <p><strong>Location:</strong> {event.location}</p>}
      {event.description && <p className="calendar-peek-body__description">{event.description}</p>}
      {event.attendees && event.attendees.length > 0 && (
        <p><strong>Attendees:</strong> {event.attendees.join(', ')}</p>
      )}
      {event.recurrence && <p><strong>Recurrence:</strong> {event.recurrence}</p>}
      <p className="calendar-peek-body__uid">UID: {event.uid}</p>
    </div>
  );
}
