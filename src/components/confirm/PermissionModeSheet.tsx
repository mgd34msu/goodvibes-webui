/**
 * PermissionModeSheet — a touch-first picker for a session's permission mode.
 *
 * Same surface as ConfirmSheet (centered dialog on desktop, bottom sheet on a
 * phone; shares confirm-sheet.css and the focus-trap/Escape/backdrop behavior)
 * but offers a list of mode choices instead of a single confirm/cancel pair —
 * the "existing confirm-sheet pattern" the session-view permission-mode control
 * reuses. Presentational only: the caller runs the sessions.permissionMode.set
 * mutation after onSelect fires and owns pendingMode (disables the sheet while
 * a write is in flight, matching ConfirmSheet's "caller owns the mutation"
 * contract).
 *
 * Only SETTABLE_PERMISSION_MODES render as choices — 'custom' is a read-only
 * wire state (a bespoke rule set), never a value `sessions.permissionMode.set`
 * accepts (lib/permission-mode.ts). If the session is currently in custom mode,
 * none of the rendered options is highlighted as current, which is honest: none
 * of them IS the current mode.
 */
import { useEffect, useId, useRef } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { SETTABLE_PERMISSION_MODES, permissionModeLabel, type SettablePermissionMode } from '../../lib/permission-mode';
import '../../styles/components/confirm-sheet.css';

export interface PermissionModeSheetProps {
  open: boolean;
  /** '' when the current mode has not been read from the daemon yet. */
  currentMode: string;
  /** The mode a write is currently in flight for, if any — disables the list. */
  pendingMode?: string;
  onSelect: (mode: SettablePermissionMode) => void;
  onCancel: () => void;
}

export function PermissionModeSheet({ open, currentMode, pendingMode, onSelect, onCancel }: PermissionModeSheetProps) {
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return undefined;
    firstOptionRef.current?.focus();
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;
  const busy = Boolean(pendingMode);

  return (
    <div className="confirm-sheet-root">
      <div className="confirm-sheet-backdrop" aria-hidden="true" onClick={onCancel} />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="confirm-sheet"
      >
        <h2 id={titleId} className="confirm-sheet__title">Set permission mode</h2>
        <p id={descId} className="confirm-sheet__desc">
          Applies to this session&apos;s live runtime. Only available while this session
          is the daemon&apos;s own live local session.
        </p>
        <div className="confirm-sheet__actions permission-mode-sheet__options">
          {SETTABLE_PERMISSION_MODES.map((mode, index) => (
            <button
              key={mode}
              ref={index === 0 ? firstOptionRef : undefined}
              type="button"
              disabled={busy}
              aria-pressed={mode === currentMode}
              className={`confirm-sheet__cancel permission-mode-sheet__option${mode === currentMode ? ' permission-mode-sheet__option--current' : ''}`}
              onClick={() => onSelect(mode)}
            >
              {permissionModeLabel(mode)}
              {mode === pendingMode ? '…' : ''}
            </button>
          ))}
        </div>
        <div className="confirm-sheet__actions">
          <button type="button" className="confirm-sheet__cancel" onClick={onCancel} disabled={busy}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
