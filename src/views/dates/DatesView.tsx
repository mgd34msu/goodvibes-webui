/**
 * DatesView — the occasions/plans dates panel, over the daemon's sixteen
 * `occasions.*` verbs (docs/occasions.md). Follows the same shape MailView and
 * CalendarView established: this surface renders what the read verbs return and
 * calls the write verbs for the actions they support; nothing here computes a
 * proximity word, a lead-time adjustment, a nudge cadence, or a nudge date — every
 * one of those stays server-side (docs/occasions.md §7's governing line: a consumer
 * that computed anything beyond calling these verbs and rendering the answers would
 * be a second implementation of a rule that lives in the daemon).
 *
 * PULL-ONLY, NOT A NUDGE CHANNEL: the daemon pushes occasion/plan nudges to
 * Telegram and the agent, never the TUI (docs/occasions.md §4.2 — "that's more of a
 * 'get work done' kind of interface", a ruling that generalises beyond occasions).
 * This webui panel is the same kind of interface, so it never originates a push —
 * it only reads what's outstanding (`occasions.pending`) and lets the operator act
 * on it (answer / resolve a conflict / continue an interview), which is a pull, not
 * a nudge.
 *
 * DATES: occasions.list is the one read verb that returns real dates
 * (`nextOccurrence`, `daysUntil`) — docs/occasions.md §4.3 draws this exactly:
 * a nudge never carries the date, but "occasions.list does return the dates,
 * because that is him asking his own system over an authenticated verb — the
 * explicit ask that unlocks a closed-tier read." occasions.pending's nudge
 * subjects carry only `proximity` (a word), never a date — this view renders
 * that distinction verbatim rather than flattening both to "the date".
 *
 * HONESTY: occasions.* is a brand-new verb family (this SDK release) that may not
 * be wired on every daemon build yet, same situation calendar.* and email.* were in
 * when they first landed — every read here treats a 404/501 as the honest
 * not-available state (EmptyState with a pointer), never a fabricated empty list.
 * The e2e mock daemon answers an unrecognised invoke id with `{}`, so every render
 * path below optional-chains into query results rather than assuming a shape.
 */
import { useState, type SyntheticEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Cake,
  Gift,
  Plane,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { sdk } from '../../lib/goodvibes';
import type { OperatorMethodInput, OperatorMethodOutput } from '../../lib/goodvibes';
import { WEBUI_PROFILE_AUTHORITY, WEBUI_PROFILE_SURFACE } from '../../lib/owner-profile';
import { queryKeys } from '../../lib/queries';
import { formatError, isMethodNotInvokableError, isMethodUnavailableError } from '../../lib/errors';
import { formatRelative } from '../../lib/object';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';
import ErrorBoundary from '../../components/feedback/ErrorBoundary';
import { usePeek } from '../../components/peek/PeekPanel';
import { useConfirmSheet } from '../../components/confirm/useConfirmSheet';
import { useToast } from '../../lib/toast';
import { DatesGiftHistoryPeekBody } from './DatesGiftHistoryPeek';
import '../../styles/components/dates.css';

/** The utterance a manual dates-panel capture carries — same role
 * owner-profile.ts's SETTINGS_EDIT_UTTERANCE plays for a settings edit: a plain
 * statement of where the fact came from, honest for THIS surface only (the operator
 * typing directly into the panel), never hardcoded by a caller that could be
 * relaying someone else's words. */
const DATES_PANEL_UTTERANCE = '(added in the dates panel)';

type OccasionsListResult = OperatorMethodOutput<'occasions.list'>;
type OccasionListEntry = OccasionsListResult['occasions'][number];
type OccasionConflict = OccasionsListResult['conflicts'][number];
type UnparsedLine = OccasionsListResult['unparsed'][number];
type PlansListResult = OperatorMethodOutput<'occasions.plans.list'>;
type PlanEntry = PlansListResult['plans'][number];
type PendingResult = OperatorMethodOutput<'occasions.pending'>;
type PendingConflict = PendingResult['conflicts'][number];
type InterviewState = NonNullable<PendingResult['interviews']>[number];
type OccasionKind = 'gift-giving' | 'neither' | 'remember-only';

function notAvailableNote(error: unknown): { title: string; description: string } | null {
  if (isMethodUnavailableError(error) || isMethodNotInvokableError(error)) {
    return {
      title: 'Dates isn’t available on this daemon yet',
      description: 'This daemon build has no occasions handler wired up. Upgrade the daemon to see occasions and plans here.',
    };
  }
  return null;
}

function kindLabel(kind: OccasionKind): string {
  if (kind === 'gift-giving') return 'Gift-giving';
  if (kind === 'remember-only') return 'Remember only';
  return 'Neither';
}

function kindTone(kind: OccasionKind): string {
  if (kind === 'gift-giving') return 'info';
  return 'neutral';
}

function answerLabel(answer: OccasionListEntry['answer']): string {
  if (answer === 'yes') return 'Yes';
  if (answer === 'no') return 'No';
  if (answer === 'later') return 'Later';
  return 'Not yet answered';
}

function answerTone(answer: OccasionListEntry['answer']): string {
  if (answer === 'yes') return 'ok';
  if (answer === 'no') return 'bad';
  if (answer === 'later') return 'warning';
  return 'neutral';
}

function proximityTone(proximity: 'approaching' | 'imminent' | 'soon'): string {
  if (proximity === 'imminent') return 'bad';
  if (proximity === 'soon') return 'warning';
  return 'neutral';
}

/** `daysUntil` is the one place this view renders a real date-derived number — the
 * verb it comes from (occasions.list) is the explicit-ask read docs/occasions.md
 * §4.3 carves out, not the nudge path that never carries one. */
function daysUntilLabel(daysUntil: number | null): string {
  if (daysUntil === null) return '—';
  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  if (daysUntil < 0) return `${String(Math.abs(daysUntil))} days ago`;
  return `in ${String(daysUntil)} days`;
}

function formatDateOnly(iso: string | null): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

/** Shared between occasions.list.unparsed and occasions.plans.list.unparsed — both
 * carry the exact same {lineIndex, text, reason} shape (the profile grammar never
 * rewrites a line it cannot parse; it reports why instead — docs/occasions.md §3.1). */
function UnparsedLinesNote({ items }: { items: readonly UnparsedLine[] }) {
  if (items.length === 0) return null;
  return (
    <div className="dates-note dates-note--unparsed" role="status" data-testid="dates-unparsed">
      <h3>
        {items.length === 1 ? '1 line could not be read' : `${String(items.length)} lines could not be read`}
      </h3>
      <ul>
        {items.map((item) => (
          <li key={item.lineIndex}>
            <code>{item.text}</code> — {item.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DatesView() {
  const queryClient = useQueryClient();
  const peek = usePeek();
  const { toast } = useToast();
  const confirm = useConfirmSheet();

  const [sweepResult, setSweepResult] = useState<OperatorMethodOutput<'occasions.sweep'> | null>(null);

  const [occasionTitle, setOccasionTitle] = useState('');
  const [occasionDate, setOccasionDate] = useState('');
  const [occasionPerson, setOccasionPerson] = useState('');
  const [occasionKind, setOccasionKind] = useState<OccasionKind | ''>('');
  const [occasionRecurrence, setOccasionRecurrence] = useState<'annual' | 'once'>('annual');
  const [occasionLeadDays, setOccasionLeadDays] = useState('');
  const [occasionProposal, setOccasionProposal] = useState<OperatorMethodOutput<'occasions.propose'> | null>(null);

  const [planTitle, setPlanTitle] = useState('');
  const [planFrom, setPlanFrom] = useState('');
  const [planTo, setPlanTo] = useState('');
  const [planAway, setPlanAway] = useState(false);
  const [planDestination, setPlanDestination] = useState('');
  const [planProposal, setPlanProposal] = useState<OperatorMethodOutput<'occasions.plans.propose'> | null>(null);

  const [interviewDrafts, setInterviewDrafts] = useState<Record<string, string>>({});
  const [landedOnDrafts, setLandedOnDrafts] = useState<Record<string, string>>({});

  const list = useQuery({ queryKey: queryKeys.occasionsList, queryFn: () => sdk.operator.occasions.list() });
  const plans = useQuery({ queryKey: queryKeys.occasionsPlansList, queryFn: () => sdk.operator.occasions.plans.list() });
  const pending = useQuery({ queryKey: queryKeys.occasionsPending, queryFn: () => sdk.operator.occasions.pending() });
  const state = useQuery({ queryKey: queryKeys.occasionsState, queryFn: () => sdk.operator.occasions.state() });

  function invalidateAll(): Promise<void> {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.occasionsList }),
      queryClient.invalidateQueries({ queryKey: queryKeys.occasionsPlansList }),
      queryClient.invalidateQueries({ queryKey: queryKeys.occasionsPending }),
      queryClient.invalidateQueries({ queryKey: queryKeys.occasionsState }),
    ]).then(() => undefined);
  }

  const answerOccasion = useMutation({
    mutationFn: (input: OperatorMethodInput<'occasions.answer'>) => sdk.operator.occasions.answer(input),
    onSuccess: async (result) => {
      await invalidateAll();
      if (!result.ok) {
        toast({ title: 'Answer not recorded', description: result.reason ?? undefined, tone: 'danger' });
        return;
      }
      toast({
        title: 'Answer recorded',
        description: result.interview ? 'A short gift interview opened — continue it in Open items below.' : undefined,
        tone: 'success',
      });
    },
    onError: (error: unknown) => toast({ title: 'Failed to record answer', description: formatError(error), tone: 'danger' }),
  });

  const removeOccasion = useMutation({
    mutationFn: (occasionId: string) =>
      sdk.operator.occasions.remove({ occasionId, confirmed: true, authority: WEBUI_PROFILE_AUTHORITY }),
    onSuccess: async (result) => {
      await invalidateAll();
      toast({
        title: result.ok ? 'Removed' : 'Not removed',
        description: result.ok ? result.disclosure : (result.reason ?? undefined),
        tone: result.ok ? 'success' : 'danger',
      });
    },
    onError: (error: unknown) => toast({ title: 'Removal failed', description: formatError(error), tone: 'danger' }),
  });

  const resolveConflict = useMutation({
    mutationFn: (occasionId: string) => sdk.operator.occasions.conflict.resolve(occasionId),
    onSuccess: async () => {
      await invalidateAll();
      toast({ title: 'Conflict resolved', tone: 'success' });
    },
    onError: (error: unknown) => toast({ title: 'Failed to resolve conflict', description: formatError(error), tone: 'danger' }),
  });

  const answerInterview = useMutation({
    mutationFn: (input: OperatorMethodInput<'occasions.interview.answer'>) => sdk.operator.occasions.interview.answer(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.occasionsPending });
    },
    onError: (error: unknown) => toast({ title: 'Failed to record interview answer', description: formatError(error), tone: 'danger' }),
  });

  const recordInterview = useMutation({
    mutationFn: (input: OperatorMethodInput<'occasions.interview.record'>) => sdk.operator.occasions.interview.record(input),
    onSuccess: async (result) => {
      await invalidateAll();
      if (result.interview) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.occasionsGifts(result.interview.occasionId) });
      }
      toast({ title: 'Recorded what you landed on', tone: 'success' });
    },
    onError: (error: unknown) => toast({ title: 'Failed to close the interview', description: formatError(error), tone: 'danger' }),
  });

  const runSweep = useMutation({
    mutationFn: () => sdk.operator.occasions.sweep(),
    onSuccess: async (result) => {
      setSweepResult(result);
      await invalidateAll();
    },
    onError: (error: unknown) => toast({ title: 'Sweep failed', description: formatError(error), tone: 'danger' }),
  });

  const proposeOccasion = useMutation({
    mutationFn: () =>
      sdk.operator.occasions.propose({
        title: occasionTitle.trim(),
        date: occasionDate,
        ...(occasionKind ? { kind: occasionKind } : {}),
        ...(occasionPerson.trim() ? { person: occasionPerson.trim() } : {}),
        recurrence: occasionRecurrence,
        ...(occasionLeadDays.trim() ? { leadDays: Number(occasionLeadDays) } : {}),
      }),
    onSuccess: (result) => setOccasionProposal(result),
    onError: (error: unknown) => toast({ title: 'Preview failed', description: formatError(error), tone: 'danger' }),
  });

  const confirmOccasion = useMutation({
    mutationFn: () =>
      sdk.operator.occasions.confirm({
        title: occasionTitle.trim(),
        date: occasionDate,
        kind: occasionKind as OccasionKind,
        ...(occasionPerson.trim() ? { person: occasionPerson.trim() } : {}),
        recurrence: occasionRecurrence,
        ...(occasionLeadDays.trim() ? { leadDays: Number(occasionLeadDays) } : {}),
        surface: WEBUI_PROFILE_SURFACE,
        said: DATES_PANEL_UTTERANCE,
        authority: WEBUI_PROFILE_AUTHORITY,
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.occasionsList });
      if (!result.ok) {
        toast({ title: 'Not saved', description: result.reason ?? undefined, tone: 'danger' });
        return;
      }
      setOccasionTitle('');
      setOccasionDate('');
      setOccasionPerson('');
      setOccasionKind('');
      setOccasionLeadDays('');
      setOccasionProposal(null);
      toast({ title: 'Occasion added', description: result.disclosure, tone: 'success' });
    },
    onError: (error: unknown) => toast({ title: 'Save failed', description: formatError(error), tone: 'danger' }),
  });

  const proposePlan = useMutation({
    mutationFn: () =>
      sdk.operator.occasions.plans.propose({
        title: planTitle.trim(),
        from: planFrom,
        to: planTo,
        away: planAway,
        ...(planDestination.trim() ? { destination: planDestination.trim() } : {}),
      }),
    onSuccess: (result) => setPlanProposal(result),
    onError: (error: unknown) => toast({ title: 'Preview failed', description: formatError(error), tone: 'danger' }),
  });

  const confirmPlan = useMutation({
    mutationFn: () =>
      sdk.operator.occasions.plans.confirm({
        title: planTitle.trim(),
        from: planFrom,
        to: planTo,
        away: planAway,
        ...(planDestination.trim() ? { destination: planDestination.trim() } : {}),
        surface: WEBUI_PROFILE_SURFACE,
        said: DATES_PANEL_UTTERANCE,
        authority: WEBUI_PROFILE_AUTHORITY,
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.occasionsPlansList });
      if (!result.ok) {
        toast({ title: 'Not saved', description: result.reason ?? undefined, tone: 'danger' });
        return;
      }
      setPlanTitle('');
      setPlanFrom('');
      setPlanTo('');
      setPlanAway(false);
      setPlanDestination('');
      setPlanProposal(null);
      toast({ title: 'Plan added', description: result.disclosure, tone: 'success' });
    },
    onError: (error: unknown) => toast({ title: 'Save failed', description: formatError(error), tone: 'danger' }),
  });

  function openGiftHistory(occasionId: string, title: string): void {
    peek.open({ title: `Gift history — ${title}`, content: <DatesGiftHistoryPeekBody occasionId={occasionId} /> });
  }

  function submitOccasionProposal(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (occasionTitle.trim() && occasionDate) proposeOccasion.mutate();
  }

  function submitPlanProposal(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (planTitle.trim() && planFrom && planTo) proposePlan.mutate();
  }

  const listNote = list.error ? notAvailableNote(list.error) : null;
  const plansNote = plans.error ? notAvailableNote(plans.error) : null;
  const pendingNote = pending.error ? notAvailableNote(pending.error) : null;
  const stateNote = state.error ? notAvailableNote(state.error) : null;

  const occasionEntries: readonly OccasionListEntry[] = list.data?.occasions ?? [];
  const occasionConflicts: readonly OccasionConflict[] = list.data?.conflicts ?? [];
  const planEntries: readonly PlanEntry[] = plans.data?.plans ?? [];
  const pendingConflicts: readonly PendingConflict[] = pending.data?.conflicts ?? [];
  const interviews: readonly InterviewState[] = pending.data?.interviews ?? [];

  return (
    <ErrorBoundary fallback={(err, reset) => <ErrorState error={err} onRetry={reset} title="Dates view failed" />}>
      <div className="stack">
        {/* Upcoming occasions (occasions.list) — the one read verb that returns real
            dates, per docs/occasions.md §4.3 (see file header). */}
        <section className="panel">
          <div className="panel-title">
            <h2>Upcoming</h2>
            <Cake size={18} aria-hidden="true" />
            <button type="button" className="secondary-button" onClick={() => void list.refetch()} aria-label="Refresh upcoming occasions">
              <RefreshCw size={14} aria-hidden="true" />
            </button>
          </div>

          {list.isPending ? (
            <SkeletonBlock variant="text" lines={4} />
          ) : listNote ? (
            <EmptyState icon={<Cake size={24} aria-hidden="true" />} title={listNote.title} description={listNote.description} />
          ) : list.error ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Occasions failed to load" />
          ) : occasionEntries.length === 0 ? (
            <EmptyState icon={<Cake size={24} aria-hidden="true" />} title="No occasions yet" description="Add one below, or tell the agent about a birthday or anniversary." />
          ) : (
            <ul className="dates-occasion-list" data-testid="dates-occasion-list">
              {occasionEntries.map((entry) => (
                <li key={entry.occasion.id} className="dates-occasion-row">
                  <div className="dates-occasion-row__top">
                    <span className="dates-occasion-row__title">{entry.occasion.title}</span>
                    {entry.occasion.person ? <span className="dates-occasion-row__person">{entry.occasion.person}</span> : null}
                    <span className={`badge ${kindTone(entry.occasion.kind)}`}>{kindLabel(entry.occasion.kind)}</span>
                    <span className={`badge ${answerTone(entry.answer)}`}>{answerLabel(entry.answer)}</span>
                    {entry.mirrored ? <span className="badge info">Mirrored to calendar</span> : null}
                  </div>
                  <div className="dates-occasion-row__meta">
                    <span>{formatDateOnly(entry.nextOccurrence)}</span>
                    <span>·</span>
                    <span>{daysUntilLabel(entry.daysUntil)}</span>
                    {entry.inLeadWindow ? <span className="badge warning">In lead window</span> : null}
                  </div>
                  <div className="dates-occasion-row__actions">
                    <button type="button" className="secondary-button" disabled={answerOccasion.isPending}
                      onClick={() => answerOccasion.mutate({ occasionId: entry.occasion.id, answer: 'yes' })}>
                      Yes
                    </button>
                    <button type="button" className="secondary-button" disabled={answerOccasion.isPending}
                      onClick={() => answerOccasion.mutate({ occasionId: entry.occasion.id, answer: 'no' })}>
                      No
                    </button>
                    <button type="button" className="secondary-button" disabled={answerOccasion.isPending}
                      onClick={() => answerOccasion.mutate({ occasionId: entry.occasion.id, answer: 'later' })}>
                      Later
                    </button>
                    <button type="button" className="secondary-button" onClick={() => openGiftHistory(entry.occasion.id, entry.occasion.title)}>
                      <Gift size={13} aria-hidden="true" /> Gift history
                    </button>
                    <button
                      type="button"
                      className="secondary-button dates-remove-button"
                      disabled={removeOccasion.isPending}
                      onClick={async () => {
                        const ok = await confirm.ask({
                          title: 'Remove this occasion?',
                          target: entry.occasion.title,
                          description: 'Removes the line from your profile and every acknowledgement/gift record against it. This takes one confirmation and cannot be undone here.',
                          confirmLabel: 'Remove',
                          tone: 'danger',
                        });
                        if (ok) removeOccasion.mutate(entry.occasion.id);
                      }}
                    >
                      <Trash2 size={13} aria-hidden="true" /> Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!list.isPending && !listNote ? <UnparsedLinesNote items={list.data?.unparsed ?? []} /> : null}

          {occasionConflicts.length > 0 ? (
            <div className="dates-note dates-note--conflict" role="alert" data-testid="dates-conflicts">
              <h3><AlertTriangle size={14} aria-hidden="true" /> Conflicting dates</h3>
              <ul>
                {occasionConflicts.map((conflict) => (
                  <li key={conflict.occasionId}>
                    <span>{conflict.title}: {conflict.dates.join(' vs. ')}</span>
                    <button type="button" className="secondary-button" disabled={resolveConflict.isPending} onClick={() => resolveConflict.mutate(conflict.occasionId)}>
                      Resolved
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <form className="form-grid dates-add-form" onSubmit={submitOccasionProposal}>
            <h3>Add an occasion</h3>
            <label>
              Title
              <input value={occasionTitle} onChange={(e) => setOccasionTitle(e.target.value)} aria-label="Occasion title" required />
            </label>
            <div className="form-split">
              <label>
                Date
                <input type="date" value={occasionDate} onChange={(e) => setOccasionDate(e.target.value)} aria-label="Occasion date" required />
              </label>
              <label>
                Recurrence
                <select value={occasionRecurrence} onChange={(e) => setOccasionRecurrence(e.target.value as 'annual' | 'once')} aria-label="Recurrence">
                  <option value="annual">Annual</option>
                  <option value="once">One-time</option>
                </select>
              </label>
            </div>
            <div className="form-split">
              <label>
                Person
                <input value={occasionPerson} onChange={(e) => setOccasionPerson(e.target.value)} aria-label="Person" />
              </label>
              <label>
                Lead days (optional)
                <input type="number" min={0} value={occasionLeadDays} onChange={(e) => setOccasionLeadDays(e.target.value)} aria-label="Lead days override" />
              </label>
            </div>
            <label>
              Kind
              <select value={occasionKind} onChange={(e) => setOccasionKind(e.target.value as OccasionKind | '')} aria-label="Occasion kind">
                <option value="">Choose before confirming…</option>
                <option value="gift-giving">Gift-giving</option>
                <option value="remember-only">Remember only</option>
                <option value="neither">Neither</option>
              </select>
            </label>
            <button className="secondary-button" type="submit" disabled={proposeOccasion.isPending || !occasionTitle.trim() || !occasionDate}>
              {proposeOccasion.isPending ? 'Previewing…' : 'Preview'}
            </button>
            {occasionProposal ? (
              occasionProposal.ok ? (
                <div className="dates-proposal" role="status">
                  <p>{occasionProposal.confirmation}</p>
                  {occasionProposal.conflictsWith.length > 0 ? <p className="dates-proposal__warning">Conflicts with: {occasionProposal.conflictsWith.join(', ')}</p> : null}
                  {occasionProposal.needsKind && !occasionKind ? <p className="dates-proposal__warning">Pick a kind above before confirming.</p> : null}
                  <button
                    type="button"
                    className="primary-button"
                    disabled={confirmOccasion.isPending || !occasionKind}
                    onClick={() => confirmOccasion.mutate()}
                  >
                    {confirmOccasion.isPending ? 'Saving…' : 'Confirm'}
                  </button>
                </div>
              ) : (
                <p className="dates-proposal__warning" role="alert">{occasionProposal.reason ?? 'Could not preview this occasion.'}</p>
              )
            ) : null}
          </form>
        </section>

        {/* Plans — dated ranges with attributes, ambient rather than prompting
            (docs/occasions.md §1). */}
        <section className="panel">
          <div className="panel-title">
            <h2>Plans</h2>
            <Plane size={18} aria-hidden="true" />
            <button type="button" className="secondary-button" onClick={() => void plans.refetch()} aria-label="Refresh plans">
              <RefreshCw size={14} aria-hidden="true" />
            </button>
          </div>

          {plans.isPending ? (
            <SkeletonBlock variant="text" lines={3} />
          ) : plansNote ? (
            <EmptyState icon={<Plane size={24} aria-hidden="true" />} title={plansNote.title} description={plansNote.description} />
          ) : plans.error ? (
            <ErrorState error={plans.error} onRetry={() => void plans.refetch()} title="Plans failed to load" />
          ) : (
            <>
              {plans.data?.awayNow ? (
                <div className="dates-note dates-note--away" role="status">
                  <Plane size={14} aria-hidden="true" /> Away now: {plans.data.awayNow.title}
                  {plans.data.awayNow.destination ? ` — ${plans.data.awayNow.destination}` : ''} (through {formatDateOnly(plans.data.awayNow.to)})
                </div>
              ) : null}
              {planEntries.length === 0 ? (
                <EmptyState icon={<Plane size={24} aria-hidden="true" />} title="No plans yet" description="Add one below, or tell the agent about an upcoming trip." />
              ) : (
                <ul className="dates-plan-list" data-testid="dates-plan-list">
                  {planEntries.map((planItem) => (
                    <li key={planItem.id} className="dates-plan-row">
                      <div className="dates-plan-row__top">
                        <span className="dates-plan-row__title">{planItem.title}</span>
                        {planItem.away ? <span className="badge warning">Away</span> : null}
                      </div>
                      <div className="dates-plan-row__meta">
                        <span>{formatDateOnly(planItem.from)} – {formatDateOnly(planItem.to)}</span>
                        {planItem.destination ? <span>{planItem.destination}</span> : null}
                      </div>
                      <div className="dates-plan-row__actions">
                        <button
                          type="button"
                          className="secondary-button dates-remove-button"
                          disabled={removeOccasion.isPending}
                          onClick={async () => {
                            const ok = await confirm.ask({
                              title: 'Remove this plan?',
                              target: planItem.title,
                              description: 'Removes the line from your profile and every record against it. This takes one confirmation and cannot be undone here.',
                              confirmLabel: 'Remove',
                              tone: 'danger',
                            });
                            if (ok) removeOccasion.mutate(planItem.id);
                          }}
                        >
                          <Trash2 size={13} aria-hidden="true" /> Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <UnparsedLinesNote items={plans.data?.unparsed ?? []} />
            </>
          )}

          <form className="form-grid dates-add-form" onSubmit={submitPlanProposal}>
            <h3>Add a plan</h3>
            <label>
              Title
              <input value={planTitle} onChange={(e) => setPlanTitle(e.target.value)} aria-label="Plan title" required />
            </label>
            <div className="form-split">
              <label>
                From
                <input type="date" value={planFrom} onChange={(e) => setPlanFrom(e.target.value)} aria-label="Plan start date" required />
              </label>
              <label>
                To
                <input type="date" value={planTo} onChange={(e) => setPlanTo(e.target.value)} aria-label="Plan end date" required />
              </label>
            </div>
            <label>
              Destination
              <input value={planDestination} onChange={(e) => setPlanDestination(e.target.value)} aria-label="Destination" />
            </label>
            <label className="dates-add-form__checkbox">
              <input type="checkbox" checked={planAway} onChange={(e) => setPlanAway(e.target.checked)} />
              I'll be away during this plan
            </label>
            <button className="secondary-button" type="submit" disabled={proposePlan.isPending || !planTitle.trim() || !planFrom || !planTo}>
              {proposePlan.isPending ? 'Previewing…' : 'Preview'}
            </button>
            {planProposal ? (
              planProposal.ok ? (
                <div className="dates-proposal" role="status">
                  <p>{planProposal.confirmation}</p>
                  {planProposal.conflictsWith.length > 0 ? <p className="dates-proposal__warning">Conflicts with: {planProposal.conflictsWith.join(', ')}</p> : null}
                  <button type="button" className="primary-button" disabled={confirmPlan.isPending} onClick={() => confirmPlan.mutate()}>
                    {confirmPlan.isPending ? 'Saving…' : 'Confirm'}
                  </button>
                </div>
              ) : (
                <p className="dates-proposal__warning" role="alert">{planProposal.reason ?? 'Could not preview this plan.'}</p>
              )
            ) : null}
          </form>
        </section>

        {/* Open items (occasions.pending) — "nothing unresolved is ever dropped"
            (docs/occasions.md §2): the outstanding nudge, conflicts, and in-progress
            interviews, all delivered to nobody until this panel reads them. */}
        <section className="panel">
          <div className="panel-title">
            <h2>Open items</h2>
            <Sparkles size={18} aria-hidden="true" />
            <button type="button" className="secondary-button" onClick={() => void pending.refetch()} aria-label="Refresh open items">
              <RefreshCw size={14} aria-hidden="true" />
            </button>
          </div>

          {pending.isPending ? (
            <SkeletonBlock variant="text" lines={3} />
          ) : pendingNote ? (
            <EmptyState icon={<Sparkles size={24} aria-hidden="true" />} title={pendingNote.title} description={pendingNote.description} />
          ) : pending.error ? (
            <ErrorState error={pending.error} onRetry={() => void pending.refetch()} title="Open items failed to load" />
          ) : !pending.data?.nudge && pendingConflicts.length === 0 && interviews.length === 0 ? (
            <EmptyState icon={<Sparkles size={24} aria-hidden="true" />} title="Nothing outstanding" description="No unanswered nudge, no unresolved conflict, and no interview in progress." />
          ) : (
            <div className="dates-open-items">
              {pending.data?.nudge ? (
                <div className="dates-nudge" data-testid="dates-nudge">
                  <p className="dates-nudge__message">{pending.data.nudge.message}</p>
                  <ul className="dates-nudge__subjects">
                    {pending.data.nudge.subjects.map((subject) => (
                      <li key={subject.occasionId} className="dates-nudge__subject">
                        <span className="dates-occasion-row__title">{subject.title}</span>
                        {subject.person ? <span className="dates-occasion-row__person">{subject.person}</span> : null}
                        <span className={`badge ${kindTone(subject.kind)}`}>{kindLabel(subject.kind)}</span>
                        <span className={`badge ${proximityTone(subject.proximity)}`}>{subject.proximity}</span>
                        {pending.data?.nudge?.answerable ? (
                          <span className="dates-nudge__subject-actions">
                            <button type="button" className="secondary-button" disabled={answerOccasion.isPending}
                              onClick={() => answerOccasion.mutate({ occasionId: subject.occasionId, answer: 'yes' })}>
                              Yes
                            </button>
                            <button type="button" className="secondary-button" disabled={answerOccasion.isPending}
                              onClick={() => answerOccasion.mutate({ occasionId: subject.occasionId, answer: 'no' })}>
                              No
                            </button>
                            <button type="button" className="secondary-button" disabled={answerOccasion.isPending}
                              onClick={() => answerOccasion.mutate({ occasionId: subject.occasionId, answer: 'later' })}>
                              Later
                            </button>
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {pendingConflicts.length > 0 ? (
                <div className="dates-note dates-note--conflict" role="alert">
                  <h3><AlertTriangle size={14} aria-hidden="true" /> Conflicts</h3>
                  <ul>
                    {pendingConflicts.map((conflict) => (
                      <li key={conflict.occasionId}>
                        <span>{conflict.message}</span>
                        <button type="button" className="secondary-button" disabled={resolveConflict.isPending} onClick={() => resolveConflict.mutate(conflict.occasionId)}>
                          Resolved
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {interviews.length > 0 ? (
                <ul className="dates-interview-list" data-testid="dates-interview-list">
                  {interviews.map((interview) => (
                    <li key={interview.interviewId} className="dates-interview">
                      <p className="dates-interview__title">Gift interview — {interview.occasionId}</p>
                      {interview.complete ? (
                        <div className="dates-interview__record">
                          <label>
                            What did you land on?
                            <input
                              value={landedOnDrafts[interview.interviewId] ?? ''}
                              onChange={(e) => setLandedOnDrafts((current) => ({ ...current, [interview.interviewId]: e.target.value }))}
                              aria-label={`What you landed on for interview ${interview.interviewId}`}
                            />
                          </label>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={recordInterview.isPending || !(landedOnDrafts[interview.interviewId] ?? '').trim()}
                            onClick={() => recordInterview.mutate({ interviewId: interview.interviewId, landedOn: (landedOnDrafts[interview.interviewId] ?? '').trim() })}
                          >
                            Record
                          </button>
                        </div>
                      ) : interview.nextStep ? (
                        (() => {
                          const stepId = interview.nextStep.id;
                          return (
                            <div className="dates-interview__step">
                              <p>{interview.nextStep.prompt}</p>
                              <input
                                value={interviewDrafts[stepId] ?? ''}
                                onChange={(e) => setInterviewDrafts((current) => ({ ...current, [stepId]: e.target.value }))}
                                aria-label={interview.nextStep.prompt}
                              />
                              <button
                                type="button"
                                className="secondary-button"
                                disabled={answerInterview.isPending || !(interviewDrafts[stepId] ?? '').trim()}
                                onClick={() => answerInterview.mutate({ interviewId: interview.interviewId, stepId, text: (interviewDrafts[stepId] ?? '').trim() })}
                              >
                                Answer
                              </button>
                            </div>
                          );
                        })()
                      ) : (
                        <p className="dates-interview__done">Waiting on the next step.</p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </section>

        {/* State (occasions.state) — the machine-owned store's own disclosure: counts
            and reasons only, never the underlying acknowledgement/gift content
            (docs/occasions.md §3.2). */}
        <section className="panel">
          <div className="panel-title">
            <h2>State</h2>
            <button type="button" className="secondary-button" onClick={() => void state.refetch()} aria-label="Refresh state">
              <RefreshCw size={14} aria-hidden="true" />
            </button>
          </div>

          {state.isPending ? (
            <SkeletonBlock variant="text" lines={3} />
          ) : stateNote ? (
            <EmptyState title={stateNote.title} description={stateNote.description} />
          ) : state.error ? (
            <ErrorState error={state.error} onRetry={() => void state.refetch()} title="State failed to load" />
          ) : (
            <div className="dates-state" data-testid="dates-state">
              {state.data?.corruption ? (
                <div className="dates-note dates-note--conflict" role="alert">
                  <AlertTriangle size={14} aria-hidden="true" /> {state.data.corruption}
                </div>
              ) : null}
              <dl className="dates-state__counts">
                <dt>Acknowledgements</dt>
                <dd>{state.data?.acknowledgements ?? 0}</dd>
                <dt>Gift records</dt>
                <dd>{state.data?.giftRecords ?? 0}</dd>
                <dt>Open items</dt>
                <dd>{state.data?.openItems ?? 0}</dd>
                <dt>Interviews</dt>
                <dd>{state.data?.interviews ?? 0}</dd>
                <dt>Calendar mirrors</dt>
                <dd>{state.data?.mirrors ?? 0}</dd>
              </dl>
              {state.data?.lastSweep ? (
                <p className="dates-state__last-sweep">
                  Last swept {formatRelative(state.data.lastSweep.sweptAt)} — expired {state.data.lastSweep.expiredAcknowledgements} acknowledgement(s),
                  reaped {state.data.lastSweep.orphanedRecords} orphaned record(s), expired {state.data.lastSweep.expiredOpenItems} open item(s),
                  aged out {state.data.lastSweep.agedGiftRecords} gift record(s), dropped {state.data.lastSweep.droppedInterviews} interview(s),
                  cleared {state.data.lastSweep.staleMirrors} stale mirror(s).
                </p>
              ) : (
                <p className="dates-state__last-sweep">No sweep has run yet.</p>
              )}
              <button type="button" className="secondary-button" disabled={runSweep.isPending} onClick={() => runSweep.mutate()}>
                {runSweep.isPending ? 'Sweeping…' : 'Run sweep now'}
              </button>
              {sweepResult ? (
                <p className="dates-state__sweep-result" role="status">
                  {sweepResult.hold ? `Held: ${sweepResult.hold}.` : sweepResult.delivered ? `Delivered via ${sweepResult.deliveryChannel}.` : 'Ran with nothing to deliver.'}
                  {' '}Mirrored {sweepResult.mirrored} occasion(s).
                </p>
              ) : null}
            </div>
          )}
        </section>

        {confirm.element}
      </div>
    </ErrorBoundary>
  );
}
