import { describe, expect, test } from 'bun:test';
import {
  buildSettingsModel,
  filterSettingsModel,
  readConfigPath,
  liveLeafKeys,
  OWNED_CONFIG_KEYS,
  FEATURE_FLAGS_GROUP_ID,
  type SettingsGroupModel,
} from './settings-model';
import { FEATURE_FLAG_METAS, FEATURE_FLAG_CONFIG_MAP } from './generated/config-schema';

function groupById(groups: SettingsGroupModel[], id: string): SettingsGroupModel | undefined {
  return groups.find((g) => g.id === id);
}

describe('readConfigPath / liveLeafKeys', () => {
  test('reads nested dotted keys and reports presence', () => {
    const cfg = { surfaces: { slack: { botToken: 'x' } }, display: { theme: 'vaporwave' } };
    expect(readConfigPath(cfg, 'display.theme')).toEqual({ present: true, value: 'vaporwave' });
    expect(readConfigPath(cfg, 'surfaces.slack.botToken')).toEqual({ present: true, value: 'x' });
    expect(readConfigPath(cfg, 'surfaces.slack.missing')).toEqual({ present: false, value: undefined });
    expect(readConfigPath(cfg, 'nope.at.all')).toEqual({ present: false, value: undefined });
  });

  test('flattens leaf keys, treating arrays as leaves', () => {
    const cfg = { a: { b: 1, c: [1, 2] }, d: 'x' };
    expect(liveLeafKeys(cfg).sort()).toEqual(['a.b', 'a.c', 'd']);
  });
});

describe('buildSettingsModel — feature-unit grouping', () => {
  const groups = buildSettingsModel({});

  test('every schema namespace and the Feature Flags group is represented', () => {
    expect(groupById(groups, 'display')).toBeDefined();
    expect(groupById(groups, 'surfaces')).toBeDefined();
    expect(groupById(groups, FEATURE_FLAGS_GROUP_ID)).toBeDefined();
    expect(groupById(groups, FEATURE_FLAGS_GROUP_ID)?.label).toBe('Feature Flags');
  });

  test('a flag with config keys renders as a feature unit in its category group, not the flag group', () => {
    // slack-surface owns surfaces.* keys → lives in the Surfaces group.
    const surfaces = groupById(groups, 'surfaces');
    const slack = surfaces?.featureUnits.find((u) => u.flag.id === 'slack-surface');
    expect(slack).toBeDefined();
    expect(slack!.fields.length).toBeGreaterThan(0);
    // It must NOT appear in the synthetic Feature Flags group.
    const flagGroup = groupById(groups, FEATURE_FLAGS_GROUP_ID);
    expect(flagGroup?.featureUnits.some((u) => u.flag.id === 'slack-surface')).toBe(false);
  });

  test('a category-less flag is a simple toggle in the Feature Flags group', () => {
    // Find a flag the SDK maps to no config category.
    const loose = FEATURE_FLAG_METAS.find((f) => FEATURE_FLAG_CONFIG_MAP[f.id].configCategories.length === 0);
    expect(loose).toBeDefined();
    const flagGroup = groupById(groups, FEATURE_FLAGS_GROUP_ID);
    const unit = flagGroup?.featureUnits.find((u) => u.flag.id === loose!.id);
    expect(unit).toBeDefined();
    expect(unit!.fields.length).toBe(0);
  });

  test('config keys owned by a feature unit never double-list as orphan plain rows', () => {
    for (const group of groups) {
      for (const row of group.plainRows) {
        expect(OWNED_CONFIG_KEYS.has(row.key)).toBe(false);
      }
    }
    // And an owned key really is under some feature unit.
    const ownedSample = [...OWNED_CONFIG_KEYS][0];
    const underAUnit = groups.some((g) => g.featureUnits.some((u) => u.fields.some((f) => f.key === ownedSample)));
    expect(underAUnit).toBe(true);
  });

  test('flag state resolves from the live override, else the flag default', () => {
    const withOverride = buildSettingsModel({ featureFlags: { 'slack-surface': 'enabled' } });
    const surfaces = groupById(withOverride, 'surfaces');
    const slack = surfaces?.featureUnits.find((u) => u.flag.id === 'slack-surface');
    expect(slack?.state).toBe('enabled');
    expect(slack?.overridden).toBe(true);

    const surfacesDefault = groupById(groups, 'surfaces');
    const slackDefault = surfacesDefault?.featureUnits.find((u) => u.flag.id === 'slack-surface');
    expect(slackDefault?.overridden).toBe(false);
  });
});

describe('buildSettingsModel — honesty for unschema\'d live keys', () => {
  test('a live key with no schema entry renders as a raw row, never hidden', () => {
    const groups = buildSettingsModel({ mysteryDomain: { unknownKnob: 'held-by-daemon' } });
    const group = groupById(groups, 'mysteryDomain');
    expect(group).toBeDefined();
    expect(group!.rawRows.some((r) => r.key === 'mysteryDomain.unknownKnob')).toBe(true);
  });

  test('a schema key present in live config renders as a typed field with the live value', () => {
    const groups = buildSettingsModel({ display: { theme: 'cyberpunk' } });
    const display = groupById(groups, 'display');
    const themeField = display?.plainRows.find((f) => f.key === 'display.theme');
    expect(themeField?.present).toBe(true);
    expect(themeField?.liveValue).toBe('cyberpunk');
    expect(themeField?.type).toBe('string');
  });
});

describe('filterSettingsModel', () => {
  const groups = buildSettingsModel({});

  test('narrows to matching fields/units and drops empty groups', () => {
    const filtered = filterSettingsModel(groups, 'sanitizeMode');
    // fetch.sanitizeMode is owned by fetch-sanitization → its unit should survive.
    const fetch = groupById(filtered, 'fetch');
    expect(fetch).toBeDefined();
    // Unrelated groups drop.
    expect(groupById(filtered, 'display')).toBeUndefined();
  });

  test('a whole group survives when its label matches', () => {
    const filtered = filterSettingsModel(groups, 'Display');
    expect(groupById(filtered, 'display')).toBeDefined();
  });

  test('empty query returns the full model unchanged', () => {
    expect(filterSettingsModel(groups, '  ')).toBe(groups);
  });
});
