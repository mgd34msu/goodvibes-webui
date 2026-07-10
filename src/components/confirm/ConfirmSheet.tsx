/**
 * ConfirmSheet — a touch-first confirmation surface for a mutating action.
 *
 * On a phone it renders as a bottom sheet (thumb-reachable, full-width Confirm/
 * Cancel that clear the 44px touch floor); on desktop it centers as a small
 * alert dialog. It states the action name, the target it acts on, and (when the
 * action is consequential) a one-line description — so a Confirm tap is always
 * an informed one.
 *
 * Presentational only: it renders when `open` and calls onConfirm/onCancel. The
 * caller runs the mutation AFTER onConfirm resolves the sheet (mirroring the
 * window.confirm pattern it replaces), so no busy state lives here — the caller
 * owns its own pending UI. Escape and a backdrop tap both cancel.
 *
 * role="alertdialog" + focus trap + labelled title/description keep it usable by
 * keyboard and screen reader; the primary action is focused on open.
 */
import { useEffect, useId, useRef } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import '../../styles/components/confirm-sheet.css';

export interface ConfirmSheetProps {
  open: boolean;
  /** The action, imperative and short: "Restore this checkpoint", "Cancel task". */
  title: string;
  /** What the action acts on (a checkpoint label, a task title). */
  target?: string;
  /** One line of consequence, for a destructive or irreversible action. */
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmSheet({
  open,
  title,
  target,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return undefined;
    confirmRef.current?.focus();
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

  return (
    <div className="confirm-sheet-root">
      <div className="confirm-sheet-backdrop" aria-hidden="true" onClick={onCancel} />
      <div
        ref={trapRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={`confirm-sheet confirm-sheet--${tone}`}
      >
        <h2 id={titleId} className="confirm-sheet__title">{title}</h2>
        {target && <p className="confirm-sheet__target">{target}</p>}
        {description && <p id={descId} className="confirm-sheet__desc">{description}</p>}
        <div className="confirm-sheet__actions">
          <button type="button" className="confirm-sheet__cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`confirm-sheet__confirm confirm-sheet__confirm--${tone}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
