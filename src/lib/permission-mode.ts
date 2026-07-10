/**
 * permission-mode.ts — read/format the daemon's session permission mode.
 *
 * GROUNDED: there is no dedicated `sessions.permissionMode` wire method (checked
 * against the installed @pellux/goodvibes-contracts operator-contract.json —
 * OPERATOR_METHOD_IDS has no such id, and neither sessions.get/list nor
 * fleet.snapshot carries a permission-mode field). The mode lives at the shared
 * config key `permissions.mode` (the SDK's own PermissionMode config schema type,
 * platform/config/schema-types.d.ts) — the same key the TUI reads directly via
 * `configManager.get('permissions.mode')` (goodvibes-tui's src/cli/status.ts /
 * src/input/commands/product-runtime.ts) and writes via `configManager.setDynamic`.
 *
 * config.get() returns the daemon's FULL config tree unredacted (verified in
 * config-redaction.ts's header comment — configManager.getAll() verbatim), so
 * `permissions.mode` is a real row in flattenConfig(config.get())'s output even
 * though the generated OperatorMethodOutputMap for config.get only enumerates a
 * handful of top-level sections (a stale/generic passthrough route — see
 * goodvibes.ts's config.* comment). config.set(key, value) writes one key at a
 * time against the daemon's real /config contract, so
 * `sdk.operator.config.set('permissions.mode', nextMode)` is the write path.
 *
 * This mode is DAEMON-WIDE, not scoped to one session — the SDK's own
 * `PERMISSION_MODE_CHANGED` runtime event (events/permissions.ts) carries no
 * sessionId, confirming it. Surfaces must say so rather than implying a
 * per-session value the wire does not provide.
 */

import { flattenConfig } from './config-redaction';

/** The SDK's real PermissionMode config enum (platform/config/schema-types.d.ts). */
export const PERMISSION_MODES = ['prompt', 'allow-all', 'custom', 'plan', 'accept-edits'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export function isPermissionMode(value: string): value is PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(value);
}

/** Human labels — 'prompt'/'allow-all' get a plain-language gloss ("Normal"/"Auto"),
 *  matching the vocabulary the task's operator-facing copy uses, while staying
 *  honest about the underlying config value (shown alongside, never hidden). */
const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  prompt: 'Normal',
  'allow-all': 'Auto',
  custom: 'Custom',
  plan: 'Plan',
  'accept-edits': 'Accept edits',
};

export function permissionModeLabel(mode: string): string {
  return isPermissionMode(mode) ? PERMISSION_MODE_LABELS[mode] : (mode || 'Unknown');
}

export const PERMISSIONS_MODE_CONFIG_KEY = 'permissions.mode';

/**
 * Read `permissions.mode` out of a config.get() response, tolerantly. Returns ''
 * when the daemon's config tree does not carry the key (an older daemon, or a
 * connection issue) — never a guessed default.
 */
export function currentPermissionMode(configData: unknown): string {
  const entry = flattenConfig(configData).find((row) => row.key === PERMISSIONS_MODE_CONFIG_KEY);
  return typeof entry?.value === 'string' ? entry.value : '';
}
