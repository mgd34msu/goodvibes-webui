/**
 * ChatSearch — cross-session message search panel.
 *
 * Exposes an `onSelect` callback: ({ sessionId, messageId }) => void.
 * Integration: wire this to setSession + scroll in the ChatView/parent;
 * this component does NOT mutate URL state directly.
 *
 * Keyboard navigation:
 *   ArrowDown / ArrowUp — move selection
 *   Enter               — activate selected result
 *   Escape              — clear query (caller can use to close the panel)
 */

import { type ChangeEvent, type KeyboardEvent, useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { EmptyState } from '../../components/feedback/EmptyState';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';
import type { ChatSearchResult } from './useChatSearch';
import { useChatSearch } from './useChatSearch';
import '../../styles/components/chat-search.css';

export interface ChatSearchSelectPayload {
  sessionId: string;
  messageId: string;
}

export interface ChatSearchProps {
  /** Pre-fetched sessions list (passed through to useChatSearch). */
  sessions: unknown[];
  /** Called when the user activates a result. */
  onSelect: (payload: ChatSearchSelectPayload) => void;
  /** Optional CSS class on the root element. */
  className?: string;
}

/** Relative time label for a result. */
function relativeTime(ms?: number): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ChatSearch({ sessions, onSelect, className }: ChatSearchProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputId = useId();
  const listId = useId();

  const { results, isSearching } = useChatSearch(query, sessions);

  // Reset active index when results change
  const prevResultsLen = useRef(results.length);
  // eslint-disable-next-line react-hooks/refs -- documented derived-state-during-render guard, intentional
  if (results.length !== prevResultsLen.current) {
    setActiveIndex(-1);
    // eslint-disable-next-line react-hooks/refs -- documented derived-state-during-render guard, intentional
    prevResultsLen.current = results.length;
  }

  const handleInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  }, []);

  const handleSelect = useCallback(
    (result: ChatSearchResult) => {
      onSelect({ sessionId: result.sessionId, messageId: result.messageId });
    },
    [onSelect],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!results.length) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < results.length) {
          handleSelect(results[activeIndex]);
        } else if (results.length > 0) {
          handleSelect(results[0]);
        }
      } else if (e.key === 'Escape') {
        setQuery('');
      }
    },
    [results, activeIndex, handleSelect],
  );

  // Scroll active item into view — in a layout effect to avoid DOM mutations during render.
  useLayoutEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const item = listRef.current.children[activeIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  const showSkeleton = isSearching && results.length === 0;
  const showEmpty = !isSearching && query.trim().length > 0 && results.length === 0;
  const showResults = results.length > 0;

  return (
    <div
      className={['chat-search', className].filter(Boolean).join(' ')}
      role="search"
      aria-label="Search chat history"
    >
      <div className="chat-search__input-row">
        <label htmlFor={inputId} className="chat-search__label">
          Search messages
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          className="chat-search__input"
          placeholder="Search across all sessions…"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          role="combobox"
          autoComplete="off"
          aria-label="Search messages"
          aria-controls={listId}
          aria-activedescendant={
            activeIndex >= 0 ? `chat-search-result-${activeIndex}` : undefined
          }
          aria-autocomplete="list"
          aria-expanded={showResults || showSkeleton}
        />
        {isSearching && (
          <span className="chat-search__spinner" aria-label="Searching…" role="status" />
        )}
      </div>

      {showSkeleton && (
        <div className="chat-search__skeleton" aria-busy="true" aria-label="Loading results">
          <SkeletonBlock variant="text" lines={3} />
        </div>
      )}

      {showEmpty && (
        <EmptyState
          title="No results"
          description={`No messages match “${query}”`}
          className="chat-search__empty"
        />
      )}

      {showResults && (
        <ul
          ref={listRef}
          id={listId}
          className="chat-search__results"
          role="listbox"
          aria-label="Search results"
        >
          {results.map((result, index) => {
            const isActive = index === activeIndex;
            const time = relativeTime(result.createdAt);
            return (
              <li
                key={`${result.sessionId}-${result.messageId}-${index}`}
                id={`chat-search-result-${index}`}
                role="option"
                aria-selected={isActive}
                className={[
                  'chat-search__result',
                  isActive ? 'chat-search__result--active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => handleSelect(result)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelect(result);
                  }
                }}
                tabIndex={0}
              >
                <div className="chat-search__result-meta">
                  <span className="chat-search__result-session">{result.sessionTitle}</span>
                  {time && (
                    <span className="chat-search__result-time" aria-label={`Posted ${time}`}>
                      {time}
                    </span>
                  )}
                </div>
                <p className="chat-search__result-snippet">{result.snippet}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
