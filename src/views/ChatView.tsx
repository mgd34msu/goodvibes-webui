import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Send, XCircle } from 'lucide-react';
import { forSession, sdk, WEBUI_SURFACE_ID, WEBUI_SURFACE_KIND } from '../lib/goodvibes';
import { queryKeys } from '../lib/queries';
import { asRecord, bestId, bestStatus, bestTitle, compactJson, firstArray, firstString, readPath } from '../lib/object';
import { modelOptionsFromProvider, providerOptionsFromResponse } from '../lib/provider-models';
import { shouldSubmitComposerKey } from '../lib/composer-keys';
import { followUpDisposition } from '../lib/session-followup';
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

function followUpSummary(result: unknown): string {
  const mode = firstString(result, ['mode']) || 'accepted';
  const agentId = firstString(result, ['agentId']);
  const inputState = firstString(readPath(result, ['input']), ['state', 'status']);
  return [mode, inputState, agentId].filter(Boolean).join(' · ');
}

function activeInput(items: unknown[]): unknown {
  return items.find((input) => ['queued', 'submitted', 'spawned', 'running', 'pending'].includes(bestStatus(input)));
}

const ACTIVE_TURN_STATES = ['sending', 'submitted', 'queued', 'running', 'streaming'];

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
  const [lastFollowUp, setLastFollowUp] = useState<unknown>(null);
  const [lastRouting, setLastRouting] = useState<unknown>(null);

  const sessions = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () => sdk.operator.sessions.list(),
  });

  const providers = useQuery({
    queryKey: queryKeys.providers,
    queryFn: () => sdk.operator.providers.list(),
  });

  const sessionItems = useMemo(() => firstArray(sessions.data, ['sessions', 'items', 'data']), [sessions.data]);
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

  async function invalidateSessionState(sessionId: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['sessions', sessionId, 'messages'] }),
      queryClient.invalidateQueries({ queryKey: ['sessions', sessionId, 'inputs'] }),
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
    queryKey: ['sessions', activeSessionId, 'messages'],
    enabled: Boolean(activeSessionId),
    queryFn: () => sdk.operator.sessions.messages.list(activeSessionId),
    refetchInterval: ACTIVE_TURN_STATES.includes(turnState) ? 1500 : false,
  });

  const inputs = useQuery({
    queryKey: ['sessions', activeSessionId, 'inputs'],
    enabled: Boolean(activeSessionId),
    queryFn: () => sdk.operator.sessions.inputs.list(activeSessionId),
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
    const unsubs: Array<() => void> = [];
    setLiveText('');

    try {
      const sessionEvents = forSession(sdk.realtime.viaSse(), activeSessionId) as unknown as Record<string, {
        onEnvelope?: (name: string, handler: (event: unknown) => void) => () => void;
      }>;
      const turn = sessionEvents.turn ?? {};
      const bind = (name: string, handler: (event: unknown) => void) => {
        const unsub = turn.onEnvelope?.(name, handler);
        if (unsub) unsubs.push(unsub);
      };

      bind('TURN_SUBMITTED', () => {
        setTurnState('running');
        void invalidateSessionState(activeSessionId);
      });
      bind('STREAM_DELTA', (event) => {
        const content = firstString(readPath(event, ['payload']), ['content', 'text', 'delta']);
        if (content) setLiveText((current) => current + content);
        setTurnState('streaming');
      });
      bind('TURN_COMPLETED', () => {
        setTurnState('completed');
        setLiveText('');
        void invalidateSessionState(activeSessionId);
      });
      bind('TURN_ERROR', (event) => {
        setTurnState(firstString(readPath(event, ['payload']), ['error', 'reason', 'message']) || 'error');
        void invalidateSessionState(activeSessionId);
      });
      bind('TURN_CANCEL', (event) => {
        setTurnState(firstString(readPath(event, ['payload']), ['reason']) || 'cancelled');
        void invalidateSessionState(activeSessionId);
      });
      bind('PREFLIGHT_FAIL', (event) => {
        setTurnState(firstString(readPath(event, ['payload']), ['reason']) || 'preflight failed');
        void invalidateSessionState(activeSessionId);
      });
    } catch (err) {
      setTurnState(err instanceof Error ? err.message : String(err));
    }

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [activeSessionId, queryClient]);

  const send = useMutation({
    mutationFn: async (body: string) => {
      if (!body) return;
      setTurnState('sending');
      setLastFollowUp(null);
      setLastRouting(null);

      let sessionId = activeSessionId;
      if (!sessionId) {
        const created = await sdk.operator.sessions.create({
          title: body.slice(0, 72),
          surfaceKind: WEBUI_SURFACE_KIND,
          surfaceId: WEBUI_SURFACE_ID,
        });
        sessionId = extractSessionId(created);
        setActiveSessionId(sessionId);
        setDraftSessionRequested(false);
      }

      const registryKey = selectedModel?.registryKey ?? '';
      const routingProviderId = registryKey.includes(':') ? registryKey.split(':', 1)[0] : '';
      const routing = routingProviderId && registryKey
        ? {
          providerId: routingProviderId,
          modelId: registryKey,
          providerSelection: 'concrete',
        }
        : undefined;
      const payload = {
        body,
        surfaceKind: WEBUI_SURFACE_KIND,
        surfaceId: WEBUI_SURFACE_ID,
        ...(routing ? { routing } : {}),
      };

      const result = await sdk.operator.sessions.followUp({ sessionId, ...payload });
      const disposition = followUpDisposition(result);
      if (disposition.state === 'rejected') {
        throw Object.assign(new Error(disposition.error || 'Session input was rejected'), { body: result });
      }
      setLastFollowUp(result);
      setLastRouting(routing ?? null);
      setDraft('');
      setLiveText('');
      setTurnState(disposition.state);
      await invalidateSessionState(sessionId);
    },
    onError: () => setTurnState('send failed'),
  });

  const cancelInput = useMutation({
    mutationFn: async () => {
      const queuedInput = inputItems.find((input) => firstString(input, ['status', 'state']) === 'queued');
      const inputId = bestId(queuedInput);
      if (activeSessionId && inputId) await sdk.operator.sessions.inputs.cancel(activeSessionId, inputId);
    },
    onSuccess: () => setTurnState('cancel requested'),
  });

  const messageItems = firstArray(messages.data, ['messages', 'items', 'data']);
  const inputItems = firstArray(inputs.data, ['inputs', 'items', 'data']);
  const queuedInput = inputItems.find((input) => firstString(input, ['status', 'state']) === 'queued');
  const currentInput = activeInput(inputItems);
  const followUpDebug = lastFollowUp ? {
    followUp: lastFollowUp,
    routing: lastRouting,
    currentInput,
    inputs: inputItems,
  } : null;

  function startNewSession() {
    setActiveSessionId('');
    setDraftSessionRequested(true);
    setLiveText('');
    setTurnState('idle');
    setLastFollowUp(null);
    setLastRouting(null);
    if (typeof window !== 'undefined') window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function selectSession(sessionId: string) {
    setDraftSessionRequested(false);
    setActiveSessionId(sessionId);
    setLiveText('');
    setTurnState('idle');
    setLastFollowUp(null);
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
        <RecordList items={sessionItems} selectedId={activeSessionId} onSelect={selectSession} empty="No sessions" />
      </aside>

      <section className="chat-surface">
        <header className="chat-header">
          <div>
            <h2>{activeSessionId ? bestTitle(sessionItems.find((item) => bestId(item) === activeSessionId), activeSessionId) : 'New session'}</h2>
            <span>{activeSessionId || 'Draft'}</span>
          </div>
          <div className="chat-status">
            <StatusBadge value={turnState} />
            <button
              className="icon-button"
              type="button"
              title="Cancel queued input"
              disabled={!queuedInput || cancelInput.isPending}
              onClick={() => void cancelInput.mutate()}
            >
              <XCircle size={17} />
            </button>
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
          {(Boolean(lastFollowUp) || Boolean(currentInput)) && (
            <div className="turn-inspector">
              {Boolean(lastFollowUp) && <span>follow-up {followUpSummary(lastFollowUp)}</span>}
              {Boolean(currentInput) && <span>input {bestId(currentInput)} · {bestStatus(currentInput)}</span>}
              {followUpDebug && (
                <details>
                  <summary>Daemon receipt</summary>
                  <pre>{compactJson(followUpDebug)}</pre>
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
