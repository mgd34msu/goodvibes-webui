/**
 * QueuedMessagesPanel — messages posted mid-turn sit queued until delivery.
 * Covers: honest absence (renders nothing when empty), listing, inline edit,
 * delete-with-confirm, and error surfacing.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let listImpl: (sessionId: string) => Promise<{ sessionId: string; messages: { id: string; queuedAt: number; text: string }[] }> =
  (sessionId) => Promise.resolve({ sessionId, messages: [] });
let editImpl: (sessionId: string, id: string, text: string) => Promise<{ sessionId: string; id: string; text: string }> =
  (sessionId, id, text) => Promise.resolve({ sessionId, id, text });
let deleteImpl: (sessionId: string, id: string) => Promise<{ sessionId: string; id: string; deleted: boolean }> =
  (sessionId, id) => Promise.resolve({ sessionId, id, deleted: true });

const calls = { edit: [] as { id: string; text: string }[], delete: [] as string[] };

mock.module('../../lib/goodvibes', () => ({
  // Not called by anything this panel renders, but src/lib/queries.ts (imported for
  // queryKeys) statically imports these two names from this module — they must
  // resolve or the import itself fails before any test runs.
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  sdk: {
    operator: {
      sessions: {
        queuedMessages: {
          list: (sessionId: string) => listImpl(sessionId),
          edit: (sessionId: string, id: string, text: string) => {
            calls.edit.push({ id, text });
            return editImpl(sessionId, id, text);
          },
          delete: (sessionId: string, id: string) => {
            calls.delete.push(id);
            return deleteImpl(sessionId, id);
          },
        },
      },
    },
  },
}));

const { QueuedMessagesPanel } = await import('./QueuedMessagesPanel');

function render(sessionId = 's-1', active = true): { el: HTMLElement; unmount: () => void } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(QueuedMessagesPanel, { sessionId, active })));
  });
  return {
    el: container,
    unmount: () => {
      flushSync(() => { root.unmount(); });
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

function click(el: Element | null | undefined): void {
  flushSync(() => { el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
    flushSync(() => {});
  }
}

let cleanup: (() => void) | null = null;
let confirmSpy: ((message?: string) => boolean) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  listImpl = (sessionId) => Promise.resolve({ sessionId, messages: [] });
  editImpl = (sessionId, id, text) => Promise.resolve({ sessionId, id, text });
  deleteImpl = (sessionId, id) => Promise.resolve({ sessionId, id, deleted: true });
  calls.edit = [];
  calls.delete = [];
  if (confirmSpy) {
    window.confirm = confirmSpy;
    confirmSpy = null;
  }
});

describe('QueuedMessagesPanel', () => {
  test('renders nothing when there are no queued messages (honest absence)', async () => {
    const { el, unmount } = render();
    cleanup = unmount;
    await waitFor(() => true, 50).catch(() => {});
    // Give the query a tick to settle, then confirm nothing rendered.
    await new Promise((resolve) => setTimeout(resolve, 20));
    flushSync(() => {});
    expect(el.textContent).toBe('');
  });

  test('lists queued messages with their text', async () => {
    listImpl = (sessionId) => Promise.resolve({
      sessionId,
      messages: [{ id: 'q-1', queuedAt: 1000, text: 'Second message while you finish' }],
    });
    const { el, unmount } = render();
    cleanup = unmount;
    await waitFor(() => Boolean(el.querySelector('.queued-message')));
    expect(el.textContent).toContain('Second message while you finish');
    expect(el.textContent).toContain('Queued');
  });

  test('editing a queued message calls sessions.queuedMessages.edit with the new text', async () => {
    listImpl = (sessionId) => Promise.resolve({
      sessionId,
      messages: [{ id: 'q-1', queuedAt: 1000, text: 'Original text' }],
    });
    const { el, unmount } = render();
    cleanup = unmount;
    await waitFor(() => Boolean(el.querySelector('.queued-message__edit')));

    click(el.querySelector('.queued-message__edit'));
    await waitFor(() => Boolean(el.querySelector('.queued-message__edit-form')));

    const textarea = el.querySelector('.queued-message__edit-form textarea') as HTMLTextAreaElement;
    flushSync(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, 'Updated text');
      textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    });

    const form = el.querySelector('.queued-message__edit-form') as HTMLFormElement;
    flushSync(() => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });

    await waitFor(() => calls.edit.length > 0);
    expect(calls.edit).toEqual([{ id: 'q-1', text: 'Updated text' }]);
  });

  test('cancelling an edit restores the plain view without calling edit', async () => {
    listImpl = (sessionId) => Promise.resolve({
      sessionId,
      messages: [{ id: 'q-1', queuedAt: 1000, text: 'Original text' }],
    });
    const { el, unmount } = render();
    cleanup = unmount;
    await waitFor(() => Boolean(el.querySelector('.queued-message__edit')));
    click(el.querySelector('.queued-message__edit'));
    await waitFor(() => Boolean(el.querySelector('.queued-message__cancel-edit')));
    click(el.querySelector('.queued-message__cancel-edit'));
    expect(el.querySelector('.queued-message__edit-form')).toBeNull();
    expect(calls.edit).toEqual([]);
  });

  test('deleting a queued message asks for confirmation, then calls sessions.queuedMessages.delete', async () => {
    listImpl = (sessionId) => Promise.resolve({
      sessionId,
      messages: [{ id: 'q-1', queuedAt: 1000, text: 'Drop me' }],
    });
    confirmSpy = window.confirm;
    window.confirm = () => true;
    const { el, unmount } = render();
    cleanup = unmount;
    await waitFor(() => Boolean(el.querySelector('.queued-message__delete')));
    click(el.querySelector('.queued-message__delete'));
    await waitFor(() => calls.delete.length > 0);
    expect(calls.delete).toEqual(['q-1']);
  });

  test('declining the confirmation does NOT call delete', async () => {
    listImpl = (sessionId) => Promise.resolve({
      sessionId,
      messages: [{ id: 'q-1', queuedAt: 1000, text: 'Keep me' }],
    });
    confirmSpy = window.confirm;
    window.confirm = () => false;
    const { el, unmount } = render();
    cleanup = unmount;
    await waitFor(() => Boolean(el.querySelector('.queued-message__delete')));
    click(el.querySelector('.queued-message__delete'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls.delete).toEqual([]);
  });

  test('an edit failure surfaces an honest error banner', async () => {
    listImpl = (sessionId) => Promise.resolve({
      sessionId,
      messages: [{ id: 'q-1', queuedAt: 1000, text: 'Original text' }],
    });
    editImpl = () => Promise.reject(new Error('the turn already finished'));
    const { el, unmount } = render();
    cleanup = unmount;
    await waitFor(() => Boolean(el.querySelector('.queued-message__edit')));
    click(el.querySelector('.queued-message__edit'));
    await waitFor(() => Boolean(el.querySelector('.queued-message__edit-form')));
    const form = el.querySelector('.queued-message__edit-form') as HTMLFormElement;
    flushSync(() => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
    await waitFor(() => Boolean(el.querySelector('.banner.warning')));
    expect(el.querySelector('.banner.warning')?.textContent).toContain('the turn already finished');
  });

  test('does not poll (refetchInterval off) when active is false', async () => {
    let calls2 = 0;
    listImpl = (sessionId) => { calls2 += 1; return Promise.resolve({ sessionId, messages: [{ id: 'q-1', queuedAt: 1, text: 'x' }] }); };
    const { el, unmount } = render('s-1', false);
    cleanup = unmount;
    await waitFor(() => Boolean(el.querySelector('.queued-message')));
    const afterFirst = calls2;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(calls2).toBe(afterFirst);
  });
});
