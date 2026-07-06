/**
 * Modal — a generic centered dialog: the "configuration surface" machinery
 * this repo doesn't have yet. PeekPanel (src/components/peek/PeekPanel.tsx)
 * is a right-side slide-over for look-something-up/overlay reads; CommandPalette
 * is command-specific. Neither is an open-change-close configuration surface.
 * Model Workspace and Settings both need one, so it lives here rather than
 * being duplicated per-consumer.
 *
 * Unmounts entirely when closed (mirrors CommandPalette's `if (!open) return
 * null`, not PeekPanel's keep-mounted-for-exit-animation approach) — simpler,
 * and it means a consumer's data queries never fire while the modal is closed.
 *
 * Accessibility: role="dialog" + aria-modal, focus moves to the first
 * focusable element on open and returns to the trigger on close, Tab is
 * trapped inside, Escape and backdrop-click both close.
 */
import { useCallback, useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import '../../styles/components/modal.css';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest('[aria-hidden="true"]'),
  );
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Optional trailing header content (e.g. a target switcher), before the close button. */
  headerExtra?: ReactNode;
  size?: 'md' | 'lg';
}

export function Modal({ open, onClose, title, children, headerExtra, size = 'md' }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    triggerRef.current = document.activeElement;
    return () => {
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus();
      triggerRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !panelRef.current) return;
    const focusable = getFocusableElements(panelRef.current);
    (focusable[0] ?? panelRef.current).focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !panelRef.current) return undefined;
    const panel = panelRef.current;

    function handleTab(event: KeyboardEvent): void {
      if (event.key !== 'Tab') return;
      const focusable = getFocusableElements(panel);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function handleFocusIn(event: FocusEvent): void {
      if (panel.contains(event.target as Node | null)) return;
      const focusable = getFocusableElements(panel);
      (focusable[0] ?? panel).focus();
    }

    window.addEventListener('keydown', handleTab);
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      window.removeEventListener('keydown', handleTab);
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, [open]);

  const handleBackdropClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose],
  );

  if (!open) return null;

  // Backdrop and panel are SIBLINGS, not parent/child (mirrors PeekPanel's structure) —
  // aria-hidden on the backdrop must never be an ANCESTOR of the dialog, or the whole
  // dialog subtree is excluded from the accessibility tree too (aria-hidden is
  // inherited by descendants). A wrapping fixed-position container positions both.
  return (
    <div className="modal-root">
      <div className="modal-backdrop" aria-hidden="true" onClick={handleBackdropClick} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`modal-panel modal-panel--${size}`}
      >
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <div className="modal-header-actions">
            {headerExtra}
            <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
