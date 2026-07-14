/**
 * PowerSettings — the admin/ops surface for the host sleep-ownership state
 * (power.status.get / power.keepAwake.set, SDK 1.8.0). Same non-schema-driven
 * pattern as NotificationSettings/PairingTokensSettings: these two verbs carry
 * no CONFIG_SCHEMA entry (they are dedicated wire verbs, not config.set keys),
 * so they get their own panel rather than a schema-driven SettingsModal row.
 *
 * The ruled shape (owner ruling, 2026-07): ONE toggle — no timers, no AC-only
 * sub-options. The always-visible "sleep disabled" chip (StatusStrip/PowerChip)
 * is the safety mechanism that keeps this override from being forgotten, not a
 * countdown.
 *
 * "Held because X": the automatic work inhibitor's live reasons render
 * verbatim whenever it holds — this is the daemon's own honest accounting of
 * why sleep is currently blocked (e.g. an active turn), never a client guess.
 * The keep-awake toggle's own state (granted vs. denied classes, and the
 * honest lid-split `note` when part of the requested coverage was refused)
 * renders alongside it, verbatim, the same as PowerChip's tooltip.
 */
import { Moon, MoonStar } from 'lucide-react';
import { usePowerStatus, useSetKeepAwake } from '../../hooks/usePowerStatus';
import { formatError } from '../../lib/errors';
import { formatRelative } from '../../lib/object';
import { ErrorState } from '../feedback/ErrorState';
import { SkeletonBlock } from '../feedback/SkeletonBlock';
import '../../styles/components/power.css';

function classesLabel(classes: readonly string[]): string {
  return classes.length > 0 ? classes.join(', ') : 'none';
}

export function PowerSettings() {
  const status = usePowerStatus();
  const setKeepAwake = useSetKeepAwake();

  if (status.isPending) {
    return (
      <section className="panel power-panel">
        <div className="panel-title">
          <h2>Power</h2>
          <Moon size={18} aria-hidden="true" />
        </div>
        <div aria-label="Loading power state" aria-busy="true">
          <SkeletonBlock variant="text" lines={3} />
        </div>
      </section>
    );
  }

  if (status.isError) {
    return (
      <section className="panel power-panel">
        <div className="panel-title">
          <h2>Power</h2>
          <Moon size={18} aria-hidden="true" />
        </div>
        <ErrorState error={status.error} title="Power state unavailable" onRetry={() => void status.refetch()} />
      </section>
    );
  }

  // status.isPending/isError are both false here, so react-query's discriminated
  // union guarantees status.data is defined (the 'success' branch) — no defensive
  // null check needed (and eslint's no-unnecessary-condition catches one if added).
  const { work, keepAwake } = status.data;
  const pendingEnabled = setKeepAwake.isPending ? setKeepAwake.variables : keepAwake.enabled;

  return (
    <section className="panel power-panel">
      <div className="panel-title">
        <h2>Power</h2>
        <Moon size={18} aria-hidden="true" />
      </div>

      <p className="form-note">
        Keep this machine from sleeping while you want it reachable. No timers, no AC-only
        mode — one toggle, and the status strip always shows a chip while it holds.
      </p>

      <label className="check-row preference-row">
        <input
          type="checkbox"
          checked={pendingEnabled}
          disabled={setKeepAwake.isPending}
          onChange={(event) => setKeepAwake.mutate(event.target.checked)}
        />
        <span>Keep this machine awake</span>
      </label>

      {setKeepAwake.isError && (
        <div className="banner warning" role="alert">{formatError(setKeepAwake.error)}</div>
      )}

      {keepAwake.held && (
        <div className="power-panel__state power-panel__state--danger" role="status">
          <MoonStar size={15} aria-hidden="true" />
          <span>
            Sleep disabled — holding: {classesLabel(keepAwake.grantedClasses)}
            {keepAwake.deniedClasses.length > 0 ? ` (refused: ${classesLabel(keepAwake.deniedClasses)})` : ''}
          </span>
        </div>
      )}

      {/* The honest lid-split line, verbatim, whenever the daemon serves one — never
          papered over with different wording. */}
      {keepAwake.note && (
        <p className="power-panel__note" role="note">{keepAwake.note}</p>
      )}

      <div className="power-panel__work">
        <strong>Automatic work inhibitor</strong>
        {work.held ? (
          <p className="power-panel__held-because">
            Held because: {work.reasons.length > 0 ? work.reasons.join('; ') : 'active work'}
            {typeof work.heldSince === 'number' ? ` (since ${formatRelative(work.heldSince)})` : ''}
          </p>
        ) : (
          <p className="form-note">Not currently held — no active work requires it.</p>
        )}
        {work.capExpired && (
          <p className="banner warning" role="alert">
            The work inhibitor's cap ({work.capMinutes}m) has expired — the host may sleep during
            active work.
          </p>
        )}
      </div>
    </section>
  );
}
