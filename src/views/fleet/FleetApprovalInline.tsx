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
import type { ApprovalApproveInput, FleetProcessNode } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import { approvalsForNode } from '../../lib/fleet';
import { isDurableRememberTier, readApprovalEditHunks, recordedAnswerDelivered, recordedRememberTier } from '../../lib/approvals';
import { ApprovalCard, type ApprovalCardApproveInput } from '../approvals/ApprovalCard';
import { formatError, isSessionClosedError } from '../../lib/errors';
import { useToast } from '../../lib/toast';

function friendlyError(error: unknown): string {
  if (isSessionClosedError(error)) return 'That session is closed — the approval can no longer be actioned.';
  return formatError(error);
}

export function FleetApprovalInline({ node, onOpenSession }: {
  node: FleetProcessNode;
  /** Navigate to a session's chat view — the "open fix session" affordance on a
   * resolved approved CI fix offer (record.fixSessionId). */
  onOpenSession?: (sessionId: string) => void;
}) {
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
    mutationFn: ({ id, selectedHunks, rememberTier, answer }: { id: string } & ApprovalCardApproveInput & { totalHunks?: number }) => {
      const input: ApprovalApproveInput = {
        ...(selectedHunks && selectedHunks.length > 0 ? { selectedHunks } : {}),
        ...(rememberTier ? { rememberTier, remember: true } : {}),
        ...(answer !== undefined ? { modifiedArgs: { answer } } : {}),
      };
      return sdk.operator.approvals.approve(id, Object.keys(input).length > 0 ? input : undefined);
    },
    onSuccess: async (result, variables) => {
      setSelections((current) => {
        const { [variables.id]: _removed, ...rest } = current;
        return rest;
      });
      await invalidate();
      // Same recorded-block honesty as ApprovalsTasksView: report what the
      // daemon recorded, not what was sent.
      const recordedTier = recordedRememberTier(result);
      if (variables.rememberTier) {
        if (recordedTier && isDurableRememberTier(recordedTier)) {
          await queryClient.invalidateQueries({ queryKey: queryKeys.permissionRules });
        }
        toast(recordedTier
          ? { title: 'Approved', description: `Remembered (${recordedTier}).`, tone: 'success' }
          : { title: 'Approved', description: 'The daemon did not record the remember request — applied once.', tone: 'info' });
        return;
      }
      if (variables.answer !== undefined) {
        toast(recordedAnswerDelivered(result)
          ? { title: 'Answer sent', description: 'The reply is feeding the waiting command.', tone: 'success' }
          : { title: 'Approved', description: 'The daemon did not record the answer — the command may stop on its prompt.', tone: 'info' });
        return;
      }
      toast({ title: 'Approved', tone: 'success' });
    },
    onError: (error: unknown) => toast({ title: 'Approve failed', description: friendlyError(error), tone: 'danger' }),
  });

  const deny = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      sdk.operator.approvals.deny(id, reason ? { note: reason, reason } : undefined),
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
            onApprove={(input) => approve.mutate({
              id: record.id,
              ...input,
              totalHunks: readApprovalEditHunks(record)?.length,
            })}
            onDeny={(reason) => deny.mutate({ id: record.id, reason })}
            onClaim={() => claim.mutate(record.id)}
            onCancel={() => cancel.mutate(record.id)}
            approving={approve.isPending && approve.variables?.id === record.id}
            denying={deny.isPending && deny.variables?.id === record.id}
            claiming={claim.isPending && claim.variables === record.id}
            cancelling={cancel.isPending && cancel.variables === record.id}
            {...(onOpenSession ? { onOpenSession } : {})}
          />
        ))}
      </ul>
    </div>
  );
}
