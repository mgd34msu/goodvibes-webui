/**
 * Tests for useTheme hook and ThemeProvider.
 * Uses react-dom/client + flushSync + happy-dom (bunfig.toml preload).
 *
 * happy-dom's CustomEvent/StorageEvent are incompatible with bun's native
 * EventTarget. We route window event methods to a shared happy-dom Window
 * so source-code event dispatch and listener registration work end-to-end.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Window } from 'happy-dom';
import { ThemeProvider, useTheme } from './useTheme';
import {
  THEME_PREFERENCES_EVENT,
  THEME_PREFERENCES_KEY,
  readThemePreferences,
} from '../lib/theme';

// ---------------------------------------------------------------------------
// happy-dom event-bus patch
// ---------------------------------------------------------------------------
// test-setup.ts sets window = globalThis (bun's EventTarget) and installs
// happy-dom's CustomEvent/StorageEvent. bun's native dispatchEvent rejects
// happy-dom event instances. We route window event methods through a single
// happy-dom Window whose event system is compatible with those constructors.

const happyWin = new Window({ url: 'http://localhost/' });

type AnyListener = (e: Event) => void;
const originalDispatch = globalThis.dispatchEvent?.bind(globalThis);
const originalAddEL = globalThis.addEventListener?.bind(globalThis);
const originalRemoveEL = globalThis.removeEventListener?.bind(globalThis);

function patchWindowEvents() {
  Object.defineProperty(globalThis, 'dispatchEvent', {
    value: (e: Event) => {
      const isCustom = Object.prototype.hasOwnProperty.call(e, 'detail') ||
        (e as CustomEvent).detail !== undefined;
      let hdEvent: InstanceType<typeof happyWin.Event>;
      if (isCustom) {
        hdEvent = new happyWin.CustomEvent((e as CustomEvent).type, {
          detail: (e as CustomEvent).detail,
          bubbles: e.bubbles,
          cancelable: e.cancelable,
        });
      } else {
        hdEvent = new happyWin.Event(e.type, { bubbles: e.bubbles, cancelable: e.cancelable });
      }
      return happyWin.dispatchEvent(hdEvent);
    },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'addEventListener', {
    value: (type: string, listener: AnyListener, opts?: boolean | AddEventListenerOptions) =>
      happyWin.addEventListener(type, listener as unknown as Parameters<typeof happyWin.addEventListener>[1], opts as boolean | undefined),
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'removeEventListener', {
    value: (type: string, listener: AnyListener, opts?: boolean | EventListenerOptions) =>
      happyWin.removeEventListener(type, listener as unknown as Parameters<typeof happyWin.removeEventListener>[1]),
    writable: true,
    configurable: true,
  });
}

function restoreWindowEvents() {
  if (originalDispatch) {
    Object.defineProperty(globalThis, 'dispatchEvent', { value: originalDispatch, writable: true, configurable: true });
  }
  if (originalAddEL) {
    Object.defineProperty(globalThis, 'addEventListener', { value: originalAddEL, writable: true, configurable: true });
  }
  if (originalRemoveEL) {
    Object.defineProperty(globalThis, 'removeEventListener', { value: originalRemoveEL, writable: true, configurable: true });
  }
}

// ---------------------------------------------------------------------------
// Types / render helper
// ---------------------------------------------------------------------------

type UseThemeHandle = ReturnType<typeof useTheme>;

function renderInto(
  ui: React.ReactElement,
  el?: HTMLElement,
): { el: HTMLElement; root: ReturnType<typeof createRoot>; unmount: () => void } {
  const container = el ?? document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => { root.render(ui); });
  return {
    el: container,
    root,
    unmount: () => {
      flushSync(() => { root.unmount(); });
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

/**
 * Captures the useTheme handle from inside a ThemeProvider.
 * useLayoutEffect fires synchronously after each render, so handle is always
 * current after flushSync.
 */
function HookCapture({ onHandle }: { onHandle: (h: UseThemeHandle) => void }): null {
  const handle = useTheme();
  React.useLayoutEffect(() => { onHandle(handle); });
  return null;
}

function renderThemeProvider(
  onHandle: (h: UseThemeHandle) => void,
): ReturnType<typeof renderInto> {
  return renderInto(
    <ThemeProvider>
      <HookCapture onHandle={onHandle} />
    </ThemeProvider>,
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  patchWindowEvents();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-density');
});

afterEach(() => {
  restoreWindowEvents();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-density');
});

// ---------------------------------------------------------------------------
// useTheme — error boundary
// ---------------------------------------------------------------------------

describe('useTheme outside ThemeProvider', () => {
  test('throws when called outside ThemeProvider', () => {
    let threw = false;
    function BadConsumer(): null {
      try { useTheme(); } catch { threw = true; }
      return null;
    }
    const r = renderInto(<BadConsumer />);
    r.unmount();
    expect(threw).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ThemeProvider — initial state
// ---------------------------------------------------------------------------

describe('ThemeProvider initial state', () => {
  test('defaults to dark theme when nothing stored', () => {
    let handle!: UseThemeHandle;
    const r = renderThemeProvider((h) => { handle = h; });
    expect(handle.theme).toBe('dark');
    r.unmount();
  });

  test('defaults to default density when nothing stored', () => {
    let handle!: UseThemeHandle;
    const r = renderThemeProvider((h) => { handle = h; });
    expect(handle.density).toBe('default');
    r.unmount();
  });

  test('picks up stored light theme on mount', () => {
    window.localStorage.setItem(THEME_PREFERENCES_KEY, JSON.stringify({ theme: 'light', density: 'default' }));
    let handle!: UseThemeHandle;
    const r = renderThemeProvider((h) => { handle = h; });
    expect(handle.theme).toBe('light');
    r.unmount();
  });

  test('picks up stored compact density on mount', () => {
    window.localStorage.setItem(THEME_PREFERENCES_KEY, JSON.stringify({ theme: 'dark', density: 'compact' }));
    let handle!: UseThemeHandle;
    const r = renderThemeProvider((h) => { handle = h; });
    expect(handle.density).toBe('compact');
    r.unmount();
  });

  test('applies data-theme to documentElement on mount', () => {
    let handle!: UseThemeHandle;
    const r = renderThemeProvider((h) => { handle = h; });
    expect(document.documentElement.getAttribute('data-theme')).toBe(handle.theme);
    r.unmount();
  });
});

// ---------------------------------------------------------------------------
// setTheme
// ---------------------------------------------------------------------------

describe('setTheme', () => {
  test('updates theme state to light', () => {
    let handle!: UseThemeHandle;
    const r = renderThemeProvider((h) => { handle = h; });

    flushSync(() => { handle.setTheme('light'); });

    expect(handle.theme).toBe('light');
    r.unmount();
  });

  test('sets data-theme attribute on documentElement', () => {
    let handle!: UseThemeHandle;
    const r = renderThemeProvider((h) => { handle = h; });

    flushSync(() => { handle.setTheme('light'); });

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    r.unmount();
  });

  test('persists theme to localStorage', () => {
    let handle!: UseThemeHandle;
    const r = renderThemeProvider((h) => { handle = h; });

    flushSync(() => { handle.setTheme('light'); });

    const stored = readThemePreferences();
    expect(stored.theme).toBe('light');
    r.unmount();
  });

  test('can switch back from light to dark', () => {
    let handle!: UseThemeHandle;
    const r = renderThemeProvider((h) => { handle = h; });

    flushSync(() => { handle.setTheme('light'); });
    flushSync(() => { handle.setTheme('dark'); });

    expect(handle.theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    r.unmount();
  });
});

// ---------------------------------------------------------------------------
// setDensity
// ---------------------------------------------------------------------------

describe('setDensity', () => {
  test('updates density state to compact', () => {
    let handle!: UseThemeHandle;
    const r = renderThemeProvider((h) => { handle = h; });

    flushSync(() => { handle.setDensity('compact'); });

    expect(handle.density).toBe('compact');
    r.unmount();
  });

  test('sets data-density attribute on documentElement', () => {
    let handle!: UseThemeHandle;
    const r = renderThemeProvider((h) => { handle = h; });

    flushSync(() => { handle.setDensity('compact'); });

    expect(document.documentElement.getAttribute('data-density')).toBe('compact');
    r.unmount();
  });

  test('removes data-density attribute when switching back to default', () => {
    window.localStorage.setItem(THEME_PREFERENCES_KEY, JSON.stringify({ theme: 'dark', density: 'compact' }));
    let handle!: UseThemeHandle;
    const r = renderThemeProvider((h) => { handle = h; });

    flushSync(() => { handle.setDensity('default'); });

    expect(document.documentElement.hasAttribute('data-density')).toBe(false);
    r.unmount();
  });

  test('persists density to localStorage', () => {
    let handle!: UseThemeHandle;
    const r = renderThemeProvider((h) => { handle = h; });

    flushSync(() => { handle.setDensity('compact'); });

    const stored = readThemePreferences();
    expect(stored.density).toBe('compact');
    r.unmount();
  });
});

// ---------------------------------------------------------------------------
// toggleTheme
// ---------------------------------------------------------------------------

describe('toggleTheme', () => {
  test('toggles from dark to light', () => {
    let handle!: UseThemeHandle;
    const r = renderThemeProvider((h) => { handle = h; });
    expect(handle.theme).toBe('dark');

    flushSync(() => { handle.toggleTheme(); });

    expect(handle.theme).toBe('light');
    r.unmount();
  });

  test('toggles from light to dark', () => {
    window.localStorage.setItem(THEME_PREFERENCES_KEY, JSON.stringify({ theme: 'light', density: 'default' }));
    let handle!: UseThemeHandle;
    const r = renderThemeProvider((h) => { handle = h; });

    flushSync(() => { handle.toggleTheme(); });

    expect(handle.theme).toBe('dark');
    r.unmount();
  });

  test('toggle updates data-theme on documentElement', () => {
    let handle!: UseThemeHandle;
    const r = renderThemeProvider((h) => { handle = h; });

    flushSync(() => { handle.toggleTheme(); });

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    r.unmount();
  });

  test('toggle persists to localStorage', () => {
    let handle!: UseThemeHandle;
    const r = renderThemeProvider((h) => { handle = h; });

    flushSync(() => { handle.toggleTheme(); });

    const stored = readThemePreferences();
    expect(stored.theme).toBe('light');
    r.unmount();
  });

  test('double toggle returns to original theme', () => {
    let handle!: UseThemeHandle;
    const r = renderThemeProvider((h) => { handle = h; });

    flushSync(() => { handle.toggleTheme(); });
    flushSync(() => { handle.toggleTheme(); });

    expect(handle.theme).toBe('dark');
    r.unmount();
  });
});

// ---------------------------------------------------------------------------
// Cross-tab / storage event sync
// ---------------------------------------------------------------------------

describe('cross-tab storage event sync', () => {
  test('updates theme state when storage event fires with new prefs', async () => {
    let handle!: UseThemeHandle;
    const r = renderThemeProvider((h) => { handle = h; });
    expect(handle.theme).toBe('dark');

    // Simulate another tab writing to localStorage
    window.localStorage.setItem(THEME_PREFERENCES_KEY, JSON.stringify({ theme: 'light', density: 'default' }));
    // Dispatch a storage event via happy-dom's window (compatible with patched addEventListener)
    happyWin.dispatchEvent(new happyWin.StorageEvent('storage', { key: THEME_PREFERENCES_KEY }));
    // Allow React to process the state update
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync(() => {});

    expect(handle.theme).toBe('light');
    r.unmount();
  });

  test('updates density state when custom theme event fires', async () => {
    let handle!: UseThemeHandle;
    const r = renderThemeProvider((h) => { handle = h; });

    // Simulate same-tab custom event (e.g., from another ThemeProvider instance)
    window.localStorage.setItem(THEME_PREFERENCES_KEY, JSON.stringify({ theme: 'dark', density: 'compact' }));
    // Dispatch a custom event via happy-dom's window directly (already patched into window)
    happyWin.dispatchEvent(new happyWin.CustomEvent(THEME_PREFERENCES_EVENT, {
      detail: { theme: 'dark', density: 'compact' },
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync(() => {});

    expect(handle.density).toBe('compact');
    r.unmount();
  });
});
