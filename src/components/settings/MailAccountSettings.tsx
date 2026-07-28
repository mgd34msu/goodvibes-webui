/**
 * MailAccountSettings — the connection status for the mail and calendar surfaces,
 * mounted in AdminView alongside TailscaleSettings and PairingTokensSettings.
 *
 * WHAT THIS IS: a read-only status panel that probes each surface with its cheapest
 * real verb and reports what came back — `ready`, or a needs-setup state naming the
 * concrete next step. It reports on the daemon; it does not hold anything.
 *
 * WHAT THIS DELIBERATELY IS NOT: a credential form. There is no field here for a
 * client id, a client secret, a refresh token or an app password, and that is a
 * design decision rather than an omission:
 *
 *   - Anything the operator configures must keep working after this tab is closed,
 *     and must be the same account the agent and the terminal see. That means it has
 *     to live in daemon-owned config and the daemon secret tier — never in browser
 *     state. Every write this repo makes to such a key goes through
 *     `sdk.operator.config.set`, and `surfaces.*` is already covered by
 *     DAEMON_OWNED_CONFIG_PREFIXES in config-ownership.ts, so SettingsModal's
 *     schema-driven editor writes those keys through the daemon and badges them
 *     "Daemon-owned" with no bespoke form needed here.
 *   - Secret-shaped keys never round-trip to the browser: config-redaction.ts masks
 *     every key in its declared SECRET_CONFIG_KEYS set (the mail/calendar passwords
 *     and secret references among them), plus a last-segment token/secret/password/
 *     apikey heuristic as an additional safety net, and SettingsField renders those
 *     write-only (an explicit "Replace" that posts a new value and never displays
 *     the stored one).
 *
 * So the honest division is: the schema-driven settings modal owns editing, because
 * it already writes through the daemon and masks correctly; this panel owns telling
 * the operator whether what they configured actually works, and pointing at that
 * editor when it does not. Duplicating the editor here would add a second write path
 * with weaker masking and no benefit.
 *
 * QUIET BY CONSTRUCTION, like TailscaleSettings: while the probes are in flight the
 * panel renders nothing rather than flashing a scary state it is about to correct.
 */
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Mail } from 'lucide-react';
import { sdk } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import { formatError } from '../../lib/errors';
import {
  isCalendarAuthFailedError,
  isCalendarUnconfiguredError,
  isMethodNotInvokableError,
  isMethodUnavailableError,
} from '../../lib/errors';
import { mailRefusalNote } from '../../lib/mail-refusal';

type SurfaceState = 'ready' | 'needs-setup' | 'not-available' | 'auth-failed' | 'error';

interface SurfaceStatus {
  readonly state: SurfaceState;
  readonly label: string;
  readonly detail: string;
}

const STATE_LABEL: Record<SurfaceState, string> = {
  ready: 'Ready',
  'needs-setup': 'Needs setup',
  'not-available': 'Not on this daemon',
  'auth-failed': 'Credentials rejected',
  error: 'Status unavailable',
};

/**
 * Mail status from the same classifier the mail views render, so the pill here can
 * never disagree with the note there about the same daemon response.
 */
function mailStatus(error: unknown, ok: boolean): SurfaceStatus {
  if (ok) {
    return { state: 'ready', label: STATE_LABEL.ready, detail: 'The account answered a live inbox read.' };
  }
  const note = mailRefusalNote(error);
  if (note) return { state: note.kind, label: STATE_LABEL[note.kind], detail: note.description };
  return { state: 'error', label: STATE_LABEL.error, detail: formatError(error) };
}

/**
 * Calendar status from the calendar surface's own error helpers. Kept separate from
 * mailStatus rather than generalized: the two surfaces have genuinely different
 * refusal codes (CalDAV's CALENDAR_* set vs the email 412 backstop), and collapsing
 * them into one matcher would mean one surface silently inheriting the other's
 * assumptions the first time either changes.
 */
function calendarStatus(error: unknown, ok: boolean): SurfaceStatus {
  if (ok) {
    return { state: 'ready', label: STATE_LABEL.ready, detail: 'The endpoint answered a live event query.' };
  }
  if (isMethodUnavailableError(error) || isMethodNotInvokableError(error)) {
    return {
      state: 'not-available',
      label: STATE_LABEL['not-available'],
      detail:
        'This daemon build catalogs the calendar verbs but serves no calendar handler, so there is nothing to configure yet.',
    };
  }
  if (isCalendarUnconfiguredError(error)) {
    return {
      state: 'needs-setup',
      label: STATE_LABEL['needs-setup'],
      detail:
        'No endpoint has been brought yet. Set the CalDAV URL and account in Settings and store the password in the daemon secret tier — Settings writes through the daemon, so the terminal and the agent get the same calendar.',
    };
  }
  if (isCalendarAuthFailedError(error)) {
    return {
      state: 'auth-failed',
      label: STATE_LABEL['auth-failed'],
      detail: 'The configured endpoint refused the stored credentials. Replace the password in Settings.',
    };
  }
  return { state: 'error', label: STATE_LABEL.error, detail: formatError(error) };
}

function SurfaceRow({
  icon,
  name,
  status,
  testId,
}: {
  icon: React.ReactNode;
  name: string;
  status: SurfaceStatus;
  testId: string;
}) {
  return (
    <div className="mail-settings__row" data-testid={testId} data-state={status.state}>
      <div className="mail-settings__row-head">
        {icon}
        <span className="mail-settings__row-name">{name}</span>
        <span className={`status-pill status-pill--${status.state === 'ready' ? 'ok' : 'info'}`}>{status.label}</span>
      </div>
      <p className="mail-settings__row-detail">{status.detail}</p>
    </div>
  );
}

export function MailAccountSettings() {
  // The lightest real read each surface publishes. limit:1 rather than a bare list so
  // a working account is not made to page its whole inbox just to answer "are you
  // reachable"; both verbs are read-only (BODY.PEEK / EXAMINE), so probing cannot
  // change mailbox or calendar state.
  const mailProbe = useQuery({
    queryKey: queryKeys.emailInbox(1, false, ''),
    queryFn: () => sdk.operator.email.inbox.list({ limit: 1 }),
    retry: false,
  });
  const calendarProbe = useQuery({
    queryKey: ['calendar', 'surface-probe'],
    queryFn: () => sdk.operator.calendar.events.list({ limit: 1 }),
    retry: false,
  });

  // Quiet while unknown — no flash of a state about to be corrected.
  if (mailProbe.isPending || calendarProbe.isPending) return null;

  const mail = mailStatus(mailProbe.error, !mailProbe.error);
  const calendar = calendarStatus(calendarProbe.error, !calendarProbe.error);

  return (
    <section className="panel" data-testid="mail-account-settings">
      <div className="panel-title">
        <h2>Mail &amp; calendar accounts</h2>
        <Mail size={18} aria-hidden="true" />
      </div>

      <p className="mail-settings__intro">
        Both surfaces are configured in Settings, under the daemon-owned keys — the daemon holds the account and its
        password, so it keeps working with this browser closed, and the terminal and the agent read the same one. No
        credential is ever sent to or stored in this browser.
      </p>

      <div className="mail-settings__rows">
        <SurfaceRow
          icon={<Mail size={16} aria-hidden="true" />}
          name="Mail (IMAP / SMTP)"
          status={mail}
          testId="mail-surface-status"
        />
        <SurfaceRow
          icon={<CalendarDays size={16} aria-hidden="true" />}
          name="Calendar (CalDAV)"
          status={calendar}
          testId="calendar-surface-status"
        />
      </div>
    </section>
  );
}
