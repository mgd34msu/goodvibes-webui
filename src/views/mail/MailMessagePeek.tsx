/**
 * MailMessagePeek — the full-message body shown in the peek panel when an inbox
 * row is selected. Reads `email.inbox.read`, which carries what the summary row
 * cannot: the full body text and attachment metadata. A genuine detail fetch, the
 * same relationship CalendarEventPeek has to the calendar event list.
 *
 * TWO DELIBERATE RESTRAINTS, both about not doing more than the surface should:
 *
 * 1. `bodyHtml` is NEVER rendered. The detail schema carries it and this component
 *    reads it, but only to say that an HTML alternative exists — the text part is
 *    what gets displayed. Rendering an arbitrary sender's HTML inside the operator
 *    console would let mail from anyone style, lay out, and (via remote image loads)
 *    phone home from a page that also holds the daemon session. Showing bodyText and
 *    naming the HTML part is the honest version: nothing is hidden from the operator,
 *    and nothing a stranger wrote gets to run in here.
 *
 * 2. Attachments are listed, never fetched. The schema is metadata only — filename,
 *    content type, size — and there is no attachment-download verb in the contract at
 *    all. So this lists what is attached and stops, rather than rendering a download
 *    control that no daemon method backs. Naming the attachment is useful; a button
 *    that cannot do anything is not.
 *
 * The read verb is explicitly non-mutating on the server (BODY.PEEK — the SDK's own
 * description says it does not mark the message read), so opening the peek does not
 * silently change the operator's mailbox state. The unread pill in the list stays
 * truthful after a read, which is why this component never optimistically clears it.
 */
import { useQuery } from '@tanstack/react-query';
import { Paperclip } from 'lucide-react';
import { sdk } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import { ErrorState } from '../../components/feedback/ErrorState';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';
import { mailRefusalNote } from '../../lib/mail-refusal';

export interface MailMessagePeekProps {
  uid: number;
  /** Prefills the composer with a reply to this message and scrolls it into view. */
  onReply: (message: { subject: string; from: string; messageId: string }) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MailMessagePeekBody({ uid, onReply }: MailMessagePeekProps) {
  const detail = useQuery({
    queryKey: queryKeys.emailMessage(uid),
    enabled: Number.isFinite(uid),
    queryFn: () => sdk.operator.email.inbox.read(uid),
  });

  if (detail.isPending) {
    return (
      <div className="mail-peek-loading">
        <SkeletonBlock width="70%" height={18} />
        <SkeletonBlock width="100%" height={14} />
        <SkeletonBlock width="90%" height={14} />
      </div>
    );
  }

  if (detail.error) {
    const note = mailRefusalNote(detail.error);
    return (
      <div className="mail-peek-body">
        {note ? (
          <div className="mail-note" role="status">
            <h3>{note.title}</h3>
            <p>{note.description}</p>
          </div>
        ) : (
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} title="Message failed to load" />
        )}
      </div>
    );
  }

  const message = detail.data;
  const attachments = message.attachments ?? [];

  return (
    <div className="mail-peek-body" data-testid="mail-message-peek">
      <h3>{message.subject || '(no subject)'}</h3>
      <p className="mail-peek-body__meta">
        <strong>From:</strong> {message.from}
      </p>
      <p className="mail-peek-body__meta">
        <strong>Date:</strong> {new Date(message.date).toLocaleString()}
      </p>

      <button
        type="button"
        className="secondary-button"
        onClick={() => onReply({ subject: message.subject, from: message.from, messageId: message.messageId })}
      >
        Reply in composer
      </button>

      <pre className="mail-peek-body__text">{message.bodyText}</pre>

      {message.bodyHtml ? (
        <p className="mail-peek-body__html-note">
          This message also has an HTML part. The plain-text part is shown above — the console does not render
          sender HTML, so nothing from the message can style or load anything inside this page.
        </p>
      ) : null}

      {attachments.length > 0 ? (
        <div className="mail-peek-body__attachments">
          <h4>
            <Paperclip size={14} aria-hidden="true" /> Attachments ({attachments.length})
          </h4>
          <ul>
            {attachments.map((attachment) => (
              <li key={`${attachment.filename}-${attachment.sizeBytes}`}>
                <span className="mail-attachment__name">{attachment.filename}</span>
                <span className="mail-attachment__meta">
                  {attachment.contentType} · {formatBytes(attachment.sizeBytes)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mail-peek-body__attachment-note">
            Listed from the message metadata. The daemon publishes no attachment-download verb, so these cannot be
            opened from here yet.
          </p>
        </div>
      ) : null}

      <p className="mail-peek-body__uid">UID: {message.uid}</p>
    </div>
  );
}
