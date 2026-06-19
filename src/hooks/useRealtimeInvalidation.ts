import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { sdk } from '../lib/goodvibes';
import { queryKeys } from '../lib/queries';

interface RealtimeDomain {
  onEnvelope?: (eventName: string, handler: (event: unknown) => void) => () => void;
}

function domain(events: unknown, name: string): RealtimeDomain {
  const value = (events as Record<string, unknown>)[name];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- value is unknown; cast is required even though RealtimeDomain has all-optional keys
  return (value ?? {}) as RealtimeDomain;
}

export function useRealtimeInvalidation(enabled: boolean) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let unsubs: (() => void)[] = [];

    try {
      const events = sdk.realtime.viaSse();
      const invalidate = (keys: readonly unknown[]) => {
        void queryClient.invalidateQueries({ queryKey: keys });
      };

      const bind = (target: RealtimeDomain, eventName: string, keys: readonly unknown[]) => {
        const unsubscribe = target.onEnvelope?.(eventName, () => invalidate(keys));
        if (unsubscribe) unsubs.push(unsubscribe);
      };

      bind(domain(events, 'tasks'), 'TASK_UPDATED', queryKeys.tasks);
      bind(domain(events, 'tasks'), 'TASK_CREATED', queryKeys.tasks);
      bind(domain(events, 'tasks'), 'TASK_COMPLETED', queryKeys.tasks);
      bind(domain(events, 'permissions'), 'APPROVAL_REQUESTED', queryKeys.approvals);
      bind(domain(events, 'permissions'), 'APPROVAL_RESOLVED', queryKeys.approvals);
      bind(domain(events, 'providers'), 'PROVIDER_UPDATED', queryKeys.providers);
      bind(domain(events, 'session'), 'SESSION_UPDATED', queryKeys.sessions);
      bind(domain(events, 'session'), 'SESSION_CREATED', queryKeys.sessions);
      bind(domain(events, 'knowledge'), 'KNOWLEDGE_UPDATED', queryKeys.knowledgeStatus);
      bind(domain(events, 'knowledge'), 'KNOWLEDGE_UPDATED', queryKeys.knowledgeSources);
      bind(domain(events, 'knowledge'), 'KNOWLEDGE_REFINEMENT_UPDATED', queryKeys.knowledgeRefinement);
      bind(domain(events, 'controlPlane'), 'CONTROL_PLANE_UPDATED', queryKeys.control);
      bind(domain(events, 'control-plane'), 'CONTROL_PLANE_UPDATED', queryKeys.control);

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }

    return () => {
      for (const unsubscribe of unsubs) unsubscribe();
      unsubs = [];
    };
  }, [enabled, queryClient]);

  return error;
}
