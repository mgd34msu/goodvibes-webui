#!/usr/bin/env bun
/**
 * generate-config-schema.ts
 *
 * Snapshots three SDK data tables the settings surface renders from — the typed
 * config schema and the feature-flag registry with its config association map —
 * into one checked-in, browser-safe TS module:
 *
 *   src/lib/generated/config-schema.ts
 *
 * Why a generator (mirrors scripts/generate-presentation-tokens.ts): the SDK's
 * `@pellux/goodvibes-sdk/platform/config` barrel re-exports CONFIG_SCHEMA but
 * ALSO pulls SecretsManager, OAuth listeners, google-auth, etc. — node-only code
 * that must never enter the browser Vite bundle. Snapshotting the pure data at
 * build time keeps those heavy barrels out of the bundle entirely; the browser
 * imports only the emitted literal.
 *
 * Data sources:
 *   - CONFIG_SCHEMA — from the exported `@pellux/goodvibes-sdk/platform/config`
 *     subpath (types / enums / defaults / descriptions / validation hints per
 *     key). The `validate` closures are dropped (not serialisable); the daemon's
 *     config.set is the authoritative validator, and `validationHint` carries the
 *     human-readable constraint into the UI.
 *   - FEATURE_FLAGS + FEATURE_FLAG_CONFIG — from the SDK feature-flags barrel.
 *     That barrel is NOT (yet) wired into the SDK package.json `exports` map, so
 *     it is imported by resolved filesystem path from the installed package's
 *     dist. This is a build-time-only bridge; when the SDK adds a
 *     `./platform/runtime/feature-flags` subpath export, swap FLAG_BARREL_PATH
 *     for that specifier. Nothing here reaches the browser bundle.
 *
 * `--check` fails (exit 1) the moment the artifact drifts from a fresh
 * regeneration — same generate-or-check convention as presentation:check, wired
 * into `bun run build` so an SDK schema change that was not regenerated fails the
 * build, not just CI.
 *
 * Usage:
 *   bun run scripts/generate-config-schema.ts          # write/update
 *   bun run scripts/generate-config-schema.ts --check  # exit 1 on drift
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONFIG_SCHEMA } from '@pellux/goodvibes-sdk/platform/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CHECK_ONLY = process.argv.includes('--check');

export const TS_OUT_PATH = resolve(ROOT, 'src/lib/generated/config-schema.ts');

/**
 * The feature-flags barrel, by resolved filesystem path (see the module header:
 * the SDK does not export this subpath yet). Kept as a single constant so the
 * interim deep-import is a one-line swap when the SDK exposes the subpath.
 */
const FLAG_BARREL_PATH = resolve(
  ROOT,
  'node_modules/@pellux/goodvibes-sdk/dist/platform/runtime/feature-flags/index.js',
);
const FLAGS_PATH = resolve(
  ROOT,
  'node_modules/@pellux/goodvibes-sdk/dist/platform/runtime/feature-flags/flags.js',
);

// ---------------------------------------------------------------------------
// Snapshot shapes — the exact serialisable rows the settings model consumes.
// ---------------------------------------------------------------------------

export interface ConfigSchemaEntrySnapshot {
  readonly key: string;
  readonly type: 'boolean' | 'number' | 'string' | 'enum';
  readonly default: unknown;
  readonly description: string;
  readonly enumValues?: readonly string[];
  readonly validationHint?: string;
}

export interface FeatureFlagSnapshot {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tier: number;
  readonly defaultState: 'enabled' | 'disabled' | 'killed';
  readonly runtimeToggleable: boolean;
}

export interface FeatureFlagConfigSnapshot {
  readonly configCategories: readonly string[];
  readonly configKeys: readonly string[];
}

export interface ConfigSchemaSnapshot {
  readonly entries: ConfigSchemaEntrySnapshot[];
  readonly flags: FeatureFlagSnapshot[];
  readonly flagConfig: Record<string, FeatureFlagConfigSnapshot>;
}

/** Read the real schema + feature-flag tables from the installed SDK. */
export async function loadSchemaSnapshot(): Promise<ConfigSchemaSnapshot> {
  const flagBarrel = (await import(pathToFileURL(FLAG_BARREL_PATH).href)) as {
    FEATURE_FLAG_CONFIG: Record<string, { configCategories: readonly string[]; configKeys: readonly string[] }>;
  };
  const flagsModule = (await import(pathToFileURL(FLAGS_PATH).href)) as {
    FEATURE_FLAGS: FeatureFlagSnapshot[];
  };

  const entries: ConfigSchemaEntrySnapshot[] = CONFIG_SCHEMA.map((s) => ({
    key: s.key,
    type: s.type,
    default: s.default,
    description: s.description,
    ...(s.enumValues ? { enumValues: [...s.enumValues] } : {}),
    ...(s.validationHint ? { validationHint: s.validationHint } : {}),
  }));

  const flags: FeatureFlagSnapshot[] = flagsModule.FEATURE_FLAGS.map((f) => ({
    id: f.id,
    name: f.name,
    description: f.description,
    tier: f.tier,
    defaultState: f.defaultState,
    runtimeToggleable: f.runtimeToggleable,
  }));

  const flagConfig: Record<string, FeatureFlagConfigSnapshot> = {};
  for (const [id, assoc] of Object.entries(flagBarrel.FEATURE_FLAG_CONFIG)) {
    flagConfig[id] = {
      configCategories: [...assoc.configCategories],
      configKeys: [...assoc.configKeys],
    };
  }

  return { entries, flags, flagConfig };
}

// ---------------------------------------------------------------------------
// Rendering — pure, deterministic for a given snapshot.
// ---------------------------------------------------------------------------

const GENERATED_BANNER = [
  'GENERATED FILE — DO NOT EDIT BY HAND.',
  'Produced by scripts/generate-config-schema.ts from the installed',
  "@pellux/goodvibes-sdk: CONFIG_SCHEMA (platform/config) plus the feature-flag",
  'registry (FEATURE_FLAGS) and its config association map (FEATURE_FLAG_CONFIG).',
  '',
  'This is a build-time snapshot so the browser bundle never imports the SDK',
  "config barrel (which drags SecretsManager / OAuth / google-auth — node-only).",
  '',
  'Regenerate: `bun run config-schema:generate`.',
  'Verify (no write): `bun run config-schema:check` — wired into `bun run build`,',
  'so an SDK schema change that was not regenerated fails the build.',
].join('\n * ');

export function renderTs(snapshot: ConfigSchemaSnapshot): string {
  const json = (value: unknown): string => JSON.stringify(value, null, 2);
  const text = [
    `/**\n * ${GENERATED_BANNER}\n */`,
    '',
    'export interface ConfigSchemaEntry {',
    '  readonly key: string;',
    "  readonly type: 'boolean' | 'number' | 'string' | 'enum';",
    '  readonly default: unknown;',
    '  readonly description: string;',
    '  readonly enumValues?: readonly string[];',
    '  readonly validationHint?: string;',
    '}',
    '',
    'export interface FeatureFlagMeta {',
    '  readonly id: string;',
    '  readonly name: string;',
    '  readonly description: string;',
    '  readonly tier: number;',
    "  readonly defaultState: 'enabled' | 'disabled' | 'killed';",
    '  readonly runtimeToggleable: boolean;',
    '}',
    '',
    'export interface FeatureFlagConfigAssoc {',
    '  readonly configCategories: readonly string[];',
    '  readonly configKeys: readonly string[];',
    '}',
    '',
    `export const CONFIG_SCHEMA_ENTRIES: readonly ConfigSchemaEntry[] = ${json(snapshot.entries)} as const;`,
    '',
    `export const FEATURE_FLAG_METAS: readonly FeatureFlagMeta[] = ${json(snapshot.flags)} as const;`,
    '',
    `export const FEATURE_FLAG_CONFIG_MAP: Readonly<Record<string, FeatureFlagConfigAssoc>> = ${json(snapshot.flagConfig)} as const;`,
    '',
  ].join('\n');
  return text.replace(/[ \t]+$/gm, '');
}

// ---------------------------------------------------------------------------
// CLI — generate-or-check against the checked-in artifact.
// ---------------------------------------------------------------------------

export function writeIfChanged(path: string, content: string, checkOnly: boolean): boolean {
  let current: string | null;
  try {
    current = readFileSync(path, 'utf8');
  } catch {
    current = null;
  }
  if (current === content) return false;
  if (checkOnly) {
    console.error(`[config-schema:check] drift: ${path}`);
    return true;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  console.log(`[config-schema:generate] wrote: ${path}`);
  return true;
}

if (import.meta.main) {
  const snapshot = await loadSchemaSnapshot();
  const drifted = writeIfChanged(TS_OUT_PATH, renderTs(snapshot), CHECK_ONLY);
  if (CHECK_ONLY && drifted) {
    console.error('[config-schema:check] drift detected — run `bun run config-schema:generate`');
    process.exit(1);
  }
  console.log(
    drifted
      ? '[config-schema:generate] done'
      : CHECK_ONLY
        ? '[config-schema:check] up-to-date'
        : '[config-schema:generate] up-to-date',
  );
}
