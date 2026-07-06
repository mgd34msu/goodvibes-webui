import { describe, expect, test } from 'bun:test';
import {
  classifyBadgeTone,
  contractGlyph,
  contractGlyphForBadgeTone,
  contractGlyphForConnection,
  contractStateForAuth,
  contractStateForBadgeTone,
  contractStateForConnection,
  contractStateForSse,
  contractStateForWorking,
} from './presentation-bridge';
import { CONTRACT_GLYPHS, CONTRACT_STATE_GLYPHS } from './generated/presentation-tokens';

describe('classifyBadgeTone', () => {
  test('maps healthy/ok/ready/active vocabulary to ok', () => {
    expect(classifyBadgeTone('healthy')).toBe('ok');
    expect(classifyBadgeTone('ready')).toBe('ok');
    expect(classifyBadgeTone('active')).toBe('ok');
  });

  test('maps error/fail/denied/expired vocabulary to bad', () => {
    expect(classifyBadgeTone('task failed')).toBe('bad');
    expect(classifyBadgeTone('access denied')).toBe('bad');
    expect(classifyBadgeTone('expired')).toBe('bad');
  });

  test('maps warn/pending/blocked/expiring vocabulary to warning', () => {
    expect(classifyBadgeTone('pending approval')).toBe('warning');
    expect(classifyBadgeTone('expiring')).toBe('warning');
    expect(classifyBadgeTone('blocked')).toBe('warning');
  });

  test('maps unrecognized / honestly-absent vocabulary to neutral', () => {
    expect(classifyBadgeTone('unconfigured')).toBe('neutral');
    expect(classifyBadgeTone('status unavailable')).toBe('neutral');
  });
});

describe('contract tone/glyph mapping — every bucket resolves to a real contract glyph', () => {
  test('contractGlyphForBadgeTone resolves each BadgeTone to a CONTRACT_STATE_GLYPHS value', () => {
    expect(contractGlyphForBadgeTone('ok')).toBe(CONTRACT_STATE_GLYPHS.good);
    expect(contractGlyphForBadgeTone('warning')).toBe(CONTRACT_STATE_GLYPHS.warn);
    expect(contractGlyphForBadgeTone('bad')).toBe(CONTRACT_STATE_GLYPHS.bad);
    expect(contractGlyphForBadgeTone('neutral')).toBe(CONTRACT_STATE_GLYPHS.info);
  });

  test('contractStateForBadgeTone resolves each BadgeTone to its contract bucket', () => {
    expect(contractStateForBadgeTone('ok')).toBe('good');
    expect(contractStateForBadgeTone('warning')).toBe('warn');
    expect(contractStateForBadgeTone('bad')).toBe('bad');
    expect(contractStateForBadgeTone('neutral')).toBe('info');
  });

  test('contractGlyph looks up the full 16-key GLYPHS.status vocabulary', () => {
    expect(contractGlyph('blocked')).toBe(CONTRACT_GLYPHS.status.blocked);
    expect(contractGlyph('pending')).toBe(CONTRACT_GLYPHS.status.pending);
    expect(contractGlyph('review')).toBe(CONTRACT_GLYPHS.status.review);
  });
});

describe('daemon-health axis mappings (StatusStrip) — genuine severity correspondence only', () => {
  test('ConnectionState: connected=good, reconnecting=warn, down=bad', () => {
    expect(contractStateForConnection('connected')).toBe('good');
    expect(contractStateForConnection('reconnecting')).toBe('warn');
    expect(contractStateForConnection('down')).toBe('bad');
  });

  test('contractGlyphForConnection resolves to the matching STATE_GLYPHS value', () => {
    expect(contractGlyphForConnection('connected')).toBe(CONTRACT_STATE_GLYPHS.good);
    expect(contractGlyphForConnection('reconnecting')).toBe(CONTRACT_STATE_GLYPHS.warn);
    expect(contractGlyphForConnection('down')).toBe(CONTRACT_STATE_GLYPHS.bad);
  });

  test('AuthState: signed-in=good, signed-out=info (absence is not a fault), unknown=info', () => {
    expect(contractStateForAuth('signed-in')).toBe('good');
    expect(contractStateForAuth('signed-out')).toBe('info');
    expect(contractStateForAuth('unknown')).toBe('info');
  });

  test('WorkingState: working=good, blocked=bad (a real fault), unknown=info', () => {
    expect(contractStateForWorking('working')).toBe('good');
    expect(contractStateForWorking('blocked')).toBe('bad');
    expect(contractStateForWorking('unknown')).toBe('info');
  });

  test('SseState: active=good, connecting=info, error=bad, disabled=info (deliberately off)', () => {
    expect(contractStateForSse('active')).toBe('good');
    expect(contractStateForSse('connecting')).toBe('info');
    expect(contractStateForSse('error')).toBe('bad');
    expect(contractStateForSse('disabled')).toBe('info');
  });
});
