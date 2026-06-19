import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import {
  DEFAULT_THEME_PREFERENCES,
  THEME_PREFERENCES_EVENT,
  THEME_PREFERENCES_KEY,
  applyThemeToRoot,
  readThemePreferences,
  resolveInitialTheme,
  writeThemePreferences,
} from './theme';

// ---------------------------------------------------------------------------
// localStorage mock helpers (used for read/resolve tests that need isolation)
// ---------------------------------------------------------------------------

function makeMockStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
  };
}

let mockStorage = makeMockStorage();

function installWindowMock(mediaMatches = false) {
  mockStorage = makeMockStorage();
  // happy-dom sets window = globalThis; override the property
  (globalThis as Record<string, unknown>).window = {
    localStorage: mockStorage,
    matchMedia: (_query: string) => ({ matches: mediaMatches }),
    // no-op dispatchEvent for tests that don't need event capture
    dispatchEvent: (_e: unknown) => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

function removeWindowMock() {
  // Restore happy-dom's original window (which is globalThis)
  (globalThis as Record<string, unknown>).window = globalThis;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('theme constants', () => {
  test('THEME_PREFERENCES_KEY is a non-empty string', () => {
    expect(typeof THEME_PREFERENCES_KEY).toBe('string');
    expect(THEME_PREFERENCES_KEY.length).toBeGreaterThan(0);
  });

  test('THEME_PREFERENCES_EVENT is a non-empty string', () => {
    expect(typeof THEME_PREFERENCES_EVENT).toBe('string');
    expect(THEME_PREFERENCES_EVENT.length).toBeGreaterThan(0);
  });

  test('DEFAULT_THEME_PREFERENCES defaults to dark/default', () => {
    expect(DEFAULT_THEME_PREFERENCES.theme).toBe('dark');
    expect(DEFAULT_THEME_PREFERENCES.density).toBe('default');
  });
});

// ---------------------------------------------------------------------------
// resolveInitialTheme — no window
// ---------------------------------------------------------------------------

describe('resolveInitialTheme — no window', () => {
  beforeEach(removeWindowMock);
  afterEach(removeWindowMock);

  test('returns dark when window is absent', () => {
    expect(resolveInitialTheme()).toBe('dark');
  });
});

// ---------------------------------------------------------------------------
// resolveInitialTheme — with mock window
// ---------------------------------------------------------------------------

describe('resolveInitialTheme — with storage', () => {
  afterEach(removeWindowMock);

  test('returns stored light theme', () => {
    installWindowMock();
    mockStorage.setItem(THEME_PREFERENCES_KEY, JSON.stringify({ theme: 'light' }));
    expect(resolveInitialTheme()).toBe('light');
  });

  test('returns stored dark theme', () => {
    installWindowMock();
    mockStorage.setItem(THEME_PREFERENCES_KEY, JSON.stringify({ theme: 'dark' }));
    expect(resolveInitialTheme()).toBe('dark');
  });

  test('ignores invalid stored theme value', () => {
    installWindowMock();
    mockStorage.setItem(THEME_PREFERENCES_KEY, JSON.stringify({ theme: 'solarized' }));
    // Falls through to matchMedia check — matchMedia returns false here -> dark
    expect(resolveInitialTheme()).toBe('dark');
  });

  test('falls back to light via matchMedia when no stored preference', () => {
    installWindowMock(true); // matchMedia matches light
    expect(resolveInitialTheme()).toBe('light');
  });

  test('falls back to dark when matchMedia does not match light', () => {
    installWindowMock(false);
    expect(resolveInitialTheme()).toBe('dark');
  });

  test('returns dark on malformed stored JSON', () => {
    installWindowMock();
    mockStorage.setItem(THEME_PREFERENCES_KEY, 'bad json{{{');
    expect(resolveInitialTheme()).toBe('dark');
  });
});

// ---------------------------------------------------------------------------
// readThemePreferences — no window
// ---------------------------------------------------------------------------

describe('readThemePreferences — no window', () => {
  beforeEach(removeWindowMock);
  afterEach(removeWindowMock);

  test('returns defaults when window is absent', () => {
    expect(readThemePreferences()).toEqual(DEFAULT_THEME_PREFERENCES);
  });
});

// ---------------------------------------------------------------------------
// readThemePreferences — with mock storage
// ---------------------------------------------------------------------------

describe('readThemePreferences — with storage', () => {
  beforeEach(() => installWindowMock());
  afterEach(removeWindowMock);

  test('returns defaults when storage is empty', () => {
    expect(readThemePreferences()).toEqual(DEFAULT_THEME_PREFERENCES);
  });

  test('reads stored light theme', () => {
    mockStorage.setItem(THEME_PREFERENCES_KEY, JSON.stringify({ theme: 'light', density: 'default' }));
    expect(readThemePreferences().theme).toBe('light');
  });

  test('reads stored compact density', () => {
    mockStorage.setItem(THEME_PREFERENCES_KEY, JSON.stringify({ theme: 'dark', density: 'compact' }));
    expect(readThemePreferences().density).toBe('compact');
  });

  test('coerces invalid theme to default dark', () => {
    mockStorage.setItem(THEME_PREFERENCES_KEY, JSON.stringify({ theme: 'hacker', density: 'default' }));
    expect(readThemePreferences().theme).toBe('dark');
  });

  test('coerces invalid density to default', () => {
    mockStorage.setItem(THEME_PREFERENCES_KEY, JSON.stringify({ theme: 'dark', density: 'comfortable' }));
    expect(readThemePreferences().density).toBe('default');
  });

  test('returns defaults on malformed JSON', () => {
    mockStorage.setItem(THEME_PREFERENCES_KEY, '{broken');
    expect(readThemePreferences()).toEqual(DEFAULT_THEME_PREFERENCES);
  });
});

// ---------------------------------------------------------------------------
// writeThemePreferences — uses real happy-dom window + localStorage
// happy-dom's window.dispatchEvent requires a happy-dom Event instance.
// We spy by replacing dispatchEvent on the real window (= globalThis).
// ---------------------------------------------------------------------------

describe('writeThemePreferences — with storage', () => {
  let dispatchSpy: ReturnType<typeof createDispatchSpy>;

  function createDispatchSpy() {
    const calls: unknown[] = [];
    const orig = (globalThis as Record<string, unknown>).dispatchEvent as (e: unknown) => boolean;
    ;(globalThis as Record<string, unknown>).dispatchEvent = (e: unknown) => { calls.push(e); return true; };
    return { calls, restore: () => { (globalThis as Record<string, unknown>).dispatchEvent = orig; } };
  }

  beforeEach(() => {
    // Ensure real happy-dom window is active (undo any mock)
    (globalThis as Record<string, unknown>).window = globalThis;
    window.localStorage.clear();
    dispatchSpy = createDispatchSpy();
  });

  afterEach(() => {
    dispatchSpy.restore();
    window.localStorage.clear();
  });

  test('returns the written preferences', () => {
    const prefs = { theme: 'light' as const, density: 'compact' as const };
    expect(writeThemePreferences(prefs)).toEqual(prefs);
  });

  test('persists so subsequent read returns written value', () => {
    writeThemePreferences({ theme: 'light', density: 'compact' });
    const read = readThemePreferences();
    expect(read.theme).toBe('light');
    expect(read.density).toBe('compact');
  });

  test('dispatches an event per write call', () => {
    writeThemePreferences({ theme: 'light', density: 'default' });
    expect(dispatchSpy.calls.length).toBe(1);
  });

  test('overwrites a previous stored value', () => {
    writeThemePreferences({ theme: 'light', density: 'compact' });
    writeThemePreferences({ theme: 'dark', density: 'default' });
    const read = readThemePreferences();
    expect(read.theme).toBe('dark');
    expect(read.density).toBe('default');
  });
});

describe('writeThemePreferences — no storage', () => {
  beforeEach(() => installWindowMock());
  afterEach(removeWindowMock);

  test('returns preferences without throwing when localStorage dispatches via no-op', () => {
    const prefs = { theme: 'light' as const, density: 'default' as const };
    expect(writeThemePreferences(prefs)).toEqual(prefs);
  });
});

// ---------------------------------------------------------------------------
// applyThemeToRoot
// ---------------------------------------------------------------------------

describe('applyThemeToRoot', () => {
  let mockRoot: { setAttribute: (k: string, v: string) => void; removeAttribute: (k: string) => void; attrs: Map<string, string> };
  let origDoc: unknown;

  beforeEach(() => {
    origDoc = (globalThis as Record<string, unknown>).document;
    mockRoot = {
      attrs: new Map<string, string>(),
      setAttribute(k: string, v: string) { this.attrs.set(k, v); },
      removeAttribute(k: string) { this.attrs.delete(k); },
    };
    (globalThis as Record<string, unknown>).document = {
      documentElement: mockRoot,
    };
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).document = origDoc;
  });

  test('sets data-theme attribute to provided theme', () => {
    applyThemeToRoot({ theme: 'light', density: 'default' });
    expect(mockRoot.attrs.get('data-theme')).toBe('light');
  });

  test('sets data-density to compact when density is compact', () => {
    applyThemeToRoot({ theme: 'dark', density: 'compact' });
    expect(mockRoot.attrs.get('data-density')).toBe('compact');
  });

  test('removes data-density when density is default', () => {
    // First set compact so the attr exists, then switch to default
    applyThemeToRoot({ theme: 'dark', density: 'compact' });
    applyThemeToRoot({ theme: 'dark', density: 'default' });
    expect(mockRoot.attrs.has('data-density')).toBe(false);
  });

  test('no-ops when document is undefined', () => {
    (globalThis as Record<string, unknown>).document = undefined;
    expect(() => applyThemeToRoot({ theme: 'dark', density: 'default' })).not.toThrow();
  });
});
