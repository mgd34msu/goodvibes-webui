import { RefObject } from 'react';
import { ArrowDown } from 'lucide-react';
import { MarkdownMessage } from '../../components/MarkdownMessage';
import { MessageItem } from './MessageItem';
import { bestId } from './message-utils';
import type { ChatMessage } from './types';

interface MessageListProps {
  renderedMessageItems: ChatMessage[];
  liveText: string;
  showJumpToBottom: boolean;
  isSendPending: boolean;
  copiedMessageId: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onJumpToBottom: () => void;
  onCopyMessage: (message: ChatMessage) => void;
  onResendMessage: (message: ChatMessage) => void;
  onRegenerateFrom: (index: number) => void;
}

export function MessageList({
  renderedMessageItems,
  liveText,
  showJumpToBottom,
  isSendPending,
  copiedMessageId,
  scrollRef,
  onScroll,
  onJumpToBottom,
  onCopyMessage,
  onResendMessage,
  onRegenerateFrom,
}: MessageListProps) {
  return (
    <>
      <div className="messages chat-conversation" ref={scrollRef} onScroll={onScroll}>
        {renderedMessageItems.map((message, index) => (
          <MessageItem
            key={`${bestId(message) || index}-${index}`}
            message={message}
            index={index}
            isSendPending={isSendPending}
            copiedMessageId={copiedMessageId}
            onCopyMessage={onCopyMessage}
            onResendMessage={onResendMessage}
            onRegenerateFrom={onRegenerateFrom}
          />
        ))}
        {liveText && (
          <div aria-live="polite" aria-atomic="false">
            <article className="message assistant streaming">
              <div className="message-bubble">
                <div className="message-meta">
                  <span>GoodVibes is responding</span>
                </div>
                <MarkdownMessage content={liveText} />
              </div>
            </article>
          </div>
        )}
        {!renderedMessageItems.length && !liveText && (
          <p className="empty-state">Start a chat with GoodVibes.</p>
        )}
      </div>
      {showJumpToBottom && (
        <button
          type="button"
          className="jump-to-bottom"
          onClick={onJumpToBottom}
          title="Jump to latest message"
        >
          <ArrowDown size={16} />
        </button>
      )}
    </>
  );
}
