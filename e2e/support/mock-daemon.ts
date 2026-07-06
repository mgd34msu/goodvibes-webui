/**
 * installMockDaemon — the hermetic seam for the Playwright harness (W5-M).
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
 * immediately, which drives the W5-W1 reconnect/paused honesty (used by the chat
 * degraded-state proof).
 */

import type { Page, Route } from '@playwright/test';
import {
  knowledgeMapResponse,
  messagesResponse,
  providersResponse,
  unionListResponse,
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
        // the reconnect/paused honesty path (W5-W1).
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
      return json(route, { id: methodId, available: true });
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
      daemon.steerRequests.push({
        sessionId: decodeURIComponent(steerMatch[1]),
        body: request.postDataJSON?.() ?? request.postData(),
      });
      return json(route, { delivered: true, inputId: `in-${daemon.steerRequests.length}` });
    }
    const followUpMatch = path.match(/^\/api\/sessions\/([^/]+)\/follow-up$/);
    if (method === 'POST' && followUpMatch) {
      daemon.followUpRequests.push({
        sessionId: decodeURIComponent(followUpMatch[1]),
        body: request.postDataJSON?.() ?? request.postData(),
      });
      return json(route, { queued: true, inputId: `fu-${daemon.followUpRequests.length}` });
    }
    const sessionGetMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
    if (method === 'GET' && sessionGetMatch) {
      const id = decodeURIComponent(sessionGetMatch[1]);
      return json(route, { id, ...messagesResponse(id) });
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
