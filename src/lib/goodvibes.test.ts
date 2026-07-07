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
  getCurrentAuth,
  isRuntimeDomain,
  isExtraRoutedMethod,
  sdk,
} from './goodvibes';
import {
  BRIDGE_TYPED_METHOD_IDS,
  type FleetProcessNode,
  type FleetSnapshotResult,
  type FleetListInput,
  type FleetListResult,
  type WorkspaceCheckpoint,
  type CheckpointsListInput,
  type CheckpointsListResult,
  type CheckpointsCreateInput,
  type CheckpointsCreateResult,
  type CheckpointsDiffInput,
  type CheckpointsDiffResult,
  type CheckpointsRestoreInput,
  type CheckpointsRestoreResult,
  type SessionsSearchInput,
  type SessionsSearchResult,
  type SessionsSearchSessionSummary,
  type SessionsDetachInput,
  type SessionsDetachResult,
} from './contract-bridge-types';

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

  test('the justified survivors remain (SDK-coverage targets)', () => {
    for (const method of [
      'approvals.approve', 'approvals.list', 'models.list', 'models.current', 'models.select',
      'tasks.list', 'tasks.cancel', 'tasks.retry', 'config.get', 'config.set', 'local_auth.status',
      'companion.chat.sessions.delete',
    ]) {
      expect(isExtraRoutedMethod(method)).toBe(true);
    }
  });

  test('sessions.delete / companion.chat.sessions.close / control.methods.get are table-routed (delete-means-delete)', () => {
    // None of these three ids are in the installed 0.38 OperatorMethodId union
    // (sessions.delete, companion.chat.sessions.close) or have a browser-SDK REST
    // binding (control.methods.get) — every one needs its own EXTRA_METHOD_ROUTES row.
    expect(isExtraRoutedMethod('sessions.delete')).toBe(true);
    expect(isExtraRoutedMethod('companion.chat.sessions.close')).toBe(true);
    expect(isExtraRoutedMethod('control.methods.get')).toBe(true);
  });

  test('fleet.*/checkpoints.* are NOT extra-routed — they ride the generic invoke path, not EXTRA_METHOD_ROUTES', () => {
    for (const method of ['fleet.snapshot', 'fleet.list', 'checkpoints.list', 'checkpoints.create', 'checkpoints.diff', 'checkpoints.restore']) {
      expect(isExtraRoutedMethod(method)).toBe(false);
    }
  });
});

describe('sdk.operator.fleet / sdk.operator.checkpoints — generic invoke-by-id', () => {
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

  test('sessions.search (typed-client scaffold) POSTs to the generic invoke endpoint with its filter input', async () => {
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

describe('delete-means-delete: sessions.delete / chat.sessions.close / control.methods.get wire calls', () => {
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

  test('operator.sessions.delete DELETEs /api/sessions/{sessionId} with no body', async () => {
    stubFetch({ sessionId: 'sess-1', deleted: true });
    const result = await sdk.operator.sessions.delete('sess-1');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/api/sessions/sess-1');
    expect(calls[0].method).toBe('DELETE');
    expect(result).toEqual({ sessionId: 'sess-1', deleted: true });
  });

  test('operator.sessions.delete surfaces a 409 SESSION_ACTIVE honestly (never a silent success)', async () => {
    stubFetch({ error: 'Session is active — close it, then delete.', code: 'SESSION_ACTIVE' }, 409);
    let caught: unknown;
    try {
      await sdk.operator.sessions.delete('sess-1');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { status?: number }).status).toBe(409);
  });

  test('chat.sessions.close POSTs /api/companion/chat/sessions/{sessionId}/close', async () => {
    stubFetch({ sessionId: 'chat-1', status: 'closed' });
    await sdk.chat.sessions.close('chat-1');
    expect(calls[0].url).toContain('/api/companion/chat/sessions/chat-1/close');
    expect(calls[0].method).toBe('POST');
  });

  test('operator.control.methodInfo GETs /api/control-plane/methods/{methodId}', async () => {
    stubFetch({ method: { id: 'sessions.delete', invokable: true } });
    const result = await sdk.operator.control.methodInfo('sessions.delete');
    expect(calls[0].url).toContain('/api/control-plane/methods/sessions.delete');
    expect(calls[0].method).toBe('GET');
    expect(result.method.id).toBe('sessions.delete');
    expect(result.method.invokable).toBe(true);
  });

  test('operator.control.methodInfo of an unregistered id surfaces the honest "Unknown gateway method" 404, never a fake success', async () => {
    stubFetch({ error: 'Unknown gateway method', status: 404 }, 404);
    let caught: unknown;
    try {
      await sdk.operator.control.methodInfo('totally-not-a-real-method');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { status?: number }).status).toBe(404);
    expect((caught as { body?: unknown }).body).toEqual({ error: 'Unknown gateway method', status: 404 });
  });
});

describe('typed client — wrong-typed input is a COMPILE error, not a runtime cast', () => {
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

describe('sdk facade shape — byte-compatible surface', () => {
  // Guards the ~15 view/hook files that import `sdk` structurally (never by destructuring
  // its own type) against an accidental rename/removal in this refactor. `search` is the
  // one intentional addition this scaffolds for the session-search feature; everything
  // else must be the exact pre-existing surface. `memory` is WEBUI-MEMORY-VIEW's own
  // intentional addition (memory.records.* / memory.review-queue).
  test('sdk top-level keys are unchanged', () => {
    expect(Object.keys(sdk).sort()).toEqual(['artifacts', 'auth', 'chat', 'knowledge', 'operator', 'realtime', 'streams'].sort());
  });

  test('sdk.operator keys gain memory, watchers, calendar, push, and the voice + config reads', () => {
    // 'calendar' added here: calendar.* has real HTTP routes but no
    // SHARED/KNOWLEDGE_BROWSER_ROUTES coverage (see the EXTRA_METHOD_ROUTES header
    // comment in goodvibes.ts), so it gets its own namespace like tasks/approvals.
    // 'push' added for Web Push (ws-only generic-invoke verbs, like fleet).
    expect(Object.keys(sdk.operator).sort()).toEqual(
      ['accounts', 'approvals', 'calendar', 'checkpoints', 'config', 'control', 'credentials', 'fleet', 'invoke', 'memory', 'models', 'providers', 'push', 'sessions', 'tasks', 'voice', 'watchers'].sort(),
    );
  });

  test('sdk.operator.push exposes the Web Push lifecycle verbs', () => {
    expect(Object.keys(sdk.operator.push).sort()).toEqual(
      ['list', 'subscribe', 'unsubscribe', 'vapidKey', 'verify'].sort(),
    );
  });

  test('sdk.operator.memory keys are exactly the six memory.records.*/review-queue verbs', () => {
    expect(Object.keys(sdk.operator.memory).sort()).toEqual(
      ['add', 'delete', 'get', 'reviewQueue', 'search', 'updateReview'].sort(),
    );
  });

  test('sdk.operator.voice exposes the wire voice verbs', () => {
    expect(Object.keys(sdk.operator.voice).sort()).toEqual(
      ['providers', 'status', 'stt', 'tts', 'ttsStream', 'voices'].sort(),
    );
  });

  test('sdk.operator.calendar keys are events and ics', () => {
    expect(Object.keys(sdk.operator.calendar).sort()).toEqual(['events', 'ics'].sort());
    expect(Object.keys(sdk.operator.calendar.events).sort()).toEqual(['create', 'get', 'list'].sort());
    expect(Object.keys(sdk.operator.calendar.ics).sort()).toEqual(['export', 'import'].sort());
  });

  test('sdk.operator.sessions keys gain search, delete (delete-means-delete), and detach (WEBUI-FLEET-DEPTH)', () => {
    expect(Object.keys(sdk.operator.sessions).sort()).toEqual(
      ['close', 'create', 'delete', 'detach', 'followUp', 'get', 'inputs', 'list', 'messages', 'reopen', 'search', 'steer'].sort(),
    );
  });

  test('sdk.operator.watchers exposes exactly stop (WEBUI-FLEET-DEPTH — fleet is a reader, not a watcher-authoring surface)', () => {
    expect(Object.keys(sdk.operator.watchers).sort()).toEqual(['stop']);
  });

  test('sdk.operator.fleet / checkpoints / approvals / tasks keys are unchanged', () => {
    expect(Object.keys(sdk.operator.fleet).sort()).toEqual(['list', 'snapshot'].sort());
    expect(Object.keys(sdk.operator.checkpoints).sort()).toEqual(['create', 'diff', 'list', 'restore'].sort());
    expect(Object.keys(sdk.operator.approvals).sort()).toEqual(['approve', 'cancel', 'claim', 'deny', 'list'].sort());
    expect(Object.keys(sdk.operator.tasks).sort()).toEqual(['cancel', 'create', 'list', 'retry'].sort());
  });

  test('sdk.chat.sessions.delete still points at the companion delete verb (the honest hard-delete behind the same id)', () => {
    expect(isExtraRoutedMethod('companion.chat.sessions.delete')).toBe(true);
    expect(typeof sdk.chat.sessions.delete).toBe('function');
  });
});

describe('bridge-matches-schema — contract-bridge-types.ts pinned against the SDK method catalog', () => {
  // WHAT THIS ENFORCES (and what it does not):
  //
  // Each bridge-typed method has a sample INPUT/OUTPUT object below, annotated AS the
  // corresponding bridge interface (FleetSnapshotResult, SessionsSearchResult, …). That
  // closes the loop from two sides at once, WITHOUT any `as` cast or type-erasure trick:
  //
  //   • tsc side — the samples are plain object literals typed as the bridge interfaces.
  //     The OUTPUT/Result interfaces carry NO index signature, so tsc rejects any missing
  //     required field and any INVENTED field (excess-property error) at compile time.
  //     `bun run typecheck` is therefore half of this test.
  //
  //   • runtime side — assertConforms() walks the method's REAL JSON Schema from
  //     operator-contract.json RECURSIVELY (into nested objects AND array item shapes,
  //     not just the top level) and asserts the interface-typed sample carries every
  //     schema-`required` field at every level it populates. So if a bridge interface
  //     dropped a nested required field, the sample (constrained to the interface's own
  //     members) could not satisfy the schema and this fails.
  //
  // Net: the bridge interface conforms to the schema (runtime walk) and the sample
  // conforms to the interface (tsc) — a drift on either side, including the eventual
  // pin-bump silently reshaping something, fails here or in typecheck.
  //
  // NOT enforced: INPUT interfaces intentionally carry a `[key: string]: unknown` index
  // signature (the generic-fallback shape — see contract-bridge-types.ts header), so tsc
  // cannot flag an invented INPUT field. The runtime walk still checks that every field
  // the sample DOES declare is a real schema property and that required inputs are
  // present; unpopulated optional fields are not exercised.
  // Loose on purpose: operator-contract.json's per-method schema literals don't
  // structurally line up with a strict recursive node type (a plain `as` cast to one
  // fails). `properties`/`items` are read as `unknown` and re-narrowed at each recursion
  // step — the runtime shape is what we assert against, not a compile-time schema type.
  interface JsonSchemaNode {
    readonly type?: string;
    readonly properties?: Record<string, unknown>;
    readonly required?: readonly string[];
    readonly items?: unknown;
    readonly additionalProperties?: unknown;
  }

  interface OperatorContractMethod {
    readonly id: string;
    readonly inputSchema?: JsonSchemaNode;
    readonly outputSchema?: JsonSchemaNode;
  }

  const methods = new Map(
    (operatorContract.operator.methods as OperatorContractMethod[]).map((method) => [method.id, method]),
  );

  /**
   * Assert `sample` satisfies `schema`, descending into nested objects and array items.
   * Only descends where the sample actually populated a value, so an unpopulated
   * optional does not force its inner required fields.
   */
  function assertConforms(schema: JsonSchemaNode | undefined, sample: unknown, path: string): void {
    if (!schema) return;
    const where = path || '<root>';

    if (schema.properties) {
      expect(
        typeof sample === 'object' && sample !== null && !Array.isArray(sample),
        `${where}: expected an object per schema`,
      ).toBe(true);
      const rec = sample as Record<string, unknown>;

      for (const req of schema.required ?? []) {
        expect(req in rec, `${where}: schema-required field "${req}" is missing from the bridge-typed sample`).toBe(true);
      }

      for (const key of Object.keys(rec)) {
        const propSchema = schema.properties[key];
        if (!propSchema) {
          // A field the sample carries that the schema does not declare. Only a genuine
          // problem where the schema is closed (additionalProperties:false); many nodes
          // set additionalProperties:true and legitimately allow extras.
          if (schema.additionalProperties === false) {
            expect(false, `${where}: sample field "${key}" is not a real schema property (schema is closed)`).toBe(true);
          }
          continue;
        }
        assertConforms(propSchema as JsonSchemaNode, rec[key], path ? `${path}.${key}` : key);
      }
      return;
    }

    if (schema.items) {
      expect(Array.isArray(sample), `${where}: expected an array per schema`).toBe(true);
      const itemSchema = schema.items as JsonSchemaNode;
      (sample as unknown[]).forEach((item, i) => assertConforms(itemSchema, item, `${path}[${i}]`));
    }
    // primitives: the presence/typing is already pinned by the parent object's checks.
  }

  // ── Interface-typed samples ────────────────────────────────────────────────
  // Populated to exercise every schema-required path (incl. the nested optionals
  // usage/currentActivity/participants, so their inner shapes are validated too).
  const fleetNode: FleetProcessNode = {
    id: 'proc-1',
    kind: 'agent',
    label: 'Refactor the spine',
    state: 'executing-tool',
    elapsedMs: 4200,
    costState: 'priced',
    capabilities: { interruptible: true, killable: true, pausable: false, resumable: true, steerable: true },
    usage: {
      inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0,
      llmCallCount: 1, turnCount: 1, toolCallCount: 2,
    },
    currentActivity: { kind: 'tool', text: 'running the suite', at: 1 },
  };

  const workspaceCheckpoint: WorkspaceCheckpoint = {
    id: 'wcp_1',
    kind: 'manual',
    label: 'before refactor',
    createdAt: 1,
    parentId: null,
    retentionClass: 'standard',
    commit: 'abc123',
    sizeBytes: 2048,
  };

  const sessionSummary: SessionsSearchSessionSummary = {
    id: 's-1',
    kind: 'companion-chat',
    title: 'Deploy chat',
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
    lastActivityAt: 2,
    messageCount: 4,
    pendingInputCount: 0,
    routeIds: ['r-1'],
    surfaceKinds: ['webui'],
    participants: [{ surfaceKind: 'webui', surfaceId: 'goodvibes-webui', lastSeenAt: 2 }],
    metadata: {},
  };

  const outputSamples: Record<(typeof BRIDGE_TYPED_METHOD_IDS)[number], unknown> = {
    'fleet.snapshot': { capturedAt: 1, nodes: [fleetNode], truncated: false, totalCount: 1 } satisfies FleetSnapshotResult,
    'fleet.list': { items: [fleetNode], hasMore: false, capturedAt: 1 } satisfies FleetListResult,
    'checkpoints.list': { checkpoints: [workspaceCheckpoint] } satisfies CheckpointsListResult,
    'checkpoints.create': { checkpoint: workspaceCheckpoint, noop: false } satisfies CheckpointsCreateResult,
    'checkpoints.diff': {
      diff: { from: 'wcp_1', to: 'wcp_2', files: ['a.ts'], unifiedDiff: '--- a', stat: '1 file' },
    } satisfies CheckpointsDiffResult,
    'checkpoints.restore': {
      result: { checkpointId: 'wcp_1', safetyCheckpointId: null, restoredFiles: ['a.ts'], removedFiles: [] },
    } satisfies CheckpointsRestoreResult,
    'sessions.search': { sessions: [sessionSummary], hasMore: false } satisfies SessionsSearchResult,
    'sessions.detach': {
      session: {
        id: 's-1', kind: 'companion-chat', title: 'Deploy chat', status: 'active',
        createdAt: 1, updatedAt: 2, lastActivityAt: 2, messageCount: 4, pendingInputCount: 0,
        routeIds: ['r-1'], surfaceKinds: ['webui'],
        participants: [{ surfaceKind: 'tui', surfaceId: 't-1', lastSeenAt: 2 }],
        metadata: {},
      },
    } satisfies SessionsDetachResult,
  };

  // Inputs — fleet.snapshot takes none. The rest are typed as their bridge Input
  // interface (index-signatured, so tsc allows extras — the runtime walk pins the fields
  // that ARE present against the schema).
  const inputSamples: Partial<Record<(typeof BRIDGE_TYPED_METHOD_IDS)[number], unknown>> = {
    'fleet.list': { kinds: ['agent'], states: ['running'], limit: 10, cursor: 'c1' } satisfies FleetListInput,
    'checkpoints.list': { kind: 'manual', since: 1, limit: 5 } satisfies CheckpointsListInput,
    'checkpoints.create': {
      kind: 'manual', label: 'x', retentionClass: 'standard', turnId: 't1', agentId: 'a1', paths: ['a.ts'],
    } satisfies CheckpointsCreateInput,
    'checkpoints.diff': { a: 'wcp_1', b: 'wcp_2' } satisfies CheckpointsDiffInput,
    'checkpoints.restore': { id: 'wcp_1', paths: ['a.ts'], safetyCheckpoint: true } satisfies CheckpointsRestoreInput,
    'sessions.search': {
      query: 'deploy', project: 'p', kind: 'companion-chat', surfaceKind: 'webui',
      status: 'active', includeClosed: true, limit: 20, cursor: 'c1',
    } satisfies SessionsSearchInput,
    'sessions.detach': { sessionId: 's-1', surfaceId: 'goodvibes-webui' } satisfies SessionsDetachInput,
  };

  test('every BRIDGE_TYPED_METHOD_IDS entry exists in the installed SDK method catalog', () => {
    for (const methodId of BRIDGE_TYPED_METHOD_IDS) {
      expect(methods.has(methodId), `${methodId} missing from operator-contract.json`).toBe(true);
    }
  });

  for (const methodId of BRIDGE_TYPED_METHOD_IDS) {
    test(`${methodId}: the bridge-typed OUTPUT sample satisfies every schema-required field, nested included`, () => {
      const method = methods.get(methodId);
      assertConforms(method?.outputSchema, outputSamples[methodId], '');
    });

    test(`${methodId}: the bridge-typed INPUT sample's fields are all real schema properties`, () => {
      const method = methods.get(methodId);
      const input = inputSamples[methodId];
      if (input === undefined) {
        // fleet.snapshot: no input. Assert the schema itself declares no required inputs
        // (otherwise a caller with zero args would silently violate the contract).
        expect((method?.inputSchema?.required ?? []).length, `${methodId} unexpectedly requires input`).toBe(0);
        return;
      }
      assertConforms(method?.inputSchema, input, '');
    });
  }
});

// Token honesty: the daemon's control-plane/auth is a STATUS endpoint — it
// answers 200 even for an invalid/expired token, carrying the verdict in the
// `authenticated` boolean (verified against both real daemons and an isolated
// bootDaemon). getCurrentAuth must REJECT on authenticated!==true so the signed-in
// gate + health axis hand off to sign-in instead of leaving the operator in a shell
// where every data endpoint 401s.
describe('getCurrentAuth honors the authenticated field (token-honesty handoff)', () => {
  const original = sdk.auth.current;
  // Deliberate PARTIAL snapshots — the real AuthSnapshot has ~10 fields, but
  // getCurrentAuth only inspects `authenticated`. Cast to the property's type so the
  // stubs stand in without hand-authoring every field.
  const stub = (value: unknown): typeof sdk.auth.current =>
    (() => Promise.resolve(value)) as typeof sdk.auth.current;
  afterEach(() => { sdk.auth.current = original; });

  test('rejects with a 401/authentication error when authenticated is false', async () => {
    sdk.auth.current = stub({ authenticated: false, authMode: 'invalid' });
    let thrown: unknown;
    try { await getCurrentAuth(); } catch (e) { thrown = e; }
    expect(thrown).toBeDefined();
    const err = thrown as { status?: number; category?: string };
    expect(err.status).toBe(401);
    expect(err.category).toBe('authentication');
  });

  test('resolves when authenticated is true', async () => {
    const snapshot = { authenticated: true, authMode: 'shared-token' };
    sdk.auth.current = stub(snapshot);
    expect(await getCurrentAuth()).toEqual(snapshot);
  });

  test('does not misclassify a snapshot with no authenticated field (unknown shape passes through)', async () => {
    const snapshot = { some: 'other-shape' };
    sdk.auth.current = stub(snapshot);
    expect(await getCurrentAuth()).toEqual(snapshot);
  });
});
