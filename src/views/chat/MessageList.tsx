import { RefObject } from 'react';
import { ArrowDown, X } from 'lucide-react';
import { MarkdownMessage } from '../../components/MarkdownMessage';
import { useReducedMotion } from '../../components/motion/useReducedMotion';
import { MessageItem } from './MessageItem';
import { lineageNodeKey, type LineageNode } from './lineage';
import { bestId } from './message-utils';
import type { ChatMessage } from './types';
import type { ActiveToolCall } from './useChatStream';
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
  /** Id of the message to flash-highlight (search jump-to-message target), or '' for none. */
  highlightedMessageId?: string;
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
  /** Tool calls currently running for the active turn (useChatStream's ActiveToolCall). */
  activeToolCalls?: readonly ActiveToolCall[];
  /** Cancel ONE running tool call — the turn itself continues (unlike onStop, which ends it). */
  onCancelToolCall?: (callId: string) => void;
}

export function MessageList({
  nodes,
  liveText,
  showJumpToBottom,
  isSendPending,
  isStreaming = false,
  copiedMessageId,
  highlightedMessageId = '',
  scrollRef,
  onScroll,
  onJumpToBottom,
  onCopyMessage,
  onResendMessage,
  onRegenerateFrom,
  onEditMessage,
  onStop,
  activeToolCalls = [],
  onCancelToolCall,
}: MessageListProps) {
  const reducedMotion = useReducedMotion();
  // Stop must be reachable for the WHOLE active turn — including the
  // pre-first-token window (model thinking, long tool calls), where there is
  // no liveText yet. Requiring text here used to make a turn unstoppable
  // until it started talking.
  const showStreamControls = isStreaming;

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
            isHighlighted={highlightedMessageId !== '' && bestId(node.message) === highlightedMessageId}
            onCopyMessage={onCopyMessage}
            onResendMessage={onResendMessage}
            onRegenerateFrom={onRegenerateFrom}
            onEditMessage={onEditMessage ? (_msg, newText) => onEditMessage(node.message.id ?? node.message.messageId ?? '', newText) : undefined}
          />
        ))}
        {(liveText || isStreaming) && (
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
                {/* Running tool calls — cancel ONE call without ending the turn. The
                    cancelled result renders honestly (a "Cancelled" label replaces the
                    button) until the daemon's own turn.tool_result actually clears it. */}
                {activeToolCalls.length > 0 && (
                  <ul className="active-tool-calls" aria-label="Running tool calls">
                    {activeToolCalls.map((call) => (
                      <li key={call.toolCallId} className="active-tool-call">
                        <span className="active-tool-call__name">
                          {call.cancelled ? 'Cancelled: ' : 'Running: '}{call.toolName || call.toolCallId}
                        </span>
                        {!call.cancelled && onCancelToolCall && (
                          <button
                            type="button"
                            className="active-tool-call__cancel"
                            onClick={() => onCancelToolCall(call.toolCallId)}
                            aria-label={`Cancel tool call ${call.toolName || call.toolCallId}`}
                          >
                            <X size={12} aria-hidden="true" /> Cancel
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </article>
          </div>
        )}
        {!nodes.length && !liveText && !isStreaming && (
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
