import { Dispatch, SetStateAction, useEffect, RefObject } from 'react';
import { sdk } from '../../lib/goodvibes';
import { firstString } from '../../lib/object';
import { isSessionNotFoundError } from '../../lib/errors';
import { LocalCompanionMessage } from '../../lib/companion-chat';
import {
  assistantContentFromCompletedTurn,
  companionEventType,
} from './message-utils';

interface UseChatStreamOptions {
  activeSessionId: string;
  liveTextRef: RefObject<string>;
  onSessionMissing: (sessionId: string) => void;
  setTurnState: Dispatch<SetStateAction<string>>;
  setTurnError: Dispatch<SetStateAction<string>>;
  setLiveText: Dispatch<SetStateAction<string>>;
  setLocalMessages: Dispatch<SetStateAction<LocalCompanionMessage[]>>;
  setPendingUserMessageId: Dispatch<SetStateAction<string>>;
  invalidateChatState: (sessionId: string) => Promise<void>;
}

export function useChatStream({
  activeSessionId,
  liveTextRef,
  onSessionMissing,
  setTurnState,
  setTurnError,
  setLiveText,
  setLocalMessages,
  setPendingUserMessageId,
  invalidateChatState,
}: UseChatStreamOptions) {
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
                role: 'assistant' as const,
                content: assistantContent,
                createdAt: Date.now(),
                deliveryState: 'sent' as const,
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
        if (isSessionNotFoundError(error)) {
          onSessionMissing(activeSessionId);
          return;
        }
        setTurnState('stream error');
        setTurnError(error instanceof Error ? error.message : String(error));
      },
    }).then((nextDisconnect) => {
      if (closed) {
        nextDisconnect();
        return;
      }
      disconnect = nextDisconnect;
    }).catch((err: unknown) => {
      if (!closed) {
        if (isSessionNotFoundError(err)) {
          onSessionMissing(activeSessionId);
          return;
        }
        setTurnState('stream error');
        setTurnError(err instanceof Error ? err.message : String(err));
      }
    });

    return () => {
      closed = true;
      disconnect?.();
    };
  }, [activeSessionId, onSessionMissing, invalidateChatState]);
}
