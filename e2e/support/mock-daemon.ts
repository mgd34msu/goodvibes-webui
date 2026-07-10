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
  accountsSnapshotResponse,
  CALENDAR_NOT_CONFIGURED_BODY,
  calendarEventDetailResponse,
  calendarEventsResponse,
  configGetResponse,
  FLEET_SNAPSHOT,
  knowledgeCandidateDecideResponse,
  knowledgeCandidatesResponse,
  knowledgeMapResponse,
  knowledgePacketResponse,
  memoryRecordWire,
  messagesResponse,
  modelsCurrentResponse,
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
  /**
   * calendar.* handler behavior. 'configured' (default) answers the honest seeded
   * event fixtures for every calendar.* route. 'unconfigured' answers the daemon's
   * real 412 CALENDAR_NOT_CONFIGURED shape (caldav-client.ts's resolveCalDavConfig
   * refusal) for every calendar.* route, proving the honest bring-your-own-CalDAV
   * state instead of a fabricated empty calendar.
   */
  calendar?: 'configured' | 'unconfigured';
  /**
   * GET/POST /config behavior (config.get/config.set — the Settings modal and
   * ModelWorkspaceModal's helper/tool/tts/embeddings targets). 'ok' (default)
   * answers a real, mutable config.get()/config.set() round-trip seeded from
   * configGetResponse(); 'admin-required' answers the daemon's real 403
   * admin-scope refusal (system-routes.ts's requireAdmin), matching
   * credentials' 'admin-required' shape.
   */
  config?: 'ok' | 'admin-required';
  /**
   * knowledge.packet response shape. 'complete' (default) answers a real, untruncated
   * packet (truncated: false, droppedCount: 0, budgetExhausted: false) — the every-
   * candidate-fit case. 'truncated' answers the final SDK's real truncation field
   * shape (truncated/totalCandidates/droppedCount/droppedForBudget/budgetExhausted all
   * populated, some candidates dropped for the token budget specifically), proving the
   * KnowledgePacketPanel disclosure renders from a genuine post-1.2.0 wire shape rather
   * than only the hand-authored optional subset.
   */
  packet?: 'complete' | 'truncated';
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
    calendar = 'configured',
    config = 'ok',
    packet = 'complete',
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

  // Checkpoints (checkpoints.*, MOBILE-ADAPT): one seeded checkpoint so the
  // phone-tier CSS (checkpoints-create-row / checkpoint-detail__restore hidden,
  // an honest note shown) has real selected-detail content to prove against,
  // not just the true-empty state phone-smoke already covers.
  let checkpointsList = [
    { id: 'wcp_e2e_1', kind: 'manual', label: 'Before the mobile pass', createdAt: 1_700_000_000_000, parentId: null as string | null, retentionClass: 'standard', commit: 'aaaaaaaaaaaa1111', sizeBytes: 4096 },
  ];

  // Fleet archive (fleet.archive/unarchive/archiveFinished/archived.list):
  // node ids the tests have archived — snapshot/list exclude them, archived.list
  // returns them, unarchive releases them.
  const archivedFleetIds = new Set<string>();

  // Runtime tasks (tasks.*, MOBILE-ADAPT): one cancellable, one retryable — the
  // pair TaskRow's two mutation buttons key off (task.cancellable / a
  // failed/cancelled status), so the phone-tier hiding of both has something
  // to hide.
  let taskList = [
    { id: 'task_e2e_1', kind: 'shell', title: 'Run the release checklist', status: 'running', owner: 'operator', cancellable: true, queuedAt: 1_700_000_000_000 },
    { id: 'task_e2e_2', kind: 'shell', title: 'Rebuild the search index', status: 'failed', owner: 'operator', cancellable: false, queuedAt: 1_700_000_000_000, error: 'index build timed out' },
  ];

  function methodNotFound(route: Route) {
    return json(route, { error: 'Unknown gateway method', code: 'METHOD_NOT_FOUND' }, 404);
  }

  // Web Push (push.*, SDK 1.1.0) — a fresh per-test in-memory subscription store
  // so subscribe -> list -> verify -> delete round-trips honestly. The redacted
  // view only (never the capability URL or key material), exactly like the real
  // daemon. `pushVapidKey` is a syntactically-valid base64url stand-in — enough
  // for urlBase64ToUint8Array to decode without a real keypair.
  const pushVapidKey = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBO_2H6ipYIF3PBhTvbP7z4c';
  let pushSubscriptions: { id: string; principalId: string; endpointOrigin: string; endpointHash: string; createdAt: number }[] = [];
  let pushIdCounter = 0;

  // Mutable server-side state for the two round-trip surfaces this brief adds:
  // the current model slot (models.current/models.select) and the config tree
  // (config.get/config.set) — a real "select a model, see it reflected" and
  // "save a setting, see it read back" proof, not a static fixture.
  let currentModel = modelsCurrentResponse();
  const configState: Record<string, unknown> = JSON.parse(JSON.stringify(configGetResponse())) as Record<string, unknown>;

  function setDotPath(target: Record<string, unknown>, dottedKey: string, value: unknown): void {
    const parts = dottedKey.split('.');
    let cursor = target;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i];
      const next = cursor[part];
      if (!next || typeof next !== 'object' || Array.isArray(next)) {
        cursor[part] = {};
      }
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1]] = value;
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

  // config.get/config.set resolve to GET/POST /config — no `/api` segment,
  // same reason as credentials above (EXTRA_METHOD_ROUTES in
  // src/lib/goodvibes.ts). A real, mutable round-trip: config.set actually
  // mutates configState, so a subsequent config.get (or the Settings modal's
  // own cache invalidation) reflects the write.
  await page.route('**/config', async (route) => {
    const request = route.request();
    if (config === 'admin-required') {
      return json(route, { error: 'Admin role required' }, 403);
    }
    if (request.method() === 'POST') {
      const body = (request.postDataJSON?.() ?? {}) as { key?: string; value?: unknown };
      if (!body.key) return json(route, { error: 'Missing or invalid key' }, 400);
      setDotPath(configState, body.key, body.value);
      return json(route, { success: true, key: body.key, value: body.value });
    }
    return json(route, configState);
  });

  // The SDK's control.status convenience helper uses the direct `GET /status`
  // route (not the invoke gateway), so it needs its own registration. Without
  // it this was the ONE request that escaped the mock to the dead proxy
  // target: every boot snapshot and the Admin status card ran against a
  // connection-refused health probe, spamming the webServer log with
  // ECONNREFUSED and exercising the app permanently in its daemon-down pulse
  // state. Same answer shape as the invoke-path 'control.status' below.
  await page.route('**/status', async (route) => {
    return json(route, { ok: true, status: 'running' });
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
      // Authenticated when the app was seeded signed-in OR presents a bearer token
      // (what a QR pairing hand-off produces): the daemon authenticates the presented
      // operator token, so a freshly-paired device with no seeded token still passes.
      const authz = request.headers()['authorization'] ?? '';
      const bearer = /^Bearer\s+(.+)$/i.exec(authz)?.[1]?.trim();
      if (!signedIn && !bearer) return json(route, { error: 'unauthorized' }, 401);
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
    if (method === 'GET' && path === '/api/accounts') {
      return json(route, accountsSnapshotResponse());
    }

    // ── Models (models.current/models.select — the "main" target; ModelWorkspaceModal
    // sources its catalog from providers.list above, not this route, since this one
    // never carries tier/pricing on the real wire either — see model-catalog.ts). ──
    if (method === 'GET' && path === '/api/models/current') {
      return json(route, currentModel);
    }
    if (method === 'PATCH' && path === '/api/models/current') {
      const body = (request.postDataJSON?.() ?? {}) as { registryKey?: string };
      const registryKey = body.registryKey ?? '';
      const [provider, ...idParts] = registryKey.split(':');
      currentModel = {
        model: { registryKey, provider: provider ?? '', id: idParts.join(':') },
        configured: true,
        configuredVia: 'subscription',
      };
      return json(route, { ...currentModel, persisted: true });
    }
    if (method === 'GET' && path === '/api/models') {
      return json(route, { providers: [], currentModel: currentModel.model, secretsResolutionSkipped: false });
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
      // Mirrors the SDK's memory-recall-contract.ts MIN_PROMPT_MEMORY_CONFIDENCE (60) —
      // the mock daemon's own confidence-floor check below, and now also promoted onto
      // the wire as `recallFloor` (recallFloor is on the wire per the final SDK's
      // HonestMemorySearchResult), so MemorySearchHonestyNote/MemoryRecordRow's labels
      // read this value instead of a hardcoded percentage.
      const recallFloor = 60;
      let excludedFlaggedCount = 0;
      let excludedBelowFloorCount = 0;
      if (recall) {
        const kept: typeof records = [];
        for (const record of records) {
          if (record.reviewState === 'stale' || record.reviewState === 'contradicted') {
            excludedFlaggedCount += 1;
            continue;
          }
          if (record.confidence < recallFloor) {
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
        recallFloor,
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
      if (methodId === 'fleet.snapshot') {
        const nodes = FLEET_SNAPSHOT.nodes.filter((node) => !archivedFleetIds.has(node.id));
        return json(route, { ...FLEET_SNAPSHOT, nodes, totalCount: nodes.length });
      }
      if (methodId === 'fleet.list') {
        const items = FLEET_SNAPSHOT.nodes.filter((node) => !archivedFleetIds.has(node.id));
        return json(route, { items, hasMore: false, capturedAt: FLEET_SNAPSHOT.capturedAt });
      }
      // ── Fleet archive (SDK 1.6.x): stateful enough to prove the archive →
      //    browse → restore round trip honestly. Only terminal nodes archive,
      //    mirroring the daemon's refusal for live subtrees.
      if (methodId === 'fleet.archive') {
        const body = (route.request().postDataJSON?.() ?? {}) as { body?: { id?: string } };
        const id = body.body?.id ?? '';
        const node = FLEET_SNAPSHOT.nodes.find((n) => n.id === id);
        if (!node) return json(route, { archived: false, count: 0, reason: `node ${id} not found` });
        if (!['done', 'failed', 'killed', 'interrupted'].includes(node.state)) {
          return json(route, { archived: false, count: 0, reason: '1 node(s) in the subtree are still active — only finished subtrees can be archived' });
        }
        archivedFleetIds.add(id);
        return json(route, { archived: true, count: 1 });
      }
      if (methodId === 'fleet.unarchive') {
        const body = (route.request().postDataJSON?.() ?? {}) as { body?: { id?: string } };
        const existed = archivedFleetIds.delete(body.body?.id ?? '');
        return json(route, { restored: existed ? 1 : 0 });
      }
      if (methodId === 'fleet.archiveFinished') {
        let archived = 0;
        for (const node of FLEET_SNAPSHOT.nodes) {
          if (['done', 'failed', 'killed', 'interrupted'].includes(node.state) && !archivedFleetIds.has(node.id)) {
            archivedFleetIds.add(node.id);
            archived++;
          }
        }
        return json(route, { archivedCount: archived });
      }
      if (methodId === 'fleet.archived.list') {
        return json(route, {
          capturedAt: FLEET_SNAPSHOT.capturedAt,
          nodes: FLEET_SNAPSHOT.nodes.filter((node) => archivedFleetIds.has(node.id)),
        });
      }
      if (methodId === 'checkpoints.list') return json(route, { checkpoints: checkpointsList });
      if (methodId === 'checkpoints.create') {
        const body = (route.request().postDataJSON?.() ?? {}) as { label?: string };
        const created = {
          id: `wcp_e2e_${checkpointsList.length + 1}`,
          kind: 'manual',
          label: body.label ?? '',
          createdAt: Date.now(),
          parentId: checkpointsList[0]?.id ?? null,
          retentionClass: 'standard',
          commit: 'ffffff000000',
          sizeBytes: 1024,
        };
        checkpointsList = [created, ...checkpointsList];
        return json(route, { checkpoint: created, noop: false });
      }
      if (methodId === 'checkpoints.diff') {
        return json(route, {
          diff: { from: 'wcp_e2e_1', to: 'WORKING', files: ['src/example.ts'], unifiedDiff: '--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new\n', stat: '1 file changed' },
        });
      }
      if (methodId === 'checkpoints.restore') {
        return json(route, { result: { checkpointId: 'wcp_e2e_1', safetyCheckpointId: null, restoredFiles: ['src/example.ts'], removedFiles: [] } });
      }
      // ── Web Push (push.*) — the PWA subscription lifecycle. ────────────────
      if (methodId === 'push.vapid.get') {
        return json(route, { publicKey: pushVapidKey });
      }
      if (methodId === 'push.subscriptions.create') {
        const body = (route.request().postDataJSON?.() ?? {}) as { body?: { endpoint?: string } };
        const endpoint = body.body?.endpoint ?? 'https://push.example/endpoint';
        let origin = 'https://push.example';
        try {
          origin = new URL(endpoint).origin;
        } catch {
          /* keep the fallback origin */
        }
        pushIdCounter += 1;
        const subscription = {
          id: `push_e2e_${pushIdCounter}`,
          principalId: 'operator',
          endpointOrigin: origin,
          endpointHash: `hash-${pushIdCounter}`,
          createdAt: Date.now(),
        };
        // Register-in-place: one subscription per origin, mirroring the real verb.
        pushSubscriptions = [...pushSubscriptions.filter((s) => s.endpointOrigin !== origin), subscription];
        return json(route, { subscription });
      }
      if (methodId === 'push.subscriptions.list') {
        return json(route, { subscriptions: pushSubscriptions });
      }
      if (methodId === 'push.subscriptions.delete') {
        const body = (route.request().postDataJSON?.() ?? {}) as { body?: { subscriptionId?: string } };
        const id = body.body?.subscriptionId ?? '';
        const existed = pushSubscriptions.some((s) => s.id === id);
        if (!existed) return json(route, { error: 'Subscription not found', code: 'SUBSCRIPTION_NOT_FOUND' }, 404);
        pushSubscriptions = pushSubscriptions.filter((s) => s.id !== id);
        return json(route, { subscriptionId: id, deleted: true });
      }
      if (methodId === 'push.subscriptions.verify') {
        const body = (route.request().postDataJSON?.() ?? {}) as { body?: { subscriptionId?: string } };
        const id = body.body?.subscriptionId ?? '';
        const found = pushSubscriptions.find((s) => s.id === id);
        if (!found) return json(route, { error: 'Subscription not found', code: 'SUBSCRIPTION_NOT_FOUND' }, 404);
        return json(route, { receipt: { subscriptionId: id, endpointOrigin: found.endpointOrigin, outcome: 'delivered' } });
      }
      return json(route, {});
    }

    // ── Fallback: an honest empty success for any un-modelled surface. Views
    //    render their empty/degraded states rather than hanging. ─────────────
    if (method === 'GET') return json(route, {});
    return json(route, {});
  });

  // ── Knowledge candidates + packet (separate registrations — Playwright runs the
  //    LAST-registered route FIRST, so these override the generic knowledge fallback
  //    above for the specific paths they match, without touching that shared handler.
  //    Kept as their own page.route() calls, per this brief's file-ownership note,
  //    since five concurrent web UI worktrees touch this file. ───────────────────
  // Tracks decide() outcomes in-memory so a refetch after accept/reject/supersede
  // reflects the decision instead of replaying the static pending seed forever —
  // just enough state to prove the decide-then-refresh round trip honestly.
  const decidedCandidates = new Map<string, string>();

  await page.route('**/api/knowledge/candidates**', async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    const decideMatch = path.match(/^\/api\/knowledge\/candidates\/([^/]+)\/decide$/);
    if (method === 'POST' && decideMatch) {
      const id = decodeURIComponent(decideMatch[1]);
      const body = request.postDataJSON?.() ?? {};
      const decision = typeof body === 'object' && body !== null && 'decision' in body ? String((body as { decision?: unknown }).decision ?? '') : '';
      const result = knowledgeCandidateDecideResponse(id, decision);
      decidedCandidates.set(id, result.candidate.status);
      return json(route, result);
    }
    const getMatch = path.match(/^\/api\/knowledge\/candidates\/([^/]+)$/);
    if (method === 'GET' && getMatch) {
      const id = decodeURIComponent(getMatch[1]);
      const found = knowledgeCandidatesResponse().candidates.find((candidate) => candidate.id === id);
      const status = decidedCandidates.get(id);
      return json(route, { candidate: found ? { ...found, ...(status ? { status } : {}) } : null });
    }
    if (method === 'GET' && path === '/api/knowledge/candidates') {
      const withDecisions = knowledgeCandidatesResponse().candidates.map((candidate) => {
        const status = decidedCandidates.get(candidate.id);
        return status ? { ...candidate, status } : candidate;
      });
      return json(route, { candidates: withDecisions });
    }
    return json(route, {});
  });

  await page.route('**/api/knowledge/packet**', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') return json(route, {});
    const body = request.postDataJSON?.() ?? {};
    const task = typeof body === 'object' && body !== null && 'task' in body ? String((body as { task?: unknown }).task ?? '') : '';
    return json(route, knowledgePacketResponse(task, packet === 'truncated'));
  });

  // ── Calendar (calendar.events.*, calendar.ics.*) — a genuinely separate domain
  //    from `/api/knowledge`, so it needs its own registration rather than piggy-
  //    backing on the generic knowledge fallback. `calendar: 'unconfigured'` answers
  //    the real 412 CALENDAR_NOT_CONFIGURED shape for every route, proving the
  //    honest bring-your-own-CalDAV state end to end. ──────────────────────────
  await page.route('**/api/calendar/**', async (route) => {
    if (calendar === 'unconfigured') {
      return json(route, CALENDAR_NOT_CONFIGURED_BODY, 412);
    }
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;

    if (method === 'GET' && path === '/api/calendar/events') {
      return json(route, calendarEventsResponse());
    }
    const eventGetMatch = path.match(/^\/api\/calendar\/events\/([^/]+)$/);
    if (method === 'GET' && eventGetMatch) {
      return json(route, calendarEventDetailResponse(decodeURIComponent(eventGetMatch[1])));
    }
    if (method === 'POST' && path === '/api/calendar/events') {
      return json(route, { eventId: 'ev-new', uid: 'ev-new@goodvibes', createdAt: new Date(0).toISOString() });
    }
    if (method === 'GET' && path === '/api/calendar/ics/export') {
      return json(route, { icsContent: 'BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR', eventCount: calendarEventsResponse().events.length });
    }
    if (method === 'POST' && path === '/api/calendar/ics/import') {
      return json(route, { imported: 1, eventIds: ['ev-imported'], errors: [] });
    }
    return json(route, {});
  });

  // ── Tasks (tasks.*, MOBILE-ADAPT) — plain REST paths (EXTRA_METHOD_ROUTES in
  //    src/lib/goodvibes.ts), not the `/api/control-plane/methods/{id}/invoke`
  //    tunnel, so they need their own registration like calendar/knowledge above.
  //    tasks.create posts to the legacy `/task` path with no `/api` segment.
  await page.route('**/task', async (route) => {
    if (route.request().method() !== 'POST') return json(route, {});
    const body = (route.request().postDataJSON?.() ?? {}) as { task?: string };
    const created = {
      id: `task_e2e_${taskList.length + 1}`,
      kind: 'shell',
      title: body.task ?? '',
      status: 'queued',
      owner: 'operator',
      cancellable: true,
      queuedAt: Date.now(),
    };
    taskList = [...taskList, created];
    return json(route, { task: created });
  });

  await page.route('**/api/tasks/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    const cancelMatch = path.match(/^\/api\/tasks\/([^/]+)\/cancel$/);
    if (method === 'POST' && cancelMatch) {
      const id = decodeURIComponent(cancelMatch[1]);
      taskList = taskList.map((t) => (t.id === id ? { ...t, status: 'cancelled', cancellable: false } : t));
      return json(route, { taskId: id, status: 'cancelled' });
    }
    const retryMatch = path.match(/^\/api\/tasks\/([^/]+)\/retry$/);
    if (method === 'POST' && retryMatch) {
      const id = decodeURIComponent(retryMatch[1]);
      taskList = taskList.map((t) => (t.id === id ? { ...t, status: 'queued', error: undefined } : t));
      return json(route, { taskId: id, status: 'queued' });
    }
    return json(route, {});
  });

  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() !== 'GET') return json(route, {});
    const totals = {
      created: taskList.length,
      completed: taskList.filter((t) => t.status === 'completed').length,
      failed: taskList.filter((t) => t.status === 'failed').length,
      cancelled: taskList.filter((t) => t.status === 'cancelled').length,
    };
    return json(route, {
      queued: taskList.filter((t) => t.status === 'queued').length,
      running: taskList.filter((t) => t.status === 'running').length,
      blocked: taskList.filter((t) => t.status === 'blocked').length,
      totals,
      tasks: taskList,
    });
  });

  return daemon;
}
