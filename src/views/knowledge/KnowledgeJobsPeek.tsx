/**
 * KnowledgeJobsPeek — the activity detail behind the Map/Nodes "View jobs" link
 * (W8: the '766 jobs ran / 0 nodes' gap). Reads the previously-never-called
 * knowledge.jobs.list + knowledge.job-runs.list so a maintainer can see WHY
 * indexing produced no nodes, instead of a dead click or a bare zero.
 */
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { invokeMethod } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import { countFrom, firstArray, firstString, readPath } from '../../lib/object';
import { StatusBadge } from '../../components/StatusBadge';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';

function formatRunTimestamp(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? new Date(value).toLocaleString() : 'unknown time';
}

export function KnowledgeJobsPeekBody() {
  const jobs = useQuery({
    queryKey: queryKeys.knowledgeJobs,
    queryFn: () => invokeMethod('knowledge.jobs.list', {}),
  });
  const runs = useQuery({
    queryKey: [...queryKeys.knowledgeJobs, 'runs'],
    queryFn: () => invokeMethod('knowledge.job-runs.list', { limit: 50 }),
  });

  if (jobs.isPending || runs.isPending) {
    return (
      <div className="knowledge-peek-loading">
        <SkeletonBlock width="60%" height={18} />
        <SkeletonBlock width="100%" height={14} />
        <SkeletonBlock width="100%" height={14} />
        <SkeletonBlock width="80%" height={14} />
      </div>
    );
  }

  const queryError = jobs.error ?? runs.error;
  if (queryError) {
    return (
      <div className="knowledge-peek-body">
        <ErrorState
          error={queryError}
          onRetry={() => { void jobs.refetch(); void runs.refetch(); }}
          title="Job activity unavailable"
        />
      </div>
    );
  }

  const jobItems = firstArray(jobs.data, ['jobs']);
  const runItems = firstArray(runs.data, ['runs']);
  const jobTitleById = new Map(jobItems.map((job) => [firstString(job, ['id']), firstString(job, ['title'])]));

  if (runItems.length === 0) {
    return (
      <div className="knowledge-peek-body">
        <EmptyState
          icon={<Activity size={24} />}
          title="No job runs yet"
          description="Indexing jobs have not run yet."
        />
      </div>
    );
  }

  const sortedRuns = [...runItems].sort(
    (a, b) => countFrom(b, ['requestedAt']) - countFrom(a, ['requestedAt']),
  );

  return (
    <div className="knowledge-peek-body">
      <p className="knowledge-jobs-peek__summary">
        {jobItems.length} job{jobItems.length === 1 ? '' : 's'} defined · {runItems.length} run{runItems.length === 1 ? '' : 's'} shown
      </p>
      <ul className="knowledge-jobs-peek__list">
        {sortedRuns.map((run, index) => {
          const id = firstString(run, ['id']) || String(index);
          const jobId = firstString(run, ['jobId']);
          const mappedTitle = jobTitleById.get(jobId);
          // Fall through past a genuinely-empty title (not just a nullish one) to the
          // jobId, and past an empty jobId to a final honest label — a plain `??` would
          // stop at an empty-string title, so this is a truthiness fallback, not a
          // nullish one.
          const title = [mappedTitle, jobId].find((value): value is string => Boolean(value?.trim())) ?? 'Unknown job';
          const status = firstString(run, ['status']) || 'unknown';
          const requestedAt = readPath(run, ['requestedAt']);
          const error = firstString(run, ['error']);
          return (
            <li key={id} className="knowledge-jobs-peek__row">
              <div className="knowledge-jobs-peek__row-head">
                <strong>{title}</strong>
                <StatusBadge value={status} />
              </div>
              <span className="knowledge-jobs-peek__meta">{formatRunTimestamp(requestedAt)}</span>
              {error && <p className="knowledge-jobs-peek__error">{error}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
