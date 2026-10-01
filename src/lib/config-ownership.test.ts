/**
 * config-ownership.test.ts: the daemon-owned badge reads from a generated snapshot
 * of the SDK's ownership tables (src/lib/generated/config-ownership.ts). The failure
 * this file exists to catch is the one the old hand-maintained mirror had: the
 * snapshot or the predicate on top of it drifting from what the installed SDK says.
 *
 * So the load-bearing checks compare against the SDK directly, under bun where the
 * node-only config barrel is importable:
 *   - the three snapshot tables equal the SDK's tables (a hand edit to the generated
 *     file, or a pin bump without `bun run release:prepare`, fails here);
 *   - the local predicate agrees with the SDK's own isDaemonOwnedConfigKey for every
 *     schema key plus every non-schema path, so the derivation cannot drift either.
 *
 * The few literal cases below are the rulings a user sees in the badge; they are kept
 * as readable statements of intent, not as the drift check.
 */
import { describe, expect, test } from 'bun:test';
import {
  DAEMON_OWNED_CONFIG_KEYS as SDK_KEYS,
  DAEMON_OWNED_CONFIG_PREFIXES as SDK_PREFIXES,
  DAEMON_OWNED_NON_SCHEMA_CONFIG_PATHS as SDK_NON_SCHEMA_PATHS,
  isDaemonOwnedConfigKey as sdkIsDaemonOwnedConfigKey,
} from '@pellux/goodvibes-sdk/platform/config';
import {
  DAEMON_OWNED_CONFIG_KEYS,
  DAEMON_OWNED_CONFIG_PREFIXES,
  DAEMON_OWNED_NON_SCHEMA_CONFIG_PATHS,
  isDaemonOwnedConfigKey,
} from './config-ownership';
import { CONFIG_SCHEMA_ENTRIES } from './generated/config-schema';

const sorted = (values: readonly string[]): string[] => [...values].sort();

describe('the generated snapshot matches the installed SDK', () => {
  test('prefixes, keys and non-schema paths are the SDK tables, entry for entry', () => {
    expect(sorted(DAEMON_OWNED_CONFIG_PREFIXES)).toEqual(sorted(SDK_PREFIXES));
    expect(sorted(DAEMON_OWNED_CONFIG_KEYS)).toEqual(sorted(SDK_KEYS));
    expect(sorted(DAEMON_OWNED_NON_SCHEMA_CONFIG_PATHS)).toEqual(sorted(SDK_NON_SCHEMA_PATHS));
  });

  test('the tables are not empty, so equality above is not vacuous', () => {
    expect(SDK_PREFIXES.length).toBeGreaterThan(0);
    expect(SDK_NON_SCHEMA_PATHS.length).toBeGreaterThan(0);
  });
});

describe('the local predicate agrees with the SDK predicate', () => {
  const corpus = [
    ...CONFIG_SCHEMA_ENTRIES.map((entry) => entry.key),
    ...SDK_NON_SCHEMA_PATHS,
    ...SDK_KEYS,
    // Keys that share a prefix WORD but not the dotted prefix, and keys under no namespace.
    'webhookRetryLimit',
    'relayed.enabled',
    'surfacesX.y',
    'daemon',
    '',
  ];

  test('for every schema key, every non-schema path, and the prefix-collision shapes', () => {
    const disagreements = corpus.filter((key) => isDaemonOwnedConfigKey(key) !== sdkIsDaemonOwnedConfigKey(key));
    expect(disagreements).toEqual([]);
    // Both answers occur in the corpus, so agreement is not "everything is false".
    expect(corpus.some((key) => isDaemonOwnedConfigKey(key))).toBe(true);
    expect(corpus.some((key) => !isDaemonOwnedConfigKey(key))).toBe(true);
  });
});

describe('the rulings the badge shows', () => {
  test('surfaces, control plane, payments and the mail/calendar credential paths are daemon-owned', () => {
    expect(isDaemonOwnedConfigKey('surfaces.telegram.botToken')).toBe(true);
    expect(isDaemonOwnedConfigKey('controlPlane.bindHost')).toBe(true);
    expect(isDaemonOwnedConfigKey('payments.budget.dailyItem')).toBe(true);
    expect(isDaemonOwnedConfigKey('email.passwordRef')).toBe(true);
    expect(isDaemonOwnedConfigKey('calendar.google.icsUrl')).toBe(true);
  });

  test('daemon.timezone is the one daemon.* key the daemon owns; daemon.enabled and service.* are per-installation', () => {
    expect(isDaemonOwnedConfigKey('daemon.timezone')).toBe(true);
    expect(isDaemonOwnedConfigKey('daemon.enabled')).toBe(false);
    expect(isDaemonOwnedConfigKey('service.autostart')).toBe(false);
  });

  test('client-side settings are not daemon-owned: display, provider, behavior, and the wake word that listens in each client', () => {
    expect(isDaemonOwnedConfigKey('display.theme')).toBe(false);
    expect(isDaemonOwnedConfigKey('provider.model')).toBe(false);
    expect(isDaemonOwnedConfigKey('behavior.hitlMode')).toBe(false);
    expect(isDaemonOwnedConfigKey('voice.wake.enabled')).toBe(false);
  });

  test('a key that only shares a prefix word, not the dotted prefix, is not flagged', () => {
    expect(isDaemonOwnedConfigKey('webhookRetryLimit')).toBe(false);
  });
});
