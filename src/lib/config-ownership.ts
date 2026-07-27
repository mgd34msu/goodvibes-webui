/**
 * config-ownership.ts — which runtime OWNS a config key, mirrored here for display.
 *
 * The web UI is inherently a REMOTE client: it may run on a different machine
 * from the daemon, so it already does the structurally right thing — every
 * config read/write goes THROUGH the daemon's control plane (config.get /
 * config.set), never by opening a settings file directly. What this module
 * adds is visibility: a user editing `surfaces.telegram.*` or
 * `controlPlane.*` from a browser on another machine needs to see, before they
 * touch it, that the value lands in the DAEMON's own config store and applies
 * to every client — not just this browser tab.
 *
 * Source of truth: the SDK's
 * `packages/sdk/src/platform/config/config-ownership.ts`
 * (`DAEMON_OWNED_CONFIG_PREFIXES` / `DAEMON_OWNED_CONFIG_KEYS`). That module
 * is not imported directly here: importing `@pellux/goodvibes-sdk/platform/config`
 * for a value (not just a type) pulls its whole config barrel — SecretsManager,
 * OAuth listeners, google-auth, node-only code — into the browser bundle (the
 * same reason scripts/generate-config-schema.ts snapshots CONFIG_SCHEMA at
 * build time instead of importing it live). This is therefore a maintained
 * MIRROR of the two lists, not a re-export — keep it in sync by hand when the
 * SDK's list changes; config-ownership.test.ts pins the exact prefixes/keys
 * below so drift is at least caught here, even though it cannot be imported
 * structurally.
 */

/**
 * Whole config domains the daemon executes unattended. A key is daemon-owned
 * when it starts with one of these prefixes. Mirrors
 * DAEMON_OWNED_CONFIG_PREFIXES in the SDK's config-ownership.ts exactly.
 */
export const DAEMON_OWNED_CONFIG_PREFIXES: readonly string[] = [
  'surfaces.',
  'controlPlane.',
  'httpListener.',
  'web.',
  'relay.',
  'watchers.',
  'device.',
  'automation.',
  'checkin.',
  'integrations.',
  'atRest.',
  // The daemon is the process that holds the card and charges it, with every
  // surface closed and across restarts. Card material and budgets left
  // client-owned would live in whichever surface happened to enter them and
  // the daemon would charge against defaults — the failure mode the budget
  // exists to prevent. Mirrors the SDK's config-ownership.ts (see its own
  // comment there, which cites docs/payments.md §3).
  'payments.',
  'voice.local.',
];

/**
 * Individual daemon-owned keys that do not sit under a daemon-owned domain
 * prefix. Mirrors DAEMON_OWNED_CONFIG_KEYS in the SDK's config-ownership.ts.
 */
export const DAEMON_OWNED_CONFIG_KEYS: readonly string[] = [
  'danger.httpListener',
  // The one `daemon.*` key that is NOT a per-installation switch. The rest of
  // that prefix answers "does THIS machine run or embed a daemon", which is
  // rightly client-owned. `daemon.timezone` answers something else entirely:
  // where the daemon thinks it IS. Anything that resets on a calendar day
  // reads it, starting with the payment capability's daily budgets — left
  // client-owned, it would land in whichever surface set it and the daemon
  // (which actually rolls the budget over at midnight) would never see it and
  // would keep resetting in UTC. Mirrors the SDK's config-ownership.ts.
  'daemon.timezone',
];

const DAEMON_KEY_SET = new Set<string>(DAEMON_OWNED_CONFIG_KEYS);

/**
 * True when the daemon is the single writer and reader-of-record for `key` —
 * i.e. a `config.set` on this key changes the daemon's own store, applies to
 * every client connected to it, and (per daemon-config-route.ts on the SDK
 * side) fails loudly rather than landing silently in a per-client file when
 * the daemon cannot be reached.
 */
export function isDaemonOwnedConfigKey(key: string): boolean {
  if (DAEMON_KEY_SET.has(key)) return true;
  return DAEMON_OWNED_CONFIG_PREFIXES.some((prefix) => key.startsWith(prefix));
}
