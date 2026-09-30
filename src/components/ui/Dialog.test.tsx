import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Dialog } from './Dialog';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let closes = 0;
let opener: HTMLButtonElement;

function renderDialog(open: boolean): void {
  flushSync(() => {
    root.render(
      <Dialog
        open={open}
        onClose={() => { closes += 1; }}
        title="Revoke token"
        description="The device signs out at once."
        size="confirm"
        hideClose
        footer={(
          <>
            <button type="button">Cancel</button>
            <button type="button">Revoke</button>
          </>
        )}
      />,
    );
  });
}

function key(target: Element, k: string, shiftKey = false): KeyboardEvent {
  const event = new window.KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true });
  flushSync(() => { target.dispatchEvent(event); });
  return event;
}

beforeEach(() => {
  closes = 0;
  opener = document.createElement('button');
  opener.textContent = 'Open';
  document.body.appendChild(opener);
  opener.focus();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
  opener.remove();
});

describe('Dialog: modal, labelled, focus-trapped', () => {
  test('is a labelled modal dialog with focus moved inside', () => {
    renderDialog(true);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Revoke token');
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toContain('signs out');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  test('Tab wraps from the last control to the first, Shift+Tab the other way', () => {
    renderDialog(true);
    const buttons = [...document.querySelectorAll('[role="dialog"] button')] as HTMLButtonElement[];
    buttons[buttons.length - 1].focus();
    const forward = key(buttons[buttons.length - 1], 'Tab');
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
    key(buttons[0], 'Tab', true);
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });

  test('Escape closes it and does not reach window listeners underneath', () => {
    renderDialog(true);
    let windowSawEscape = false;
    const onWindow = (e: KeyboardEvent) => { if (e.key === 'Escape') windowSawEscape = true; };
    window.addEventListener('keydown', onWindow);
    key(document.activeElement ?? document.body, 'Escape');
    window.removeEventListener('keydown', onWindow);
    expect(closes).toBe(1);
    expect(windowSawEscape).toBe(false);
  });

  test('closing returns focus to what opened it', () => {
    renderDialog(true);
    renderDialog(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
