import { Dispatch, SetStateAction, useCallback, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { sdk } from '../../lib/goodvibes';
import { bestId } from '../../lib/object';
import {
  companionSessionFromDetail,
  extractMessageId,
  extractSessionId,
  LocalCompanionMessage,
} from '../../lib/companion-chat';
import { isSessionNotFoundError, formatError } from '../../lib/errors';
import { fileToBase64, uploadedArtifactId, messageText } from './message-utils';
import type { ChatMessage } from './types';

// ---------------------------------------------------------------------------
// Branch tracking types
// ---------------------------------------------------------------------------

/** A single stored variant for a given message position. */
export interface MessageVariant {
  /** Stable message id from the server (or local id if not yet resolved). */
  messageId: string;
  /** The text content of this variant. */
  text: string;
}

/**
 * Branch record keyed by "root" message id — the user message that was
 * edited/re-sent. Each resend or regenerate appends a new variant.
 */
export interface BranchRecord {
  /** The user message id this branch originates from. */
  rootMessageId: string;
  /** All variants generated from this root (oldest first). */
  variants: MessageVariant[];
  /** Index of the currently displayed variant (0-based). */
  currentIndex: number;
}

// ---------------------------------------------------------------------------
// Hook options
// ---------------------------------------------------------------------------

interface UseChatSendOptions {
  activeSessionId: string;
  onActiveSessionChange: (sessionId: string) => void;
  onDraftSessionRequestedChange: (requested: boolean) => void;
  onLocalSessionCreated: (session: unknown) => void;
  onSessionMissing: (sessionId: string) => void;
  setTurnState: Dispatch<SetStateAction<string>>;
  setTurnError: Dispatch<SetStateAction<string>>;
  setLiveText: Dispatch<SetStateAction<string>>;
  setLocalMessages: Dispatch<SetStateAction<LocalCompanionMessage[]>>;
  setPendingUserMessageId: Dispatch<SetStateAction<string>>;
  invalidateChatState: (sessionId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

type SendMutation = ReturnType<typeof useMutation<undefined, Error, { body: string; files: File[] }>>;

export interface UseChatSendReturn {
  /**
   * Forward the core mutation properties at the top level so existing call
   * sites (`send.mutate`, `send.isPending`, `send.error`) continue to work
   * without modification.
   */
  mutate: SendMutation['mutate'];
  isPending: boolean;
  error: Error | null;
  /** The underlying mutation object for callers that need the full shape. */
  sendMutation: SendMutation;
  /**
   * Replace `messageId`'s text with `newText`, re-send from that point.
   * Records the new variant in `branchMap`.
   */
  editAndResend: (messageId: string, newText: string) => void;
  /**
   * Trigger a fresh assistant response from `messageId` (assistant message).
   * Records the new response as an additional variant.
   */
  regenerateFrom: (messageId: string, messages: ChatMessage[]) => void;
  /** Current branch state keyed by root message id. */
  branchMap: ReadonlyMap<string, BranchRecord>;
  /**
   * Select a specific variant index for a root message id.
   * Updates `branchMap.currentIndex` so MessageItem can render the navigator.
   */
  selectBranch: (rootMessageId: string, index: number) => void;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function useChatSend({
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
}: UseChatSendOptions): UseChatSendReturn {
  // Branch tracking state: rootMessageId -> BranchRecord
  const [branchMap, setBranchMap] = useState<Map<string, BranchRecord>>(() => new Map());

  // -------------------------------------------------------------------------
  // Internal helper: record a variant in the branch map
  // -------------------------------------------------------------------------
  const recordVariant = useCallback(
    (rootMessageId: string, newVariant: MessageVariant) => {
      setBranchMap((prev) => {
        const next = new Map(prev);
        const existing = next.get(rootMessageId);
        if (existing) {
          const variants = [...existing.variants, newVariant];
          next.set(rootMessageId, {
            ...existing,
            variants,
            currentIndex: variants.length - 1,
          });
        } else {
          next.set(rootMessageId, {
            rootMessageId,
            variants: [newVariant],
            currentIndex: 0,
          });
        }
        return next;
      });
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Core send mutation (unchanged API — still used by Composer)
  // -------------------------------------------------------------------------
  const sendMutation = useMutation<undefined, Error, { body: string; files: File[] }>({
    mutationFn: async ({ body, files }: { body: string; files: File[] }) => {
      if (!body && !files.length) return;
      setTurnState('sending');
      setTurnError('');

      let sessionId = activeSessionId;
      if (!sessionId) {
        const createdAt = Date.now();
        const title = body.slice(0, 72) || files[0]?.name?.slice(0, 72) || 'Attachment chat';
        const created = await sdk.chat.sessions.create({ title });
        sessionId = extractSessionId(created);
        const createdSession = companionSessionFromDetail(created);
        onLocalSessionCreated(bestId(createdSession) ? createdSession : {
          id: sessionId,
          sessionId,
          kind: 'companion-chat',
          title: title || sessionId,
          status: 'active',
          createdAt,
          updatedAt: createdAt,
        });
        onActiveSessionChange(sessionId);
        onDraftSessionRequestedChange(false);
      }

      const localMessageId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const localAttachments = files.map((file, index) => ({
        artifactId: `local-${localMessageId}-${index}`,
        label: file.name,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      }));
      setLocalMessages((current) => [
        ...current,
        {
          id: localMessageId,
          sessionId,
          role: 'user' as const,
          content: body,
          createdAt: Date.now(),
          deliveryState: 'local' as const,
          attachments: localAttachments,
        },
      ]);
      setPendingUserMessageId(localMessageId);
      setLiveText('');
      setTurnState('submitted');

      let attachments: typeof localAttachments = [];
      try {
        attachments = await Promise.all(files.map(async (file) => {
          const dataBase64 = await fileToBase64(file);
          const uploaded = await sdk.artifacts.create({
            filename: file.name,
            mimeType: file.type || 'application/octet-stream',
            dataBase64,
            metadata: { surface: 'webui' },
          });
          const artifactId = uploadedArtifactId(uploaded);
          if (!artifactId) throw new Error(`Artifact upload for ${file.name} did not return an artifact id.`);
          return {
            artifactId,
            label: file.name,
            filename: file.name,
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
          };
        }));
      } catch (error) {
        setLocalMessages((current) => current.map((message) => (
          message.id === localMessageId ? { ...message, deliveryState: 'failed' as const } : message
        )));
        throw error;
      }

      let result: unknown;
      try {
        result = await sdk.chat.messages.create(sessionId, {
          body,
          attachments: attachments.map(({ artifactId, label }) => ({ artifactId, label })),
        });
      } catch (error) {
        setLocalMessages((current) => current.map((message) => (
          message.id === localMessageId ? { ...message, deliveryState: 'failed' as const } : message
        )));
        throw error;
      }
      const messageId = extractMessageId(result);
      setLocalMessages((current) => current.map((message) => (
        message.id === localMessageId
          ? {
            ...message,
            id: messageId || localMessageId,
            deliveryState: 'sent' as const,
            attachments,
          }
          : message
      )));
      setPendingUserMessageId(messageId || localMessageId);
      await invalidateChatState(sessionId);
    },
    onError: (error) => {
      if (isSessionNotFoundError(error) && activeSessionId) {
        onSessionMissing(activeSessionId);
        setTurnError('That chat session no longer exists. Starting from the current daemon session list.');
        return;
      }
      setTurnState('send failed');
      setTurnError(formatError(error));
    },
  });

  // -------------------------------------------------------------------------
  // editAndResend: replace a user message's text and resend from that point
  // -------------------------------------------------------------------------
  const editAndResend = useCallback(
    (messageId: string, newText: string) => {
      if (!newText.trim()) return;

      // Capture the original text BEFORE truncating so we can record variant 0.
      // We need it synchronously here; extract it from the functional updater.
      let originalText = '';
      setLocalMessages((current) => {
        const idx = current.findIndex((m) => m.id === messageId);
        if (idx === -1) {
          // Message not in local state — nothing to truncate; fall through to send
          return current;
        }
        // Capture original for variant recording
        originalText = (current[idx].content) ?? '';
        // Truncate to idx — drop the message at idx so the mutation re-adds it
        // as a fresh local message (prevents duplicate user bubble).
        return current.slice(0, idx);
      });

      // Record the original text as variant 0 (if not already tracked), then
      // the new text as the next variant. Both keyed to messageId.
      recordVariant(messageId, { messageId, text: originalText });
      recordVariant(messageId, { messageId, text: newText });

      // Trigger the actual send — the mutation appends the single new user message.
      sendMutation.mutate({ body: newText, files: [] });
    },
    [sendMutation, setLocalMessages, recordVariant],
  );

  // -------------------------------------------------------------------------
  // regenerateFrom: request a fresh assistant response for the given message
  // -------------------------------------------------------------------------
  const regenerateFrom = useCallback(
    (messageId: string, messages: ChatMessage[]) => {
      // Find the last user message at or before the given assistant message
      const assistantIdx = messages.findIndex(
        (m) => (m.id === messageId || m.messageId === messageId),
      );
      if (assistantIdx === -1) return;

      // Walk back to find the user turn that preceded this assistant response
      let userMessage: ChatMessage | undefined;
      for (let i = assistantIdx - 1; i >= 0; i--) {
        const role = (messages[i].role ?? messages[i].author ?? '').toLowerCase();
        if (role.includes('user')) {
          userMessage = messages[i];
          break;
        }
      }
      if (!userMessage) return;

      const userMsgId = (userMessage.id ?? userMessage.messageId ?? '');
      const userText = messageText(userMessage);
      if (!userText) return;

      // Capture the original assistant text so we can record it as variant 0.
      const assistantOriginalText = messageText(messages[assistantIdx]);

      // Truncate local messages to drop the user message and everything after
      // so the mutation re-adds the user message and a fresh assistant response
      // (prevents duplicate user bubble).
      setLocalMessages((current) => {
        const keepUntil = current.findIndex((m) => m.id === userMsgId);
        // keepUntil === -1 means the user message isn't in local state — leave as-is
        return keepUntil === -1 ? current : current.slice(0, keepUntil);
      });

      // Record original assistant text as variant 0, placeholder for variant 1.
      recordVariant(messageId, { messageId, text: assistantOriginalText });
      recordVariant(messageId, { messageId, text: '' });

      // Re-send the user message text to produce a new assistant response.
      sendMutation.mutate({ body: userText, files: [] });
    },
    [sendMutation, setLocalMessages, recordVariant],
  );

  // -------------------------------------------------------------------------
  // selectBranch: update currentIndex for a root message's branch
  // -------------------------------------------------------------------------
  const selectBranch = useCallback(
    (rootMessageId: string, index: number) => {
      setBranchMap((prev) => {
        const record = prev.get(rootMessageId);
        if (!record) return prev;
        if (index < 0 || index >= record.variants.length) return prev;
        const next = new Map(prev);
        next.set(rootMessageId, { ...record, currentIndex: index });
        return next;
      });
    },
    [],
  );

  return {
    // Flattened mutation surface — preserves existing call sites in ChatView
    mutate: sendMutation.mutate,
    isPending: sendMutation.isPending,
    error: sendMutation.error,
    // Full mutation object for callers that need it
    sendMutation,
    // New branch-aware handlers
    editAndResend,
    regenerateFrom,
    branchMap,
    selectBranch,
  };
}
