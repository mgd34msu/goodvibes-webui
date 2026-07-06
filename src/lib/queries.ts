import { getCurrentAuth, invokeMethod, sdk } from './goodvibes';

export const queryKeys = {
  auth: ['auth'] as const,
  status: ['control', 'status'] as const,
  control: ['control', 'snapshot'] as const,
  accounts: ['accounts'] as const,
  providers: ['providers'] as const,
  tasks: ['tasks'] as const,
  approvals: ['approvals'] as const,
  sessions: ['sessions'] as const,
  // Wave-3 (W3-W1): fleet.*/checkpoints.* (W3-S2, SDK 0.39.0-dev). Neither verb
  // family emits a wire event yet (pinned by the SDK's own
  // w3-s2-fleet-checkpoints-search.test.ts — "none of the W3-S2 verbs declares
  // a wire event"), so these are NOT wired into useRealtimeInvalidation's
  // DOMAIN_INVALIDATIONS map; FleetView/CheckpointsView poll on an interval
  // and expose a manual refresh instead. Revisit once a fleet-update event
  // (mentioned as a later-wave possibility in the SDK's W3-S2 brief) lands.
  fleet: ['fleet'] as const,
  checkpoints: ['checkpoints'] as const,
  // Stub for W3-W2 (Workstream view, rides fleet.* filtered to
  // orchestration/workstream rows) — fill the body, do not restructure the key.
  workstream: ['workstream'] as const,
  // Detail + messages keys are PREFIXED with 'sessions' so that invalidating
  // queryKeys.sessions (non-exact) refetches the list AND every open detail/messages
  // query — the single invalidation the raw session-update stream fires.
  sessionDetail: (sessionId: string) => ['sessions', sessionId] as const,
  sessionMessages: (sessionId: string) => ['sessions', sessionId, 'messages'] as const,
  knowledgeStatus: ['knowledge', 'status'] as const,
  knowledgeSources: ['knowledge', 'sources'] as const,
  knowledgeNodes: ['knowledge', 'nodes'] as const,
  knowledgeIssues: ['knowledge', 'issues'] as const,
  knowledgeMap: ['knowledge', 'map'] as const,
  knowledgeProjections: ['knowledge', 'projections'] as const,
  knowledgeRefinement: ['knowledge', 'refinement'] as const,
  // W8 activity honesty (W5-W5): the never-called knowledge.jobs.list /
  // knowledge.job-runs.list, read from the map/nodes "View jobs" link.
  knowledgeJobs: ['knowledge', 'jobs'] as const,
  localAuth: ['local-auth'] as const,
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
