/**
 * Seeded daemon state for the hermetic Playwright harness (W5-M).
 *
 * This is a deterministic, in-memory fixture — NOT a real daemon. The harness never
 * talks to a real GoodVibes daemon (never 3421/4444, never any port): every /api
 * request is intercepted in the browser by installMockDaemon (support/mock-daemon.ts)
 * and answered from these fixtures. That keeps the phone-viewport proofs reproducible
 * and offline, with no port coordination and zero risk of touching a live process.
 */

export interface SeedMessage {
  id: string;
  role: string;
  body: string;
}

export interface SeedSession {
  id: string;
  kind: string;
  project: string;
  title: string;
  status: string;
  updatedAt: number;
  messageCount: number;
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
  updatedAt: 200,
  messageCount: 4,
  activeAgentId: 'agent-42',
  messages: [
    { id: 'm1', role: 'user', body: 'Extract the new-file logic so we stay under the 800-line cap.' },
    { id: 'm2', role: 'assistant', body: 'Moved the new-file branch into a helper and wired the timer-driven keepalive so a live surface never goes stale mid-idle. Running the suite now.' },
    { id: 'm3', role: 'user', body: 'Good. Keep the wire shapes identical to the spine contract.' },
    { id: 'm4', role: 'assistant', body: 'Confirmed — the create-time race is closed and the detached-spawn default holds. Standing by for the next steer.' },
  ],
};

/** A closed session (no agent) — steer degrades to follow-up honesty. */
export const FOLLOWUP_SESSION: SeedSession = {
  id: 's-tui-idle',
  kind: 'tui',
  project: 'goodvibes-tui',
  title: 'Earlier TUI coding pass',
  status: 'active',
  updatedAt: 150,
  messageCount: 2,
  // No activeAgentId → canSteer is false → the composer offers a follow-up instead.
  messages: [
    { id: 'm1', role: 'user', body: 'Tighten the splash boundary math.' },
    { id: 'm2', role: 'assistant', body: 'Done — wide/narrow glyph typography preserved exactly.' },
  ],
};

export const CLOSED_SESSION: SeedSession = {
  id: 's-webui-closed',
  kind: 'webui',
  project: 'goodvibes-webui',
  title: 'Closed operator surface',
  status: 'closed',
  updatedAt: 90,
  messageCount: 5,
  messages: [{ id: 'm1', role: 'user', body: 'Archive this one.' }],
};

export const SEED_SESSIONS: SeedSession[] = [STEERABLE_SESSION, FOLLOWUP_SESSION, CLOSED_SESSION];

export function unionListResponse() {
  return {
    totals: { sessions: SEED_SESSIONS.length },
    sessions: SEED_SESSIONS.map(({ messages: _messages, ...rest }) => rest),
  };
}

export function messagesResponse(sessionId: string) {
  const session = SEED_SESSIONS.find((s) => s.id === sessionId);
  return { messages: session ? session.messages : [] };
}

/** Provider pills fixture — a mix of fresh / stale / unauthenticated for the proof. */
export function providersResponse() {
  return {
    providers: [
      { id: 'anthropic', name: 'Anthropic', authenticated: true, freshnessSeconds: 40, models: ['claude-opus-4-8'] },
      { id: 'openai', name: 'OpenAI', authenticated: true, freshnessSeconds: 5400, models: ['gpt-5'] },
      { id: 'google', name: 'Google', authenticated: false, models: ['gemini-3'] },
    ],
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
