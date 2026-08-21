import { describe, expect, test } from 'bun:test';
import { SR_ONLY_CLASS, srOnlyStyle } from './a11y';

// NOTE: useGenId is a React hook requiring renderHook, skip here (DOM/React).

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
