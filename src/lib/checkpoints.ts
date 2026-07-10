/**
 * checkpoints.ts — display helpers for checkpoints.*
 * (packages/sdk/src/platform/control-plane/method-catalog-fleet.ts /
 * WorkspaceCheckpointManager).
 */

import type { CheckpointsRestorePreviewResult, WorkspaceCheckpoint } from './goodvibes';

/** CHECKPOINT_KIND_SCHEMA (operator-contract-schemas-fleet.ts). */
export const KNOWN_CHECKPOINT_KINDS = ['turn', 'agent-run', 'manual'] as const;

/** RETENTION_CLASS_SCHEMA (operator-contract-schemas-fleet.ts). */
export const KNOWN_RETENTION_CLASSES = ['short', 'standard', 'forensic'] as const;

export function kindLabel(kind: string): string {
  return kind.trim() || 'unknown';
}

export function retentionLabel(retentionClass: string): string {
  return retentionClass.trim() || 'unknown';
}

export function sortCheckpointsNewestFirst(checkpoints: readonly WorkspaceCheckpoint[]): WorkspaceCheckpoint[] {
  return [...checkpoints].sort((a, b) => b.createdAt - a.createdAt);
}

export function formatBytes(bytes: number | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return 'unknown size';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

/**
 * The exact honest wording for a create() response that reported noop:true
 * (WorkspaceCheckpointManager: tree identical to the most recent checkpoint —
 * no commit, ref, or manifest entry created). Never phrased as a failure.
 */
export const CHECKPOINT_NOOP_MESSAGE = 'Nothing to snapshot — the workspace tree is unchanged since the last checkpoint.';

/**
 * The exact wording of the destructive-restore confirm prompt. Named here
 * (not inlined at the call site) so the CheckpointsView test can assert on
 * it without duplicating the copy.
 */
export function restoreConfirmMessage(checkpoint: WorkspaceCheckpoint): string {
  return `Restore the workspace to "${checkpoint.label || checkpoint.id}"?\n\n`
    + 'This overwrites the CURRENT working tree with the files captured by that checkpoint '
    + '(a git-backed rewrite). Uncommitted changes made since then that are not themselves '
    + 'checkpointed will be lost.';
}

/**
 * The restore confirm prompt enriched with a checkpoints.restorePreview result:
 * how many files the restore would change and a bounded sample of their paths.
 * Falls back to a "nothing would change" line when the preview reports no
 * affected paths. Built here (not inlined) so CheckpointsView's test can assert
 * on the wording without duplicating it.
 */
export function restoreConfirmMessageWithPreview(
  checkpoint: WorkspaceCheckpoint,
  preview: CheckpointsRestorePreviewResult['preview'],
): string {
  const base = restoreConfirmMessage(checkpoint);
  const count = preview.affectedPathCount;
  if (count <= 0) {
    return `${base}\n\nThis checkpoint matches the current working tree — no files would change.`;
  }
  const noun = count === 1 ? 'file' : 'files';
  const sample = preview.affectedPathSample.slice(0, 5);
  const sampleLines = sample.length ? `\n  ${sample.join('\n  ')}` : '';
  const remainder = count > sample.length ? `\n  … and ${count - sample.length} more` : '';
  return `${base}\n\n${count} ${noun} would change:${sampleLines}${remainder}`;
}
