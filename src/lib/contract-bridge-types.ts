/**
 * contract-bridge-types.ts — LOCAL BRIDGE TYPES for the operator method families whose
 * ids ARE in the installed 0.38 `OperatorMethodId` union (operator-method-ids.ts:
 * fleet.list/fleet.snapshot, checkpoints.create/diff/list/restore, sessions.search)
 * but whose `OperatorMethodInputMap`/`OperatorMethodOutputMap` entries
 * (foundation-client-types.ts) DO NOT EXIST yet — `OperatorMethodInput<M>` falls back
 * to `{ readonly [key: string]: unknown }` and `OperatorMethodOutput<M>` falls back to
 * plain `unknown` for every one of these ids today. (`sessions.detach` is the fourth
 * member of this family — same generic-I/O gap — but nothing in the webui facade calls
 * it yet, so no bridge type is defined for it here; add one the same way if a stage-2
 * view needs it before the pin-bump.)
 *
 * WHY THIS EXISTS, NOT A DEEPER SDK FIX: W5-S2 (SDK repo) is generating the real
 * `OperatorMethodInputMap`/`OperatorMethodOutputMap` entries for this family. That lands
 * at the 0.38 -> 1.0.0 pin-bump, a separate, later dependency bump — the dev overlay used
 * today does NOT rebuild the `@pellux/goodvibes-contracts` package (W5-S2's own brief).
 * Blocking the webui's typed client on that bump was explicitly rejected (W5-TC decision
 * record): the bridge-type seam below decouples the two.
 *
 * NOT GUESSWORK: every shape below was cross-checked against the SAME runtime schema
 * source W5-S2 will draw its generated types from — the installed SDK's own
 * `operator-contract.json` artifact (`@pellux/goodvibes-sdk/contracts/operator-contract.json`),
 * which carries real JSON Schema `inputSchema`/`outputSchema` for every one of these
 * methods even though the *TypeScript* generated maps are still generic. `bridge-schema
 * matches the SDK method catalog` in goodvibes.test.ts pins these field sets against
 * that same artifact, so any drift (including the pin-bump itself silently changing a
 * shape) fails the test immediately instead of shipping unnoticed.
 *
 * THE SWAP SEAM (mechanical, at the pin-bump): every block below carries a paired
 * `// SWAP:` comment showing the one-line replacement once W5-S2's generated maps carry
 * these ids. goodvibes.ts imports these names ONLY from this module (never redefines
 * them), so the swap touches ONLY this file — the facade's exported names
 * (FleetProcessNode, WorkspaceCheckpoint, ...) do not change, only their definition.
 */

/** Method ids this module provides a hand-authored bridge type for (see file header). */
export const BRIDGE_TYPED_METHOD_IDS = [
  'fleet.snapshot',
  'fleet.list',
  'checkpoints.list',
  'checkpoints.create',
  'checkpoints.diff',
  'checkpoints.restore',
  'sessions.search',
] as const;

// ─── Fleet (W3-S2 fleet.*) ──────────────────────────────────────────────────
// SWAP (fleet.*): once W5-S2 lands real OperatorMethodInputMap/OutputMap entries for
// fleet.snapshot/fleet.list, replace every export in this block with:
//   export type FleetSnapshotResult = OperatorMethodOutput<'fleet.snapshot'>;
//   export type FleetListInput = OperatorMethodInput<'fleet.list'>;
//   export type FleetListResult = OperatorMethodOutput<'fleet.list'>;
// (drop the FleetProcessNode/Usage/Activity/Capabilities helper interfaces below, or
// keep them as `= FleetSnapshotResult['nodes'][number]` etc. for readability.)

export interface FleetProcessUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly reasoningTokens?: number;
  readonly llmCallCount: number;
  readonly turnCount: number;
  readonly toolCallCount: number;
}

export interface FleetProcessActivity {
  readonly kind: string;
  readonly text: string;
  readonly toolName?: string;
  readonly at: number;
}

export interface FleetProcessCapabilities {
  readonly interruptible: boolean;
  readonly killable: boolean;
  readonly pausable: boolean;
  readonly resumable: boolean;
  readonly steerable: boolean;
}

export interface FleetProcessNode {
  readonly id: string;
  readonly kind: string;
  readonly parentId?: string;
  readonly label: string;
  readonly task?: string;
  readonly state: string;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly elapsedMs: number;
  readonly usage?: FleetProcessUsage;
  readonly model?: string;
  readonly provider?: string;
  readonly costUsd?: number | null;
  readonly costState: string;
  readonly currentActivity?: FleetProcessActivity;
  readonly capabilities: FleetProcessCapabilities;
  readonly sessionRef?: { readonly sessionId?: string; readonly agentId?: string };
}

export interface FleetSnapshotResult {
  readonly capturedAt: number;
  readonly nodes: FleetProcessNode[];
  readonly truncated: boolean;
  readonly totalCount: number;
}

export interface FleetListInput {
  readonly kinds?: readonly string[];
  readonly states?: readonly string[];
  readonly limit?: number;
  readonly cursor?: string;
  // Index signature: matches OperatorMethodInput<'fleet.list'>'s generic-fallback shape
  // (`{ [k: string]: unknown }`) so this bridge type is directly assignable to
  // invokeGatewayMethod's `OperatorMethodInput<TMethodId>`-typed body parameter.
  readonly [key: string]: unknown;
}

export interface FleetListResult {
  readonly items: FleetProcessNode[];
  readonly nextCursor?: string;
  readonly hasMore: boolean;
  readonly capturedAt: number;
}

// ─── Checkpoints (W3-S2 checkpoints.*) ──────────────────────────────────────
// SWAP (checkpoints.*): once W5-S2 lands real map entries, replace this block with:
//   export type CheckpointsListInput = OperatorMethodInput<'checkpoints.list'>;
//   export type CheckpointsListResult = OperatorMethodOutput<'checkpoints.list'>;
//   export type CheckpointsCreateInput = OperatorMethodInput<'checkpoints.create'>;
//   export type CheckpointsCreateResult = OperatorMethodOutput<'checkpoints.create'>;
//   export type CheckpointsDiffInput = OperatorMethodInput<'checkpoints.diff'>;
//   export type CheckpointsDiffResult = OperatorMethodOutput<'checkpoints.diff'>;
//   export type CheckpointsRestoreInput = OperatorMethodInput<'checkpoints.restore'>;
//   export type CheckpointsRestoreResult = OperatorMethodOutput<'checkpoints.restore'>;

export interface WorkspaceCheckpoint {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly createdAt: number;
  readonly parentId: string | null;
  readonly turnId?: string;
  readonly agentId?: string;
  readonly retentionClass: string;
  readonly commit: string;
  readonly sizeBytes: number;
}

export interface CheckpointsListInput {
  readonly kind?: string;
  readonly since?: number;
  readonly limit?: number;
  readonly [key: string]: unknown;
}

export interface CheckpointsListResult {
  readonly checkpoints: WorkspaceCheckpoint[];
}

export interface CheckpointsCreateInput {
  readonly kind: 'turn' | 'agent-run' | 'manual';
  readonly label?: string;
  readonly retentionClass?: string;
  readonly turnId?: string;
  readonly agentId?: string;
  readonly paths?: readonly string[];
  readonly [key: string]: unknown;
}

export interface CheckpointsCreateResult {
  readonly checkpoint: WorkspaceCheckpoint | null;
  readonly noop: boolean;
}

export interface CheckpointsDiffInput {
  readonly a: string;
  readonly b?: string;
  readonly [key: string]: unknown;
}

export interface CheckpointsDiffResult {
  readonly diff: {
    readonly from: string;
    readonly to: string;
    readonly files: readonly string[];
    readonly unifiedDiff: string;
    readonly stat: string;
  };
}

export interface CheckpointsRestoreInput {
  readonly id: string;
  readonly paths?: readonly string[];
  readonly safetyCheckpoint?: boolean;
  readonly [key: string]: unknown;
}

export interface CheckpointsRestoreResult {
  readonly result: {
    readonly checkpointId: string;
    readonly safetyCheckpointId: string | null;
    readonly restoredFiles: readonly string[];
    readonly removedFiles: readonly string[];
  };
}

// ─── Sessions search (sessions.search — W5-W6's dependency) ─────────────────
// SWAP (sessions.search): once W5-S2 lands a real map entry, replace this block with:
//   export type SessionsSearchInput = OperatorMethodInput<'sessions.search'>;
//   export type SessionsSearchResult = OperatorMethodOutput<'sessions.search'>;

export interface SessionsSearchInput {
  readonly query?: string;
  readonly project?: string;
  readonly kind?: string;
  readonly surfaceKind?: string;
  readonly status?: 'active' | 'closed';
  /** sessions.search defaults this to false — the OPPOSITE of sessions.list's own
   * default (see session-search.ts's handler comment). Name the divergence at the
   * call site, never assume parity with sessions.list. */
  readonly includeClosed?: boolean;
  readonly limit?: number;
  readonly cursor?: string;
  readonly [key: string]: unknown;
}

export interface SessionsSearchSessionSummary {
  readonly id: string;
  readonly kind: string;
  readonly project?: string;
  readonly title: string;
  readonly status: 'active' | 'closed';
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastMessageAt?: number;
  readonly closedAt?: number;
  readonly lastActivityAt: number;
  readonly messageCount: number;
  readonly retainedMessageCount?: number;
  readonly pendingInputCount: number;
  readonly routeIds: readonly string[];
  readonly surfaceKinds: readonly string[];
  readonly activeAgentId?: string;
  readonly lastAgentId?: string;
  readonly lastError?: string;
  readonly participants: readonly {
    readonly surfaceKind: string;
    readonly surfaceId: string;
    readonly externalId?: string;
    readonly userId?: string;
    readonly displayName?: string;
    readonly routeId?: string;
    readonly lastSeenAt: number;
  }[];
  readonly metadata: Record<string, unknown>;
}

export interface SessionsSearchResult {
  readonly sessions: SessionsSearchSessionSummary[];
  readonly nextCursor?: string;
  readonly hasMore: boolean;
}
