/**
 * MailView — the honesty contract mail-refusal.ts documents: not-available renders
 * an honest note (not a fake-empty inbox), a genuinely empty inbox renders the empty
 * state (never a refusal — "no fourth reading"), and the composer's Send/Save draft
 * controls never invite an action that cannot land (disabled while the surface refuses).
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PeekProvider } from '../../components/peek/PeekPanel';
import { ToastProvider } from '../../lib/toast';
import { ToastViewport } from '../../components/toast/ToastViewport';

type InboxListImpl = () => Promise<{ messages: unknown[]; total: number; unreadable?: { uid?: number; detail: string }[] }>;

let inboxList: InboxListImpl = () => Promise.resolve({ messages: [], total: 0 });

mock.module('../../lib/goodvibes', () => ({
  // src/lib/queries.ts (imported transitively via queryKeys) destructures these off
  // the same module — the mock's surface must satisfy that import even though this
  // test never calls them (same gotcha CalendarView.test.tsx documents).
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  sdk: {
    operator: {
      email: {
        inbox: {
          list: () => inboxList(),
          read: () => Promise.reject(Object.assign(new Error('not used'), { status: 500 })),
        },
        send: () => Promise.resolve({ messageId: '<x@example.com>', sentAt: '2026-01-01T00:00:00Z' }),
        draft: {
          create: () => Promise.resolve({ uid: 1, draftId: 'd1' }),
        },
      },
    },
  },
}));

const { MailView } = await import('./MailView');

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
        React.createElement(
          PeekProvider,
          null,
          React.createElement(
            ToastProvider,
            null,
            React.createElement(MailView),
            React.createElement(ToastViewport),
          ),
        ),
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

afterEach(() => {
  inboxList = () => Promise.resolve({ messages: [], total: 0 });
});

describe('MailView — not-available refusal', () => {
  test('a 501 renders the honest not-available note and no inbox list', async () => {
    inboxList = () => refusal(501, { error: 'Gateway method is not invokable', code: 'METHOD_NOT_INVOKABLE' });
    const { el, unmount } = render();
    await waitFor(() => Boolean(el.querySelector('[data-testid="mail-note-not-available"]')));
    expect(el.textContent).toContain('Mail isn’t available on this daemon yet');
    expect(el.querySelector('[data-testid="mail-list"]')).toBeNull();
    unmount();
  });

  test('while refusing, Send and Save draft are disabled even with the composer fully filled in', async () => {
    inboxList = () => refusal(501, { error: 'Gateway method is not invokable', code: 'METHOD_NOT_INVOKABLE' });
    const { el, unmount } = render();
    await waitFor(() => Boolean(el.querySelector('[data-testid="mail-note-not-available"]')));

    const to = el.querySelector('input[aria-label="Recipients"]') as HTMLInputElement;
    const subject = el.querySelector('input[aria-label="Subject"]') as HTMLInputElement;
    const body = el.querySelector('textarea[aria-label="Message body"]') as HTMLTextAreaElement;
    flushSync(() => {
      setNativeValue(to, 'someone@example.com');
      setNativeValue(subject, 'Hello');
      setNativeValue(body, 'Body text');
    });

    const sendButton = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Send'));
    const draftButton = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Save draft to account'));
    expect(sendButton?.hasAttribute('disabled')).toBe(true);
    expect(draftButton?.hasAttribute('disabled')).toBe(true);
    unmount();
  });
});

describe('MailView — populated / empty ("no fourth reading")', () => {
  test('a successful response renders rows, with the unread pill on the unread one', async () => {
    inboxList = () => Promise.resolve({
      messages: [
        { uid: 1, from: 'a@example.com', subject: 'Read one', date: '2026-01-01T09:00:00Z', unread: false, bodyPreview: 'preview a', messageId: '<a@x>' },
        { uid: 2, from: 'b@example.com', subject: 'Unread one', date: '2026-01-02T09:00:00Z', unread: true, bodyPreview: 'preview b', messageId: '<b@x>' },
      ],
      total: 2,
    });
    const { el, unmount } = render();
    await waitFor(() => Boolean(el.querySelector('[data-testid="mail-list"]')));

    const rows = [...el.querySelectorAll('.mail-row')];
    expect(rows).toHaveLength(2);
    const unreadRow = rows.find((row) => row.classList.contains('mail-row--unread'));
    expect(unreadRow?.textContent).toContain('Unread one');
    expect(unreadRow?.querySelector('.mail-row__unread-pill')).not.toBeNull();
    const readRow = rows.find((row) => !row.classList.contains('mail-row--unread'));
    expect(readRow?.querySelector('.mail-row__unread-pill')).toBeNull();
    unmount();
  });

  test('a successful response with messages: [] renders the empty state, NOT a refusal note', async () => {
    inboxList = () => Promise.resolve({ messages: [], total: 0 });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('Nothing in the inbox'));
    expect(el.querySelector('[data-testid="mail-note-not-available"]')).toBeNull();
    expect(el.querySelector('[data-testid="mail-note-needs-setup"]')).toBeNull();
    unmount();
  });
});

describe('MailView — inbox order is sender-proof (uid, never date)', () => {
  test('a spoofed far-future Date: header does not pin a message to the top when its uid is lowest', async () => {
    inboxList = () => Promise.resolve({
      messages: [
        // Lowest uid (oldest arrival) but a `Date:` header far in the future — this is
        // exactly the attacker move: the sender writes any date it wants, so if the
        // view sorted on `date` this message would render first. It must not.
        { uid: 1, from: 'attacker@example.com', subject: 'Spoofed future date', date: '2099-01-01T00:00:00Z', unread: false, bodyPreview: 'p1', messageId: '<attacker@x>' },
        { uid: 2, from: 'a@example.com', subject: 'Real, older uid', date: '2026-01-01T09:00:00Z', unread: false, bodyPreview: 'p2', messageId: '<a@x>' },
        { uid: 3, from: 'b@example.com', subject: 'Real, newest uid', date: '2026-01-02T09:00:00Z', unread: false, bodyPreview: 'p3', messageId: '<b@x>' },
      ],
      total: 3,
    });
    const { el, unmount } = render();
    await waitFor(() => Boolean(el.querySelector('[data-testid="mail-list"]')));

    const subjects = [...el.querySelectorAll('.mail-row__subject')].map((node) => node.textContent);
    // Newest-first by uid: 3, 2, 1 — the spoofed-date message (uid 1) is last, not first.
    expect(subjects[0]).toContain('Real, newest uid');
    expect(subjects[1]).toContain('Real, older uid');
    expect(subjects[2]).toContain('Spoofed future date');
    unmount();
  });

  test('ordering is stable and correct when two messages carry identical date values', async () => {
    const sameDate = '2026-01-01T00:00:00Z';
    inboxList = () => Promise.resolve({
      messages: [
        { uid: 10, from: 'a@example.com', subject: 'ten', date: sameDate, unread: false, bodyPreview: 'p', messageId: '<10@x>' },
        { uid: 30, from: 'b@example.com', subject: 'thirty', date: sameDate, unread: false, bodyPreview: 'p', messageId: '<30@x>' },
        { uid: 20, from: 'c@example.com', subject: 'twenty', date: sameDate, unread: false, bodyPreview: 'p', messageId: '<20@x>' },
      ],
      total: 3,
    });
    const { el, unmount } = render();
    await waitFor(() => Boolean(el.querySelector('[data-testid="mail-list"]')));

    const subjects = [...el.querySelectorAll('.mail-row__subject')].map((node) => node.textContent);
    expect(subjects[0]).toContain('thirty');
    expect(subjects[1]).toContain('twenty');
    expect(subjects[2]).toContain('ten');
    unmount();
  });
});

describe('MailView — messages the daemon could not read', () => {
  test('an inbox where every message failed to parse does NOT render as a normal empty inbox', async () => {
    // The state this exists to catch. Before the 1.19.1 re-pin the inbox-list result
    // type omitted `unreadable` entirely, so this response reached the view as
    // "messages: [], total: 0" and rendered "The account answered normally with no
    // messages in this window" — a sentence that is false in exactly the situation
    // an operator most needs the truth.
    inboxList = () =>
      Promise.resolve({
        messages: [],
        total: 0,
        unreadable: [
          { uid: 41, detail: 'unsupported transfer encoding' },
          { detail: 'malformed header, uid unknown' },
        ],
      });
    const { el, unmount } = render();
    await waitFor(() => Boolean(el.querySelector('[data-testid="mail-unreadable"]')));

    expect(el.textContent).toContain('Nothing readable in the inbox');
    expect(el.textContent).not.toContain('The account answered normally');
    expect(el.textContent).toContain('2 messages could not be read');
    // The per-message reason, not just a count — a count tells an operator nothing
    // about whether it is one broken sender or a misconfigured account.
    expect(el.textContent).toContain('uid 41: unsupported transfer encoding');
    // A failure with no uid renders its reason alone, never "uid undefined".
    expect(el.textContent).toContain('malformed header, uid unknown');
    expect(el.textContent).not.toContain('undefined');
    unmount();
  });

  test('unreadable messages are reported alongside a list that DID load', async () => {
    inboxList = () =>
      Promise.resolve({
        messages: [
          {
            uid: 7,
            from: 'a@example.com',
            subject: 'Readable',
            date: '2026-01-01T00:00:00Z',
            unread: false,
            bodyPreview: 'hi',
            messageId: '<a@example.com>',
          },
        ],
        total: 2,
        unreadable: [{ uid: 8, detail: 'attachment decode failed' }],
      });
    const { el, unmount } = render();
    await waitFor(() => Boolean(el.querySelector('[data-testid="mail-list"]')));

    expect(el.querySelector('[data-testid="mail-unreadable"]')).not.toBeNull();
    expect(el.textContent).toContain('1 message could not be read');
    expect(el.textContent).toContain('uid 8: attachment decode failed');
    unmount();
  });

  test('a clean inbox renders no unreadable note at all', async () => {
    // The negative case: without this, the two assertions above would pass against a
    // note that is always present.
    inboxList = () =>
      Promise.resolve({
        messages: [
          {
            uid: 7,
            from: 'a@example.com',
            subject: 'Readable',
            date: '2026-01-01T00:00:00Z',
            unread: false,
            bodyPreview: 'hi',
            messageId: '<a@example.com>',
          },
        ],
        total: 1,
      });
    const { el, unmount } = render();
    await waitFor(() => Boolean(el.querySelector('[data-testid="mail-list"]')));

    expect(el.querySelector('[data-testid="mail-unreadable"]')).toBeNull();
    expect(el.textContent).not.toContain('could not be read');
    unmount();
  });
});
