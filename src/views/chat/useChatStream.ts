import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState, RefObject } from 'react';
import { sdk, DEFAULT_SSE_RECONNECT } from '../../lib/goodvibes';
import { firstString } from '../../lib/object';
import { isSessionNotFoundError, isAuthExpiredError } from '../../lib/errors';
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
   * Called once when the stream (or a send) discovers the token has expired mid-
   * session (401 / category:'authentication'). The caller re-probes auth.current,
   * which — for a genuinely dead token — flips the app into the signed-out gate. This
   * hook never retries a dead token itself; it hands off and stops.
   */
  onAuthExpired: () => void;
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
  /** Whether a turn is actively in-flight (running, streaming, tooling, or reconnecting). */
  isStreaming: boolean;
  /**
   * Stop the in-flight turn immediately.
   * Disconnects the SSE stream, clears live text, and resets turn state to 'idle'.
   */
  stop: () => void;
  /**
   * Force a fresh connection attempt after the stream gave up ('stream paused').
   * The built-in reconnect only retries up to DEFAULT_SSE_RECONNECT.maxAttempts with
   * backoff; once exhausted the SDK stops entirely on its own, so recovery needs an
   * explicit re-open. Safe to call any time — it just re-runs the connect effect.
   */
  retryStream: () => void;
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
  onAuthExpired,
  turnState,
}: UseChatStreamOptions): UseChatStreamResult {
  // Ref to the SSE disconnect fn so stop() can call it at any time. Owned by the
  // CURRENT connection effect only — a stale effect never writes here (see the
  // per-effect `cancelled` flag in the connect effect below).
  const disconnectRef = useRef<(() => void) | undefined>(undefined);
  // Intra-turn stop signal for the CURRENT connection effect: set by stop() so the
  // live stream's callbacks and its (possibly still-pending) open promise both go
  // inert for the rest of this turn. Distinct from the per-effect `cancelled` flag,
  // which handles the CROSS-effect case (session switch / retry / unmount).
  const stoppedRef = useRef(false);
  // Bumped by retryStream() to force a fresh connect after the SDK's own
  // reconnect loop gives up (it never retries again on its own past onTerminate).
  const [retryNonce, setRetryNonce] = useState(0);

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

  const retryStream = useCallback(() => {
    setRetryNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!activeSessionId) return undefined;
    // Per-effect cancellation flag — the "epoch" of THIS connection instance. Set to
    // true by this effect's own cleanup and nothing else; a superseding effect (a
    // session switch, a retryStream(), or unmount) runs this cleanup FIRST, so the
    // outgoing effect's `cancelled` is already true before the incoming effect touches
    // any shared ref. Every callback below, plus the stream-open .then/.catch, closes
    // over ITS OWN `cancelled`. That is what makes a late callback from the OLD stream
    // inert: it reads its own `cancelled` (true), never the shared stoppedRef the new
    // effect just reset to false. Without this, an SDK stream() whose disconnect handle
    // only resolves AFTER the switch would (a) let the old stream's onReconnect/onEvent
    // clobber the new session's state, and (b) store the OLD handle into the shared
    // disconnectRef, orphaning the new stream. See the "session switch mid-handshake"
    // tests.
    let cancelled = false;
    stoppedRef.current = false;
    disconnectRef.current = undefined;
    setLiveText('');
    liveTextRef.current = '';
    setTurnError('');

    // True once a drop has been reported for THIS connection instance (an onReconnect
    // fired). Lets onReady tell "the very first connect" (say nothing, turnState is
    // already whatever the caller set) apart from "a reconnect after a drop succeeded"
    // (clear the reconnecting message). Also lets onError tell apart a transient error
    // it already saw via onReconnect (skip — avoid clobbering with a duplicate/contra-
    // dictory 'stream error') from a standalone failure (none observed via this SDK's
    // current wiring, but kept as a defensive fallback).
    let hadDrop = false;
    // Guards the auth-expiry handoff to fire exactly once per connection instance —
    // idempotent either way, but avoids redundant invalidateQueries churn if the dead
    // token keeps producing 401s across more than one handler callback.
    let handledAuthExpiry = false;

    const handleAuthExpiry = (error: unknown): boolean => {
      if (handledAuthExpiry) return true;
      if (!isAuthExpiredError(error)) return false;
      handledAuthExpiry = true;
      onAuthExpired();
      syncedSetTurnState('session expired');
      setTurnError('Your session expired — sign in again to continue.');
      // Stop relying on the built-in reconnect loop: a stale token will just keep
      // 401ing on every retry, burning the bounded attempt budget for nothing.
      disconnectRef.current?.();
      return true;
    };

    void sdk.chat.events.stream(activeSessionId, {
      onReady: () => {
        if (cancelled || stoppedRef.current) return;
        if (hadDrop) {
          hadDrop = false;
          // Functional updater: only clear the reconnecting label if nothing else
          // (a fresh send, a genuine turn error) has already moved turnState on.
          // Routed through syncedSetTurnState (already an effect dependency) rather
          // than the raw setter so this stays in the same forwarding path as every
          // other turnState write below.
          syncedSetTurnState((current) => (current === 'reconnecting' ? 'syncing' : current));
          setTurnError((current) => (current.startsWith('Reconnecting to the live stream') ? '' : current));
        }
      },
      onEvent: (eventName, payload) => {
        if (cancelled || stoppedRef.current) return;
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
      // Fires on every transient failure the built-in reconnect loop is about to
      // retry (paired with — and called right after — onReconnect below), and once
      // more on the terminal failure (paired with, and called right after,
      // onTerminate below). It never fires standalone against this SDK's current
      // wiring, so `hadDrop` — already true from the paired call — lets this handler
      // stay a no-op rather than overwrite the more specific 'reconnecting' /
      // 'stream paused' / 'session expired' state with a generic 'stream error'.
      onError: (error) => {
        if (cancelled || stoppedRef.current) return;
        if (isSessionNotFoundError(error)) {
          onSessionMissing(activeSessionId);
          return;
        }
        if (handleAuthExpiry(error)) return;
        if (!hadDrop) {
          syncedSetTurnState('stream error');
          setTurnError(error instanceof Error ? error.message : String(error));
        }
      },
      // A drop the built-in reconnect is about to retry (attempts remain and
      // reconnect is enabled) — the daemon-blip / SSE-drop case. Honest, distinct
      // from a genuine unrecoverable 'stream error': the connection is expected back.
      onReconnect: ({ attempt, delayMs }) => {
        if (cancelled || stoppedRef.current) return;
        hadDrop = true;
        syncedSetTurnState('reconnecting');
        setTurnError(
          `Reconnecting to the live stream — attempt ${attempt} of ${DEFAULT_SSE_RECONNECT.maxAttempts} `
          + `(next try in ${Math.max(1, Math.round(delayMs / 1000))}s)…`,
        );
      },
      // The built-in reconnect exhausted DEFAULT_SSE_RECONNECT.maxAttempts and gave
      // up for good — it will not try again on its own. Falls back to the composer's
      // 1s message poll (ChatView keeps polling while turnState is a 'reconnecting'/
      // 'sending while reconnecting' ACTIVE_TURN_STATE, and ChatView also polls
      // explicitly while 'stream paused') until retryStream() re-opens the stream.
      onTerminate: ({ error, reconnectAttempts }) => {
        if (cancelled || stoppedRef.current) return;
        if (handleAuthExpiry(error)) return;
        syncedSetTurnState('stream paused');
        setTurnError(
          `Stream paused after ${reconnectAttempts} reconnect attempt${reconnectAttempts === 1 ? '' : 's'} — `
          + 'live updates are off. Tap the status to retry, or send a message to try again.',
        );
      },
    }, { reconnect: DEFAULT_SSE_RECONNECT }).then((nextDisconnect) => {
      // The SDK only yields the disconnect handle AFTER the handshake. If this effect
      // was superseded (cancelled) or the turn was stopped while that promise was still
      // pending, the handle is already orphaned: disconnect it immediately and never
      // store it — storing a stale handle here is exactly what used to clobber the new
      // session's live disconnectRef.
      if (cancelled || stoppedRef.current) {
        nextDisconnect();
        return;
      }
      disconnectRef.current = nextDisconnect;
    }).catch((err: unknown) => {
      if (!cancelled && !stoppedRef.current) {
        if (isSessionNotFoundError(err)) {
          onSessionMissing(activeSessionId);
          return;
        }
        if (handleAuthExpiry(err)) return;
        syncedSetTurnState('stream error');
        setTurnError(err instanceof Error ? err.message : String(err));
      }
    });

    return () => {
      // Set ONLY this effect's own flag. Its late callbacks / late-resolving open
      // promise read this same closure variable and go inert; the incoming effect
      // (which has already run its predecessor's cleanup by the time it executes)
      // starts with a fresh `cancelled = false` of its own.
      cancelled = true;
      stoppedRef.current = true;
      disconnectRef.current?.();
      disconnectRef.current = undefined;
    };
  }, [
    activeSessionId,
    onSessionMissing,
    onAuthExpired,
    invalidateChatState,
    syncedSetTurnState,
    setLiveText,
    liveTextRef,
    setTurnError,
    setLocalMessages,
    setPendingUserMessageId,
    retryNonce,
  ]);

  const isStreaming = ACTIVE_TURN_STATES.includes(turnState ?? 'idle');

  return { isStreaming, stop, retryStream };
}
