import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Send } from 'lucide-react';
import { sdk } from '../lib/goodvibes';
import { queryKeys } from '../lib/queries';
import { asRecord, bestId, bestTitle, compactJson, firstArray, firstString, readPath } from '../lib/object';
import { modelOptionsFromProvider, providerOptionsFromResponse } from '../lib/provider-models';
import { shouldSubmitComposerKey } from '../lib/composer-keys';
import { RecordList } from '../components/RecordList';
import { StatusBadge } from '../components/StatusBadge';
import { formatError } from '../lib/errors';

function extractSessionId(value: unknown): string {
  const direct = bestId(value);
  if (direct) return direct;
  return firstString(readPath(value, ['session']), ['id', 'sessionId'])
    || firstString(readPath(value, ['data']), ['id', 'sessionId']);
}

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

function messageReceiptSummary(result: unknown): string {
  const messageId = firstString(result, ['messageId']) || firstString(readPath(result, ['message']), ['id']);
  return messageId ? `message ${messageId}` : 'accepted';
}

interface CompanionRoute {
  provider: string;
  model: string;
}

function companionRouteFromRegistryKey(registryKey: string): CompanionRoute | null {
  const separator = registryKey.indexOf(':');
  if (separator <= 0 || separator === registryKey.length - 1) return null;
  return {
    provider: registryKey.slice(0, separator),
    model: registryKey.slice(separator + 1),
  };
}

function isCompanionChatSession(session: unknown): boolean {
  return firstString(session, ['kind']) === 'companion-chat';
}

function companionEventType(eventName: string, payload: unknown): string {
  return firstString(payload, ['type']) || eventName.replace(/^companion-chat\./, '');
}

const ACTIVE_TURN_STATES = ['sending', 'submitted', 'running', 'streaming', 'tooling'];

export function ChatView() {
  const queryClient = useQueryClient();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [draftSessionRequested, setDraftSessionRequested] = useState(false);
  const [draft, setDraft] = useState('');
  const [providerId, setProviderId] = useState('');
  const [modelId, setModelId] = useState('');
  const [liveText, setLiveText] = useState('');
  const [turnState, setTurnState] = useState('idle');
  const [lastMessageReceipt, setLastMessageReceipt] = useState<unknown>(null);
  const [lastRouting, setLastRouting] = useState<unknown>(null);

  const sessions = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () => sdk.operator.sessions.list(),
  });

  const providers = useQuery({
    queryKey: queryKeys.providers,
    queryFn: () => sdk.operator.providers.list(),
  });

  const allSessionItems = useMemo(() => firstArray(sessions.data, ['sessions', 'items', 'data']), [sessions.data]);
  const sessionItems = useMemo(
    () => allSessionItems.filter(isCompanionChatSession),
    [allSessionItems],
  );
  const providerOptions = useMemo(() => providerOptionsFromResponse(providers.data), [providers.data]);
  const selectedProvider = useMemo(
    () => providerOptions.find((provider) => provider.id === providerId),
    [providerId, providerOptions],
  );
  const modelOptions = useMemo(
    () => modelOptionsFromProvider(selectedProvider?.value),
    [selectedProvider],
  );
  const selectedModel = useMemo(
    () => modelOptions.find((model) => model.id === modelId),
    [modelId, modelOptions],
  );

  async function invalidateChatState(sessionId: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['companion-chat', sessionId, 'messages'] }),
      queryClient.invalidateQueries({ queryKey: ['companion-chat', sessionId] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
    ]);
  }

  useEffect(() => {
    if (!activeSessionId && !draftSessionRequested && sessionItems.length) setActiveSessionId(bestId(sessionItems[0]));
  }, [activeSessionId, draftSessionRequested, sessionItems]);

  useEffect(() => {
    if (!providerId && providerOptions.length === 1) {
      setProviderId(providerOptions[0].id);
    }
  }, [providerId, providerOptions]);

  useEffect(() => {
    if (!providerId) {
      setModelId('');
      return;
    }
    if (!modelOptions.length) {
      setModelId('');
      return;
    }
    if (!modelOptions.some((model) => model.id === modelId)) {
      setModelId(modelOptions[0].id);
    }
  }, [modelId, modelOptions, providerId]);

  const messages = useQuery({
    queryKey: ['companion-chat', activeSessionId, 'messages'],
    enabled: Boolean(activeSessionId),
    queryFn: () => sdk.chat.messages.list(activeSessionId),
    refetchInterval: ACTIVE_TURN_STATES.includes(turnState) ? 1500 : false,
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
          if (delta) setLiveText((current) => current + delta);
          setTurnState('streaming');
          return;
        }

        if (type === 'turn.tool_call' || type === 'turn.tool_result') {
          setTurnState('tooling');
          return;
        }

        if (type === 'turn.completed') {
          setTurnState('completed');
          setLiveText('');
          void invalidateChatState(activeSessionId);
          return;
        }

        if (type === 'turn.error') {
          setTurnState(firstString(payload, ['error']) || 'error');
          void invalidateChatState(activeSessionId);
        }
      },
      onError: (error) => {
        setTurnState(error instanceof Error ? error.message : String(error));
      },
    }).then((nextDisconnect) => {
      if (closed) {
        nextDisconnect();
        return;
      }
      disconnect = nextDisconnect;
    }).catch((err) => {
      if (!closed) setTurnState(err instanceof Error ? err.message : String(err));
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
      setLastMessageReceipt(null);
      setLastRouting(null);

      const route = companionRouteFromRegistryKey(selectedModel?.registryKey ?? '');
      let messageRoute: CompanionRoute | null = null;
      let sessionId = activeSessionId;
      if (!sessionId) {
        const created = await sdk.chat.sessions.create({
          title: body.slice(0, 72),
          ...(route ?? {}),
        });
        sessionId = extractSessionId(created);
        messageRoute = route;
        setActiveSessionId(sessionId);
        setDraftSessionRequested(false);
      }

      const result = await sdk.chat.messages.create(sessionId, { body });
      setLastMessageReceipt(result);
      setLastRouting(messageRoute);
      setDraft('');
      setLiveText('');
      setTurnState('submitted');
      await invalidateChatState(sessionId);
    },
    onError: () => setTurnState('send failed'),
  });

  const messageItems = firstArray(messages.data, ['messages', 'items', 'data']);

  useEffect(() => {
    if (!ACTIVE_TURN_STATES.includes(turnState) || liveText) return;
    const lastMessage = messageItems.at(-1);
    if (lastMessage && messageTone(lastMessage) === 'assistant') setTurnState('completed');
  }, [liveText, messageItems, turnState]);

  const messageDebug = lastMessageReceipt ? {
    messageReceipt: lastMessageReceipt,
    routing: lastRouting,
  } : null;

  function startNewSession() {
    setActiveSessionId('');
    setDraftSessionRequested(true);
    setLiveText('');
    setTurnState('idle');
    setLastMessageReceipt(null);
    setLastRouting(null);
    if (typeof window !== 'undefined') window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function selectSession(sessionId: string) {
    setDraftSessionRequested(false);
    setActiveSessionId(sessionId);
    setLiveText('');
    setTurnState('idle');
    setLastMessageReceipt(null);
    setLastRouting(null);
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
            <h2>{activeSessionId ? bestTitle(sessionItems.find((item) => bestId(item) === activeSessionId), activeSessionId) : 'New session'}</h2>
            <span>{activeSessionId || 'Draft'}</span>
          </div>
          <div className="chat-status">
            <StatusBadge value={turnState} />
          </div>
        </header>

        <div className="messages">
          {messageItems.map((message, index) => (
            <article key={`${bestId(message)}-${index}`} className={`message ${messageTone(message)}`}>
              <div className="message-meta">
                <strong>{roleOf(message)}</strong>
                <span>{firstString(message, ['createdAt', 'timestamp', 'time'])}</span>
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
          {!messageItems.length && !liveText && <p className="empty-state">No messages</p>}
        </div>

        <form className="composer" onSubmit={submit}>
          {send.error && <div className="composer-error">{formatError(send.error)}</div>}
          {Boolean(lastMessageReceipt) && (
            <div className="turn-inspector">
              <span>accepted {messageReceiptSummary(lastMessageReceipt)}</span>
              {messageDebug && (
                <details>
                  <summary>Daemon receipt</summary>
                  <pre>{compactJson(messageDebug)}</pre>
                </details>
              )}
            </div>
          )}
          <div className="routing-row">
            <select
              value={providerId}
              onChange={(event) => {
                setProviderId(event.target.value);
                setModelId('');
              }}
              aria-label="Provider"
            >
              <option value="">Provider default</option>
              {providerOptions.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.label}</option>
              ))}
            </select>
            <select
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              aria-label="Model"
              disabled={!providerId || !modelOptions.length}
            >
              <option value="">{providerId ? 'Model' : 'Select provider first'}</option>
              {modelOptions.map((model) => {
                const label = model.registryKey === model.label ? model.label : `${model.label} (${model.registryKey})`;
                return <option key={model.id} value={model.id}>{label}</option>;
              })}
            </select>
          </div>
          {providerId && !modelOptions.length && (
            <p className="routing-note">This provider did not report selectable models. The daemon default will be used.</p>
          )}
          {activeSessionId && selectedModel && (
            <p className="routing-note">Provider and model selection applies when creating a new chat session.</p>
          )}
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
