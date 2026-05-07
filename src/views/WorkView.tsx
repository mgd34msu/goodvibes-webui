import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Play, RefreshCcw, RotateCcw, Square, X } from 'lucide-react';
import { sdk } from '../lib/goodvibes';
import { queryKeys } from '../lib/queries';
import { DataBlock } from '../components/DataBlock';
import { RecordList } from '../components/RecordList';
import { bestId, bestStatus, bestTitle, firstArray } from '../lib/object';

export function WorkView() {
  const queryClient = useQueryClient();
  const tasks = useQuery({ queryKey: queryKeys.tasks, queryFn: () => sdk.operator.tasks.list() });
  const approvals = useQuery({ queryKey: queryKeys.approvals, queryFn: () => sdk.operator.approvals.list() });
  const sessions = useQuery({ queryKey: queryKeys.sessions, queryFn: () => sdk.operator.sessions.list() });

  const refreshWork = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals }),
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
    ]);
  };

  const taskAction = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'cancel' | 'retry' }) => {
      if (action === 'cancel') return sdk.operator.tasks.cancel(id);
      return sdk.operator.tasks.retry(id);
    },
    onSuccess: refreshWork,
  });

  const approvalAction = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'claim' | 'approve' | 'deny' | 'cancel' }) => {
      if (action === 'claim') return sdk.operator.approvals.claim(id);
      if (action === 'approve') return sdk.operator.approvals.approve(id);
      if (action === 'deny') return sdk.operator.approvals.deny(id);
      return sdk.operator.approvals.cancel(id);
    },
    onSuccess: refreshWork,
  });

  const sessionAction = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'close' | 'reopen' }) => {
      if (action === 'close') return sdk.operator.sessions.close(id);
      return sdk.operator.sessions.reopen(id);
    },
    onSuccess: refreshWork,
  });

  const taskItems = firstArray(tasks.data, ['tasks', 'items', 'data']);
  const approvalItems = firstArray(approvals.data, ['approvals', 'items', 'data']);
  const sessionItems = firstArray(sessions.data, ['sessions', 'items', 'data']);

  return (
    <div className="stack">
      <div className="three-column">
        <section className="panel">
          <div className="panel-title">
            <h2>Tasks</h2>
            <button className="icon-button" type="button" title="Refresh" onClick={() => void refreshWork()}>
              <RefreshCcw size={17} />
            </button>
          </div>
          <div className="action-list">
            {taskItems.map((task, index) => {
              const id = bestId(task);
              return (
                <article key={`${id}-${index}`} className="action-row">
                  <div>
                    <strong>{bestTitle(task, id)}</strong>
                    <span>{bestStatus(task)}</span>
                  </div>
                  <div className="row-actions">
                    <button type="button" title="Cancel" onClick={() => void taskAction.mutate({ id, action: 'cancel' })}>
                      <Square size={15} />
                    </button>
                    <button type="button" title="Retry" onClick={() => void taskAction.mutate({ id, action: 'retry' })}>
                      <RotateCcw size={15} />
                    </button>
                  </div>
                </article>
              );
            })}
            {!taskItems.length && <p className="empty-state">No tasks</p>}
          </div>
        </section>

        <section className="panel">
          <h2>Approvals</h2>
          <div className="action-list">
            {approvalItems.map((approval, index) => {
              const id = bestId(approval);
              return (
                <article key={`${id}-${index}`} className="action-row">
                  <div>
                    <strong>{bestTitle(approval, id)}</strong>
                    <span>{bestStatus(approval)}</span>
                  </div>
                  <div className="row-actions">
                    <button type="button" title="Claim" onClick={() => void approvalAction.mutate({ id, action: 'claim' })}>
                      <Play size={15} />
                    </button>
                    <button type="button" title="Approve" onClick={() => void approvalAction.mutate({ id, action: 'approve' })}>
                      <Check size={15} />
                    </button>
                    <button type="button" title="Deny" onClick={() => void approvalAction.mutate({ id, action: 'deny' })}>
                      <X size={15} />
                    </button>
                  </div>
                </article>
              );
            })}
            {!approvalItems.length && <p className="empty-state">No approvals</p>}
          </div>
        </section>

        <section className="panel">
          <h2>Sessions</h2>
          <div className="action-list">
            {sessionItems.map((session, index) => {
              const id = bestId(session);
              return (
                <article key={`${id}-${index}`} className="action-row">
                  <div>
                    <strong>{bestTitle(session, id)}</strong>
                    <span>{bestStatus(session)}</span>
                  </div>
                  <div className="row-actions">
                    <button type="button" title="Close" onClick={() => void sessionAction.mutate({ id, action: 'close' })}>
                      <Square size={15} />
                    </button>
                    <button type="button" title="Reopen" onClick={() => void sessionAction.mutate({ id, action: 'reopen' })}>
                      <RotateCcw size={15} />
                    </button>
                  </div>
                </article>
              );
            })}
            {!sessionItems.length && <p className="empty-state">No sessions</p>}
          </div>
        </section>
      </div>

      <div className="two-column">
        <DataBlock title="Task Detail" value={tasks.data} />
        <DataBlock title="Approval Detail" value={approvals.data} />
      </div>
      <section className="panel">
        <h2>Session Browser</h2>
        <RecordList items={sessionItems} />
      </section>
    </div>
  );
}
