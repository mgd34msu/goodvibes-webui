import { describe, expect, test } from 'bun:test';
import {
  DAEMON_OWNED_CONFIG_KEYS,
  DAEMON_OWNED_CONFIG_PREFIXES,
  DAEMON_OWNED_NON_SCHEMA_CONFIG_PATHS,
  isDaemonOwnedConfigKey,
} from './config-ownership';
import {
  DAEMON_OWNED_CONFIG_KEYS as SDK_DAEMON_OWNED_CONFIG_KEYS,
  DAEMON_OWNED_CONFIG_PREFIXES as SDK_DAEMON_OWNED_CONFIG_PREFIXES,
  DAEMON_OWNED_NON_SCHEMA_CONFIG_PATHS as SDK_DAEMON_OWNED_NON_SCHEMA_CONFIG_PATHS,
} from '@pellux/goodvibes-sdk/platform/config';

describe('isDaemonOwnedConfigKey', () => {
  test('recognizes a key under every daemon-owned prefix', () => {
    // One representative key per DAEMON_OWNED_CONFIG_PREFIXES entry, mirroring the
    // SDK's config-ownership.ts prefix list exactly (see the module header for why
    // this is a generated mirror rather than a live import).
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
    expect(isDaemonOwnedConfigKey('payments.enabled')).toBe(true);
    expect(isDaemonOwnedConfigKey('payments.budget.dailyItemCents')).toBe(true);
    expect(isDaemonOwnedConfigKey('voice.local.ttsVoicePath')).toBe(true);
    // Previously missing from the hand-maintained mirror (the drift this round fixes).
    expect(isDaemonOwnedConfigKey('conversationGate.mode')).toBe(true);
    expect(isDaemonOwnedConfigKey('cluster.enabled')).toBe(true);
  });

  test('recognizes the individual daemon-owned keys that sit outside every prefix', () => {
    expect(isDaemonOwnedConfigKey('danger.httpListener')).toBe(true);
    // The one daemon.* key that is NOT a per-installation switch — the daemon's
    // own location, which the payment capability's daily budgets roll over
    // against. Ruled and fixed upstream (SDK config-ownership.ts) after this
    // round's engineering report flagged it as an open question.
    expect(isDaemonOwnedConfigKey('daemon.timezone')).toBe(true);
  });

  test('recognizes every non-schema daemon-owned path — array-valued settings and the mail/calendar credential paths', () => {
    // Previously missing entirely: the hand-maintained mirror carried no
    // DAEMON_OWNED_NON_SCHEMA_CONFIG_PATHS list, so these read as client-owned
    // even though the daemon is the only process that can resolve and use them.
    expect(isDaemonOwnedConfigKey('conversationGate.gatedSurfaces')).toBe(true);
    expect(isDaemonOwnedConfigKey('cluster.peers')).toBe(true);
    expect(isDaemonOwnedConfigKey('cluster.groupMaterial')).toBe(true);
    expect(isDaemonOwnedConfigKey('email.passwordRef')).toBe(true);
    expect(isDaemonOwnedConfigKey('calendar.google.clientSecretRef')).toBe(true);
    expect(isDaemonOwnedConfigKey('calendar.microsoft.clientSecretRef')).toBe(true);
    expect(isDaemonOwnedConfigKey('google.oauth.refreshToken')).toBe(true);
    expect(isDaemonOwnedConfigKey('calendar.google.icsUrl')).toBe(true);
    expect(isDaemonOwnedConfigKey('email.enabled')).toBe(true);
    expect(isDaemonOwnedConfigKey('email.imapHost')).toBe(true);
    expect(isDaemonOwnedConfigKey('email.imapPort')).toBe(true);
    expect(isDaemonOwnedConfigKey('email.smtpHost')).toBe(true);
    expect(isDaemonOwnedConfigKey('email.smtpPort')).toBe(true);
    expect(isDaemonOwnedConfigKey('email.smtpSecurity')).toBe(true);
    expect(isDaemonOwnedConfigKey('email.username')).toBe(true);
    expect(isDaemonOwnedConfigKey('email.fromAddress')).toBe(true);
    expect(isDaemonOwnedConfigKey('calendar.google.clientId')).toBe(true);
    expect(isDaemonOwnedConfigKey('google.oauth.projectId')).toBe(true);
    expect(isDaemonOwnedConfigKey('google.oauth.publishingStatus')).toBe(true);
    expect(isDaemonOwnedConfigKey('google.credentials.migratedFrom')).toBe(true);
  });

  test('an ordinary client-owned key is not flagged', () => {
    expect(isDaemonOwnedConfigKey('display.theme')).toBe(false);
    expect(isDaemonOwnedConfigKey('provider.model')).toBe(false);
    expect(isDaemonOwnedConfigKey('behavior.hitlMode')).toBe(false);
  });

  test('daemon.* (other than daemon.timezone) and service.* are deliberately NOT daemon-owned — per-installation lifecycle', () => {
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
});

describe('the generated mirror matches the installed SDK exactly', () => {
  // This is the drift gate: it imports the REAL DAEMON_OWNED_* tables straight
  // from the installed @pellux/goodvibes-sdk package (safe to do in a test —
  // unlike src/lib/config-ownership.ts and its generated snapshot, a test file
  // never enters the browser bundle) and asserts this module's exported lists
  // are byte-for-byte identical, in the same order. If someone hand-edits
  // src/lib/generated/config-ownership.ts, or the checked-in snapshot is
  // stale relative to the installed SDK version, this fails here — not just
  // in `bun run config-ownership:check`.
  test('DAEMON_OWNED_CONFIG_PREFIXES matches the SDK', () => {
    expect(DAEMON_OWNED_CONFIG_PREFIXES).toEqual(SDK_DAEMON_OWNED_CONFIG_PREFIXES);
  });

  test('DAEMON_OWNED_CONFIG_KEYS matches the SDK', () => {
    expect(DAEMON_OWNED_CONFIG_KEYS).toEqual(SDK_DAEMON_OWNED_CONFIG_KEYS);
  });

  test('DAEMON_OWNED_NON_SCHEMA_CONFIG_PATHS matches the SDK', () => {
    expect(DAEMON_OWNED_NON_SCHEMA_CONFIG_PATHS).toEqual(SDK_DAEMON_OWNED_NON_SCHEMA_CONFIG_PATHS);
  });

  // MERGE NOTE (payments round): this used to be a whole-list literal, asserting
  // the mirrored arrays element-for-element in a fixed order. Two things killed
  // that shape. First, the lists are no longer hand-written here — they are
  // generated from the installed SDK, so a literal restates the generated file
  // rather than checking anything the three "matches the SDK" tests above do not
  // already check, and it churns on every SDK addition. Second, merging
  // credscope-webui with wo/payments-webui produced a literal NEITHER branch
  // wrote: git interleaved payments' 'payments.' with credscope's
  // 'conversationGate.'/'cluster.' in an order no one chose, and toEqual on an
  // array is order-sensitive, so it would have been asserting a guess.
  //
  // What is worth pinning is narrower and order-free: the specific entries these
  // two branches each argued for must survive the move to the generated
  // snapshot. If a regeneration ever drops one, that is a real ownership
  // regression — a card budget or a daemon timezone silently readable as
  // client-owned — and it fails here by name instead of inside a list diff.
  test('the entries the payments round added survive in the generated snapshot', () => {
    expect(DAEMON_OWNED_CONFIG_PREFIXES).toContain('payments.');
    expect(DAEMON_OWNED_CONFIG_KEYS).toContain('daemon.timezone');
  });

  test('the entries the credential-scope round added survive in the generated snapshot', () => {
    expect(DAEMON_OWNED_CONFIG_PREFIXES).toContain('conversationGate.');
    expect(DAEMON_OWNED_CONFIG_PREFIXES).toContain('cluster.');
  });
});
