/**
 * mail-refusal — the one place that turns an email-surface error into the honest
 * outcome the operator should read, shared by MailView, MailMessagePeek and
 * MailAccountSettings so all three say the same thing about the same failure.
 *
 * This mirrors CalendarView's `unconfiguredNote` exactly, and is extracted to a
 * module (rather than living inside the view, as calendar's does) precisely because
 * three components need it — including the settings panel, which derives its
 * ready/needs-setup status from the same classification the views render. One
 * classifier means the status pill in settings can never disagree with the note in
 * the view about the same daemon response.
 *
 * It lives in src/lib rather than src/views/mail for the same reason
 * provider-status.ts and daemon-health.ts do: it is a pure deriver over a wire
 * response with no JSX, consumed by BOTH a view and a component. Keeping it under
 * views would have made src/components/settings/MailAccountSettings the only file in
 * the repo importing upward out of src/views — a layering inversion for no gain.
 *
 * Returning `null` means "this is a genuine error" — the caller falls back to a
 * plain ErrorState with a retry. That distinction is the whole point: a surface the
 * operator has not set up yet is not a fault, and must not be dressed as one.
 */
import {
  isEmailAuthFailedError,
  isEmailUnconfiguredError,
  isMethodNotInvokableError,
  isMethodUnavailableError,
} from './errors';

export type MailRefusalKind = 'not-available' | 'needs-setup' | 'auth-failed';

export interface MailRefusalNote {
  readonly kind: MailRefusalKind;
  readonly title: string;
  readonly description: string;
}

/**
 * The setup pointer names config keys rather than offering a form, and that is
 * deliberate: mail credentials are daemon-owned state. They are written through
 * `config.set` so the daemon holds them and keeps using them with this browser shut,
 * and so the agent and the TUI — which read the same daemon config — see the same
 * account. A form here that stashed anything in browser storage would break both
 * properties, so the operator is pointed at the settings surface that writes through
 * the daemon instead.
 */
const SETUP_POINTER =
  'Set the account in Settings → the mail keys under surfaces (host, port, account address) and store the app password in the daemon secret tier. Settings writes through the daemon, so the account keeps working with this browser closed and the agent and terminal see the same one.';

export function mailRefusalNote(error: unknown): MailRefusalNote | null {
  // Order matters: capability-absent is checked FIRST. Today every email call
  // returns 404/501 (the four verbs ship invokable:false and the daemon serves no
  // /api/email route), and telling the operator to go configure an account that
  // nothing would read yet would be a wild goose chase. Capability first, then
  // configuration, then credentials — each step only reachable once the prior one
  // is genuinely satisfied.
  if (isMethodUnavailableError(error) || isMethodNotInvokableError(error)) {
    return {
      kind: 'not-available',
      title: 'Mail isn’t available on this daemon yet',
      description:
        'This daemon build catalogs the email verbs but serves no mail handler, so there is nothing to configure yet. Upgrade to a daemon build that registers the IMAP/SMTP surface and this view starts working with no change here.',
    };
  }
  if (isEmailUnconfiguredError(error)) {
    return {
      kind: 'needs-setup',
      title: 'Mail isn’t configured',
      description: SETUP_POINTER,
    };
  }
  if (isEmailAuthFailedError(error)) {
    return {
      kind: 'auth-failed',
      title: 'The mail server rejected the stored credentials',
      description:
        'The account is configured but the IMAP/SMTP server refused it — usually a revoked or rotated app password. Replace the stored password in Settings; the daemon holds it, so replacing it there fixes the agent and terminal at the same time.',
    };
  }
  return null;
}
