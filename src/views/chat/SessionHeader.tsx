import { KeyboardEvent } from 'react';
import { Edit3, RefreshCw } from 'lucide-react';
import { StatusBadge } from '../../components/StatusBadge';

interface SessionHeaderProps {
  activeSessionId: string;
  activeSessionTitle: string;
  isRenamingTitle: boolean;
  sessionTitleDraft: string;
  visibleTurnState: boolean;
  turnState: string;
  onSetRenamingTitle: (value: boolean) => void;
  onSessionTitleDraftChange: (value: string) => void;
  onFinishRenamingTitle: () => void;
  onTitleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  /**
   * Present only when there is something to retry (turnState === 'stream paused' —
   * the built-in SSE reconnect exhausted its attempts and gave up for good).
   * Undefined renders the plain, unclickable badge exactly as before.
   */
  onRetryStream?: () => void;
}

export function SessionHeader({
  activeSessionId,
  activeSessionTitle,
  isRenamingTitle,
  sessionTitleDraft,
  visibleTurnState,
  turnState,
  onSetRenamingTitle,
  onSessionTitleDraftChange,
  onFinishRenamingTitle,
  onTitleKeyDown,
  onRetryStream,
}: SessionHeaderProps) {
  return (
    <header className="chat-main-header">
      {isRenamingTitle ? (
        <input
          className="chat-title-input"
          value={sessionTitleDraft}
          onBlur={onFinishRenamingTitle}
          onChange={(event) => onSessionTitleDraftChange(event.target.value)}
          onKeyDown={onTitleKeyDown}
          autoFocus
          aria-label="Rename chat session"
        />
      ) : (
        <button
          className="chat-title-button"
          type="button"
          disabled={!activeSessionId}
          onClick={() => activeSessionId && onSetRenamingTitle(true)}
          title={activeSessionId ? 'Rename chat' : 'Start a new chat'}
        >
          <span>{activeSessionTitle}</span>
          {activeSessionId && <Edit3 size={14} />}
        </button>
      )}
      <div className="chat-status">
        {visibleTurnState && (
          onRetryStream ? (
            // A hover-title on a badge is invisible on touch (F6). Pair the honest paused
            // badge with an explicit, always-visible Retry control — a real button with a
            // ≥44px hit target on coarse pointers.
            <span className="chat-status__paused">
              <StatusBadge value={turnState} />
              <button
                type="button"
                className="chat-status__retry"
                onClick={onRetryStream}
                aria-label="Retry the live stream"
                title="Live updates are off — retry the stream"
              >
                <RefreshCw size={13} aria-hidden="true" />
                Retry
              </button>
            </span>
          ) : (
            <StatusBadge value={turnState} />
          )
        )}
      </div>
    </header>
  );
}
