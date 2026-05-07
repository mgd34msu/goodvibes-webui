import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, Check, Copy, Mic, Paperclip, RotateCcw, Send, X } from 'lucide-react';
import { sdk } from '../lib/goodvibes';
import { asRecord, bestId, bestTitle, firstArray, firstString, formatRelative } from '../lib/object';
import { queryKeys } from '../lib/queries';
import { modelOptionsFromProvider } from '../lib/provider-models';
import { shouldSubmitComposerKey } from '../lib/composer-keys';
import { StatusBadge } from '../components/StatusBadge';
import { formatError } from '../lib/errors';
import {
  companionSessionFromDetail,
  extractMessageId,
  extractSessionId,
  mergeCompanionMessages,
  LocalCompanionMessage,
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

function deliveryState(message: unknown): 'sent' | 'failed' | 'local' | '' {
  const state = firstString(message, ['deliveryState', 'status', 'state']).toLowerCase();
  if (state.includes('fail') || state.includes('error')) return 'failed';
  if (state.includes('local') || state.includes('pending')) return 'local';
  if (messageTone(message) === 'user') return 'sent';
  return '';
}

interface ChatViewProps {
  activeSessionId: string;
  sessionItems: unknown[];
  onActiveSessionChange: (sessionId: string) => void;
  onDraftSessionRequestedChange: (requested: boolean) => void;
  onLocalSessionCreated: (session: unknown) => void;
}

export function ChatView({
  activeSessionId,
  sessionItems,
  onActiveSessionChange,
  onDraftSessionRequestedChange,
  onLocalSessionCreated,
}: ChatViewProps) {
  const queryClient = useQueryClient();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const liveTextRef = useRef('');
  const [draft, setDraft] = useState('');
  const [liveText, setLiveText] = useState('');
  const [turnState, setTurnState] = useState('idle');
  const [turnError, setTurnError] = useState('');
  const [localMessages, setLocalMessages] = useState<LocalCompanionMessage[]>([]);
  const [pendingUserMessageId, setPendingUserMessageId] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState('');
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const modelCatalog = useQuery({ queryKey: ['models'], queryFn: () => sdk.operator.models.list() });
  const currentModel = useQuery({ queryKey: ['models', 'current'], queryFn: () => sdk.operator.models.current() });

  const modelOptions = useMemo(
    () => firstArray(modelCatalog.data, ['providers', 'items', 'data']).flatMap((provider) => modelOptionsFromProvider(provider)),
    [modelCatalog.data],
  );
  const currentRegistryKey = firstString(asRecord(asRecord(currentModel.data).model), ['registryKey'])
    || firstString(asRecord(asRecord(modelCatalog.data).currentModel), ['registryKey'])
    || '';

  const selectModel = useMutation({
    mutationFn: (registryKey: string) => sdk.operator.models.select(registryKey),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['models'] }),
        queryClient.invalidateQueries({ queryKey: ['models', 'current'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
      ]);
    },
  });

  async function invalidateChatState(sessionId: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['companion-chat', sessionId, 'messages'] }),
      queryClient.invalidateQueries({ queryKey: ['companion-chat', sessionId] }),
      queryClient.invalidateQueries({ queryKey: ['companion-chat', 'sessions'] }),
    ]);
  }

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
    setShowJumpToBottom(false);
  }, [activeSessionId]);

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
                deliveryState: 'sent',
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
        const createdSession = companionSessionFromDetail(created);
        onLocalSessionCreated(bestId(createdSession) ? createdSession : {
          id: sessionId,
          sessionId,
          kind: 'companion-chat',
          title: body.slice(0, 72) || sessionId,
          status: 'active',
          createdAt,
          updatedAt: createdAt,
        });
        onActiveSessionChange(sessionId);
        onDraftSessionRequestedChange(false);
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
          deliveryState: 'sent',
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
    const container = scrollRef.current;
    if (!container || showJumpToBottom) return;
    window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }, [activeSessionId, liveText, renderedMessageItems.length, showJumpToBottom]);

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

  function selectSession(sessionId: string) {
    if (!sessionId) {
      onDraftSessionRequestedChange(true);
      onActiveSessionChange('');
      setLiveText('');
      setTurnState('idle');
      setTurnError('');
      setPendingUserMessageId('');
      return;
    }
    onDraftSessionRequestedChange(false);
    onActiveSessionChange(sessionId);
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

  async function copyMessage(message: unknown) {
    const id = bestId(message);
    const text = messageText(message);
    if (!text) return;
    await navigator.clipboard?.writeText(text);
    setCopiedMessageId(id);
    window.setTimeout(() => setCopiedMessageId((current) => (current === id ? '' : current)), 1300);
  }

  function resendMessage(message: unknown) {
    const text = messageText(message);
    if (!text || send.isPending) return;
    send.mutate(text);
  }

  function regenerateFrom(messageIndex: number) {
    const previousUserMessage = renderedMessageItems
      .slice(0, messageIndex)
      .reverse()
      .find((message) => messageTone(message) === 'user');
    if (!previousUserMessage) return;
    resendMessage(previousUserMessage);
  }

  function handleMessagesScroll() {
    const container = scrollRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowJumpToBottom(distanceFromBottom > 180);
  }

  function scrollMessagesToBottom() {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    setShowJumpToBottom(false);
  }

  const visibleTurnState = turnState !== 'idle' && turnState !== 'completed';

  return (
      <section className="chat-main">
        <header className="chat-main-header">
          <select
            className="chat-session-select"
            value={activeSessionId}
            onChange={(event) => selectSession(event.target.value)}
            disabled={!sessionItems.length}
            aria-label="Active chat session"
          >
            {(!activeSessionId || !sessionItems.length) && <option value="">New chat</option>}
            {sessionItems.map((session, index) => {
              const id = bestId(session) || String(index);
              return <option key={`${id}-${index}`} value={id}>{bestTitle(session, id)}</option>;
            })}
          </select>
          <div className="chat-status">
            {visibleTurnState && <StatusBadge value={turnState} />}
          </div>
        </header>

        <div className="messages chat-conversation" ref={scrollRef} onScroll={handleMessagesScroll}>
          {renderedMessageItems.map((message, index) => {
            const id = bestId(message) || `${index}`;
            const tone = messageTone(message);
            const state = deliveryState(message);
            const canRetry = Boolean(messageText(message)) && (tone === 'user' || tone === 'assistant');
            const timestamp = messageTimestamp(message);
            return (
              <article key={`${id}-${index}`} className={`message ${tone}`}>
                {timestamp !== 'unknown' && (
                  <div className="message-meta">
                    <span>{timestamp}</span>
                  </div>
                )}
                <p>{messageText(message) || JSON.stringify(asRecord(message))}</p>
                <div className="message-actions">
                  {state && (
                    <span className={`delivery-indicator ${state}`} title={state === 'failed' ? 'Not sent' : state === 'local' ? 'Pending' : 'Sent'}>
                      {state === 'failed' ? <X size={12} /> : <Check size={12} />}
                    </span>
                  )}
                  <button type="button" title="Copy message" onClick={() => void copyMessage(message)}>
                    <Copy size={13} />
                  </button>
                  {canRetry && (
                    <button
                      type="button"
                      title={tone === 'assistant' ? 'Regenerate response' : 'Resend message'}
                      disabled={send.isPending}
                      onClick={() => (tone === 'assistant' ? regenerateFrom(index) : resendMessage(message))}
                    >
                      <RotateCcw size={13} />
                    </button>
                  )}
                  {copiedMessageId === id && <span className="message-action-label">copied</span>}
                </div>
              </article>
            );
          })}
          {liveText && (
            <article className="message assistant streaming">
              <div className="message-meta">
                <span>GoodVibes is responding</span>
              </div>
              <p>{liveText}</p>
            </article>
          )}
          {!renderedMessageItems.length && !liveText && <p className="empty-state">Start a chat with GoodVibes.</p>}
        </div>
        {showJumpToBottom && (
          <button type="button" className="jump-to-bottom" onClick={scrollMessagesToBottom} title="Jump to latest message">
            <ArrowDown size={16} />
          </button>
        )}

        <form className="composer" onSubmit={submit}>
          {send.error && <div className="composer-error">{formatError(send.error)}</div>}
          {turnError && <div className="composer-error">{turnError}</div>}
          <div className="composer-box">
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Message GoodVibes"
              aria-label="Message GoodVibes"
              rows={1}
            />
            <div className="composer-toolbar">
              <div className="composer-tools">
                <button
                  type="button"
                  className="composer-tool"
                  title="Chat attachments are not available in the current SDK"
                  disabled
                >
                  <Paperclip size={16} />
                </button>
                <button
                  type="button"
                  className="composer-tool"
                  title="Voice mode is not available in this WebUI build"
                  disabled
                >
                  <Mic size={16} />
                </button>
              </div>
              <div className="composer-route">
                <select
                  value={currentRegistryKey}
                  onChange={(event) => selectModel.mutate(event.target.value)}
                  disabled={!modelOptions.length || selectModel.isPending}
                  aria-label="Current daemon model"
                >
                  {!modelOptions.length && <option value="">Daemon model</option>}
                  {modelOptions.map((model) => (
                    <option key={model.registryKey} value={model.registryKey}>{model.label}</option>
                  ))}
                </select>
                <button type="submit" className="send-button" title="Send message" disabled={send.isPending || !draft.trim()}>
                  <Send size={18} />
                </button>
              </div>
            </div>
          </div>
        </form>
      </section>
  );
}
