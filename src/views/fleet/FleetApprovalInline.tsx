/**
 * FleetApprovalInline — "approve from the tree": renders the real, correlated
 * approvals for a selected fleet/workstream node inline in its detail pane, using the
 * SAME ApprovalCard the Approvals view renders (src/views/approvals/ApprovalCard.tsx)
 * so approve/deny/claim/cancel behave identically everywhere.
 *
 * Correlation is lib/fleet.ts's approvalsForNode — the exact sessionId/metadata.agentId
 * matching the daemon's own fleet registry uses to derive a node's 'awaiting-approval'
 * state, not a guess. Shares the queryKeys.approvals cache key with ApprovalsTasksView,
 * so approving here is immediately reflected there (and vice versa) without a second
 * subscription — the `permissions` realtime domain already invalidates this key.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sdk } from '../../lib/goodvibes';
import type { FleetProcessNode } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import { approvalsForNode } from '../../lib/fleet';
import { readApprovalEditHunks } from '../../lib/approvals';
import { ApprovalCard } from '../approvals/ApprovalCard';
import { formatError, isSessionClosedError } from '../../lib/errors';
import { useToast } from '../../lib/toast';

function friendlyError(error: unknown): string {
  if (isSessionClosedError(error)) return 'That session is closed — the approval can no longer be actioned.';
  return formatError(error);
}

export function FleetApprovalInline({ node }: { node: FleetProcessNode }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selections, setSelections] = useState<Record<string, ReadonlySet<number>>>({});

  const approvals = useQuery({
    queryKey: queryKeys.approvals,
    queryFn: () => sdk.operator.approvals.list(),
  });

  const matches = useMemo(
    () => approvalsForNode(node, approvals.data?.approvals ?? []),
    [node, approvals.data],
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.approvals });

  const approve = useMutation({
    mutationFn: ({ id, selectedHunks }: { id: string; selectedHunks?: readonly number[]; totalHunks?: number }) =>
      sdk.operator.approvals.approve(id, selectedHunks && selectedHunks.length > 0 ? { selectedHunks } : undefined),
    onSuccess: async (_result, variables) => {
      setSelections((current) => {
        const { [variables.id]: _removed, ...rest } = current;
        return rest;
      });
      await invalidate();
      toast({ title: 'Approved', tone: 'success' });
    },
    onError: (error: unknown) => toast({ title: 'Approve failed', description: friendlyError(error), tone: 'danger' }),
  });

  const deny = useMutation({
    mutationFn: (id: string) => sdk.operator.approvals.deny(id),
    onSuccess: async () => {
      await invalidate();
      toast({ title: 'Denied', tone: 'info' });
    },
    onError: (error: unknown) => toast({ title: 'Deny failed', description: friendlyError(error), tone: 'danger' }),
  });

  const claim = useMutation({
    mutationFn: (id: string) => sdk.operator.approvals.claim(id),
    onSuccess: async () => {
      await invalidate();
      toast({ title: 'Claimed', tone: 'info' });
    },
    onError: (error: unknown) => toast({ title: 'Claim failed', description: friendlyError(error), tone: 'danger' }),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => sdk.operator.approvals.cancel(id),
    onSuccess: async () => {
      await invalidate();
      toast({ title: 'Cancelled', tone: 'info' });
    },
    onError: (error: unknown) => toast({ title: 'Cancel failed', description: friendlyError(error), tone: 'danger' }),
  });

  function toggleHunk(approvalId: string, index: number): void {
    setSelections((current) => {
      const existing = new Set(current[approvalId] ?? []);
      if (existing.has(index)) existing.delete(index);
      else existing.add(index);
      return { ...current, [approvalId]: existing };
    });
  }

  if (approvals.isPending) return null;
  if (matches.length === 0) return null;

  return (
    <div className="fleet-detail__approvals">
      <strong>{matches.length === 1 ? 'Pending approval' : `Pending approvals (${matches.length})`}</strong>
      <ul className="approvals-rows">
        {matches.map((record) => (
          <ApprovalCard
            key={record.id}
            record={record}
            selected={selections[record.id] ?? new Set<number>()}
            onToggleHunk={(index) => toggleHunk(record.id, index)}
            onApprove={(selectedHunks) => approve.mutate({
              id: record.id,
              selectedHunks,
              totalHunks: readApprovalEditHunks(record)?.length,
            })}
            onDeny={() => deny.mutate(record.id)}
            onClaim={() => claim.mutate(record.id)}
            onCancel={() => cancel.mutate(record.id)}
            approving={approve.isPending && approve.variables?.id === record.id}
            denying={deny.isPending && deny.variables === record.id}
            claiming={claim.isPending && claim.variables === record.id}
            cancelling={cancel.isPending && cancel.variables === record.id}
          />
        ))}
      </ul>
    </div>
  );
}
