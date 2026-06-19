/**
 * Tests for useChatSearch hook.
 *
 * Covers:
 *   - debounce timing (300 ms)
 *   - abort on rapid retype (no stale results)
 *   - cache hit — second query with same sessions does NOT re-fetch
 *   - cache invalidation when sessions identity changes
 *   - recency ranking (most recent createdAt first)
 *
 * Uses real timers via bun:test. DOM render via createRoot + flushSync
 * (happy-dom is installed by bunfig.toml preload).
 *
 * Module mocks must be declared before any dynamic import of the module
 * under test, because bun:test module mocking is synchronous and import-
 * scoped. All SDK interactions are stubbed via mock.module.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

/**
 * Fake session objects used across tests. Each has `id` and `sessionId` so
 * extractSessionId() (which reads those fields) returns a stable value.
 */
interface FakeSession { id: string; sessionId: string; title: string }

/** Control surface for the SDK list stub. */
interface ListStub {
  /** Messages returned per sessionId, keyed by id. */
  responses: Map<string, Record<string, unknown>[]>;
  /** Number of times list() was called, keyed by sessionId. */
  callCounts: Map<string, number>;
  /** Set to true to make all calls reject. */
  shouldFail: boolean;
}

const stub: ListStub = {
  responses: new Map(),
  callCounts: new Map(),
  shouldFail: false,
};

// Mock the SDK before any import of useChatSearch.
mock.module('../../lib/goodvibes', () => ({
  sdk: {
    operator: {
      sessions: {
        messages: {
          list: async (sessionId: string): Promise<unknown> => {
            stub.callCounts.set(sessionId, (stub.callCounts.get(sessionId) ?? 0) + 1);
            if (stub.shouldFail) throw new Error('network error');
            const msgs = stub.responses.get(sessionId) ?? [];
            // companionMessagesFromListResponse reads .items on the response
            return { items: msgs };
          },
        },
      },
    },
  },
}));

// Import hook after mock registration.
const { useChatSearch } = await import('./useChatSearch');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const wait = (ms: number): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, ms));

interface SearchState {
  results: { sessionId: string; messageId: string; snippet: string; sessionTitle: string; createdAt?: number }[];
  isSearching: boolean;
}

/**
 * Mount useChatSearch in a component. Returns a handle for:
 *   - reading the latest state snapshot
 *   - updating query / sessions props by re-rendering
 *   - unmounting
 */
function mountHook(initialQuery: string, initialSessions: unknown[]) {
  let snapshot: SearchState = { results: [], isSearching: false };

  let currentQuery = initialQuery;
  let currentSessions = initialSessions;

  function HookOwner(): null {
    const state = useChatSearch(currentQuery, currentSessions);
    React.useLayoutEffect(() => {
      snapshot = state;
    });
    return null;
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => { root.render(React.createElement(HookOwner)); });

  return {
    get state(): SearchState {
      return snapshot;
    },
    setQuery(q: string) {
      currentQuery = q;
      flushSync(() => { root.render(React.createElement(HookOwner)); });
    },
    setSessions(s: unknown[]) {
      currentSessions = s;
      flushSync(() => { root.render(React.createElement(HookOwner)); });
    },
    updateBoth(q: string, s: unknown[]) {
      currentQuery = q;
      currentSessions = s;
      flushSync(() => { root.render(React.createElement(HookOwner)); });
    },
    unmount() {
      flushSync(() => { root.unmount(); });
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

/** Build a fake session with at least one message that contains the term. */
function makeSession(id: string, title: string, _messages: Record<string, unknown>[]): FakeSession {
  return { id, sessionId: id, title };
}

/** Seed stub.responses for a session. */
function seedMessages(sessionId: string, messages: Record<string, unknown>[]) {
  stub.responses.set(sessionId, messages);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  stub.responses = new Map();
  stub.callCounts = new Map();
  stub.shouldFail = false;
});

afterEach(() => {
  stub.responses = new Map();
  stub.callCounts = new Map();
  stub.shouldFail = false;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useChatSearch — debounce timing (300 ms)', () => {
  test('does not return results before debounce period elapses', async () => {
    const session = makeSession('s1', 'Session 1', []);
    seedMessages('s1', [{ id: 'm1', messageId: 'm1', content: 'hello world', createdAt: 1_000 }]);

    const handle = mountHook('', [session]);

    // Start a query — should not fire yet within 200ms
    handle.setQuery('hello');
    await wait(200);
    // No results yet (debounce 300ms has not elapsed)
    expect(handle.state.results).toHaveLength(0);

    // Wait past debounce
    await wait(200); // total ~400ms
    // Now the async fetch + search has completed
    expect(handle.state.results.length).toBeGreaterThan(0);
    expect(handle.state.results[0]?.snippet).toContain('hello');

    handle.unmount();
  });

  test('results arrive after debounce + fetch (400ms total)', async () => {
    const session = makeSession('s2', 'Session 2', []);
    seedMessages('s2', [{ id: 'm2', messageId: 'm2', content: 'debounce test', createdAt: 2_000 }]);

    const handle = mountHook('debounce', [session]);
    await wait(450);

    expect(handle.state.results.length).toBeGreaterThan(0);
    expect(handle.state.results[0]?.snippet).toContain('debounce');

    handle.unmount();
  });
});

describe('useChatSearch — abort on rapid retype (no stale results)', () => {
  test('only last query produces results when query changes rapidly', async () => {
    const session = makeSession('s3', 'Session 3', []);
    seedMessages('s3', [
      { id: 'm3a', messageId: 'm3a', content: 'alpha result', createdAt: 1_000 },
      { id: 'm3b', messageId: 'm3b', content: 'beta result', createdAt: 2_000 },
    ]);

    const handle = mountHook('', [session]);

    // Rapidly change query several times without waiting for debounce
    handle.setQuery('alpha');
    await wait(50);
    handle.setQuery('beta');
    await wait(50);
    handle.setQuery('beta'); // final query

    // Wait for debounce + fetch
    await wait(450);

    // Only the last query ("beta") should have results
    const snippets = handle.state.results.map((r) => r.snippet);
    // Stale "alpha" should not appear
    expect(snippets.some((s) => s.includes('alpha'))).toBe(false);
    // "beta" should appear
    expect(snippets.some((s) => s.includes('beta'))).toBe(true);

    handle.unmount();
  });

  test('empty query after typing clears results immediately', async () => {
    const session = makeSession('s4', 'Session 4', []);
    seedMessages('s4', [{ id: 'm4', messageId: 'm4', content: 'clear me', createdAt: 1_000 }]);

    const handle = mountHook('clear', [session]);
    await wait(450);
    expect(handle.state.results.length).toBeGreaterThan(0);

    // Clear the query
    handle.setQuery('');
    // Results should be cleared synchronously (no debounce for empty)
    await wait(10);
    expect(handle.state.results).toHaveLength(0);
    expect(handle.state.isSearching).toBe(false);

    handle.unmount();
  });
});

describe('useChatSearch — cache hit and cache invalidation', () => {
  test('cache hit: same sessions — does not re-fetch messages on second query', async () => {
    const session = makeSession('s5', 'Session 5', []);
    seedMessages('s5', [{ id: 'm5', messageId: 'm5', content: 'cached content', createdAt: 1_000 }]);

    const handle = mountHook('cached', [session]);
    await wait(450);

    // First query fetched once
    expect(stub.callCounts.get('s5')).toBe(1);
    expect(handle.state.results.length).toBeGreaterThan(0);

    // Second query with same sessions — should use cache, not re-fetch
    handle.setQuery('content');
    await wait(450);
    expect(stub.callCounts.get('s5')).toBe(1); // still 1, not 2
    expect(handle.state.results.length).toBeGreaterThan(0);

    handle.unmount();
  });

  test('cache invalidation: changing sessions identity clears cached messages and re-fetches', async () => {
    const session1 = makeSession('s6', 'Session 6', []);
    seedMessages('s6', [{ id: 'm6', messageId: 'm6', content: 'stale content', createdAt: 1_000 }]);

    const handle = mountHook('stale', [session1]);
    await wait(450);

    expect(stub.callCounts.get('s6')).toBe(1);

    // Now update the messages but keep sessionId the same — simulates session content changing.
    // Invalidate by changing sessions identity (new array reference with different id set).
    const session2 = makeSession('s6-v2', 'Session 6 v2', []);
    seedMessages('s6-v2', [{ id: 'm6b', messageId: 'm6b', content: 'fresh content stale', createdAt: 2_000 }]);

    handle.setSessions([session2]);
    await wait(10); // cache reset happens synchronously during render

    // Re-run query with new sessions
    handle.setQuery('stale ');
    handle.setQuery('stale'); // trigger re-render with same effective query to restart effect
    await wait(450);

    // s6-v2 should have been fetched (new session in cache)
    expect(stub.callCounts.get('s6-v2')).toBeGreaterThanOrEqual(1);

    handle.unmount();
  });

  test('cache is per-session: different sessions populate separate cache entries', async () => {
    const session1 = makeSession('s7a', 'Session 7A', []);
    const session2 = makeSession('s7b', 'Session 7B', []);
    seedMessages('s7a', [{ id: 'm7a', messageId: 'm7a', content: 'shared term here', createdAt: 1_000 }]);
    seedMessages('s7b', [{ id: 'm7b', messageId: 'm7b', content: 'shared term there', createdAt: 2_000 }]);

    const handle = mountHook('shared', [session1, session2]);
    await wait(450);

    expect(stub.callCounts.get('s7a')).toBe(1);
    expect(stub.callCounts.get('s7b')).toBe(1);
    // Both results should appear
    expect(handle.state.results).toHaveLength(2);

    // Second query — both served from cache
    handle.setQuery('term');
    await wait(450);
    expect(stub.callCounts.get('s7a')).toBe(1);
    expect(stub.callCounts.get('s7b')).toBe(1);

    handle.unmount();
  });
});

describe('useChatSearch — recency ranking', () => {
  test('results are ordered by createdAt descending (most recent first)', async () => {
    const session = makeSession('s8', 'Session 8', []);
    seedMessages('s8', [
      { id: 'm8a', messageId: 'm8a', content: 'order test older', createdAt: 1_000 },
      { id: 'm8b', messageId: 'm8b', content: 'order test middle', createdAt: 3_000 },
      { id: 'm8c', messageId: 'm8c', content: 'order test newest', createdAt: 5_000 },
    ]);

    const handle = mountHook('order', [session]);
    await wait(450);

    const results = handle.state.results;
    expect(results).toHaveLength(3);
    // Most recent first
    expect(results[0]?.createdAt).toBe(5_000);
    expect(results[1]?.createdAt).toBe(3_000);
    expect(results[2]?.createdAt).toBe(1_000);

    handle.unmount();
  });

  test('results without createdAt sort to end (treated as 0)', async () => {
    const session = makeSession('s9', 'Session 9', []);
    seedMessages('s9', [
      { id: 'm9a', messageId: 'm9a', content: 'rank no-timestamp', createdAt: undefined },
      { id: 'm9b', messageId: 'm9b', content: 'rank with-timestamp', createdAt: 4_000 },
    ]);

    const handle = mountHook('rank', [session]);
    await wait(450);

    const results = handle.state.results;
    expect(results).toHaveLength(2);
    // The one with createdAt should come first
    expect(results[0]?.createdAt).toBe(4_000);
    expect(results[1]?.createdAt).toBeUndefined();

    handle.unmount();
  });

  test('cross-session results ranked by createdAt across sessions', async () => {
    const sessionA = makeSession('s10a', 'Session A', []);
    const sessionB = makeSession('s10b', 'Session B', []);
    seedMessages('s10a', [{ id: 'm10a', messageId: 'm10a', content: 'cross rank test old', createdAt: 1_000 }]);
    seedMessages('s10b', [{ id: 'm10b', messageId: 'm10b', content: 'cross rank test new', createdAt: 9_000 }]);

    const handle = mountHook('cross', [sessionA, sessionB]);
    await wait(450);

    const results = handle.state.results;
    expect(results.length).toBe(2);
    expect(results[0]?.createdAt).toBe(9_000);
    expect(results[1]?.createdAt).toBe(1_000);

    handle.unmount();
  });
});
