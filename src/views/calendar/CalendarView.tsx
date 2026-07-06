/**
 * CalendarView — events (list/get/create) + ICS import/export over the daemon's
 * CalDAV-backed `calendar.*` verbs. Calendar is a daemon/agent feature with no TUI
 * command surface (the parity audit's ground truth) — the web UI is its first
 * screen.
 *
 * HONESTY CONTRACT (three refusal shapes, each rendered distinctly, never folded
 * into a generic "error"):
 *  1. UNCONFIGURED — the daemon's 412 CALENDAR_NOT_CONFIGURED / CALENDAR_CREDENTIALS_MISSING.
 *     The operator has not brought their own CalDAV endpoint. This mirrors the
 *     provider/credential "unconfigured" honesty ruling (presentation-bridge.ts:
 *     neutral/info, not a fault) — a pointer to the config keys
 *     (`surfaces.calendar.caldavUrl` / `caldavUser` / `caldavPassword`), the calendar
 *     surface's own bring-your-own-endpoint setup, is shown instead of a scary error.
 *  2. NOT AVAILABLE — a 404 "unknown gateway method" or 501 "not invokable" refusal:
 *     this daemon build has no live calendar handler wired at all (the SDK ships the
 *     `calendar.*` contract `invokable: false` by construction; only a daemon that has
 *     registered a real CalDAV handler answers normally). Distinct from "unconfigured":
 *     here the CAPABILITY itself is missing, not just its configuration.
 *  3. GENUINE ERROR — anything else (network failure, a malformed range, a CalDAV
 *     auth failure against a configured endpoint) — ErrorState with retry.
 * Never fabricate a fourth "it's just empty" reading for any of the three above.
 */
import { SyntheticEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CalendarPlus, Download, Upload } from 'lucide-react';
import { sdk } from '../../lib/goodvibes';
import type { CalendarEventCreateInput, CalendarIcsImportInput } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import {
  isCalendarAuthFailedError,
  isCalendarUnconfiguredError,
  isMethodNotInvokableError,
  isMethodUnavailableError,
} from '../../lib/errors';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';
import ErrorBoundary from '../../components/feedback/ErrorBoundary';
import { usePeek } from '../../components/peek/PeekPanel';
import { CalendarEventPeekBody } from './CalendarEventPeek';
import '../../styles/components/calendar.css';

function isoDateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toRangeStartIso(dateOnly: string): string {
  return dateOnly ? `${dateOnly}T00:00:00.000Z` : '';
}

function toRangeEndIso(dateOnly: string): string {
  return dateOnly ? `${dateOnly}T23:59:59.999Z` : '';
}

function splitAttendees(value: string): string[] | undefined {
  const list = value.split(',').map((item) => item.trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

function downloadIcs(icsContent: string, filename: string): void {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Classify a calendar-surface error into one of the three honest outcomes. Returns
 * null for a genuine error (the caller falls back to a plain ErrorState). */
function unconfiguredNote(error: unknown): { title: string; description: string } | null {
  if (isCalendarUnconfiguredError(error)) {
    return {
      title: 'Calendar isn’t configured',
      description: 'Bring your own CalDAV endpoint: set surfaces.calendar.caldavUrl, surfaces.calendar.caldavUser, and surfaces.calendar.caldavPassword in daemon config, then reload.',
    };
  }
  if (isMethodUnavailableError(error) || isMethodNotInvokableError(error)) {
    return {
      title: 'Calendar isn’t available on this daemon yet',
      description: 'This daemon build has no calendar handler wired up. Upgrade the daemon, or use a build that registers the CalDAV surface.',
    };
  }
  if (isCalendarAuthFailedError(error)) {
    return {
      title: 'CalDAV sign-in failed',
      description: 'The configured CalDAV endpoint rejected the stored credentials. Check surfaces.calendar.caldavUser/caldavPassword.',
    };
  }
  return null;
}

export function CalendarView() {
  const queryClient = useQueryClient();
  const peek = usePeek();

  const [from, setFrom] = useState(() => isoDateOffset(0));
  const [to, setTo] = useState(() => isoDateOffset(14));
  const [calendarId, setCalendarId] = useState('');

  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [attendees, setAttendees] = useState('');

  const [icsContent, setIcsContent] = useState('');

  const rangeFrom = toRangeStartIso(from);
  const rangeTo = toRangeEndIso(to);

  const events = useQuery({
    queryKey: queryKeys.calendarEvents(rangeFrom, rangeTo, calendarId),
    queryFn: () => sdk.operator.calendar.events.list({
      from: rangeFrom || undefined,
      to: rangeTo || undefined,
      ...(calendarId.trim() ? { calendarId: calendarId.trim() } : {}),
      limit: 100,
    }),
  });

  const create = useMutation({
    mutationFn: () => {
      const input: CalendarEventCreateInput = {
        title: title.trim(),
        start,
        end,
        confirm: true,
        ...(location.trim() ? { location: location.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(splitAttendees(attendees) ? { attendees: splitAttendees(attendees) } : {}),
        ...(calendarId.trim() ? { calendarId: calendarId.trim() } : {}),
      };
      return sdk.operator.calendar.events.create(input);
    },
    onSuccess: async () => {
      setTitle('');
      setStart('');
      setEnd('');
      setLocation('');
      setDescription('');
      setAttendees('');
      await queryClient.invalidateQueries({ queryKey: ['calendar', 'events'] });
    },
  });

  const exportIcs = useMutation({
    mutationFn: () => sdk.operator.calendar.ics.export({
      from: rangeFrom || undefined,
      to: rangeTo || undefined,
      ...(calendarId.trim() ? { calendarId: calendarId.trim() } : {}),
    }),
    onSuccess: (result) => downloadIcs(result.icsContent, `calendar-export-${from}-to-${to}.ics`),
  });

  const importIcs = useMutation({
    mutationFn: () => {
      const input: CalendarIcsImportInput = {
        icsContent,
        confirm: true,
        ...(calendarId.trim() ? { calendarId: calendarId.trim() } : {}),
      };
      return sdk.operator.calendar.ics.import(input);
    },
    onSuccess: async () => {
      setIcsContent('');
      await queryClient.invalidateQueries({ queryKey: ['calendar', 'events'] });
    },
  });

  const items = events.data?.events ?? [];
  const sortedItems = useMemo(() => [...items].sort((a, b) => a.start.localeCompare(b.start)), [items]);
  const honestNote = events.error ? unconfiguredNote(events.error) : null;

  const openEventPeek = (eventId: string) => {
    peek.open({
      title: 'Event Detail',
      content: <CalendarEventPeekBody eventId={eventId} calendarId={calendarId.trim() || undefined} />,
    });
  };

  function submitCreate(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (title.trim() && start && end) create.mutate();
  }

  function submitImport(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (icsContent.trim()) importIcs.mutate();
  }

  const createNote = create.error ? unconfiguredNote(create.error) : null;
  const importNote = importIcs.error ? unconfiguredNote(importIcs.error) : null;
  const exportNote = exportIcs.error ? unconfiguredNote(exportIcs.error) : null;

  return (
    <ErrorBoundary
      fallback={(err, reset) => <ErrorState error={err} onRetry={reset} title="Calendar view failed" />}
    >
      <div className="stack">
        <section className="panel">
          <div className="panel-title">
            <h2>Calendar</h2>
            <CalendarDays size={18} aria-hidden="true" />
          </div>
          <div className="calendar-range-controls">
            <label>
              From
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="Range start" />
            </label>
            <label>
              To
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="Range end" />
            </label>
            <label>
              Calendar
              <input
                value={calendarId}
                onChange={(event) => setCalendarId(event.target.value)}
                placeholder="Default calendar"
                aria-label="Logical calendar id"
              />
            </label>
            <button type="button" className="secondary-button" onClick={() => void events.refetch()} aria-label="Refresh events">
              Refresh
            </button>
          </div>

          <div aria-live="polite" aria-atomic="false" className="calendar-status-region">
            {events.isPending ? (
              <div className="knowledge-skeleton-group">
                <SkeletonBlock width="100%" height={36} />
                <SkeletonBlock width="100%" height={36} />
                <SkeletonBlock width="100%" height={36} />
              </div>
            ) : honestNote ? (
              <EmptyState icon={<CalendarDays size={24} aria-hidden="true" />} title={honestNote.title} description={honestNote.description} />
            ) : events.error ? (
              <ErrorState error={events.error} onRetry={() => void events.refetch()} title="Events failed to load" />
            ) : sortedItems.length === 0 ? (
              <EmptyState icon={<CalendarDays size={24} aria-hidden="true" />} title="No events in this range" description="Try a wider date range, or create the first event below." />
            ) : (
              <ul className="calendar-event-list" aria-label="Calendar events">
                {sortedItems.map((item) => (
                  <li key={item.id}>
                    <button type="button" className="calendar-event-row" onClick={() => openEventPeek(item.id)}>
                      <span className="calendar-event-row__time">
                        {new Date(item.start).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                      <span className="calendar-event-row__title">{item.title}</span>
                      {item.location && <span className="calendar-event-row__location">{item.location}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <div className="two-column">
          <section className="panel">
            <div className="panel-title">
              <h2>New Event</h2>
              <CalendarPlus size={18} aria-hidden="true" />
            </div>
            <form className="form-grid" onSubmit={submitCreate}>
              <label>
                Title
                <input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Event title" required />
              </label>
              <div className="form-split">
                <label>
                  Start
                  <input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} aria-label="Event start" required />
                </label>
                <label>
                  End
                  <input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} aria-label="Event end" required />
                </label>
              </div>
              <label>
                Location
                <input value={location} onChange={(event) => setLocation(event.target.value)} aria-label="Event location" />
              </label>
              <label>
                Description
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} aria-label="Event description" />
              </label>
              <label>
                Attendees
                <input value={attendees} onChange={(event) => setAttendees(event.target.value)} placeholder="Comma separated" aria-label="Attendees, comma separated" />
              </label>
              <button className="primary-button" type="submit" disabled={create.isPending || !title.trim() || !start || !end} aria-busy={create.isPending}>
                {create.isPending ? 'Creating…' : 'Create Event'}
              </button>
            </form>
            {createNote ? (
              <EmptyState icon={<CalendarDays size={20} aria-hidden="true" />} title={createNote.title} description={createNote.description} />
            ) : create.error ? (
              <ErrorState error={create.error} onRetry={() => create.mutate()} title="Create failed" />
            ) : create.data ? (
              <p className="calendar-create-success" role="status">Created — event id {create.data.eventId}</p>
            ) : null}
          </section>

          <section className="panel">
            <div className="panel-title">
              <h2>iCalendar</h2>
              <Download size={18} aria-hidden="true" />
            </div>
            <div className="calendar-ics-export">
              <button
                type="button"
                className="secondary-button"
                onClick={() => exportIcs.mutate()}
                disabled={exportIcs.isPending}
                aria-busy={exportIcs.isPending}
              >
                {exportIcs.isPending ? 'Exporting…' : 'Export range as .ics'}
              </button>
              {exportNote ? (
                <EmptyState icon={<Download size={20} aria-hidden="true" />} title={exportNote.title} description={exportNote.description} />
              ) : exportIcs.error ? (
                <ErrorState error={exportIcs.error} onRetry={() => exportIcs.mutate()} title="Export failed" />
              ) : exportIcs.data ? (
                <p className="calendar-export-success" role="status">Exported {exportIcs.data.eventCount} event(s).</p>
              ) : null}
            </div>

            <form className="form-grid calendar-ics-import" onSubmit={submitImport}>
              <label>
                Import .ics content
                <textarea
                  value={icsContent}
                  onChange={(event) => setIcsContent(event.target.value)}
                  placeholder="BEGIN:VCALENDAR..."
                  aria-label="ICS content to import"
                  rows={6}
                />
              </label>
              <button className="primary-button" type="submit" disabled={importIcs.isPending || !icsContent.trim()} aria-busy={importIcs.isPending}>
                <Upload size={14} aria-hidden="true" />
                {importIcs.isPending ? 'Importing…' : 'Import .ics'}
              </button>
            </form>
            {importNote ? (
              <EmptyState icon={<Upload size={20} aria-hidden="true" />} title={importNote.title} description={importNote.description} />
            ) : importIcs.error ? (
              <ErrorState error={importIcs.error} onRetry={() => importIcs.mutate()} title="Import failed" />
            ) : importIcs.data ? (
              <div className="calendar-import-result" role="status">
                <p>Imported {importIcs.data.imported} event(s).</p>
                {importIcs.data.errors.length > 0 && (
                  <ul className="calendar-import-result__errors">
                    {importIcs.data.errors.map((message, index) => <li key={index}>{message}</li>)}
                  </ul>
                )}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </ErrorBoundary>
  );
}
