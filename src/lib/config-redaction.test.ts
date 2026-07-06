import { describe, expect, test } from 'bun:test';
import {
  categoryLabelForKey,
  displayConfigValue,
  flattenConfig,
  isSecretConfigKey,
  maskSecretValue,
} from './config-redaction';

describe('isSecretConfigKey', () => {
  test('recognizes every key ported from the TUI\'s SECRET_CONFIG_KEYS allowlist', () => {
    expect(isSecretConfigKey('surfaces.slack.botToken')).toBe(true);
    expect(isSecretConfigKey('surfaces.whatsapp.signingSecret')).toBe(true);
    expect(isSecretConfigKey('surfaces.matrix.accessToken')).toBe(true);
  });

  test('catches secret-shaped keys the curated allowlist has not caught up to yet (the generic safety net)', () => {
    // surfaces.telephony.* keys are real (schema-domain-surfaces.ts) but NOT in the
    // TUI's own SECRET_CONFIG_KEYS — the generic suffix heuristic is the backstop.
    expect(isSecretConfigKey('surfaces.telephony.authToken')).toBe(true);
    expect(isSecretConfigKey('surfaces.telephony.webhookSecret')).toBe(true);
  });

  test('an ordinary, non-secret key is not flagged', () => {
    expect(isSecretConfigKey('display.theme')).toBe(false);
    expect(isSecretConfigKey('helper.globalProvider')).toBe(false);
    expect(isSecretConfigKey('provider.model')).toBe(false);
  });
});

describe('maskSecretValue', () => {
  test('keeps the last 4 chars, stars the rest', () => {
    expect(maskSecretValue('sk-abcdefgh1234')).toBe(`${'•'.repeat(11)}1234`);
  });

  test('short values mask fully', () => {
    expect(maskSecretValue('abc')).toBe('••••');
  });

  test('empty string reads as (empty), not a masked zero-length value', () => {
    expect(maskSecretValue('')).toBe('(empty)');
  });
});

describe('displayConfigValue', () => {
  test('never renders a secret key\'s value raw', () => {
    const displayed = displayConfigValue('surfaces.slack.botToken', 'xoxb-real-secret-value');
    expect(displayed).not.toContain('real-secret-value');
    expect(displayed).toContain('alue'); // last 4 chars only
  });

  test('renders a non-secret string value verbatim', () => {
    expect(displayConfigValue('display.theme', 'vaporwave')).toBe('vaporwave');
  });

  test('honest unset/empty/boolean rendering, never a fabricated value', () => {
    expect(displayConfigValue('provider.model', null)).toBe('(unset)');
    expect(displayConfigValue('provider.model', undefined)).toBe('(unset)');
    expect(displayConfigValue('tts.llmModel', '')).toBe('(empty)');
    expect(displayConfigValue('helper.enabled', true)).toBe('true');
    expect(displayConfigValue('helper.enabled', false)).toBe('false');
  });

  test('numbers and objects render without throwing', () => {
    expect(displayConfigValue('tts.speed', 1.5)).toBe('1.5');
    expect(displayConfigValue('cache.gates', [{ name: 'lint' }])).toContain('lint');
  });
});

describe('categoryLabelForKey — TUI CATEGORY_LABELS naming parity', () => {
  test('maps a shared namespace to the exact TUI rail label', () => {
    expect(categoryLabelForKey('helper.globalModel')).toBe('Helper');
    expect(categoryLabelForKey('tts.llmModel')).toBe('TTS');
    expect(categoryLabelForKey('provider.model')).toBe('Provider');
    expect(categoryLabelForKey('surfaces.slack.botToken')).toBe('Surfaces');
  });

  test('an unmapped namespace falls back to a Title Case of itself, never a fabricated label', () => {
    expect(categoryLabelForKey('someNewDomain.key')).toBe('Some New Domain');
  });
});

describe('flattenConfig', () => {
  test('flattens nested objects into dotted keys, categorized', () => {
    const entries = flattenConfig({ helper: { enabled: true, globalModel: 'gpt-5' }, display: { theme: 'vaporwave' } });
    const keys = entries.map((e) => e.key).sort();
    expect(keys).toEqual(['display.theme', 'helper.enabled', 'helper.globalModel']);
    expect(entries.find((e) => e.key === 'helper.enabled')?.category).toBe('Helper');
  });

  test('arrays are treated as leaf values, not descended into', () => {
    const entries = flattenConfig({ notifications: { webhookUrls: ['a', 'b'] } });
    expect(entries).toEqual([{ key: 'notifications.webhookUrls', value: ['a', 'b'], category: 'Notifications' }]);
  });

  test('an empty or non-object input yields no entries', () => {
    expect(flattenConfig(undefined)).toEqual([]);
    expect(flattenConfig(null)).toEqual([]);
    expect(flattenConfig('not an object')).toEqual([]);
  });
});
