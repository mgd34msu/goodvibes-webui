/**
 * useConfirmSheet + ConfirmSheet — ask() resolves true on Confirm, false on
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

async function tick() {
  await new Promise((r) => setTimeout(r, 10));
  flushSync(() => {});
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
    const results: boolean[] = [];
    flushSync(() => {
      void askRef!({ title: 'Restore this checkpoint', target: 'nightly-42', confirmLabel: 'Restore', tone: 'danger' }).then((v) => results.push(v));
    });
    const sheet = el.querySelector('.confirm-sheet');
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain('Restore this checkpoint');
    expect(sheet!.textContent).toContain('nightly-42');
    click(el.querySelector('.confirm-sheet__confirm'));
    await tick();
    expect(results).toEqual([true]);
    // The sheet closes after resolving.
    expect(el.querySelector('.confirm-sheet')).toBeNull();
    unmount();
  });

  test('ask() resolves false on Cancel', async () => {
    const { el, unmount } = render();
    const results: boolean[] = [];
    flushSync(() => {
      void askRef!({ title: 'Cancel task', target: 't1' }).then((v) => results.push(v));
    });
    click(el.querySelector('.confirm-sheet__cancel'));
    await tick();
    expect(results).toEqual([false]);
    unmount();
  });

  test('a second ask() while one is open resolves the first as false', async () => {
    const { el, unmount } = render();
    const first: boolean[] = [];
    flushSync(() => {
      void askRef!({ title: 'First' }).then((v) => first.push(v));
    });
    flushSync(() => {
      void askRef!({ title: 'Second' }).then(() => {});
    });
    await tick();
    expect(first).toEqual([false]);
    expect(el.querySelector('.confirm-sheet')!.textContent).toContain('Second');
    unmount();
  });
});
