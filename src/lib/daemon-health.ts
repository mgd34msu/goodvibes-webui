/**
 * Daemon health types and pure helper functions.
 * Derives state from data already exposed by the SDK / queries.
 * No `any`. No side effects.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type ConnectionState = 'connected' | 'reconnecting' | 'down';

export type SseState = 'active' | 'connecting' | 'error' | 'disabled';

export interface DaemonHealth {
  /** Current HTTP/SSE connectivity state */
  connection: ConnectionState;
  /** Round-trip latency of the last health probe in ms, or null if never measured */
  latencyMs: number | null;
  /** SSE stream state */
  sse: SseState;
  /** Number of in-flight agent turns (active sessions being processed) */
  activeTurns: number;
  /** Number of queued / pending tasks not yet executing */
  queuedTasks: number;
  /** Currently-selected model display name, if resolvable */
  modelName: string | null;
}

export const DAEMON_HEALTH_DEFAULTS: DaemonHealth = {
  connection: 'down',
  latencyMs: null,
  sse: 'disabled',
  activeTurns: 0,
  queuedTasks: 0,
  modelName: null,
};

interface TaskItem {
  status?: string;
  state?: string;
  [key: string]: unknown;
}

interface TasksListResponse {
  tasks?: TaskItem[];
  items?: TaskItem[];
  data?: TaskItem[];
  [key: string]: unknown;
}

interface ModelCurrentResponse {
  name?: string;
  displayName?: string;
  registryKey?: string;
  id?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Pure helpers — derive state from raw API responses
// ---------------------------------------------------------------------------

/** Extract task counts from a tasks.list response. */
export function taskCountsFromList(response: unknown): { activeTurns: number; queuedTasks: number } {
  if (!response || typeof response !== 'object') return { activeTurns: 0, queuedTasks: 0 };
  const r = response as TasksListResponse;
  const items: TaskItem[] = r.tasks ?? r.items ?? r.data ?? [];
  if (!Array.isArray(items)) return { activeTurns: 0, queuedTasks: 0 };

  let activeTurns = 0;
  let queuedTasks = 0;

  for (const item of items) {
    const s = (item.status ?? item.state ?? '').toLowerCase();
    if (s === 'running' || s === 'active' || s === 'in_progress') activeTurns++;
    else if (s === 'queued' || s === 'pending' || s === 'waiting') queuedTasks++;
  }

  return { activeTurns, queuedTasks };
}

/** Extract a human-readable model name from a models/current response. */
export function modelNameFromCurrent(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;
  const r = response as ModelCurrentResponse;
  return r.displayName ?? r.name ?? r.registryKey ?? r.id ?? null;
}

/**
 * Clamp latency to a sane display range (0–9999 ms).
 * Negative values (clock skew) become null.
 */
export function clampLatency(ms: number): number | null {
  if (ms < 0) return null;
  return Math.min(ms, 9999);
}

/** Format latency for display: "<10ms", "42ms", "1.2s" */
export function formatLatency(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 10) return '<10ms';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Map ConnectionState to a human-readable label */
export function connectionLabel(state: ConnectionState): string {
  switch (state) {
    case 'connected': return 'Connected';
    case 'reconnecting': return 'Reconnecting';
    case 'down': return 'Offline';
  }
}

/** Map SseState to a human-readable label */
export function sseLabel(state: SseState): string {
  switch (state) {
    case 'active': return 'Live';
    case 'connecting': return 'SSE…';
    case 'error': return 'SSE error';
    case 'disabled': return 'SSE off';
  }
}
