import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sdk, GOODVIBES_BASE_URL, getCurrentAuth } from '../lib/goodvibes';
import {
  type DaemonHealth,
  type ConnectionState,
  type AuthState,
  type WorkingState,
  type SseState,
  DAEMON_HEALTH_DEFAULTS,
  taskCountsFromList,
  modelNameFromCurrent,
  clampLatency,
  deriveAuthState,
  deriveWorkingState,
} from '../lib/daemon-health';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How often to re-probe the daemon (ms) */
const HEALTH_PROBE_INTERVAL_MS = 15_000;

/**
 * Ping endpoint — lightweight, always-available.
 * We treat this probe as PURE LIVENESS: ok = status < 500 (includes 401 when
 * the daemon is up but unauthenticated).
 */
const PING_PATH = '/api/local-auth';

// ---------------------------------------------------------------------------
// Internal latency probe
// ---------------------------------------------------------------------------

async function probeLatency(): Promise<{ latencyMs: number | null; ok: boolean }> {
  const start = performance.now();
  try {
    const url = `${GOODVIBES_BASE_URL.replace(/\/+$/, '')}${PING_PATH}`;
    const res = await fetch(url, { credentials: 'include', method: 'GET' });
    const elapsed = clampLatency(Math.round(performance.now() - start));
    return { latencyMs: elapsed, ok: res.status < 500 };
  } catch {
    return { latencyMs: null, ok: false };
  }
}

/** Read a numeric HTTP status off a thrown error, if the caller attached one. */
function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}

/** Run an authed call and reduce it to an {ok,status} probe result (never throws). */
async function probeCall(fn: () => Promise<unknown>): Promise<{ ok: boolean; status: number | null }> {
  try {
    await fn();
    return { ok: true, status: 200 };
  } catch (error) {
    return { ok: false, status: statusOf(error) };
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns live daemon health: connection state, latency, SSE stream state,
 * active turn count, queued task count, and current model name.
 *
 * - Probes the daemon every 15 s via a lightweight fetch (no throw on failure).
 * - Reuses the existing queryClient pattern for tasks + model (separate queries).
 * - Subscribes to `sdk.realtime.viaSse()` for SSE state tracking.
 */
export function useDaemonHealth(): DaemonHealth {
  // -- SSE state ------------------------------------------------------------
  // Stays 'connecting' until the first real envelope arrives — do NOT set
  // 'active' synchronously before any event, as that would show "Live" even
  // on a dead/stalled stream.
  const [sseState, setSseState] = useState<SseState>('connecting');

  useEffect(() => {
    setSseState('connecting');
    let mounted = true;
    const unsubs: (() => void)[] = [];

    try {
      const events = sdk.realtime.viaSse();

      // Subscribe to a lightweight domain to confirm the SSE pipe is alive.
      // The 'turn' domain fires on any agent turn event.
      const turnDomain = (events as Record<string, unknown>).turn as
        | { onEnvelope?: (name: string, cb: (e: unknown) => void) => () => void }
        | undefined;

      if (turnDomain?.onEnvelope) {
        // Only flip to 'active' when the first real envelope arrives from the
        // stream — proving the transport is genuinely delivering events.
        const unsubTurn = turnDomain.onEnvelope('TURN_STARTED', () => {
          if (mounted) setSseState('active');
        });
        const unsubTurnEnd = turnDomain.onEnvelope('TURN_COMPLETED', () => {
          if (mounted) setSseState('active');
        });
        unsubs.push(unsubTurn, unsubTurnEnd);
        // Intentionally NOT setting 'active' here — stay 'connecting' until
        // an envelope actually arrives.
      }
      // else: domain absent — remain 'connecting'; cannot confirm stream health.
    } catch {
      if (mounted) setSseState('error');
    }

    return () => {
      mounted = false;
      for (const fn of unsubs) fn();
      // Don't flip to error on unmount — component teardown, not a real failure
    };
  }, []);

  // -- Latency + connection probe -------------------------------------------
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('down');

  /**
   * Consecutive probe-failure counter (persists across refetch intervals).
   * 1st failure → 'reconnecting'; 2nd+ consecutive failure → 'down'.
   * Any success resets it to 0.
   */
  const failureCountRef = useRef<number>(0);

  /** Threshold of consecutive failures before declaring the daemon 'down'. */
  const FAILURE_THRESHOLD = 2;

  // Use TanStack Query so we get deduplication and window-focus coordination.
  // refetchIntervalInBackground: true — intentional trade-off: keeps the strip
  // accurate even when the tab is backgrounded (battery/network cost is low at
  // 15 s intervals; a stale connection indicator would be misleading to users
  // who return to the tab expecting current status).
  const healthQuery = useQuery({
    queryKey: ['daemon-health', 'probe'] as const,
    queryFn: probeLatency,
    refetchInterval: HEALTH_PROBE_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: 0,
    staleTime: HEALTH_PROBE_INTERVAL_MS / 2,
  });

  // Derive connection state from probe result.
  // Pure liveness: ok (status < 500) → connected.
  // On failure: first consecutive failure → 'reconnecting' (transient blip);
  // FAILURE_THRESHOLD or more consecutive failures → 'down'.
  useEffect(() => {
    if (healthQuery.isSuccess) {
      const { latencyMs: probed, ok } = healthQuery.data;
      setLatencyMs(probed);
      if (ok) {
        failureCountRef.current = 0;
        setConnectionState('connected');
      } else {
        failureCountRef.current += 1;
        setConnectionState(failureCountRef.current >= FAILURE_THRESHOLD ? 'down' : 'reconnecting');
      }
    } else if (healthQuery.isError) {
      // Defensive guard: probeLatency never rethrows today, but this branch
      // ensures correct failure-threshold behaviour if a future refactor adds
      // a throwing code path to the probe.
      failureCountRef.current += 1;
      setLatencyMs(null);
      setConnectionState(failureCountRef.current >= FAILURE_THRESHOLD ? 'down' : 'reconnecting');
    }
  }, [healthQuery.isSuccess, healthQuery.isError, healthQuery.data]);

  // -- Tasks ----------------------------------------------------------------
  const tasksQuery = useQuery({
    queryKey: ['tasks'] as const,
    queryFn: () => sdk.operator.tasks.list(),
    refetchInterval: HEALTH_PROBE_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: 0,
    staleTime: HEALTH_PROBE_INTERVAL_MS / 2,
  });

  // -- Signed-in axis (auth.current: 200 vs 401) ----------------------------
  const authProbe = useQuery({
    queryKey: ['daemon-health', 'auth'] as const,
    queryFn: () => probeCall(getCurrentAuth),
    refetchInterval: HEALTH_PROBE_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: 0,
    staleTime: HEALTH_PROBE_INTERVAL_MS / 2,
  });

  // -- Working axis (an authed read that surfaces the read:sessions scope gap) --
  // A token that is signed-in but lacks read:sessions will 401 here → 'blocked',
  // so the strip shows reachable+signed-in but NOT working rather than a false "live".
  const workingProbe = useQuery({
    queryKey: ['daemon-health', 'working'] as const,
    queryFn: () => probeCall(() => sdk.operator.sessions.list()),
    refetchInterval: HEALTH_PROBE_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: 0,
    staleTime: HEALTH_PROBE_INTERVAL_MS / 2,
  });

  const signedIn: AuthState = authProbe.isSuccess ? deriveAuthState(authProbe.data) : 'unknown';
  const working: WorkingState = workingProbe.isSuccess ? deriveWorkingState(workingProbe.data) : 'unknown';

  // -- Current model --------------------------------------------------------
  const modelQuery = useQuery({
    queryKey: ['daemon-health', 'model'] as const,
    queryFn: () => sdk.operator.models.current(),
    // Models change rarely — refresh every 60 s
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: 0,
    staleTime: 30_000,
  });

  // -- Derive counts --------------------------------------------------------
  const { activeTurns, queuedTasks } = tasksQuery.isSuccess
    ? taskCountsFromList(tasksQuery.data)
    : { activeTurns: DAEMON_HEALTH_DEFAULTS.activeTurns, queuedTasks: DAEMON_HEALTH_DEFAULTS.queuedTasks };

  const modelName = modelQuery.isSuccess ? modelNameFromCurrent(modelQuery.data) : null;

  return {
    connection: connectionState,
    signedIn,
    working,
    latencyMs,
    sse: sseState,
    activeTurns,
    queuedTasks,
    modelName,
  };
}
