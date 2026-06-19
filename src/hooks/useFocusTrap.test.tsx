/**
 * Tests for useFocusTrap hook.
 * Uses react-dom/client + flushSync + happy-dom (bunfig.toml preload).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useFocusTrap } from './useFocusTrap';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Trap({
  active,
  buttonCount = 3,
}: {
  active: boolean;
  buttonCount?: number;
}): React.ReactElement {
  const ref = useFocusTrap<HTMLDivElement>(active);
  return (
    <div ref={ref} tabIndex={-1} data-testid="trap">
      {Array.from({ length: buttonCount }, (_, i) => (
        <button key={i} type="button" data-testid={`btn-${i}`}>
          Button {i}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let container: HTMLElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  flushSync(() => { root.unmount(); });
  if (container.parentNode) container.parentNode.removeChild(container);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFocusTrap', () => {
  test('moves focus to first focusable element when activated', () => {
    flushSync(() => { root.render(<Trap active />); });
    expect(document.activeElement?.getAttribute('data-testid')).toBe('btn-0');
  });

  test('Tab on last element wraps focus to first', () => {
    flushSync(() => { root.render(<Trap active />); });

    const last = container.querySelector<HTMLElement>('[data-testid="btn-2"]')!;
    last.focus();
    expect(document.activeElement).toBe(last);

    const trapEl = container.querySelector<HTMLElement>('[data-testid="trap"]')!;
    trapEl.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );

    expect(document.activeElement?.getAttribute('data-testid')).toBe('btn-0');
  });

  test('Shift+Tab on first element wraps focus to last', () => {
    flushSync(() => { root.render(<Trap active />); });

    const first = container.querySelector<HTMLElement>('[data-testid="btn-0"]')!;
    first.focus();
    expect(document.activeElement).toBe(first);

    const trapEl = container.querySelector<HTMLElement>('[data-testid="trap"]')!;
    trapEl.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(document.activeElement?.getAttribute('data-testid')).toBe('btn-2');
  });

  test('focusin recovery pulls stray focus back into trap', () => {
    flushSync(() => { root.render(<Trap active />); });

    const outsider = document.createElement('button');
    outsider.setAttribute('data-testid', 'outsider');
    document.body.appendChild(outsider);

    outsider.focus();
    outsider.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    expect(document.activeElement?.getAttribute('data-testid')).toBe('btn-0');

    document.body.removeChild(outsider);
  });

  test('no-focusable fallback: focuses the container itself', () => {
    function EmptyTrap(): React.ReactElement {
      const ref = useFocusTrap<HTMLDivElement>(true);
      return <div ref={ref} tabIndex={-1} data-testid="empty-trap" />;
    }
    flushSync(() => { root.render(<EmptyTrap />); });
    expect(document.activeElement?.getAttribute('data-testid')).toBe('empty-trap');
  });

  test('focus is restored to previously focused element on deactivation', () => {
    const outsideBtn = document.createElement('button');
    outsideBtn.setAttribute('data-testid', 'restore-target');
    document.body.appendChild(outsideBtn);
    outsideBtn.focus();
    expect(document.activeElement).toBe(outsideBtn);

    let setActive!: (v: boolean) => void;
    function ControlledTrap(): React.ReactElement {
      const [active, setA] = useState(false);
      setActive = setA;
      const ref = useFocusTrap<HTMLDivElement>(active);
      return (
        <div ref={ref} tabIndex={-1} data-testid="controlled-trap">
          <button type="button" data-testid="trap-btn">Inside</button>
        </div>
      );
    }

    flushSync(() => { root.render(<ControlledTrap />); });
    flushSync(() => { setActive(true); });
    expect(document.activeElement?.getAttribute('data-testid')).toBe('trap-btn');

    flushSync(() => { setActive(false); });
    expect(document.activeElement).toBe(outsideBtn);

    document.body.removeChild(outsideBtn);
  });

  test('does not trap focus when active is false', () => {
    const outside = document.createElement('button');
    outside.setAttribute('data-testid', 'outside-inactive');
    document.body.appendChild(outside);

    flushSync(() => { root.render(<Trap active={false} />); });
    outside.focus();

    expect(document.activeElement).toBe(outside);
    document.body.removeChild(outside);
  });
});
