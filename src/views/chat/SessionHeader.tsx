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
        {visibleTurnState && <StatusBadge value={turnState} />}
      </div>
    </header>
  );
}
