/**
 * PermissionRulesSection — the durable approval rules view: every remembered
 * decision at a generalizing tier (permissions.rules.list), with revocation
 * (permissions.rules.delete). Rules are write-only from decisions — nothing
 * here mints one; deleting a grant makes matching asks prompt again, which is
 * exactly what the delete confirmation says. A `deleted:false` response is the
 * daemon's honest "no such rule" (already gone) — surfaced as info, not error.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { sdk } from '../../lib/goodvibes';
import type { PermissionRuleRecord } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import { formatError } from '../../lib/errors';
import { formatRelative } from '../../lib/object';
import { useToast } from '../../lib/toast';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';

/** One-line human reading of a rule: effect + tier + tool + optional description. */
function ruleSummary(rule: PermissionRuleRecord): string {
  const effect = rule.effect === 'deny' ? 'Deny' : 'Allow';
  return `${effect} · ${rule.tier} · ${rule.tool}`;
}

export function PermissionRulesSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const rules = useQuery({
    queryKey: queryKeys.permissionRules,
    queryFn: () => sdk.operator.permissions.rules.list(),
  });

  const remove = useMutation({
    mutationFn: (ruleId: string) => sdk.operator.permissions.rules.delete(ruleId),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.permissionRules });
      toast(result.deleted
        ? { title: 'Rule deleted', description: 'Matching asks will prompt again.', tone: 'info' }
        : { title: 'Rule already gone', description: 'The daemon reported no such rule.', tone: 'info' });
    },
    onError: (error: unknown) => {
      toast({ title: 'Delete failed', description: formatError(error), tone: 'danger' });
    },
  });

  const rows = rules.data?.rules ?? [];

  return (
    <section className="permission-rules-section" data-testid="permission-rules">
      <div className="approvals-toolbar">
        <span className="approvals-toolbar__summary">
          <ShieldCheck size={14} /> Approval rules
          {rules.isSuccess && ` · ${rows.length} durable`}
        </span>
        <button className="icon-button" type="button" title="Refresh rules" onClick={() => void rules.refetch()}>
          <RefreshCw size={15} className={rules.isFetching ? 'spin' : undefined} />
        </button>
      </div>

      {rules.isPending && <SkeletonBlock variant="text" lines={2} />}

      {rules.isError && (
        <ErrorState error={rules.error} onRetry={() => void rules.refetch()} title="Failed to load approval rules" />
      )}

      {rules.isSuccess && rows.length === 0 && (
        <EmptyState
          icon={<ShieldCheck size={28} />}
          title="No durable approval rules"
          description="Approving with a remember scope (exact command, command class, path, or tool) records a rule here; deleting one makes matching asks prompt again."
        />
      )}

      {rules.isSuccess && rows.length > 0 && (
        <ul className="permission-rules-rows">
          {rows.map((rule) => (
            <li key={rule.id} className="permission-rule-row" data-rule-id={rule.id}>
              <div className="permission-rule-row__main">
                <span className={`badge ${rule.effect === 'deny' ? 'bad' : 'ok'}`}>{rule.effect}</span>
                <span className="permission-rule-row__summary">{ruleSummary(rule)}</span>
                {rule.description && <small className="permission-rule-row__desc">{rule.description}</small>}
                <small className="permission-rule-row__age">created {formatRelative(rule.createdAt)}</small>
              </div>
              <button
                type="button"
                className="secondary-button permission-rule-row__delete"
                disabled={remove.isPending && remove.variables === rule.id}
                aria-label={`Delete rule: ${ruleSummary(rule)}`}
                title="Delete this rule — matching asks will prompt again"
                onClick={() => remove.mutate(rule.id)}
              >
                <Trash2 size={14} /> {remove.isPending && remove.variables === rule.id ? 'Deleting…' : 'Delete'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
