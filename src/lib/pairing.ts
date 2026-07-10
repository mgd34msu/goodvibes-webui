/**
 * pairing.ts — consume a pairing hand-off carried in the URL fragment.
 *
 * The terminal command `goodvibes pair` shows a QR code that encodes a link back
 * to this web app with an operator token in the URL FRAGMENT — e.g.
 * `https://<webui-origin>/#pair=<token>` (optionally alongside a `?view=…`
 * query). The fragment is chosen deliberately: a `#`-fragment is never sent to
 * the server, so the one-time token never lands in an access log, a proxy log,
 * or a Referer header. This module only READS that fragment; QR *generation*
 * lives entirely on the daemon/TUI side, never here.
 *
 * Two functions, both pure over `window.location`:
 *   - parsePairingTokenFromHash — pull the token out of a hash string.
 *   - stripPairingFragment — remove ONLY the `pair` key from the live URL via
 *     history.replaceState, so the secret does not linger in the address bar or
 *     a back/forward history entry once it has been consumed.
 */

/** The fragment key the pairing link uses: `#pair=<token>`. */
export const PAIRING_FRAGMENT_KEY = 'pair';

/**
 * Extract a pairing token from a URL hash string (`window.location.hash`), or
 * null when none is present. Tolerates a leading `#`, an empty hash, and a hash
 * that carries other fragment keys alongside `pair`.
 */
export function parsePairingTokenFromHash(hash: string): string | null {
  if (!hash) return null;
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  const trimmed = new URLSearchParams(raw).get(PAIRING_FRAGMENT_KEY)?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Remove the `pair` key from the current URL's fragment via
 * history.replaceState, preserving the pathname, query string, and any other
 * fragment keys. A no-op-safe call: if there is no `pair` key, the URL is left
 * unchanged. Never adds a history entry.
 */
export function stripPairingFragment(): void {
  if (typeof window === 'undefined') return;
  const rawHash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  const params = new URLSearchParams(rawHash);
  if (!params.has(PAIRING_FRAGMENT_KEY)) return;
  params.delete(PAIRING_FRAGMENT_KEY);
  const remaining = params.toString();
  const url = `${window.location.pathname}${window.location.search}${remaining ? `#${remaining}` : ''}`;
  window.history.replaceState(window.history.state, '', url);
}
