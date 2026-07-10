/**
 * CheckInView — the proactive check-in configuration, its run receipts, and a
 * manual run-now trigger (checkin.*).
 *
 * Single-column, phone-first: config display up top with an edit control (gated by a
 * confirm sheet — checkin.config.set can ENABLE proactive contact, so every save
 * confirms, not just the enabling edit), a "run now" action showing the resulting
 * receipt inline, then the receipts list (newest first, from the wire) rendering each
 * outcome plainly — delivered / ran quiet / skipped-and-why / error — never collapsed
 * to a bare status dot.
 *
 * checkin.* emits no wire event yet (a standing gap shared with fleet.*, checkpoints.*,
 * ci.* — see queryKeys.checkinConfig/checkinReceipts), so freshness comes from
 * mutation-driven invalidation and a manual refresh, not realtime invalidation.
 */

import { useState, type SyntheticEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, RefreshCw, Settings2 } from 'lucide-react';
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
import '../../styles/components/checkin.css';

type CheckinConfig = OperatorMethodOutput<'checkin.config.get'>['config'];
type CheckinReceipt = OperatorMethodOutput<'checkin.receipts.list'>['receipts'][number];
type CheckinRunResult = OperatorMethodOutput<'checkin.run'>;

/** Plain outcome labels — the receipts.list enum (skipped-disabled/skipped-quiet-hours)
 * and the checkin.run enum (a generic 'skipped') are distinct wire shapes; this handles
 * both rather than assuming one covers the other. */
function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case 'delivered': return 'Delivered';
    case 'quiet': return 'Ran quiet — nothing worth surfacing';
    case 'skipped-disabled': return 'Skipped — check-in is disabled';
    case 'skipped-quiet-hours': return 'Skipped — within quiet hours';
    case 'skipped': return 'Skipped';
    case 'error': return 'Error';
    default: return outcome;
  }
}

function outcomeTone(outcome: string): string {
  if (outcome === 'delivered') return 'ok';
  if (outcome === 'error') return 'bad';
  if (outcome.startsWith('skipped')) return 'neutral';
  return 'neutral';
}

function ConfigEditForm({
  config,
  onSaved,
  onCancel,
}: {
  config: CheckinConfig;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirmSheet();
  const [enabled, setEnabled] = useState(config.enabled);
  const [cadence, setCadence] = useState(config.cadence);
  const [deliveryChannel, setDeliveryChannel] = useState(config.deliveryChannel);
  const [quietHours, setQuietHours] = useState(config.quietHours);

  const save = useMutation({
    mutationFn: () => sdk.operator.checkin.config.set({ enabled, cadence, deliveryChannel, quietHours }),
    onSuccess: () => {
      onSaved();
      toast({ title: 'Check-in configuration saved', tone: 'success' });
    },
    onError: (error: unknown) => {
      toast({ title: 'Failed to save', description: formatError(error), tone: 'danger' });
    },
  });

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // Every save confirms — this can ENABLE proactive contact (the daemon reaching out
    // on its own schedule), not just the specific edit that flips enabled on.
    const ok = await confirm.ask({
      title: enabled ? 'Save — proactive check-ins will run' : 'Save check-in configuration',
      description: enabled
        ? `The daemon will contact you via ${deliveryChannel || 'the configured channel'} on schedule "${cadence}", outside quiet hours "${quietHours}".`
        : 'Check-ins remain disabled — no proactive contact will run.',
      confirmLabel: 'Save',
      tone: enabled ? 'danger' : 'default',
    });
    if (!ok) return;
    save.mutate();
  }

  return (
    <form className="checkin-edit-form" onSubmit={(e) => void handleSubmit(e)}>
      {confirm.element}
      <label className="checkin-edit-form__checkbox">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={save.isPending} />
        Enabled
      </label>
      <label>
        Cadence (cron)
        <input type="text" value={cadence} onChange={(e) => setCadence(e.target.value)} disabled={save.isPending} />
      </label>
      <label>
        Delivery channel
        <input type="text" value={deliveryChannel} onChange={(e) => setDeliveryChannel(e.target.value)} disabled={save.isPending} />
      </label>
      <label>
        Quiet hours
        <input type="text" value={quietHours} onChange={(e) => setQuietHours(e.target.value)} disabled={save.isPending} />
      </label>
      <div className="checkin-edit-form__actions">
        <button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</button>
        <button type="button" className="secondary" onClick={onCancel} disabled={save.isPending}>Cancel</button>
      </div>
    </form>
  );
}

function ReceiptRow({ receipt }: { receipt: CheckinReceipt }) {
  return (
    <li className="checkin-receipt">
      <div className="checkin-receipt__header">
        <span className={`badge ${outcomeTone(receipt.outcome)}`}>{outcomeLabel(receipt.outcome)}</span>
        <span className="badge neutral">{receipt.trigger}</span>
        <span className="checkin-receipt__meta">{formatRelative(receipt.ranAt)}</span>
      </div>
      <p className="checkin-receipt__summary">{receipt.briefingSummary}</p>
      {receipt.decisionReason && <p className="checkin-receipt__detail">Reason: {receipt.decisionReason}</p>}
      {receipt.deliveredMessage && <p className="checkin-receipt__detail">Message: {receipt.deliveredMessage}</p>}
      {receipt.error && <p className="checkin-receipt__detail checkin-receipt__error">Error: {receipt.error}</p>}
    </li>
  );
}

export function CheckInView() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [runResult, setRunResult] = useState<CheckinRunResult | null>(null);

  const config = useQuery({
    queryKey: queryKeys.checkinConfig,
    queryFn: () => sdk.operator.checkin.config.get(),
  });
  const receipts = useQuery({
    queryKey: queryKeys.checkinReceipts,
    queryFn: () => sdk.operator.checkin.receipts.list(),
  });

  const run = useMutation({
    mutationFn: () => sdk.operator.checkin.run(),
    onSuccess: async (result) => {
      setRunResult(result);
      await queryClient.invalidateQueries({ queryKey: queryKeys.checkinReceipts });
    },
    onError: (error: unknown) => {
      toast({
        title: isMethodUnavailableError(error) ? 'Check-in unavailable on this daemon' : 'Check-in run failed',
        description: isMethodUnavailableError(error) ? undefined : formatError(error),
        tone: 'danger',
      });
    },
  });

  const configUnavailable = config.isError && isMethodUnavailableError(config.error);
  const receiptsUnavailable = receipts.isError && isMethodUnavailableError(receipts.error);
  const list = receipts.data?.receipts ?? [];

  return (
    <div className="checkin-view">
      <section className="checkin-section">
        <div className="checkin-section__header">
          <h2>Configuration</h2>
          <div className="checkin-section__actions">
            <button className="icon-button" type="button" title="Refresh" onClick={() => void config.refetch()}>
              <RefreshCw size={15} />
            </button>
          </div>
        </div>

        {config.isPending && <SkeletonBlock variant="text" lines={4} />}
        {configUnavailable && <div className="checkin-empty" role="note">Check-in is unavailable on this daemon.</div>}
        {config.isError && !configUnavailable && (
          <ErrorState error={config.error} onRetry={() => void config.refetch()} title="Failed to load check-in config" />
        )}
        {config.isSuccess && !editing && (
          <div className="checkin-config-display">
            <div className="checkin-config-display__row">
              <span className={`badge ${config.data.config.enabled ? 'ok' : 'neutral'}`}>
                {config.data.config.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <dl className="checkin-config-display__fields">
              <dt>Cadence</dt>
              <dd>{config.data.config.cadence || '—'}</dd>
              <dt>Delivery channel</dt>
              <dd>{config.data.config.deliveryChannel || '—'}</dd>
              <dt>Quiet hours</dt>
              <dd>{config.data.config.quietHours || '—'}</dd>
            </dl>
            <button type="button" className="checkin-config-display__edit" onClick={() => setEditing(true)}>
              <Settings2 size={14} /> Edit
            </button>
          </div>
        )}
        {config.isSuccess && editing && (
          <ConfigEditForm
            config={config.data.config}
            onSaved={() => { setEditing(false); void config.refetch(); }}
            onCancel={() => setEditing(false)}
          />
        )}
      </section>

      <section className="checkin-section">
        <div className="checkin-section__header">
          <h2>Run now</h2>
        </div>
        <button type="button" className="checkin-run-button" onClick={() => run.mutate()} disabled={run.isPending}>
          <Play size={14} /> {run.isPending ? 'Running…' : 'Run check-in now'}
        </button>
        {runResult && (
          <div className="checkin-run-result">
            <span className={`badge ${outcomeTone(runResult.outcome)}`}>{outcomeLabel(runResult.outcome)}</span>
            <p className="checkin-receipt__summary">{runResult.summary}</p>
          </div>
        )}
      </section>

      <section className="checkin-section">
        <div className="checkin-section__header">
          <h2>Recent receipts</h2>
          <div className="checkin-section__actions">
            <button className="icon-button" type="button" title="Refresh" onClick={() => void receipts.refetch()}>
              <RefreshCw size={15} />
            </button>
          </div>
        </div>
        {receipts.isPending && <SkeletonBlock variant="text" lines={4} />}
        {receiptsUnavailable && <div className="checkin-empty" role="note">Check-in receipts are unavailable on this daemon.</div>}
        {receipts.isError && !receiptsUnavailable && (
          <ErrorState error={receipts.error} onRetry={() => void receipts.refetch()} title="Failed to load receipts" />
        )}
        {receipts.isSuccess && list.length === 0 && (
          <EmptyState title="No check-in runs yet" description="Receipts appear here after the first scheduled or manual run." />
        )}
        {list.length > 0 && (
          <ul className="checkin-receipts">
            {list.map((receipt) => <ReceiptRow key={receipt.id} receipt={receipt} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
