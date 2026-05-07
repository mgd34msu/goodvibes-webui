import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Send } from 'lucide-react';
import { sdk } from '../lib/goodvibes';
import { asRecord, bestId, bestTitle, firstArray, firstString, formatRelative } from '../lib/object';
import { shouldSubmitComposerKey } from '../lib/composer-keys';
import { RecordList } from '../components/RecordList';
import { StatusBadge } from '../components/StatusBadge';
import { formatError } from '../lib/errors';
import {
  companionSessionFromDetail,
  extractMessageId,
  extractSessionId,
  loadRecentCompanionSessionIds,
  mergeCompanionMessages,
  mergeCompanionSessions,
  LocalCompanionMessage,
  LocalCompanionSession,
  prependRecentCompanionSessionId,
  removeRecentCompanionSessionIds,
  saveRecentCompanionSessionIds,
} from '../lib/companion-chat';

function messageText(message: unknown): string {
  const direct = firstString(message, ['body', 'content', 'text', 'message', 'delta']);
  if (direct) return direct;
  const parts = firstArray(message, ['parts', 'content']);
  return parts.map((part) => firstString(part, ['text', 'content', 'body'])).filter(Boolean).join('\n');
}

function roleOf(message: unknown): string {
  return firstString(message, ['role', 'author', 'kind', 'source']) || 'message';
}

function messageTone(message: unknown): string {
  const role = roleOf(message).toLowerCase();
  if (role.includes('user')) return 'user';
  if (role.includes('assistant') || role.includes('agent') || role.includes('model')) return 'assistant';
  if (role.includes('system')) return 'system';
  return 'neutral';
}

function messageTimestamp(message: unknown): string {
  const record = asRecord(message);
  return formatRelative(record.createdAt ?? record.timestamp ?? record.time);
}

function messageCreatedAt(message: unknown): number {
  const record = asRecord(message);
  if (typeof record.createdAt === 'number') return record.createdAt;
  if (typeof record.timestamp === 'number') return record.timestamp;
  if (typeof record.time === 'number') return record.time;
  return 0;
}

function assistantContentFromCompletedTurn(payload: unknown, fallback: string): string {
  const envelope = asRecord(asRecord(payload).envelope);
  return firstString(envelope, ['body', 'content', 'text', 'message'])
    || firstString(payload, ['body', 'content', 'text', 'message', 'response'])
    || fallback;
}

function companionEventType(eventName: string, payload: unknown): string {
  return firstString(payload, ['type']) || eventName.replace(/^companion-chat\./, '');
}

const ACTIVE_TURN_STATES = ['sending', 'submitted', 'running', 'streaming', 'tooling'];

export function ChatView() {
  const queryClient = useQueryClient();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const liveTextRef = useRef('');
  const [activeSessionId, setActiveSessionId] = useState('');
  const [draftSessionRequested, setDraftSessionRequested] = useState(false);
  const [draft, setDraft] = useState('');
  const [liveText, setLiveText] = useState('');
  const [turnState, setTurnState] = useState('idle');
  const [turnError, setTurnError] = useState('');
  const [localMessages, setLocalMessages] = useState<LocalCompanionMessage[]>([]);
  const [localSessions, setLocalSessions] = useState<LocalCompanionSession[]>([]);
  const [pendingUserMessageId, setPendingUserMessageId] = useState('');
  const [recentSessionIds, setRecentSessionIds] = useState<string[]>(() => (
    typeof window === 'undefined' ? [] : loadRecentCompanionSessionIds(window.localStorage)
  ));

  const chatSessions = useQuery({
    queryKey: ['companion-chat', 'sessions', recentSessionIds],
    enabled: recentSessionIds.length > 0,
    queryFn: async () => {
      const results = await Promise.allSettled(
        recentSessionIds.map((sessionId) => sdk.chat.sessions.get(sessionId)),
      );
      const missingSessionIds: string[] = [];
      const items = results.flatMap((result, index) => {
        if (result.status === 'fulfilled') return [companionSessionFromDetail(result.value)];
        missingSessionIds.push(recentSessionIds[index]);
        return [];
      });
      return { items, missingSessionIds };
    },
  });

  const sessionItems = useMemo(
    () => mergeCompanionSessions(localSessions, chatSessions.data?.items ?? [], recentSessionIds),
    [chatSessions.data, localSessions, recentSessionIds],
  );

  const rememberSession = useCallback((sessionId: string) => {
    setRecentSessionIds((current) => {
      const next = prependRecentCompanionSessionId(current, sessionId);
      if (next === current) return current;
      if (typeof window !== 'undefined') saveRecentCompanionSessionIds(window.localStorage, next);
      return next;
    });
  }, []);

  async function invalidateChatState(sessionId: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['companion-chat', sessionId, 'messages'] }),
      queryClient.invalidateQueries({ queryKey: ['companion-chat', sessionId] }),
      queryClient.invalidateQueries({ queryKey: ['companion-chat', 'sessions'] }),
    ]);
  }

  useEffect(() => {
    const missingSessionIds = chatSessions.data?.missingSessionIds ?? [];
    if (!missingSessionIds.length) return;
    setRecentSessionIds((current) => {
      const next = removeRecentCompanionSessionIds(current, missingSessionIds);
      if (next.length === current.length) return current;
      if (typeof window !== 'undefined') saveRecentCompanionSessionIds(window.localStorage, next);
      return next;
    });
  }, [chatSessions.data]);

  useEffect(() => {
    if (!activeSessionId && !draftSessionRequested && sessionItems.length) setActiveSessionId(bestId(sessionItems[0]));
  }, [activeSessionId, draftSessionRequested, sessionItems]);

  const messages = useQuery({
    queryKey: ['companion-chat', activeSessionId, 'messages'],
    enabled: Boolean(activeSessionId),
    queryFn: () => sdk.chat.messages.list(activeSessionId),
    refetchInterval: ACTIVE_TURN_STATES.includes(turnState) || turnState === 'syncing' ? 1000 : false,
  });

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = '0px';
    composer.style.height = `${Math.min(Math.max(composer.scrollHeight, 44), 140)}px`;
  }, [draft]);

  useEffect(() => {
    if (!activeSessionId) return undefined;
    let closed = false;
    let disconnect: (() => void) | undefined;
    setLiveText('');
    liveTextRef.current = '';
    setTurnError('');

    void sdk.chat.events.stream(activeSessionId, {
      onEvent: (eventName, payload) => {
        if (!eventName.startsWith('companion-chat.')) return;
        if (firstString(payload, ['sessionId']) !== activeSessionId) return;
        const type = companionEventType(eventName, payload);

        if (type === 'turn.started') {
          setTurnState('running');
          void invalidateChatState(activeSessionId);
          return;
        }

        if (type === 'turn.delta') {
          const delta = firstString(payload, ['delta']);
          if (delta) {
            liveTextRef.current += delta;
            setLiveText((current) => current + delta);
          }
          setTurnState('streaming');
          return;
        }

        if (type === 'turn.tool_call' || type === 'turn.tool_result') {
          setTurnState('tooling');
          return;
        }

        if (type === 'turn.completed') {
          const assistantContent = assistantContentFromCompletedTurn(payload, liveTextRef.current);
          if (assistantContent) {
            setLocalMessages((current) => [
              ...current,
              {
                id: firstString(payload, ['assistantMessageId', 'messageId']) || `assistant-${firstString(payload, ['turnId']) || Date.now()}`,
                sessionId: activeSessionId,
                role: 'assistant',
                content: assistantContent,
                createdAt: Date.now(),
              },
            ]);
            setPendingUserMessageId('');
            setTurnState('completed');
          } else {
            setTurnState('syncing');
          }
          setLiveText('');
          liveTextRef.current = '';
          void invalidateChatState(activeSessionId);
          return;
        }

        if (type === 'turn.error') {
          setTurnState('error');
          setTurnError(firstString(payload, ['error']) || 'Companion chat turn failed.');
          void invalidateChatState(activeSessionId);
        }
      },
      onError: (error) => {
        setTurnState('stream error');
        setTurnError(error instanceof Error ? error.message : String(error));
      },
    }).then((nextDisconnect) => {
      if (closed) {
        nextDisconnect();
        return;
      }
      disconnect = nextDisconnect;
    }).catch((err) => {
      if (!closed) {
        setTurnState('stream error');
        setTurnError(err instanceof Error ? err.message : String(err));
      }
    });

    return () => {
      closed = true;
      disconnect?.();
    };
  }, [activeSessionId, queryClient]);

  const send = useMutation({
    mutationFn: async (body: string) => {
      if (!body) return;
      setTurnState('sending');
      setTurnError('');

      let sessionId = activeSessionId;
      if (!sessionId) {
        const createdAt = Date.now();
        const created = await sdk.chat.sessions.create({
          title: body.slice(0, 72),
        });
        sessionId = extractSessionId(created);
        setLocalSessions((current) => [
          {
            id: sessionId,
            sessionId,
            kind: 'companion-chat',
            title: body.slice(0, 72) || sessionId,
            status: 'active',
            createdAt,
            updatedAt: createdAt,
          },
          ...current.filter((session) => session.id !== sessionId),
        ]);
        setActiveSessionId(sessionId);
        rememberSession(sessionId);
        setDraftSessionRequested(false);
      }

      const result = await sdk.chat.messages.create(sessionId, { body });
      const messageId = extractMessageId(result);
      setLocalMessages((current) => [
        ...current,
        {
        id: messageId || `local-${Date.now()}`,
        sessionId,
        role: 'user',
        content: body,
        createdAt: Date.now(),
        },
      ]);
      setPendingUserMessageId(messageId);
      setDraft('');
      setLiveText('');
      setTurnState('submitted');
      await invalidateChatState(sessionId);
    },
    onError: (error) => {
      setTurnState('send failed');
      setTurnError(formatError(error));
    },
  });

  const messageItems = firstArray(messages.data, ['messages', 'items', 'data']);
  const renderedMessageItems = useMemo(
    () => mergeCompanionMessages(messageItems, localMessages, activeSessionId),
    [activeSessionId, localMessages, messageItems],
  );

  useEffect(() => {
    if ((!ACTIVE_TURN_STATES.includes(turnState) && turnState !== 'syncing') || liveText) return;
    const lastMessage = renderedMessageItems.at(-1);
    if (lastMessage && messageTone(lastMessage) === 'assistant') {
      setPendingUserMessageId('');
      setTurnState('completed');
    }
  }, [liveText, renderedMessageItems, turnState]);

  useEffect(() => {
    if (!pendingUserMessageId || turnError) return;
    const pendingUser = renderedMessageItems.find((message) => bestId(message) === pendingUserMessageId);
    const pendingCreatedAt = messageCreatedAt(pendingUser);
    const hasAssistantReply = renderedMessageItems.some((message) => (
      messageTone(message) === 'assistant' && messageCreatedAt(message) >= pendingCreatedAt
    ));
    if (hasAssistantReply) {
      setPendingUserMessageId('');
      setTurnState('completed');
    }
  }, [pendingUserMessageId, renderedMessageItems, turnError]);

  function startNewSession() {
    setActiveSessionId('');
    setDraftSessionRequested(true);
    setLiveText('');
    setTurnState('idle');
    setTurnError('');
    setPendingUserMessageId('');
    if (typeof window !== 'undefined') window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function selectSession(sessionId: string) {
    setDraftSessionRequested(false);
    setActiveSessionId(sessionId);
    rememberSession(sessionId);
    setLiveText('');
    setTurnState('idle');
    setTurnError('');
    setPendingUserMessageId('');
  }

  function submitDraft() {
    if (send.isPending || !draft.trim()) return;
    send.mutate(draft.trim());
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    submitDraft();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!shouldSubmitComposerKey(event)) return;
    event.preventDefault();
    submitDraft();
  }

  return (
    <div className="chat-layout">
      <aside className="side-panel">
        <div className="panel-title">
          <h2>Sessions</h2>
          <button className="icon-button" type="button" title="New session" onClick={startNewSession}>
            <Plus size={17} />
          </button>
        </div>
        <RecordList items={sessionItems} selectedId={activeSessionId} onSelect={selectSession} empty="No chat sessions" />
      </aside>

      <section className="chat-surface">
        <header className="chat-header">
          <div>
            <h2>{activeSessionId ? bestTitle(sessionItems.find((item) => bestId(item) === activeSessionId), 'Chat') : 'New chat'}</h2>
          </div>
          <div className="chat-status">
            <StatusBadge value={turnState} />
          </div>
        </header>

        <div className="messages">
          {renderedMessageItems.map((message, index) => (
            <article key={`${bestId(message)}-${index}`} className={`message ${messageTone(message)}`}>
              <div className="message-meta">
                <strong>{roleOf(message)}</strong>
                <span>{messageTimestamp(message)}</span>
              </div>
              <p>{messageText(message) || JSON.stringify(asRecord(message))}</p>
            </article>
          ))}
          {liveText && (
            <article className="message assistant streaming">
              <div className="message-meta">
                <strong>assistant</strong>
                <span>streaming</span>
              </div>
              <p>{liveText}</p>
            </article>
          )}
          {!renderedMessageItems.length && !liveText && <p className="empty-state">No messages</p>}
        </div>

        <form className="composer" onSubmit={submit}>
          {send.error && <div className="composer-error">{formatError(send.error)}</div>}
          {turnError && <div className="composer-error">{turnError}</div>}
          <div className="composer-row">
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Message GoodVibes"
              aria-label="Message GoodVibes"
              rows={1}
            />
            <button type="submit" className="send-button" title="Send message" disabled={send.isPending || !draft.trim()}>
              <Send size={18} />
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
