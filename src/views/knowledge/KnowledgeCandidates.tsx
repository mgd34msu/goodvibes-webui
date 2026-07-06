/**
 * KnowledgeCandidatesPanel — consolidation candidates (knowledge.candidates.list /
 * .candidate.get / .candidate.decide), a never-called-before surface (like the
 * jobs-activity peek in KnowledgeJobsPeek.tsx) this brief adopts. A candidate is a
 * scored suggestion to promote something into durable memory, review it, or refresh
 * its source — accept/reject/supersede is an explicit, per-row decision, never
 * auto-applied.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ListChecks, XCircle } from 'lucide-react';
import { invokeMethod } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import { firstArray, firstString, countFrom } from '../../lib/object';
import { StatusBadge } from '../../components/StatusBadge';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';

type Decision = 'accept' | 'reject' | 'supersede';

export function KnowledgeCandidatesPanel() {
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState('');

  const candidates = useQuery({
    queryKey: queryKeys.knowledgeCandidates,
    queryFn: () => invokeMethod('knowledge.candidates.list', { limit: 50 }),
  });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: Decision }) => {
      setPendingId(id);
      return invokeMethod('knowledge.candidate.decide', { id, decision });
    },
    onSuccess: async () => {
      setPendingId('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeCandidates });
    },
    onError: () => setPendingId(''),
  });

  if (candidates.isPending) {
    return (
      <div className="knowledge-skeleton-group">
        <SkeletonBlock width="100%" height={40} />
        <SkeletonBlock width="100%" height={40} />
      </div>
    );
  }

  if (candidates.error) {
    return (
      <ErrorState
        error={candidates.error}
        onRetry={() => void candidates.refetch()}
        title="Candidates failed to load"
      />
    );
  }

  const items = firstArray(candidates.data, ['candidates']);

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<ListChecks size={24} aria-hidden="true" />}
        title="No consolidation candidates"
        description="Candidates appear here when the knowledge base scores something worth promoting, reviewing, or refreshing."
      />
    );
  }

  return (
    <div className="knowledge-candidates-list">
      {decide.error && (
        <ErrorState error={decide.error} title="Decision failed" />
      )}
      {items.map((candidate, index) => {
        const id = firstString(candidate, ['id']) || String(index);
        const title = firstString(candidate, ['title']) || firstString(candidate, ['summary']) || 'Untitled candidate';
        const status = firstString(candidate, ['status']) || 'unknown';
        const candidateType = firstString(candidate, ['candidateType']);
        const score = countFrom(candidate, ['score']);
        const summary = firstString(candidate, ['summary']);
        const isPendingRow = decide.isPending && pendingId === id;
        const decided = status !== 'pending' && status !== 'unknown';
        return (
          <article key={id} className="knowledge-candidate-row">
            <div className="knowledge-candidate-row__head">
              <strong>{title}</strong>
              <StatusBadge value={status} />
            </div>
            {summary && <p className="knowledge-candidate-row__summary">{summary}</p>}
            <p className="knowledge-candidate-row__meta">
              {candidateType || 'candidate'} · score {score.toFixed(2)}
            </p>
            {!decided && (
              <div className="knowledge-candidate-row__actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isPendingRow}
                  aria-busy={isPendingRow}
                  onClick={() => decide.mutate({ id, decision: 'accept' })}
                >
                  <CheckCircle2 size={14} aria-hidden="true" /> Accept
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isPendingRow}
                  aria-busy={isPendingRow}
                  onClick={() => decide.mutate({ id, decision: 'reject' })}
                >
                  <XCircle size={14} aria-hidden="true" /> Reject
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isPendingRow}
                  aria-busy={isPendingRow}
                  onClick={() => decide.mutate({ id, decision: 'supersede' })}
                >
                  Supersede
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
