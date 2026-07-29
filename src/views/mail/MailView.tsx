/**
 * MailView — the inbox, the message reader, and the composer, over the daemon's four
 * `email.*` verbs. The web UI is mail's first screen, exactly as it was calendar's.
 *
 * WHY THIS EXISTS NOW: `email.inbox.list`, `email.inbox.read`, `email.draft.create`
 * and `email.send` have been in the operator contract and in the generated
 * WEBUI_METHOD_ROUTES table since before the SDK pin this repo was stuck on — the
 * routing was always there and no surface ever rendered it. This view is wiring over
 * capability the daemon already publishes, not an integration: there is no IMAP
 * client, no SMTP client, no OAuth flow and no credential handling anywhere in this
 * file or anything it imports. Every call is `sdk.operator.email.*`, which is an
 * ergonomic wrapper over `invokeOperator`, which resolves through the generated route
 * table. The browser never holds a mail credential because it never has one to hold.
 *
 * HONESTY CONTRACT (mail-refusal.ts owns the classification; three shapes, each
 * rendered distinctly, never folded into a generic "error"):
 *  1. NOT AVAILABLE — 404/501. This daemon build has no mail handler wired. This is
 *     the state every build returns TODAY: the SDK ships all four verbs
 *     `invokable: false` and its own catalog notes there is no /api/email route on
 *     the daemon router at any prefix. The view says exactly that instead of
 *     pretending an empty inbox.
 *  2. NEEDS SETUP — a 412 precondition refusal. The handler exists; no account has
 *     been brought. Points at the settings surface, which writes through the daemon.
 *  3. GENUINE ERROR — anything else, as an ErrorState with retry.
 * There is deliberately no fourth "maybe it's just empty" reading. An inbox that
 * really is empty is a successful response with `messages: []`, and renders as an
 * EmptyState that says so — never as a refusal, and never the other way round.
 *
 * NEVER A DEAD BUTTON: when the surface is refusing, the composer's Send and Save
 * draft controls are disabled with the reason named beside them, rather than left
 * live to fail on click. The controls exist (the capability is real and the wiring is
 * complete) but they never invite an action that cannot land.
 */
import { SyntheticEvent, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Inbox, Mail, MailPlus, Send } from 'lucide-react';
import { sdk } from '../../lib/goodvibes';
import type { EmailDraftCreateInput, EmailSendInput, EmailUnreadableMessage } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import { formatError } from '../../lib/errors';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';
import ErrorBoundary from '../../components/feedback/ErrorBoundary';
import { usePeek } from '../../components/peek/PeekPanel';
import { useToast } from '../../lib/toast';
import { useConfirmSheet } from '../../components/confirm/useConfirmSheet';
import { MailMessagePeekBody } from './MailMessagePeek';
import { mailRefusalNote } from '../../lib/mail-refusal';
import { sortInboxMessagesByUidDescending } from '../../lib/mail-order';
import '../../styles/components/mail.css';

/** Trim to the recipient list the daemon will actually use, so the confirmation
 * sheet shows the operator the same string that goes on the wire. */
/**
 * The messages the daemon could not parse, and why.
 *
 * Rendered rather than counted: "3 messages could not be read" tells an operator
 * nothing they can act on, while the per-message detail the daemon already sends
 * ("unsupported encoding", "malformed header") is the thing that says whether it
 * is one broken sender or a whole account misconfigured. `uid` is optional on the
 * wire — a message can fail before its uid is known — so it is only shown when
 * present rather than rendered as "undefined".
 */
function UnreadableNote({ items }: { items: readonly EmailUnreadableMessage[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mail-note mail-note--unreadable" role="status" data-testid="mail-unreadable">
      <h3>
        {items.length === 1 ? '1 message could not be read' : `${String(items.length)} messages could not be read`}
      </h3>
      <ul>
        {items.map((item, index) => (
          <li key={item.uid ?? `no-uid-${String(index)}`}>
            {item.uid === undefined ? item.detail : `uid ${String(item.uid)}: ${item.detail}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

function normalizeRecipients(value: string): string {
  return value.split(',').map((part) => part.trim()).filter(Boolean).join(', ');
}

function formatWhen(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
}

export function MailView() {
  // Deliberately no queryClient/invalidation here. Neither write touches the inbox:
  // email.send puts a message in the recipient's mailbox, and email.draft.create
  // appends to the account's Drafts folder — the inbox listing this view caches is
  // unchanged by both, and the read verb is BODY.PEEK so opening a message does not
  // flip its unread flag either. Invalidating anyway would refetch the whole inbox to
  // redraw identical rows and would quietly imply a relationship that is not there.
  const peek = usePeek();
  const { toast } = useToast();
  const confirm = useConfirmSheet();
  const composerRef = useRef<HTMLFormElement | null>(null);

  const [limit, setLimit] = useState(25);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [since, setSince] = useState('');

  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [inReplyTo, setInReplyTo] = useState('');

  const inbox = useQuery({
    queryKey: queryKeys.emailInbox(limit, unreadOnly, since),
    queryFn: () =>
      sdk.operator.email.inbox.list({
        limit,
        ...(unreadOnly ? { unreadOnly: true } : {}),
        ...(since ? { since: new Date(`${since}T00:00:00.000Z`).toISOString() } : {}),
      }),
  });

  const inboxNote = inbox.error ? mailRefusalNote(inbox.error) : null;
  // The composer follows the inbox's verdict: if listing is refused, sending is too
  // (same surface, same daemon state), so the controls disable with the reason shown
  // rather than staying live to fail. `isPending` also disables — a control whose
  // availability is not yet known must not look available.
  const surfaceRefusing = Boolean(inboxNote) || inbox.isPending;

  function clearComposer(): void {
    setTo('');
    setSubject('');
    setBody('');
    setInReplyTo('');
  }

  const send = useMutation({
    mutationFn: () => {
      const input: EmailSendInput = {
        to: normalizeRecipients(to),
        subject: subject.trim(),
        body,
        // Literal true, and only reached after the confirmation sheet resolved — the
        // SDK marks this verb dangerous and irreversible, so the flag is set because
        // the operator saw the recipients and agreed, never on their behalf.
        confirm: true,
        ...(inReplyTo ? { inReplyTo } : {}),
      };
      return sdk.operator.email.send(input);
    },
    onSuccess: (result) => {
      clearComposer();
      toast({ title: 'Message sent', description: `Sent ${formatWhen(result.sentAt)} · ${result.messageId}`, tone: 'success' });
    },
    onError: (error) => {
      const note = mailRefusalNote(error);
      toast({ title: note?.title ?? 'Send failed', description: note?.description ?? formatError(error), tone: 'danger' });
    },
  });

  const saveDraft = useMutation({
    mutationFn: () => {
      const input: EmailDraftCreateInput = {
        to: normalizeRecipients(to),
        subject: subject.trim(),
        body,
        ...(inReplyTo ? { inReplyTo, references: inReplyTo } : {}),
      };
      return sdk.operator.email.draft.create(input);
    },
    onSuccess: (result) => {
      clearComposer();
      toast({
        title: 'Draft saved to the account',
        description: `Appended to the IMAP Drafts folder as UID ${result.uid}. It is in the mailbox itself, so it is there in any mail client — not only here.`,
        tone: 'success',
      });
    },
    onError: (error) => {
      const note = mailRefusalNote(error);
      toast({ title: note?.title ?? 'Draft failed', description: note?.description ?? formatError(error), tone: 'danger' });
    },
  });

  const messages = inbox.data?.messages ?? [];
  // Ordered by `uid` (server-assigned) descending, NEVER by `date` (sender-written —
  // sorting on it would let a sender pin their message to the top with a far-future
  // Date: header). Full rationale in mail-order.ts; do not "simplify" this to `date`.
  const sorted = useMemo(() => sortInboxMessagesByUidDescending(messages), [messages]);
  // Messages the account returned but the daemon could not parse, each with its own
  // reason. The contract has always carried this list; the hand-written result type
  // this view used to read omitted it, so these messages were dropped in silence —
  // including in the case that matters most, where every message in the window is
  // unreadable and the view below would otherwise report a normal empty inbox.
  const unreadable = inbox.data?.unreadable ?? [];

  const composerReady = to.trim() !== '' && subject.trim() !== '' && body.trim() !== '';

  function startReply(message: { subject: string; from: string; messageId: string }): void {
    setTo(message.from);
    setSubject(message.subject.startsWith('Re: ') ? message.subject : `Re: ${message.subject}`);
    setInReplyTo(message.messageId);
    peek.close();
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function openMessage(uid: number): void {
    peek.open({
      title: 'Message',
      content: <MailMessagePeekBody uid={uid} onReply={startReply} />,
    });
  }

  async function submitSend(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!composerReady || surfaceRefusing) return;
    const recipients = normalizeRecipients(to);
    const agreed = await confirm.ask({
      title: 'Send this message?',
      target: recipients,
      description:
        'This leaves the account immediately and cannot be recalled. Check the recipients and the subject before confirming.',
      confirmLabel: 'Send',
      tone: 'danger',
    });
    if (agreed) send.mutate();
  }

  return (
    <ErrorBoundary fallback={(err, reset) => <ErrorState error={err} onRetry={reset} title="Mail view failed" />}>
      <div className="stack" data-testid="mail-view">
        <section className="panel">
          <div className="panel-title">
            <h2>Mail</h2>
            <Inbox size={18} aria-hidden="true" />
          </div>

          <div className="mail-filter-controls">
            <label>
              Show
              <select
                value={String(limit)}
                onChange={(event) => setLimit(Number(event.target.value))}
                aria-label="Number of messages to fetch"
              >
                <option value="25">25 messages</option>
                <option value="50">50 messages</option>
                <option value="100">100 messages</option>
              </select>
            </label>
            <label>
              Since
              <input
                type="date"
                value={since}
                onChange={(event) => setSince(event.target.value)}
                aria-label="Only messages on or after this date"
              />
            </label>
            <label className="mail-filter-controls__check">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(event) => setUnreadOnly(event.target.checked)}
                aria-label="Unread messages only"
              />
              Unread only
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void inbox.refetch()}
              aria-label="Refresh inbox"
            >
              Refresh
            </button>
          </div>

          <div aria-live="polite" aria-atomic="false" className="mail-status-region">
            {inbox.isPending ? (
              <div className="knowledge-skeleton-group">
                <SkeletonBlock width="100%" height={36} />
                <SkeletonBlock width="100%" height={36} />
                <SkeletonBlock width="100%" height={36} />
              </div>
            ) : inboxNote ? (
              <div className="mail-note" role="status" data-testid={`mail-note-${inboxNote.kind}`}>
                <h3>{inboxNote.title}</h3>
                <p>{inboxNote.description}</p>
              </div>
            ) : inbox.error ? (
              <ErrorState error={inbox.error} onRetry={() => void inbox.refetch()} title="Inbox failed to load" />
            ) : sorted.length === 0 ? (
              <>
                <EmptyState
                  icon={<Mail size={20} aria-hidden="true" />}
                  title={unreadable.length > 0 ? 'Nothing readable in the inbox' : 'Nothing in the inbox'}
                  description={
                    unreadable.length > 0
                      ? 'Every message in this window failed to parse. They are listed below with the reason each one gave.'
                      : unreadOnly
                        ? 'No unread messages match this window. Clear the unread filter to see the rest.'
                        : 'The account answered normally with no messages in this window.'
                  }
                />
                <UnreadableNote items={unreadable} />
              </>
            ) : (
              <>
                <p className="mail-list__count">
                  Showing {sorted.length} of {inbox.data?.total ?? sorted.length} messages the account reported.
                </p>
                <UnreadableNote items={unreadable} />
                <ul className="mail-list" data-testid="mail-list">
                  {sorted.map((message) => (
                    <li key={message.uid}>
                      <button
                        type="button"
                        className={message.unread ? 'mail-row mail-row--unread' : 'mail-row'}
                        onClick={() => openMessage(message.uid)}
                      >
                        <span className="mail-row__top">
                          <span className="mail-row__from">{message.from}</span>
                          <span className="mail-row__date">{formatWhen(message.date)}</span>
                        </span>
                        <span className="mail-row__subject">
                          {message.unread ? <span className="mail-row__unread-pill">Unread</span> : null}
                          {message.subject || '(no subject)'}
                        </span>
                        <span className="mail-row__preview">{message.bodyPreview}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <h2>Compose</h2>
            <MailPlus size={18} aria-hidden="true" />
          </div>
          <form className="mail-composer" onSubmit={(event) => void submitSend(event)} ref={composerRef}>
            <label>
              To
              <input
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="someone@example.com, another@example.com"
                aria-label="Recipients"
              />
            </label>
            <label>
              Subject
              <input value={subject} onChange={(event) => setSubject(event.target.value)} aria-label="Subject" />
            </label>
            <label>
              Message
              <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={8} aria-label="Message body" />
            </label>

            {inReplyTo ? (
              <p className="mail-composer__reply-note">
                Replying to <code>{inReplyTo}</code>{' '}
                <button type="button" className="link-button" onClick={() => setInReplyTo('')}>
                  Clear reply threading
                </button>
              </p>
            ) : null}

            {inboxNote ? (
              <p className="mail-composer__blocked" role="status">
                Sending and drafts are unavailable for the same reason: {inboxNote.title.toLowerCase()}.
              </p>
            ) : null}

            <div className="mail-composer__actions">
              <button type="submit" disabled={!composerReady || surfaceRefusing || send.isPending}>
                <Send size={16} aria-hidden="true" /> {send.isPending ? 'Sending…' : 'Send'}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={!composerReady || surfaceRefusing || saveDraft.isPending}
                onClick={() => saveDraft.mutate()}
              >
                {saveDraft.isPending ? 'Saving…' : 'Save draft to account'}
              </button>
            </div>
          </form>
        </section>
        {confirm.element}
      </div>
    </ErrorBoundary>
  );
}
