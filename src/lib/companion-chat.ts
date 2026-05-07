import { asRecord, bestId, firstString, readPath } from './object';
import type { ModelOption } from './provider-models';

export const COMPANION_CHAT_RECENT_SESSIONS_KEY = 'goodvibes.webui.companionChat.sessions';
export const COMPANION_CHAT_RECENT_SESSION_LIMIT = 24;

export interface CompanionRoute {
  provider: string;
  model: string;
}

export interface LocalCompanionMessage {
  id: string;
  sessionId: string;
  role: 'user';
  content: string;
  createdAt: number;
}

export function companionRouteFromModelOption(model: ModelOption | undefined): CompanionRoute | null {
  if (!model?.providerId || !model.rawModelId) return null;
  return {
    provider: model.providerId,
    model: model.rawModelId,
  };
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
