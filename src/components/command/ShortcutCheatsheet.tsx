/**
 * ShortcutCheatsheet
 *
 * Overlay triggered by pressing "?" that lists all registered
 * commands that have a shortcut defined, grouped by category.
 * Dismiss with Escape or clicking the backdrop.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type CommandDef, getCommands, subscribeCommands } from '../../lib/commands';
import { buildGroups, GROUP_LABELS } from '../../lib/command-groups';

interface ShortcutCheatsheetProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutCheatsheet({ open, onClose }: ShortcutCheatsheetProps) {
  const [allCommands, setAllCommands] = useState<CommandDef[]>(() => getCommands());
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = subscribeCommands(() => setAllCommands(getCommands()));
    return unsub;
  }, []);

  // Focus overlay on open so Escape fires
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => overlayRef.current?.focus());
    }
  }, [open]);

  const withShortcuts = useMemo(
    () => allCommands.filter((cmd) => Boolean(cmd.shortcut)),
    [allCommands],
  );

  const grouped = useMemo(() => buildGroups(withShortcuts), [withShortcuts]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') onClose();
    },
    [onClose],
  );

  const handleBackdropClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div
      className="cheat-backdrop"
      role="presentation"
      onClick={handleBackdropClick}
    >
      <div
        ref={overlayRef}
        className="cheat-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="cheat-header">
          <h2 className="cheat-title">Keyboard Shortcuts</h2>
          <button
            className="cheat-close"
            type="button"
            aria-label="Close shortcuts"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="cheat-body">
          {grouped.length === 0 ? (
            <p className="cheat-empty">No shortcuts registered.</p>
          ) : (
            grouped.map(({ group, commands }) => (
              <section key={group} className="cheat-group">
                <h3 className="cheat-group-label">
                  {GROUP_LABELS[group] ?? group}
                </h3>
                <dl className="cheat-list">
                  {commands.map((cmd) => (
                    <div key={cmd.id} className="cheat-row">
                      <dt className="cheat-action">{cmd.title}</dt>
                      <dd className="cheat-keys">
                        <kbd>{cmd.shortcut}</kbd>
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}


