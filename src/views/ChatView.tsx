import { ChangeEvent, FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sdk } from '../lib/goodvibes';
import { asRecord, bestId, bestTitle, firstString } from '../lib/object';
import { queryKeys } from '../lib/queries';
import { modelOptionsForProvider, providerOptionsFromResponse } from '../lib/provider-models';
import { shouldSteerComposerKey, shouldSubmitComposerKey } from '../lib/composer-keys';
import { isSessionNotFoundError, formatError } from '../lib/errors';
import {
  companionSessionFromDetail,
  companionMessagesFromListResponse,
  mergeCompanionMessages,
  LocalCompanionMessage,
} from '../lib/companion-chat';
import { SessionHeader } from './chat/SessionHeader';
import { MessageList } from './chat/MessageList';
import { Composer } from './chat/Composer';
import { ChatSearch } from './chat/ChatSearch';
import { QueuedMessagesPanel } from './chat/QueuedMessagesPanel';
import { useChatSend } from './chat/useChatSend';
import { useChatStream } from './chat/useChatStream';
import '../styles/components/chat-view.css';
import {
  ACTIVE_TURN_STATES,
  deriveChatTitle,
  messageCreatedAt,
  messageTone,
  messageText,
} from './chat/message-utils';
import { buildLineage } from './chat/lineage';
import { resolveScrollTarget, isScrollTargetReady, findMessageElement } from './chat/search-jump';
import type { ChatViewProps, ChatMessage } from './chat/types';

export type { ChatViewProps };

export function ChatView({
  activeSessionId,
  sessionItems,
  onActiveSessionChange,
  onDraftSessionRequestedChange,
  onLocalSessionCreated,
  onLocalSessionUpdated,
  onSessionMissing,
}: ChatViewProps) {
  const queryClient = useQueryClient();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const liveTextRef = useRef('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Auto-title bookkeeping: sessions we have already client-side auto-titled (fire once),
  // and sessions the operator renamed by hand (never overwrite a manual title).
  const autoTitledSessionsRef = useRef<Set<string>>(new Set());
  const manuallyTitledSessionsRef = useRef<Set<string>>(new Set());
  const [draft, setDraft] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [liveText, setLiveText] = useState('');
  const [turnState, setTurnState] = useState('idle');
  const [turnError, setTurnError] = useState('');
  const [localMessages, setLocalMessages] = useState<LocalCompanionMessage[]>([]);
  const [pendingUserMessageId, setPendingUserMessageId] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState('');
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [isRenamingTitle, setIsRenamingTitle] = useState(false);
  const [sessionTitleDraft, setSessionTitleDraft] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  // Search jump-to-message: set when a MESSAGE-level search result is selected
  // (session-level results carry messageId '' and never set this — see
  // ChatSearch's module doc). Cleared once the target message is found and
  // scrolled to, or the operator navigates to a different session first.
  const [pendingScrollTarget, setPendingScrollTarget] = useState<{ sessionId: string; messageId: string } | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState('');

  const providers = useQuery({ queryKey: queryKeys.providers, queryFn: () => sdk.operator.providers.list() });
  const modelCatalog = useQuery({ queryKey: ['models'], queryFn: () => sdk.operator.models.list() });
  const currentModel = useQuery({ queryKey: ['models', 'current'], queryFn: () => sdk.operator.models.current() });
  const catalogProviderOptions = useMemo(() => providerOptionsFromResponse(modelCatalog.data), [modelCatalog.data]);

  const providerOptions = useMemo(() => {
    const byId = new Map<string, ReturnType<typeof providerOptionsFromResponse>[number]>();
    for (const provider of providerOptionsFromResponse(providers.data)) byId.set(provider.id, provider);
    for (const provider of catalogProviderOptions) {
      const existing = byId.get(provider.id);
      byId.set(provider.id, existing ? { ...existing, value: { ...asRecord(existing.value), ...asRecord(provider.value) } } : provider);
    }
    return [...byId.values()];
  }, [catalogProviderOptions, providers.data]);
  const currentModelRecord = asRecord(asRecord(currentModel.data).model);
  const currentModelData = Object.keys(currentModelRecord).length ? currentModelRecord : asRecord(currentModel.data);
  const currentRegistryKey = firstString(currentModelData, ['registryKey'])
    || firstString(asRecord(asRecord(modelCatalog.data).currentModel), ['registryKey'])
    || '';
  const currentProviderId = firstString(currentModelData, ['provider', 'providerId', 'runtimeProviderId'])
    || firstString(asRecord(asRecord(modelCatalog.data).currentModel), ['provider', 'providerId', 'runtimeProviderId'])
    || '';
  const selectedProvider = providerOptions.find((provider) => provider.id === selectedProviderId)?.value ?? providerOptions[0]?.value;
  const providerModelOptions = useMemo(
    () => selectedProvider ? modelOptionsForProvider(selectedProvider, catalogProviderOptions.map((provider) => provider.value)) : [],
    [catalogProviderOptions, selectedProvider],
  );
  const selectedModelRegistryKey = providerModelOptions.some((model) => model.registryKey === currentRegistryKey) ? currentRegistryKey : '';

  const activeSession = useMemo(
    () => sessionItems.find((session) => bestId(session) === activeSessionId),
    [activeSessionId, sessionItems],
  );
  const activeSessionTitle = activeSessionId ? bestTitle(activeSession, activeSessionId) : 'New Chat';

  useEffect(() => {
    if (selectedProviderId) return;
    const preferredProviderId = currentProviderId || providerOptions[0]?.id || '';
    if (preferredProviderId) setSelectedProviderId(preferredProviderId);
  }, [currentProviderId, providerOptions, selectedProviderId]);

  useEffect(
    () => setSessionTitleDraft(activeSessionTitle === activeSessionId ? '' : activeSessionTitle),
    [activeSessionId, activeSessionTitle],
  );

  const renameSession = useMutation({
    mutationFn: ({ sessionId, title }: { sessionId: string; title: string }) => sdk.chat.sessions.update(sessionId, { title }),
    onSuccess: async (result, variables) => {
      onLocalSessionUpdated(variables.sessionId, companionSessionFromDetail(result) ?? { sessionId: variables.sessionId, title: variables.title });
      await queryClient.invalidateQueries({ queryKey: ['companion-chat', 'sessions'] });
      await queryClient.invalidateQueries({ queryKey: ['companion-chat', variables.sessionId] });
    },
  });

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

  const invalidateChatState = useCallback(async (sessionId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['companion-chat', sessionId, 'messages'] }),
      queryClient.invalidateQueries({ queryKey: ['companion-chat', sessionId] }),
      queryClient.invalidateQueries({ queryKey: ['companion-chat', 'sessions'] }),
    ]);
  }, [queryClient]);

  const messages = useQuery({
    queryKey: ['companion-chat', activeSessionId, 'messages'],
    enabled: Boolean(activeSessionId),
    queryFn: () => sdk.chat.messages.list(activeSessionId),
    retry: (failureCount, error) => !isSessionNotFoundError(error) && failureCount < 2,
    // 'stream paused' is deliberately NOT an ACTIVE_TURN_STATE (isStreaming must go
    // false once the live channel gives up), but it still needs the periodic-refresh
    // fallback — the honest promise a paused stream makes ("live updates are off,
    // falling back to periodic refresh") only holds if something actually keeps
    // polling for a reply that streamed back while nobody was listening.
    refetchInterval: ACTIVE_TURN_STATES.includes(turnState) || turnState === 'syncing' || turnState === 'stream paused' ? 1000 : false,
  });

  // Auth-expiry handoff shared by both chat hooks: re-probe auth.current so a
  // genuinely dead token (401 mid-stream or mid-send) flips the whole app to the
  // signed-out gate (App.tsx unmounts this view when auth.current confirms it) —
  // rather than either hook retrying a dead token or collapsing to a dead-end error.
  const onChatAuthExpired = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.auth });
  }, [queryClient]);

  useEffect(() => {
    if (!activeSessionId || !messages.isError || !isSessionNotFoundError(messages.error)) return;
    onSessionMissing(activeSessionId);
  }, [activeSessionId, messages.error, messages.isError, onSessionMissing]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = '0px';
    composer.style.height = `${Math.min(Math.max(composer.scrollHeight, 44), 140)}px`;
  }, [draft]);

  useEffect(() => {
    setShowJumpToBottom(false);
  }, [activeSessionId]);

  const { isStreaming, stop, retryStream, activeToolCalls, cancelToolCall: cancelToolCallRaw } = useChatStream({
    activeSessionId,
    liveTextRef,
    onSessionMissing,
    setTurnState,
    setTurnError,
    setLiveText,
    setLocalMessages,
    setPendingUserMessageId,
    invalidateChatState,
    onAuthExpired: onChatAuthExpired,
    turnState,
  });

  // Cancel ONE running tool call — the turn continues (unlike stop(), which ends the
  // whole turn). A refusal or transport failure surfaces through the same turnError
  // banner the rest of the composer already renders.
  const cancelToolCall = useCallback(
    async (callId: string) => {
      try {
        const result = await cancelToolCallRaw(callId);
        if (!result.cancelled) setTurnError('Could not cancel that tool call — it may have already finished.');
      } catch (error) {
        setTurnError(formatError(error));
      }
    },
    [cancelToolCallRaw, setTurnError],
  );

  const send = useChatSend({
    activeSessionId,
    onActiveSessionChange,
    onDraftSessionRequestedChange,
    onLocalSessionCreated,
    onSessionMissing,
    setTurnState,
    setTurnError,
    setLiveText,
    setLocalMessages,
    setPendingUserMessageId,
    invalidateChatState,
    turnState,
    onAuthExpired: onChatAuthExpired,
  });
  const { editAndResend, regenerateFrom: sendRegenerateFrom } = send;

  const messageItems = companionMessagesFromListResponse(messages.data);

  const renderedMessageItems = useMemo(
    () => mergeCompanionMessages(messageItems, localMessages, activeSessionId) as ChatMessage[],
    [activeSessionId, localMessages, messageItems],
  );

  // The honest-lineage render model: active messages as nodes, with any superseded
  // (retained) history attached to the node that heads its fork. Derived purely from
  // the server-authoritative list, so it survives reloads and never drops history.
  const lineageNodes = useMemo(() => buildLineage(renderedMessageItems), [renderedMessageItems]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || showJumpToBottom) return;
    window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }, [activeSessionId, liveText, renderedMessageItems.length, showJumpToBottom]);

  // Search jump-to-message: once the target session is active AND its messages
  // have loaded, locate the message in the DOM and scroll to it. Session switch
  // (onActiveSessionChange) and the messages fetch it triggers are both async —
  // the target message may not exist in lineageNodes/the DOM yet on the render
  // right after selecting a search result, so this effect just no-ops until a
  // later render (driven by lineageNodes changing as messages arrive) finds it.
  // The readiness/lookup rules live in search-jump.ts (framework-free, unit
  // tested there) — this effect is just the async-retry wiring around them.
  useEffect(() => {
    if (!isScrollTargetReady(pendingScrollTarget, activeSessionId, lineageNodes) || !pendingScrollTarget) return;
    const target = pendingScrollTarget;
    const element = findMessageElement(scrollRef.current, target.messageId);
    if (!element) return;
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setHighlightedMessageId(target.messageId);
    setPendingScrollTarget(null);
  }, [pendingScrollTarget, activeSessionId, lineageNodes]);

  // Auto-clear the search jump-to-message highlight after a brief flash. A
  // separate effect (keyed only on highlightedMessageId) so a fresh highlight
  // starting mid-flash restarts its own timer rather than racing the one
  // above's cleanup.
  useEffect(() => {
    if (!highlightedMessageId) return;
    const target = highlightedMessageId;
    const timer = window.setTimeout(() => {
      setHighlightedMessageId((current) => (current === target ? '' : current));
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [highlightedMessageId]);

  useEffect(() => {
    if ((!ACTIVE_TURN_STATES.includes(turnState) && turnState !== 'syncing') || liveText) return;
    const lastMessage = renderedMessageItems.at(-1);
    if (lastMessage && messageTone(lastMessage) === 'assistant') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- guarded by condition; resolves syncing state after DB messages load
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- guarded by hasAssistantReply; resolves pending turn when message confirmed in DB
      setPendingUserMessageId('');
       
      setTurnState('completed');
    }
  }, [pendingUserMessageId, renderedMessageItems, turnError]);

  // Client-side auto-title: once a fresh chat has its first user message AND a first
  // assistant reply, replace the crude create-time title (a raw slice of the first
  // message) with a cleaned title derived from that message, via the existing
  // companion.chat.sessions.update verb (there is no server auto-title verb — this is
  // the ruled client-side path). Fires at most once per session and never overwrites a
  // title the operator set by hand.
  useEffect(() => {
    if (!activeSessionId || isRenamingTitle) return;
    if (autoTitledSessionsRef.current.has(activeSessionId)) return;
    if (manuallyTitledSessionsRef.current.has(activeSessionId)) return;
    const firstUser = renderedMessageItems.find((message) => messageTone(message) === 'user');
    const hasAssistantReply = renderedMessageItems.some((message) => messageTone(message) === 'assistant');
    if (!firstUser || !hasAssistantReply) return;
    const firstUserText = messageText(firstUser);
    const derived = deriveChatTitle(firstUserText);
    if (!derived) return;
    const current = activeSessionTitle;
    const looksAutoGenerated = current === ''
      || current === activeSessionId
      || current === 'New Chat'
      || current === firstUserText.slice(0, 72)
      || current === derived;
    // Mark handled regardless, so this never re-evaluates for the session.
    autoTitledSessionsRef.current.add(activeSessionId);
    if (!looksAutoGenerated || current === derived) return;
    renameSession.mutate({ sessionId: activeSessionId, title: derived });
  }, [activeSessionId, activeSessionTitle, isRenamingTitle, renderedMessageItems, renameSession]);

  function submitDraft() {
    sendText(draft, attachedFiles);
  }

  /** STEER: send immediately, interrupting the in-flight turn (Ctrl/Cmd+Enter, or hold the send button). */
  function steerDraft() {
    sendText(draft, attachedFiles, { steer: true });
  }

  function sendText(text: string, files: File[] = [], options: { steer?: boolean } = {}) {
    const body = text.trim();
    if (send.isPending || (!body && !files.length)) return;
    const filesToSend = [...files];
    setDraft('');
    setAttachedFiles([]);
    composerRef.current?.focus();
    send.mutate({ body, files: filesToSend, ...(options.steer ? { steer: true } : {}) });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    submitDraft();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (shouldSteerComposerKey(event)) {
      event.preventDefault();
      steerDraft();
      return;
    }
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
    sendText(text);
  }

  function addAttachedFiles(files: File[]) {
    if (files.length) setAttachedFiles((current) => [...current, ...files]);
  }

  function regenerateFrom(messageId: string) {
    sendRegenerateFrom(messageId, renderedMessageItems);
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

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    addAttachedFiles(files);
    event.target.value = '';
  }

  function removeAttachedFile(index: number) {
    setAttachedFiles((current) => current.filter((_file, fileIndex) => fileIndex !== index));
  }

  function finishRenamingTitle() {
    if (!isRenamingTitle) return;
    const nextTitle = sessionTitleDraft.trim();
    setIsRenamingTitle(false);
    if (!activeSessionId || !nextTitle || nextTitle === activeSessionTitle) return;
    // A hand-set title is authoritative — never auto-title over it afterwards.
    manuallyTitledSessionsRef.current.add(activeSessionId);
    renameSession.mutate({ sessionId: activeSessionId, title: nextTitle });
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setSessionTitleDraft(activeSessionTitle === activeSessionId ? '' : activeSessionTitle);
      setIsRenamingTitle(false);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      finishRenamingTitle();
    }
  }

  const visibleTurnState = turnState !== 'idle' && turnState !== 'completed';

  const slashCommands = [
    { name: 'clear', description: 'Clear the current chat' },
    { name: 'help', description: 'Show available commands' },
    { name: 'new', description: 'Start a new chat session' },
  ] as const;

  return (
    <section className="chat-main">
      <SessionHeader
        activeSessionId={activeSessionId}
        activeSessionTitle={activeSessionTitle}
        isRenamingTitle={isRenamingTitle}
        sessionTitleDraft={sessionTitleDraft}
        visibleTurnState={visibleTurnState}
        turnState={turnState}
        onSetRenamingTitle={setIsRenamingTitle}
        onSessionTitleDraftChange={setSessionTitleDraft}
        onFinishRenamingTitle={finishRenamingTitle}
        onTitleKeyDown={handleTitleKeyDown}
        onRetryStream={turnState === 'stream paused' ? retryStream : undefined}
      />
      <div className="chat-toolbar">
        <button
          type="button"
          className="chat-toolbar__search-toggle"
          aria-pressed={showSearch}
          aria-label={showSearch ? 'Close search' : 'Search messages'}
          onClick={() => setShowSearch((v) => !v)}
        >
          Search
        </button>
      </div>
      {showSearch && (
        <ChatSearch
          sessions={sessionItems}
          onSelect={(payload) => {
            onActiveSessionChange(payload.sessionId);
            setShowSearch(false);
            setPendingScrollTarget(resolveScrollTarget(payload));
          }}
          className="chat-search-panel"
        />
      )}
      <MessageList
        nodes={lineageNodes}
        liveText={liveText}
        showJumpToBottom={showJumpToBottom}
        isSendPending={send.isPending}
        isStreaming={isStreaming}
        copiedMessageId={copiedMessageId}
        highlightedMessageId={highlightedMessageId}
        scrollRef={scrollRef}
        onScroll={handleMessagesScroll}
        onJumpToBottom={scrollMessagesToBottom}
        onCopyMessage={(message) => void copyMessage(message)}
        onResendMessage={resendMessage}
        onRegenerateFrom={regenerateFrom}
        onEditMessage={editAndResend}
        onStop={stop}
        activeToolCalls={activeToolCalls}
        onCancelToolCall={(callId) => void cancelToolCall(callId)}
      />
      {activeSessionId && <QueuedMessagesPanel sessionId={activeSessionId} active={isStreaming} />}
      <Composer
        draft={draft}
        attachedFiles={attachedFiles}
        isSendPending={send.isPending}
        onSteer={steerDraft}
        sendError={send.error}
        turnError={turnError}
        renameSessionError={renameSession.error}
        selectModelError={selectModel.error}
        providerOptions={providerOptions}
        selectedProviderId={selectedProviderId}
        providerModelOptions={providerModelOptions}
        selectedModelRegistryKey={selectedModelRegistryKey}
        selectModelPending={selectModel.isPending}
        composerRef={composerRef}
        fileInputRef={fileInputRef}
        slashCommands={slashCommands}
        onDraftChange={setDraft}
        onComposerKeyDown={handleComposerKeyDown}
        onSubmit={submit}
        onFileSelection={handleFileSelection}
        onFilesAdded={addAttachedFiles}
        onRemoveAttachedFile={removeAttachedFile}
        onProviderChange={setSelectedProviderId}
        onModelChange={(registryKey) => selectModel.mutate(registryKey)}
      />
    </section>
  );
}
