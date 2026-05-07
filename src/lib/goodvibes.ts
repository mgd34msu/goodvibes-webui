import {
  createBrowserGoodVibesSdk,
  forSession,
} from '@pellux/goodvibes-sdk/browser';
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
export const sdk = createBrowserGoodVibesSdk({
  baseUrl: GOODVIBES_BASE_URL,
  tokenStore,
});

export { forSession };
export type GoodVibesClient = typeof sdk;
export type { OperatorMethodId, OperatorMethodInput, OperatorMethodOutput, OperatorTypedMethodId, RuntimeEventDomain };

export async function invokeMethod<TMethodId extends OperatorTypedMethodId>(
  methodId: TMethodId,
  input?: OperatorMethodInput<TMethodId>,
): Promise<OperatorMethodOutput<TMethodId>> {
  return sdk.operator.invoke(methodId, input as never);
}

export async function getCurrentAuth(): Promise<unknown> {
  return sdk.auth.current();
}

export async function login(username: string, password: string): Promise<unknown> {
  const credentialSdk = createBrowserGoodVibesSdk({
    baseUrl: GOODVIBES_BASE_URL,
    authToken: null,
    autoRefresh: { autoRefresh: false },
  });
  const result = await credentialSdk.auth.login({ username, password }, { persistToken: false });
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
  return [
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
  ].includes(value);
}
