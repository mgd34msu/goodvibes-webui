import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PauseCircle, Plus, Send, XCircle } from 'lucide-react';
import { forSession, sdk, WEBUI_SURFACE_ID, WEBUI_SURFACE_KIND } from '../lib/goodvibes';
import { queryKeys } from '../lib/queries';
import { asRecord, bestId, bestTitle, firstArray, firstString, readPath } from '../lib/object';
import { modelOptionsFromProvider, providerOptionsFromResponse } from '../lib/provider-models';
import { RecordList } from '../components/RecordList';
import { StatusBadge } from '../components/StatusBadge';

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

export function ChatView() {
  const queryClient = useQueryClient();
  const [activeSessionId, setActiveSessionId] = useState('');
  const [draft, setDraft] = useState('');
  const [providerId, setProviderId] = useState('');
  const [modelId, setModelId] = useState('');
  const [liveText, setLiveText] = useState('');
  const [turnState, setTurnState] = useState('idle');

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

  useEffect(() => {
    if (!activeSessionId && sessionItems.length) setActiveSessionId(bestId(sessionItems[0]));
  }, [activeSessionId, sessionItems]);

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
  });

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

      bind('STREAM_DELTA', (event) => {
        const content = firstString(readPath(event, ['payload']), ['content', 'text', 'delta']);
        if (content) setLiveText((current) => current + content);
        setTurnState('streaming');
      });
      bind('TURN_COMPLETED', () => {
        setTurnState('completed');
        setLiveText('');
        void queryClient.invalidateQueries({ queryKey: ['sessions', activeSessionId, 'messages'] });
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      });
      bind('TURN_ERROR', (event) => {
        setTurnState(firstString(readPath(event, ['payload']), ['error', 'reason', 'message']) || 'error');
        void queryClient.invalidateQueries({ queryKey: ['sessions', activeSessionId, 'messages'] });
      });
      bind('TURN_CANCEL', (event) => {
        setTurnState(firstString(readPath(event, ['payload']), ['reason']) || 'cancelled');
      });
      bind('PREFLIGHT_FAIL', (event) => {
        setTurnState(firstString(readPath(event, ['payload']), ['reason']) || 'preflight failed');
      });
    } catch (err) {
      setTurnState(err instanceof Error ? err.message : String(err));
    }

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [activeSessionId, queryClient]);

  const send = useMutation({
    mutationFn: async () => {
      const body = draft.trim();
      if (!body) return;

      let sessionId = activeSessionId;
      if (!sessionId) {
        const created = await sdk.operator.sessions.create({
          title: body.slice(0, 72),
          surfaceKind: WEBUI_SURFACE_KIND,
          surfaceId: WEBUI_SURFACE_ID,
        });
        sessionId = extractSessionId(created);
        setActiveSessionId(sessionId);
      }

      const routing = providerId && modelId ? { providerId, modelId } : undefined;
      const payload = {
        body,
        surfaceKind: WEBUI_SURFACE_KIND,
        surfaceId: WEBUI_SURFACE_ID,
        ...(routing ? { routing } : {}),
      };

      try {
        await sdk.operator.invoke('sessions.followUp', { sessionId, ...payload });
      } catch {
        await sdk.operator.sessions.messages.create(sessionId, payload);
      }
      setDraft('');
      setLiveText('');
      setTurnState('queued');
      await queryClient.invalidateQueries({ queryKey: ['sessions', sessionId, 'messages'] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
  });

  const cancelInput = useMutation({
    mutationFn: async () => {
      const inputs = firstArray(messages.data, ['inputs']);
      const activeInput = inputs.find((input) => firstString(input, ['status', 'state']) === 'running' || firstString(input, ['status', 'state']) === 'queued');
      const inputId = bestId(activeInput);
      if (activeSessionId && inputId) await sdk.operator.sessions.inputs.cancel(activeSessionId, inputId);
    },
    onSuccess: () => setTurnState('cancel requested'),
  });

  const messageItems = firstArray(messages.data, ['messages', 'items', 'data']);

  function submit(event: FormEvent) {
    event.preventDefault();
    void send.mutate();
  }

  return (
    <div className="chat-layout">
      <aside className="side-panel">
        <div className="panel-title">
          <h2>Sessions</h2>
          <button className="icon-button" type="button" title="New session" onClick={() => setActiveSessionId('')}>
            <Plus size={17} />
          </button>
        </div>
        <RecordList items={sessionItems} selectedId={activeSessionId} onSelect={setActiveSessionId} empty="No sessions" />
      </aside>

      <section className="chat-surface">
        <header className="chat-header">
          <div>
            <h2>{activeSessionId ? bestTitle(sessionItems.find((item) => bestId(item) === activeSessionId), activeSessionId) : 'New session'}</h2>
            <span>{activeSessionId || 'Draft'}</span>
          </div>
          <div className="chat-status">
            <StatusBadge value={turnState} />
            <button className="icon-button" type="button" title="Cancel active input" onClick={() => void cancelInput.mutate()}>
              <XCircle size={17} />
            </button>
          </div>
        </header>

        <div className="messages">
          {messageItems.map((message, index) => (
            <article key={`${bestId(message)}-${index}`} className={`message ${roleOf(message)}`}>
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
                const label = model.id === model.label ? model.label : `${model.label} (${model.id})`;
                return <option key={model.id} value={model.id}>{label}</option>;
              })}
            </select>
          </div>
          {providerId && !modelOptions.length && (
            <p className="routing-note">This provider did not report selectable models. The daemon default will be used.</p>
          )}
          <div className="composer-row">
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Message GoodVibes" />
            <button type="submit" className="primary-button" disabled={send.isPending || !draft.trim()}>
              {send.isPending ? <PauseCircle size={18} /> : <Send size={18} />}
              Send
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
