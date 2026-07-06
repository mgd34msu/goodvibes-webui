/**
 * contract-bridge-types.ts — contract-typed bridges for the operator method families the
 * webui facade calls (fleet.*, checkpoints.*, sessions.search).
 *
 * As of the SDK 1.0.0 pin-bump (see CHANGELOG.md), the SDK's generated
 * `OperatorMethodInputMap`/`OperatorMethodOutputMap` (foundation-client-types.ts)
 * carry real entries for every id below, so each bridge type now flows straight from
 * `OperatorMethodInput<M>`/`OperatorMethodOutput<M>`. This is the `// SWAP:` seam the
 * pre-1.0.0 header described, now applied: the hand-authored interfaces that stood in for
 * the missing generic-map entries at 0.38 are gone, replaced one-for-one by the generated
 * contract types they mirrored.
 *
 * goodvibes.ts imports these names ONLY from this module (never redefines them), so the
 * facade's exported names (FleetProcessNode, WorkspaceCheckpoint, ...) do not change —
 * only their definition now derives from the SDK contract. The item-level aliases
 * (FleetProcessNode = FleetSnapshotResult['nodes'][number], etc.) keep every existing
 * consumer import compiling unchanged.
 *
 * `bridge-matches-schema` in goodvibes.test.ts pins these shapes against the installed
 * SDK's `operator-contract.json` artifact, so any future drift (including a later pin
 * bump silently changing a shape) fails the test immediately.
 */
import type { OperatorMethodInput, OperatorMethodOutput } from '@pellux/goodvibes-sdk/contracts';

/** Method ids this module provides a contract-typed bridge for (see file header). */
export const BRIDGE_TYPED_METHOD_IDS = [
  'fleet.snapshot',
  'fleet.list',
  'checkpoints.list',
  'checkpoints.create',
  'checkpoints.diff',
  'checkpoints.restore',
  'sessions.search',
] as const;

// ─── Fleet (fleet.*) ─────────────────────────────────────────────────────────
// SWAP applied: fleet.snapshot/fleet.list now carry real OperatorMethodInputMap/OutputMap
// entries, so these flow straight from the generated contract. FleetProcessNode is the
// shared node shape, derived from the snapshot output for readability.
export type FleetSnapshotResult = OperatorMethodOutput<'fleet.snapshot'>;
export type FleetListInput = OperatorMethodInput<'fleet.list'>;
export type FleetListResult = OperatorMethodOutput<'fleet.list'>;
export type FleetProcessNode = FleetSnapshotResult['nodes'][number];

// ─── Checkpoints (checkpoints.*) ──────────────────────────────────────────────
// SWAP applied: checkpoints.list/create/diff/restore now carry real map entries.
// WorkspaceCheckpoint is derived from the list output's item shape.
export type CheckpointsListInput = OperatorMethodInput<'checkpoints.list'>;
export type CheckpointsListResult = OperatorMethodOutput<'checkpoints.list'>;
export type CheckpointsCreateInput = OperatorMethodInput<'checkpoints.create'>;
export type CheckpointsCreateResult = OperatorMethodOutput<'checkpoints.create'>;
export type CheckpointsDiffInput = OperatorMethodInput<'checkpoints.diff'>;
export type CheckpointsDiffResult = OperatorMethodOutput<'checkpoints.diff'>;
export type CheckpointsRestoreInput = OperatorMethodInput<'checkpoints.restore'>;
export type CheckpointsRestoreResult = OperatorMethodOutput<'checkpoints.restore'>;
export type WorkspaceCheckpoint = CheckpointsListResult['checkpoints'][number];

// ─── Sessions search (sessions.search) ────────────────────────────────────────
// SWAP applied: sessions.search now carries a real map entry.
export type SessionsSearchInput = OperatorMethodInput<'sessions.search'>;
export type SessionsSearchResult = OperatorMethodOutput<'sessions.search'>;
export type SessionsSearchSessionSummary = SessionsSearchResult['sessions'][number];
