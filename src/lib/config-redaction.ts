/**
 * config-redaction.ts — secret-free config display, honestly.
 *
 * GROUNDED: GET /config (config.get) returns configManager.getAll() verbatim —
 * a plain structuredClone with NO field-level redaction anywhere in the daemon
 * (packages/sdk/src/platform/config/manager.ts). Provider API keys are NOT part
 * of this object (they live in the separate SecretsManager store, resolved
 * through api-keys.ts), but several `surfaces.*` integration settings ARE plain
 * config values that are secret-shaped: Slack/Discord/Telegram/WhatsApp/
 * Matrix/etc bot tokens, signing secrets, webhook secrets
 * (schema-domain-surfaces.ts). A web settings surface reading config.get must
 * never render those verbatim.
 *
 * Two layers, belt-and-suspenders:
 *   1. SECRET_CONFIG_KEYS — the TUI's own curated allowlist
 *      (src/config/secret-config.ts's SECRET_CONFIG_KEYS), ported verbatim for
 *      cross-surface parity: the same keys the TUI already treats as secret
 *      render masked here too.
 *   2. A generic last-segment heuristic (token/secret/password/key, case-
 *      insensitive) as a safety net for keys the curated list hasn't caught up
 *      to yet — confirmed gap: schema-domain-surfaces.ts also defines
 *      surfaces.telephony.token/.authToken/.webhookSecret, none of which are in
 *      the TUI's own SECRET_CONFIG_KEYS. Erring toward over-masking a config
 *      value is the honest failure direction here; erring toward under-masking
 *      is not.
 */
import { asRecord } from './object';

/** Ported verbatim from goodvibes-tui's src/config/secret-config.ts SECRET_CONFIG_KEYS. */
export const SECRET_CONFIG_KEYS: ReadonlySet<string> = new Set([
  'surfaces.slack.signingSecret',
  'surfaces.slack.botToken',
  'surfaces.slack.appToken',
  'surfaces.discord.botToken',
  'surfaces.ntfy.token',
  'surfaces.webhook.secret',
  'surfaces.homeassistant.accessToken',
  'surfaces.homeassistant.webhookSecret',
  'surfaces.telegram.botToken',
  'surfaces.telegram.webhookSecret',
  'surfaces.googleChat.verificationToken',
  'surfaces.signal.token',
  'surfaces.whatsapp.accessToken',
  'surfaces.whatsapp.verifyToken',
  'surfaces.whatsapp.signingSecret',
  'surfaces.imessage.token',
  'surfaces.msteams.appPassword',
  'surfaces.bluebubbles.password',
  'surfaces.mattermost.botToken',
  'surfaces.matrix.accessToken',
]);

/** The generic safety-net pattern: the key's last dot-segment looks secret-shaped. */
const SECRET_KEY_SUFFIX = /(token|secret|password|apikey|api_key)$/i;

export function isSecretConfigKey(key: string): boolean {
  if (SECRET_CONFIG_KEYS.has(key)) return true;
  const lastSegment = key.split('.').pop() ?? key;
  return SECRET_KEY_SUFFIX.test(lastSegment);
}

/** Mask a secret string the same shape the TUI uses: keep the last 4 chars, star the rest. */
export function maskSecretValue(value: string): string {
  if (value.length === 0) return '(empty)';
  if (value.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(12, Math.max(4, value.length - 4)))}${value.slice(-4)}`;
}

/** Render a config value for display, masking it first if the key is secret-shaped. */
export function displayConfigValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '(unset)';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    if (value === '') return '(empty)';
    return isSecretConfigKey(key) ? maskSecretValue(value) : value;
  }
  if (typeof value === 'number') return String(value);
  try {
    return JSON.stringify(value) ?? '(unrepresentable)';
  } catch {
    return '(unrepresentable)';
  }
}

// ---------------------------------------------------------------------------
// Category naming parity — mirrors goodvibes-tui's settings-modal-helpers.ts
// CATEGORY_LABELS. The config namespace (the key's first dot-segment) maps
// 1:1 onto the TUI's rail category ids for every domain both surfaces share.
// A namespace with no TUI analogue falls back to a Title Case of itself
// (honest — never invented, just formatted) rather than a fabricated label.
// ---------------------------------------------------------------------------

export const CATEGORY_LABELS: Record<string, string> = {
  display: 'Display',
  ui: 'UI',
  provider: 'Provider',
  subscriptions: 'Subscriptions',
  behavior: 'Behavior',
  storage: 'Storage',
  permissions: 'Permissions',
  orchestration: 'Orchestration',
  planner: 'Planner',
  wrfc: 'WRFC',
  helper: 'Helper',
  tts: 'TTS',
  service: 'Service',
  daemon: 'Daemon',
  controlPlane: 'Control Plane',
  httpListener: 'HTTP Listener',
  web: 'Web',
  batch: 'Batch',
  automation: 'Automation',
  watchers: 'Watchers',
  runtime: 'Runtime',
  telemetry: 'Telemetry',
  cache: 'Cache',
  mcp: 'MCP',
  sandbox: 'Sandbox',
  surfaces: 'Surfaces',
  cloudflare: 'Cloudflare',
  release: 'Release',
  danger: 'Danger',
  tools: 'Tools',
  flags: 'Feature Flags',
  network: 'Network',
};

function titleCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

/** Category label for a config key's top-level namespace, TUI-parity where a mapping exists. */
export function categoryLabelForKey(key: string): string {
  const namespace = key.split('.')[0] ?? key;
  return CATEGORY_LABELS[namespace] ?? titleCase(namespace);
}

// ---------------------------------------------------------------------------
// Flattening config.get()'s nested object into (key, value) rows.
// ---------------------------------------------------------------------------

export interface ConfigEntry {
  readonly key: string;
  readonly value: unknown;
  readonly category: string;
}

/** Flatten a nested config object into dotted-key rows, deepest values only
 *  (objects are descended, not shown as a row themselves — arrays are treated
 *  as leaf values). Mirrors the dotted config-key shape config.set expects. */
export function flattenConfig(value: unknown, prefix = ''): ConfigEntry[] {
  const record = asRecord(value);
  const keys = Object.keys(record);
  // Not a plain object at all (or an array/primitive) — nothing to flatten.
  if (keys.length === 0 && !(value && typeof value === 'object' && !Array.isArray(value))) return [];
  const entries: ConfigEntry[] = [];
  for (const key of keys) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const item = record[key];
    const isPlainObject = item !== null && typeof item === 'object' && !Array.isArray(item);
    if (isPlainObject) {
      entries.push(...flattenConfig(item, fullKey));
    } else {
      entries.push({ key: fullKey, value: item, category: categoryLabelForKey(fullKey) });
    }
  }
  return entries;
}
