/**
 * useConfirmSheet + ConfirmSheet, ask() resolves true on Confirm, false on
 * Cancel/Escape, renders the action name/target, and never stacks two sheets.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useConfirmSheet, type ConfirmRequest } from './useConfirmSheet';

let askRef: ((r: ConfirmRequest) => Promise<boolean>) | null = null;

function Harness() {
  const confirm = useConfirmSheet();
  askRef = confirm.ask;
  return React.createElement(React.Fragment, null, confirm.element);
}

function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => root.render(React.createElement(Harness)));
  return {
    el: container,
    unmount: () => {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
}

function click(el: Element | null | undefined) {
  flushSync(() => el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
}

/** Open a sheet through ask(), committing the render, and hand back its answer. */
function ask(request: ConfirmRequest): Promise<boolean> {
  let answer: Promise<boolean> | undefined;
  flushSync(() => {
    answer = askRef!(request);
  });
  if (!answer) throw new Error('ask() did not return a promise');
  return answer;
}

afterEach(() => {
  askRef = null;
});

describe('useConfirmSheet', () => {
  test('renders nothing until ask() is called', () => {
    const { el, unmount } = render();
    expect(el.querySelector('.confirm-sheet')).toBeNull();
    unmount();
  });

  test('ask() shows the sheet with the title and target, resolves true on Confirm', async () => {
    const { el, unmount } = render();
    const answer = ask({ title: 'Restore this checkpoint', target: 'nightly-42', confirmLabel: 'Restore', tone: 'danger' });
    const sheet = el.querySelector('.confirm-sheet');
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain('Restore this checkpoint');
    expect(sheet!.textContent).toContain('nightly-42');
    click(el.querySelector('.confirm-sheet__confirm'));
    expect(await answer).toBe(true);
    flushSync(() => {});
    // The sheet closes after resolving.
    expect(el.querySelector('.confirm-sheet')).toBeNull();
    unmount();
  });

  test('ask() resolves false on Cancel', async () => {
    const { el, unmount } = render();
    const answer = ask({ title: 'Cancel task', target: 't1' });
    click(el.querySelector('.confirm-sheet__cancel'));
    expect(await answer).toBe(false);
    unmount();
  });

  test('a second ask() while one is open resolves the first as false', async () => {
    const { el, unmount } = render();
    const first = ask({ title: 'First' });
    void ask({ title: 'Second' });
    expect(await first).toBe(false);
    flushSync(() => {});
    expect(el.querySelector('.confirm-sheet')!.textContent).toContain('Second');
    unmount();
  });
});
