import { afterEach, describe, expect, test } from 'bun:test';
// operator-contract.json is the SAME runtime schema source contract-bridge-types.ts's
// hand-authored shapes are cross-checked against (see that module's header) — imported
// from the SDK's own public export path, not by reaching into a transitive dependency.
import operatorContract from '@pellux/goodvibes-sdk/contracts/operator-contract.json';
import {
  GOODVIBES_BASE_URL,
  WEBUI_SURFACE_ID,
  WEBUI_SURFACE_KIND,
  WEBUI_TOKEN_STORE_KEY,
  isRuntimeDomain,
  isExtraRoutedMethod,
  sdk,
} from './goodvibes';
import { BRIDGE_TYPED_METHOD_IDS } from './contract-bridge-types';

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

  test('sessions.search (W5-TC scaffold) POSTs to the generic invoke endpoint with its filter input', async () => {
    stubFetch({ sessions: [], hasMore: false });
    await sdk.operator.sessions.search({ query: 'deploy', includeClosed: true });
    expect(calls[0].url).toContain('/api/control-plane/methods/sessions.search/invoke');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toEqual({ body: { query: 'deploy', includeClosed: true } });
  });

  test('sessions.search of a route-absent/NOT_INVOKABLE method surfaces the honest error, never silent undefined', async () => {
    stubFetch({ error: 'Method sessions.search is not invokable from this surface', code: 'NOT_INVOKABLE' }, 400);
    let caught: unknown;
    let result: unknown;
    try {
      result = await sdk.operator.sessions.search();
    } catch (error) {
      caught = error;
    }
    expect(result).toBeUndefined();
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { category?: string }).category).toBe('service');
    expect((caught as { body?: unknown }).body).toEqual({ error: 'Method sessions.search is not invokable from this surface', code: 'NOT_INVOKABLE' });
  });
});

describe('typed client — wrong-typed input is a COMPILE error, not a runtime cast (W5-TC)', () => {
  // These functions are defined but deliberately never invoked: the assertion under
  // test is that `tsc --noEmit` rejects the line (the `@ts-expect-error` directive
  // itself fails the build if the line does NOT actually error — "Unused '@ts-expect-
  // error' directive" — so this is a real, gate-enforced compile check, not a comment).

  test('sessions.steer: a numeric body is rejected now that `as never` is gone', () => {
    function typeOnly(): void {
      // @ts-expect-error -- OperatorMethodInput<'sessions.steer'> requires body: string; this used to silently pass through the removed `as never` cast at goodvibes.ts:605-606.
      void sdk.operator.sessions.steer('session-1', { body: 123 });
    }
    void typeOnly;
    expect(true).toBe(true);
  });

  test('checkpoints.create: an unknown `kind` literal is rejected by the bridge type', () => {
    function typeOnly(): void {
      // @ts-expect-error -- CheckpointsCreateInput.kind is 'turn' | 'agent-run' | 'manual', not an arbitrary string.
      void sdk.operator.checkpoints.create({ kind: 'not-a-real-kind' });
    }
    void typeOnly;
    expect(true).toBe(true);
  });

  test('tasks.create: a numeric title is rejected via OperatorMethodInput<\'tasks.create\'>', () => {
    function typeOnly(): void {
      // @ts-expect-error -- title is typed string on the generated contract; tasks.create's input now flows straight from OperatorMethodInput<'tasks.create'>, no local hand type in between.
      void sdk.operator.tasks.create({ task: 'x', title: 123 });
    }
    void typeOnly;
    expect(true).toBe(true);
  });
});

describe('sdk facade shape — byte-compatible surface (W5-TC)', () => {
  // Guards the ~15 view/hook files that import `sdk` structurally (never by destructuring
  // its own type) against an accidental rename/removal in this refactor. `search` is the
  // one intentional addition this brief scaffolds for W5-W6; everything else must be the
  // exact pre-existing surface.
  test('sdk top-level keys are unchanged', () => {
    expect(Object.keys(sdk).sort()).toEqual(['artifacts', 'auth', 'chat', 'knowledge', 'operator', 'realtime', 'streams'].sort());
  });

  test('sdk.operator keys are unchanged', () => {
    expect(Object.keys(sdk.operator).sort()).toEqual(
      ['accounts', 'approvals', 'checkpoints', 'control', 'fleet', 'invoke', 'models', 'providers', 'sessions', 'tasks'].sort(),
    );
  });

  test('sdk.operator.sessions keys gain exactly one method: search', () => {
    expect(Object.keys(sdk.operator.sessions).sort()).toEqual(
      ['close', 'create', 'followUp', 'get', 'inputs', 'list', 'messages', 'reopen', 'search', 'steer'].sort(),
    );
  });

  test('sdk.operator.fleet / checkpoints / approvals / tasks keys are unchanged', () => {
    expect(Object.keys(sdk.operator.fleet).sort()).toEqual(['list', 'snapshot'].sort());
    expect(Object.keys(sdk.operator.checkpoints).sort()).toEqual(['create', 'diff', 'list', 'restore'].sort());
    expect(Object.keys(sdk.operator.approvals).sort()).toEqual(['approve', 'cancel', 'claim', 'deny', 'list'].sort());
    expect(Object.keys(sdk.operator.tasks).sort()).toEqual(['cancel', 'create', 'list', 'retry'].sort());
  });

  test('sdk.chat.sessions.delete still points at the companion delete verb (W5-S1 lands the honest hard-delete behind the same id)', () => {
    expect(isExtraRoutedMethod('companion.chat.sessions.delete')).toBe(true);
    expect(typeof sdk.chat.sessions.delete).toBe('function');
  });
});

describe('bridge-matches-schema — contract-bridge-types.ts pinned against the SDK method catalog', () => {
  // operator-contract.json carries every method's REAL JSON-Schema input/output shape,
  // even for the four families whose *TypeScript* generated maps are still generic (see
  // contract-bridge-types.ts's header). This test walks that same artifact and checks
  // every bridge type's top-level field names against it, so a silent shape drift (or
  // the eventual pin-bump itself changing something) fails here immediately instead of
  // shipping unnoticed.
  interface JsonSchemaObject {
    readonly properties?: Record<string, unknown>;
    readonly required?: readonly string[];
  }

  interface OperatorContractMethod {
    readonly id: string;
    readonly inputSchema?: JsonSchemaObject;
    readonly outputSchema?: JsonSchemaObject;
  }

  const methods = new Map(
    (operatorContract.operator.methods as OperatorContractMethod[]).map((method) => [method.id, method]),
  );

  function schemaFieldNames(schema: JsonSchemaObject | undefined): string[] {
    return Object.keys(schema?.properties ?? {});
  }

  function schemaRequiredNames(schema: JsonSchemaObject | undefined): string[] {
    return [...(schema?.required ?? [])];
  }

  test('every BRIDGE_TYPED_METHOD_IDS entry exists in the installed SDK method catalog', () => {
    for (const methodId of BRIDGE_TYPED_METHOD_IDS) {
      expect(methods.has(methodId), `${methodId} missing from operator-contract.json`).toBe(true);
    }
  });

  const expectedTopLevelFields: Record<(typeof BRIDGE_TYPED_METHOD_IDS)[number], { input: string[]; outputRequired: string[] }> = {
    'fleet.snapshot': { input: [], outputRequired: ['capturedAt', 'nodes', 'truncated', 'totalCount'] },
    'fleet.list': { input: ['kinds', 'states', 'limit', 'cursor'], outputRequired: ['items', 'hasMore', 'capturedAt'] },
    'checkpoints.list': { input: ['kind', 'since', 'limit'], outputRequired: ['checkpoints'] },
    'checkpoints.create': { input: ['kind', 'label', 'retentionClass', 'turnId', 'agentId', 'paths'], outputRequired: ['checkpoint', 'noop'] },
    'checkpoints.diff': { input: ['a', 'b'], outputRequired: ['diff'] },
    'checkpoints.restore': { input: ['id', 'paths', 'safetyCheckpoint'], outputRequired: ['result'] },
    'sessions.search': {
      input: ['query', 'project', 'kind', 'surfaceKind', 'status', 'includeClosed', 'limit', 'cursor'],
      outputRequired: ['sessions', 'hasMore'],
    },
  };

  for (const methodId of BRIDGE_TYPED_METHOD_IDS) {
    test(`${methodId}: bridge input fields are all real schema properties (no invented field)`, () => {
      const method = methods.get(methodId);
      const realFields = new Set(schemaFieldNames(method?.inputSchema));
      for (const field of expectedTopLevelFields[methodId].input) {
        expect(realFields.has(field), `${methodId} input field "${field}" is not in operator-contract.json`).toBe(true);
      }
    });

    test(`${methodId}: bridge output covers every REQUIRED top-level schema field`, () => {
      const method = methods.get(methodId);
      const requiredFields = schemaRequiredNames(method?.outputSchema);
      const bridgeFields = new Set(expectedTopLevelFields[methodId].outputRequired);
      for (const field of requiredFields) {
        expect(bridgeFields.has(field), `${methodId} output requires "${field}" but the bridge type does not carry it`).toBe(true);
      }
    });
  }
});
