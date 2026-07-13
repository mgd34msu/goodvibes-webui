/**
 * CiWatchesView — standing CI watches (ci.watches.*) plus an honest per-job status
 * detail (ci.status / ci.watches.run).
 *
 * Master/detail, mirroring CheckpointsView: list every standing watch
 * (ci.watches.list), create one (ci.watches.create) or delete one (ci.watches.delete,
 * behind a confirm sheet — deleting a watch stops its notifications), select one to
 * poll it immediately (ci.watches.run) and see the resulting per-job report. A
 * separate ad hoc lookup (ci.status) checks any repo/ref/PR without creating a watch.
 *
 * Per this surface's honesty bar: the detail ALWAYS lists every job with its own
 * conclusion — never a bare rollup badge with no job list underneath. continue-on-error
 * jobs are shown as a distinct badge when the wire reports them, and violations (the
 * daemon's own reasons the verdict is not a clean "passed") are listed verbatim.
 *
 * ci.* emits no wire event yet (a standing gap shared with fleet.*, checkpoints.*,
 * memory.* — see queryKeys.ciWatches), so freshness comes from mutation-driven
 * invalidation and a manual refresh, not realtime invalidation.
 */

import { useState, type SyntheticEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ExternalLink, GitBranch, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { sdk } from '../../lib/goodvibes';
import type { OperatorMethodOutput } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';
import { useConfirmSheet } from '../../components/confirm/useConfirmSheet';
import { formatError, isMethodUnavailableError } from '../../lib/errors';
import { formatRelative } from '../../lib/object';
import { useToast } from '../../lib/toast';
import '../../styles/components/ci-watches.css';

type CiWatch = OperatorMethodOutput<'ci.watches.list'>['watches'][number];
type CiReport = OperatorMethodOutput<'ci.status'>['report'];
type CiWatchRunResult = OperatorMethodOutput<'ci.watches.run'>;

function overallTone(overall: string): string {
  if (overall === 'passed') return 'ok';
  if (overall === 'failed') return 'bad';
  if (overall === 'pending') return 'warning';
  return 'neutral';
}

function watchLabel(watch: Pick<CiWatch, 'repo' | 'ref' | 'prNumber'>): string {
  if (watch.prNumber) return `${watch.repo} #${watch.prNumber}`;
  return watch.ref ? `${watch.repo}@${watch.ref}` : watch.repo;
}

/** The honesty-bar detail: EVERY job listed individually, never a rollup alone. */
function CiReportDetail({ report }: { report: CiReport }) {
  return (
    <div className="ci-report">
      <div className="ci-report__header">
        <span className={`badge ${overallTone(report.overall)}`}>{report.overall}</span>
        <span className="ci-report__meta">{report.repo}{report.ref ? `@${report.ref}` : ''}{report.prNumber ? ` #${report.prNumber}` : ''}</span>
        <span className="ci-report__meta">checked {formatRelative(report.checkedAt)}</span>
      </div>
      {report.violations.length > 0 && (
        <ul className="ci-report__violations">
          {report.violations.map((violation, index) => (
            <li key={index}>{violation}</li>
          ))}
        </ul>
      )}
      {report.jobs.length === 0 ? (
        <p className="ci-report__empty" role="note">No jobs reported.</p>
      ) : (
        <ul className="ci-report__jobs">
          {report.jobs.map((job, index) => (
            <li key={`${job.name}-${index}`} className="ci-report__job">
              <span className="ci-report__job-name">{job.name}</span>
              <span className={`badge ${job.conclusion === 'success' ? 'ok' : job.conclusion ? 'bad' : 'neutral'}`}>
                {job.conclusion ?? job.status}
              </span>
              {job.continueOnError && <span className="badge warning">continue-on-error</span>}
              {job.url && <a href={job.url} target="_blank" rel="noreferrer" className="ci-report__job-link">details</a>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateWatchForm({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [repo, setRepo] = useState('');
  const [ref, setRef] = useState('');
  const [prNumber, setPrNumber] = useState('');
  const [deliveryChannel, setDeliveryChannel] = useState('');
  const [triggerFixSession, setTriggerFixSession] = useState(false);

  const create = useMutation({
    mutationFn: () => sdk.operator.ci.watches.create({
      repo: repo.trim(),
      ...(ref.trim() ? { ref: ref.trim() } : {}),
      ...(prNumber.trim() ? { prNumber: Number(prNumber.trim()) } : {}),
      deliveryChannel: deliveryChannel.trim(),
      triggerFixSession,
    }),
    onSuccess: () => {
      setRepo('');
      setRef('');
      setPrNumber('');
      setDeliveryChannel('');
      setTriggerFixSession(false);
      onCreated();
      toast({ title: 'Watch created', tone: 'success' });
    },
    onError: (error: unknown) => {
      toast({ title: 'Failed to create watch', description: formatError(error), tone: 'danger' });
    },
  });

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!repo.trim() || !deliveryChannel.trim()) return;
    create.mutate();
  }

  return (
    <form className="ci-watches-create-form" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="owner/repo"
        value={repo}
        onChange={(e) => setRepo(e.target.value)}
        aria-label="Repository"
        disabled={create.isPending}
        required
      />
      <input
        type="text"
        placeholder="ref (optional)"
        value={ref}
        onChange={(e) => setRef(e.target.value)}
        aria-label="Ref"
        disabled={create.isPending}
      />
      <input
        type="number"
        placeholder="PR # (optional)"
        value={prNumber}
        onChange={(e) => setPrNumber(e.target.value)}
        aria-label="PR number"
        disabled={create.isPending}
      />
      <input
        type="text"
        placeholder="Delivery channel"
        value={deliveryChannel}
        onChange={(e) => setDeliveryChannel(e.target.value)}
        aria-label="Delivery channel"
        disabled={create.isPending}
        required
      />
      <label className="ci-watches-create-form__checkbox">
        <input
          type="checkbox"
          checked={triggerFixSession}
          onChange={(e) => setTriggerFixSession(e.target.checked)}
          disabled={create.isPending}
        />
        Start a fix-session on failure
      </label>
      <button type="submit" disabled={create.isPending || !repo.trim() || !deliveryChannel.trim()}>
        <Plus size={14} /> {create.isPending ? 'Creating…' : 'Create watch'}
      </button>
    </form>
  );
}

export interface CiWatchesViewProps {
  /** Navigate to a session's chat view — used by the "open fix session" affordance. */
  readonly onOpenSession?: (sessionId: string) => void;
}

export function CiWatchesView({ onOpenSession }: CiWatchesViewProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirmSheet();
  const [selectedId, setSelectedId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [runResult, setRunResult] = useState<CiWatchRunResult | null>(null);

  const list = useQuery({
    queryKey: queryKeys.ciWatches,
    queryFn: () => sdk.operator.ci.watches.list(),
  });

  const watches = list.data?.watches ?? [];
  const selected = watches.find((w) => w.id === selectedId) ?? null;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.ciWatches });

  const run = useMutation({
    mutationFn: (watchId: string) => sdk.operator.ci.watches.run(watchId),
    onSuccess: async (result) => {
      setRunResult(result);
      await invalidate();
    },
    onError: (error: unknown) => {
      toast({
        title: isMethodUnavailableError(error) ? 'CI watches unavailable on this daemon' : 'Check failed',
        description: isMethodUnavailableError(error) ? undefined : formatError(error),
        tone: 'danger',
      });
    },
  });

  const remove = useMutation({
    mutationFn: (watchId: string) => sdk.operator.ci.watches.delete(watchId),
    onSuccess: async (result, watchId) => {
      if (!result.deleted) {
        toast({ title: 'Watch already gone', description: 'No watch with that id existed.', tone: 'info' });
      }
      if (selectedId === watchId) {
        setSelectedId('');
        setRunResult(null);
      }
      await invalidate();
    },
    onError: (error: unknown) => {
      toast({ title: 'Failed to delete watch', description: formatError(error), tone: 'danger' });
    },
  });

  async function handleDelete(watch: CiWatch): Promise<void> {
    const ok = await confirm.ask({
      title: 'Delete this CI watch',
      target: watchLabel(watch),
      description: 'This stops notifications for this repo/ref/PR. Existing status history is unaffected.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    remove.mutate(watch.id);
  }

  function selectWatch(watch: CiWatch): void {
    setSelectedId(watch.id);
    setRunResult(null);
  }

  const unavailable = list.isError && isMethodUnavailableError(list.error);

  return (
    <div className={selected ? 'ci-watches-view has-selection' : 'ci-watches-view'}>
      {confirm.element}
      <div className="ci-watches-list-pane">
        <div className="ci-watches-toolbar">
          <button type="button" className="icon-button" title="New watch" onClick={() => setShowCreate((v) => !v)}>
            <Plus size={15} /> New watch
          </button>
          <button className="icon-button" type="button" title="Refresh" onClick={() => void list.refetch()}>
            <RefreshCw size={15} />
          </button>
        </div>

        {showCreate && <CreateWatchForm onCreated={() => { setShowCreate(false); void invalidate(); }} />}

        {list.isPending && (
          <div className="ci-watches-loading">
            <SkeletonBlock variant="text" lines={4} />
          </div>
        )}

        {unavailable && (
          <div className="ci-watches-empty" role="note">CI watches are unavailable on this daemon.</div>
        )}

        {list.isError && !unavailable && (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load CI watches" />
        )}

        {list.isSuccess && watches.length === 0 && (
          <EmptyState
            icon={<GitBranch size={28} />}
            title="No CI watches yet"
            description="Create one to get notified when a repo/ref/PR's checks finish."
            action={{ label: 'New watch', onClick: () => setShowCreate(true) }}
          />
        )}

        {watches.length > 0 && (
          <ul className="ci-watches-rows">
            {watches.map((watch) => (
              <li key={watch.id}>
                <button
                  type="button"
                  className={`ci-watches-row${watch.id === selectedId ? ' active' : ''}`}
                  onClick={() => selectWatch(watch)}
                >
                  <span className="ci-watches-row__title">{watchLabel(watch)}</span>
                  <span className="ci-watches-row__badges">
                    {watch.lastOverall && <span className={`badge ${overallTone(watch.lastOverall)}`}>{watch.lastOverall}</span>}
                    {watch.triggerFixSession && <span className="badge warning">fix-session on failure</span>}
                    <span className="ci-watches-row__meta">→ {watch.deliveryChannel}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-button ci-watches-row__delete"
                  title="Delete this watch"
                  onClick={() => void handleDelete(watch)}
                  disabled={remove.isPending}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="ci-watches-detail-pane">
        {selected ? (
          <div className="ci-watch-detail">
            <button type="button" className="ci-watches-detail__back" onClick={() => { setSelectedId(''); setRunResult(null); }}>
              <ChevronLeft size={16} aria-hidden="true" />
              Back to watches
            </button>
            <header className="ci-watch-detail__header">
              <h2>{watchLabel(selected)}</h2>
              <div className="ci-watch-detail__meta">
                <small>Delivers to {selected.deliveryChannel}</small>
                <small>· created {formatRelative(selected.createdAt)}</small>
                {selected.triggerFixSession && <small>· starts a fix-session on failure</small>}
              </div>
              <button
                type="button"
                className="ci-watch-detail__run"
                onClick={() => run.mutate(selected.id)}
                disabled={run.isPending}
              >
                <Play size={14} /> {run.isPending ? 'Checking…' : 'Check now'}
              </button>
            </header>
            {runResult && (
              <div className="ci-watch-detail__result">
                <CiReportDetail report={runResult.report} />
                <p className="ci-report__notify">
                  {runResult.notified ? 'A notification was sent.' : 'No notification was sent (no state change, or quiet).'}
                  {/* fixSessionId / fixSessionError are mutually exclusive on the
                      wire (SDK bb4b9c30): a triggered spawn either produced a REAL
                      attachable session, or an honest failure — never a dead id. */}
                  {runResult.fixSessionTriggered && runResult.fixSessionId && ' A fix-session was started.'}
                  {runResult.fixSessionTriggered && runResult.fixSessionError
                    && ` The fix-session could not start — ${runResult.fixSessionError}`}
                </p>
                {/* The started fix-session's real session id rides the verb result;
                    offer to open it in the session view so the operator can watch
                    (or steer) the fix as it works. No button on the error path. */}
                {runResult.fixSessionTriggered && runResult.fixSessionId && onOpenSession && (
                  <button
                    type="button"
                    className="ci-watch-detail__open-session"
                    onClick={() => onOpenSession(runResult.fixSessionId!)}
                  >
                    <ExternalLink size={14} aria-hidden="true" /> Open fix session
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="ci-watches-detail-empty">Select a watch to check its status, or look up any repo below.</div>
        )}
        {!selected && <AdHocStatusLookup />}
      </div>
    </div>
  );
}

/** Ad hoc ci.status lookup — check any repo/ref/PR without creating a standing watch. */
function AdHocStatusLookup() {
  const { toast } = useToast();
  const [repo, setRepo] = useState('');
  const [ref, setRef] = useState('');
  const [prNumber, setPrNumber] = useState('');
  const [report, setReport] = useState<CiReport | null>(null);

  const check = useMutation({
    mutationFn: () => sdk.operator.ci.status({
      repo: repo.trim(),
      ...(ref.trim() ? { ref: ref.trim() } : {}),
      ...(prNumber.trim() ? { prNumber: Number(prNumber.trim()) } : {}),
    }),
    onSuccess: (result) => setReport(result.report),
    onError: (error: unknown) => {
      toast({
        title: isMethodUnavailableError(error) ? 'CI status unavailable on this daemon' : 'Check failed',
        description: isMethodUnavailableError(error) ? undefined : formatError(error),
        tone: 'danger',
      });
    },
  });

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!repo.trim()) return;
    check.mutate();
  }

  return (
    <div className="ci-adhoc-lookup">
      <h3>Check a repo</h3>
      <form className="ci-watches-create-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="owner/repo"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          aria-label="Repository"
          disabled={check.isPending}
          required
        />
        <input
          type="text"
          placeholder="ref (optional)"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          aria-label="Ref"
          disabled={check.isPending}
        />
        <input
          type="number"
          placeholder="PR # (optional)"
          value={prNumber}
          onChange={(e) => setPrNumber(e.target.value)}
          aria-label="PR number"
          disabled={check.isPending}
        />
        <button type="submit" disabled={check.isPending || !repo.trim()}>
          {check.isPending ? 'Checking…' : 'Check status'}
        </button>
      </form>
      {report && <CiReportDetail report={report} />}
    </div>
  );
}
