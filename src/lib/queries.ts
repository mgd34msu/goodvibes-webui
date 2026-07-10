import { getCurrentAuth, invokeMethod, sdk } from './goodvibes';

export const queryKeys = {
  auth: ['auth'] as const,
  status: ['control', 'status'] as const,
  control: ['control', 'snapshot'] as const,
  accounts: ['accounts'] as const,
  providers: ['providers'] as const,
  // The daemon's full config tree (config.get) — shared cache key with
  // SettingsModal/ModelWorkspaceModal/useSharedVoiceConfig, all of which already
  // used the literal ['config'] array. Centralized here so the session-view
  // permission-mode reader (lib/permission-mode.ts) invalidates/dedupes against
  // the SAME cache entry rather than a second, silently-diverging one.
  config: ['config'] as const,
  tasks: ['tasks'] as const,
  approvals: ['approvals'] as const,
  sessions: ['sessions'] as const,
  // fleet.*/checkpoints.* (SDK 0.39.0-dev). Neither verb family emits a wire
  // event yet (pinned by the SDK's own fleet/checkpoints search test suite —
  // "none of these verbs declares a wire event"), so these are NOT wired into
  // useRealtimeInvalidation's DOMAIN_INVALIDATIONS map; FleetView/CheckpointsView
  // poll on an interval and expose a manual refresh instead. Revisit once a
  // fleet-update event (mentioned as a possibility in the SDK's fleet/checkpoints
  // design notes) lands.
  fleet: ['fleet'] as const,
  // Session archive of finished fleet subtrees (fleet.archived.list) — same
  // poll-not-push story as the live fleet key above.
  fleetArchived: ['fleet', 'archived'] as const,
  checkpoints: ['checkpoints'] as const,
  // Workstream view rides fleet.* filtered to orchestration/workstream rows —
  // fill the body, do not restructure the key.
  workstream: ['workstream'] as const,
  // Detail + messages keys are PREFIXED with 'sessions' so that invalidating
  // queryKeys.sessions (non-exact) refetches the list AND every open detail/messages
  // query — the single invalidation the raw session-update stream fires.
  sessionDetail: (sessionId: string) => ['sessions', sessionId] as const,
  sessionMessages: (sessionId: string) => ['sessions', sessionId, 'messages'] as const,
  // sessions.permissionMode.get / sessions.contextUsage.get (SDK 1.6.1) — same
  // 'sessions'-prefixed convention as sessionDetail/sessionMessages above, so
  // useRealtimeInvalidation's broad `queryKeys.sessions` invalidation (fired on every
  // 'permissions' domain frame — PERMISSION_MODE_CHANGED rides it) also revalidates
  // whichever session's mode/usage chip is currently mounted, without needing to know
  // which session that is at the point the frame arrives.
  sessionPermissionMode: (sessionId: string) => ['sessions', sessionId, 'permission-mode'] as const,
  sessionContextUsage: (sessionId: string) => ['sessions', sessionId, 'context-usage'] as const,
  knowledgeStatus: ['knowledge', 'status'] as const,
  knowledgeSources: ['knowledge', 'sources'] as const,
  knowledgeNodes: ['knowledge', 'nodes'] as const,
  knowledgeIssues: ['knowledge', 'issues'] as const,
  knowledgeMap: ['knowledge', 'map'] as const,
  knowledgeProjections: ['knowledge', 'projections'] as const,
  knowledgeRefinement: ['knowledge', 'refinement'] as const,
  // Activity honesty: the never-called knowledge.jobs.list /
  // knowledge.job-runs.list, read from the map/nodes "View jobs" link.
  knowledgeJobs: ['knowledge', 'jobs'] as const,
  // Consolidation candidates (knowledge.candidates.list/.candidate.get/.decide) — a
  // never-called-before surface (like knowledgeJobs above) this brief adopts.
  knowledgeCandidates: ['knowledge', 'candidates'] as const,
  localAuth: ['local-auth'] as const,
  // Memory (memory.records.* / memory.review-queue, SDK 1.1.0). No wire event exists
  // for this domain yet, so MemoryView polls/refetches manually rather than riding
  // useRealtimeInvalidation (same standing gap fleet.*/checkpoints.* document above).
  memoryList: ['memory', 'list'] as const,
  memoryPersonas: ['memory', 'personas'] as const,
  memoryReviewQueue: ['memory', 'review-queue'] as const,
  // Calendar events are windowed by [from, to) — keyed on the range plus an optional
  // logical calendarId filter so switching ranges/calendars refetches honestly rather
  // than serving a stale window from cache.
  calendarEvents: (from: string, to: string, calendarId: string) =>
    ['calendar', 'events', from, to, calendarId] as const,
  // ci.* (SDK 1.6.1's initiative family). No wire event exists for this domain yet, so
  // CiWatchesView polls/refetches manually rather than riding useRealtimeInvalidation —
  // same standing gap fleet.*/checkpoints.*/memory.* document above.
  ciWatches: ['ci', 'watches'] as const,
  // checkin.* (SDK 1.6.1's initiative family). Same manual-refresh story as ci.* above.
  checkinConfig: ['checkin', 'config'] as const,
  checkinReceipts: ['checkin', 'receipts'] as const,
};

export async function loadBootSnapshot() {
  const entries = await Promise.allSettled([
    getCurrentAuth(),
    sdk.operator.control.status(),
    sdk.operator.control.snapshot(),
    sdk.operator.accounts.snapshot(),
    sdk.operator.providers.list(),
    sdk.operator.tasks.list(),
    sdk.operator.approvals.list(),
    sdk.operator.sessions.list(),
    sdk.knowledge.status(),
    invokeMethod('knowledge.sources.list', { limit: 100 }),
    invokeMethod('knowledge.nodes.list', { limit: 100 }),
    invokeMethod('knowledge.issues.list', { limit: 100 }),
    invokeMethod('knowledge.projections.list', { limit: 100 }),
    invokeMethod('knowledge.refinement.tasks.list', { limit: 100 }),
  ]);

  const keys = [
    'auth',
    'status',
    'control',
    'accounts',
    'providers',
    'tasks',
    'approvals',
    'sessions',
    'knowledgeStatus',
    'knowledgeSources',
    'knowledgeNodes',
    'knowledgeIssues',
    'knowledgeProjections',
    'knowledgeRefinement',
  ] as const;

  return Object.fromEntries(entries.map((entry, index) => [
    keys[index],
    entry.status === 'fulfilled'
      ? { ok: true, value: entry.value }
      : { ok: false, error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason) },
  ]));
}
