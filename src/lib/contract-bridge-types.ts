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
  'fleet.archive',
  'fleet.unarchive',
  'fleet.archiveFinished',
  'fleet.archived.list',
  'checkpoints.list',
  'checkpoints.create',
  'checkpoints.diff',
  'checkpoints.restore',
  'sessions.search',
  'sessions.detach',
] as const;

// ─── Fleet (fleet.*) ─────────────────────────────────────────────────────────
// SWAP applied: fleet.snapshot/fleet.list now carry real OperatorMethodInputMap/OutputMap
// entries, so these flow straight from the generated contract. FleetProcessNode is the
// shared node shape, derived from the snapshot output for readability.
export type FleetSnapshotResult = OperatorMethodOutput<'fleet.snapshot'>;
export type FleetListInput = OperatorMethodInput<'fleet.list'>;
export type FleetListResult = OperatorMethodOutput<'fleet.list'>;
export type FleetProcessNode = FleetSnapshotResult['nodes'][number];
// Fleet archive (SDK 1.6.0): move finished subtrees out of the live fleet
// view into the session archive and back; list what is archived.
export type FleetArchiveInput = OperatorMethodInput<'fleet.archive'>;
export type FleetArchiveResult = OperatorMethodOutput<'fleet.archive'>;
export type FleetUnarchiveResult = OperatorMethodOutput<'fleet.unarchive'>;
export type FleetArchiveFinishedResult = OperatorMethodOutput<'fleet.archiveFinished'>;
export type FleetArchivedListResult = OperatorMethodOutput<'fleet.archived.list'>;

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

// ─── Sessions detach (sessions.detach) ────────────────────────────────────────
// NOT YET SWAPPED: unlike fleet.*/checkpoints.*/sessions.search above, sessions.detach
// has no OperatorMethodInputMap/OutputMap entry in the installed contracts package yet
// (verified: 'sessions.detach' is absent from foundation-client-types.d.ts even though
// it IS a real id in the installed OperatorMethodId union — operator-method-ids.ts
// lists it). Hand-authored directly against the wire schema
// (operator-contract.json 'sessions.detach', input `{sessionId, surfaceId}` both
// required; output `{session}`) — the same pre-SWAP shape the fleet.*/checkpoints.*
// types above used before 1.0.0 added real map entries for them. Flag this again (a
// `// SWAP:` seam) if a future contracts generation adds a sessions.detach entry.
//
// `session` mirrors every top-level `required` field of operator-contract.json's
// sessions.detach outputSchema (verified against the installed 1.1.0 artifact) — not
// just the fields this module's own consumers read — so the bridge-matches-schema test
// below can walk the full required set without a cast. Optional wire fields this
// client never reads (project/lastMessageAt/closedAt/routeIds' route detail/
// activeAgentId/lastAgentId/lastError) are intentionally omitted, matching this file's
// existing stance of typing only what a caller uses.
export interface SessionsDetachInput {
  readonly sessionId: string;
  readonly surfaceId: string;
}

export interface SessionParticipant {
  readonly surfaceKind: string;
  readonly surfaceId: string;
  readonly externalId?: string;
  readonly userId?: string;
  readonly displayName?: string;
  readonly routeId?: string;
  readonly lastSeenAt: number;
}

export interface SessionsDetachResult {
  readonly session: {
    readonly id: string;
    readonly kind: string;
    readonly title: string;
    readonly status: string;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly lastActivityAt: number;
    readonly messageCount: number;
    readonly pendingInputCount: number;
    readonly routeIds: readonly string[];
    readonly surfaceKinds: readonly string[];
    readonly participants: readonly SessionParticipant[];
    readonly metadata: Record<string, unknown>;
  };
}
