/**
 * Tests for router.ts — pure URL encoder/decoder.
 * No DOM render needed; uses the happy-dom globals from bunfig.toml preload.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  type AppUrlState,
  decodeUrlState,
  encodeUrlState,
  getCurrentUrlState,
  pushState,
  replaceState,
} from './router';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<AppUrlState> = {}): AppUrlState {
  return {
    view: 'chat',
    session: '',
    filters: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// encodeUrlState
// ---------------------------------------------------------------------------

describe('encodeUrlState', () => {
  test('encodes view', () => {
    const result = encodeUrlState(makeState({ view: 'knowledge' }));
    expect(result).toContain('view=knowledge');
  });

  test('omits session when empty', () => {
    const result = encodeUrlState(makeState({ session: '' }));
    expect(result).not.toContain('session');
  });

  test('includes session when non-empty', () => {
    const result = encodeUrlState(makeState({ session: 'abc-123' }));
    expect(result).toContain('session=abc-123');
  });

  test('omits filters when empty object', () => {
    const result = encodeUrlState(makeState({ filters: {} }));
    expect(result).not.toContain('filter');
  });

  test('encodes a single filter key', () => {
    const result = encodeUrlState(makeState({ filters: { status: 'active' } }));
    const decoded = new URLSearchParams(result);
    expect(decoded.get('filter[status]')).toBe('active');
  });

  test('filter keys are sorted stably (alphabetical)', () => {
    const result = encodeUrlState(
      makeState({ filters: { z: '1', a: '2', m: '3' } }),
    );
    const params = new URLSearchParams(result);
    const keys: string[] = [];
    params.forEach((_, k) => {
      if (k.startsWith('filter[')) keys.push(k);
    });
    expect(keys).toEqual(['filter[a]', 'filter[m]', 'filter[z]']);
  });

  test('filter values with special characters are encoded and decodable', () => {
    const result = encodeUrlState(
      makeState({ filters: { q: 'val&ue=x' } }),
    );
    const decoded = new URLSearchParams(result);
    expect(decoded.get('filter[q]')).toBe('val&ue=x');
  });

  test('filter keys with spaces are encoded and decodable', () => {
    const result = encodeUrlState(
      makeState({ filters: { 'my key': 'value' } }),
    );
    const decoded = new URLSearchParams(result);
    expect(decoded.get('filter[my key]')).toBe('value');
  });

  test('omits filter entries with empty string value', () => {
    const result = encodeUrlState(
      makeState({ filters: { present: 'yes', empty: '' } }),
    );
    const decoded = new URLSearchParams(result);
    expect(decoded.get('filter[present]')).toBe('yes');
    expect(decoded.get('filter[empty]')).toBeNull();
  });

  test('all four valid views encode correctly', () => {
    for (const view of ['chat', 'knowledge', 'providers', 'admin'] as const) {
      const result = encodeUrlState(makeState({ view }));
      const decoded = new URLSearchParams(result);
      expect(decoded.get('view')).toBe(view);
    }
  });
});

// ---------------------------------------------------------------------------
// decodeUrlState
// ---------------------------------------------------------------------------

describe('decodeUrlState', () => {
  test('decodes all valid view values', () => {
    expect(decodeUrlState('?view=knowledge').view).toBe('knowledge');
    expect(decodeUrlState('?view=providers').view).toBe('providers');
    expect(decodeUrlState('?view=admin').view).toBe('admin');
    expect(decodeUrlState('?view=chat').view).toBe('chat');
  });

  // fleet/checkpoints are wired end-to-end (App.tsx); approvals-tasks/workstream
  // are registered ahead of their own views landing (see the nav-entries comment
  // in App.tsx) — all four must round-trip now so neither silently falls back
  // to 'chat'.
  test('decodes the fleet/checkpoints/approvals-tasks/workstream view ids', () => {
    expect(decodeUrlState('?view=fleet').view).toBe('fleet');
    expect(decodeUrlState('?view=checkpoints').view).toBe('checkpoints');
    expect(decodeUrlState('?view=approvals-tasks').view).toBe('approvals-tasks');
    expect(decodeUrlState('?view=workstream').view).toBe('workstream');
  });

  // ci-watches (SDK 1.6.1's initiative family — CI watches/status view).
  test('decodes the ci-watches view id', () => {
    expect(decodeUrlState('?view=ci-watches').view).toBe('ci-watches');
  });

  // checkin (SDK 1.6.1's initiative family — proactive check-in config/receipts view).
  test('decodes the checkin view id', () => {
    expect(decodeUrlState('?view=checkin').view).toBe('checkin');
  });

  // principals (SDK 1.6.1's initiative family — principals/channel-profiles admin view).
  test('decodes the principals view id', () => {
    expect(decodeUrlState('?view=principals').view).toBe('principals');
  });

  test('invalid view falls back to chat', () => {
    expect(decodeUrlState('?view=invalid').view).toBe('chat');
    expect(decodeUrlState('?view=').view).toBe('chat');
    // case-sensitive: 'Chat' is not valid
    expect(decodeUrlState('?view=Chat').view).toBe('chat');
  });

  test('missing view falls back to chat', () => {
    expect(decodeUrlState('').view).toBe('chat');
    expect(decodeUrlState('?session=s').view).toBe('chat');
  });

  test('decodes session parameter', () => {
    expect(decodeUrlState('?view=chat&session=sess-42').session).toBe('sess-42');
  });

  test('session defaults to empty string when absent', () => {
    expect(decodeUrlState('?view=chat').session).toBe('');
  });

  test('decodes a single filter[key] parameter', () => {
    const state = decodeUrlState('?view=chat&filter%5Bstatus%5D=active');
    expect(state.filters).toEqual({ status: 'active' });
  });

  test('decodes multiple filter keys', () => {
    const state = decodeUrlState(
      '?view=chat&filter%5Ba%5D=1&filter%5Bb%5D=2',
    );
    expect(state.filters).toEqual({ a: '1', b: '2' });
  });

  test('ignores malformed filter keys (no closing bracket)', () => {
    // "filter[noclosing" — key does not end with ] so ignored
    const state = decodeUrlState('?view=chat&filter%5Bnoclosing=x');
    expect(state.filters).toEqual({});
  });

  test('ignores filter key with empty key name (filter[])', () => {
    const state = decodeUrlState('?view=chat&filter%5B%5D=val');
    expect(state.filters).toEqual({});
  });

  test('filter values with special chars are decoded', () => {
    const state = decodeUrlState(
      '?view=chat&filter%5Bq%5D=hello%20world%26foo%3Dbar',
    );
    expect(state.filters['q']).toBe('hello world&foo=bar');
  });

  test('empty string input returns default state', () => {
    const state = decodeUrlState('');
    expect(state).toEqual({ view: 'chat', session: '', filters: {} });
  });
});

// ---------------------------------------------------------------------------
// Round-trip: encode → decode
// ---------------------------------------------------------------------------

describe('encodeUrlState / decodeUrlState round-trip', () => {
  test('round-trips a full state object', () => {
    const original = makeState({
      view: 'knowledge',
      session: 'sess-abc',
      filters: { category: 'docs', status: 'published' },
    });
    const encoded = encodeUrlState(original);
    const decoded = decodeUrlState(`?${encoded}`);
    expect(decoded).toEqual(original);
  });

  test('round-trips state with special chars in filter values', () => {
    const original = makeState({
      view: 'admin',
      session: '',
      filters: { q: 'hello world', tag: 'a=b&c=d' },
    });
    const encoded = encodeUrlState(original);
    const decoded = decodeUrlState(`?${encoded}`);
    expect(decoded).toEqual(original);
  });

  test('round-trips all four views', () => {
    for (const view of ['chat', 'knowledge', 'providers', 'admin'] as const) {
      const encoded = encodeUrlState(makeState({ view }));
      expect(decodeUrlState(`?${encoded}`).view).toBe(view);
    }
  });

  test('round-trips the fleet/checkpoints/approvals-tasks/workstream view ids', () => {
    for (const view of ['fleet', 'checkpoints', 'approvals-tasks', 'workstream'] as const) {
      const encoded = encodeUrlState(makeState({ view }));
      expect(decodeUrlState(`?${encoded}`).view).toBe(view);
    }
  });

  test('round-trips the ci-watches view id', () => {
    const encoded = encodeUrlState(makeState({ view: 'ci-watches' }));
    expect(decodeUrlState(`?${encoded}`).view).toBe('ci-watches');
  });

  test('round-trips the checkin view id', () => {
    const encoded = encodeUrlState(makeState({ view: 'checkin' }));
    expect(decodeUrlState(`?${encoded}`).view).toBe('checkin');
  });

  test('round-trips the principals view id', () => {
    const encoded = encodeUrlState(makeState({ view: 'principals' }));
    expect(decodeUrlState(`?${encoded}`).view).toBe('principals');
  });

  test('filter key ordering is stable across encode/decode', () => {
    const original = makeState({ filters: { z: '1', a: '2', m: '3' } });
    const decoded = decodeUrlState(`?${encodeUrlState(original)}`);
    // Decoded filters must contain the same key/value pairs (order of keys in
    // the object is not significant, equality check is sufficient)
    expect(decoded.filters).toEqual({ z: '1', a: '2', m: '3' });
  });
});

// ---------------------------------------------------------------------------
// pushState / replaceState
// ---------------------------------------------------------------------------

describe('pushState', () => {
  let originalPush: typeof window.history.pushState;
  let pushCalls: { state: unknown; url: string }[];

  beforeEach(() => {
    originalPush = window.history.pushState.bind(window.history);
    pushCalls = [];
    window.history.pushState = (
      state: unknown,
      _title: string,
      url?: string | URL | null,
    ) => {
      pushCalls.push({ state, url: String(url ?? '') });
      originalPush(state, '', url);
    };
  });

  afterEach(() => {
    window.history.pushState = originalPush;
  });

  test('calls history.pushState once with encoded URL', () => {
    const state = makeState({ view: 'providers', session: 's1' });
    pushState(state);
    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0].url).toContain('view=providers');
    expect(pushCalls[0].url).toContain('session=s1');
  });

  test('passes the state object to history.pushState', () => {
    const state = makeState({ view: 'admin' });
    pushState(state);
    expect(pushCalls[0].state).toEqual(state);
  });

  test('encodes filters in the pushed URL', () => {
    const state = makeState({ filters: { key: 'val' } });
    pushState(state);
    const pushed = new URLSearchParams(pushCalls[0].url.split('?')[1]);
    expect(pushed.get('filter[key]')).toBe('val');
  });
});

describe('replaceState', () => {
  let originalReplace: typeof window.history.replaceState;
  let replaceCalls: { state: unknown; url: string }[];

  beforeEach(() => {
    originalReplace = window.history.replaceState.bind(window.history);
    replaceCalls = [];
    window.history.replaceState = (
      state: unknown,
      _title: string,
      url?: string | URL | null,
    ) => {
      replaceCalls.push({ state, url: String(url ?? '') });
      originalReplace(state, '', url);
    };
  });

  afterEach(() => {
    window.history.replaceState = originalReplace;
  });

  test('calls history.replaceState once with encoded URL', () => {
    const state = makeState({ view: 'knowledge' });
    replaceState(state);
    expect(replaceCalls).toHaveLength(1);
    expect(replaceCalls[0].url).toContain('view=knowledge');
  });

  test('passes the state object to history.replaceState', () => {
    const state = makeState({ view: 'providers' });
    replaceState(state);
    expect(replaceCalls[0].state).toEqual(state);
  });
});

// ---------------------------------------------------------------------------
// getCurrentUrlState
// ---------------------------------------------------------------------------

describe('getCurrentUrlState', () => {
  beforeEach(() => {
    // Reset location to a clean state for this describe block
    window.history.replaceState(null, '', '/');
  });

  test('returns decoded state from window.location.search (bare path = chat)', () => {
    const state = getCurrentUrlState();
    expect(state.view).toBe('chat');
    expect(state.session).toBe('');
    expect(state.filters).toEqual({});
  });

  test('reflects URL changes pushed by pushState', () => {
    window.history.pushState(null, '', '/?view=admin&session=x');
    const state = getCurrentUrlState();
    expect(state.view).toBe('admin');
    expect(state.session).toBe('x');
  });
});
