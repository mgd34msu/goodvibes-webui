/**
 * useRealtimeInvalidation — refetch React Query caches off the control-plane event feed.
 *
 * CONNECTION BUDGET (the W-2 fix): the browser caps concurrent connections per origin
 * (~6 on HTTP/1.1). The previous implementation used `sdk.realtime.viaSse()` and
 * subscribed to five domains (tasks, permissions, providers, knowledge, control-plane),
 * and viaSse opens ONE SSE connection PER domain. Together with useSessionRealtime's
 * own session stream that reached six long-lived streams — saturating the pool so the
 * NEXT fetch (notably SessionsView's sessions.list on navigation) had no socket and hung
 * forever: the Sessions/Union view rendered zero rows with no error and no empty state.
 *
 * The daemon multiplexes every domain onto ONE stream via `?domains=a,b,c`
 * (GET /api/control-plane/events, `event: <domain>` per frame — integration/helpers.ts).
 * So we open a SINGLE raw multiplexed stream here and route by the frame's event name
 * (which IS the domain), invalidating that domain's query keys. This collapses five
 * connections to one; with useSessionRealtime that is two streams total, well under the
 * per-origin cap. We only INVALIDATE (trigger a revalidate) off the stream, never render
 * straight from a frame — matching useSessionRealtime.
 */

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { sdk, DEFAULT_SSE_RECONNECT } from '../lib/goodvibes';
import { queryKeys } from '../lib/queries';

/**
 * Domain → the query keys a frame on that domain should revalidate. The raw stream
 * delivers the DOMAIN as the event name (the daemon writes `event: <domain>`), so we
 * invalidate at domain granularity rather than per specific event type — coarser than
 * the old per-event binding but identical in effect (invalidation only triggers a
 * refetch), and it drops the dead 'controlPlane' alias the old code carried.
 */
const DOMAIN_INVALIDATIONS: Record<string, readonly (readonly unknown[])[]> = {
  tasks: [queryKeys.tasks],
  permissions: [queryKeys.approvals],
  providers: [queryKeys.providers],
  knowledge: [queryKeys.knowledgeStatus, queryKeys.knowledgeSources, queryKeys.knowledgeRefinement],
  'control-plane': [queryKeys.control],
};

/** The single multiplexed control-plane stream carrying every domain we invalidate on. */
const INVALIDATION_EVENTS_PATH = `/api/control-plane/events?domains=${Object.keys(DOMAIN_INVALIDATIONS).join(',')}`;

/**
 * The ONE operator-facing string this hook ever surfaces. Every failure mode — the
 * open() promise rejecting, an onError frame, or a clean onTerminate — collapses to this
 * friendly copy. Critically, the transport's onError sets `err.message` to the raw daemon
 * RESPONSE BODY (e.g. the `{"error":"Authentication required",...,"code":"AUTH_REQUIRED"}`
 * 401 blob seen on a pre-auth open); passing that through would paint that JSON verbatim
 * across every view's banner. We never render a transport-level body — the banner shows
 * this established "live updates paused / reconnecting" wording instead.
 */
const REALTIME_PAUSED_MESSAGE =
  'Live updates paused — reconnecting. Views fall back to periodic refresh until the stream returns.';

export function useRealtimeInvalidation(enabled: boolean) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let disposed = false;
    let close: (() => void) | null = null;

    sdk.streams
      .open(
        INVALIDATION_EVENTS_PATH,
        {
          onReady: () => {
            if (disposed) return;
            setError(null);
          },
          onEvent: (eventName: string) => {
            if (disposed) return;
            const keys = DOMAIN_INVALIDATIONS[eventName];
            if (!keys) return;
            for (const key of keys) {
              void queryClient.invalidateQueries({ queryKey: key });
            }
          },
          // NEVER surface `err.message` here — on a pre-auth open it IS the raw 401
          // response body. Collapse every transport error to the friendly copy.
          onError: (_err: unknown) => {
            if (disposed) return;
            setError(REALTIME_PAUSED_MESSAGE);
          },
          onTerminate: () => {
            if (disposed) return;
            setError(REALTIME_PAUSED_MESSAGE);
          },
        },
        { reconnect: DEFAULT_SSE_RECONNECT },
      )
      .then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }
        close = dispose;
      })
      .catch((_err: unknown) => {
        if (disposed) return;
        setError(REALTIME_PAUSED_MESSAGE);
      });

    return () => {
      disposed = true;
      if (close) close();
    };
  }, [enabled, queryClient]);

  return error;
}
