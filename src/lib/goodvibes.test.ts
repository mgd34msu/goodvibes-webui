import { afterEach, describe, expect, test } from 'bun:test';
import {
  GOODVIBES_BASE_URL,
  WEBUI_SURFACE_ID,
  WEBUI_SURFACE_KIND,
  WEBUI_TOKEN_STORE_KEY,
  isRuntimeDomain,
  isExtraRoutedMethod,
  sdk,
} from './goodvibes';

describe('goodvibes constants', () => {
  test('WEBUI_SURFACE_KIND is webui', () => {
    expect(WEBUI_SURFACE_KIND).toBe('webui');
  });

  test('WEBUI_SURFACE_ID is goodvibes-webui', () => {
    expect(WEBUI_SURFACE_ID).toBe('goodvibes-webui');
  });

  test('WEBUI_TOKEN_STORE_KEY is a non-empty string', () => {
    expect(typeof WEBUI_TOKEN_STORE_KEY).toBe('string');
    expect(WEBUI_TOKEN_STORE_KEY.length).toBeGreaterThan(0);
  });

  test('GOODVIBES_BASE_URL is a non-empty string', () => {
    expect(typeof GOODVIBES_BASE_URL).toBe('string');
    expect(GOODVIBES_BASE_URL.length).toBeGreaterThan(0);
  });
});

describe('isRuntimeDomain', () => {
  test('returns true for known domains', () => {
    const known = [
      'session', 'turn', 'providers', 'tools', 'tasks', 'agents', 'workflows',
      'orchestration', 'communication', 'planner', 'permissions', 'plugins',
      'mcp', 'transport', 'compaction', 'ui', 'ops', 'forensics', 'security',
      'automation', 'routes', 'control-plane', 'deliveries', 'watchers',
      'surfaces', 'knowledge', 'workspace',
    ];
    for (const domain of known) {
      expect(isRuntimeDomain(domain)).toBe(true);
    }
  });

  test('returns false for unknown domain string', () => {
    expect(isRuntimeDomain('unknown-domain')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(isRuntimeDomain('')).toBe(false);
  });

  test('is case-sensitive: uppercase variant is not a domain', () => {
    expect(isRuntimeDomain('Session')).toBe(false);
    expect(isRuntimeDomain('TASKS')).toBe(false);
  });

  test('returns false for partial prefix match', () => {
    expect(isRuntimeDomain('sess')).toBe(false);
    expect(isRuntimeDomain('control')).toBe(false); // 'control-plane' is valid, 'control' is not
  });
});

describe('EXTRA_METHOD_ROUTES retirement (W2B)', () => {
  test('sessions.get/steer/followUp resolve NATIVELY — no EXTRA row', () => {
    // These gained native coverage in the 0.38 browser SDK (SHARED_BROWSER_ROUTES);
    // they must fall through to scopedSdk.operator.invoke, not a hand-written route.
    expect(isExtraRoutedMethod('sessions.get')).toBe(false);
    expect(isExtraRoutedMethod('sessions.steer')).toBe(false);
    expect(isExtraRoutedMethod('sessions.followUp')).toBe(false);
  });

  test('sessions.messages/inputs also resolve natively', () => {
    expect(isExtraRoutedMethod('sessions.messages.list')).toBe(false);
    expect(isExtraRoutedMethod('sessions.messages.create')).toBe(false);
    expect(isExtraRoutedMethod('sessions.inputs.list')).toBe(false);
    expect(isExtraRoutedMethod('sessions.inputs.cancel')).toBe(false);
  });

  test('sessions.close/reopen STILL require their table rows (not in 0.38 shared routes)', () => {
    expect(isExtraRoutedMethod('sessions.close')).toBe(true);
    expect(isExtraRoutedMethod('sessions.reopen')).toBe(true);
  });

  test('the justified survivors remain (Wave-3 SDK-coverage targets)', () => {
    for (const method of [
      'approvals.approve', 'approvals.list', 'models.list', 'models.current', 'models.select',
      'tasks.list', 'tasks.cancel', 'tasks.retry', 'config.set', 'local_auth.status',
      'companion.chat.sessions.delete',
    ]) {
      expect(isExtraRoutedMethod(method)).toBe(true);
    }
  });

  test('fleet.*/checkpoints.* are NOT extra-routed — they ride the generic invoke path, not EXTRA_METHOD_ROUTES', () => {
    for (const method of ['fleet.snapshot', 'fleet.list', 'checkpoints.list', 'checkpoints.create', 'checkpoints.diff', 'checkpoints.restore']) {
      expect(isExtraRoutedMethod(method)).toBe(false);
    }
  });
});

describe('sdk.operator.fleet / sdk.operator.checkpoints — generic invoke-by-id (W3-S2)', () => {
  const originalFetch = globalThis.fetch;
  let calls: { url: string; method: string; body: unknown }[];

  function stubFetch(responseBody: unknown, status = 200): void {
    calls = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });
      return new Response(JSON.stringify(responseBody), { status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('fleet.snapshot POSTs to the generic invoke endpoint with an empty body envelope', async () => {
    stubFetch({ capturedAt: 1, nodes: [], truncated: false, totalCount: 0 });
    await sdk.operator.fleet.snapshot();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/api/control-plane/methods/fleet.snapshot/invoke');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toEqual({ body: {} });
  });

  test('fleet.list forwards its filter input inside the body envelope', async () => {
    stubFetch({ items: [], hasMore: false, capturedAt: 1 });
    await sdk.operator.fleet.list({ kinds: ['agent'], limit: 10 });
    expect(calls[0].url).toContain('/api/control-plane/methods/fleet.list/invoke');
    expect(calls[0].body).toEqual({ body: { kinds: ['agent'], limit: 10 } });
  });

  test('checkpoints.create forwards kind/label inside the body envelope', async () => {
    stubFetch({ checkpoint: null, noop: true });
    await sdk.operator.checkpoints.create({ kind: 'manual', label: 'test' });
    expect(calls[0].url).toContain('/api/control-plane/methods/checkpoints.create/invoke');
    expect(calls[0].body).toEqual({ body: { kind: 'manual', label: 'test' } });
  });

  test('checkpoints.restore of an unknown id surfaces the daemon\'s honest 404/NOT_FOUND as a thrown error', async () => {
    stubFetch({ error: 'Checkpoint not found: wcp_ghost', code: 'NOT_FOUND' }, 404);
    let caught: unknown;
    try {
      await sdk.operator.checkpoints.restore({ id: 'wcp_ghost' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { status?: number }).status).toBe(404);
  });
});
