/**
 * relay-connection.ts — the transport ROUTE the SDK client dispatches requests over.
 *
 * Two transports can answer a request:
 *   - direct: an ordinary `fetch` against GOODVIBES_BASE_URL (the LAN/co-located path,
 *     unchanged from before this file existed).
 *   - relay: `createRelayClient` (@pellux/goodvibes-transport-realtime) tunnels unary
 *     request/response calls, end-to-end encrypted, through a relay server — for when
 *     this device cannot reach the daemon directly. It requires a stored pairing (see
 *     relay-pairing.ts).
 *
 * SCOPE, HONESTLY: the relay only tunnels unary HTTP calls. Server-Sent-Event streaming
 * is NOT bridged (see relay-transport.js's own header comment: "event streaming keeps
 * using the direct realtime connectors on the LAN. A streaming bridge is deferred, not
 * faked."). `routedFetch` below detects a stream request (the SSE opener's own
 * `Accept: text/event-stream` header — see @pellux/goodvibes-transport-http's
 * sse-stream.js) and rejects it immediately with a clear error when the active route is
 * relay, rather than handing it to the relay client where it would eventually time out
 * (`requestTimeoutMs`, 30s default) doing something it was never going to do. An
 * immediate, clearly-worded rejection is the honest behavior; a 30-second hang that
 * fails the same way is not.
 *
 * `routedFetch` is the one `fetch` implementation the SDK client is built with
 * (lib/goodvibes.ts). It always exists and behaves exactly like the plain global fetch
 * when no relay pairing is stored — this file changes nothing for the common LAN/
 * co-located case.
 */

import { createRelayClient, type RelayClient } from '@pellux/goodvibes-transport-realtime';
import { GoodVibesSdkError } from '@pellux/goodvibes-errors';
import { getStoredRelayPairing, type RelayPairingPayload } from './relay-pairing';

export type ConnectionRoute = 'direct' | 'relay';

// ---------------------------------------------------------------------------
// Route store — a tiny module-level pub/sub. Plain (non-React) code, like
// routedFetch below, reads the snapshot directly; React reads it reactively via
// useSyncExternalStore in useDaemonHealth.
// ---------------------------------------------------------------------------

let activeRoute: ConnectionRoute = 'direct';
const listeners = new Set<() => void>();

/** Current active route. Defaults to 'direct'; relay is opt-in and probe-driven. */
export function getActiveRoute(): ConnectionRoute {
  return activeRoute;
}

/** Switch the active route. A no-op notify-wise if unchanged (avoids extra renders). */
export function setActiveRoute(route: ConnectionRoute): void {
  if (activeRoute === route) return;
  activeRoute = route;
  for (const listener of listeners) listener();
}

export function subscribeActiveRoute(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---------------------------------------------------------------------------
// Relay client — lazy singleton over the stored pairing. Rebuilt if the stored
// pairing changes (e.g. a fresh scan replacing an old one).
// ---------------------------------------------------------------------------

let client: RelayClient | null = null;
let clientForPairingKey: string | null = null;

function pairingKey(pairing: RelayPairingPayload): string {
  return `${pairing.relayUrl}|${pairing.rid}|${pairing.daemonPublicKey}`;
}

/** Get (creating if needed) the relay client for the currently-stored pairing, or null if none is stored. */
export function getRelayClient(): RelayClient | null {
  const pairing = getStoredRelayPairing();
  if (!pairing) {
    client = null;
    clientForPairingKey = null;
    return null;
  }
  const key = pairingKey(pairing);
  if (client && clientForPairingKey === key) return client;
  if (client) client.close();
  client = createRelayClient({ pairing });
  clientForPairingKey = key;
  return client;
}

/** Tear down the relay client (e.g. after clearing the stored pairing). */
export function closeRelayClient(): void {
  if (client) client.close();
  client = null;
  clientForPairingKey = null;
}

/**
 * Attempt to reach the daemon over the relay: connect the client (idempotent) and
 * confirm the end-to-end channel is ready. Returns false — never throws — on any
 * failure (no pairing stored, handshake failure, relay unreachable, timeout).
 */
export async function probeRelayReachability(): Promise<boolean> {
  const relayClient = getRelayClient();
  if (!relayClient) return false;
  try {
    await relayClient.connect();
    return relayClient.ready;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// routedFetch — the fetch the SDK client is built with.
// ---------------------------------------------------------------------------

function isStreamRequest(init: RequestInit | undefined, input: RequestInfo | URL): boolean {
  const headerFrom = (h: HeadersInit | undefined): string | null => {
    if (!h) return null;
    if (h instanceof Headers) return h.get('Accept');
    if (Array.isArray(h)) return h.find(([k]) => k.toLowerCase() === 'accept')?.[1] ?? null;
    return h.Accept ?? h.accept ?? null;
  };
  const initAccept = headerFrom(init?.headers);
  if (initAccept?.includes('text/event-stream')) return true;
  if (input instanceof Request) {
    return input.headers.get('Accept')?.includes('text/event-stream') ?? false;
  }
  return false;
}

/**
 * The fetch implementation the SDK client dispatches every call through. Routes to
 * the relay's tunneled fetch when the active route is 'relay'; otherwise behaves
 * exactly like the platform's native fetch (the pre-relay default).
 */
function routedFetchImpl(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (activeRoute !== 'relay') return globalThis.fetch(input, init);

  if (isStreamRequest(init, input)) {
    return Promise.reject(
      new GoodVibesSdkError(
        'Live event streams are not available over the relay connection — only direct/LAN connectors carry them.',
        {
          category: 'protocol',
          source: 'transport',
          recoverable: false,
          hint: 'Views relying on this stream fall back to periodic polling while connected via relay.',
        },
      ),
    );
  }

  const relayClient = getRelayClient();
  if (!relayClient) return globalThis.fetch(input, init);
  return relayClient.fetch(input, init);
}

// The runtime's `fetch` carries a `preconnect` static (a Bun extension the SDK's
// `typeof fetch` option type inherits from this project's global types) that a plain
// function value structurally lacks. Delegate it straight to the real fetch's own
// implementation so routedFetch is a genuine drop-in, not just a same-shaped cast.
export const routedFetch: typeof fetch = Object.assign(routedFetchImpl, {
  preconnect: (...args: Parameters<typeof fetch.preconnect>) => globalThis.fetch.preconnect(...args),
});
