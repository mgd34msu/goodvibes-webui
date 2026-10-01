import { describe, expect, test } from 'bun:test';
import type { WorkspaceCheckpoint } from './goodvibes';
import {
  formatBytes,
  kindLabel,
  restoreConfirmMessageWithPreview,
  restoreConfirmTitle,
  retentionLabel,
  sortCheckpointsNewestFirst,
} from './checkpoints';

function checkpoint(overrides: Partial<WorkspaceCheckpoint> & { id: string }): WorkspaceCheckpoint {
  return {
    kind: 'manual',
    label: '',
    createdAt: 0,
    parentId: null,
    retentionClass: 'standard',
    commit: 'abc123',
    sizeBytes: 0,
    ...overrides,
  };
}

describe('kindLabel / retentionLabel', () => {
  test('empty falls back to "unknown"', () => {
    expect(kindLabel('')).toBe('unknown');
    expect(retentionLabel('')).toBe('unknown');
  });

  test('non-empty renders verbatim', () => {
    expect(kindLabel('agent-run')).toBe('agent-run');
    expect(retentionLabel('forensic')).toBe('forensic');
  });
});

describe('formatBytes', () => {
  test('bytes under 1024 show as B', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  test('KB/MB/GB scaling', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  test('negative/undefined/non-finite is honestly "unknown size"', () => {
    expect(formatBytes(undefined)).toBe('unknown size');
    expect(formatBytes(-1)).toBe('unknown size');
    expect(formatBytes(NaN)).toBe('unknown size');
  });
});

describe('sortCheckpointsNewestFirst', () => {
  test('sorts by createdAt descending', () => {
    const list = [
      checkpoint({ id: 'old', createdAt: 10 }),
      checkpoint({ id: 'new', createdAt: 30 }),
      checkpoint({ id: 'mid', createdAt: 20 }),
    ];
    expect(sortCheckpointsNewestFirst(list).map((c) => c.id)).toEqual(['new', 'mid', 'old']);
  });

  test('does not mutate the input array', () => {
    const list = [checkpoint({ id: 'a', createdAt: 1 }), checkpoint({ id: 'b', createdAt: 2 })];
    const original = [...list];
    sortCheckpointsNewestFirst(list);
    expect(list).toEqual(original);
  });
});

describe('restore confirm copy', () => {
  const preview = (affectedPathCount: number) => ({
    checkpointId: 'wcp_1',
    label: 'diff base',
    affectedPathCount,
    affectedPathSample: affectedPathCount ? ['src/a.ts'] : [],
    stat: '',
  });

  test('the title asks the question and names the checkpoint, falling back to its id', () => {
    expect(restoreConfirmTitle(checkpoint({ id: 'wcp_1', label: 'diff base' }))).toBe('Restore the workspace to “diff base”?');
    expect(restoreConfirmTitle(checkpoint({ id: 'wcp_2', label: '' }))).toBe('Restore the workspace to “wcp_2”?');
  });

  test('with a preview it states the count in one sentence, singular and plural', () => {
    expect(restoreConfirmMessageWithPreview(preview(1))).toBe('Files changed since then are replaced; 1 file changes.');
    expect(restoreConfirmMessageWithPreview(preview(3))).toBe('Files changed since then are replaced; 3 files change.');
  });

  test('an empty preview says nothing changes', () => {
    expect(restoreConfirmMessageWithPreview(preview(0))).toBe('The workspace already matches it, so no files change.');
  });
});
