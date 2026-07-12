/**
 * CommandPalette
 *
 * ⌘K-triggered fuzzy-searchable palette over the command registry.
 * Keyboard nav: ↑↓ to move, Enter to run, Esc to close.
 * Groups results under section headers.
 * Shows shortcut hints per command.
 *
 * Focus management: implemented inline via onKeyDown on the overlay element.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type CommandDef,
  filterCommands,
  getCommands,
  subscribeCommands,
} from '../../lib/commands';
import { buildGroups, GROUP_LABELS } from '../../lib/command-groups';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [allCommands, setAllCommands] = useState<CommandDef[]>(() => getCommands());
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Subscribe to registry changes
  useEffect(() => {
    const unsub = subscribeCommands(() => setAllCommands(getCommands()));
    return unsub;
  }, []);

  const filteredCommands = useMemo(
    () => filterCommands(allCommands, query),
    [allCommands, query],
  );

  // Reset state when palette opens
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      // Focus the input on next tick so DOM is ready
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Keep active index in bounds
  useEffect(() => {
    if (activeIndex >= filteredCommands.length) {
      setActiveIndex(Math.max(0, filteredCommands.length - 1));
    }
  }, [filteredCommands.length, activeIndex]);

  // Scroll active item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector('[aria-selected="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // Focus trap: keep Tab inside the overlay
  const handleOverlayKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const cmd = filteredCommands[activeIndex];
        if (cmd) {
          onClose();
          cmd.run();
        }
        return;
      }
      if (event.key === 'Tab') {
        // Keep focus inside the palette
        event.preventDefault();
        setActiveIndex((i) =>
          event.shiftKey
            ? Math.max(i - 1, 0)
            : Math.min(i + 1, filteredCommands.length - 1),
        );
      }
    },
    [activeIndex, filteredCommands, onClose],
  );

  // Close on backdrop click
  const handleBackdropClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose],
  );

  if (!open) return null;

  // Build grouped sections
  const grouped = buildGroups(filteredCommands);

  return (
    <div
      className="cmd-backdrop"
      role="presentation"
      onClick={handleBackdropClick}
    >
      <div
        ref={overlayRef}
        className="cmd-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={handleOverlayKeyDown}
      >
        <div className="cmd-search-row">
          <input
            ref={inputRef}
            className="cmd-input"
            type="text"
            placeholder="Search commands…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            aria-label="Search commands"
            aria-autocomplete="list"
            aria-controls="cmd-listbox"
            aria-activedescendant={
              filteredCommands[activeIndex]
                ? `cmd-item-${filteredCommands[activeIndex].id}`
                : undefined
            }
          />
        </div>

        {filteredCommands.length === 0 ? (
          <div className="cmd-empty">No commands match "{query}"</div>
        ) : (
          <ul
            ref={listRef}
            id="cmd-listbox"
            className="cmd-list"
            role="listbox"
            aria-label="Commands"
          >
            {grouped.map(({ group, commands }) => (
              <li
                key={group}
                className="cmd-group"
                role="group"
                aria-labelledby={`cmd-group-label-${group}`}
              >
                <div
                  id={`cmd-group-label-${group}`}
                  className="cmd-group-label"
                >
                  {GROUP_LABELS[group] ?? group}
                </div>
                {commands.map((cmd) => {
                  const globalIndex = filteredCommands.indexOf(cmd);
                  const isActive = globalIndex === activeIndex;
                  return (
                    <div
                      key={cmd.id}
                      id={`cmd-item-${cmd.id}`}
                      className={isActive ? 'cmd-item cmd-item--active' : 'cmd-item'}
                      role="option"
                      aria-selected={isActive}
                      onClick={() => {
                        onClose();
                        cmd.run();
                      }}
                      onMouseEnter={() => setActiveIndex(globalIndex)}
                    >
                      <span className="cmd-item-title">{cmd.title}</span>
                      {cmd.shortcut && (
                        <kbd className="cmd-item-kbd">{cmd.shortcut}</kbd>
                      )}
                    </div>
                  );
                })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}


