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
  FLEET_SNAPSHOT,
  knowledgeMapResponse,
  memoryRecordWire,
  messagesResponse,
  PENDING_APPROVAL,
  providersResponse,
  sessionRecord,
  SEED_MEMORY_RECORDS,
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
  /**
   * GET /config/credentials behavior — the admin-scoped credential-status
   * read (credentials.get). 'available' (default) answers the honest
   * configured/usable list; 'store-unavailable' answers the daemon's real
   * 503 CREDENTIAL_STORE_UNAVAILABLE shape; 'admin-required' answers the
   * real 403 admin-scope refusal shape (control-plane.ts requireAdmin).
   */
  credentials?: 'available' | 'store-unavailable' | 'admin-required';
  /** When false, every /api/memory/* route 404s with the honest
   * `{ code: 'METHOD_NOT_FOUND' }` shape — the "this daemon does not serve memory"
   * degrade MemoryView renders. Default true. */
  memoryAvailable?: boolean;
  /** When true, a semantic memory.records.search request falls back to a literal scan
   * with a stated `indexUnavailableReason` — the honest degraded-search proof.
   * Default false (a semantic request succeeds as semantic). */
  memoryIndexUnavailable?: boolean;
}

export interface MockDaemon {
  /** Every steer POST captured, in order: { sessionId, body }. */
  steerRequests: { sessionId: string; body: unknown }[];
  /** Every follow-up POST captured. */
  followUpRequests: { sessionId: string; body: unknown }[];
  /** Every sessions.detach POST captured: { sessionId, surfaceId }. */
  detachRequests: { sessionId: string; surfaceId: string }[];
  /** Every watchers.stop POST captured, by watcherId. */
  watcherStopRequests: string[];
  /** Every approvals.{approve,deny,claim,cancel} POST captured, in order. */
  approvalActions: { approvalId: string; action: 'approve' | 'deny' | 'claim' | 'cancel'; body: unknown }[];
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
  const {
    signedIn = true,
    dropStreams = false,
    deleteAvailable = true,
    credentials = 'available',
    memoryAvailable = true,
    memoryIndexUnavailable = false,
  } = options;
  const daemon: MockDaemon = {
    steerRequests: [],
    followUpRequests: [],
    detachRequests: [],
    watcherStopRequests: [],
    approvalActions: [],
  };
  // Mutable so approve/deny/claim/cancel genuinely change what a subsequent
  // approvals.list() sees (WEBUI-FLEET-DEPTH) — a fresh copy per installMockDaemon
  // call so tests never leak state into each other.
  const approvals = [{ ...PENDING_APPROVAL }];

  // In-memory canonical store for this test only — a fresh copy of the seed per
  // installMockDaemon call, mutated by add/delete/update-review exactly like the real
  // daemon-owned single-writer store (never a second copy diverging from what the UI
  // reads back).
  let memoryRecords = SEED_MEMORY_RECORDS.map(memoryRecordWire);
  let memoryIdCounter = 0;

  function methodNotFound(route: Route) {
    return json(route, { error: 'Unknown gateway method', code: 'METHOD_NOT_FOUND' }, 404);
  }

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

  // credentials.get resolves to GET /config/credentials — note the missing
  // `/api` segment (EXTRA_METHOD_ROUTES in src/lib/goodvibes.ts, matching
  // config.set's `/config`), so it needs its own route registration; the
  // `**/api/**` glob below never matches this path.
  await page.route('**/config/credentials', async (route) => {
    if (credentials === 'admin-required') {
      return json(route, { error: 'Admin role required' }, 403);
    }
    if (credentials === 'store-unavailable') {
      return json(route, { error: 'Shared credential store unavailable', code: 'CREDENTIAL_STORE_UNAVAILABLE' }, 503);
    }
    return json(route, {
      available: true,
      credentials: [
        { key: 'ANTHROPIC_API_KEY', configured: true, usable: true, source: 'env', secure: true },
        { key: 'OPENAI_API_KEY', configured: true, usable: true, source: 'env', secure: true },
        { key: 'GOOGLE_API_KEY', configured: true, usable: false, source: 'env-ref', secure: false },
      ],
    });
  });

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
    // sessions.detach (WEBUI-FLEET-DEPTH) — remove one participant surfaceId from a
    // session WITHOUT closing/killing it. Idempotent success regardless of whether the
    // surface was actually attached, matching the real verb's own idempotency contract.
    const detachMatch = path.match(/^\/api\/sessions\/([^/]+)\/detach$/);
    if (method === 'POST' && detachMatch) {
      const sessionId = decodeURIComponent(detachMatch[1]);
      const requestBody = (request.postDataJSON?.() ?? {}) as { surfaceId?: string };
      daemon.detachRequests.push({ sessionId, surfaceId: requestBody.surfaceId ?? '' });
      const session = SEED_SESSIONS.find((s) => s.id === sessionId);
      return json(route, { session: session ? sessionRecord(session) : { id: sessionId } });
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

    // ── Memory (memory.records.* / memory.review-queue, SDK 1.1.0) ─────────
    // Exact-path routes checked BEFORE the /{id} regexes below, since
    // '/api/memory/records/search' would otherwise itself match `records/([^/]+)`
    // with "search" read as an id.
    if (path === '/api/memory/records/search' && method === 'POST') {
      if (!memoryAvailable) return methodNotFound(route);
      const body = (request.postDataJSON?.() ?? {}) as Record<string, unknown>;
      let records = memoryRecords.slice();
      if (typeof body.cls === 'string') records = records.filter((r) => r.cls === body.cls);
      if (typeof body.scope === 'string') records = records.filter((r) => r.scope === body.scope);
      if (Array.isArray(body.tags) && body.tags.length) {
        const tags = body.tags as string[];
        records = records.filter((r) => tags.every((tag) => r.tags.includes(tag)));
      }
      if (typeof body.query === 'string' && body.query.trim()) {
        const q = body.query.trim().toLowerCase();
        records = records.filter((r) => r.summary.toLowerCase().includes(q) || (r.detail ?? '').toLowerCase().includes(q));
      }
      const requestedSemantic = body.semantic === true;
      const indexUnavailableReason = requestedSemantic && memoryIndexUnavailable
        ? 'Semantic index unavailable: sqlite-vec extension failed to load — falling back to a literal scan'
        : null;
      const mode: 'literal' | 'semantic' = requestedSemantic && !indexUnavailableReason ? 'semantic' : 'literal';
      const recall = body.recall === true;
      const totalBeforeRecallFilter = records.length;
      let excludedFlaggedCount = 0;
      let excludedBelowFloorCount = 0;
      if (recall) {
        const kept: typeof records = [];
        for (const record of records) {
          if (record.reviewState === 'stale' || record.reviewState === 'contradicted') {
            excludedFlaggedCount += 1;
            continue;
          }
          if (record.confidence < 60) {
            excludedBelowFloorCount += 1;
            continue;
          }
          kept.push(record);
        }
        records = kept;
      }
      return json(route, {
        records,
        mode,
        requestedSemantic,
        indexUnavailableReason,
        caveat: null,
        recallFiltered: recall,
        excludedFlaggedCount,
        excludedBelowFloorCount,
        totalBeforeRecallFilter,
      });
    }
    if (path === '/api/memory/records' && method === 'POST') {
      if (!memoryAvailable) return methodNotFound(route);
      const body = (request.postDataJSON?.() ?? {}) as Record<string, unknown>;
      memoryIdCounter += 1;
      const now = Date.now();
      const record = {
        id: `mem-added-${memoryIdCounter}`,
        scope: typeof body.scope === 'string' ? body.scope : 'project',
        cls: body.cls,
        summary: body.summary,
        ...(typeof body.detail === 'string' && body.detail ? { detail: body.detail } : {}),
        tags: Array.isArray(body.tags) ? body.tags : [],
        provenance: Array.isArray(body.provenance) ? body.provenance : [],
        reviewState: 'fresh',
        confidence: 60,
        createdAt: now,
        updatedAt: now,
      };
      memoryRecords = [record, ...memoryRecords];
      return json(route, { record });
    }
    if (path === '/api/memory/review-queue' && method === 'GET') {
      if (!memoryAvailable) return methodNotFound(route);
      return json(route, { records: memoryRecords.filter((r) => r.confidence < 60 || r.reviewState === 'fresh') });
    }
    const memoryReviewMatch = path.match(/^\/api\/memory\/records\/([^/]+)\/review$/);
    if (method === 'POST' && memoryReviewMatch) {
      if (!memoryAvailable) return methodNotFound(route);
      const id = decodeURIComponent(memoryReviewMatch[1]);
      const body = (request.postDataJSON?.() ?? {}) as Record<string, unknown>;
      const index = memoryRecords.findIndex((r) => r.id === id);
      if (index === -1) return json(route, { error: 'Not found' }, 404);
      const now = Date.now();
      memoryRecords[index] = {
        ...memoryRecords[index],
        ...(typeof body.state === 'string' ? { reviewState: body.state } : {}),
        ...(typeof body.confidence === 'number' ? { confidence: body.confidence } : {}),
        ...(typeof body.reviewedBy === 'string' ? { reviewedBy: body.reviewedBy } : {}),
        ...(typeof body.staleReason === 'string' ? { staleReason: body.staleReason } : {}),
        reviewedAt: now,
        updatedAt: now,
      };
      return json(route, { record: memoryRecords[index] });
    }
    const memoryRecordMatch = path.match(/^\/api\/memory\/records\/([^/]+)$/);
    if (method === 'GET' && memoryRecordMatch) {
      if (!memoryAvailable) return methodNotFound(route);
      const id = decodeURIComponent(memoryRecordMatch[1]);
      const found = memoryRecords.find((r) => r.id === id);
      if (!found) return json(route, { error: 'Not found' }, 404);
      return json(route, { record: found });
    }
    if (method === 'DELETE' && memoryRecordMatch) {
      if (!memoryAvailable) return methodNotFound(route);
      const id = decodeURIComponent(memoryRecordMatch[1]);
      const before = memoryRecords.length;
      memoryRecords = memoryRecords.filter((r) => r.id !== id);
      // Delete-means-delete: an honest boolean, never a 200 pretending a phantom row
      // was removed.
      return json(route, { id, deleted: memoryRecords.length < before });
    }

    // ── Knowledge map / status ─────────────────────────────────────────────
    if (path.includes('/knowledge') || path.includes('knowledge')) {
      return json(route, knowledgeMapResponse());
    }

    // ── Watchers (WEBUI-FLEET-DEPTH — the one fleet-node kind with a real stop verb) ──
    const watcherStopMatch = path.match(/^\/api\/watchers\/([^/]+)\/stop$/);
    if (method === 'POST' && watcherStopMatch) {
      const watcherId = decodeURIComponent(watcherStopMatch[1]);
      daemon.watcherStopRequests.push(watcherId);
      return json(route, { id: watcherId, kind: 'watcher', label: 'Docs watcher', state: 'killed' });
    }

    // ── Approvals (WEBUI-FLEET-DEPTH — approve/deny/claim/cancel, "approve from the
    //    tree" AND the standalone Approvals view share this same mutable list). ──
    if (method === 'GET' && path === '/api/approvals') {
      const pending = approvals.filter((a) => a.status === 'pending').length;
      return json(route, {
        awaitingDecision: pending > 0, mode: 'manual', approvalCount: 0, denialCount: 0,
        cachedChecks: 0, totalChecks: 0, approvals,
      });
    }
    const approvalActionMatch = path.match(/^\/api\/approvals\/([^/]+)\/(approve|deny|claim|cancel)$/);
    if (method === 'POST' && approvalActionMatch) {
      const approvalId = decodeURIComponent(approvalActionMatch[1]);
      const action = approvalActionMatch[2] as 'approve' | 'deny' | 'claim' | 'cancel';
      const requestBody = request.postDataJSON?.() ?? {};
      daemon.approvalActions.push({ approvalId, action, body: requestBody });
      const record = approvals.find((a) => a.id === approvalId);
      if (record) {
        if (action === 'approve') Object.assign(record, { status: 'approved', resolvedAt: Date.now(), resolvedBy: 'operator' });
        else if (action === 'deny') Object.assign(record, { status: 'denied', resolvedAt: Date.now(), resolvedBy: 'operator' });
        else if (action === 'cancel') Object.assign(record, { status: 'cancelled', resolvedAt: Date.now(), resolvedBy: 'operator' });
        else if (action === 'claim') Object.assign(record, { status: 'claimed', claimedBy: 'operator', claimedAt: Date.now() });
      }
      return json(route, { approval: record ?? {} });
    }

    // ── Generic control-plane invoke (POST .../methods/{id}/invoke) ─────────
    const invokeMatch = path.match(/^\/api\/control-plane\/methods\/([^/]+)\/invoke$/);
    if (method === 'POST' && invokeMatch) {
      const methodId = decodeURIComponent(invokeMatch[1]);
      if (methodId === 'control.status') return json(route, { ok: true, status: 'running' });
      if (methodId.includes('knowledge')) return json(route, knowledgeMapResponse());
      if (methodId === 'sessions.search') return json(route, unionListResponse());
      if (methodId === 'fleet.snapshot') return json(route, FLEET_SNAPSHOT);
      if (methodId === 'fleet.list') return json(route, { items: FLEET_SNAPSHOT.nodes, hasMore: false, capturedAt: FLEET_SNAPSHOT.capturedAt });
      return json(route, {});
    }

    // ── Fallback: an honest empty success for any un-modelled surface. Views
    //    render their empty/degraded states rather than hanging. ─────────────
    if (method === 'GET') return json(route, {});
    return json(route, {});
  });

  return daemon;
}
