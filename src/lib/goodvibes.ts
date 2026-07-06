import {
  createBrowserKnowledgeSdk,
  forSession,
} from '@pellux/goodvibes-sdk/browser/knowledge';
import type { BrowserKnowledgeMethodId } from '@pellux/goodvibes-sdk/browser/knowledge';
import { createBrowserTokenStore } from '@pellux/goodvibes-sdk/auth';
import type {
  OperatorMethodId,
  OperatorMethodInput,
  OperatorMethodOutput,
  OperatorTypedMethodId,
  RuntimeEventDomain,
} from '@pellux/goodvibes-sdk/contracts';
import type {
  CheckpointsCreateInput,
  CheckpointsCreateResult,
  CheckpointsDiffInput,
  CheckpointsDiffResult,
  CheckpointsListInput,
  CheckpointsListResult,
  CheckpointsRestoreInput,
  CheckpointsRestoreResult,
  FleetListInput,
  FleetListResult,
  FleetProcessNode,
  FleetSnapshotResult,
  SessionParticipant,
  SessionsDetachInput,
  SessionsDetachResult,
  SessionsSearchInput,
  SessionsSearchResult,
  WorkspaceCheckpoint,
} from './contract-bridge-types';

// Re-exported so existing consumers (lib/fleet.ts, lib/checkpoints.ts, FleetView.tsx,
// WorkstreamView.tsx, CheckpointsView.tsx, ...) keep importing these names from
// './goodvibes' unchanged — the byte-compatible facade covers types, not just the `sdk`
// object. Definitions live in contract-bridge-types.ts (the pin-bump swap seam).
export type {
  CheckpointsCreateInput,
  CheckpointsCreateResult,
  CheckpointsDiffInput,
  CheckpointsDiffResult,
  CheckpointsListInput,
  CheckpointsListResult,
  CheckpointsRestoreInput,
  CheckpointsRestoreResult,
  FleetListInput,
  FleetListResult,
  FleetProcessNode,
  FleetSnapshotResult,
  SessionParticipant,
  SessionsDetachInput,
  SessionsDetachResult,
  SessionsSearchInput,
  SessionsSearchResult,
  WorkspaceCheckpoint,
};

export const WEBUI_SURFACE_KIND = 'webui';
export const WEBUI_SURFACE_ID = 'goodvibes-webui';
export const WEBUI_TOKEN_STORE_KEY = 'goodvibes.webui.token';
export const GOODVIBES_BASE_URL = import.meta.env.VITE_GOODVIBES_BASE_URL
  ?? (typeof window === 'undefined' ? 'http://127.0.0.1:3423' : window.location.origin);

export const tokenStore = createBrowserTokenStore({ key: WEBUI_TOKEN_STORE_KEY });

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type JsonRecord = Record<string, unknown>;

interface RouteDefinition {
  method: HttpMethod;
  path: string;
}

interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: JsonRecord;
  authenticated?: boolean;
}

/**
 * EXTRA_METHOD_ROUTES — operator methods NOT covered by the pinned 0.38 browser SDK
 * route maps (SHARED_BROWSER_ROUTES + KNOWLEDGE_BROWSER_ROUTES). Each row is a method
 * invokeOperator must resolve with a hand-written HTTP route because the SDK cannot.
 *
 * W2B retirement audit (2026-07, SDK 0.38.0): the session methods that gained native
 * coverage in 0.38 — sessions.get / sessions.steer / sessions.followUp /
 * sessions.messages.list / sessions.messages.create / sessions.inputs.list /
 * sessions.inputs.cancel — are DELIBERATELY ABSENT from this table. They resolve
 * natively via scopedSdk.operator.invoke (the fall-through at invokeOperator's
 * no-route branch). DO NOT re-add rows for them.
 *
 * sessions.close / sessions.reopen genuinely REMAIN here: they are not in
 * SHARED_BROWSER_ROUTES in 0.38, so removing their rows breaks the calls. The rest of
 * the survivors (approvals.* / models.* / tasks.* / config.set / local_auth.status /
 * companion.chat.sessions.delete) are contract-coverage targets; each pays
 * its way today because no browser route map covers it.
 *
 * sessions.delete / companion.chat.sessions.close (delete-means-delete): these
 * two rows are forward-looking — verified against the SDK repo's OWN source at the time
 * of writing (method-catalog-control-core.ts / method-catalog-control-companion.ts /
 * runtime-session-lifecycle-routes.ts / companion-chat-routes.ts), where the real
 * hard-delete work is in flight but NOT YET COMMITTED there and not yet in the
 * installed 0.38 contracts package — so neither id is in the installed `OperatorMethodId`
 * union today (unlike sessions.close/reopen above, which ARE). Calls through these rows
 * therefore use invokeOperator's untyped overload (see the sdk.operator.sessions.delete
 * and sdk.chat.sessions.close call sites below), exactly like the models.* rows. This is
 * NOT a bridge-type situation (no I/O shape gap to swap later) — it is a
 * capability-availability gap: an older daemon simply does not have these routes yet,
 * which is why every call site is paired with an honest capability check
 * (control.methods.get, also added below) or a proof-of-gone reconcile rather than
 * trusting a 200 at face value. control.methods.get('sessions.delete'/
 * 'companion.chat.sessions.close') on such a daemon 404s with `{error: 'Unknown gateway
 * method'}` (verified live against a bootDaemon instance) — the signal
 * isMethodUnavailableError (lib/errors.ts) recognizes.
 */
const EXTRA_METHOD_ROUTES: Record<string, RouteDefinition | undefined> = {
  'approvals.approve': { method: 'POST', path: '/api/approvals/{approvalId}/approve' },
  'approvals.cancel': { method: 'POST', path: '/api/approvals/{approvalId}/cancel' },
  'approvals.claim': { method: 'POST', path: '/api/approvals/{approvalId}/claim' },
  'approvals.deny': { method: 'POST', path: '/api/approvals/{approvalId}/deny' },
  'approvals.list': { method: 'GET', path: '/api/approvals' },
  // Calendar (SDK 1.1.0, method-catalog-calendar.ts): five CalDAV-backed contract ids
  // with real HTTP paths, but NOT in SHARED_BROWSER_ROUTES/KNOWLEDGE_BROWSER_ROUTES (the
  // pinned browser SDK route maps only cover the domains it lists — calendar is not one
  // of them), so every calendar id needs a hand-written row here, same as approvals.*
  // above. The SDK's own catalog entry ships these `invokable: false` (a CalDAV-backed
  // contract with no daemon-sdk handler in the SDK repo itself); a daemon that has
  // registered a real handler for these ids (see the calendar decision record) answers
  // normally, an un-upgraded one answers 501 "not invokable" or 404 "unknown gateway
  // method" — both honest refusals the calendar view distinguishes from a genuine fault
  // (isMethodNotInvokableError / isMethodUnavailableError, lib/errors.ts) from a
  // CalDAV-not-configured 412 (isCalendarUnconfiguredError).
  'calendar.events.create': { method: 'POST', path: '/api/calendar/events' },
  'calendar.events.get': { method: 'GET', path: '/api/calendar/events/{eventId}' },
  'calendar.events.list': { method: 'GET', path: '/api/calendar/events' },
  'calendar.ics.export': { method: 'GET', path: '/api/calendar/ics/export' },
  'calendar.ics.import': { method: 'POST', path: '/api/calendar/ics/import' },
  // Honest-lineage chat verbs (SDK 1.1.0). Both have real REST routes on the daemon
  // and are in the installed OperatorMethodId union, but the pinned browser SDK route
  // maps (SHARED/KNOWLEDGE_BROWSER_ROUTES) do NOT cover them, so they resolve here as
  // hand-written REST rows. The route reads the body FLAT ({ messageId, content,
  // attachments }) — interpolateRoute consumes `sessionId` from the path and posts the
  // rest as-is (see the chat.messages.retry/.edit call sites below). Neither has a
  // generated OperatorMethodInput/OutputMap entry, so both are invoked through the
  // untyped path with a hand-authored result shape (Companion{Regenerate,Edit}Result).
  'companion.chat.messages.edit': { method: 'POST', path: '/api/companion/chat/sessions/{sessionId}/messages/edit' },
  'companion.chat.messages.retry': { method: 'POST', path: '/api/companion/chat/sessions/{sessionId}/messages/retry' },
  'companion.chat.sessions.close': { method: 'POST', path: '/api/companion/chat/sessions/{sessionId}/close' },
  'companion.chat.sessions.delete': { method: 'DELETE', path: '/api/companion/chat/sessions/{sessionId}' },
  // config.get (GET /config) — the admin-scoped full-config read
  // (context.configManager.getAll()). Two consumers share this one row: the
  // voice surface reads it to learn the SHARED spoken-voice defaults
  // (tts.provider / tts.voice) so playback uses the same voice the TUI and
  // agent do (the typed snapshot declares domain sections with
  // additionalProperties:true, so the `tts` section rides in as an extra
  // property — read it defensively, src/lib/voice/voice-config.ts); the
  // model/config workspace reads the same full snapshot for its honest
  // config.get browsing (never rendered raw — src/lib/config-redaction.ts).
  'config.get': { method: 'GET', path: '/config' },
  'config.set': { method: 'POST', path: '/config' },
  'control.methods.get': { method: 'GET', path: '/api/control-plane/methods/{methodId}' },
  'credentials.get': { method: 'GET', path: '/config/credentials' },
  'local_auth.status': { method: 'GET', path: '/api/local-auth' },
  'models.current': { method: 'GET', path: '/api/models/current' },
  'models.list': { method: 'GET', path: '/api/models' },
  'models.select': { method: 'PATCH', path: '/api/models/current' },
  'sessions.close': { method: 'POST', path: '/api/sessions/{sessionId}/close' },
  'sessions.delete': { method: 'DELETE', path: '/api/sessions/{sessionId}' },
  // sessions.detach: remove ONE participant (surfaceId) from a shared session's
  // participant list without closing/killing it (detach != close != kill — see the
  // wire description on sdk.operator.sessions.detach below). Real REST route, in the
  // installed OperatorMethodId union, same EXTRA_METHOD_ROUTES pattern as
  // close/reopen above; body carries `surfaceId` (sessionId is consumed by
  // interpolateRoute from the path).
  'sessions.detach': { method: 'POST', path: '/api/sessions/{sessionId}/detach' },
  'sessions.reopen': { method: 'POST', path: '/api/sessions/{sessionId}/reopen' },
  // memory.records.* / memory.review-queue (WEBUI-MEMORY-VIEW, SDK 1.1.0's just-landed
  // canonical memory store): all six ids ARE in the installed OperatorMethodId union
  // (operator-method-ids.d.ts lists memory.records.add/search/get/update-review/delete
  // and memory.review-queue), but — like fleet.*/checkpoints.* before them — neither the
  // generated I/O maps (foundation-client-types.d.ts only covers memory.doctor/
  // vector.stats/vector.rebuild/embeddings.default.set, none of these six) nor the
  // browser SDK's route tables (browser-scoped.js / browser-knowledge.js: zero
  // memory.* entries) cover them yet. UNLIKE fleet.*/checkpoints.* (ws-only, generic
  // invoke), these six DO have real REST http bindings (method-catalog-runtime.js), so
  // EXTRA_METHOD_ROUTES — not invokeGatewayMethod — is the correct mechanism, the same
  // path sessions.close/reopen already take. Wire shapes (MemoryRecord, the honest
  // search envelope, the delete-means-delete boolean) are hand-authored below from the
  // daemon's own schemas (operator-contract-schemas-runtime.js), the same
  // cross-checked-against-source approach the Approvals/Tasks sections above use.
  'memory.records.add': { method: 'POST', path: '/api/memory/records' },
  'memory.records.search': { method: 'POST', path: '/api/memory/records/search' },
  'memory.records.get': { method: 'GET', path: '/api/memory/records/{id}' },
  'memory.records.update-review': { method: 'POST', path: '/api/memory/records/{id}/review' },
  'memory.records.delete': { method: 'DELETE', path: '/api/memory/records/{id}' },
  'memory.review-queue': { method: 'GET', path: '/api/memory/review-queue' },
  'tasks.cancel': { method: 'POST', path: '/api/tasks/{taskId}/cancel' },
  // tasks.create posts to the legacy `/task` path (no {taskId} placeholder — the
  // whole body is the task submission), predating the `/api/tasks` REST family.
  'tasks.create': { method: 'POST', path: '/task' },
  'tasks.list': { method: 'GET', path: '/api/tasks' },
  'tasks.retry': { method: 'POST', path: '/api/tasks/{taskId}/retry' },
  // watchers.stop: the one fleet-adjacent kill action this client can back with a
  // real wire verb (WEBUI-FLEET-DEPTH) — WatcherRecord.id IS the fleet node id for
  // kind:'watcher' (adaptWatcher, packages/sdk/.../fleet/adapters/watcher.ts sets
  // `id: record.id` with no namespacing), unlike agent/wrfc-chain/workflow/trigger/
  // schedule kills, which the daemon only exposes to same-process callers (the TUI's
  // fleet registry) and NOT over the operator wire today — see lib/fleet.ts's
  // `wireStopUnavailableReason` for the honest per-kind accounting.
  'watchers.stop': { method: 'POST', path: '/api/watchers/{watcherId}/stop' },
  // Voice verbs (SDK 1.1.0). All are in the installed OperatorMethodId union with real
  // generated I/O maps, but the pinned browser SDK route maps do not cover them, so they
  // resolve here as hand-written REST rows. voice.tts.stream is DELIBERATELY ABSENT: its
  // response body is streamed audio bytes, not JSON, so it cannot ride requestJson — the
  // player fetches it raw via sdk.operator.voice.ttsStream (requestStream below).
  'voice.providers.list': { method: 'GET', path: '/api/voice/providers' },
  'voice.status': { method: 'GET', path: '/api/voice' },
  'voice.stt': { method: 'POST', path: '/api/voice/stt' },
  'voice.tts': { method: 'POST', path: '/api/voice/tts' },
  'voice.voices.list': { method: 'GET', path: '/api/voice/voices' },
};

const RUNTIME_DOMAINS: RuntimeEventDomain[] = [
  'session',
  'turn',
  'providers',
  'tools',
  'tasks',
  'agents',
  'workflows',
  'orchestration',
  'communication',
  'planner',
  'permissions',
  'plugins',
  'mcp',
  'transport',
  'compaction',
  'ui',
  'ops',
  'forensics',
  'security',
  'automation',
  'routes',
  'control-plane',
  'deliveries',
  'watchers',
  'surfaces',
  'knowledge',
  'workspace',
];

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function buildUrl(path: string, query?: JsonRecord): string {
  const url = new URL(path, `${GOODVIBES_BASE_URL.replace(/\/+$/, '')}/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    else if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null && item !== '') {
          url.searchParams.append(key, String(item));
        }
      }
    } else if (typeof value === 'object') {
      url.searchParams.set(key, JSON.stringify(value));
    } else {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- value is not an object (handled above), array (handled above), null/undefined/'' (skipped above)
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await tokenStore.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function requestJson<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: HeadersInit = {
    ...(options.authenticated === false ? {} : await authHeaders()),
    ...(method === 'GET' || options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
  };
  const url = buildUrl(path, options.query);
  const response = await fetch(url, {
    method,
    credentials: 'include',
    headers,
    ...(method === 'GET' || options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw Object.assign(new Error(`${method} ${path} failed: ${response.status} ${response.statusText}`.trim()), {
      status: response.status,
      url,
      method,
      body,
      category: response.status === 401 ? 'authentication' : 'service',
    });
  }
  return body as T;
}

/**
 * requestStream — a POST whose SUCCESS body is raw bytes, not JSON (voice.tts.stream
 * returns streamed audio). Returns the live Response so the caller can read
 * arrayBuffer()/body without this helper eagerly draining it. On a non-2xx it drains and
 * throws the SAME error shape requestJson does (status/category), so the TTS request
 * policy's transient-429 detection (src/lib/voice/request-policy.ts keys off `status`)
 * works identically on both paths.
 */
async function requestStream(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const headers: HeadersInit = { ...(await authHeaders()), 'Content-Type': 'application/json' };
  const url = buildUrl(path);
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const errBody = await readJson(response).catch(() => null);
    throw Object.assign(new Error(`POST ${path} failed: ${response.status} ${response.statusText}`.trim()), {
      status: response.status,
      url,
      method: 'POST' as HttpMethod,
      body: errBody,
      category: response.status === 401 ? 'authentication' : 'service',
    });
  }
  return response;
}

function interpolateRoute(route: RouteDefinition, input: unknown): { path: string; rest: JsonRecord } {
  const record = asRecord(input);
  const consumed = new Set<string>();
  const path = route.path.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = record[key];
    if (value === undefined || value === null || value === '') throw new Error(`Missing route parameter: ${key}`);
    consumed.add(key);
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- value is a non-null, non-undefined, non-empty string URL param; the throw guard above rejects undefined/null/'' but does not exclude objects, so String() may yield "[object Object]" for non-primitive route values
    return encodeURIComponent(String(value));
  });
  const rest = Object.fromEntries(Object.entries(record).filter(([key, value]) => !consumed.has(key) && value !== undefined));
  return { path, rest };
}

/**
 * True when a method resolves via a hand-written EXTRA_METHOD_ROUTES row rather than
 * natively through scopedSdk.operator.invoke. Exported so the retirement contract is
 * test-enforced: sessions.get/steer/followUp must be native (false); sessions.close /
 * reopen must still be table-routed (true).
 */
export function isExtraRoutedMethod(methodId: string): boolean {
  return Boolean(EXTRA_METHOD_ROUTES[methodId]);
}

/**
 * invokeOperator — the single dispatcher for every operator method id, contract-typed.
 *
 * Overload 1 covers every id in the installed `OperatorMethodId` union (every row in
 * EXTRA_METHOD_ROUTES except models.* — see overload 2 — plus every sessions.* id that
 * falls through to scopedSdk.operator.invoke below): TInput/TOutput default to
 * `OperatorMethodInput/OperatorMethodOutput<TMethodId>`, so a caller gets the REAL
 * generated shape for free and a wrong-shaped input is a compile error, with no `as
 * never` at the call site. Callers with a known, tested divergence from the generated
 * shape (see the Approvals/Tasks section comments above) pass explicit TInput/TOutput
 * overrides instead of the defaults.
 *
 * Overload 2 is the honest fallback for models.* — CORRECTED (2026-07): the earlier
 * gap-note this replaced claimed the pinned 0.38 contracts package had no typed method
 * ids for verbs like these; that was true for fleet.* and checkpoints.* at the time but was
 * NEVER true for models.* — models.current/list/select are not in the OperatorMethodId
 * union AT ALL (operator-method-ids.ts has no "models.*" entries), so there is no
 * OperatorMethodInput/Output to type them against, unlike fleet.* and checkpoints.*
 * (contract-bridge-types.ts) which DO have ids today and are only missing I/O shapes.
 * This is a standing gap, not a pin-bump-pending one — flag it again if a future
 * contracts generation adds models.* ids.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters -- TInput is
   deliberately independent of TMethodId: call sites with a known, tested divergence
   from OperatorMethodInput<TMethodId> (see the Approvals section above) override it
   explicitly (e.g. `{ approvalId: string } & ApprovalApproveInput`) without needing to
   widen TMethodId itself. */
async function invokeOperator<
  TMethodId extends OperatorMethodId,
  TInput = OperatorMethodInput<TMethodId>,
  TOutput = OperatorMethodOutput<TMethodId>,
>(methodId: TMethodId, input?: TInput): Promise<TOutput>;
/* eslint-enable @typescript-eslint/no-unnecessary-type-parameters */
async function invokeOperator(methodId: string, input?: unknown): Promise<unknown>;
async function invokeOperator(methodId: string, input?: unknown): Promise<unknown> {
  const route = EXTRA_METHOD_ROUTES[methodId];
  if (!route) {
    // The one unavoidable escape hatch: every methodId that reaches this branch (no
    // EXTRA_METHOD_ROUTES row) is, by construction, a member of BrowserKnowledgeMethodId
    // (SHARED_BROWSER_ROUTES ∪ KNOWLEDGE_BROWSER_ROUTES) — a runtime invariant the type
    // system cannot see through a string-keyed table lookup. isExtraRoutedMethod's test
    // coverage below is what actually enforces it, not this cast.
    return scopedSdk.operator.invoke(
      methodId as BrowserKnowledgeMethodId,
      input as OperatorMethodInput<BrowserKnowledgeMethodId>,
    );
  }
  const { path, rest } = interpolateRoute(route, input);
  if (route.method === 'GET') return requestJson(path, { method: route.method, query: rest });
  if (route.method === 'DELETE' && !Object.keys(rest).length) return requestJson(path, { method: route.method });
  return requestJson(path, { method: route.method, body: rest });
}

/**
 * invokeGatewayMethod — typed direct call to the generic invoke-by-id endpoint
 * (POST /api/control-plane/methods/{methodId}/invoke), mirroring the SDK's
 * own `invokeVerb` test helper (test/w3-s2-fleet-checkpoints-search.test.ts).
 *
 * WHY THIS EXISTS: fleet.*, checkpoints.*, and sessions.search are
 * registered with `transport: ['ws']` and NO `http` route binding
 * (method-catalog-fleet.ts / session-search.ts) — they are reachable ONLY through this
 * generic invoke mechanism, not through scopedSdk.operator.invoke (which resolves
 * against the fixed SHARED_BROWSER_ROUTES/KNOWLEDGE_BROWSER_ROUTES tables baked into the
 * browser SDK build and has no entries for these verbs) and not through
 * EXTRA_METHOD_ROUTES (built for REST-shaped path-param routes, which these verbs don't
 * have).
 *
 * TYPED BY THE CONTRACT ID: `methodId: TMethodId extends OperatorMethodId` — these ids
 * ARE in the installed 0.38 union (verified: operator-method-ids.ts lists fleet.*,
 * checkpoints.*, sessions.search, sessions.detach). `body` is constrained to
 * `OperatorMethodInput<TMethodId>`, which today resolves to the generic
 * `{ [k: string]: unknown }` fallback for this family (no `OperatorMethodInputMap` entry
 * yet) — every bridge input type in contract-bridge-types.ts is a plain object with an
 * optional-properties shape, which IS assignable to that index signature, so no cast is
 * needed at any call site below. TOutput has no useful default (`OperatorMethodOutput<M>`
 * is plain `unknown` for this family today) — every call site supplies the real
 * contract-bridge-types.ts shape explicitly.
 */
async function invokeGatewayMethod<TMethodId extends OperatorMethodId, TOutput = OperatorMethodOutput<TMethodId>>(
  methodId: TMethodId,
  body?: OperatorMethodInput<TMethodId>,
): Promise<TOutput> {
  return requestJson<TOutput>(`/api/control-plane/methods/${methodId}/invoke`, {
    method: 'POST',
    body: { body: body ?? {} },
  });
}

// ─── Approvals (approvals.*, per-hunk selection) ─────────────────────
//
// UNLIKE fleet.*/checkpoints.* (contract-bridge-types.ts), approvals.* HAS real,
// generated OperatorMethodInputMap/OutputMap coverage today (foundation-client-
// types.ts) — every interface below was cross-checked field-by-field against
// OperatorMethodOutputMap['approvals.list'/'approvals.approve'] and is a safe
// SUPERSET or an intentional, permanent (not pin-bump-pending) divergence from it:
//   - `status`/`request.category`/etc. are kept as open `string`s here rather than
//     the contract's closed literal unions — the same defensive-parsing stance
//     lib/fleet.ts documents for kind/state ("a daemon newer than this client may
//     introduce a value we have never seen. Render it verbatim, never drop it").
//   - `ApprovalRecord.audit` stays OPTIONAL here (the contract requires it) — this
//     client never runtime-validates the wire response (see `invokeOperator`), so
//     a mixed-version/pre-audit record may genuinely omit it; approvals.test.ts
//     pins a fixture that omits `audit` on purpose.
//   - `ApprovalDecision.modifiedArgs` and `ApprovalApproveInput.selectedHunks` are
//     real per-hunk-apply wire fields the generated 0.38 maps do not cover.
// Because of these deliberate divergences, invokeOperator's approvals.* calls
// below pass explicit TOutput/TInput overrides rather than the contract defaults.

/**
 * One edit hunk of an `edit`-tool approval's `request.args.edits` array.
 * Mirrors the SDK's EditHunkLike (approval-hunk-apply.ts) — path/find/replace
 * plus an optional stable id. Read defensively (see lib/approvals.ts): a
 * request whose args are not edit-shaped simply has no hunks to render.
 */
export interface ApprovalEditHunk {
  readonly path: string;
  readonly find: string;
  readonly replace: string;
  readonly id?: string;
}

export interface ApprovalAnalysis {
  readonly classification: string;
  readonly riskLevel: string;
  readonly summary: string;
  readonly reasons: readonly string[];
  readonly target?: string;
  readonly targetKind?: string;
  readonly surface?: string;
  readonly blastRadius?: string;
  readonly sideEffects?: readonly string[];
  readonly host?: string;
}

export interface ApprovalRequest {
  readonly callId: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly category: string;
  readonly analysis: ApprovalAnalysis;
  readonly workingDirectory?: string;
}

export interface ApprovalDecision {
  readonly approved: boolean;
  readonly remember?: boolean;
  readonly modifiedArgs?: Record<string, unknown>;
}

export type ApprovalStatus = 'pending' | 'claimed' | 'approved' | 'denied' | 'cancelled' | 'expired';

/**
 * One entry in an approval's decision trail — the SDK's SharedApprovalAuditRecord
 * (packages/sdk/src/platform/control-plane/approval-broker.ts). Appended on every
 * lifecycle transition (created/claimed/approved/denied/cancelled/expired/updated),
 * so a resolved approval's `audit` array is the honest provenance of who did what,
 * from where, and when — not just the final `decision`/`resolvedBy` snapshot.
 */
export interface ApprovalAuditRecord {
  readonly id: string;
  readonly action: 'created' | 'claimed' | 'approved' | 'denied' | 'cancelled' | 'expired' | 'updated';
  readonly actor: string;
  readonly actorSurface?: string;
  readonly createdAt: number;
  readonly note?: string;
}

export interface ApprovalRecord {
  readonly id: string;
  readonly callId: string;
  readonly sessionId?: string;
  readonly routeId?: string;
  readonly status: ApprovalStatus;
  readonly request: ApprovalRequest;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly claimedBy?: string;
  readonly claimedAt?: number;
  readonly resolvedAt?: number;
  readonly resolvedBy?: string;
  readonly decision?: ApprovalDecision;
  readonly metadata: Record<string, unknown>;
  /**
   * The full decision trail. Optional in this client-side type (rather than
   * mirroring the SDK's required field) because this client reads the wire
   * response as-is with no runtime schema validation (see `invokeOperator`
   * below) — a mixed-version or pre-audit daemon record may genuinely omit
   * it. Treat absence as "no trail recorded", never as an error.
   */
  readonly audit?: readonly ApprovalAuditRecord[];
}

export interface ApprovalSnapshotResult {
  readonly awaitingDecision: boolean;
  readonly mode: string;
  readonly approvalCount: number;
  readonly denialCount: number;
  readonly cachedChecks: number;
  readonly totalChecks: number;
  readonly approvals: readonly ApprovalRecord[];
}

export interface ApprovalActionResult {
  readonly approval: ApprovalRecord;
}

/**
 * Optional per-hunk selection for `approvals.approve`. Omitting
 * `selectedHunks` approves the whole request (back-compat); when present the
 * DAEMON filters the approval's own edit list to those indices server-side
 * (approval-hunk-apply.ts) so every surface (TUI, webui) produces identical
 * modified-edit args — the webui only ever sends indices, never a computed diff.
 */
export interface ApprovalApproveInput {
  readonly selectedHunks?: readonly number[];
  readonly note?: string;
  readonly remember?: boolean;
}

// ─── Tasks (tasks.*) ─────────────────────────────────────────────────────────
//
// tasks.create/cancel/retry have no known divergence from the generated contract
// (ApprovalsTasksView.test.tsx exercises them without relying on any field the
// contract omits), so their input/output alias OperatorMethodInput/Output directly.
// tasks.list's item shape needs one addition the generated map does not carry —
// `cancellable` (ApprovalsTasksView.tsx reads it to gate the Cancel button; the
// contract's tasks.list item omits it even though tasks.cancel/get's richer task
// shape does not carry it either) — so RuntimeTaskSummary/TaskSnapshotResult stay
// local, with the divergence named here rather than silently re-added.

export interface RuntimeTaskSummary {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly status: string;
  readonly owner: string;
  /** Not in OperatorMethodOutputMap['tasks.list']'s item shape — a known, tested
   * client-side addition (ApprovalsTasksView.test.tsx: "cancel is offered only for
   * a cancellable task"). */
  readonly cancellable?: boolean;
  readonly parentTaskId?: string;
  readonly queuedAt: number;
  readonly startedAt?: number;
  readonly endedAt?: number;
  readonly error?: string;
}

export interface TaskSnapshotResult {
  readonly queued: number;
  readonly running: number;
  readonly blocked: number;
  readonly totals: {
    readonly created: number;
    readonly completed: number;
    readonly failed: number;
    readonly cancelled: number;
  };
  readonly tasks: readonly RuntimeTaskSummary[];
}

export type TaskActionResult = OperatorMethodOutput<'tasks.cancel'>;
export type TaskCreateInput = OperatorMethodInput<'tasks.create'>;
export type TaskCreateResult = OperatorMethodOutput<'tasks.create'>;

// ─── Watchers (watchers.stop only — WEBUI-FLEET-DEPTH) ────────────────────────
// watchers.stop has no OperatorMethodInputMap/OutputMap entry in the installed
// contracts package (same pre-SWAP situation as sessions.detach in
// contract-bridge-types.ts), so this is hand-authored against the wire schema. `kind`/
// `state` are open strings, matching lib/fleet.ts's defensive-parsing stance for the
// same reason (a daemon newer than this client may report a state this client has
// never seen — render it verbatim, never drop it). Only the fields FleetView actually
// reads are typed; the real response carries far more (source, metadata, timestamps).
export interface WatcherActionResult {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly state: string;
}

/**
 * Calendar (calendar.*, SDK 1.1.0) — like models.*, fleet.*, checkpoints.* above, these
 * ids have NO OperatorMethodInputMap/OutputMap entry in the installed contracts package
 * (verified: grepping the generated foundation-client-types.d.ts for "calendar" returns
 * nothing), so OperatorMethodInput/Output<'calendar.*'> would resolve to the generic
 * `{[k:string]: unknown}` / `unknown` fallback. These hand-authored shapes are cross-
 * checked field-by-field against the SDK's own CALENDAR_EVENT_SUMMARY_SCHEMA /
 * CALENDAR_EVENT_DETAIL_SCHEMA / create-output / import-output / export-output
 * (method-catalog-calendar.ts) — a permanent divergence (no generated map to converge
 * with), not a pin-bump-pending gap.
 */
export interface CalendarEventSummary {
  readonly id: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly location?: string;
  readonly description?: string;
  readonly attendees?: readonly string[];
}

export interface CalendarEventDetail extends CalendarEventSummary {
  readonly uid: string;
  readonly recurrence?: string;
}

export interface CalendarEventsListInput {
  readonly calendarId?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
}

export interface CalendarEventsListResult {
  readonly events: readonly CalendarEventSummary[];
}

/** `confirm` is required — the SDK schema's own explicit-confirmation gate for a write. */
export interface CalendarEventCreateInput {
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly description?: string;
  readonly attendees?: readonly string[];
  readonly location?: string;
  readonly calendarId?: string;
  readonly confirm: true;
}

export interface CalendarEventCreateResult {
  readonly eventId: string;
  readonly uid: string;
  readonly createdAt: string;
}

export interface CalendarIcsImportInput {
  readonly icsContent: string;
  readonly calendarId?: string;
  readonly confirm: true;
}

export interface CalendarIcsImportResult {
  readonly imported: number;
  readonly eventIds: readonly string[];
  readonly errors: readonly string[];
}

export interface CalendarIcsExportInput {
  readonly calendarId?: string;
  readonly from?: string;
  readonly to?: string;
}

export interface CalendarIcsExportResult {
  readonly icsContent: string;
  readonly eventCount: number;
}

/**
 * SessionDeleteResult — the honest hard-delete outcome shape shared by
 * `operator.sessions.delete` and `chat.sessions.delete`: `deleted: true` means the
 * record and its messages/inputs were actually removed, not merely closed. Neither
 * `sessions.delete` (union) nor a truly-deleting `companion.chat.sessions.delete` has a
 * generated OperatorMethodOutputMap entry in the installed 0.38 contracts yet, so this
 * is a hand-authored local shape, not a contract re-export.
 */
export interface SessionDeleteResult {
  readonly sessionId: string;
  readonly deleted: boolean;
}

/**
 * The honest-lineage result of `chat.messages.retry` (regenerate). The prior assistant
 * response, and any turns after it, are SUPERSEDED — retained in the message list and on
 * disk, flagged with `supersededAt`/`supersededReason`, never deleted — and a fresh turn
 * re-runs from the preceding user message. `supersededMessageIds` is the retained-history
 * set the UI surfaces as viewable prior versions; `turnStarted` says whether a new turn
 * is now streaming back. Hand-authored: companion.chat.messages.retry has no generated
 * OperatorMethodOutputMap entry in the installed contracts (its id IS in the union, but
 * the I/O map is not), cross-checked against the SDK's method-catalog-control-companion.
 */
export interface CompanionRegenerateResult {
  readonly sessionId: string;
  readonly regeneratedFrom: string;
  readonly supersededMessageIds: readonly string[];
  readonly turnStarted: boolean;
}

/**
 * The honest-lineage result of `chat.messages.edit` (edit-and-branch). The edited user
 * message, and everything after it, are SUPERSEDED (retained history), and a NEW user
 * message carrying `revisionOf` back to the original is appended before a fresh turn
 * answers it. `editedFrom` is the original id (now retained history); `messageId` is the
 * new active user message. Same generated-map gap as CompanionRegenerateResult.
 */
export interface CompanionEditResult {
  readonly sessionId: string;
  readonly editedFrom: string;
  readonly messageId: string;
  readonly supersededMessageIds: readonly string[];
  readonly turnStarted: boolean;
}

/** Input for `chat.messages.edit` — the user message to edit plus its replacement text. */
export interface CompanionEditInput {
  readonly content: string;
  readonly attachments?: readonly { artifactId: string; label?: string }[];
  readonly metadata?: Record<string, unknown>;
}

/**
 * Explicit capped-exponential reconnect policy for every SSE consumer. Without it the
 * SDK falls back to its own defaults and a dropped stream can appear "live"; with it a
 * dropped stream reconnects with backoff and, once attempts are exhausted, degrades to
 * the honest "SSE error/off" strip state and the 15s health-probe fallback.
 */
export const DEFAULT_SSE_RECONNECT = {
  enabled: true,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  backoffFactor: 2,
  maxAttempts: 10,
} as const;

// ─── Memory (memory.records.*, memory.review-queue) ───────────────────────────
//
// The canonical, daemon-owned cross-surface memory store's wire shapes — hand-authored
// because none of these six ids has a generated OperatorMethodInputMap/OutputMap entry
// yet (see the EXTRA_METHOD_ROUTES comment above). Every field name and requiredness
// below is cross-checked against the daemon's own schema definitions
// (operator-contract-schemas-runtime.js: MEMORY_RECORD_SCHEMA,
// MEMORY_RECORD_SEARCH_OUTPUT_SCHEMA, MEMORY_RECORD_DELETE_OUTPUT_SCHEMA), not guessed.

export type MemoryScope = 'session' | 'project' | 'team';
export type MemoryClass =
  | 'decision' | 'constraint' | 'incident' | 'pattern' | 'fact' | 'risk' | 'runbook' | 'architecture' | 'ownership';
export type MemoryReviewState = 'fresh' | 'reviewed' | 'stale' | 'contradicted';
export type MemoryProvenanceKind = 'session' | 'turn' | 'task' | 'event' | 'file';

/** VIBE.md persona/preference lines are constraint records tagged with this — see the
 * SDK's vibe-projection.ts (VIBE_PERSONA_TAG). There is no `memory.fold`/projection verb
 * on the wire ("fold is NOT on the wire" — the brief this view was built from), so this
 * client replicates the same cls+tag test locally rather than deep-importing an
 * internal, non-exported SDK module path. See memory-helpers.ts's isPersonaRecord. */
export const VIBE_PERSONA_TAG = 'vibe';

export interface MemoryProvenanceLink {
  readonly kind: MemoryProvenanceKind;
  readonly ref: string;
  readonly label?: string;
}

export interface MemoryRecord {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly cls: MemoryClass;
  readonly summary: string;
  readonly detail?: string;
  readonly tags: readonly string[];
  readonly provenance: readonly MemoryProvenanceLink[];
  readonly reviewState: MemoryReviewState;
  readonly confidence: number;
  readonly reviewedAt?: number;
  readonly reviewedBy?: string;
  readonly staleReason?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface MemoryRecordEntityResult {
  readonly record: MemoryRecord;
}

/**
 * The honest search envelope (memory-recall-contract.ts's HonestMemorySearchResult,
 * promoted onto the wire verbatim by memory.records.search). `mode` is the path that
 * ACTUALLY ran ('literal' even when semantic was requested but the index could not be
 * consulted); `indexUnavailableReason` is non-null only in that fallback case and MUST
 * be shown verbatim — never swallowed into a silent empty result. `caveat` is the
 * softer "ran on the hashed-only fallback provider" note. `recallFiltered` /
 * `excludedFlaggedCount` / `excludedBelowFloorCount` / `totalBeforeRecallFilter` are the
 * honesty receipt for the 60%-floor recall-injection contract (only populated when the
 * caller opted into `recall: true`).
 */
export interface MemorySearchResult {
  readonly records: readonly MemoryRecord[];
  readonly mode: 'literal' | 'semantic';
  readonly requestedSemantic: boolean;
  readonly indexUnavailableReason: string | null;
  readonly caveat: string | null;
  readonly recallFiltered: boolean;
  readonly excludedFlaggedCount: number;
  readonly excludedBelowFloorCount: number;
  readonly totalBeforeRecallFilter: number;
}

/** Delete-means-delete: an honest boolean, never a 200 that pretends a phantom row was
 * removed (MEMORY_RECORD_DELETE_OUTPUT_SCHEMA — `deleted: false` when nothing existed). */
export interface MemoryRecordDeleteResult {
  readonly id: string;
  readonly deleted: boolean;
}

export interface MemoryReviewQueueResult {
  readonly records: readonly MemoryRecord[];
}

export interface MemorySearchInput {
  readonly scope?: MemoryScope;
  readonly cls?: MemoryClass;
  readonly tags?: readonly string[];
  readonly query?: string;
  readonly semantic?: boolean;
  readonly since?: number;
  readonly reviewState?: readonly MemoryReviewState[];
  readonly minConfidence?: number;
  readonly provenanceKinds?: readonly MemoryProvenanceKind[];
  readonly staleOnly?: boolean;
  readonly limit?: number;
  /** Apply the recall-injection contract server-side (exclude flagged records outright,
   * drop sub-floor records, count every exclusion). Off by default — a browse/review
   * caller wants to SEE flagged and low-confidence records too. */
  readonly recall?: boolean;
}

export interface MemoryAddReviewInput {
  readonly state?: MemoryReviewState;
  readonly confidence?: number;
  readonly reviewedBy?: string;
  readonly staleReason?: string;
}

export interface MemoryAddInput {
  readonly cls: MemoryClass;
  readonly summary: string;
  readonly scope?: MemoryScope;
  readonly detail?: string;
  readonly tags?: readonly string[];
  readonly provenance?: readonly MemoryProvenanceLink[];
  readonly review?: MemoryAddReviewInput;
}

export interface MemoryUpdateReviewInput {
  readonly state?: MemoryReviewState;
  readonly confidence?: number;
  readonly reviewedBy?: string;
  readonly staleReason?: string;
}

export interface MemoryReviewQueueInput {
  readonly limit?: number;
  readonly scope?: MemoryScope;
}

const scopedSdk = createBrowserKnowledgeSdk({
  baseUrl: GOODVIBES_BASE_URL,
  tokenStore,
  realtime: {
    sseReconnect: DEFAULT_SSE_RECONNECT,
  },
});

export const sdk = {
  auth: {
    current: () => scopedSdk.auth.current(),
    getToken: () => tokenStore.getToken(),
    setToken: (token: string | null) => scopedSdk.auth.setToken(token),
    clearToken: () => scopedSdk.auth.clearToken(),
  },
  operator: {
    invoke: invokeOperator,
    control: {
      status: () => scopedSdk.operator.invoke('control.status', {}),
      snapshot: () => scopedSdk.operator.invoke('control.snapshot', {}),
      // methodInfo: an honest, read-only capability probe. 'control.methods.get'
      // IS in the installed 0.38 OperatorMethodId union with a real generated I/O map
      // (foundation-client-types.ts), so this is a normal typed invokeOperator call, not
      // a bridge — the METHOD BEING CHECKED (its `methodId` argument) can be any string,
      // including one this daemon build has never heard of, which is the whole point:
      // an unregistered id 404s with `{error: 'Unknown gateway method'}` rather than
      // pretending. Callers use this to decide whether to offer a not-yet-available
      // capability (e.g. sessions.delete) rather than rendering it and letting it fail.
      methodInfo: (methodId: string) => invokeOperator('control.methods.get', { methodId }),
    },
    accounts: {
      snapshot: () => scopedSdk.operator.invoke('accounts.snapshot', {}),
    },
    providers: {
      list: () => scopedSdk.operator.invoke('providers.list', {}),
      get: (providerId: string) => scopedSdk.operator.invoke('providers.get', { providerId }),
      usage: (providerId: string) => scopedSdk.operator.invoke('providers.usage.get', { providerId }),
    },
    credentials: {
      // Cross-surface secret-free credential status (see the 1.0.1 entry in
      // CHANGELOG.md). The browser reaches the shared store only over the
      // daemon. Status only — never bytes.
      get: () => invokeOperator('credentials.get'),
    },
    // config.* — like models.*, no OperatorMethodId coverage in the pinned
    // browser SDK route maps, so both resolve through EXTRA_METHOD_ROUTES.
    // get() returns the daemon's FULL config tree unredacted (configManager.
    // getAll() — verified against system-routes.ts). Two consumers: the voice
    // surface reads the SHARED tts.provider/tts.voice defaults so the browser
    // speaks in the same voice as the TUI and agent; the model/config
    // workspace browses the same snapshot — callers there MUST run it through
    // src/lib/config-redaction.ts before rendering, never display it raw.
    // set() writes one key at a time (the daemon's real /config contract).
    config: {
      get: () => invokeOperator('config.get'),
      set: (key: string, value: unknown) => invokeOperator('config.set', { key, value }),
    },
    // Voice (SDK 1.1.0). status/providers/voices are read:voice; stt/tts are write:voice.
    // ttsStream returns the RAW streamed-audio Response (not JSON) — the Web Audio player
    // reads its bytes. All resolve through EXTRA_METHOD_ROUTES (except ttsStream, which is
    // a raw fetch) and carry the real generated I/O types.
    voice: {
      status: () => invokeOperator('voice.status', {}),
      providers: () => invokeOperator('voice.providers.list', {}),
      voices: (providerId?: string) =>
        invokeOperator('voice.voices.list', providerId ? { providerId } : {}),
      stt: (input: OperatorMethodInput<'voice.stt'>) => invokeOperator('voice.stt', input),
      tts: (input: OperatorMethodInput<'voice.tts'>) => invokeOperator('voice.tts', input),
      ttsStream: (input: OperatorMethodInput<'voice.tts.stream'>, signal?: AbortSignal) =>
        requestStream('/api/voice/tts/stream', input, signal),
    },
    // models.* have NO OperatorMethodId coverage at all (see invokeOperator's doc
    // comment) — the untyped overload is the honest, permanent shape here.
    models: {
      list: () => invokeOperator('models.list'),
      current: () => invokeOperator('models.current'),
      select: (registryKey: string) => invokeOperator('models.select', { registryKey }),
    },
    tasks: {
      // Local TaskSnapshotResult diverges from OperatorMethodOutput<'tasks.list'> only
      // by adding `cancellable` (see the Tasks section comment) — explicit override.
      list: () => invokeOperator<'tasks.list', OperatorMethodInput<'tasks.list'>, TaskSnapshotResult>('tasks.list'),
      create: (input: TaskCreateInput) => invokeOperator('tasks.create', input),
      cancel: (taskId: string) => invokeOperator('tasks.cancel', { taskId }),
      retry: (taskId: string) => invokeOperator('tasks.retry', { taskId }),
    },
    // Calendar (calendar.*, see the EXTRA_METHOD_ROUTES header comment above for the
    // invokable-false/501/404 honesty caveat). Every call site here is explicitly typed
    // against the hand-authored shapes above (no generated I/O map exists for this
    // family) — see that section's header comment.
    calendar: {
      events: {
        list: (input?: CalendarEventsListInput) =>
          invokeOperator<'calendar.events.list', CalendarEventsListInput, CalendarEventsListResult>(
            'calendar.events.list',
            input ?? {},
          ),
        get: (eventId: string, calendarId?: string) =>
          invokeOperator<'calendar.events.get', { eventId: string; calendarId?: string }, CalendarEventDetail>(
            'calendar.events.get',
            { eventId, ...(calendarId ? { calendarId } : {}) },
          ),
        create: (input: CalendarEventCreateInput) =>
          invokeOperator<'calendar.events.create', CalendarEventCreateInput, CalendarEventCreateResult>(
            'calendar.events.create',
            input,
          ),
      },
      ics: {
        export: (input?: CalendarIcsExportInput) =>
          invokeOperator<'calendar.ics.export', CalendarIcsExportInput, CalendarIcsExportResult>(
            'calendar.ics.export',
            input ?? {},
          ),
        import: (input: CalendarIcsImportInput) =>
          invokeOperator<'calendar.ics.import', CalendarIcsImportInput, CalendarIcsImportResult>(
            'calendar.ics.import',
            input,
          ),
      },
    },
    approvals: {
      // Local ApprovalSnapshotResult/ApprovalRecord diverge from the generated contract
      // (open strings, optional audit — see the Approvals section comment) — explicit
      // overrides throughout this group.
      list: () => invokeOperator<'approvals.list', OperatorMethodInput<'approvals.list'>, ApprovalSnapshotResult>('approvals.list'),
      // selectedHunks: an index array into the pending approval's own
      // edit list. Omit it to approve the whole request. The daemon computes
      // modifiedArgs server-side — this call never carries a computed diff.
      // selectedHunks is not in OperatorMethodInputMap['approvals.approve'] yet — a
      // real, tested wire field the generated 0.38 map does not cover.
      approve: (approvalId: string, input?: ApprovalApproveInput) =>
        invokeOperator<'approvals.approve', { approvalId: string } & ApprovalApproveInput, ApprovalActionResult>(
          'approvals.approve',
          { approvalId, ...input },
        ),
      cancel: (approvalId: string) =>
        invokeOperator<'approvals.cancel', OperatorMethodInput<'approvals.cancel'>, ApprovalActionResult>('approvals.cancel', { approvalId }),
      claim: (approvalId: string) =>
        invokeOperator<'approvals.claim', OperatorMethodInput<'approvals.claim'>, ApprovalActionResult>('approvals.claim', { approvalId }),
      deny: (approvalId: string, note?: string) =>
        invokeOperator<'approvals.deny', OperatorMethodInput<'approvals.deny'>, ApprovalActionResult>(
          'approvals.deny',
          { approvalId, ...(note ? { note } : {}) },
        ),
    },
    // memory.records.* / memory.review-queue — table-routed via EXTRA_METHOD_ROUTES
    // (real REST bindings, see that table's comment); every I/O shape here is the
    // hand-authored local type above, cross-checked against the daemon's own schema
    // source rather than the (nonexistent, for these six ids) generated maps —
    // explicit TInput/TOutput overrides throughout, same pattern as Approvals/Tasks.
    memory: {
      search: (input?: MemorySearchInput) =>
        invokeOperator<'memory.records.search', MemorySearchInput, MemorySearchResult>(
          'memory.records.search',
          input ?? {},
        ),
      add: (input: MemoryAddInput) =>
        invokeOperator<'memory.records.add', MemoryAddInput, MemoryRecordEntityResult>('memory.records.add', input),
      get: (id: string) =>
        invokeOperator<'memory.records.get', { id: string }, MemoryRecordEntityResult>('memory.records.get', { id }),
      updateReview: (id: string, input: MemoryUpdateReviewInput) =>
        invokeOperator<'memory.records.update-review', { id: string } & MemoryUpdateReviewInput, MemoryRecordEntityResult>(
          'memory.records.update-review',
          { id, ...input },
        ),
      delete: (id: string) =>
        invokeOperator<'memory.records.delete', { id: string }, MemoryRecordDeleteResult>('memory.records.delete', { id }),
      reviewQueue: (input?: MemoryReviewQueueInput) =>
        invokeOperator<'memory.review-queue', MemoryReviewQueueInput, MemoryReviewQueueResult>(
          'memory.review-queue',
          input ?? {},
        ),
    },
    // fleet.*/checkpoints.*/sessions.search — generic-invoke-only (see
    // invokeGatewayMethod above); I/O shapes are the contract-bridge-types.ts bridge
    // (real ids, generic generated I/O today — see that module's header for the swap).
    fleet: {
      snapshot: () => invokeGatewayMethod<'fleet.snapshot', FleetSnapshotResult>('fleet.snapshot', {}),
      list: (input?: FleetListInput) => invokeGatewayMethod<'fleet.list', FleetListResult>('fleet.list', input ?? {}),
    },
    checkpoints: {
      list: (input?: CheckpointsListInput) => invokeGatewayMethod<'checkpoints.list', CheckpointsListResult>('checkpoints.list', input ?? {}),
      create: (input: CheckpointsCreateInput) => invokeGatewayMethod<'checkpoints.create', CheckpointsCreateResult>('checkpoints.create', input),
      diff: (input: CheckpointsDiffInput) => invokeGatewayMethod<'checkpoints.diff', CheckpointsDiffResult>('checkpoints.diff', input),
      restore: (input: CheckpointsRestoreInput) =>
        invokeGatewayMethod<'checkpoints.restore', CheckpointsRestoreResult>('checkpoints.restore', input),
    },
    sessions: {
      list: () => invokeOperator('sessions.list', {}),
      // get/steer/followUp/create/messages.*/inputs.* are native in the 0.38 browser SDK
      // (SHARED_BROWSER_ROUTES) — they resolve WITHOUT an EXTRA_METHOD_ROUTES row,
      // through invokeOperator's scopedSdk.operator.invoke fall-through. Routing them
      // through the same typed invokeOperator used everywhere else (rather than calling
      // scopedSdk.operator.invoke directly) means their input/output flow through the
      // REAL generated OperatorMethodInput/Output types with no `as never` cast at any
      // of these call sites — TypeScript rejects a wrong-shaped `input` here at compile
      // time (see goodvibes.test.ts's "wrong-typed steer input is a compile error" case).
      get: (sessionId: string) => invokeOperator('sessions.get', { sessionId }),
      steer: (sessionId: string, input: OperatorMethodInput<'sessions.steer'>) =>
        invokeOperator('sessions.steer', { sessionId, ...input }),
      followUp: (sessionId: string, input: OperatorMethodInput<'sessions.followUp'>) =>
        invokeOperator('sessions.followUp', { sessionId, ...input }),
      create: (input: OperatorMethodInput<'sessions.create'>) => invokeOperator('sessions.create', input),
      close: (sessionId: string) => invokeOperator('sessions.close', { sessionId }),
      reopen: (sessionId: string) => invokeOperator('sessions.reopen', { sessionId }),
      // delete (delete-means-delete): NOT in the installed 0.38 OperatorMethodId
      // union (unlike close/reopen above) — see the EXTRA_METHOD_ROUTES header comment.
      // Untyped call site, like models.* — SessionDeleteResult is this module's own
      // honest local shape (`{sessionId, deleted}`), cross-checked against the SDK
      // repo's method-catalog-control-core.ts 'sessions.delete' outputSchema at the time
      // of writing. Requires the session to already be closed (409 SESSION_ACTIVE
      // otherwise) — callers close first (see App.tsx / SessionsView.tsx call sites).
      // Callers MUST pair this with a capability check (operator.control.methodInfo) or
      // a proof-of-gone reconcile — never assume a 200 means the record is truly gone
      // on every daemon build.
      delete: (sessionId: string) => invokeOperator('sessions.delete', { sessionId }) as Promise<SessionDeleteResult>,
      // sessions.search (typed-client scaffold, first consumer of the search facade):
      // in the OperatorMethodId union but routeless (no browser/EXTRA_METHOD_ROUTES
      // entry) — generic-invoke-only, typed via the contract-bridge-types.ts bridge
      // until real I/O shapes land upstream.
      search: (input?: SessionsSearchInput) => invokeGatewayMethod<'sessions.search', SessionsSearchResult>('sessions.search', input ?? {}),
      messages: {
        create: (sessionId: string, input: OperatorMethodInput<'sessions.messages.create'>) =>
          invokeOperator('sessions.messages.create', { sessionId, ...input }),
        list: (sessionId: string) => invokeOperator('sessions.messages.list', { sessionId }),
      },
      inputs: {
        list: (sessionId: string) => invokeOperator('sessions.inputs.list', { sessionId }),
        cancel: (sessionId: string, inputId: string) => invokeOperator('sessions.inputs.cancel', { sessionId, inputId }),
      },
      // detach (WEBUI-FLEET-DEPTH): remove ONE participant (surfaceId) from a shared
      // session, WITHOUT closing or killing it — detach != close != kill. Idempotent:
      // detaching an already-detached surface, or detaching from a closed session, is a
      // no-op success (verified against the SDK's own sessions.detach description). Used
      // by FleetView's "detach this browser" action on a session-backed fleet node: stop
      // receiving live updates for a process you're done watching without touching the
      // process itself or any other surface attached to it (e.g. the TUI).
      detach: (sessionId: string, surfaceId: string) =>
        invokeOperator<'sessions.detach', SessionsDetachInput, SessionsDetachResult>('sessions.detach', { sessionId, surfaceId }),
    },
    // watchers.stop (WEBUI-FLEET-DEPTH): the one fleet-node kill action genuinely
    // backed by a real operator wire verb — see the EXTRA_METHOD_ROUTES comment above.
    // Only `stop` is exposed here; watchers.create/delete/update/run/start are out of
    // scope for the fleet depth this brief asks for (fleet is a live-process READER,
    // not a watcher-authoring surface).
    watchers: {
      stop: (watcherId: string) =>
        invokeOperator<'watchers.stop', { watcherId: string }, WatcherActionResult>('watchers.stop', { watcherId }),
    },
  },
  chat: {
    sessions: {
      ...scopedSdk.chat.sessions,
      // delete-means-delete: this call site itself is UNCHANGED — the route
      // (DELETE /api/companion/chat/sessions/{sessionId}) already resolves through
      // EXTRA_METHOD_ROUTES either way. What changes is the daemon behind it: an older
      // daemon soft-closes (`{sessionId, status:'closed'}`, file retained); an upgraded
      // one hard-removes (`{sessionId, deleted:true}`, file gone). The static return type
      // here still reflects the installed 0.38 OperatorMethodOutputMap entry
      // (`{sessionId, status}`) — the generated contract has not caught up to the
      // hard-delete work's real wire shape yet, so callers must NOT trust this call's
      // return value as proof the record is gone. App.tsx's delete flow never reads
      // this response's fields for that; it reconciles against a real re-fetch
      // (includeClosed:true) instead.
      delete: (sessionId: string) => invokeOperator('companion.chat.sessions.delete', { sessionId }),
      // close: a genuinely NEW, distinct soft-close verb for companion chat
      // (companion.chat.sessions.close), separate from delete — see the
      // EXTRA_METHOD_ROUTES header comment for its capability-availability caveat on an
      // older daemon. Companion delete now requires the session to already be closed
      // (409 SESSION_ACTIVE otherwise), so App.tsx's delete flow calls this first,
      // tolerating a "not available yet" failure (isMethodUnavailableError) rather than
      // treating it as fatal — an older daemon's delete route still works exactly as it
      // always did (soft-close-only), which the reconcile step then honestly reports.
      close: (sessionId: string) => invokeOperator('companion.chat.sessions.close', { sessionId }),
    },
    messages: {
      ...scopedSdk.chat.messages,
      // regenerate (companion.chat.messages.retry): re-run an assistant response
      // honestly. Omit messageId to regenerate the latest assistant reply. The prior
      // response is superseded (retained, flagged), never deleted, and a fresh turn
      // streams back over the same SSE channel. Untyped route (no generated I/O map) —
      // CompanionRegenerateResult is this module's hand-authored shape.
      retry: (sessionId: string, input?: { messageId?: string }) =>
        invokeOperator('companion.chat.messages.retry', {
          sessionId,
          ...(input?.messageId ? { messageId: input.messageId } : {}),
        }) as Promise<CompanionRegenerateResult>,
      // edit-and-branch (companion.chat.messages.edit): edit a user message and branch
      // the conversation from it. The original (and everything after) is superseded
      // (retained, flagged); a new user message carrying `revisionOf` is appended and a
      // fresh turn answers it. The daemon route reads the edited text from `content`.
      edit: (sessionId: string, messageId: string, input: CompanionEditInput) =>
        invokeOperator('companion.chat.messages.edit', {
          sessionId,
          messageId,
          content: input.content,
          ...(input.attachments?.length ? { attachments: input.attachments } : {}),
          ...(input.metadata ? { metadata: input.metadata } : {}),
        }) as Promise<CompanionEditResult>,
    },
    events: scopedSdk.chat.events,
  },
  artifacts: scopedSdk.artifacts,
  realtime: {
    viaSse: () => scopedSdk.realtime.viaSse(),
  },
  // Raw event stream escape hatch. The scoped viaSse() per-domain filter DROPS the
  // un-domained `session-update` wire event (browser-scoped.ts), so session liveness
  // must be consumed off the raw control-plane stream instead. Kept confined to
  // useSessionRealtime; the rest of the app uses the typed viaSse facade above.
  streams: {
    open: (
      pathOrUrl: string,
      handlers: RawStreamHandlers,
      options?: RawStreamOptions,
    ) => scopedSdk.streams.open(pathOrUrl, handlers, options),
  },
  knowledge: scopedSdk.knowledge,
};

export type RawStreamHandlers = Parameters<typeof scopedSdk.streams.open>[1];
export type RawStreamOptions = Parameters<typeof scopedSdk.streams.open>[2];

export { forSession };
export type GoodVibesClient = typeof sdk;
export type { OperatorMethodId, OperatorMethodInput, OperatorMethodOutput, OperatorTypedMethodId, RuntimeEventDomain };

export async function invokeMethod<TMethodId extends OperatorTypedMethodId>(
  methodId: TMethodId,
  input?: OperatorMethodInput<TMethodId>,
): Promise<OperatorMethodOutput<TMethodId>> {
  return sdk.operator.invoke(methodId, input);
}

export async function getCurrentAuth(): Promise<unknown> {
  // The daemon's control-plane/auth is a STATUS endpoint: it answers 200 even when
  // the presented token is invalid/expired, carrying the real verdict in the
  // `authenticated` boolean (authMode 'invalid'/'anonymous'). Verified against both
  // real daemons AND an isolated bootDaemon. The signed-in gate (App.tsx) and the
  // health signed-in axis (useDaemonHealth) both key off this call THROWING to detect
  // "signed out" — a resolved call is taken as signed-in. So a corrupt/expired token
  // used to leave the operator in the full shell while every data endpoint 401'd,
  // instead of the honest one-shot handoff to sign-in. Reject on `authenticated !==
  // true` with a 401/authentication error (NOT network/status-0, so it is treated as
  // unauthorized — sign-in front door — not as a daemon-unreachable outage).
  const snapshot = await sdk.auth.current();
  const record = asRecord(snapshot);
  if ('authenticated' in record && record.authenticated !== true) {
    throw Object.assign(new Error('Operator token rejected — the daemon reports the session is not authenticated.'), {
      status: 401,
      category: 'authentication',
      authMode: record.authMode,
    });
  }
  return snapshot;
}

/**
 * Synchronous best-effort check for a stored token, used ONLY to pick the optimistic
 * first paint (splash while a stored token is validated vs. the signed-out gate shown
 * immediately when there is no token). The async auth.current query remains
 * authoritative; this never asserts the token is valid, only that one is present.
 */
export function hasStoredTokenSync(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(WEBUI_TOKEN_STORE_KEY)?.trim();
    return Boolean(raw && raw !== 'null');
  } catch {
    return false;
  }
}

interface LoginResponse {
  authenticated: boolean;
  token: string;
  username: string;
  expiresAt: number;
}

function buildLoginUrl(): string {
  return `${GOODVIBES_BASE_URL.replace(/\/+$/, '')}/login`;
}

function isLoginResponse(value: unknown): value is LoginResponse {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.authenticated === true
    && typeof record.token === 'string'
    && typeof record.username === 'string'
    && typeof record.expiresAt === 'number';
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function login(username: string, password: string): Promise<unknown> {
  const url = buildLoginUrl();
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  const body = await readJson(response);
  if (!response.ok) {
    throw Object.assign(new Error(`Login failed: ${response.status} ${response.statusText}`.trim()), {
      status: response.status,
      url,
      method: 'POST',
      body,
      category: response.status === 401 ? 'authentication' : 'unknown',
      hint: response.status === 401 ? 'Check the username and password stored in local auth.' : undefined,
    });
  }

  if (!isLoginResponse(body)) {
    throw Object.assign(new Error('Login response did not include a browser session token'), {
      status: response.status,
      url,
      method: 'POST',
      body,
      category: 'contract',
    });
  }

  const result = body;
  await tokenStore.setTokenEntry(result.token, result.expiresAt);
  return {
    authenticated: result.authenticated,
    username: result.username,
    expiresAt: result.expiresAt,
  };
}

export async function setExplicitAuthToken(rawToken: string): Promise<unknown> {
  const token = rawToken.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('Token is required');
  await sdk.auth.setToken(token);
  try {
    return await sdk.auth.current();
  } catch (error) {
    await sdk.auth.clearToken();
    throw error;
  }
}

export async function clearStoredAuthToken(): Promise<void> {
  await sdk.auth.clearToken();
}

export function isRuntimeDomain(value: string): value is RuntimeEventDomain {
  return RUNTIME_DOMAINS.includes(value as RuntimeEventDomain);
}
