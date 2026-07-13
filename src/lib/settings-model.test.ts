import { describe, expect, test } from 'bun:test';
import {
  buildSettingsModel,
  filterSettingsModel,
  isFeatureEnabled,
  readConfigPath,
  liveLeafKeys,
  OWNED_CONFIG_KEYS,
  type SettingsGroupModel,
} from './settings-model';
import { FEATURE_SETTINGS } from './generated/config-schema';

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

describe('buildSettingsModel — domain grouping (dissolved feature model)', () => {
  const groups = buildSettingsModel({});

  test('every feature renders exactly once, inside its own domain group', () => {
    for (const feature of FEATURE_SETTINGS) {
      const holders = groups.filter((g) => g.featureUnits.some((u) => u.feature.id === feature.id));
      expect(holders.length).toBe(1);
      expect(holders[0].id).toBe(feature.domain);
    }
  });

  test('no enablement-bucket group survives: every group is a real config namespace', () => {
    expect(groups.some((g) => g.id.startsWith('__'))).toBe(false);
    expect(groups.some((g) => g.label === 'Feature Flags')).toBe(false);
  });

  test('a boolean feature exposes its domain key as the enablement field, not a duplicate row', () => {
    const web = groupById(groups, 'web');
    const unit = web?.featureUnits.find((u) => u.feature.id === 'web-surface');
    expect(unit).toBeDefined();
    expect(unit!.enablementField?.key).toBe('web.enabled');
    expect(unit!.enablementField?.type).toBe('boolean');
    // The enablement key never repeats in the unit's ordinary field list.
    expect(unit!.fields.some((f) => f.key === 'web.enabled')).toBe(false);
    expect(unit!.fields.length).toBeGreaterThan(0);
  });

  test('an enum feature exposes the full schema mode set, including inactive modes', () => {
    const behavior = groupById(groups, 'behavior');
    const unit = behavior?.featureUnits.find((u) => u.feature.id === 'hitl-ux-modes');
    expect(unit).toBeDefined();
    expect(unit!.enablementField?.type).toBe('enum');
    // The real option shape: every schema mode is a choice, "off" included,
    // while enabledValues stays the smaller activation subset.
    expect(unit!.enablementField?.enumValues).toEqual(['off', 'quiet', 'balanced', 'operator']);
    expect(unit!.feature.enablement.enabledValues).toEqual(['quiet', 'balanced', 'operator']);
  });

  test('a constant feature has no separate enablement control; its own keys govern it', () => {
    const surfaces = groupById(groups, 'surfaces');
    const unit = surfaces?.featureUnits.find((u) => u.feature.id === 'slack-surface');
    expect(unit).toBeDefined();
    expect(unit!.enablementField).toBeNull();
    // Its settings keys (the honest switches) render as ordinary typed fields,
    // enablement key first.
    expect(unit!.fields[0]?.key).toBe('surfaces.slack.enabled');
  });

  test('config keys owned by a feature unit never double-list as orphan plain rows', () => {
    for (const group of groups) {
      for (const row of group.plainRows) {
        expect(OWNED_CONFIG_KEYS.has(row.key)).toBe(false);
      }
    }
    const ownedSample = [...OWNED_CONFIG_KEYS][0];
    const underAUnit = groups.some((g) =>
      g.featureUnits.some(
        (u) => u.enablementField?.key === ownedSample || u.fields.some((f) => f.key === ownedSample),
      ),
    );
    expect(underAUnit).toBe(true);
  });
});

describe('buildSettingsModel — enablement state from domain settings keys', () => {
  test('a stock config resolves every feature to its ruled default (40 on / 15 dark)', () => {
    const groups = buildSettingsModel({});
    const units = groups.flatMap((g) => g.featureUnits);
    expect(units.length).toBe(FEATURE_SETTINGS.length);
    for (const unit of units) {
      expect(unit.enabled).toBe(unit.feature.defaultEnabled);
      expect(unit.explicit).toBe(false);
    }
    expect(units.filter((u) => u.enabled).length).toBe(40);
    expect(units.filter((u) => !u.enabled).length).toBe(15);
  });

  test('a boolean feature reads its live domain key', () => {
    const groups = buildSettingsModel({ permissions: { simulation: false } });
    const unit = groupById(groups, 'permissions')?.featureUnits.find(
      (u) => u.feature.id === 'permissions-simulation',
    );
    expect(unit?.enabled).toBe(false);
    expect(unit?.explicit).toBe(true);
  });

  test('an enum feature is active only while its key holds an activating mode', () => {
    const off = buildSettingsModel({ behavior: { hitlMode: 'off' } });
    const offUnit = groupById(off, 'behavior')?.featureUnits.find((u) => u.feature.id === 'hitl-ux-modes');
    expect(offUnit?.enabled).toBe(false);
    expect(offUnit?.explicit).toBe(true);

    const quiet = buildSettingsModel({ behavior: { hitlMode: 'quiet' } });
    const quietUnit = groupById(quiet, 'behavior')?.featureUnits.find((u) => u.feature.id === 'hitl-ux-modes');
    expect(quietUnit?.enabled).toBe(true);
  });

  test('isFeatureEnabled applies the enablement shape', () => {
    const boolFeature = FEATURE_SETTINGS.find((f) => f.id === 'web-surface')!;
    expect(isFeatureEnabled(boolFeature, true)).toBe(true);
    expect(isFeatureEnabled(boolFeature, false)).toBe(false);
    expect(isFeatureEnabled(boolFeature, 'true')).toBe(false);

    const enumFeature = FEATURE_SETTINGS.find((f) => f.id === 'hitl-ux-modes')!;
    expect(isFeatureEnabled(enumFeature, 'operator')).toBe(true);
    expect(isFeatureEnabled(enumFeature, 'off')).toBe(false);

    const constantFeature = FEATURE_SETTINGS.find((f) => f.id === 'fetch-sanitization')!;
    expect(isFeatureEnabled(constantFeature, undefined)).toBe(true);
  });
});

describe("buildSettingsModel — honesty for unschema'd live keys", () => {
  test('a live key with no schema entry renders as a raw row, never hidden', () => {
    const groups = buildSettingsModel({ mysteryDomain: { unknownKnob: 'held-by-daemon' } });
    const group = groupById(groups, 'mysteryDomain');
    expect(group).toBeDefined();
    expect(group!.rawRows.some((r) => r.key === 'mysteryDomain.unknownKnob')).toBe(true);
  });

  test("an older daemon's leftover featureFlags record stays visible, without the dead category name", () => {
    const groups = buildSettingsModel({ featureFlags: { 'exec-sandbox': 'enabled' } });
    const group = groupById(groups, 'featureFlags');
    expect(group).toBeDefined();
    expect(group!.rawRows.some((r) => r.key === 'featureFlags.exec-sandbox')).toBe(true);
    expect(group!.label).toBe('Legacy Toggles');
    expect(groups.some((g) => g.label === 'Feature Flags')).toBe(false);
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
    // fetch.sanitizeMode belongs to fetch-sanitization → its unit survives.
    const fetch = groupById(filtered, 'fetch');
    expect(fetch).toBeDefined();
    expect(groupById(filtered, 'display')).toBeUndefined();
  });

  test('matches a feature by its human name', () => {
    const filtered = filterSettingsModel(groups, 'permissions simulation');
    const permissions = groupById(filtered, 'permissions');
    expect(permissions?.featureUnits.some((u) => u.feature.id === 'permissions-simulation')).toBe(true);
  });

  test('matches an enum feature by its enablement key', () => {
    const filtered = filterSettingsModel(groups, 'hitlMode');
    const behavior = groupById(filtered, 'behavior');
    expect(behavior?.featureUnits.some((u) => u.feature.id === 'hitl-ux-modes')).toBe(true);
  });

  test('a whole group survives when its label matches', () => {
    const filtered = filterSettingsModel(groups, 'Display');
    expect(groupById(filtered, 'display')).toBeDefined();
  });

  test('empty query returns the full model unchanged', () => {
    expect(filterSettingsModel(groups, '  ')).toBe(groups);
  });
});

describe('object-typed schema keys (pricing.modelPrices)', () => {
  const livePrices = {
    'openrouter:deepseek/deepseek-chat': { input: 0.14, output: 0.28 },
    'bedrock:us.anthropic.claude-3-5:0': { input: 3, output: 15 },
  };
  const groups = buildSettingsModel({ pricing: { modelPrices: livePrices } });
  const pricing = groupById(groups, 'pricing');

  test('the object key renders as ONE typed field carrying its live object value', () => {
    expect(pricing).toBeDefined();
    const field = pricing!.plainRows.find((f) => f.key === 'pricing.modelPrices');
    expect(field).toBeDefined();
    expect(field!.type).toBe('object');
    expect(field!.present).toBe(true);
    expect(field!.liveValue).toEqual(livePrices);
    expect(field!.description.length).toBeGreaterThan(0);
  });

  test('live entries under the object key never leak into unschema raw rows', () => {
    for (const group of groups) {
      expect(group.rawRows.filter((r) => r.key.startsWith('pricing.modelPrices'))).toEqual([]);
    }
  });

  test('liveLeafKeys honors the stop-set so dotted model ids stay intact', () => {
    const keys = liveLeafKeys(
      { pricing: { modelPrices: livePrices }, display: { theme: 'x' } },
      '',
      new Set(['pricing.modelPrices']),
    );
    expect(keys.sort()).toEqual(['display.theme', 'pricing.modelPrices']);
  });

  test('an absent object key still renders with its schema default', () => {
    const bare = buildSettingsModel({});
    const field = groupById(bare, 'pricing')?.plainRows.find((f) => f.key === 'pricing.modelPrices');
    expect(field).toBeDefined();
    expect(field!.present).toBe(false);
    expect(field!.default).toEqual({});
  });
});

describe('new settings keys from the snapshot schema', () => {
  const groups = buildSettingsModel({});
  const allFieldKeys = groups.flatMap((g) => [
    ...g.plainRows.map((f) => f.key),
    ...g.featureUnits.flatMap((u) => [
      ...(u.enablementField ? [u.enablementField.key] : []),
      ...u.fields.map((f) => f.key),
    ]),
  ]);

  test.each([
    'pricing.modelPrices',
    'notifications.pushApproval',
    'notifications.pushNeedsInput',
    'notifications.pushCompletion',
    'watchers.ciPollIntervalMs',
    'update.auto',
    'update.intervalMinutes',
    'update.releasesUrl',
    'surfaces.msteams.enabled',
    'surfaces.bluebubbles.enabled',
    'surfaces.mattermost.enabled',
    'surfaces.matrix.enabled',
    'surfaces.googleChat.enabled',
    'surfaces.imessage.enabled',
    'surfaces.signal.enabled',
    'surfaces.telegram.enabled',
    'surfaces.telephony.enabled',
    'surfaces.whatsapp.enabled',
  ])('%s renders somewhere in the model with a description', (key) => {
    expect(allFieldKeys).toContain(key);
    const field = groups
      .flatMap((g) => [...g.plainRows, ...g.featureUnits.flatMap((u) => [...(u.enablementField ? [u.enablementField] : []), ...u.fields])])
      .find((f) => f.key === key);
    expect(field?.description.length ?? 0).toBeGreaterThan(0);
  });

  test('new surface credential keys are secret-masked', () => {
    for (const key of [
      'surfaces.msteams.appPassword',
      'surfaces.bluebubbles.password',
      'surfaces.mattermost.botToken',
      'surfaces.matrix.accessToken',
    ]) {
      const field = groups
        .flatMap((g) => [...g.plainRows, ...g.featureUnits.flatMap((u) => u.fields)])
        .find((f) => f.key === key);
      expect(field, key).toBeDefined();
      expect(field!.isSecret, key).toBe(true);
    }
  });
});
