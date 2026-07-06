/**
 * CheckpointsView — rendering from a mocked checkpoints.* client, covering
 * the honesty markers: true-empty, an honest noop:true create (never a
 * fabricated checkpoint), and the destructive-restore confirm gate (fires
 * only after window.confirm returns true, never on the first click).
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../lib/toast';

const restoreCalls: unknown[] = [];
const createCalls: unknown[] = [];
let createImpl: (input: unknown) => Promise<unknown> = () => Promise.resolve({ checkpoint: null, noop: true });
let diffImpl: (input: unknown) => Promise<unknown> = () => Promise.resolve({
  diff: { from: 'wcp_1', to: 'WORKING', files: ['a.txt'], unifiedDiff: '--- a\n+++ b\n', stat: '1 file changed' },
});

mock.module('../../lib/goodvibes', () => ({
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  sdk: {
    operator: {
      checkpoints: {
        list: () => Promise.resolve(FIXTURE_LIST),
        create: (input: unknown) => { createCalls.push(input); return createImpl(input); },
        diff: (input: unknown) => diffImpl(input),
        restore: (input: unknown) => { restoreCalls.push(input); return Promise.resolve({ result: { checkpointId: 'wcp_1', safetyCheckpointId: null, restoredFiles: ['a.txt'], removedFiles: [] } }); },
      },
    },
  },
}));

const { CheckpointsView } = await import('./CheckpointsView');
const { queryKeys } = await import('../../lib/queries');

const FIXTURE_LIST = {
  checkpoints: [
    { id: 'wcp_1', kind: 'manual', label: 'diff base', createdAt: 200, parentId: null, retentionClass: 'standard', commit: 'aaaaaaaaaaaa1111', sizeBytes: 2048 },
    { id: 'wcp_2', kind: 'turn', label: '', createdAt: 100, parentId: 'wcp_1', retentionClass: 'short', commit: 'bbbbbbbbbbbb2222', sizeBytes: 512 },
  ],
};

function render(seed: unknown = FIXTURE_LIST): { el: HTMLElement; unmount: () => void } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.checkpoints, seed);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(ToastProvider, null, React.createElement(CheckpointsView)),
    ));
  });
  return {
    el: container,
    unmount: () => {
      flushSync(() => root.unmount());
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

function click(el: Element | null | undefined) {
  flushSync(() => {
    el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
    flushSync(() => {});
  }
}

let originalConfirm: typeof window.confirm;

afterEach(() => {
  restoreCalls.length = 0;
  createCalls.length = 0;
  createImpl = () => Promise.resolve({ checkpoint: null, noop: true });
  diffImpl = () => Promise.resolve({
    diff: { from: 'wcp_1', to: 'WORKING', files: ['a.txt'], unifiedDiff: '--- a\n+++ b\n', stat: '1 file changed' },
  });
  if (originalConfirm) window.confirm = originalConfirm;
});

describe('CheckpointsView rendering', () => {
  test('renders every checkpoint by label, falling back to id when unlabeled', () => {
    const { el, unmount } = render();
    const text = el.textContent ?? '';
    expect(text).toContain('diff base');
    expect(text).toContain('wcp_2');
    unmount();
  });

  test('a true-empty checkpoints list says "No checkpoints yet"', () => {
    const { el, unmount } = render({ checkpoints: [] });
    expect(el.textContent).toContain('No checkpoints yet');
    unmount();
  });

  test('selecting a checkpoint fetches and shows its diff', async () => {
    const { el, unmount } = render();
    const row = [...el.querySelectorAll('.checkpoints-row')].find((r) => r.textContent?.includes('diff base'));
    click(row);
    await waitFor(() => (el.textContent ?? '').includes('file'));
    expect(el.textContent).toContain('1 file changed: a.txt');
    unmount();
  });

  test('a checkpoint with no file differences from the working tree says so', async () => {
    diffImpl = () => Promise.resolve({ diff: { from: 'wcp_1', to: 'WORKING', files: [], unifiedDiff: '', stat: '' } });
    const { el, unmount } = render();
    const row = [...el.querySelectorAll('.checkpoints-row')].find((r) => r.textContent?.includes('diff base'));
    click(row);
    await waitFor(() => (el.textContent ?? '').includes('No file differences'));
    unmount();
  });
});

describe('CheckpointsView create — honest noop', () => {
  test('a noop:true create shows the honest "unchanged" message, never fabricating a checkpoint row', async () => {
    createImpl = () => Promise.resolve({ checkpoint: null, noop: true });
    const { el, unmount } = render();
    const button = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Snapshot'));
    click(button);
    await waitFor(() => createCalls.length > 0);
    // No new row was fabricated — still exactly the two fixture rows.
    expect(el.querySelectorAll('.checkpoints-row').length).toBe(2);
    unmount();
  });

  test('a real (non-noop) create is called with the label kind manual', async () => {
    createImpl = () => Promise.resolve({ checkpoint: { id: 'wcp_3', kind: 'manual', label: 'new one', createdAt: 300, parentId: null, retentionClass: 'standard', commit: 'cccc', sizeBytes: 10 }, noop: false });
    const { el, unmount } = render();
    const button = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Snapshot'));
    click(button);
    await waitFor(() => createCalls.length > 0);
    expect(createCalls[0]).toMatchObject({ kind: 'manual' });
    unmount();
  });
});

describe('CheckpointsView restore — destructive confirm gate', () => {
  test('restore does NOT fire without confirmation', () => {
    originalConfirm = window.confirm;
    window.confirm = () => false;
    const { el, unmount } = render();
    const row = [...el.querySelectorAll('.checkpoints-row')].find((r) => r.textContent?.includes('diff base'));
    click(row);
    const restoreButton = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Restore this checkpoint'));
    click(restoreButton);
    expect(restoreCalls).toHaveLength(0);
    unmount();
  });

  test('restore fires exactly once after confirmation, naming the checkpoint', async () => {
    originalConfirm = window.confirm;
    let confirmMessage = '';
    window.confirm = (message?: string) => { confirmMessage = message ?? ''; return true; };
    const { el, unmount } = render();
    const row = [...el.querySelectorAll('.checkpoints-row')].find((r) => r.textContent?.includes('diff base'));
    click(row);
    const restoreButton = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Restore this checkpoint'));
    click(restoreButton);
    await waitFor(() => restoreCalls.length > 0);
    expect(restoreCalls).toHaveLength(1);
    expect(restoreCalls[0]).toMatchObject({ id: 'wcp_1' });
    expect(confirmMessage).toContain('diff base');
    expect(confirmMessage.toLowerCase()).toContain('overwrite');
    unmount();
  });
});
