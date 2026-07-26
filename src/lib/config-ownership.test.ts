import { describe, expect, test } from 'bun:test';
import {
  DAEMON_OWNED_CONFIG_KEYS,
  DAEMON_OWNED_CONFIG_PREFIXES,
  isDaemonOwnedConfigKey,
} from './config-ownership';

describe('isDaemonOwnedConfigKey', () => {
  test('recognizes a key under every daemon-owned prefix', () => {
    // One representative key per DAEMON_OWNED_CONFIG_PREFIXES entry, mirroring the
    // SDK's config-ownership.ts prefix list exactly (see the module header for why
    // this is a maintained mirror rather than an import).
    expect(isDaemonOwnedConfigKey('surfaces.telegram.botToken')).toBe(true);
    expect(isDaemonOwnedConfigKey('controlPlane.bindHost')).toBe(true);
    expect(isDaemonOwnedConfigKey('httpListener.port')).toBe(true);
    expect(isDaemonOwnedConfigKey('web.enabled')).toBe(true);
    expect(isDaemonOwnedConfigKey('relay.enabled')).toBe(true);
    expect(isDaemonOwnedConfigKey('watchers.triggers.enabled')).toBe(true);
    expect(isDaemonOwnedConfigKey('device.capabilities.mode')).toBe(true);
    expect(isDaemonOwnedConfigKey('automation.schedulerEnabled')).toBe(true);
    expect(isDaemonOwnedConfigKey('checkin.cadence')).toBe(true);
    expect(isDaemonOwnedConfigKey('integrations.someProvider.enabled')).toBe(true);
    expect(isDaemonOwnedConfigKey('atRest.retentionDays')).toBe(true);
    expect(isDaemonOwnedConfigKey('voice.local.ttsVoicePath')).toBe(true);
  });

  test('recognizes the individual daemon-owned key that sits outside every prefix', () => {
    expect(isDaemonOwnedConfigKey('danger.httpListener')).toBe(true);
  });

  test('an ordinary client-owned key is not flagged', () => {
    expect(isDaemonOwnedConfigKey('display.theme')).toBe(false);
    expect(isDaemonOwnedConfigKey('provider.model')).toBe(false);
    expect(isDaemonOwnedConfigKey('behavior.hitlMode')).toBe(false);
  });

  test('daemon.* and service.* are deliberately NOT daemon-owned — per-installation lifecycle', () => {
    // "does THIS installation run/embed a daemon" is not the daemon's call to make;
    // making it daemon-owned would make one surface's daemon choice bind every other.
    expect(isDaemonOwnedConfigKey('daemon.enabled')).toBe(false);
    expect(isDaemonOwnedConfigKey('service.autostart')).toBe(false);
  });

  test('voice.wake.* is deliberately NOT daemon-owned — the wake word listens inside each client', () => {
    expect(isDaemonOwnedConfigKey('voice.wake.enabled')).toBe(false);
  });

  test('a key that only shares a prefix word, not the dotted prefix itself, is not flagged', () => {
    // "webhookRetryLimit" starts with "web" but not with the dotted prefix "web.".
    expect(isDaemonOwnedConfigKey('webhookRetryLimit')).toBe(false);
  });

  test('the mirrored lists are non-empty and exactly what this module documents', () => {
    expect(DAEMON_OWNED_CONFIG_PREFIXES).toEqual([
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
      'voice.local.',
    ]);
    expect(DAEMON_OWNED_CONFIG_KEYS).toEqual(['danger.httpListener']);
  });
});
