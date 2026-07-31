/**
 * HostedSessionsView — daemon-hosted sessions (Phase B Stage B1, already shipped
 * in the SDK): a conversation whose loop runs INSIDE the daemon rather than
 * inside this browser tab, so it does not end when the tab that started it
 * goes away.
 *
 * List: sessions.hosted.list, with an includeTerminated toggle. Terminated rows
 * show `terminatedReason` verbatim (mapped to a human line — see
 * lib/hosted-sessions.ts's hostedTerminationLabel).
 *
 * Attach/view: selecting a row calls sessions.hosted.attach with this browser's
 * stable client id (lib/hosted-sessions.ts's ensureHostedClientId — persisted in
 * localStorage, distinct from the push device id), renders the returned
 * `history`, then renders the LIVE stream — the same `turn`/`tools` domain
 * frames a local session emits, filtered to this session's id
 * (useHostedSessionRealtime, lib/hosted-session-stream.ts). Steering rides the
 * ORDINARY SteerComposer/sessions.steer — there is no hosted-specific steer verb
 * (method-catalog-hosted-sessions.ts's header comment).
 *
 * Detach: fired when the attached session changes or this view unmounts. Before
 * an EXPLICIT "Leave" click, a confirm sheet states what leaving will do —
 * read from the record's own `effectiveDetachPolicy` (kill terminates it,
 * survive leaves it idle and reattachable), never guessed client-side.
 *
 * HONESTY BAR: every response read (list, attach) optional-chains — see
 * lib/hosted-sessions.ts's tolerant readers — so an unmodeled/unknown-shaped
 * response (the hermetic e2e mock's `{}` fallback for an uncataloged invoke id,
 * or a daemon predating this feature) renders a STATED "could not be read"
 * message, never an empty list indistinguishable from "no hosted sessions
 * exist" and never a crash.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, LogOut, RefreshCw } from 'lucide-react';
import { sdk } from '../../lib/goodvibes';
import type { HostedSessionRecord } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import {
  effectiveDetachPolicyLabel,
  ensureHostedClientId,
  hostedAttachResultFrom,
  hostedAttachedClientCount,
  hostedSessionFromResult,
  hostedSessionsFromListResult,
  hostedStatusLabel,
  hostedStatusTone,
  hostedTerminationLabel,
  sortHostedSessionsNewestFirst,
} from '../../lib/hosted-sessions';
import {
  hostedLiveMessageFromTurnFrame,
  hostedToolCallFromFrame,
  isTerminalTurnFrame,
  streamDeltaAccumulated,
  type HostedActiveToolCall,
  type HostedLiveMessage,
  type HostedStreamFrame,
} from '../../lib/hosted-session-stream';
import type { HostedSessionHistoryMessage } from '../../lib/goodvibes';
import { useHostedSessionRealtime } from '../../hooks/useHostedSessionRealtime';
import { SteerComposer } from './SteerComposer';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';
import { useConfirmSheet } from '../../components/confirm/useConfirmSheet';
import { formatError } from '../../lib/errors';
import { useToast } from '../../lib/toast';
import '../../styles/components/hosted-sessions.css';

/** Whether a sessions.hosted.list response carried the shape this client
 * expects (`{ sessions: [...] }`) — distinct from a genuinely empty list, so
 * the view can tell "no hosted sessions" from "the daemon answered something
 * this client cannot read" (an unmodeled invoke id, an older daemon). */
function isWellFormedListResponse(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && Array.isArray((value as { sessions?: unknown }).sessions);
}

export function HostedSessionsView() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirmSheet();
  const clientId = useMemo(() => ensureHostedClientId(), []);

  const [includeTerminated, setIncludeTerminated] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [attachedSession, setAttachedSession] = useState<HostedSessionRecord | null>(null);
  const [attachHistory, setAttachHistory] = useState<HostedSessionHistoryMessage[]>([]);
  const [liveMessages, setLiveMessages] = useState<HostedLiveMessage[]>([]);
  const [liveText, setLiveText] = useState('');
  const [activeToolCalls, setActiveToolCalls] = useState<HostedActiveToolCall[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: queryKeys.hostedSessions(includeTerminated),
    queryFn: () => sdk.operator.sessions.hosted.list({ includeTerminated }),
  });

  const sessions = useMemo(
    () => sortHostedSessionsNewestFirst(hostedSessionsFromListResult(list.data)),
    [list.data],
  );
  const listWellFormed = list.isSuccess ? isWellFormedListResponse(list.data) : true;

  const onStreamFrame = useCallback((frame: HostedStreamFrame) => {
    const delta = streamDeltaAccumulated(frame);
    if (delta !== null) {
      setLiveText(delta);
      return;
    }
    const liveMessage = hostedLiveMessageFromTurnFrame(frame);
    if (liveMessage) {
      setLiveMessages((current) => [...current, liveMessage]);
      setLiveText('');
    }
    if (isTerminalTurnFrame(frame)) {
      setActiveToolCalls([]);
      // A completed turn changed turnCount/messageCount/lastTurnAt — the list
      // row for this session is stale until the next hosted-session-update
      // (turn-ended fires one, but this refetches immediately rather than
      // waiting on it).
      void queryClient.invalidateQueries({ queryKey: queryKeys.hostedSessionsAll });
      return;
    }
    const toolCall = hostedToolCallFromFrame(frame);
    if (toolCall) {
      setActiveToolCalls((current) => {
        const rest = current.filter((call) => call.callId !== toolCall.callId);
        return toolCall.state === 'executing' ? [...rest, toolCall] : rest;
      });
    }
  }, [queryClient]);

  const onLifecycleUpdate = useCallback((payload: unknown) => {
    const session = hostedSessionFromResult(payload);
    if (session) setAttachedSession(session);
  }, []);

  const realtime = useHostedSessionRealtime({
    enabled: true,
    attachedSessionId: selectedId,
    onStreamFrame,
    onLifecycleUpdate,
  });

  const attach = useMutation({
    mutationFn: (sessionId: string) => sdk.operator.sessions.hosted.attach(sessionId, clientId),
    onSuccess: (result) => {
      const { session, history } = hostedAttachResultFrom(result);
      if (!session) {
        setAttachError('The daemon did not return a hosted session in a shape this client understands.');
        return;
      }
      setAttachError(null);
      setAttachedSession(session);
      setAttachHistory(history);
      setLiveMessages([]);
      setLiveText('');
      setActiveToolCalls([]);
    },
    onError: (error: unknown) => {
      setAttachError(formatError(error));
    },
  });

  const detachRef = useRef<{ sessionId: string; clientId: string } | null>(null);
  useEffect(() => {
    detachRef.current = attachedSession ? { sessionId: attachedSession.id, clientId } : null;
  }, [attachedSession, clientId]);

  // Detach the previously-attached session (fire-and-forget — this is the
  // passive path: switching rows or leaving the view, not an explicit "Leave"
  // click, which confirms first below) whenever the target changes, and once
  // more on unmount.
  useEffect(() => () => {
    const pending = detachRef.current;
    if (pending) void sdk.operator.sessions.hosted.detach(pending.sessionId, pending.clientId).catch(() => undefined);
  }, []);

  function selectSession(sessionId: string) {
    if (sessionId === selectedId) return;
    const previous = detachRef.current;
    if (previous) void sdk.operator.sessions.hosted.detach(previous.sessionId, previous.clientId).catch(() => undefined);
    setSelectedId(sessionId);
    setAttachedSession(null);
    setAttachHistory([]);
    setLiveMessages([]);
    setLiveText('');
    setActiveToolCalls([]);
    setAttachError(null);
    attach.mutate(sessionId);
  }

  async function leaveSession() {
    if (!attachedSession) return;
    const policy = attachedSession.effectiveDetachPolicy;
    const confirmed = await confirm.ask({
      title: 'Leave this hosted session?',
      target: attachedSession.title || attachedSession.id,
      description: effectiveDetachPolicyLabel(policy),
      confirmLabel: 'Leave',
      tone: policy === 'kill' ? 'danger' : 'default',
    });
    if (!confirmed) return;
    try {
      const result = await sdk.operator.sessions.hosted.detach(attachedSession.id, clientId);
      const updated = hostedSessionFromResult(result);
      toast({
        title: updated?.status === 'terminated' ? 'Session ended' : 'Left the session',
        tone: 'info',
      });
    } catch (error) {
      toast({ title: 'Detach failed', description: formatError(error), tone: 'danger' });
    }
    setSelectedId(null);
    setAttachedSession(null);
    setAttachHistory([]);
    setLiveMessages([]);
    setLiveText('');
    setActiveToolCalls([]);
    void queryClient.invalidateQueries({ queryKey: queryKeys.hostedSessionsAll });
  }

  return (
    <div className="hosted-sessions-view">
      {confirm.element}
      <section className="hosted-sessions-list-pane">
        <div className="hosted-sessions-toolbar">
          <h2 className="hosted-sessions-title">
            <Boxes size={16} aria-hidden="true" /> Hosted sessions
          </h2>
          <label className="hosted-sessions-toggle">
            <input
              type="checkbox"
              checked={includeTerminated}
              onChange={(event) => setIncludeTerminated(event.target.checked)}
            />
            Include terminated
          </label>
          <button
            type="button"
            className="secondary-button hosted-sessions-refresh"
            onClick={() => void list.refetch()}
            aria-label="Refresh hosted sessions"
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
        </div>

        {realtime.error && (
          <p className="hosted-sessions-stream-note" role="status">{realtime.error}</p>
        )}

        {list.isLoading && <SkeletonBlock />}
        {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.isSuccess && !listWellFormed && (
          <ErrorState
            error="The daemon answered sessions.hosted.list with a shape this client does not understand."
            onRetry={() => void list.refetch()}
            title="Could not read hosted sessions"
          />
        )}
        {list.isSuccess && listWellFormed && sessions.length === 0 && (
          <EmptyState
            icon={<Boxes size={28} aria-hidden="true" />}
            title={includeTerminated ? 'No hosted sessions' : 'No active hosted sessions'}
            description={includeTerminated
              ? 'This daemon is not hosting any sessions.'
              : 'This daemon is not hosting any active sessions. Toggle "Include terminated" to see ones that have ended.'}
          />
        )}
        {sessions.length > 0 && (
          <ul className="hosted-sessions-list" aria-label="Hosted sessions">
            {sessions.map((session) => (
              <HostedSessionRow
                key={session.id}
                session={session}
                selected={session.id === selectedId}
                onSelect={() => selectSession(session.id)}
              />
            ))}
          </ul>
        )}
      </section>

      {selectedId && (
        <HostedSessionDetail
          session={attachedSession}
          history={attachHistory}
          liveMessages={liveMessages}
          liveText={liveText}
          activeToolCalls={activeToolCalls}
          attaching={attach.isPending}
          attachError={attachError}
          onLeave={() => void leaveSession()}
        />
      )}
    </div>
  );
}

// ─── List row ────────────────────────────────────────────────────────────────

function HostedSessionRow({ session, selected, onSelect }: {
  session: HostedSessionRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  const terminationLabel = hostedTerminationLabel(session);
  return (
    <li className={selected ? 'hosted-session-row selected' : 'hosted-session-row'}>
      <button type="button" className="hosted-session-row__button" onClick={onSelect}>
        <div className="hosted-session-row__top">
          <span className="hosted-session-row__title">{session.title || session.id}</span>
          <span className={`badge ${hostedStatusTone(session.status)}`}>{hostedStatusLabel(session.status)}</span>
        </div>
        <span className="hosted-session-row__workspace" title={session.workspaceRoot}>{session.workspaceRoot}</span>
        <div className="hosted-session-row__meta">
          <span>detach: {session.effectiveDetachPolicy}</span>
          <span>{session.turnCount} turn{session.turnCount === 1 ? '' : 's'}</span>
          <span>{session.messageCount} message{session.messageCount === 1 ? '' : 's'}</span>
          <span>{hostedAttachedClientCount(session)} attached client{hostedAttachedClientCount(session) === 1 ? '' : 's'}</span>
        </div>
        {terminationLabel && <span className="hosted-session-row__termination">{terminationLabel}</span>}
      </button>
    </li>
  );
}

// ─── Detail / attach view ───────────────────────────────────────────────────

function HostedSessionDetail({
  session,
  history,
  liveMessages,
  liveText,
  activeToolCalls,
  attaching,
  attachError,
  onLeave,
}: {
  session: HostedSessionRecord | null;
  history: readonly HostedSessionHistoryMessage[];
  liveMessages: readonly HostedLiveMessage[];
  liveText: string;
  activeToolCalls: readonly HostedActiveToolCall[];
  attaching: boolean;
  attachError: string | null;
  onLeave: () => void;
}) {
  if (attaching) {
    return (
      <section className="hosted-session-detail">
        <SkeletonBlock />
      </section>
    );
  }

  if (attachError || !session) {
    return (
      <section className="hosted-session-detail">
        <ErrorState error={attachError ?? 'Could not attach to this session.'} title="Could not attach" />
      </section>
    );
  }

  const closed = session.status === 'terminated';
  const canSteer = !closed;

  return (
    <section className="hosted-session-detail">
      <header className="hosted-session-detail__header">
        <div>
          <h3>{session.title || session.id}</h3>
          <p className="hosted-session-detail__workspace">{session.workspaceRoot}</p>
        </div>
        <button type="button" className="secondary-button" onClick={onLeave}>
          <LogOut size={14} aria-hidden="true" /> Leave
        </button>
      </header>

      <p className="hosted-session-detail__policy-note">{effectiveDetachPolicyLabel(session.effectiveDetachPolicy)}</p>

      {closed && (
        <p className="hosted-session-detail__terminated" role="status">
          {hostedTerminationLabel(session) ?? 'terminated'}
        </p>
      )}

      <ul className="hosted-session-transcript" aria-label="Transcript">
        {history.map((message, index) => (
          <li key={`history-${String(index)}`} className={`hosted-session-message hosted-session-message--${message.role}`}>
            <span className="hosted-session-message__role">{message.role}</span>
            <p className="hosted-session-message__content">{message.content}</p>
          </li>
        ))}
        {liveMessages.map((message, index) => (
          <li key={`live-${String(index)}`} className={`hosted-session-message hosted-session-message--${message.role}`}>
            <span className="hosted-session-message__role">{message.role}</span>
            <p className="hosted-session-message__content">{message.content}</p>
          </li>
        ))}
        {liveText && (
          <li className="hosted-session-message hosted-session-message--assistant hosted-session-message--streaming">
            <span className="hosted-session-message__role">assistant · streaming</span>
            <p className="hosted-session-message__content">{liveText}</p>
          </li>
        )}
      </ul>

      {activeToolCalls.length > 0 && (
        <ul className="hosted-session-tool-activity" aria-label="Running tools">
          {activeToolCalls.map((call) => (
            <li key={call.callId} className="hosted-session-tool-activity__item">
              Running: {call.tool}
            </li>
          ))}
        </ul>
      )}

      <SteerComposer sessionId={session.id} canSteer={canSteer} closed={closed} />
    </section>
  );
}
