/**
 * CalendarView — the calendar surface's honesty contract: three distinct
 * refusal states (unconfigured / not-available / genuine error), never folded
 * into one generic failure, plus the populated/empty/create/export/import
 * happy paths.
 */
import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PeekProvider } from '../../components/peek/PeekPanel';

// ---------------------------------------------------------------------------
// Module mock — mutable per-test calendar operator implementation
// ---------------------------------------------------------------------------

type EventsListImpl = () => Promise<{ events: unknown[] }>;
type EventsGetImpl = (eventId: string) => Promise<unknown>;
type EventsCreateImpl = (input: unknown) => Promise<unknown>;
type IcsExportImpl = () => Promise<unknown>;
type IcsImportImpl = (input: unknown) => Promise<unknown>;

let eventsList: EventsListImpl = () => Promise.resolve({ events: [] });
let eventsGet: EventsGetImpl = (eventId) => Promise.resolve({ id: eventId, uid: `${eventId}@x`, title: 'Event', start: '2026-01-01T10:00:00Z', end: '2026-01-01T11:00:00Z' });
let eventsCreate: EventsCreateImpl = () => Promise.resolve({ eventId: 'e1', uid: 'e1@x', createdAt: '2026-01-01T00:00:00Z' });
let icsExport: IcsExportImpl = () => Promise.resolve({ icsContent: 'BEGIN:VCALENDAR\nEND:VCALENDAR', eventCount: 0 });
let icsImport: IcsImportImpl = () => Promise.resolve({ imported: 0, eventIds: [], errors: [] });

mock.module('../../lib/goodvibes', () => ({
  // lib/queries.ts (imported transitively via queryKeys) destructures these off the
  // same module — the mock's surface must satisfy that import even though this test
  // never calls them.
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  sdk: {
    operator: {
      calendar: {
        events: {
          list: () => eventsList(),
          get: (eventId: string) => eventsGet(eventId),
          create: (input: unknown) => eventsCreate(input),
        },
        ics: {
          export: () => icsExport(),
          import: (input: unknown) => icsImport(input),
        },
      },
    },
  },
}));

const { CalendarView } = await import('./CalendarView');

function refusal(status: number, body: unknown): Promise<never> {
  return Promise.reject(Object.assign(new Error(`request failed: ${status}`), { status, body }));
}

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(PeekProvider, null, React.createElement(CalendarView)),
      ),
    );
  });
  return {
    el: container,
    unmount: () => {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
}

/** Set a controlled input/textarea's value through the native setter (bypassing
 * React's value tracker) so the subsequent 'input' event is seen as a real change. */
function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = element instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  setter.call(element, value);
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
    flushSync(() => {});
  }
}

// happy-dom does not implement the Blob-URL pair CalendarView's export/download path
// uses; stub both so the export mutation's onSuccess side effect never throws.
beforeAll(() => {
  if (!URL.createObjectURL) (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:test';
  if (!URL.revokeObjectURL) (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
});

afterEach(() => {
  eventsList = () => Promise.resolve({ events: [] });
  eventsGet = (eventId) => Promise.resolve({ id: eventId, uid: `${eventId}@x`, title: 'Event', start: '2026-01-01T10:00:00Z', end: '2026-01-01T11:00:00Z' });
  eventsCreate = () => Promise.resolve({ eventId: 'e1', uid: 'e1@x', createdAt: '2026-01-01T00:00:00Z' });
  icsExport = () => Promise.resolve({ icsContent: 'BEGIN:VCALENDAR\nEND:VCALENDAR', eventCount: 0 });
  icsImport = () => Promise.resolve({ imported: 0, eventIds: [], errors: [] });
});

describe('CalendarView — the three honest refusal states', () => {
  test('CALENDAR_NOT_CONFIGURED (412) reads "isn’t configured", not a scary error', async () => {
    eventsList = () => refusal(412, { error: 'CalDAV is not configured.', code: 'CALENDAR_NOT_CONFIGURED' });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('Calendar isn’t configured'));
    expect(el.textContent).toContain('caldavUrl');
    expect(el.querySelector('.feedback-error-state')).toBeNull();
    unmount();
  });

  test('CALENDAR_CREDENTIALS_MISSING (412) also reads as unconfigured, not a fault', async () => {
    eventsList = () => refusal(412, { error: 'CalDAV password is not available.', code: 'CALENDAR_CREDENTIALS_MISSING' });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('Calendar isn’t configured'));
    unmount();
  });

  test('a 404 unknown-gateway-method reads "isn’t available on this daemon yet"', async () => {
    eventsList = () => refusal(404, { error: 'Unknown gateway method' });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('isn’t available on this daemon yet'));
    unmount();
  });

  test('a 501 "not invokable" refusal also reads as not-available, distinct from unconfigured', async () => {
    eventsList = () => refusal(501, { error: 'Gateway method is not invokable: calendar.events.list' });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('isn’t available on this daemon yet'));
    expect(el.textContent).not.toContain('Calendar isn’t configured');
    unmount();
  });

  test('a genuine 500 renders ErrorState with retry, not an honest-unconfigured note', async () => {
    eventsList = () => refusal(500, { error: 'boom' });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('Events failed to load'));
    expect(el.querySelector('.feedback-error-state__retry')).not.toBeNull();
    unmount();
  });
});

describe('CalendarView — populated / empty', () => {
  test('an empty range says "No events in this range"', async () => {
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('No events in this range'));
    unmount();
  });

  test('events render sorted by start time, and opening one shows its detail', async () => {
    eventsList = () => Promise.resolve({
      events: [
        { id: 'ev-2', title: 'Second', start: '2026-01-02T09:00:00Z', end: '2026-01-02T10:00:00Z' },
        { id: 'ev-1', title: 'First', start: '2026-01-01T09:00:00Z', end: '2026-01-01T10:00:00Z' },
      ],
    });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('First'));
    const rows = [...el.querySelectorAll('.calendar-event-row')];
    expect(rows[0]?.textContent).toContain('First');
    expect(rows[1]?.textContent).toContain('Second');

    (rows[0] as HTMLElement).click();
    await waitFor(() => (el.textContent ?? '').includes('UID:'));
    expect(el.textContent).toContain('ev-1@x');
    unmount();
  });
});

describe('CalendarView — create / export / import', () => {
  test('creating an event with confirm:true succeeds and shows the new event id', async () => {
    let captured: unknown;
    eventsCreate = (input) => {
      captured = input;
      return Promise.resolve({ eventId: 'created-1', uid: 'created-1@x', createdAt: '2026-01-01T00:00:00Z' });
    };
    const { el, unmount } = render();
    await waitFor(() => Boolean(el.querySelector('input[aria-label="Event title"]')));

    const title = el.querySelector('input[aria-label="Event title"]') as HTMLInputElement;
    const start = el.querySelector('input[aria-label="Event start"]') as HTMLInputElement;
    const end = el.querySelector('input[aria-label="Event end"]') as HTMLInputElement;
    const form = title.closest('form') as HTMLFormElement;

    flushSync(() => {
      setNativeValue(title, 'Standup');
      setNativeValue(start, '2026-01-01T09:00');
      setNativeValue(end, '2026-01-01T09:30');
    });
    flushSync(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    await waitFor(() => (el.textContent ?? '').includes('created-1'));
    expect((captured as { confirm: boolean }).confirm).toBe(true);
    expect((captured as { title: string }).title).toBe('Standup');
    unmount();
  });

  test('an unconfigured create refusal shows the honest note, not a scary error', async () => {
    eventsCreate = () => refusal(412, { error: 'CalDAV is not configured.', code: 'CALENDAR_NOT_CONFIGURED' });
    const { el, unmount } = render();
    await waitFor(() => Boolean(el.querySelector('input[aria-label="Event title"]')));

    const title = el.querySelector('input[aria-label="Event title"]') as HTMLInputElement;
    const start = el.querySelector('input[aria-label="Event start"]') as HTMLInputElement;
    const end = el.querySelector('input[aria-label="Event end"]') as HTMLInputElement;
    const form = title.closest('form') as HTMLFormElement;
    flushSync(() => {
      setNativeValue(title, 'Standup');
      setNativeValue(start, '2026-01-01T09:00');
      setNativeValue(end, '2026-01-01T09:30');
    });
    flushSync(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

    await waitFor(() => (el.textContent ?? '').includes('Calendar isn’t configured'));
    unmount();
  });

  test('importing .ics content reports the honest imported count and any per-event errors', async () => {
    icsImport = () => Promise.resolve({ imported: 1, eventIds: ['imp-1'], errors: ['bad-uid: malformed'] });
    const { el, unmount } = render();
    await waitFor(() => Boolean(el.querySelector('textarea[aria-label="ICS content to import"]')));

    const textarea = el.querySelector('textarea[aria-label="ICS content to import"]') as HTMLTextAreaElement;
    const form = textarea.closest('form') as HTMLFormElement;
    flushSync(() => {
      setNativeValue(textarea, 'BEGIN:VCALENDAR\nEND:VCALENDAR');
    });
    flushSync(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

    await waitFor(() => (el.textContent ?? '').includes('Imported 1 event'));
    expect(el.textContent).toContain('bad-uid: malformed');
    unmount();
  });
});
