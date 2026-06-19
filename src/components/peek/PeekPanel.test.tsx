/**
 * Tests for PeekPanel (slide-over peek panel).
 * Uses react-dom/client + flushSync + happy-dom (bunfig.toml preload).
 *
 * Event dispatching:
 *   bun's globalThis.dispatchEvent() rejects happy-dom Event objects.
 *   PeekPanel registers keydown/focusin on window/document (bun-native targets).
 *   Fix: intercept window/document addEventListener to capture handlers, then
 *   invoke them directly in tests. Capture is installed before renderPeek() in
 *   beforeEach and stays active through afterEach so useEffect-registered
 *   handlers (fired after flushSync) are always captured.
 *
 * Focus behaviour:
 *   PeekPanel's focus useEffect runs synchronously within flushSync (React 19
 *   production + bun flushes passive effects in the same microtask batch).
 *   IMPORTANT: PeekPanel focuses the first focusable element in the *entire
 *   panel div* — the peek-close button in the header comes before the body
 *   content. Tests that check "first focusable" must account for this ordering.
 *
 * DOM click events on happy-dom elements work correctly: PeekPanel uses React
 * onClick which delegates via React's container (a happy-dom element).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { PeekProvider, usePeek } from './PeekPanel';

// ---------------------------------------------------------------------------
// Event handler capture
// Installed once per test in beforeEach, torn down in afterEach.
// ---------------------------------------------------------------------------

type AnyHandler = (e: unknown) => void;
// Store all handlers per event type (PeekPanel registers 2 keydown listeners).
const _capturedWindow = new Map<string, AnyHandler[]>();
const _capturedDocument = new Map<string, AnyHandler[]>();
let _origWinAdd: typeof window.addEventListener | null = null;
let _origDocAdd: typeof document.addEventListener | null = null;

function installCapture(): void {
  _capturedWindow.clear();
  _capturedDocument.clear();
  _origWinAdd = window.addEventListener.bind(window);
  _origDocAdd = document.addEventListener.bind(document);

  (window as unknown as Record<string, unknown>).addEventListener = (
    type: string,
    handler: EventListenerOrEventListenerObject,
    opts?: unknown,
  ) => {
    const arr = _capturedWindow.get(type) ?? [];
    arr.push(handler as AnyHandler);
    _capturedWindow.set(type, arr);
    _origWinAdd!(type, handler as EventListener, opts as AddEventListenerOptions);
  };

  (document as unknown as Record<string, unknown>).addEventListener = (
    type: string,
    handler: EventListenerOrEventListenerObject,
    opts?: unknown,
  ) => {
    const arr = _capturedDocument.get(type) ?? [];
    arr.push(handler as AnyHandler);
    _capturedDocument.set(type, arr);
    _origDocAdd!(type, handler as EventListener, opts as AddEventListenerOptions);
  };
}

function removeCapture(): void {
  if (_origWinAdd) {
    (window as unknown as Record<string, unknown>).addEventListener = _origWinAdd;
    _origWinAdd = null;
  }
  if (_origDocAdd) {
    (document as unknown as Record<string, unknown>).addEventListener = _origDocAdd;
    _origDocAdd = null;
  }
}

/** Invoke ALL captured window keydown handlers (PeekPanel registers 2). */
function fireKeydown(key: string, shiftKey = false): void {
  const handlers = _capturedWindow.get('keydown') ?? [];
  const evt = { key, shiftKey, preventDefault: () => {} };
  flushSync(() => { handlers.forEach((h) => h(evt)); });
}

/** Invoke the captured document focusin handlers. */
function fireFocusin(target: EventTarget): void {
  const handlers = _capturedDocument.get('focusin') ?? [];
  const evt = { target };
  flushSync(() => { handlers.forEach((h) => h(evt)); });
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface PeekHandle {
  open: (title?: string, content?: React.ReactNode) => void;
  close: () => void;
  isOpen: () => boolean;
}

function renderPeek(): {
  container: HTMLElement;
  handle: PeekHandle;
  unmount: () => void;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  let peekCtx!: ReturnType<typeof usePeek>;

  function Inner(): React.ReactElement {
    peekCtx = usePeek();
    return <button type="button" data-testid="trigger">Open</button>;
  }

  flushSync(() => {
    root.render(
      <PeekProvider>
        <Inner />
      </PeekProvider>,
    );
  });

  const defaultContent = <button type="button" data-testid="content-btn">Content Action</button>;

  const handle: PeekHandle = {
    open: (title = 'Test Panel', content = defaultContent) => {
      flushSync(() => { peekCtx.open({ title, content }); });
      // Second flush ensures any deferred microtasks from useEffect also complete
      flushSync(() => {});
    },
    close: () => { flushSync(() => { peekCtx.close(); }); },
    isOpen: () => peekCtx.isOpen,
  };

  return {
    container,
    handle,
    unmount: () => {
      flushSync(() => { root.unmount(); });
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// Capture installed BEFORE renderPeek so all addEventListener calls including
// those from mount-time useEffect (none in this component) are intercepted.
// Capture stays active throughout the test so open()-triggered useEffects are
// captured (they register keydown/focusin after the flushSync in open()).
// ---------------------------------------------------------------------------

let container: HTMLElement;
let handle: PeekHandle;
let unmount: () => void;

beforeEach(() => {
  installCapture();
  ({ container, handle, unmount } = renderPeek());
});

afterEach(() => {
  try { unmount(); } finally { removeCapture(); }
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('PeekPanel — rendering', () => {
  test('panel is initially closed (no peek-panel--open class)', () => {
    const panel = container.querySelector('[role="dialog"]');
    expect(panel).not.toBeNull();
    expect(panel!.classList.contains('peek-panel--open')).toBe(false);
  });

  test('open adds peek-panel--open class', () => {
    handle.open();
    const panel = container.querySelector('[role="dialog"]');
    expect(panel!.classList.contains('peek-panel--open')).toBe(true);
  });

  test('open renders provided content inside the panel body', () => {
    handle.open('My Panel', <span data-testid="my-content">Hello</span>);
    const content = container.querySelector('[data-testid="my-content"]');
    expect(content).not.toBeNull();
    expect(content!.textContent).toBe('Hello');
  });

  test('panel has role=dialog', () => {
    const panel = container.querySelector('[role="dialog"]');
    expect(panel).not.toBeNull();
  });

  test('panel has aria-modal="true"', () => {
    handle.open();
    const panel = container.querySelector('[role="dialog"]');
    expect(panel!.getAttribute('aria-modal')).toBe('true');
  });

  test('panel aria-label matches the title passed to open()', () => {
    handle.open('Details View');
    const panel = container.querySelector('[role="dialog"]');
    expect(panel!.getAttribute('aria-label')).toBe('Details View');
  });

  test('backdrop element is present', () => {
    const backdrop = container.querySelector('.peek-backdrop');
    expect(backdrop).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Focus on open
//
// PeekPanel focuses the first focusable element inside the panel div.
// The panel structure is: header (containing peek-close button) + body.
// Therefore the FIRST focusable element is always the .peek-close button,
// not any button in the content body.
// ---------------------------------------------------------------------------

describe('PeekPanel — focus on open', () => {
  test('focus lands inside the panel when opened (first focusable = close button)', () => {
    handle.open(
      'Focus Test',
      <button type="button" data-testid="content-btn">Content</button>,
    );
    // The panel div contains the active element
    const panel = container.querySelector('[role="dialog"]')!;
    expect(panel.contains(document.activeElement)).toBe(true);
    // The close button is the first focusable — it gets focus
    expect(document.activeElement?.classList.contains('peek-close')).toBe(true);
  });

  test('focus lands inside the panel regardless of content (text-only body)', () => {
    // The close button is always present in the header, so the panelRef.focus()
    // fallback path (PeekPanel.tsx:108-110) is unreachable via the public API.
    // This test verifies the invariant: opening always lands focus inside the panel.
    handle.open('No Extra Focusable', <span>Text only content</span>);
    const panel = container.querySelector('[role="dialog"]')!;
    expect(panel.contains(document.activeElement)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Escape key closes panel
// ---------------------------------------------------------------------------

describe('PeekPanel — Escape key', () => {
  test('Escape key closes the panel', () => {
    handle.open();
    expect(handle.isOpen()).toBe(true);
    // keydown handler is registered in useEffect after open() — captured via installCapture
    fireKeydown('Escape');
    expect(handle.isOpen()).toBe(false);
  });

  test('non-Escape keydown does not close the panel', () => {
    handle.open();
    fireKeydown('Enter');
    expect(handle.isOpen()).toBe(true);
  });

  test('Escape does nothing when panel is closed (no handler registered)', () => {
    expect(handle.isOpen()).toBe(false);
    // When closed, the Escape handler is removed; calling fireKeydown is a no-op
    fireKeydown('Escape');
    expect(handle.isOpen()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Backdrop click closes panel
// ---------------------------------------------------------------------------

describe('PeekPanel — backdrop click', () => {
  test('clicking the backdrop closes the panel', () => {
    handle.open();
    expect(handle.isOpen()).toBe(true);
    const backdrop = container.querySelector('.peek-backdrop')!;
    flushSync(() => {
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(handle.isOpen()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Close button
// ---------------------------------------------------------------------------

describe('PeekPanel — close button', () => {
  test('close button click closes the panel', () => {
    handle.open();
    const closeBtn = container.querySelector('.peek-close')!;
    flushSync(() => {
      closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(handle.isOpen()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Focus trap — Tab / Shift+Tab wrapping
//
// PeekPanel's focus-trap useEffect registers keydown on window after open().
// The handler is captured via installCapture() which was installed in beforeEach
// before renderPeek(), so subsequent addEventListener calls (including those
// from useEffect triggered by open()) are intercepted.
// ---------------------------------------------------------------------------

describe('PeekPanel — focus trap', () => {
  test('Tab on last focusable element wraps focus to first', () => {
    handle.open(
      'Trap',
      // Note: peek-close is BEFORE this button — focusable order is:
      // [0] peek-close  [1] extra-btn
      <button type="button" data-testid="extra-btn">Extra</button>,
    );
    const panel = container.querySelector<HTMLElement>('[role="dialog"]')!;
    // Focus the last focusable element (extra-btn)
    const extraBtn = panel.querySelector<HTMLElement>('[data-testid="extra-btn"]')!;
    extraBtn.focus();
    expect(document.activeElement).toBe(extraBtn);

    // Tab should wrap to first (peek-close)
    fireKeydown('Tab', false);

    const closeBtn = panel.querySelector<HTMLElement>('.peek-close')!;
    expect(document.activeElement).toBe(closeBtn);
  });

  test('Shift+Tab on first focusable element wraps focus to last', () => {
    handle.open(
      'Trap',
      <button type="button" data-testid="extra-btn">Extra</button>,
    );
    const panel = container.querySelector<HTMLElement>('[role="dialog"]')!;
    // Focus the first focusable element (peek-close)
    const closeBtn = panel.querySelector<HTMLElement>('.peek-close')!;
    closeBtn.focus();
    expect(document.activeElement).toBe(closeBtn);

    // Shift+Tab should wrap to last (extra-btn)
    fireKeydown('Tab', true /* shiftKey */);

    const extraBtn = panel.querySelector<HTMLElement>('[data-testid="extra-btn"]')!;
    expect(document.activeElement).toBe(extraBtn);
  });

  test('Tab does not wrap when there is only one focusable element (close button)', () => {
    // With content-only text, peek-close is the only focusable element
    handle.open('Solo', <span>No extra buttons</span>);
    const panel = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const closeBtn = panel.querySelector<HTMLElement>('.peek-close')!;
    closeBtn.focus();

    // Neither Tab nor Shift+Tab should change focus since there is only one element
    // The handler returns early when first === last
    fireKeydown('Tab', false);
    // No assertion on exact focus target since handler returns early — panel stays open
    expect(handle.isOpen()).toBe(true);
  });

  test('focusin recovery pulls stray focus back inside the panel', () => {
    handle.open(
      'Stray',
      <button type="button" data-testid="inside-btn">Inside</button>,
    );

    const outsider = document.createElement('button');
    outsider.setAttribute('data-testid', 'outsider');
    document.body.appendChild(outsider);
    outsider.focus();

    // Fire the captured focusin handler with outsider as target
    fireFocusin(outsider);

    const panel = container.querySelector('[role="dialog"]')!;
    expect(panel.contains(document.activeElement)).toBe(true);

    document.body.removeChild(outsider);
  });
});

// ---------------------------------------------------------------------------
// Focus restoration on close
// ---------------------------------------------------------------------------

describe('PeekPanel — focus restoration on close', () => {
  test('focus returns to the trigger element after close', () => {
    const trigger = container.querySelector<HTMLElement>('[data-testid="trigger"]')!;
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    handle.open();
    // Focus should have moved inside panel (to peek-close button)
    const panel = container.querySelector('[role="dialog"]')!;
    expect(panel.contains(document.activeElement)).toBe(true);

    // Close — useEffect fires synchronously within flushSync, restores focus to trigger
    handle.close();
    expect(document.activeElement).toBe(trigger);
  });
});

// ---------------------------------------------------------------------------
// Deferred payload cleanup after close (PEEK_EXIT_DELAY_MS = 320 ms)
// PeekPanel.tsx:250-254: close() calls setTimeout(() => setPayload(null), 320)
// ---------------------------------------------------------------------------

describe('PeekPanel — deferred payload cleanup', () => {
  test('payload content is cleared after PEEK_EXIT_DELAY_MS following close()', async () => {
    handle.open('Cleanup Test', <span data-testid="cleanup-content">Content</span>);
    expect(container.querySelector('[data-testid="cleanup-content"]')).not.toBeNull();

    handle.close();
    // isOpen is false immediately
    expect(handle.isOpen()).toBe(false);

    // Content is still mounted (exit animation window)
    expect(container.querySelector('[data-testid="cleanup-content"]')).not.toBeNull();

    // Advance past PEEK_EXIT_DELAY_MS (320 ms) using a real-timer await.
    // The 350 ms window is sufficient for bun's event loop to fire the 320 ms
    // setTimeout inside PeekProvider.close() before the assertion runs.
    await new Promise<void>((resolve) => setTimeout(resolve, 350));
    flushSync(() => {});

    // Payload should be unmounted now
    expect(container.querySelector('[data-testid="cleanup-content"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// aria-hidden filter in getFocusableElements (PeekPanel.tsx:75-78)
// Focusable elements inside an aria-hidden ancestor must be excluded from
// the focus trap's candidate list.
// ---------------------------------------------------------------------------

describe('PeekPanel — aria-hidden focus exclusion', () => {
  test('element inside aria-hidden container is excluded from Tab target list', () => {
    // Content: one real button + one button hidden from AT inside aria-hidden wrapper.
    // The Tab trap should only see the real button (plus the close button),
    // never the aria-hidden one.
    handle.open(
      'AriaHidden Test',
      <>
        <button type="button" data-testid="visible-btn">Visible</button>
        <div aria-hidden="true">
          <button type="button" data-testid="hidden-btn">Hidden from AT</button>
        </div>
      </>,
    );
    const panel = container.querySelector<HTMLElement>('[role="dialog"]')!;
    // Focusable list seen by trap: [peek-close, visible-btn] (hidden-btn excluded)
    const visibleBtn = panel.querySelector<HTMLElement>('[data-testid="visible-btn"]')!;
    visibleBtn.focus();
    expect(document.activeElement).toBe(visibleBtn);

    // Tab from visible-btn (last non-hidden element) should wrap to peek-close (first)
    fireKeydown('Tab', false);
    const closeBtn = panel.querySelector<HTMLElement>('.peek-close')!;
    expect(document.activeElement).toBe(closeBtn);

    // The hidden button is never in the cycle
    const hiddenBtn = panel.querySelector<HTMLElement>('[data-testid="hidden-btn"]')!;
    expect(document.activeElement).not.toBe(hiddenBtn);
  });
});

// ---------------------------------------------------------------------------
// usePeek hook error boundary
// ---------------------------------------------------------------------------

describe('usePeek — context validation', () => {
  test('throws with a helpful message when used outside PeekProvider', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    let caught: Error | null = null;

    function BadConsumer(): null {
      try { usePeek(); } catch (e) { caught = e as Error; }
      return null;
    }

    flushSync(() => { root.render(<BadConsumer />); });
    expect(caught).not.toBeNull();
    expect(caught!.message).toContain('PeekProvider');

    flushSync(() => { root.unmount(); });
    if (el.parentNode) el.parentNode.removeChild(el);
  });

  test('isOpen is false initially', () => {
    expect(handle.isOpen()).toBe(false);
  });

  test('isOpen is true after open()', () => {
    handle.open();
    expect(handle.isOpen()).toBe(true);
  });

  test('isOpen is false after close()', () => {
    handle.open();
    handle.close();
    expect(handle.isOpen()).toBe(false);
  });
});
