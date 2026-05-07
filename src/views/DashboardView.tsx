import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bot, CheckCircle2, CircleDashed, KeyRound, Server, ShieldCheck } from 'lucide-react';
import { sdk } from '../lib/goodvibes';
import { invokeMethod } from '../lib/goodvibes';
import { queryKeys } from '../lib/queries';
import { countFrom, firstArray, firstString } from '../lib/object';
import { DataBlock } from '../components/DataBlock';
import { StatusBadge } from '../components/StatusBadge';

function MetricCard({
  label,
  value,
  detail,
  status,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  status: string;
  icon: typeof Server;
}) {
  return (
    <section className="metric-card">
      <div className="metric-head">
        <Icon size={20} />
        <StatusBadge value={status} />
      </div>
      <strong>{value}</strong>
      <span>{label}</span>
      <p>{detail}</p>
    </section>
  );
}

export function DashboardView() {
  const status = useQuery({ queryKey: queryKeys.status, queryFn: () => sdk.operator.control.status() });
  const control = useQuery({ queryKey: queryKeys.control, queryFn: () => sdk.operator.control.snapshot() });
  const accounts = useQuery({ queryKey: queryKeys.accounts, queryFn: () => sdk.operator.accounts.snapshot() });
  const providers = useQuery({ queryKey: queryKeys.providers, queryFn: () => sdk.operator.providers.list() });
  const tasks = useQuery({ queryKey: queryKeys.tasks, queryFn: () => sdk.operator.tasks.list() });
  const approvals = useQuery({ queryKey: queryKeys.approvals, queryFn: () => sdk.operator.approvals.list() });
  const knowledge = useQuery({ queryKey: queryKeys.knowledgeStatus, queryFn: () => invokeMethod('knowledge.status') });

  const providerItems = firstArray(providers.data, ['providers', 'items', 'data']);
  const approvalItems = firstArray(approvals.data, ['approvals', 'items', 'data']);
  const taskItems = firstArray(tasks.data, ['tasks', 'items', 'data']);
  const accountProviders = firstArray(accounts.data, ['providers']);

  const daemonStatus = firstString(status.data, ['status', 'state', 'health']) || (status.isError ? 'error' : 'unknown');
  const authStatus = firstString(control.data, ['authStatus', 'auth', 'principalId']) || 'authenticated';
  const knowledgeStatus = firstString(knowledge.data, ['status', 'state', 'health']) || 'available';

  return (
    <div className="stack">
      <div className="metric-grid">
        <MetricCard
          icon={Server}
          label="Daemon"
          value={daemonStatus}
          detail={firstString(status.data, ['version', 'mode', 'message']) || 'Control plane status'}
          status={daemonStatus}
        />
        <MetricCard
          icon={KeyRound}
          label="Auth"
          value={authStatus}
          detail="Session and operator context"
          status={authStatus}
        />
        <MetricCard
          icon={Bot}
          label="Providers"
          value={providerItems.length || countFrom(accounts.data, ['providers'])}
          detail={`${accountProviders.filter((item) => firstString(item, ['configured']) === 'true').length} configured accounts`}
          status={providerItems.length ? 'ready' : 'pending'}
        />
        <MetricCard
          icon={CircleDashed}
          label="Tasks"
          value={taskItems.length}
          detail="Background work tracked by the daemon"
          status={taskItems.length ? 'active' : 'idle'}
        />
        <MetricCard
          icon={ShieldCheck}
          label="Approvals"
          value={approvalItems.length}
          detail="Human-in-the-Loop review queue"
          status={approvalItems.length ? 'pending' : 'clear'}
        />
        <MetricCard
          icon={knowledge.isError ? AlertTriangle : CheckCircle2}
          label="Knowledge"
          value={knowledgeStatus}
          detail={firstString(knowledge.data, ['summary', 'message']) || 'Regular knowledge and wiki'}
          status={knowledgeStatus}
        />
      </div>

      <div className="two-column">
        <DataBlock title="Control Plane Snapshot" value={control.data} />
        <DataBlock title="Account Posture" value={accounts.data} />
      </div>
    </div>
  );
}
