/**
 * CiWatchesView — the "open fix session" affordance. A watch that auto-starts a
 * fix session on failure returns the started session's id on the ci.watches.run
 * verb result; the view offers to open that session and calls onOpenSession with
 * exactly that id. When no fix session started, no affordance is shown.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../lib/toast';

let runResult: Record<string, unknown> = {};
const watchesList = {
  watches: [
    {
      id: 'ciw_1', repo: 'acme/example', ref: 'main', deliveryChannel: 'slack:#ci',
      triggerFixSession: true, lastOverall: 'failed', createdAt: 1, updatedAt: 1,
    },
  ],
};

mock.module('../../lib/goodvibes', () => ({
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  sdk: {
    operator: {
      ci: {
        watches: {
          list: () => Promise.resolve(watchesList),
          run: () => Promise.resolve(runResult),
          delete: () => Promise.resolve({ deleted: true }),
        },
      },
    },
  },
}));

const { CiWatchesView } = await import('./CiWatchesView');

function render(onOpenSession?: (id: string) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(ToastProvider, null, React.createElement(CiWatchesView, { onOpenSession })),
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

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
    flushSync(() => {});
  }
  throw new Error('waitFor timed out');
}

function clickByText(el: HTMLElement, text: string): void {
  const button = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  if (!button) throw new Error(`no button matching "${text}"`);
  flushSync(() => button.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
}

afterEach(() => {
  runResult = {};
  document.body.innerHTML = '';
});

describe('CiWatchesView — open fix session', () => {
  test('a run that started a fix session offers to open it and calls onOpenSession with the verb-result id', async () => {
    runResult = {
      report: { repo: 'acme/example', ref: 'main', overall: 'failed', jobs: [], violations: [], checkedAt: 1 },
      notified: true,
      fixSessionTriggered: true,
      fixSessionId: 'sess-ci-fix-42',
    };
    const opened: string[] = [];
    const { el, unmount } = render((id) => opened.push(id));

    await waitFor(() => Boolean([...el.querySelectorAll('.ci-watches-row')].length));
    clickByText(el, 'acme/example'); // select the watch
    await waitFor(() => Boolean([...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Check now'))));
    clickByText(el, 'Check now');
    await waitFor(() => Boolean([...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Open fix session'))));

    clickByText(el, 'Open fix session');
    expect(opened).toEqual(['sess-ci-fix-42']);
    unmount();
  });

  test('a run that did not start a fix session shows no open-session affordance', async () => {
    runResult = {
      report: { repo: 'acme/example', ref: 'main', overall: 'failed', jobs: [], violations: [], checkedAt: 1 },
      notified: true,
      fixSessionTriggered: false,
    };
    const opened: string[] = [];
    const { el, unmount } = render((id) => opened.push(id));

    await waitFor(() => Boolean([...el.querySelectorAll('.ci-watches-row')].length));
    clickByText(el, 'acme/example');
    await waitFor(() => Boolean([...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Check now'))));
    clickByText(el, 'Check now');
    await waitFor(() => Boolean(el.querySelector('.ci-report')));

    expect([...el.querySelectorAll('button')].some((b) => b.textContent?.includes('Open fix session'))).toBe(false);
    unmount();
  });
});
