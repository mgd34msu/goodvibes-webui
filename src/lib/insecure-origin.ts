/**
 * insecure-origin.ts — the entry guard for the plain-http-non-local white screen.
 *
 * THE FAILURE THIS CATCHES: the SDK transport refuses an insecure non-loopback baseUrl by
 * THROWING at module evaluation (`SDK_TRANSPORT_INSECURE_BASE_URL` in
 * @pellux/goodvibes-transport-http). That throw fires the instant `src/lib/goodvibes.ts`
 * is imported — before React mounts — so an operator who opens the daemon over
 * `http://<lan-ip>` used to get a silent blank `#root` with only a console pageerror. The
 * guard itself is correct (cross-machine is meant to run over HTTPS via `tailscale serve`);
 * the gap was purely the SILENT failure mode.
 *
 * So this module re-derives the SAME insecure predicate WITHOUT importing lib/goodvibes
 * (importing it would re-trigger the very throw we are trying to get ahead of). main.tsx
 * checks `isInsecureTransportOrigin()` FIRST and, when true, renders the honest HTTPS
 * message instead of importing App at all.
 *
 * The wording matches the family already used for the same secure-context requirement in
 * MicButton / NotificationSettings ("needs a secure (HTTPS) connection … for example via
 * Tailscale").
 */

export const INSECURE_ORIGIN_TITLE = 'This page needs HTTPS';

export const INSECURE_ORIGIN_BODY =
  'GoodVibes needs a secure (HTTPS) connection over the network — open it over HTTPS '
  + '(for example via `tailscale serve`) instead of plain http. The daemon refuses to '
  + 'talk to an insecure non-local origin, so the app cannot start here.';

/**
 * The baseUrl the SDK transport would be handed — identical source to
 * `GOODVIBES_BASE_URL` in lib/goodvibes.ts, re-derived here so we never import that
 * (throwing) module. `VITE_GOODVIBES_BASE_URL` wins if set; otherwise the page origin.
 */
function effectiveBaseUrl(): string {
  const configured = import.meta.env?.VITE_GOODVIBES_BASE_URL as string | undefined;
  if (configured) return configured;
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

/**
 * Mirror of the transport guard's insecure predicate: an http/ws baseUrl on a non-loopback
 * host, unless GOODVIBES_ALLOW_INSECURE_TRANSPORT=true opts out. Returns true exactly when
 * the SDK would throw SDK_TRANSPORT_INSECURE_BASE_URL — so the honest message shows in
 * precisely the cases the app would otherwise blank-screen, and never otherwise.
 */
export function isInsecureTransportOrigin(): boolean {
  // Honor the same explicit override the SDK guard honors, so an intentional insecure
  // deployment does not get the message.
  const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (runtimeProcess?.env?.GOODVIBES_ALLOW_INSECURE_TRANSPORT === 'true') return false;

  const base = effectiveBaseUrl();
  if (!base) return false;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return false;
  }
  const protocol = url.protocol;
  if (protocol !== 'http:' && protocol !== 'ws:') return false;
  const host = url.hostname.toLowerCase();
  const local = host === 'localhost' || host === '::1' || host === '127.0.0.1' || host.startsWith('127.');
  return !local;
}
