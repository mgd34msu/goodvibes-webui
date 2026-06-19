/**
 * Tests for ConnectionDot.
 * Pure component — no hooks. Uses createRoot + flushSync + happy-dom.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ConnectionDot } from './ConnectionDot';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderInto(
  ui: React.ReactElement,
): { el: HTMLElement; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => { root.render(ui); });
  return {
    el: container,
    unmount: () => {
      flushSync(() => { root.unmount(); });
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConnectionDot', () => {
  describe('connection state CSS classes', () => {
    test('renders dot--connected class for connected state', () => {
      const { el, unmount } = renderInto(<ConnectionDot state="connected" />);
      cleanup = unmount;
      const span = el.querySelector('span');
      expect(span?.className).toContain('status-strip__dot--connected');
      expect(span?.className).toContain('status-strip__dot');
    });

    test('renders dot--reconnecting class for reconnecting state', () => {
      const { el, unmount } = renderInto(<ConnectionDot state="reconnecting" />);
      cleanup = unmount;
      const span = el.querySelector('span');
      expect(span?.className).toContain('status-strip__dot--reconnecting');
    });

    test('renders dot--down class for down state', () => {
      const { el, unmount } = renderInto(<ConnectionDot state="down" />);
      cleanup = unmount;
      const span = el.querySelector('span');
      expect(span?.className).toContain('status-strip__dot--down');
    });
  });

  test('is aria-hidden (color is not the sole indicator)', () => {
    const { el, unmount } = renderInto(<ConnectionDot state="connected" />);
    cleanup = unmount;
    const span = el.querySelector('span');
    expect(span?.getAttribute('aria-hidden')).toBe('true');
  });

  test('merges optional className onto the element', () => {
    const { el, unmount } = renderInto(<ConnectionDot state="down" className="extra-class" />);
    cleanup = unmount;
    const span = el.querySelector('span');
    expect(span?.className).toContain('extra-class');
    // base class still present
    expect(span?.className).toContain('status-strip__dot--down');
  });

  test('omits extra className when not provided', () => {
    const { el, unmount } = renderInto(<ConnectionDot state="connected" />);
    cleanup = unmount;
    const span = el.querySelector('span');
    // Should not contain a trailing space or undefined string
    expect(span?.className).not.toContain('undefined');
    expect(span?.className).not.toMatch(/ $/);
  });
});
