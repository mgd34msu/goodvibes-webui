import { asRecord, bestId, firstString, readPath } from './object';

export const COMPANION_CHAT_RECENT_SESSIONS_KEY = 'goodvibes.webui.companionChat.sessions';
export const COMPANION_CHAT_RECENT_SESSION_LIMIT = 24;

export interface LocalCompanionMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
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

export function loadRecentCompanionSessionIds(storage: Pick<Storage, 'getItem'> | undefined): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(COMPANION_CHAT_RECENT_SESSIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

export function saveRecentCompanionSessionIds(storage: Pick<Storage, 'setItem'> | undefined, ids: string[]) {
  if (!storage) return;
  try {
    storage.setItem(COMPANION_CHAT_RECENT_SESSIONS_KEY, JSON.stringify(ids));
  } catch {
    // Browsers can deny storage in private or hardened contexts; chat should still work.
  }
}

export function prependRecentCompanionSessionId(
  ids: string[],
  sessionId: string,
  limit = COMPANION_CHAT_RECENT_SESSION_LIMIT,
): string[] {
  const trimmed = sessionId.trim();
  if (!trimmed) return ids;
  return [trimmed, ...ids.filter((id) => id !== trimmed)].slice(0, limit);
}

export function removeRecentCompanionSessionIds(ids: string[], removedIds: string[]): string[] {
  const removed = new Set(removedIds);
  return ids.filter((id) => !removed.has(id));
}

export function mergeCompanionSessions(
  localSessions: LocalCompanionSession[],
  fetchedSessions: unknown[],
  recentSessionIds: string[],
): unknown[] {
  const byId = new Map<string, unknown>();
  for (const session of localSessions) byId.set(session.id, session);
  for (const session of fetchedSessions) {
    const id = extractSessionId(session);
    if (id) byId.set(id, session);
  }

  const ordered = recentSessionIds
    .map((id) => byId.get(id))
    .filter((session): session is unknown => Boolean(session));
  const orderedIds = new Set(ordered.map(extractSessionId));
  const rest = [...byId.values()].filter((session) => !orderedIds.has(extractSessionId(session)));
  return [...ordered, ...rest];
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
    rendered.push(message);
  }
  return rendered;
}
