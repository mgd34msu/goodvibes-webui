import { RefObject } from 'react';
import { ArrowDown } from 'lucide-react';
import { MarkdownMessage } from '../../components/MarkdownMessage';
import { useReducedMotion } from '../../components/motion/useReducedMotion';
import { MessageItem } from './MessageItem';
import { lineageNodeKey, type LineageNode } from './lineage';
import type { ChatMessage } from './types';
import '../../styles/components/chat-stream.css';

interface MessageListProps {
  /** Honest-lineage render nodes: active messages with any retained history attached. */
  nodes: LineageNode[];
  liveText: string;
  showJumpToBottom: boolean;
  isSendPending: boolean;
  /** Whether a turn is actively streaming (running | streaming | tooling). */
  isStreaming?: boolean;
  copiedMessageId: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onJumpToBottom: () => void;
  onCopyMessage: (message: ChatMessage) => void;
  onResendMessage: (message: ChatMessage) => void;
  onRegenerateFrom: (messageId: string) => void;
  /** Called when the user submits an edited version of a user message. */
  onEditMessage?: (messageId: string, newText: string) => void;
  /** Called when the user clicks the Stop button during an active stream. */
  onStop?: () => void;
}

export function MessageList({
  nodes,
  liveText,
  showJumpToBottom,
  isSendPending,
  isStreaming = false,
  copiedMessageId,
  scrollRef,
  onScroll,
  onJumpToBottom,
  onCopyMessage,
  onResendMessage,
  onRegenerateFrom,
  onEditMessage,
  onStop,
}: MessageListProps) {
  const reducedMotion = useReducedMotion();
  const showStreamControls = isStreaming && Boolean(liveText);

  return (
    <>
      <div className="messages chat-conversation" ref={scrollRef} onScroll={onScroll}>
        {nodes.map((node, index) => (
          <MessageItem
            key={lineageNodeKey(node, index)}
            message={node.message}
            index={index}
            isSendPending={isSendPending}
            copiedMessageId={copiedMessageId}
            priorMessages={node.priorMessages}
            reason={node.reason}
            revisionOf={node.revisionOf}
            onCopyMessage={onCopyMessage}
            onResendMessage={onResendMessage}
            onRegenerateFrom={onRegenerateFrom}
            onEditMessage={onEditMessage ? (_msg, newText) => onEditMessage(node.message.id ?? node.message.messageId ?? '', newText) : undefined}
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
                {showStreamControls && (
                  <div className="stream-controls">
                    <span
                      className={`stream-caret${reducedMotion ? ' stream-caret--reduced' : ''}`}
                      aria-hidden="true"
                    />
                    {onStop && (
                      <button
                        type="button"
                        className="stream-stop-btn"
                        onClick={onStop}
                        aria-label="Stop generating"
                      >
                        Stop
                      </button>
                    )}
                  </div>
                )}
              </div>
            </article>
          </div>
        )}
        {!nodes.length && !liveText && (
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
