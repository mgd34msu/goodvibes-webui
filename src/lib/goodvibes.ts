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
      list: () => invokeOperator('tasks.list'),
      cancel: (taskId: string) => invokeOperator('tasks.cancel', { taskId }),
      retry: (taskId: string) => invokeOperator('tasks.retry', { taskId }),
    },
    approvals: {
      list: () => invokeOperator('approvals.list'),
      approve: (approvalId: string) => invokeOperator('approvals.approve', { approvalId }),
      cancel: (approvalId: string) => invokeOperator('approvals.cancel', { approvalId }),
      claim: (approvalId: string) => invokeOperator('approvals.claim', { approvalId }),
      deny: (approvalId: string) => invokeOperator('approvals.deny', { approvalId }),
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
