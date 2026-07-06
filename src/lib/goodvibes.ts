import {
  createBrowserKnowledgeSdk,
  forSession,
} from '@pellux/goodvibes-sdk/browser/knowledge';
import { createBrowserTokenStore } from '@pellux/goodvibes-sdk/auth';
import type {
  OperatorMethodId,
  OperatorMethodInput,
  OperatorMethodOutput,
  OperatorTypedMethodId,
  RuntimeEventDomain,
} from '@pellux/goodvibes-sdk/contracts';

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
 * companion.chat.sessions.delete) are the Wave-3 contract-coverage target; each pays
 * its way today because no browser route map covers it.
 */
const EXTRA_METHOD_ROUTES: Record<string, RouteDefinition | undefined> = {
  'approvals.approve': { method: 'POST', path: '/api/approvals/{approvalId}/approve' },
  'approvals.cancel': { method: 'POST', path: '/api/approvals/{approvalId}/cancel' },
  'approvals.claim': { method: 'POST', path: '/api/approvals/{approvalId}/claim' },
  'approvals.deny': { method: 'POST', path: '/api/approvals/{approvalId}/deny' },
  'approvals.list': { method: 'GET', path: '/api/approvals' },
  'companion.chat.sessions.delete': { method: 'DELETE', path: '/api/companion/chat/sessions/{sessionId}' },
  'config.set': { method: 'POST', path: '/config' },
  'local_auth.status': { method: 'GET', path: '/api/local-auth' },
  'models.current': { method: 'GET', path: '/api/models/current' },
  'models.list': { method: 'GET', path: '/api/models' },
  'models.select': { method: 'PATCH', path: '/api/models/current' },
  'sessions.close': { method: 'POST', path: '/api/sessions/{sessionId}/close' },
  'sessions.reopen': { method: 'POST', path: '/api/sessions/{sessionId}/reopen' },
  'tasks.cancel': { method: 'POST', path: '/api/tasks/{taskId}/cancel' },
  // tasks.create posts to the legacy `/task` path (no {taskId} placeholder — the
  // whole body is the task submission), predating the `/api/tasks` REST family.
  'tasks.create': { method: 'POST', path: '/task' },
  'tasks.list': { method: 'GET', path: '/api/tasks' },
  'tasks.retry': { method: 'POST', path: '/api/tasks/{taskId}/retry' },
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

async function invokeOperator(methodId: string, input?: unknown): Promise<unknown> {
  const route = EXTRA_METHOD_ROUTES[methodId];
  if (!route) return scopedSdk.operator.invoke(methodId as never, input as never);
  const { path, rest } = interpolateRoute(route, input);
  if (route.method === 'GET') return requestJson(path, { method: route.method, query: rest });
  if (route.method === 'DELETE' && !Object.keys(rest).length) return requestJson(path, { method: route.method });
  return requestJson(path, { method: route.method, body: rest });
}

/**
 * invokeGatewayMethod — direct call to the generic invoke-by-id endpoint
 * (POST /api/control-plane/methods/{methodId}/invoke), mirroring the SDK's
 * own `invokeVerb` test helper (test/w3-s2-fleet-checkpoints-search.test.ts).
 *
 * WHY THIS EXISTS (W3-W1): fleet.* and checkpoints.* (W3-S2) are registered
 * with `transport: ['ws']` and NO `http` route binding
 * (method-catalog-fleet.ts) — they are reachable ONLY through this generic
 * invoke mechanism, not through scopedSdk.operator.invoke (which resolves
 * against the fixed SHARED_BROWSER_ROUTES/KNOWLEDGE_BROWSER_ROUTES tables
 * baked into the browser SDK build and has no entries for these verbs) and
 * not through EXTRA_METHOD_ROUTES (built for REST-shaped path-param routes,
 * which these verbs don't have). Confirmed against the 0.39.0-dev SDK
 * overlay: @pellux/goodvibes-contracts (a separate workspace package the
 * overlay does not rebuild) still reports no fleet.x / checkpoints.x typed
 * methods, so this bypasses the typed OperatorTypedMethodId surface
 * entirely and posts the envelope `{ body }` the daemon's
 * invokeGatewayMethodCall expects, reusing requestJson for auth headers.
 */
async function invokeGatewayMethod<T = unknown>(methodId: string, body?: unknown): Promise<T> {
  return requestJson<T>(`/api/control-plane/methods/${methodId}/invoke`, {
    method: 'POST',
    body: { body: body ?? {} },
  });
}

// ─── Fleet (W3-S2 fleet.*) ──────────────────────────────────────────────────

export interface FleetProcessUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly reasoningTokens?: number;
  readonly llmCallCount: number;
  readonly turnCount: number;
  readonly toolCallCount: number;
}

export interface FleetProcessActivity {
  readonly kind: string;
  readonly text: string;
  readonly toolName?: string;
  readonly at: number;
}

export interface FleetProcessCapabilities {
  readonly interruptible: boolean;
  readonly killable: boolean;
  readonly pausable: boolean;
  readonly resumable: boolean;
  readonly steerable: boolean;
}

export interface FleetProcessNode {
  readonly id: string;
  readonly kind: string;
  readonly parentId?: string;
  readonly label: string;
  readonly task?: string;
  readonly state: string;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly elapsedMs: number;
  readonly usage?: FleetProcessUsage;
  readonly model?: string;
  readonly provider?: string;
  readonly costUsd?: number | null;
  readonly costState: string;
  readonly currentActivity?: FleetProcessActivity;
  readonly capabilities: FleetProcessCapabilities;
  readonly sessionRef?: { readonly sessionId?: string; readonly agentId?: string };
}

export interface FleetSnapshotResult {
  readonly capturedAt: number;
  readonly nodes: FleetProcessNode[];
  readonly truncated: boolean;
  readonly totalCount: number;
}

export interface FleetListInput {
  readonly kinds?: readonly string[];
  readonly states?: readonly string[];
  readonly limit?: number;
  readonly cursor?: string;
}

export interface FleetListResult {
  readonly items: FleetProcessNode[];
  readonly nextCursor?: string;
  readonly hasMore: boolean;
  readonly capturedAt: number;
}

// ─── Checkpoints (W3-S2 checkpoints.*) ──────────────────────────────────────

export interface WorkspaceCheckpoint {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly createdAt: number;
  readonly parentId: string | null;
  readonly turnId?: string;
  readonly agentId?: string;
  readonly retentionClass: string;
  readonly commit: string;
  readonly sizeBytes: number;
}

export interface CheckpointsListInput {
  readonly kind?: string;
  readonly since?: number;
  readonly limit?: number;
}

export interface CheckpointsListResult {
  readonly checkpoints: WorkspaceCheckpoint[];
}

export interface CheckpointsCreateInput {
  readonly kind: 'turn' | 'agent-run' | 'manual';
  readonly label?: string;
  readonly retentionClass?: string;
  readonly turnId?: string;
  readonly agentId?: string;
  readonly paths?: readonly string[];
}

export interface CheckpointsCreateResult {
  readonly checkpoint: WorkspaceCheckpoint | null;
  readonly noop: boolean;
}

export interface CheckpointsDiffInput {
  readonly a: string;
  readonly b?: string;
}

export interface CheckpointsDiffResult {
  readonly diff: {
    readonly from: string;
    readonly to: string;
    readonly files: readonly string[];
    readonly unifiedDiff: string;
    readonly stat: string;
  };
}

export interface CheckpointsRestoreInput {
  readonly id: string;
  readonly paths?: readonly string[];
  readonly safetyCheckpoint?: boolean;
}

export interface CheckpointsRestoreResult {
  readonly result: {
    readonly checkpointId: string;
    readonly safetyCheckpointId: string | null;
    readonly restoredFiles: readonly string[];
    readonly removedFiles: readonly string[];
  };
}

// ─── Approvals (approvals.*, W3-S3 per-hunk selection) ─────────────────────

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
 * Optional per-hunk selection for `approvals.approve` (W3-S3). Omitting
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

export interface RuntimeTaskSummary {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly status: string;
  readonly owner: string;
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

export interface TaskActionResult {
  readonly retried?: boolean;
  readonly task: { readonly id: string; readonly status: string; readonly title?: string };
}

export interface TaskCreateInput {
  readonly task: string;
  readonly model?: string;
  readonly tools?: readonly string[];
  readonly provider?: string;
  readonly title?: string;
}

export interface TaskCreateResult {
  readonly acknowledged: boolean;
  readonly mode?: string;
  readonly sessionId?: string | null;
  readonly agentId?: string | null;
  readonly status?: string;
  readonly task?: string;
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
    },
    accounts: {
      snapshot: () => scopedSdk.operator.invoke('accounts.snapshot', {}),
    },
    providers: {
      list: () => scopedSdk.operator.invoke('providers.list', {}),
      get: (providerId: string) => scopedSdk.operator.invoke('providers.get', { providerId }),
      usage: (providerId: string) => scopedSdk.operator.invoke('providers.usage.get', { providerId }),
    },
    models: {
      list: () => invokeOperator('models.list'),
      current: () => invokeOperator('models.current'),
      select: (registryKey: string) => invokeOperator('models.select', { registryKey }),
    },
    tasks: {
      list: () => invokeOperator('tasks.list') as Promise<TaskSnapshotResult>,
      create: (input: TaskCreateInput) => invokeOperator('tasks.create', input) as Promise<TaskCreateResult>,
      cancel: (taskId: string) => invokeOperator('tasks.cancel', { taskId }) as Promise<TaskActionResult>,
      retry: (taskId: string) => invokeOperator('tasks.retry', { taskId }) as Promise<TaskActionResult>,
    },
    approvals: {
      list: () => invokeOperator('approvals.list') as Promise<ApprovalSnapshotResult>,
      // selectedHunks (W3-S3): an index array into the pending approval's own
      // edit list. Omit it to approve the whole request. The daemon computes
      // modifiedArgs server-side — this call never carries a computed diff.
      approve: (approvalId: string, input?: ApprovalApproveInput) =>
        invokeOperator('approvals.approve', { approvalId, ...input }) as Promise<ApprovalActionResult>,
      cancel: (approvalId: string) => invokeOperator('approvals.cancel', { approvalId }) as Promise<ApprovalActionResult>,
      claim: (approvalId: string) => invokeOperator('approvals.claim', { approvalId }) as Promise<ApprovalActionResult>,
      deny: (approvalId: string, note?: string) =>
        invokeOperator('approvals.deny', { approvalId, ...(note ? { note } : {}) }) as Promise<ApprovalActionResult>,
    },
    // W3-S2 verbs — generic-invoke-only (see invokeGatewayMethod above).
    fleet: {
      snapshot: () => invokeGatewayMethod<FleetSnapshotResult>('fleet.snapshot', {}),
      list: (input?: FleetListInput) => invokeGatewayMethod<FleetListResult>('fleet.list', input ?? {}),
    },
    checkpoints: {
      list: (input?: CheckpointsListInput) => invokeGatewayMethod<CheckpointsListResult>('checkpoints.list', input ?? {}),
      create: (input: CheckpointsCreateInput) => invokeGatewayMethod<CheckpointsCreateResult>('checkpoints.create', input),
      diff: (input: CheckpointsDiffInput) => invokeGatewayMethod<CheckpointsDiffResult>('checkpoints.diff', input),
      restore: (input: CheckpointsRestoreInput) => invokeGatewayMethod<CheckpointsRestoreResult>('checkpoints.restore', input),
    },
    sessions: {
      list: () => scopedSdk.operator.invoke('sessions.list', {}),
      // get/steer/followUp are native in the 0.38 browser SDK (SHARED_BROWSER_ROUTES);
      // they resolve WITHOUT an EXTRA_METHOD_ROUTES row via scopedSdk.operator.invoke.
      get: (sessionId: string) => scopedSdk.operator.invoke('sessions.get', { sessionId }),
      steer: (sessionId: string, input: unknown) => scopedSdk.operator.invoke('sessions.steer', { sessionId, ...asRecord(input) } as never),
      followUp: (sessionId: string, input: unknown) => scopedSdk.operator.invoke('sessions.followUp', { sessionId, ...asRecord(input) } as never),
      create: (input: unknown) => scopedSdk.operator.invoke('sessions.create', input as never),
      close: (sessionId: string) => invokeOperator('sessions.close', { sessionId }),
      reopen: (sessionId: string) => invokeOperator('sessions.reopen', { sessionId }),
      messages: {
        create: (sessionId: string, input: unknown) => scopedSdk.operator.invoke('sessions.messages.create', { sessionId, ...asRecord(input) } as never),
        list: (sessionId: string) => scopedSdk.operator.invoke('sessions.messages.list', { sessionId }),
      },
      inputs: {
        list: (sessionId: string) => scopedSdk.operator.invoke('sessions.inputs.list', { sessionId }),
        cancel: (sessionId: string, inputId: string) => scopedSdk.operator.invoke('sessions.inputs.cancel', { sessionId, inputId }),
      },
    },
  },
  chat: {
    sessions: {
      ...scopedSdk.chat.sessions,
      delete: (sessionId: string) => invokeOperator('companion.chat.sessions.delete', { sessionId }),
    },
    messages: scopedSdk.chat.messages,
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
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- narrowing generic return type that TS cannot infer
  return sdk.operator.invoke(methodId, input as never) as Promise<OperatorMethodOutput<TMethodId>>;
}

export async function getCurrentAuth(): Promise<unknown> {
  return sdk.auth.current();
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
