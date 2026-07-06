import { KeyboardEvent } from 'react';
import { Edit3 } from 'lucide-react';
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
            <button
              type="button"
              className="link-button"
              onClick={onRetryStream}
              title="Live updates are off — tap to retry the stream"
            >
              <StatusBadge value={turnState} />
            </button>
          ) : (
            <StatusBadge value={turnState} />
          )
        )}
      </div>
    </header>
  );
}
