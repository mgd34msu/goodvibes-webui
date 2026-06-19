import { Dispatch, SetStateAction, useCallback, useEffect, useRef, RefObject } from 'react';
import { sdk } from '../../lib/goodvibes';
import { firstString } from '../../lib/object';
import { isSessionNotFoundError } from '../../lib/errors';
import { LocalCompanionMessage } from '../../lib/companion-chat';
import {
  ACTIVE_TURN_STATES,
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
  /**
   * The AUTHORITATIVE turn state managed by the caller (e.g. ChatView).
   * When provided, `isStreaming` derives from this value instead of a
   * private shadow copy. Pass the same state variable that is fed to
   * `setTurnState` so the streaming indicator is correct during the
   * sending/submitted window (before the first SSE token arrives).
   *
   * Integration note: ChatView must pass `turnState` here once it
   * destructures the value from its own useState.
   */
  turnState?: string;
}

export interface UseChatStreamResult {
  /** Whether a turn is actively in-flight (running, streaming, or tooling). */
  isStreaming: boolean;
  /**
   * Stop the in-flight turn immediately.
   * Disconnects the SSE stream, clears live text, and resets turn state to 'idle'.
   */
  stop: () => void;
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
  turnState,
}: UseChatStreamOptions): UseChatStreamResult {
  // Ref to the SSE disconnect fn so stop() can call it at any time.
  const disconnectRef = useRef<(() => void) | undefined>(undefined);
  // Cancellation flag: set by stop() and effect cleanup so the .then
  // callback can detect a pre-resolve stop and immediately disconnect.
  const stoppedRef = useRef(false);

  // Forward state updates to the caller's authoritative turnState.
  const syncedSetTurnState: Dispatch<SetStateAction<string>> = useCallback(
    (nextState) => {
      setTurnState(nextState);
    },
    [setTurnState],
  );

  const stop = useCallback(() => {
    stoppedRef.current = true;
    disconnectRef.current?.();
    disconnectRef.current = undefined;
    liveTextRef.current = '';
    setLiveText('');
    setTurnState('idle');
  }, [liveTextRef, setLiveText, setTurnState]);

  useEffect(() => {
    if (!activeSessionId) return undefined;
    stoppedRef.current = false;
    disconnectRef.current = undefined;
    setLiveText('');
    liveTextRef.current = '';
    setTurnError('');

    void sdk.chat.events.stream(activeSessionId, {
      onEvent: (eventName, payload) => {
        if (!eventName.startsWith('companion-chat.')) return;
        if (firstString(payload, ['sessionId']) !== activeSessionId) return;
        const type = companionEventType(eventName, payload);

        if (type === 'turn.started') {
          syncedSetTurnState('running');
          void invalidateChatState(activeSessionId);
          return;
        }

        if (type === 'turn.delta') {
          const delta = firstString(payload, ['delta']);
          if (delta) {
            liveTextRef.current += delta;
            setLiveText((current) => current + delta);
          }
          syncedSetTurnState('streaming');
          return;
        }

        if (type === 'turn.tool_call' || type === 'turn.tool_result') {
          syncedSetTurnState('tooling');
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
            syncedSetTurnState('completed');
          } else {
            syncedSetTurnState('syncing');
          }
          setLiveText('');
          liveTextRef.current = '';
          void invalidateChatState(activeSessionId);
          return;
        }

        if (type === 'turn.error') {
          syncedSetTurnState('error');
          setTurnError(firstString(payload, ['error']) || 'Companion chat turn failed.');
          void invalidateChatState(activeSessionId);
        }
      },
      onError: (error) => {
        if (isSessionNotFoundError(error)) {
          onSessionMissing(activeSessionId);
          return;
        }
        syncedSetTurnState('stream error');
        setTurnError(error instanceof Error ? error.message : String(error));
      },
    }).then((nextDisconnect) => {
      if (stoppedRef.current) {
        nextDisconnect();
        return;
      }
      disconnectRef.current = nextDisconnect;
    }).catch((err: unknown) => {
      if (!stoppedRef.current) {
        if (isSessionNotFoundError(err)) {
          onSessionMissing(activeSessionId);
          return;
        }
        syncedSetTurnState('stream error');
        setTurnError(err instanceof Error ? err.message : String(err));
      }
    });

    return () => {
      stoppedRef.current = true;
      disconnectRef.current?.();
      disconnectRef.current = undefined;
    };
  }, [activeSessionId, onSessionMissing, invalidateChatState, syncedSetTurnState, setLiveText, liveTextRef, setTurnError, setLocalMessages, setPendingUserMessageId]);

  const isStreaming = ACTIVE_TURN_STATES.includes(turnState ?? 'idle');

  return { isStreaming, stop };
}
