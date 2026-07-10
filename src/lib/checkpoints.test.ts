import { describe, expect, test } from 'bun:test';
import type { WorkspaceCheckpoint } from './goodvibes';
import {
  CHECKPOINT_NOOP_MESSAGE,
  formatBytes,
  kindLabel,
  restoreConfirmMessage,
  restoreConfirmMessageWithPreview,
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

describe('CHECKPOINT_NOOP_MESSAGE', () => {
  test('is an honest "unchanged", never phrased as an error', () => {
    expect(CHECKPOINT_NOOP_MESSAGE.toLowerCase()).toContain('unchanged');
    expect(CHECKPOINT_NOOP_MESSAGE.toLowerCase()).not.toContain('error');
    expect(CHECKPOINT_NOOP_MESSAGE.toLowerCase()).not.toContain('fail');
  });
});

describe('restoreConfirmMessage', () => {
  test('names the checkpoint label and warns about overwriting the working tree', () => {
    const message = restoreConfirmMessage(checkpoint({ id: 'wcp_1', label: 'diff base' }));
    expect(message).toContain('diff base');
    expect(message.toLowerCase()).toContain('overwrite');
  });

  test('falls back to the id when there is no label', () => {
    const message = restoreConfirmMessage(checkpoint({ id: 'wcp_2', label: '' }));
    expect(message).toContain('wcp_2');
  });
});

describe('restoreConfirmMessageWithPreview', () => {
  const cp = checkpoint({ id: 'wcp_1', label: 'diff base' });

  test('keeps the base warning and adds the affected-file count and a sampled path', () => {
    const message = restoreConfirmMessageWithPreview(cp, {
      checkpointId: 'wcp_1',
      label: 'diff base',
      affectedPathCount: 3,
      affectedPathSample: ['src/a.ts', 'src/b.ts'],
      stat: '3 files changed',
    });
    expect(message.toLowerCase()).toContain('overwrite');
    expect(message).toContain('3 files would change');
    expect(message).toContain('src/a.ts');
    expect(message).toContain('… and 1 more');
  });

  test('uses singular wording for a single affected file', () => {
    const message = restoreConfirmMessageWithPreview(cp, {
      checkpointId: 'wcp_1',
      label: 'diff base',
      affectedPathCount: 1,
      affectedPathSample: ['src/a.ts'],
      stat: '1 file changed',
    });
    expect(message).toContain('1 file would change');
    expect(message).not.toContain('would change:\n  … and');
  });

  test('reports "no files would change" when the preview is empty', () => {
    const message = restoreConfirmMessageWithPreview(cp, {
      checkpointId: 'wcp_1',
      label: 'diff base',
      affectedPathCount: 0,
      affectedPathSample: [],
      stat: '',
    });
    expect(message.toLowerCase()).toContain('no files would change');
  });
});
