import { asRecord, bestId, firstArray, firstString, formatRelative } from '../../lib/object';

export function messageText(message: unknown): string {
  const direct = firstString(message, ['body', 'content', 'text', 'message', 'delta']);
  if (direct) return direct;
  const parts = firstArray(message, ['parts', 'content']);
  return parts.map((part) => firstString(part, ['text', 'content', 'body'])).filter(Boolean).join('\n');
}

export function messageAttachments(message: unknown): unknown[] {
  const record = asRecord(message);
  if (Array.isArray(record.attachments)) return record.attachments;
  if (Array.isArray(record.artifacts)) return record.artifacts;
  return [];
}

export function attachmentLabel(attachment: unknown): string {
  return firstString(attachment, ['label', 'filename', 'name', 'artifactId', 'id']) || 'Attachment';
}

export function attachmentMeta(attachment: unknown): string {
  const record = asRecord(attachment);
  const mimeType = firstString(attachment, ['mimeType', 'type']);
  const sizeBytes = Number(record.sizeBytes ?? record.size);
  const size = Number.isFinite(sizeBytes) && sizeBytes > 0
    ? sizeBytes > 1024 * 1024
      ? `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(sizeBytes / 1024))} KB`
    : '';
  return [mimeType, size].filter(Boolean).join(' · ');
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      resolve(value.includes(',') ? value.split(',').pop() ?? '' : value);
    };
    reader.readAsDataURL(file);
  });
}

export function uploadedArtifactId(uploaded: unknown): string {
  return firstString(asRecord(uploaded).artifact, ['id', 'artifactId'])
    || firstString(uploaded, ['artifactId', 'id']);
}

export function roleOf(message: unknown): string {
  return firstString(message, ['role', 'author', 'kind', 'source']) || 'message';
}

export function messageTone(message: unknown): string {
  const role = roleOf(message).toLowerCase();
  if (role.includes('user')) return 'user';
  if (role.includes('assistant') || role.includes('agent') || role.includes('model')) return 'assistant';
  if (role.includes('system')) return 'system';
  return 'neutral';
}

export function messageTimestamp(message: unknown): string {
  const record = asRecord(message);
  return formatRelative(record.createdAt ?? record.timestamp ?? record.time);
}

export function messageCreatedAt(message: unknown): number {
  const record = asRecord(message);
  if (typeof record.createdAt === 'number') return record.createdAt;
  if (typeof record.timestamp === 'number') return record.timestamp;
  if (typeof record.time === 'number') return record.time;
  return 0;
}

export function assistantContentFromCompletedTurn(payload: unknown, fallback: string): string {
  const envelope = asRecord(asRecord(payload).envelope);
  return firstString(envelope, ['body', 'content', 'text', 'message'])
    || firstString(payload, ['body', 'content', 'text', 'message', 'response'])
    || fallback;
}

export function companionEventType(eventName: string, payload: unknown): string {
  return firstString(payload, ['type']) || eventName.replace(/^companion-chat\./, '');
}

export const ACTIVE_TURN_STATES = ['sending', 'submitted', 'running', 'streaming', 'tooling'];

export function deliveryState(message: unknown): 'sent' | 'failed' | 'local' | '' {
  const state = firstString(message, ['deliveryState', 'status', 'state']).toLowerCase();
  if (state.includes('fail') || state.includes('error')) return 'failed';
  if (state.includes('local') || state.includes('pending')) return 'local';
  if (messageTone(message) === 'user') return 'sent';
  return '';
}

export { bestId };
