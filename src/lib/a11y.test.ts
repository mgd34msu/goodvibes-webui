import { describe, expect, test } from 'bun:test';
import { SR_ONLY_CLASS, genId, srOnlyStyle } from './a11y';

// NOTE: useGenId is a React hook requiring renderHook — skip here (DOM/React).
// NOTE: genId uses a module-level counter shared across tests; call order matters.

describe('genId', () => {
  test('returns a string containing the given prefix', () => {
    const id = genId('dialog');
    expect(id).toContain('dialog');
  });

  test('appends a numeric suffix separated by a hyphen', () => {
    const id = genId('test');
    const parts = id.split('-');
    // Last segment must be a non-NaN number
    expect(Number.isNaN(Number(parts[parts.length - 1]))).toBe(false);
  });

  test('successive calls return different ids', () => {
    const id1 = genId('item');
    const id2 = genId('item');
    expect(id1).not.toBe(id2);
  });

  test('different prefixes produce different ids', () => {
    const a = genId('alpha');
    const b = genId('beta');
    expect(a).not.toBe(b);
    expect(a.startsWith('alpha-')).toBe(true);
    expect(b.startsWith('beta-')).toBe(true);
  });

  test('counter strictly increments (later call has larger numeric part)', () => {
    const id1 = genId('seq');
    const id2 = genId('seq');
    const n1 = Number(id1.split('-')[1]);
    const n2 = Number(id2.split('-')[1]);
    expect(n2).toBeGreaterThan(n1);
  });
});

describe('SR_ONLY_CLASS', () => {
  test('is the string sr-only', () => {
    expect(SR_ONLY_CLASS).toBe('sr-only');
  });
});

describe('srOnlyStyle', () => {
  test('positions element absolutely', () => {
    expect(srOnlyStyle.position).toBe('absolute');
  });

  test('collapses to 1px dimensions', () => {
    expect(srOnlyStyle.width).toBe('1px');
    expect(srOnlyStyle.height).toBe('1px');
  });

  test('hides overflow', () => {
    expect(srOnlyStyle.overflow).toBe('hidden');
  });

  test('uses clip rect(0,0,0,0)', () => {
    expect(srOnlyStyle.clip).toBe('rect(0,0,0,0)');
  });

  test('prevents text wrapping', () => {
    expect(srOnlyStyle.whiteSpace).toBe('nowrap');
  });

  test('zeroes padding and margin', () => {
    expect(srOnlyStyle.padding).toBe(0);
    expect(srOnlyStyle.margin).toBe('-1px');
  });
});
