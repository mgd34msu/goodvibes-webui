import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bot,
  Check,
  CircleDashed,
  Database,
  KeyRound,
  Layers3,
  Play,
  RefreshCcw,
  RotateCcw,
  Server,
  ShieldCheck,
  Square,
  X,
} from 'lucide-react';
import { getCurrentAuth, invokeMethod, sdk } from '../lib/goodvibes';
import { queryKeys } from '../lib/queries';
import { asRecord, bestId, bestStatus, bestTitle, compactJson, firstArray, firstString } from '../lib/object';

function isTrueField(value: unknown, keys: string[]): boolean {
  const record = asRecord(value);
  return keys.some((key) => {
    const item = record[key];
    return item === true || (typeof item === 'string' && item.toLowerCase() === 'true');
  });
}

function valueOrUnknown(value: string): string {
  return value || 'unknown';
}

function DashboardPulse({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof Server;
}) {
  return (
    <section className="dashboard-pulse">
      <Icon size={18} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </section>
  );
}

function EmptyQueue({ children }: { children: string }) {
  return <p className="empty-state compact">{children}</p>;
}

export function DashboardView() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: queryKeys.status, queryFn: () => sdk.operator.control.status() });
  const auth = useQuery({ queryKey: queryKeys.auth, queryFn: getCurrentAuth, retry: false });
  const control = useQuery({ queryKey: queryKeys.control, queryFn: () => sdk.operator.control.snapshot() });
  const accounts = useQuery({ queryKey: queryKeys.accounts, queryFn: () => sdk.operator.accounts.snapshot() });
  const providers = useQuery({ queryKey: queryKeys.providers, queryFn: () => sdk.operator.providers.list() });
  const currentModel = useQuery({ queryKey: ['models', 'current'], queryFn: () => sdk.operator.models.current() });
  const tasks = useQuery({ queryKey: queryKeys.tasks, queryFn: () => sdk.operator.tasks.list() });
  const approvals = useQuery({ queryKey: queryKeys.approvals, queryFn: () => sdk.operator.approvals.list() });
  const sessions = useQuery({ queryKey: queryKeys.sessions, queryFn: () => sdk.operator.sessions.list() });
  const knowledge = useQuery({ queryKey: queryKeys.knowledgeStatus, queryFn: () => invokeMethod('knowledge.status') });

  const refreshDashboard = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.status }),
      queryClient.invalidateQueries({ queryKey: queryKeys.auth }),
      queryClient.invalidateQueries({ queryKey: queryKeys.control }),
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts }),
      queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
      queryClient.invalidateQueries({ queryKey: ['models', 'current'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals }),
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeStatus }),
    ]);
  };

  const taskAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'cancel' | 'retry' }) => {
      if (action === 'cancel') return sdk.operator.tasks.cancel(id);
      return sdk.operator.tasks.retry(id);
    },
    onSuccess: refreshDashboard,
  });

  const approvalAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'claim' | 'approve' | 'deny' | 'cancel' }) => {
      if (action === 'claim') return sdk.operator.approvals.claim(id);
      if (action === 'approve') return sdk.operator.approvals.approve(id);
      if (action === 'deny') return sdk.operator.approvals.deny(id);
      return sdk.operator.approvals.cancel(id);
    },
    onSuccess: refreshDashboard,
  });

  const sessionAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'close' | 'reopen' }) => {
      if (action === 'close') return sdk.operator.sessions.close(id);
      return sdk.operator.sessions.reopen(id);
    },
    onSuccess: refreshDashboard,
  });

  const providerItems = firstArray(providers.data, ['providers', 'items', 'data']);
  const taskItems = firstArray(tasks.data, ['tasks', 'items', 'data']);
  const approvalItems = firstArray(approvals.data, ['approvals', 'items', 'data']);
  const sessionItems = firstArray(sessions.data, ['sessions', 'items', 'data']);
  const accountProviders = firstArray(accounts.data, ['providers']);
  const configuredAccounts = accountProviders.filter((item) => isTrueField(item, ['configured', 'active', 'oauthReady'])).length;

  const authRecord = asRecord(auth.data);
  const authenticated = authRecord.authenticated === true || Boolean(firstString(auth.data, ['principalId', 'username']));
  const authRequired = !authenticated && (status.isError || providers.isError || knowledge.isError);
  const daemonStatus = firstString(status.data, ['status', 'state', 'health']) || (status.isError ? (authRequired ? 'auth required' : 'unavailable') : 'running');
  const daemonVersion = firstString(status.data, ['version']) || 'unknown version';
  const authMode = firstString(auth.data, ['principalId', 'username', 'authMode', 'principalKind']) || (auth.isError ? 'needs auth' : 'anonymous');
  const currentProvider = firstString(currentModel.data, ['provider', 'providerId', 'routeProvider']);
  const currentModelId = firstString(currentModel.data, ['model', 'modelId', 'id', 'registryKey']);
  const currentRoute = [currentProvider, currentModelId].filter(Boolean).join(' / ') || 'daemon default';
  const knowledgeStatus = firstString(knowledge.data, ['status', 'state', 'health']) || (knowledge.isError ? (authRequired ? 'auth required' : 'unavailable') : 'available');
  const activeTasks = taskItems.filter((item) => !['completed', 'cancelled', 'failed'].includes(bestStatus(item).toLowerCase()));
  const pendingApprovals = approvalItems.filter((item) => !['approved', 'denied', 'cancelled', 'completed'].includes(bestStatus(item).toLowerCase()));

  return (
    <div className="dashboard-shell">
      <section className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <span>Operator Overview</span>
          <h2>{valueOrUnknown(daemonStatus)}</h2>
          <p>{daemonVersion} · {currentRoute}</p>
        </div>
        <button className="primary-button" type="button" onClick={() => void refreshDashboard()}>
          <RefreshCcw size={16} />
          Refresh
        </button>
      </section>

      <div className="dashboard-pulse-grid">
        <DashboardPulse icon={KeyRound} label="Auth" value={authMode} detail={auth.isError ? 'Sign in from Admin' : 'Browser/operator context'} />
        <DashboardPulse icon={Bot} label="Providers" value={providerItems.length} detail={`${configuredAccounts} configured account${configuredAccounts === 1 ? '' : 's'}`} />
        <DashboardPulse icon={Database} label="Knowledge" value={knowledgeStatus} detail="Default regular knowledge space" />
        <DashboardPulse icon={CircleDashed} label="Queue" value={activeTasks.length} detail={`${pendingApprovals.length} approval${pendingApprovals.length === 1 ? '' : 's'} pending`} />
      </div>

      <div className="dashboard-grid">
        <section className="panel dashboard-queue-panel">
          <div className="panel-title">
            <h2>Action Queue</h2>
            <ShieldCheck size={18} />
          </div>
          <div className="queue-columns">
            <div>
              <h3>Tasks</h3>
              <div className="action-list">
                {taskItems.slice(0, 6).map((task, index) => {
                  const id = bestId(task);
                  return (
                    <article key={`${id}-${index}`} className="action-row">
                      <div>
                        <strong>{bestTitle(task, id || 'task')}</strong>
                        <span>{bestStatus(task)}</span>
                      </div>
                      <div className="row-actions">
                        <button type="button" title="Cancel" disabled={!id} onClick={() => void taskAction.mutate({ id, action: 'cancel' })}>
                          <Square size={15} />
                        </button>
                        <button type="button" title="Retry" disabled={!id} onClick={() => void taskAction.mutate({ id, action: 'retry' })}>
                          <RotateCcw size={15} />
                        </button>
                      </div>
                    </article>
                  );
                })}
                {!taskItems.length && <EmptyQueue>No tasks</EmptyQueue>}
              </div>
            </div>
            <div>
              <h3>Approvals</h3>
              <div className="action-list">
                {approvalItems.slice(0, 6).map((approval, index) => {
                  const id = bestId(approval);
                  return (
                    <article key={`${id}-${index}`} className="action-row">
                      <div>
                        <strong>{bestTitle(approval, id || 'approval')}</strong>
                        <span>{bestStatus(approval)}</span>
                      </div>
                      <div className="row-actions">
                        <button type="button" title="Claim" disabled={!id} onClick={() => void approvalAction.mutate({ id, action: 'claim' })}>
                          <Play size={15} />
                        </button>
                        <button type="button" title="Approve" disabled={!id} onClick={() => void approvalAction.mutate({ id, action: 'approve' })}>
                          <Check size={15} />
                        </button>
                        <button type="button" title="Deny" disabled={!id} onClick={() => void approvalAction.mutate({ id, action: 'deny' })}>
                          <X size={15} />
                        </button>
                      </div>
                    </article>
                  );
                })}
                {!approvalItems.length && <EmptyQueue>No approvals</EmptyQueue>}
              </div>
            </div>
          </div>
        </section>

        <section className="panel dashboard-readiness-panel">
          <div className="panel-title">
            <h2>Runtime Readiness</h2>
            {status.isError || knowledge.isError ? <AlertTriangle size={18} /> : <Layers3 size={18} />}
          </div>
          <div className="runtime-grid">
            <div>
              <span className={status.isError ? 'status-dot warning' : 'status-dot ok'} />
              <strong>Daemon</strong>
              <span>{daemonStatus} · {daemonVersion}</span>
            </div>
            <div>
              <span className={auth.isError ? 'status-dot warning' : 'status-dot ok'} />
              <strong>Auth</strong>
              <span>{authMode}</span>
            </div>
            <div>
              <span className={providerItems.length ? 'status-dot ok' : 'status-dot warning'} />
              <strong>Model Route</strong>
              <span>{currentRoute}</span>
            </div>
            <div>
              <span className={knowledge.isError ? 'status-dot warning' : 'status-dot ok'} />
              <strong>Knowledge</strong>
              <span>{knowledgeStatus}</span>
            </div>
          </div>
        </section>
      </div>

      <div className="two-column">
        <section className="panel">
          <div className="panel-title">
            <h2>Operator Sessions</h2>
            <Server size={18} />
          </div>
          <div className="action-list">
            {sessionItems.slice(0, 8).map((session, index) => {
              const id = bestId(session);
              return (
                <article key={`${id}-${index}`} className="action-row">
                  <div>
                    <strong>{bestTitle(session, id || 'session')}</strong>
                    <span>{bestStatus(session)}</span>
                  </div>
                  <div className="row-actions">
                    <button type="button" title="Close" disabled={!id} onClick={() => void sessionAction.mutate({ id, action: 'close' })}>
                      <Square size={15} />
                    </button>
                    <button type="button" title="Reopen" disabled={!id} onClick={() => void sessionAction.mutate({ id, action: 'reopen' })}>
                      <RotateCcw size={15} />
                    </button>
                  </div>
                </article>
              );
            })}
            {!sessionItems.length && <EmptyQueue>No operator sessions</EmptyQueue>}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <h2>Diagnostics</h2>
            <Database size={18} />
          </div>
          <details className="diagnostic-block">
            <summary>Control snapshot</summary>
            <pre>{compactJson(control.data)}</pre>
          </details>
          <details className="diagnostic-block">
            <summary>Account posture</summary>
            <pre>{compactJson(accounts.data)}</pre>
          </details>
        </section>
      </div>
    </div>
  );
}
