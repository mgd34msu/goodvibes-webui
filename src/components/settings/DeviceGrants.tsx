/**
 * DeviceGrants — the grants surface for paired-phone capabilities.
 *
 * The owner's ruling of 2026-07-25 requires that "always allow" be "a durable
 * per-capability, per-node grant, visible and revocable in the grants surface".
 * This panel is that surface: every durable grant with the device it belongs
 * to, the capability it covers, when it was given, when it expires, and how
 * often it has been used — each with a revoke control — plus the recent ledger
 * of grants given, used, revoked, and expired, and a control to run the
 * housekeeping sweep and read back exactly what it removed.
 *
 * It renders from devices.grants.list / devices.grants.revoke /
 * devices.housekeeping.run, so it shows the daemon's own record rather than a
 * client-side mirror that could disagree with what is actually honoured.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Smartphone, Trash2 } from 'lucide-react';
import { invokeMethod } from '../../lib/goodvibes';
import type { OperatorMethodOutput } from '../../lib/goodvibes';
import { formatError, isMethodUnavailableError } from '../../lib/errors';
import { EmptyState } from '../feedback/EmptyState';
import { ErrorState } from '../feedback/ErrorState';
import { SkeletonBlock } from '../feedback/SkeletonBlock';
import '../../styles/components/device.css';

type GrantsResult = OperatorMethodOutput<'devices.grants.list'>;
type NodesResult = OperatorMethodOutput<'devices.nodes.list'>;
type HousekeepingResult = OperatorMethodOutput<'devices.housekeeping.run'>;

export const deviceGrantsQueryKey = ['devices', 'grants'] as const;
export const deviceNodesQueryKey = ['devices', 'nodes'] as const;

function formatWhen(value: number | null | undefined): string {
  if (!value) return 'never';
  return new Date(value).toLocaleString();
}

export function DeviceGrants() {
  const queryClient = useQueryClient();
  const [sweep, setSweep] = useState<HousekeepingResult | null>(null);

  const grants = useQuery<GrantsResult>({
    queryKey: deviceGrantsQueryKey,
    queryFn: () => invokeMethod('devices.grants.list', {}),
  });
  const nodes = useQuery<NodesResult>({
    queryKey: deviceNodesQueryKey,
    queryFn: () => invokeMethod('devices.nodes.list', {}),
  });

  const revoke = useMutation({
    mutationFn: (grantId: string) => invokeMethod('devices.grants.revoke', { grantId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: deviceGrantsQueryKey });
    },
  });

  const housekeeping = useMutation({
    mutationFn: () => invokeMethod('devices.housekeeping.run', {}),
    onSuccess: (result) => {
      setSweep(result);
      void queryClient.invalidateQueries({ queryKey: deviceGrantsQueryKey });
    },
  });

  if (grants.isPending) {
    return (
      <section className="panel device-panel">
        <div className="panel-title">
          <h2>Phone capability grants</h2>
          <Smartphone size={18} aria-hidden="true" />
        </div>
        <div aria-label="Loading device grants" aria-busy="true">
          <SkeletonBlock variant="text" lines={3} />
        </div>
      </section>
    );
  }

  if (grants.isError) {
    // A daemon that predates this feature answers "method unavailable"; that is
    // an honest "not on this daemon yet", not an error state to alarm anyone.
    if (isMethodUnavailableError(grants.error)) {
      return (
        <section className="panel device-panel">
          <div className="panel-title">
            <h2>Phone capability grants</h2>
            <Smartphone size={18} aria-hidden="true" />
          </div>
          <EmptyState
            title="Not available on this daemon"
            description="This daemon does not serve the paired-phone capability verbs yet. Update it to manage phone grants here."
          />
        </section>
      );
    }
    return (
      <section className="panel device-panel">
        <div className="panel-title">
          <h2>Phone capability grants</h2>
          <Smartphone size={18} aria-hidden="true" />
        </div>
        <ErrorState error={grants.error} title="Device grants unavailable" onRetry={() => void grants.refetch()} />
      </section>
    );
  }

  const rows = grants.data.grants;
  const nodeLabels = new Map((nodes.data?.nodes ?? []).map((node) => [node.nodeId, node.label]));

  return (
    <section className="panel device-panel">
      <div className="panel-title">
        <h2>Phone capability grants</h2>
        <Smartphone size={18} aria-hidden="true" />
      </div>

      <p className="device-panel__description">
        Every capability asks before it runs. Choosing &ldquo;always allow&rdquo; on that prompt
        writes one durable grant for that one capability on that one phone — listed here, and
        revocable here. Revoking deletes the grant, so the next request asks again.
        {nodes.data ? ` Captures are kept for ${String(nodes.data.captureRetentionHours)} hours.` : ''}
      </p>

      <div className="device-panel__actions">
        <button type="button" onClick={() => void grants.refetch()} disabled={grants.isFetching}>
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </button>
        <button type="button" onClick={() => housekeeping.mutate()} disabled={housekeeping.isPending}>
          Run housekeeping now
        </button>
      </div>

      {housekeeping.isError ? (
        <p role="alert">{formatError(housekeeping.error)}</p>
      ) : null}
      {sweep ? (
        <p aria-live="polite">{sweep.summary}</p>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="No durable grants"
          description="Nothing has been granted &ldquo;always allow&rdquo; yet. Every phone capability is asking each time."
        />
      ) : (
        <ul className="device-list">
          {rows.map((grant) => (
            <li key={grant.grantId} className="device-list__row">
              <div>
                <strong>{grant.capabilityTitle}</strong>
                <div className="device-list__detail">
                  {nodeLabels.get(grant.nodeId) ?? grant.nodeId} · {grant.nodeKind}
                </div>
                <div className="device-list__detail">
                  Granted {formatWhen(grant.grantedAt)} · expires {formatWhen(grant.expiresAt)} ·
                  used {String(grant.useCount)} time{grant.useCount === 1 ? '' : 's'} ·
                  last used {formatWhen(grant.lastUsedAt)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => revoke.mutate(grant.grantId)}
                disabled={revoke.isPending}
                aria-label={`Revoke ${grant.capabilityTitle}`}
              >
                <Trash2 size={14} aria-hidden="true" /> Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      {grants.data.audit.length > 0 ? (
        <details>
          <summary>Recent grant activity ({grants.data.audit.length})</summary>
          <ul className="device-list">
            {grants.data.audit.slice(-25).reverse().map((entry) => (
              <li key={entry.id} className="device-list__row">
                <span>
                  {entry.action} · {entry.capabilityId} · {nodeLabels.get(entry.nodeId) ?? entry.nodeId}
                  {entry.reason ? ` · ${entry.reason}` : ''}
                </span>
                <span>{formatWhen(entry.at)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
