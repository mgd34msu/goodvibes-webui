import { describe, expect, test } from 'bun:test';
import {
  GOODVIBES_BASE_URL,
  WEBUI_SURFACE_ID,
  WEBUI_SURFACE_KIND,
  WEBUI_TOKEN_STORE_KEY,
  isRuntimeDomain,
  isExtraRoutedMethod,
} from './goodvibes';

describe('goodvibes constants', () => {
  test('WEBUI_SURFACE_KIND is webui', () => {
    expect(WEBUI_SURFACE_KIND).toBe('webui');
  });

  test('WEBUI_SURFACE_ID is goodvibes-webui', () => {
    expect(WEBUI_SURFACE_ID).toBe('goodvibes-webui');
  });

  test('WEBUI_TOKEN_STORE_KEY is a non-empty string', () => {
    expect(typeof WEBUI_TOKEN_STORE_KEY).toBe('string');
    expect(WEBUI_TOKEN_STORE_KEY.length).toBeGreaterThan(0);
  });

  test('GOODVIBES_BASE_URL is a non-empty string', () => {
    expect(typeof GOODVIBES_BASE_URL).toBe('string');
    expect(GOODVIBES_BASE_URL.length).toBeGreaterThan(0);
  });
});

describe('isRuntimeDomain', () => {
  test('returns true for known domains', () => {
    const known = [
      'session', 'turn', 'providers', 'tools', 'tasks', 'agents', 'workflows',
      'orchestration', 'communication', 'planner', 'permissions', 'plugins',
      'mcp', 'transport', 'compaction', 'ui', 'ops', 'forensics', 'security',
      'automation', 'routes', 'control-plane', 'deliveries', 'watchers',
      'surfaces', 'knowledge', 'workspace',
    ];
    for (const domain of known) {
      expect(isRuntimeDomain(domain)).toBe(true);
    }
  });

  test('returns false for unknown domain string', () => {
    expect(isRuntimeDomain('unknown-domain')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(isRuntimeDomain('')).toBe(false);
  });

  test('is case-sensitive: uppercase variant is not a domain', () => {
    expect(isRuntimeDomain('Session')).toBe(false);
    expect(isRuntimeDomain('TASKS')).toBe(false);
  });

  test('returns false for partial prefix match', () => {
    expect(isRuntimeDomain('sess')).toBe(false);
    expect(isRuntimeDomain('control')).toBe(false); // 'control-plane' is valid, 'control' is not
  });
});

describe('EXTRA_METHOD_ROUTES retirement (W2B)', () => {
  test('sessions.get/steer/followUp resolve NATIVELY — no EXTRA row', () => {
    // These gained native coverage in the 0.38 browser SDK (SHARED_BROWSER_ROUTES);
    // they must fall through to scopedSdk.operator.invoke, not a hand-written route.
    expect(isExtraRoutedMethod('sessions.get')).toBe(false);
    expect(isExtraRoutedMethod('sessions.steer')).toBe(false);
    expect(isExtraRoutedMethod('sessions.followUp')).toBe(false);
  });

  test('sessions.messages/inputs also resolve natively', () => {
    expect(isExtraRoutedMethod('sessions.messages.list')).toBe(false);
    expect(isExtraRoutedMethod('sessions.messages.create')).toBe(false);
    expect(isExtraRoutedMethod('sessions.inputs.list')).toBe(false);
    expect(isExtraRoutedMethod('sessions.inputs.cancel')).toBe(false);
  });

  test('sessions.close/reopen STILL require their table rows (not in 0.38 shared routes)', () => {
    expect(isExtraRoutedMethod('sessions.close')).toBe(true);
    expect(isExtraRoutedMethod('sessions.reopen')).toBe(true);
  });

  test('the justified survivors remain (Wave-3 SDK-coverage targets)', () => {
    for (const method of [
      'approvals.approve', 'approvals.list', 'models.list', 'models.current', 'models.select',
      'tasks.list', 'tasks.cancel', 'tasks.retry', 'config.set', 'local_auth.status',
      'companion.chat.sessions.delete',
    ]) {
      expect(isExtraRoutedMethod(method)).toBe(true);
    }
  });
});
