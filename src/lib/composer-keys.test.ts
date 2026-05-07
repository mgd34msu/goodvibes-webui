import { describe, expect, test } from 'bun:test';
import { shouldSubmitComposerKey } from './composer-keys';

describe('composer key policy', () => {
  test('submits on plain Enter', () => {
    expect(shouldSubmitComposerKey({ key: 'Enter', shiftKey: false })).toBe(true);
  });

  test('keeps Shift Enter for newlines', () => {
    expect(shouldSubmitComposerKey({ key: 'Enter', shiftKey: true })).toBe(false);
  });

  test('does not submit during IME composition', () => {
    expect(shouldSubmitComposerKey({
      key: 'Enter',
      shiftKey: false,
      nativeEvent: { isComposing: true },
    })).toBe(false);
  });
});
