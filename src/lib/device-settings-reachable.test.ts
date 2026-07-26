/**
 * device-settings-reachable.test.ts — the `device.*` config keys are reachable
 * and readable in the settings workspace.
 *
 * The paired-phone feature is configured entirely through config keys, so a key
 * that exists in the SDK schema but never surfaces in this app is a feature the
 * owner cannot actually configure. This pins three things: every device key is
 * routed into a group, that group carries a real human label rather than a raw
 * namespace, and every key carries a written purpose long enough to be a
 * description rather than a restatement of its own name.
 */
import { describe, expect, test } from 'bun:test';
import { buildSettingsModel } from './settings-model';
import { CONFIG_SCHEMA_ENTRIES } from './generated/config-schema';

const DEVICE_KEYS = CONFIG_SCHEMA_ENTRIES.filter((entry) => entry.key.startsWith('device.')).map((entry) => entry.key);

describe('paired-phone settings reachability', () => {
  test('the SDK schema actually carries the device keys this app expects', () => {
    expect(DEVICE_KEYS).toContain('device.capabilities.mode');
    expect(DEVICE_KEYS).toContain('device.capabilities.allowAlwaysOffer');
    expect(DEVICE_KEYS).toContain('device.clipboard.readMode');
    expect(DEVICE_KEYS).toContain('device.capture.retentionHours');
    expect(DEVICE_KEYS.length).toBeGreaterThanOrEqual(12);
  });

  test('every device key is routed into the settings workspace', () => {
    const groups = buildSettingsModel({});
    // A device key surfaces either as a plain row or as one of the paired-phone
    // feature's own fields; both are reachable, so both count.
    const routed = new Set(groups.flatMap((group) => [
      ...group.plainRows.map((row) => row.key),
      ...group.featureUnits.flatMap((unit) => [
        ...(unit.enablementField ? [unit.enablementField.key] : []),
        ...unit.fields.map((field) => field.key),
      ]),
    ]));
    expect(DEVICE_KEYS.filter((key) => !routed.has(key))).toEqual([]);
  });

  test('the device group renders a real human label, not a raw namespace', () => {
    const groups = buildSettingsModel({});
    const deviceGroup = groups.find((group) => group.id === 'device');
    expect(deviceGroup).toBeDefined();
    expect(deviceGroup?.label).toBe('Paired Phone Capabilities');
  });

  test('stock values match the owner rulings: ask first, always-allow offered everywhere, 24h captures', () => {
    const byKey = new Map(CONFIG_SCHEMA_ENTRIES.map((entry) => [entry.key, entry]));
    expect(byKey.get('device.capabilities.mode')?.default).toBe('honor-grants');
    expect(byKey.get('device.capabilities.allowAlwaysOffer')?.default).toBe('every-capability');
    expect(byKey.get('device.clipboard.readMode')?.default).toBe('grantable');
    expect(byKey.get('device.location.precision')?.default).toBe('precise-grantable');
    expect(byKey.get('device.capture.retentionHours')?.default).toBe(24);
  });

  test('every device key ships a written purpose, never a bare toggle label', () => {
    for (const key of DEVICE_KEYS) {
      const entry = CONFIG_SCHEMA_ENTRIES.find((candidate) => candidate.key === key);
      expect(entry?.description.length ?? 0).toBeGreaterThan(80);
      expect(entry?.type).not.toBe('boolean');
    }
  });
});
