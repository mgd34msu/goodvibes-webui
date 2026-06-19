/**
 * useChatSearch — cross-session message search hook.
 *
 * Search mechanism: client-side. No dedicated search endpoint exists in the SDK.
 * Sessions are passed in by the caller (already fetched via TanStack Query).
 * Messages are fetched lazily per-session on first query, then cached in a ref
 * Map to avoid redundant network requests. The cache is keyed by sessionId and
 * reset whenever the sessions list identity changes (new sessions or count).
 *
 * Returns ranked results ordered by createdAt descending (most recent first).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { sdk } from '../../lib/goodvibes';
import {
  companionMessagesFromListResponse,
  extractMessageId,
  extractSessionId,
} from '../../lib/companion-chat';
import { firstString } from '../../lib/object';
import type { ChatMessage } from './types';

/** A single search result referencing a specific message. */
export interface ChatSearchResult {
  sessionId: string;
  messageId: string;
  /** Up to 160-character extract around the matched term. */
  snippet: string;
  /** Display title for the containing session. */
  sessionTitle: string;
  /** Message creation timestamp (epoch ms), if known. */
  createdAt?: number;
}

/** The value returned from useChatSearch. */
export interface UseChatSearchReturn {
  /** Filtered, ranked results for the current query. */
  results: ChatSearchResult[];
  /** True while messages are being fetched for an active query. */
  isSearching: boolean;
}

/** Messages keyed by sessionId. */
type MessageCache = Map<string, ChatMessage[]>;

const SNIPPET_CONTEXT = 80;
const DEBOUNCE_MS = 300;
const MAX_SNIPPET_LENGTH = 160;

/** Extract a short snippet centred on the first occurrence of `term`. */
function buildSnippet(text: string, term: string): string {
  const lower = text.toLowerCase();
  const termLower = term.toLowerCase();
  const idx = lower.indexOf(termLower);
  if (idx === -1) return text.slice(0, MAX_SNIPPET_LENGTH);
  const start = Math.max(0, idx - SNIPPET_CONTEXT);
  const end = Math.min(text.length, idx + term.length + SNIPPET_CONTEXT);
  const excerpt = text.slice(start, end);
  return (start > 0 ? '…' : '') + excerpt + (end < text.length ? '…' : '');
}

/** Extract a displayable title from a raw session object. */
function extractSessionTitle(session: unknown): string {
  return firstString(session, ['title', 'name', 'label']) || 'Untitled session';
}

/** Extract the primary text content from a ChatMessage. */
function messageText(msg: ChatMessage): string {
  const direct = msg.content ?? msg.text ?? msg.body ?? msg.message ?? msg.delta ?? '';
  if (direct) return String(direct);
  if (Array.isArray(msg.parts)) {
    return msg.parts
      .map((p) => p.text ?? p.content ?? p.body ?? '')
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

/** Fetch messages for a single session, returning typed ChatMessage[]. */
async function fetchMessages(sessionId: string): Promise<ChatMessage[]> {
  const raw = await sdk.operator.sessions.messages.list(sessionId);
  const items = companionMessagesFromListResponse(raw);
  return items.map((item) => item as ChatMessage);
}

/**
 * Hook that searches across all companion chat sessions/messages.
 *
 * @param query   - The raw search string (hook debounces internally).
 * @param sessions - Pre-fetched session list from the caller's TanStack Query.
 */
export function useChatSearch(
  query: string,
  sessions: unknown[],
): UseChatSearchReturn {
  const [results, setResults] = useState<ChatSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Persistent message cache — keyed by sessionId, reset when sessions identity changes.
  const cacheRef = useRef<MessageCache>(new Map());
  // Abort controller to cancel stale searches.
  const abortRef = useRef<AbortController | null>(null);

  // Invalidate message cache when sessions list changes (different count or ids).
  const sessionsKey = sessions
    .map((s) => extractSessionId(s) ?? '')
    .join(',');
  const prevSessionsKeyRef = useRef(sessionsKey);
  if (sessionsKey !== prevSessionsKeyRef.current) {
    prevSessionsKeyRef.current = sessionsKey;
    cacheRef.current = new Map();
  }

  const runSearch = useCallback(
    async (term: string, signal: AbortSignal): Promise<void> => {
      if (!term.trim()) {
        setResults([]);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      const termLower = term.toLowerCase();
      const found: ChatSearchResult[] = [];

      for (const session of sessions) {
        if (signal.aborted) break;

        const sessionId = extractSessionId(session);
        if (!sessionId) continue;

        const sessionTitle = extractSessionTitle(session);

        // Fetch messages (cached)
        let messages = cacheRef.current.get(sessionId);
        if (!messages) {
          try {
            messages = await fetchMessages(sessionId);
            if (!signal.aborted) {
              cacheRef.current.set(sessionId, messages);
            }
          } catch {
            continue; // Skip sessions whose messages can't be loaded
          }
        }

        if (signal.aborted) break;

        for (const msg of messages) {
          const text = messageText(msg);
          if (!text) continue;
          if (!text.toLowerCase().includes(termLower)) continue;

          const messageId = extractMessageId(msg) || '';
          const snippet = buildSnippet(text, term);
          const createdAt = msg.createdAt ?? msg.timestamp ?? msg.time;

          found.push({
            sessionId,
            messageId,
            snippet,
            sessionTitle,
            createdAt: typeof createdAt === 'number' ? createdAt : undefined,
          });
        }
      }

      if (!signal.aborted) {
        // Sort: most recent sessions first
        found.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
        setResults(found);
        setIsSearching(false);
      }
    },
    [sessions],
  );

  useEffect(() => {
    // Abort any pending search
    abortRef.current?.abort();

    if (!query.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    const timer = window.setTimeout(() => {
      void runSearch(query, controller.signal);
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
      abortRef.current = null;
    };
  }, [query, runSearch]);

  return { results, isSearching };
}
