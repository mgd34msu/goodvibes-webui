/**
 * settings-model.ts — the schema-driven, feature-unit grouping the settings
 * surface renders from. Pure and deterministic: it takes the daemon's live
 * config snapshot (config.get) and the SDK's generated schema + feature-flag
 * metadata, and produces the ordered group / feature-unit / row structure the
 * SettingsModal walks. No React, no I/O — fully unit-testable.
 *
 * Grouping rules (owner ruling, 2026-07-11 — every feature is ONE unit):
 *   - A feature flag renders as a FEATURE UNIT: its enable toggle together with
 *     the typed editors for the config keys it owns (FEATURE_FLAG_CONFIG_MAP),
 *     placed in the topical group its first config category implies. A flag with
 *     no config category/keys is a simple toggle in the synthetic "Feature Flags"
 *     group.
 *   - A config key owned by a feature unit is NOT double-listed as an orphan row
 *     in its namespace group (ownership wins).
 *   - Schema keys owned by no flag render as typed "plain" rows under their
 *     namespace group.
 *   - Keys present in the LIVE config but absent from the schema still render (as
 *     read-only raw rows) so nothing the daemon actually holds becomes invisible.
 *
 * Grouping SOURCE is SDK metadata (CONFIG_SCHEMA namespaces + each flag's
 * configCategories), never a hand-copied category list — so cross-surface parity
 * with the TUI is structural. config-redaction.ts's CATEGORY_LABELS supplies only
 * the human display label for a namespace (special-casing acronyms), with a
 * Title Case fallback for any namespace it has not special-cased.
 */
import {
  CONFIG_SCHEMA_ENTRIES,
  FEATURE_FLAG_METAS,
  FEATURE_FLAG_CONFIG_MAP,
  type ConfigSchemaEntry,
  type FeatureFlagMeta,
} from './generated/config-schema';
import { categoryLabelForKey, CATEGORY_LABELS, isSecretConfigKey } from './config-redaction';
import { asRecord } from './object';

/** Synthetic group id/label for flags that own no config keys. */
export const FEATURE_FLAGS_GROUP_ID = '__feature-flags__';
export const FEATURE_FLAGS_GROUP_LABEL = 'Feature Flags';

export type FlagState = 'enabled' | 'disabled' | 'killed';

/** A single typed, editable config field: schema metadata merged with its live value. */
export interface ConfigFieldModel {
  readonly key: string;
  readonly type: ConfigSchemaEntry['type'];
  readonly enumValues?: readonly string[];
  readonly default: unknown;
  readonly description: string;
  readonly validationHint?: string;
  /** The live value from config.get (undefined when the key is absent from the live tree). */
  readonly liveValue: unknown;
  /** Whether the live config tree actually holds this key (vs. only the schema default). */
  readonly present: boolean;
  readonly isSecret: boolean;
}

/** A live-config key with no schema entry — shown read-only so nothing is hidden. */
export interface RawRowModel {
  readonly key: string;
  readonly value: unknown;
  readonly isSecret: boolean;
}

/** A feature flag rendered as one unit: its toggle plus the fields it governs. */
export interface FeatureUnitModel {
  readonly flag: FeatureFlagMeta;
  /** Resolved current state: the live override if present, else the flag's default. */
  readonly state: FlagState;
  /** True when the live config carries an explicit override for this flag. */
  readonly overridden: boolean;
  readonly fields: readonly ConfigFieldModel[];
}

export interface SettingsGroupModel {
  readonly id: string;
  readonly label: string;
  readonly featureUnits: readonly FeatureUnitModel[];
  readonly plainRows: readonly ConfigFieldModel[];
  readonly rawRows: readonly RawRowModel[];
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Read a dotted key from a nested config object; returns { present, value }. */
export function readConfigPath(config: unknown, key: string): { present: boolean; value: unknown } {
  const segments = key.split('.');
  let cursor: unknown = config;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== 'object' || Array.isArray(cursor)) {
      return { present: false, value: undefined };
    }
    const record = cursor as Record<string, unknown>;
    if (!(segment in record)) return { present: false, value: undefined };
    cursor = record[segment];
  }
  return { present: true, value: cursor };
}

/** All dotted leaf keys held in the live config (objects descended, arrays are leaves). */
export function liveLeafKeys(config: unknown, prefix = ''): string[] {
  const record = asRecord(config);
  const keys = Object.keys(record);
  if (keys.length === 0) return [];
  const out: string[] = [];
  for (const key of keys) {
    const full = prefix ? `${prefix}.${key}` : key;
    const item = record[key];
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      out.push(...liveLeafKeys(item, full));
    } else {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Field construction
// ---------------------------------------------------------------------------

const SCHEMA_BY_KEY = new Map<string, ConfigSchemaEntry>(CONFIG_SCHEMA_ENTRIES.map((e) => [e.key, e]));

/** Every config key owned by at least one feature flag (excluded from orphan rows). */
export const OWNED_CONFIG_KEYS: ReadonlySet<string> = new Set(
  FEATURE_FLAG_METAS.flatMap((f) => [...(FEATURE_FLAG_CONFIG_MAP[f.id]?.configKeys ?? [])]),
);

function buildField(entry: ConfigSchemaEntry, config: unknown): ConfigFieldModel {
  const { present, value } = readConfigPath(config, entry.key);
  return {
    key: entry.key,
    type: entry.type,
    enumValues: entry.enumValues,
    default: entry.default,
    description: entry.description,
    validationHint: entry.validationHint,
    liveValue: value,
    present,
    isSecret: isSecretConfigKey(entry.key),
  };
}

function namespaceOf(key: string): string {
  return key.split('.')[0] ?? key;
}

/** Human label for a namespace: CATEGORY_LABELS special-case, else Title Case. */
export function groupLabelForNamespace(namespace: string): string {
  // categoryLabelForKey applies CATEGORY_LABELS with a titleCase fallback; a
  // namespace with no special-case maps to a Title Case of itself.
  if (namespace in CATEGORY_LABELS) return CATEGORY_LABELS[namespace];
  return categoryLabelForKey(`${namespace}.x`);
}

// ---------------------------------------------------------------------------
// Model construction
// ---------------------------------------------------------------------------

/** The topical namespace a flag's unit lives under (its first config category), or null. */
function flagNamespace(flag: FeatureFlagMeta): string | null {
  return FEATURE_FLAG_CONFIG_MAP[flag.id]?.configCategories[0] ?? null;
}

function resolveFlagState(config: unknown, flagId: string, fallback: FlagState): {
  state: FlagState;
  overridden: boolean;
} {
  const overrides = asRecord(readConfigPath(config, 'featureFlags').value);
  const raw = overrides[flagId];
  if (raw === 'enabled' || raw === 'disabled' || raw === 'killed') {
    return { state: raw, overridden: true };
  }
  return { state: fallback, overridden: false };
}

/**
 * Build the ordered settings model from the live config snapshot.
 *
 * Group order: namespaces in CONFIG_SCHEMA order (first appearance), then any
 * live-only namespaces the schema does not know, then the synthetic Feature
 * Flags group for category-less flags.
 */
export function buildSettingsModel(liveConfig: unknown): SettingsGroupModel[] {
  // 1. Ordered namespace list from the schema (first appearance wins).
  const orderedNamespaces: string[] = [];
  const seen = new Set<string>();
  for (const entry of CONFIG_SCHEMA_ENTRIES) {
    const ns = namespaceOf(entry.key);
    if (!seen.has(ns)) {
      seen.add(ns);
      orderedNamespaces.push(ns);
    }
  }

  // 2. Feature units grouped by their topical namespace; category-less flags held aside.
  const unitsByNamespace = new Map<string, FeatureUnitModel[]>();
  const looseFlags: FeatureUnitModel[] = [];
  const flagsSorted = [...FEATURE_FLAG_METAS].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  for (const flag of flagsSorted) {
    const assoc = FEATURE_FLAG_CONFIG_MAP[flag.id];
    const fields = (assoc?.configKeys ?? [])
      .map((k) => SCHEMA_BY_KEY.get(k))
      .filter((e): e is ConfigSchemaEntry => Boolean(e))
      .map((e) => buildField(e, liveConfig));
    const { state, overridden } = resolveFlagState(liveConfig, flag.id, flag.defaultState);
    const unit: FeatureUnitModel = { flag, state, overridden, fields };
    const ns = flagNamespace(flag);
    if (ns === null) {
      looseFlags.push(unit);
    } else {
      const list = unitsByNamespace.get(ns) ?? [];
      list.push(unit);
      unitsByNamespace.set(ns, list);
      if (!seen.has(ns)) {
        seen.add(ns);
        orderedNamespaces.push(ns);
      }
    }
  }

  // 3. Live-only namespaces the schema does not cover (excluding the flag store).
  const liveKeys = liveLeafKeys(liveConfig);
  for (const key of liveKeys) {
    const ns = namespaceOf(key);
    if (ns === 'featureFlags') continue;
    if (!seen.has(ns)) {
      seen.add(ns);
      orderedNamespaces.push(ns);
    }
  }

  const schemaKeySet = new Set(CONFIG_SCHEMA_ENTRIES.map((e) => e.key));

  // 4. Assemble each namespace group.
  const groups: SettingsGroupModel[] = [];
  for (const ns of orderedNamespaces) {
    const featureUnits = unitsByNamespace.get(ns) ?? [];

    const plainRows = CONFIG_SCHEMA_ENTRIES.filter(
      (e) => namespaceOf(e.key) === ns && !OWNED_CONFIG_KEYS.has(e.key),
    ).map((e) => buildField(e, liveConfig));

    const rawRows: RawRowModel[] = liveKeys
      .filter(
        (k) =>
          namespaceOf(k) === ns &&
          k !== 'featureFlags' &&
          !schemaKeySet.has(k) &&
          !OWNED_CONFIG_KEYS.has(k),
      )
      .map((k) => ({ key: k, value: readConfigPath(liveConfig, k).value, isSecret: isSecretConfigKey(k) }));

    if (featureUnits.length === 0 && plainRows.length === 0 && rawRows.length === 0) continue;

    groups.push({
      id: ns,
      label: groupLabelForNamespace(ns),
      featureUnits,
      plainRows,
      rawRows,
    });
  }

  // 5. Synthetic Feature Flags group for category-less flags (simple toggles).
  if (looseFlags.length > 0) {
    groups.push({
      id: FEATURE_FLAGS_GROUP_ID,
      label: FEATURE_FLAGS_GROUP_LABEL,
      featureUnits: looseFlags,
      plainRows: [],
      rawRows: [],
    });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Search / filter
// ---------------------------------------------------------------------------

function fieldMatches(field: ConfigFieldModel, q: string): boolean {
  return field.key.toLowerCase().includes(q) || field.description.toLowerCase().includes(q);
}

function unitMatches(unit: FeatureUnitModel, q: string): boolean {
  return (
    unit.flag.id.toLowerCase().includes(q) ||
    unit.flag.name.toLowerCase().includes(q) ||
    unit.flag.description.toLowerCase().includes(q) ||
    unit.fields.some((f) => fieldMatches(f, q))
  );
}

/**
 * Filter the model by a free-text query across group labels, flag id/name/
 * description, and config key/description. A group matches wholly when its label
 * matches; otherwise it is narrowed to matching units and rows. Empty groups drop.
 */
export function filterSettingsModel(groups: SettingsGroupModel[], query: string): SettingsGroupModel[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  const out: SettingsGroupModel[] = [];
  for (const group of groups) {
    if (group.label.toLowerCase().includes(q)) {
      out.push(group);
      continue;
    }
    const featureUnits = group.featureUnits
      .map((u) =>
        unitMatches(u, q)
          ? u
          : { ...u, fields: u.fields.filter((f) => fieldMatches(f, q)) },
      )
      .filter((u) => unitMatches(u, q) || u.fields.length > 0);
    const plainRows = group.plainRows.filter((f) => fieldMatches(f, q));
    const rawRows = group.rawRows.filter((r) => r.key.toLowerCase().includes(q));
    if (featureUnits.length === 0 && plainRows.length === 0 && rawRows.length === 0) continue;
    out.push({ ...group, featureUnits, plainRows, rawRows });
  }
  return out;
}
