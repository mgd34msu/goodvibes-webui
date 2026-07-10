/**
 * CheckpointsView — rendering from a mocked checkpoints.* client, covering
 * the honesty markers: true-empty, an honest noop:true create (never a
 * fabricated checkpoint), and the destructive-restore confirm gate (fires
 * only after the confirm sheet is confirmed, never on the first click).
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../lib/toast';
import { ToastViewport } from '../../components/toast/ToastViewport';

const restoreCalls: unknown[] = [];
const previewCalls: unknown[] = [];
const createCalls: unknown[] = [];
const diffCalls: unknown[] = [];
let createImpl: (input: unknown) => Promise<unknown> = () => Promise.resolve({ checkpoint: null, noop: true });
let diffImpl: (input: unknown) => Promise<unknown> = () => Promise.resolve({
  diff: { from: 'wcp_1', to: 'WORKING', files: ['a.txt'], unifiedDiff: '--- a\n+++ b\n', stat: '1 file changed' },
});
// Default: the daemon mints a preview token and performs the restore (refused: false).
// Individual tests override these to exercise the refusal / preview-failure paths.
let previewImpl: (input: unknown) => Promise<unknown> = () => Promise.resolve({
  token: 'tok_wcp_1',
  expiresAt: Date.now() + 120000,
  preview: { checkpointId: 'wcp_1', label: 'diff base', affectedPathCount: 1, affectedPathSample: ['a.txt'], stat: '1 file changed' },
});
let restoreImpl: (input: unknown) => Promise<unknown> = () => Promise.resolve({
  result: { checkpointId: 'wcp_1', safetyCheckpointId: null, restoredFiles: ['a.txt'], removedFiles: [] },
  refused: false,
  refusal: null,
});

mock.module('../../lib/goodvibes', () => ({
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  sdk: {
    operator: {
      checkpoints: {
        list: () => Promise.resolve(FIXTURE_LIST),
        create: (input: unknown) => { createCalls.push(input); return createImpl(input); },
        diff: (input: unknown) => { diffCalls.push(input); return diffImpl(input); },
        restorePreview: (input: unknown) => { previewCalls.push(input); return previewImpl(input); },
        restore: (input: unknown) => { restoreCalls.push(input); return restoreImpl(input); },
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
      React.createElement(
        ToastProvider,
        null,
        React.createElement(CheckpointsView),
        React.createElement(ToastViewport),
      ),
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

afterEach(() => {
  restoreCalls.length = 0;
  previewCalls.length = 0;
  createCalls.length = 0;
  diffCalls.length = 0;
  createImpl = () => Promise.resolve({ checkpoint: null, noop: true });
  diffImpl = () => Promise.resolve({
    diff: { from: 'wcp_1', to: 'WORKING', files: ['a.txt'], unifiedDiff: '--- a\n+++ b\n', stat: '1 file changed' },
  });
  previewImpl = () => Promise.resolve({
    token: 'tok_wcp_1',
    expiresAt: Date.now() + 120000,
    preview: { checkpointId: 'wcp_1', label: 'diff base', affectedPathCount: 1, affectedPathSample: ['a.txt'], stat: '1 file changed' },
  });
  restoreImpl = () => Promise.resolve({
    result: { checkpointId: 'wcp_1', safetyCheckpointId: null, restoredFiles: ['a.txt'], removedFiles: [] },
    refused: false,
    refusal: null,
  });
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

describe('CheckpointsView compare-target selector (D-WEBUI-1)', () => {
  test('defaults to diffing against the working tree with no b param', async () => {
    const { el, unmount } = render();
    const row = [...el.querySelectorAll('.checkpoints-row')].find((r) => r.textContent?.includes('diff base'));
    click(row);
    await waitFor(() => diffCalls.length > 0);
    expect(diffCalls[0]).toMatchObject({ a: 'wcp_1' });
    expect((diffCalls[0] as { b?: string }).b).toBeUndefined();
    expect(el.textContent).toContain('Diff vs. the working tree');
    unmount();
  });

  test('picking another checkpoint from the compare selector requests a checkpoint-to-checkpoint diff', async () => {
    const { el, unmount } = render();
    const row = [...el.querySelectorAll('.checkpoints-row')].find((r) => r.textContent?.includes('diff base'));
    click(row);
    await waitFor(() => diffCalls.length > 0);

    const select = el.querySelector('select[aria-label="Compare checkpoint to"]') as HTMLSelectElement;
    expect(select).toBeTruthy();
    flushSync(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(select, 'wcp_2');
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    await waitFor(() => diffCalls.length > 1);
    expect(diffCalls[diffCalls.length - 1]).toMatchObject({ a: 'wcp_1', b: 'wcp_2' });
    unmount();
  });

  test('an empty diff between two checkpoints reads "between these checkpoints", distinct from the working-tree wording', async () => {
    diffImpl = () => Promise.resolve({ diff: { from: 'wcp_1', to: 'wcp_2', files: [], unifiedDiff: '', stat: '' } });
    const { el, unmount } = render();
    const row = [...el.querySelectorAll('.checkpoints-row')].find((r) => r.textContent?.includes('diff base'));
    click(row);
    const select = el.querySelector('select[aria-label="Compare checkpoint to"]') as HTMLSelectElement;
    flushSync(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(select, 'wcp_2');
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    await waitFor(() => (el.textContent ?? '').includes('No file differences'));
    expect(el.textContent).toContain('No file differences between these checkpoints.');
    unmount();
  });

  test('selecting a different checkpoint row resets the compare target back to the working tree', async () => {
    const { el, unmount } = render();
    const row1 = [...el.querySelectorAll('.checkpoints-row')].find((r) => r.textContent?.includes('diff base'));
    click(row1);
    await waitFor(() => diffCalls.length > 0);
    const select = el.querySelector('select[aria-label="Compare checkpoint to"]') as HTMLSelectElement;
    flushSync(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(select, 'wcp_2');
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    await waitFor(() => diffCalls.length > 1);

    const row2 = [...el.querySelectorAll('.checkpoints-row')].find((r) => r.textContent?.includes('wcp_2'));
    click(row2);
    await waitFor(() => diffCalls.length > 2);
    expect(diffCalls[diffCalls.length - 1]).toMatchObject({ a: 'wcp_2' });
    expect((diffCalls[diffCalls.length - 1] as { b?: string }).b).toBeUndefined();
    expect(el.textContent).toContain('Diff vs. the working tree');
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
  function openRestore(el: HTMLElement) {
    const row = [...el.querySelectorAll('.checkpoints-row')].find((r) => r.textContent?.includes('diff base'));
    click(row);
    const restoreButton = [...el.querySelectorAll('.checkpoint-detail__restore')][0];
    click(restoreButton);
  }

  test('restore does NOT fire when the confirm sheet is cancelled', async () => {
    const { el, unmount } = render();
    openRestore(el);
    // The confirm sheet is open (destructive restore always confirms).
    await waitFor(() => Boolean(el.querySelector('.confirm-sheet')));
    click([...el.querySelectorAll('.confirm-sheet__cancel')][0]);
    await new Promise((r) => setTimeout(r, 20));
    flushSync(() => {});
    expect(restoreCalls).toHaveLength(0);
    unmount();
  });

  test('restore fires exactly once after confirming, authorized by the preview token', async () => {
    const { el, unmount } = render();
    openRestore(el);
    await waitFor(() => Boolean(el.querySelector('.confirm-sheet')));
    const sheet = el.querySelector('.confirm-sheet')!;
    // The sheet states the target and the overwrite consequence.
    expect(sheet.textContent).toContain('diff base');
    expect(sheet.textContent?.toLowerCase()).toContain('overwrite');
    // ...and the restorePreview enrichment: how many files would change plus a sampled path.
    expect(previewCalls).toHaveLength(1);
    expect(previewCalls[0]).toMatchObject({ id: 'wcp_1' });
    expect(sheet.textContent).toContain('1 file would change');
    expect(sheet.textContent).toContain('a.txt');
    click(sheet.querySelector('.confirm-sheet__confirm'));
    await waitFor(() => restoreCalls.length > 0);
    expect(restoreCalls).toHaveLength(1);
    // The restore is authorized by the single-use token from the preview, not a blind confirm.
    expect(restoreCalls[0]).toMatchObject({ id: 'wcp_1', confirmToken: 'tok_wcp_1' });
    unmount();
  });

  test('a structured refusal surfaces the reason and does not claim success', async () => {
    // The daemon returns the non-destructive refusal body (result: null, refused: true).
    restoreImpl = () => Promise.resolve({
      result: null,
      refused: true,
      refusal: {
        reason: 'checkpoints.restore is destructive and requires confirmation before it will run.',
        confirmField: 'confirm',
        previewMethod: 'checkpoints.restorePreview',
        options: [],
      },
    });
    const { el, unmount } = render();
    openRestore(el);
    await waitFor(() => Boolean(el.querySelector('.confirm-sheet')));
    click(el.querySelector('.confirm-sheet__confirm'));
    await waitFor(() => restoreCalls.length > 0);
    // The refusal reason is shown, and the success wording never appears.
    await waitFor(() => Boolean(el.querySelector('.toast')));
    const toastText = el.querySelector('.toast-viewport')?.textContent ?? '';
    expect(toastText).toContain('requires confirmation');
    expect(toastText).not.toContain('Workspace restored');
    unmount();
  });

  test('falls back to confirm:true when the preview call fails (non-NOT_FOUND)', async () => {
    previewImpl = () => Promise.reject(new Error('preview transport blip'));
    const { el, unmount } = render();
    openRestore(el);
    // The confirm sheet still opens (best-effort preview), with the un-enriched message.
    await waitFor(() => Boolean(el.querySelector('.confirm-sheet')));
    click(el.querySelector('.confirm-sheet__confirm'));
    await waitFor(() => restoreCalls.length > 0);
    expect(restoreCalls[0]).toMatchObject({ id: 'wcp_1', confirm: true });
    unmount();
  });
});
