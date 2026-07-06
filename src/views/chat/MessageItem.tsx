import { Check, Copy, Layers, Paperclip, Pencil, RotateCcw, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type { ChatMessage } from './types';
import type { SupersededReason } from './lineage';
import { MessageLineage, messageIsEdited } from './MessageLineage';
import { useArtifactsPanel } from './ArtifactsPanel';
import { MarkdownMessage } from '../../components/MarkdownMessage';
import { asRecord } from '../../lib/object';
import {
  attachmentLabel,
  attachmentMeta,
  deliveryState,
  messageAttachments,
  messageText,
  messageTone,
  messageTimestamp,
  bestId,
} from './message-utils';
import '../../styles/components/chat-actions.css';

interface MessageItemProps {
  message: ChatMessage;
  index: number;
  isSendPending: boolean;
  copiedMessageId: string;
  /** Superseded messages retained behind this message's fork — oldest first. */
  priorMessages?: readonly ChatMessage[];
  /** Why the retained run was superseded ('regenerate' | 'edit'). */
  reason?: SupersededReason;
  /** The original message id when this message replaced an edited one. */
  revisionOf?: string;
  onCopyMessage: (message: ChatMessage) => void;
  onResendMessage: (message: ChatMessage) => void;
  onRegenerateFrom: (messageId: string) => void;
  /** Called when the user submits an edited version of a user message. */
  onEditMessage?: (message: ChatMessage, newText: string) => void;
}

export function MessageItem({
  message,
  index,
  isSendPending,
  copiedMessageId,
  priorMessages,
  reason,
  revisionOf,
  onCopyMessage,
  onResendMessage,
  onRegenerateFrom,
  onEditMessage,
}: MessageItemProps) {
  const id = bestId(message) || `${index}`;
  const tone = messageTone(message);
  const state = deliveryState(message);
  const text = messageText(message);
  const { openArtifacts } = useArtifactsPanel();
  const canRetry = Boolean(text) && (tone === 'user' || tone === 'assistant');
  const timestamp = messageTimestamp(message);
  const attachments = messageAttachments(message);
  const isEdited = messageIsEdited(reason, revisionOf);

  // ---------------------------------------------------------------------------
  // Inline edit state (user messages only)
  // ---------------------------------------------------------------------------
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleEditStart = useCallback(() => {
    setEditDraft(text);
    setIsEditing(true);
    // Focus textarea on next tick after render
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [text]);

  const handleEditCancel = useCallback(() => {
    setIsEditing(false);
    setEditDraft('');
  }, []);

  const handleEditSubmit = useCallback(() => {
    const trimmed = editDraft.trim();
    if (!trimmed || isSendPending) return;
    onEditMessage?.(message, trimmed);
    setIsEditing(false);
    setEditDraft('');
  }, [editDraft, isSendPending, message, onEditMessage]);

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleEditSubmit();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        handleEditCancel();
      }
    },
    [handleEditSubmit, handleEditCancel],
  );

  return (
    <article className={`message ${tone}`}>
      {/* Honest-lineage disclosure: when this message heads a fork, reveal the retained
          (superseded) history rather than pretending it is gone. */}
      <MessageLineage priorMessages={priorMessages} reason={reason} revisionOf={revisionOf} />

      <div className="message-bubble">
        {timestamp !== 'unknown' && (
          <div className="message-meta">
            <span>{timestamp}</span>
            {isEdited && <span className="message-meta__edited"> · edited</span>}
          </div>
        )}

        {isEditing && tone === 'user' ? (
          <div className="message-edit-area">
            <textarea
              ref={textareaRef}
              className="message-edit-textarea"
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={handleEditKeyDown}
              aria-label="Edit message"
              rows={3}
            />
            <div className="message-edit-actions">
              <button
                type="button"
                className="message-edit-cancel"
                onClick={handleEditCancel}
                aria-label="Cancel edit"
              >
                Cancel
              </button>
              <button
                type="button"
                className="message-edit-submit"
                onClick={handleEditSubmit}
                disabled={!editDraft.trim() || isSendPending}
                aria-label="Send edited message (Ctrl+Enter)"
              >
                Send
              </button>
            </div>
          </div>
        ) : (
          <>
            {text && <MarkdownMessage content={text} />}
            {attachments.length > 0 && (
              <div className="message-attachments">
                {attachments.map((attachment, attachmentIndex) => (
                  <div key={`${id}-attachment-${attachmentIndex}`} className="message-attachment">
                    <Paperclip size={13} />
                    <div>
                      <strong>{attachmentLabel(attachment)}</strong>
                      {attachmentMeta(attachment) && <span>{attachmentMeta(attachment)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!text && attachments.length === 0 && <p>{JSON.stringify(asRecord(message))}</p>}
          </>
        )}
      </div>

      <div className="message-actions">
        <div className="message-actions-inner">
          {/* Delivery indicator */}
          {state && (
            <span
              className={`delivery-indicator ${state}`}
              title={state === 'failed' ? 'Not sent' : state === 'local' ? 'Pending' : 'Sent'}
            >
              {state === 'failed' ? <X size={12} /> : <Check size={12} />}
            </span>
          )}

          {/* Copy */}
          <button type="button" title="Copy message" aria-label="Copy message" onClick={() => onCopyMessage(message)}>
            <Copy size={13} />
          </button>

          {/* Edit (user messages only) — only shown when onEditMessage handler is provided */}
          {tone === 'user' && canRetry && !isEditing && onEditMessage !== undefined && (
            <button
              type="button"
              title="Edit and resend"
              aria-label="Edit and resend message"
              disabled={isSendPending}
              onClick={handleEditStart}
            >
              <Pencil size={13} />
            </button>
          )}

          {/* Resend / Regenerate */}
          {canRetry && !isEditing && (
            <button
              type="button"
              title={tone === 'assistant' ? 'Regenerate response' : 'Resend message'}
              aria-label={tone === 'assistant' ? 'Regenerate response' : 'Resend message'}
              disabled={isSendPending}
              onClick={() => (tone === 'assistant' ? onRegenerateFrom(id) : onResendMessage(message))}
            >
              <RotateCcw size={13} />
            </button>
          )}

          {/* View artifacts — shown on assistant messages that contain code blocks or attachments */}
          {tone === 'assistant' && (text || attachments.length > 0) && (
            <button
              type="button"
              title="View artifacts"
              aria-label="View artifacts from this message"
              className="message-action-artifacts"
              onClick={() => openArtifacts(message)}
            >
              <Layers size={13} />
            </button>
          )}

          {/* Copied label */}
          {copiedMessageId === id && <span className="message-action-label">copied</span>}
        </div>
      </div>
    </article>
  );
}
