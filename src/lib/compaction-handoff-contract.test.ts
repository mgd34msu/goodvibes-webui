import { describe, expect, test } from 'bun:test';
import { COMPACTION_HANDOFF_HEADER, isCompactionHandoffMessage } from './compaction';
// The SDK's platform/core barrel is not browser-safe, so compaction.ts carries
// a literal copy of the header. This test (which runs under bun, where node
// imports are fine) pins that copy byte-for-byte against the SDK's export.
import { COMPACTION_HANDOFF_HEADER as SDK_HEADER } from '@pellux/goodvibes-sdk/platform/core';

describe('compaction handoff header contract', () => {
  test('local copy is byte-identical to the SDK export', () => {
    expect(COMPACTION_HANDOFF_HEADER).toBe(SDK_HEADER);
  });

  test('isCompactionHandoffMessage matches only the handoff message', () => {
    expect(isCompactionHandoffMessage(`${COMPACTION_HANDOFF_HEADER}\n\n## Standing Instructions`)).toBe(true);
    expect(isCompactionHandoffMessage('please compact my context')).toBe(false);
    expect(isCompactionHandoffMessage('')).toBe(false);
  });
});
