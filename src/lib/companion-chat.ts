import { asRecord, bestId, firstString, readPath } from './object';

export interface LocalCompanionMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  deliveryState?: 'sent' | 'failed' | 'local';
}

export interface LocalCompanionSession {
  id: string;
  sessionId: string;
  kind: 'companion-chat';
  title: string;
  status: 'active';
  createdAt: number;
  updatedAt: number;
}

export function extractSessionId(value: unknown): string {
  const direct = firstString(value, ['sessionId', 'id']);
  if (direct) return direct;
  return firstString(readPath(value, ['session']), ['sessionId', 'id'])
    || firstString(readPath(value, ['data']), ['sessionId', 'id'])
    || bestId(value);
}

export function extractMessageId(value: unknown): string {
  return firstString(value, ['messageId', 'id'])
    || firstString(readPath(value, ['message']), ['messageId', 'id'])
    || bestId(value);
}

export function companionSessionFromDetail(value: unknown): unknown {
  const session = readPath(value, ['session']);
  return Object.keys(asRecord(session)).length ? session : value;
}

export function mergeCompanionSessions(
  localSessions: unknown[],
  fetchedSessions: unknown[],
): unknown[] {
  const byId = new Map<string, unknown>();
  for (const session of localSessions) {
    const id = extractSessionId(session);
    if (id) byId.set(id, session);
  }
  for (const session of fetchedSessions) {
    const id = extractSessionId(session);
    if (id) byId.set(id, session);
  }

  return [...byId.values()].sort((left, right) => {
    const leftUpdated = Number(asRecord(left).updatedAt ?? asRecord(left).createdAt ?? 0);
    const rightUpdated = Number(asRecord(right).updatedAt ?? asRecord(right).createdAt ?? 0);
    return rightUpdated - leftUpdated;
  });
}

function comparableMessageText(message: unknown): string {
  return firstString(message, ['body', 'content', 'text', 'message']).trim();
}

function comparableMessageRole(message: unknown): string {
  return firstString(message, ['role', 'author', 'kind', 'source']).toLowerCase();
}

export function mergeCompanionMessages(
  fetchedMessages: unknown[],
  localMessages: LocalCompanionMessage[],
  sessionId: string,
): unknown[] {
  const rendered = [...fetchedMessages];
  const fetchedIds = new Set(fetchedMessages.map(extractMessageId).filter(Boolean));
  for (const message of localMessages) {
    if (message.sessionId !== sessionId) continue;
    if (fetchedIds.has(message.id)) continue;
    const localText = comparableMessageText(message);
    const localRole = comparableMessageRole(message);
    const alreadyFetched = fetchedMessages.some((fetched) => (
      comparableMessageText(fetched) === localText
      && comparableMessageRole(fetched) === localRole
    ));
    if (alreadyFetched) continue;
    rendered.push(message);
  }
  return rendered;
}
