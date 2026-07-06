/**
 * installMockDaemon — the hermetic seam for the Playwright harness.
 *
 * Intercepts every `/api/**` request in the browser and answers it from the in-memory
 * seed (support/seed.ts). NO real daemon is ever contacted — not 3421, not 4444, not
 * any port. The vite dev server the tests run against proxies `/api` to a dead
 * localhost target that is never reached, because these routes short-circuit the
 * request in-page before it leaves the browser.
 *
 * Streams (Accept: text/event-stream) are, by default, left hanging (a "connecting"
 * EventSource that never errors) so the live-updates layer reports neither connected
 * nor paused — a clean baseline. Pass `dropStreams: true` to instead close them
 * immediately, which drives the reconnect/paused honesty (used by the chat
 * degraded-state proof).
 */

import type { Page, Route } from '@playwright/test';
import {
  knowledgeMapResponse,
  messagesResponse,
  providersResponse,
  sessionRecord,
  SEED_SESSIONS,
  unionListResponse,
  type SeedSession,
} from './seed';

export interface MockDaemonOptions {
  /** Seed a stored token so the app boots signed-in. Default true. */
  signedIn?: boolean;
  /** When true, close SSE streams immediately (drives reconnect/paused states). */
  dropStreams?: boolean;
  /** When false, the sessions.delete capability probe 404s (Delete unavailable). */
  deleteAvailable?: boolean;
}

export interface MockDaemon {
  /** Every steer POST captured, in order: { sessionId, body }. */
  steerRequests: { sessionId: string; body: unknown }[];
  /** Every follow-up POST captured. */
  followUpRequests: { sessionId: string; body: unknown }[];
}

const TOKEN_KEY = 'goodvibes.webui.token';

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });
}

/**
 * control.methods.get's 200 shape (the daemon's real gateway-method descriptor,
 * `{ method: {...} }`) — a hermetic stand-in, not a real registry lookup. Exported so
 * assert-contract-shape.test.ts can bind it to the operator contract without a Page.
 */
export function methodInfoResponse(methodId: string) {
  return {
    method: {
      id: methodId,
      title: methodId,
      description: 'Hermetic e2e mock method descriptor — not a real gateway registry entry.',
      category: methodId.split('.')[0] ?? 'misc',
      source: 'builtin',
      access: 'authenticated',
      transport: ['http'],
      scopes: [],
    },
  };
}

/**
 * sessions.steer / sessions.followUp share this output envelope on the real contract
 * ({ session, message, input, mode, agentId }, all required) — a shape wholly
 * different from what this mock used to invent ({ delivered, inputId }). The app
 * (SteerComposer) never reads the resolved body (it only reacts to resolve vs.
 * reject), so this reshape is behavior-neutral for every existing spec while closing
 * the gap a contract change here would otherwise sail through unnoticed.
 * Exported so assert-contract-shape.test.ts can bind it without a Page.
 */
export function dispatchOutcome(session: SeedSession | undefined, intent: 'steer' | 'follow-up', body: string, inputId: string) {
  const now = Date.now();
  const canSteer = Boolean(session?.activeAgentId);
  const mode = intent === 'steer'
    ? (canSteer ? 'continued-live' : 'rejected')
    : 'queued-follow-up';
  return {
    session: session ? sessionRecord(session) : null,
    message: {
      id: `${inputId}-msg`,
      sessionId: session?.id ?? 'unknown',
      role: 'user' as const,
      body,
      createdAt: now,
      metadata: {},
    },
    input: {
      id: inputId,
      sessionId: session?.id ?? 'unknown',
      intent,
      state: intent === 'steer' ? 'delivered' : 'queued',
      correlationId: inputId,
      body,
      createdAt: now,
      updatedAt: now,
      metadata: {},
    },
    mode,
    agentId: session?.activeAgentId ?? null,
  };
}

export async function installMockDaemon(page: Page, options: MockDaemonOptions = {}): Promise<MockDaemon> {
  const { signedIn = true, dropStreams = false, deleteAvailable = true } = options;
  const daemon: MockDaemon = { steerRequests: [], followUpRequests: [] };

  if (signedIn) {
    await page.addInitScript(
      ([key, token]) => {
        try {
          window.localStorage.setItem(key, token);
        } catch {
          /* ignore */
        }
      },
      [TOKEN_KEY, 'e2e-operator-token'] as const,
    );
  }

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname;
    const accept = request.headers()['accept'] ?? '';

    // Streams: an EventSource/fetch stream (text/event-stream).
    if (accept.includes('text/event-stream') || path.includes('/events')) {
      if (dropStreams) {
        // Immediately-closed stream → the client sees a terminated feed and enters
        // the reconnect/paused honesty path.
        return route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: ':closed\n\n',
        });
      }
      // Leave it pending: a stream that never opens and never errors — the clean
      // baseline (neither connected nor paused).
      return;
    }

    // ── Auth / health ──────────────────────────────────────────────────────
    if (path === '/api/control-plane/auth') {
      if (!signedIn) return json(route, { error: 'unauthorized' }, 401);
      return json(route, { authenticated: true, username: 'operator', identity: { subject: 'operator' } });
    }
    if (path === '/api/local-auth') {
      return json(route, { ok: true, mode: 'local', authenticated: true });
    }

    // ── Capability probe: sessions.delete (GET /api/control-plane/methods/{id}) ──
    if (method === 'GET' && /\/api\/control-plane\/methods\/[^/]+$/.test(path)) {
      const methodId = decodeURIComponent(path.split('/').pop() ?? '');
      if (methodId === 'sessions.delete' && !deleteAvailable) {
        return json(route, { error: 'Unknown gateway method' }, 404);
      }
      return json(route, methodInfoResponse(methodId));
    }

    // ── Sessions union ─────────────────────────────────────────────────────
    if (method === 'GET' && path === '/api/sessions') {
      return json(route, unionListResponse());
    }
    const messagesMatch = path.match(/^\/api\/sessions\/([^/]+)\/messages$/);
    if (method === 'GET' && messagesMatch) {
      return json(route, messagesResponse(decodeURIComponent(messagesMatch[1])));
    }
    const steerMatch = path.match(/^\/api\/sessions\/([^/]+)\/steer$/);
    if (method === 'POST' && steerMatch) {
      const sessionId = decodeURIComponent(steerMatch[1]);
      const requestBody = request.postDataJSON?.() ?? request.postData();
      daemon.steerRequests.push({ sessionId, body: requestBody });
      const session = SEED_SESSIONS.find((s) => s.id === sessionId);
      const dispatchedBody = typeof requestBody === 'object' && requestBody !== null && 'body' in requestBody
        ? String((requestBody as { body?: unknown }).body ?? '')
        : '';
      return json(route, dispatchOutcome(session, 'steer', dispatchedBody, `in-${daemon.steerRequests.length}`));
    }
    const followUpMatch = path.match(/^\/api\/sessions\/([^/]+)\/follow-up$/);
    if (method === 'POST' && followUpMatch) {
      const sessionId = decodeURIComponent(followUpMatch[1]);
      const requestBody = request.postDataJSON?.() ?? request.postData();
      daemon.followUpRequests.push({ sessionId, body: requestBody });
      const session = SEED_SESSIONS.find((s) => s.id === sessionId);
      const dispatchedBody = typeof requestBody === 'object' && requestBody !== null && 'body' in requestBody
        ? String((requestBody as { body?: unknown }).body ?? '')
        : '';
      return json(route, dispatchOutcome(session, 'follow-up', dispatchedBody, `fu-${daemon.followUpRequests.length}`));
    }
    const sessionGetMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
    if (method === 'GET' && sessionGetMatch) {
      const id = decodeURIComponent(sessionGetMatch[1]);
      return json(route, messagesResponse(id));
    }

    // ── Companion chat sessions (carry the sidebar per-row delete control) ──
    if (method === 'GET' && path === '/api/companion/chat/sessions') {
      return json(route, {
        sessions: [
          { id: 'chat-1', sessionId: 'chat-1', title: 'Phone chat', status: 'active' },
          { id: 'chat-2', sessionId: 'chat-2', title: 'Away-from-desk notes', status: 'active' },
        ],
      });
    }
    if (path.startsWith('/api/companion/chat/sessions/')) {
      // messages / close / delete / detail — an honest empty success.
      return json(route, { messages: [], deleted: method === 'DELETE' });
    }

    // ── Providers ──────────────────────────────────────────────────────────
    // providers.get(id) → the single matching provider (wire-true), so the detail +
    // auth-routes panels render that provider's real routes/freshness.
    const providerGetMatch = path.match(/^\/api\/providers\/([^/]+)$/);
    if (method === 'GET' && providerGetMatch) {
      const id = decodeURIComponent(providerGetMatch[1]);
      const found = providersResponse().providers.find((p) => p.providerId === id);
      return json(route, found ?? {});
    }
    if (method === 'GET' && path.startsWith('/api/providers')) {
      return json(route, providersResponse());
    }

    // ── Knowledge map / status ─────────────────────────────────────────────
    if (path.includes('/knowledge') || path.includes('knowledge')) {
      return json(route, knowledgeMapResponse());
    }

    // ── Generic control-plane invoke (POST .../methods/{id}/invoke) ─────────
    const invokeMatch = path.match(/^\/api\/control-plane\/methods\/([^/]+)\/invoke$/);
    if (method === 'POST' && invokeMatch) {
      const methodId = decodeURIComponent(invokeMatch[1]);
      if (methodId === 'control.status') return json(route, { ok: true, status: 'running' });
      if (methodId.includes('knowledge')) return json(route, knowledgeMapResponse());
      if (methodId === 'sessions.search') return json(route, unionListResponse());
      return json(route, {});
    }

    // ── Fallback: an honest empty success for any un-modelled surface. Views
    //    render their empty/degraded states rather than hanging. ─────────────
    if (method === 'GET') return json(route, {});
    return json(route, {});
  });

  return daemon;
}
