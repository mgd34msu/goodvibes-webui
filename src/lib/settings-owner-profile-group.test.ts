/**
 * The `profile.*` settings reach the web settings view as their own named group.
 *
 * docs/owner-profile.md §12.1 makes this registration mandatory rather than cosmetic in
 * the TUI and the agent, where a namespace with no matching category is silently dropped.
 * This webui derives its groups from the SDK schema with no hand-maintained category list,
 * so it cannot drop the domain — but without the CATEGORY_LABELS entry the group would
 * render as a Title-Cased "Profile", which collides in the reader's mind with
 * platform/profiles' saved display/provider presets. This pins the label AND the fact that
 * the eight keys actually arrive in the generated schema, so a regeneration that lost them
 * fails here rather than showing an empty section.
 */
import { describe, expect, test } from 'bun:test';
import { CONFIG_SCHEMA_ENTRIES } from './generated/config-schema';
import { categoryLabelForKey, CATEGORY_LABELS } from './config-redaction';
import { buildSettingsModel, groupLabelForNamespace } from './settings-model';

/**
 * §12's eight keys with the defaults that table gives them, plus the two
 * conversational-capture keys platform runtime 2.0.6 registered (capture on
 * by default; ownerChannels empty inherits the occasions nudge channel).
 */
const EXPECTED_KEYS: Record<string, unknown> = {
  'profile.enabled': true,
  'profile.autonomousWrites': true,
  'profile.discloseWrites': true,
  'profile.injectOpenTier': true,
  'profile.discloseClosedTierReads': true,
  'profile.consumerFallback': true,
  'profile.reloadThrottleMs': 2000,
  'profile.path': '',
  'profile.conversationalCapture': true,
  'profile.ownerChannels': '',
};

describe('the owner-profile settings group', () => {
  test('the generated schema carries all ten profile.* keys with their ruled defaults', () => {
    const byKey = new Map(CONFIG_SCHEMA_ENTRIES.map((entry) => [entry.key, entry]));
    for (const [key, expectedDefault] of Object.entries(EXPECTED_KEYS)) {
      const entry = byKey.get(key);
      expect(entry, `${key} missing from the generated config schema`).toBeDefined();
      expect(entry?.default, `${key} default`).toEqual(expectedDefault);
      // Every key is a real editable setting with a description, not a bare toggle.
      expect((entry?.description ?? '').length, `${key} has no description`).toBeGreaterThan(0);
    }
  });

  test('profile.* is exactly these ten keys — an eleventh would be an unregistered addition', () => {
    const keys = CONFIG_SCHEMA_ENTRIES.map((entry) => entry.key).filter((key) => key.startsWith('profile.'));
    expect(keys.sort()).toEqual(Object.keys(EXPECTED_KEYS).sort());
  });

  test('the group renders with a real name, not a Title-Cased key', () => {
    expect(CATEGORY_LABELS.profile).toBe('Owner Profile');
    expect(groupLabelForNamespace('profile')).toBe('Owner Profile');
    expect(categoryLabelForKey('profile.enabled')).toBe('Owner Profile');
    expect(categoryLabelForKey('profile.path')).toBe('Owner Profile');
  });

  test('the settings model builds one "Owner Profile" group holding those keys', () => {
    const groups = buildSettingsModel({});
    const group = groups.find((entry) => entry.id === 'profile');
    expect(group, 'no profile group was built').toBeDefined();
    expect(group?.label).toBe('Owner Profile');
    const rendered = new Set([
      ...(group?.plainRows ?? []).map((row) => row.key),
      ...(group?.featureUnits ?? []).flatMap((unit) => [
        ...(unit.enablementField ? [unit.enablementField.key] : []),
        ...unit.fields.map((field) => field.key),
      ]),
    ]);
    for (const key of Object.keys(EXPECTED_KEYS)) {
      expect(rendered.has(key), `${key} is not reachable in the settings modal`).toBe(true);
    }
  });
});
