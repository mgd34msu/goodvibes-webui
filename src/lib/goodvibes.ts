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

type HttpMethod = 'GET' | 'POST' | 'DELETE';
type JsonRecord = Record<string, unknown>;
type RealtimeHandler = (event: unknown) => void;
type Unsubscribe = () => void;

interface RouteDefinition {
  method: HttpMethod;
  path: string;
}

interface RuntimeDomainClient {
  onEnvelope(eventName: string, handler: RealtimeHandler): Unsubscribe;
}

interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: JsonRecord;
  authenticated?: boolean;
}

const METHOD_ROUTES: Record<string, RouteDefinition> = {
  'accounts.snapshot': { method: 'GET', path: '/api/accounts' },
  'approvals.approve': { method: 'POST', path: '/api/approvals/{approvalId}/approve' },
  'approvals.cancel': { method: 'POST', path: '/api/approvals/{approvalId}/cancel' },
  'approvals.claim': { method: 'POST', path: '/api/approvals/{approvalId}/claim' },
  'approvals.deny': { method: 'POST', path: '/api/approvals/{approvalId}/deny' },
  'approvals.list': { method: 'GET', path: '/api/approvals' },
  'config.set': { method: 'POST', path: '/config' },
  'control.snapshot': { method: 'GET', path: '/api/control-plane' },
  'control.status': { method: 'GET', path: '/status' },
  'knowledge.ask': { method: 'POST', path: '/api/knowledge/ask' },
  'knowledge.ingest.url': { method: 'POST', path: '/api/knowledge/ingest/url' },
  'knowledge.issues.list': { method: 'GET', path: '/api/knowledge/issues' },
  'knowledge.item.get': { method: 'GET', path: '/api/knowledge/items/{id}' },
  'knowledge.map': { method: 'GET', path: '/api/knowledge/map' },
  'knowledge.nodes.list': { method: 'GET', path: '/api/knowledge/nodes' },
  'knowledge.projection.materialize': { method: 'POST', path: '/api/knowledge/projections/materialize' },
  'knowledge.projection.render': { method: 'POST', path: '/api/knowledge/projections/render' },
  'knowledge.projections.list': { method: 'GET', path: '/api/knowledge/projections' },
  'knowledge.refinement.tasks.list': { method: 'GET', path: '/api/knowledge/refinement/tasks' },
  'knowledge.search': { method: 'POST', path: '/api/knowledge/search' },
  'knowledge.sources.list': { method: 'GET', path: '/api/knowledge/sources' },
  'knowledge.status': { method: 'GET', path: '/api/knowledge/status' },
  'local_auth.status': { method: 'GET', path: '/api/local-auth' },
  'providers.get': { method: 'GET', path: '/api/providers/{providerId}' },
  'providers.list': { method: 'GET', path: '/api/providers' },
  'providers.usage.get': { method: 'GET', path: '/api/providers/{providerId}/usage' },
  'sessions.close': { method: 'POST', path: '/api/sessions/{sessionId}/close' },
  'sessions.create': { method: 'POST', path: '/api/sessions' },
  'sessions.followUp': { method: 'POST', path: '/api/sessions/{sessionId}/follow-up' },
  'sessions.inputs.cancel': { method: 'POST', path: '/api/sessions/{sessionId}/inputs/{inputId}/cancel' },
  'sessions.list': { method: 'GET', path: '/api/sessions' },
  'sessions.messages.list': { method: 'GET', path: '/api/sessions/{sessionId}/messages' },
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

function firstString(value: unknown, keys: string[]): string {
  const record = asRecord(value);
  for (const key of keys) {
    const item = record[key];
    if (typeof item === 'string' && item.trim()) return item;
    if (typeof item === 'number') return String(item);
  }
  return '';
}

function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const part of path) current = asRecord(current)[part];
  return current;
}

function buildUrl(path: string, query?: JsonRecord): string {
  const url = new URL(path, `${GOODVIBES_BASE_URL.replace(/\/+$/, '')}/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null && item !== '') url.searchParams.append(key, String(item));
      }
      continue;
    }
    if (typeof value === 'object') {
      url.searchParams.set(key, JSON.stringify(value));
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function authHeaders(): Promise<HeadersInit> {
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
    return encodeURIComponent(String(value));
  });
  const rest = Object.fromEntries(Object.entries(record).filter(([key, value]) => !consumed.has(key) && value !== undefined));
  return { path, rest };
}

async function invokeOperator(methodId: string, input?: unknown): Promise<unknown> {
  const route = METHOD_ROUTES[methodId];
  if (!route) throw new Error(`Operator method is not wired in WebUI: ${methodId}`);
  const { path, rest } = interpolateRoute(route, input);
  if (route.method === 'GET') return requestJson(path, { method: route.method, query: rest });
  return requestJson(path, { method: route.method, body: rest });
}

function parseSseMessage(raw: string): { eventName: string; value: unknown } | null {
  let eventName = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  const dataText = dataLines.join('\n').trim();
  if (!dataText) return null;
  let value: unknown = dataText;
  try {
    value = JSON.parse(dataText);
  } catch {
    value = { type: eventName, payload: dataText };
  }
  return { eventName, value };
}

function eventType(eventName: string, value: unknown): string {
  return firstString(value, ['type', 'event', 'eventName', 'name'])
    || firstString(readPath(value, ['envelope']), ['type', 'event', 'eventName', 'name'])
    || eventName;
}

async function streamDomainEvents(domain: RuntimeEventDomain, eventName: string, handler: RealtimeHandler, signal: AbortSignal) {
  const response = await fetch(buildUrl('/api/control-plane/events', { domains: domain }), {
    headers: await authHeaders(),
    credentials: 'include',
    signal,
  });
  if (!response.ok) throw new Error(`SSE ${domain} failed: ${response.status} ${response.statusText}`.trim());
  if (!response.body) throw new Error(`SSE ${domain} did not return a readable stream`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const parsed = parseSseMessage(part);
      if (parsed && eventType(parsed.eventName, parsed.value) === eventName) handler(parsed.value);
    }
  }
}

function createDomainEvents(domain: RuntimeEventDomain): RuntimeDomainClient {
  return {
    onEnvelope(eventName, handler) {
      const controller = new AbortController();
      void streamDomainEvents(domain, eventName, handler, controller.signal).catch((error) => {
        if (!controller.signal.aborted) console.warn(error);
      });
      return () => controller.abort();
    },
  };
}

function createRealtimeEvents(): Record<string, RuntimeDomainClient> {
  const events: Record<string, RuntimeDomainClient> = {};
  for (const domain of RUNTIME_DOMAINS) events[domain] = createDomainEvents(domain);
  events.controlPlane = events['control-plane'];
  return events;
}

function eventSessionId(event: unknown): string {
  return firstString(event, ['sessionId'])
    || firstString(readPath(event, ['payload']), ['sessionId'])
    || firstString(readPath(event, ['payload', 'session']), ['id', 'sessionId'])
    || firstString(readPath(event, ['payload', 'turn']), ['sessionId'])
    || firstString(readPath(event, ['data']), ['sessionId']);
}

export function forSession(events: Record<string, RuntimeDomainClient>, sessionId: string): Record<string, RuntimeDomainClient> {
  return {
    turn: {
      onEnvelope(eventName, handler) {
        return events.turn.onEnvelope(eventName, (event) => {
          const id = eventSessionId(event);
          if (!id || id === sessionId) handler(event);
        });
      },
    },
  };
}

export const sdk = {
  auth: {
    current: () => requestJson('/api/control-plane/auth'),
    getToken: () => tokenStore.getToken(),
    setToken: (token: string | null) => tokenStore.setToken(token),
    clearToken: () => tokenStore.clearToken(),
  },
  operator: {
    invoke: invokeOperator,
    control: {
      status: () => invokeOperator('control.status'),
      snapshot: () => invokeOperator('control.snapshot'),
    },
    accounts: {
      snapshot: () => invokeOperator('accounts.snapshot'),
    },
    providers: {
      list: () => invokeOperator('providers.list'),
      get: (providerId: string) => invokeOperator('providers.get', { providerId }),
      usage: (providerId: string) => invokeOperator('providers.usage.get', { providerId }),
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
      list: () => invokeOperator('sessions.list'),
      create: (input: unknown) => invokeOperator('sessions.create', input),
      close: (sessionId: string) => invokeOperator('sessions.close', { sessionId }),
      reopen: (sessionId: string) => invokeOperator('sessions.reopen', { sessionId }),
      followUp: (input: unknown) => invokeOperator('sessions.followUp', input),
      messages: {
        list: (sessionId: string) => invokeOperator('sessions.messages.list', { sessionId }),
      },
      inputs: {
        cancel: (sessionId: string, inputId: string) => invokeOperator('sessions.inputs.cancel', { sessionId, inputId }),
      },
    },
  },
  realtime: {
    viaSse: createRealtimeEvents,
  },
};

export type GoodVibesClient = typeof sdk;
export type { OperatorMethodId, OperatorMethodInput, OperatorMethodOutput, OperatorTypedMethodId, RuntimeEventDomain };

export async function invokeMethod<TMethodId extends OperatorTypedMethodId>(
  methodId: TMethodId,
  input?: OperatorMethodInput<TMethodId>,
): Promise<OperatorMethodOutput<TMethodId>> {
  return sdk.operator.invoke(methodId, input as never) as Promise<OperatorMethodOutput<TMethodId>>;
}

export async function getCurrentAuth(): Promise<unknown> {
  return sdk.auth.current();
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
