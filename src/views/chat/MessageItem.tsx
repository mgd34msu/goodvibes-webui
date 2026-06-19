import { Check, Copy, Paperclip, RotateCcw, X } from 'lucide-react';
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

interface MessageItemProps {
  message: unknown;
  index: number;
  isSendPending: boolean;
  copiedMessageId: string;
  onCopyMessage: (message: unknown) => void;
  onResendMessage: (message: unknown) => void;
  onRegenerateFrom: (index: number) => void;
}

export function MessageItem({
  message,
  index,
  isSendPending,
  copiedMessageId,
  onCopyMessage,
  onResendMessage,
  onRegenerateFrom,
}: MessageItemProps) {
  const id = bestId(message) || `${index}`;
  const tone = messageTone(message);
  const state = deliveryState(message);
  const canRetry = Boolean(messageText(message)) && (tone === 'user' || tone === 'assistant');
  const timestamp = messageTimestamp(message);
  const attachments = messageAttachments(message);
  const text = messageText(message);

  return (
    <article className={`message ${tone}`}>
      <div className="message-bubble">
        {timestamp !== 'unknown' && (
          <div className="message-meta">
            <span>{timestamp}</span>
          </div>
        )}
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
      </div>
      <div className="message-actions">
        <div className="message-actions-inner">
          {state && (
            <span
              className={`delivery-indicator ${state}`}
              title={state === 'failed' ? 'Not sent' : state === 'local' ? 'Pending' : 'Sent'}
            >
              {state === 'failed' ? <X size={12} /> : <Check size={12} />}
            </span>
          )}
          <button type="button" title="Copy message" onClick={() => onCopyMessage(message)}>
            <Copy size={13} />
          </button>
          {canRetry && (
            <button
              type="button"
              title={tone === 'assistant' ? 'Regenerate response' : 'Resend message'}
              disabled={isSendPending}
              onClick={() => (tone === 'assistant' ? onRegenerateFrom(index) : onResendMessage(message))}
            >
              <RotateCcw size={13} />
            </button>
          )}
          {copiedMessageId === id && <span className="message-action-label">copied</span>}
        </div>
      </div>
    </article>
  );
}
