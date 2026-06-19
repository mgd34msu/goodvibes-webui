import { Dispatch, SetStateAction } from 'react';
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
import { fileToBase64, uploadedArtifactId } from './message-utils';

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
}: UseChatSendOptions) {
  return useMutation({
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
}
