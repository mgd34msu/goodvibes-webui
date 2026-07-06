/**
 * Seeded daemon state for the hermetic Playwright harness.
 *
 * This is a deterministic, in-memory fixture — NOT a real daemon. The harness never
 * talks to a real GoodVibes daemon (never 3421/4444, never any port): every /api
 * request is intercepted in the browser by installMockDaemon (support/mock-daemon.ts)
 * and answered from these fixtures. That keeps the phone-viewport proofs reproducible
 * and offline, with no port coordination and zero risk of touching a live process.
 *
 * CONTRACT-BOUND: sessionRecord()/messagesResponse()/unionListResponse()
 * shapes are asserted, in e2e/support/assert-contract-shape.test.ts, against the SDK's
 * generated operator-contract.json (sessions.list / sessions.get /
 * sessions.messages.list all share this session-record shape). A field rename or a
 * new required field on that contract fails that assertion instead of the mock
 * silently answering a shape the daemon would never send — the drift class that bit
 * once already (see providersResponse()'s header below).
 */

export interface SeedMessage {
  id: string;
  role: string;
  body: string;
  createdAt: number;
}

export interface SeedParticipant {
  surfaceKind: string;
  surfaceId: string;
  lastSeenAt: number;
}

export interface SeedSession {
  id: string;
  kind: string;
  project: string;
  title: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  messageCount: number;
  pendingInputCount: number;
  routeIds: string[];
  surfaceKinds: string[];
  participants: SeedParticipant[];
  metadata: Record<string, unknown>;
  activeAgentId?: string;
  messages: SeedMessage[];
}

/** A steerable session (agent bound, open) — the target of the hero journey. */
export const STEERABLE_SESSION: SeedSession = {
  id: 's-agent-live',
  kind: 'agent',
  project: 'goodvibes-tui',
  title: 'Refactor the session spine',
  status: 'active',
  createdAt: 100,
  updatedAt: 200,
  lastActivityAt: 200,
  messageCount: 4,
  pendingInputCount: 0,
  routeIds: ['r-agent-live'],
  surfaceKinds: ['webui', 'tui'],
  participants: [{ surfaceKind: 'webui', surfaceId: 'goodvibes-webui', lastSeenAt: 200 }],
  metadata: {},
  activeAgentId: 'agent-42',
  messages: [
    { id: 'm1', role: 'user', body: 'Extract the new-file logic so we stay under the 800-line cap.', createdAt: 110 },
    { id: 'm2', role: 'assistant', body: 'Moved the new-file branch into a helper and wired the timer-driven keepalive so a live surface never goes stale mid-idle. Running the suite now.', createdAt: 140 },
    { id: 'm3', role: 'user', body: 'Good. Keep the wire shapes identical to the spine contract.', createdAt: 170 },
    { id: 'm4', role: 'assistant', body: 'Confirmed — the create-time race is closed and the detached-spawn default holds. Standing by for the next steer.', createdAt: 200 },
  ],
};

/** A closed session (no agent) — steer degrades to follow-up honesty. */
export const FOLLOWUP_SESSION: SeedSession = {
  id: 's-tui-idle',
  kind: 'tui',
  project: 'goodvibes-tui',
  title: 'Earlier TUI coding pass',
  status: 'active',
  createdAt: 50,
  updatedAt: 150,
  lastActivityAt: 150,
  messageCount: 2,
  pendingInputCount: 0,
  routeIds: ['r-tui-idle'],
  surfaceKinds: ['tui'],
  participants: [{ surfaceKind: 'tui', surfaceId: 'goodvibes-tui-local', lastSeenAt: 150 }],
  metadata: {},
  // No activeAgentId → canSteer is false → the composer offers a follow-up instead.
  messages: [
    { id: 'm1', role: 'user', body: 'Tighten the splash boundary math.', createdAt: 60 },
    { id: 'm2', role: 'assistant', body: 'Done — wide/narrow glyph typography preserved exactly.', createdAt: 150 },
  ],
};

export const CLOSED_SESSION: SeedSession = {
  id: 's-webui-closed',
  kind: 'webui',
  project: 'goodvibes-webui',
  title: 'Closed operator surface',
  status: 'closed',
  createdAt: 10,
  updatedAt: 90,
  lastActivityAt: 90,
  messageCount: 5,
  pendingInputCount: 0,
  routeIds: ['r-webui-closed'],
  surfaceKinds: ['webui'],
  participants: [{ surfaceKind: 'webui', surfaceId: 'goodvibes-webui', lastSeenAt: 90 }],
  metadata: {},
  messages: [{ id: 'm1', role: 'user', body: 'Archive this one.', createdAt: 90 }],
};

export const SEED_SESSIONS: SeedSession[] = [STEERABLE_SESSION, FOLLOWUP_SESSION, CLOSED_SESSION];

/**
 * The wire's session-record shape (SharedSessionRecordResponse), shared verbatim by
 * sessions.list / sessions.get / sessions.messages.list on the real operator contract
 * — never messages, which is a sibling field on those envelopes, not part of this
 * record. Building it from one place keeps every mocked "session" field the same
 * shape wherever it appears, so a contract change only needs fixing here.
 */
export function sessionRecord(session: SeedSession) {
  return {
    id: session.id,
    kind: session.kind,
    project: session.project,
    title: session.title,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastActivityAt: session.lastActivityAt,
    messageCount: session.messageCount,
    pendingInputCount: session.pendingInputCount,
    routeIds: session.routeIds,
    surfaceKinds: session.surfaceKinds,
    participants: session.participants,
    ...(session.activeAgentId ? { activeAgentId: session.activeAgentId } : {}),
    metadata: session.metadata,
  };
}

/** The wire's message-record shape, shared by sessions.get / sessions.messages.list. */
export function contractMessage(sessionId: string, message: SeedMessage) {
  return {
    id: message.id,
    sessionId,
    role: message.role,
    body: message.body,
    createdAt: message.createdAt,
    metadata: {},
  };
}

/** A stub session record for an id the seed doesn't know — still contract-shaped. */
function unknownSession(sessionId: string): SeedSession {
  return {
    id: sessionId,
    kind: 'unknown',
    project: '',
    title: '',
    status: 'closed',
    createdAt: 0,
    updatedAt: 0,
    lastActivityAt: 0,
    messageCount: 0,
    pendingInputCount: 0,
    routeIds: [],
    surfaceKinds: [],
    participants: [],
    metadata: {},
    messages: [],
  };
}

export function unionListResponse() {
  return {
    totals: {
      sessions: SEED_SESSIONS.length,
      active: SEED_SESSIONS.filter((s) => s.status === 'active').length,
      closed: SEED_SESSIONS.filter((s) => s.status === 'closed').length,
    },
    sessions: SEED_SESSIONS.map(sessionRecord),
  };
}

/** sessions.get / sessions.messages.list share this {session, messages} envelope shape. */
export function messagesResponse(sessionId: string) {
  const session = SEED_SESSIONS.find((s) => s.id === sessionId) ?? unknownSession(sessionId);
  return {
    session: sessionRecord(session),
    messages: session.messages.map((m) => contractMessage(session.id, m)),
  };
}

/**
 * Provider pills fixture — the REAL providers.list wire shape (verified against the
 * SDK's operator-contract.json): each provider carries `providerId`/`active`/
 * `modelCount`/`models` at top level and its auth health nested at
 * `runtime.auth.routes[].freshness` (with `runtime.auth.mode`/`configured`). There is
 * NO top-level `authenticated`/`freshnessSeconds` on the wire — the old fixture invented
 * those, and deriveProviderStatus (which only reads `runtime.auth.routes[].freshness`)
 * ignored them, so every pill fell through to 'status unavailable' and the freshness
 * ladder was never exercised (F5). This fixture drives the full ladder — healthy /
 * expiring / expired / unconfigured / status-unavailable (routes genuinely absent) —
 * one per provider, so the pills screenshot proves each state.
 *
 * SECOND DRIFT CAUGHT BY the contract-shape assertion: the top-level `models` field is
 * priced model SUMMARIES (`{id, registryKey, displayName, selectable, contextWindow,
 * pricing?}`), per operator-contract.json — NOT the plain model-id strings this
 * fixture used to put there (it reused the same string list for both the top-level
 * field and `runtime.models.models`, which really is a plain string array). Reading
 * side (modelOptionsFromProvider, provider-models.ts) is tolerant of either shape via
 * normalizeModel(), so the app behavior this fixture drives is unchanged — but the
 * fixture itself was structurally wrong until this assertion caught it.
 */
export function providersResponse() {
  const provider = (
    providerId: string,
    active: boolean,
    auth: {
      mode: 'api-key' | 'oauth' | 'anonymous' | 'none';
      configured: boolean;
      detail?: string;
      routes: {
        route: string;
        label: string;
        configured: boolean;
        usable?: boolean;
        freshness?: string;
        detail?: string;
        repairHints?: string[];
      }[];
    },
    modelIds: string[],
  ) => ({
    providerId,
    active,
    modelCount: modelIds.length,
    models: modelIds.map((modelId) => ({
      id: modelId,
      registryKey: `${providerId}:${modelId}`,
      displayName: modelId,
      selectable: true,
      contextWindow: 200_000,
    })),
    runtime: {
      auth: { mode: auth.mode, configured: auth.configured, detail: auth.detail, routes: auth.routes },
      models: { models: modelIds, defaultModel: modelIds[0] },
    },
  });

  return {
    providers: [
      provider('anthropic', true, {
        mode: 'oauth',
        configured: true,
        routes: [{ route: 'oauth', label: 'Claude Pro/Max', configured: true, usable: true, freshness: 'healthy' }],
      }, ['claude-opus-4-8']),
      provider('openai', true, {
        mode: 'api-key',
        configured: true,
        routes: [{ route: 'api-key', label: 'API key', configured: true, usable: true, freshness: 'expiring', detail: 'Token refreshes soon' }],
      }, ['gpt-5']),
      provider('google', true, {
        mode: 'api-key',
        configured: true,
        routes: [{
          route: 'api-key',
          label: 'API key',
          configured: true,
          usable: false,
          freshness: 'expired',
          detail: 'Credentials expired — re-authenticate',
          repairHints: ['Run: gv auth google'],
        }],
      }, ['gemini-3']),
      provider('mistral', false, {
        mode: 'none',
        configured: false,
        routes: [{ route: 'api-key', label: 'API key', configured: false, freshness: 'unconfigured' }],
      }, ['mistral-large']),
      // Health genuinely absent: no routes at all → the honest 'status unavailable'
      // state (distinct from 'unconfigured').
      provider('ollama', true, {
        mode: 'anonymous',
        configured: true,
        routes: [],
      }, ['llama-4']),
    ],
  };
}

/**
 * Memory records fixture (memory.records.* / memory.review-queue, SDK 1.1.0). Shapes
 * are cross-checked against the daemon's own MEMORY_RECORD_SCHEMA
 * (operator-contract-schemas-runtime.js) the same way the session/provider fixtures
 * above are checked against their contracts — id/scope/cls/summary/tags/provenance/
 * reviewState/confidence/createdAt/updatedAt required, detail/reviewedAt/reviewedBy/
 * staleReason optional.
 */
export interface SeedMemoryRecord {
  id: string;
  scope: 'session' | 'project' | 'team';
  cls: string;
  summary: string;
  detail?: string;
  tags: string[];
  provenance: { kind: string; ref: string; label?: string }[];
  reviewState: 'fresh' | 'reviewed' | 'stale' | 'contradicted';
  confidence: number;
  reviewedAt?: number;
  reviewedBy?: string;
  staleReason?: string;
  createdAt: number;
  updatedAt: number;
}

/** A plain fresh fact — the default "everything is fine" record. */
export const MEMORY_FACT: SeedMemoryRecord = {
  id: 'mem-fact-1',
  scope: 'project',
  cls: 'fact',
  summary: 'The daemon is the single writer for the canonical memory store',
  detail: 'Client surfaces route writes through memory.records.* rather than opening the store file directly.',
  tags: ['memory', 'architecture'],
  provenance: [{ kind: 'session', ref: 's-agent-live', label: 'Refactor the session spine' }],
  reviewState: 'fresh',
  confidence: 82,
  createdAt: 1_000,
  updatedAt: 1_000,
};

/** A record waiting in the review queue — low-enough confidence / fresh enough to
 * be prioritized, distinct from MEMORY_FACT so the journey can tell them apart. */
export const MEMORY_REVIEW_CANDIDATE: SeedMemoryRecord = {
  id: 'mem-review-1',
  scope: 'project',
  cls: 'incident',
  summary: 'Splash boundary math regressed once during a wide-glyph edit',
  tags: ['splash'],
  provenance: [{ kind: 'file', ref: 'src/splash.ts' }],
  reviewState: 'fresh',
  confidence: 55,
  createdAt: 2_000,
  updatedAt: 2_000,
};

/** A VIBE.md persona/preference line — cls 'constraint', tagged 'vibe' — the read
 * surface MemoryView projects into its Personas panel. */
export const MEMORY_PERSONA: SeedMemoryRecord = {
  id: 'mem-persona-1',
  scope: 'project',
  cls: 'constraint',
  summary: 'Use plain, concrete, descriptive language',
  detail: 'Name the files, functions, and behavior explicitly; avoid security-flavored jargon.',
  tags: ['vibe'],
  provenance: [{ kind: 'file', ref: 'VIBE.md' }],
  reviewState: 'reviewed',
  confidence: 90,
  reviewedAt: 1_500,
  reviewedBy: 'operator',
  createdAt: 500,
  updatedAt: 1_500,
};

export const SEED_MEMORY_RECORDS: SeedMemoryRecord[] = [MEMORY_FACT, MEMORY_REVIEW_CANDIDATE, MEMORY_PERSONA];

export function memoryRecordWire(record: SeedMemoryRecord) {
  return {
    id: record.id,
    scope: record.scope,
    cls: record.cls,
    summary: record.summary,
    ...(record.detail !== undefined ? { detail: record.detail } : {}),
    tags: record.tags,
    provenance: record.provenance,
    reviewState: record.reviewState,
    confidence: record.confidence,
    ...(record.reviewedAt !== undefined ? { reviewedAt: record.reviewedAt } : {}),
    ...(record.reviewedBy !== undefined ? { reviewedBy: record.reviewedBy } : {}),
    ...(record.staleReason !== undefined ? { staleReason: record.staleReason } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** A tiny valid SVG for the knowledge map render proof. */
export function knowledgeMapResponse() {
  return {
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120"><rect width="200" height="120" fill="#0a0a14"/><circle cx="60" cy="60" r="18" fill="#00ffff"/><circle cx="150" cy="40" r="14" fill="#ff00ff"/><line x1="60" y1="60" x2="150" y2="40" stroke="#8ab" stroke-width="2"/><text x="40" y="100" fill="#cde" font-size="10">knowledge map</text></svg>',
    nodes: [{ id: 'n1', label: 'session-spine' }, { id: 'n2', label: 'daemon' }],
    jobs: [],
  };
}

// ─── Fleet / approvals / watchers (WEBUI-FLEET-DEPTH) ─────────────────────────
//
// fleet.snapshot's node ids/kinds mirror the SDK's real fleet.snapshot shape
// (see src/lib/goodvibes.ts's FleetProcessNode). FLEET_AGENT_NODE.sessionRef.sessionId
// deliberately equals STEERABLE_SESSION.id so the steer/detach/"approve from the tree"
// proofs exercise the SAME seeded session the hero journey
// (hero-steer-from-phone.e2e.ts) already steers, and PENDING_APPROVAL.sessionId
// matches it too, so lib/fleet.ts's approvalsForNode correlation fires for real.

export const FLEET_AGENT_NODE = {
  id: 'agent-42',
  kind: 'agent',
  label: 'Refactor the session spine',
  state: 'executing-tool',
  elapsedMs: 12_000,
  startedAt: 100,
  costUsd: 0.08,
  costState: 'priced',
  capabilities: { interruptible: true, killable: true, pausable: false, resumable: false, steerable: true },
  usage: { inputTokens: 200, outputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0, llmCallCount: 3, turnCount: 2, toolCallCount: 4 },
  sessionRef: { sessionId: STEERABLE_SESSION.id, agentId: 'agent-42' },
};

export const FLEET_WATCHER_NODE = {
  id: 'watcher-docs',
  kind: 'watcher',
  label: 'Docs watcher',
  state: 'idle',
  elapsedMs: 0,
  costState: 'unpriced',
  capabilities: { interruptible: false, killable: true, pausable: false, resumable: false, steerable: false },
};

export const FLEET_SNAPSHOT = {
  capturedAt: 1000,
  truncated: false,
  totalCount: 2,
  nodes: [FLEET_AGENT_NODE, FLEET_WATCHER_NODE],
};

export const PENDING_APPROVAL = {
  id: 'appr-e2e-1',
  callId: 'call-e2e-1',
  sessionId: STEERABLE_SESSION.id,
  status: 'pending',
  request: {
    callId: 'call-e2e-1',
    tool: 'bash',
    args: {},
    category: 'shell',
    analysis: {
      classification: 'command',
      riskLevel: 'medium',
      summary: 'Run the full test suite before merging',
      reasons: ['Modifies test fixtures'],
    },
  },
  createdAt: 500,
  updatedAt: 500,
  metadata: {},
};
