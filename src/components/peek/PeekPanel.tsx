/**
 * PeekPanel — right-side slide-over panel.
 *
 * Exports:
 *   PeekProvider   — wrap the app shell to enable peek
 *   usePeek()      — { open, close, isOpen } per TOKEN-CONTRACT.md
 *   PeekPanel      — the rendered panel (consumed by PeekProvider internally)
 *
 * Features:
 *   - Closes on Escape key
 *   - Closes on backdrop click
 *   - Focus trapped inside while open (first focusable element auto-focused)
 *   - Returns focus to trigger element on close
 *   - Honors prefers-reduced-motion via CSS
 *   - Uses --z-peek token
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import '../../styles/components/peek.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PeekContent {
  title: string;
  content: ReactNode;
}

interface PeekContextValue {
  open: (payload: PeekContent) => void;
  close: () => void;
  isOpen: boolean;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const PeekContext = createContext<PeekContextValue | null>(null);

// ---------------------------------------------------------------------------
// Hook — public API (TOKEN-CONTRACT.md: usePeek() => { open, close, isOpen })
// ---------------------------------------------------------------------------

export function usePeek(): PeekContextValue {
  const ctx = useContext(PeekContext);
  if (!ctx) {
    throw new Error('usePeek must be used within a PeekProvider');
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Focusable element selectors
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// PeekPanel component (internal)
// ---------------------------------------------------------------------------

interface PeekPanelProps {
  payload: PeekContent | null;
  isOpen: boolean;
  onClose: () => void;
}

function PeekPanelInner({ payload, isOpen, onClose }: PeekPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  // Capture trigger element when opening
  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement;
    }
  }, [isOpen]);

  // Focus first focusable element inside panel when open
  useEffect(() => {
    if (!isOpen || !panelRef.current) return;
    const focusable = getFocusableElements(panelRef.current);
    if (focusable.length > 0) {
      focusable[0].focus();
    } else {
      panelRef.current.focus();
    }
  }, [isOpen, payload]);

  // Return focus to trigger element on close
  useEffect(() => {
    if (!isOpen && triggerRef.current instanceof HTMLElement) {
      triggerRef.current.focus();
      triggerRef.current = null;
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Trap focus within panel (wrap at edges + stray-focus recovery)
  useEffect(() => {
    if (!isOpen || !panelRef.current) return;
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
      } else {
        if (document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    // Stray-focus recovery: if focus escapes the panel entirely, pull it back.
    function handleFocusIn(event: FocusEvent): void {
      if (panel.contains(event.target as Node | null)) return;
      const focusable = getFocusableElements(panel);
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        panel.focus();
      }
    }

    window.addEventListener('keydown', handleTab);
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      window.removeEventListener('keydown', handleTab);
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, [isOpen]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`peek-backdrop${isOpen ? ' peek-backdrop--open' : ''}`}
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={payload?.title ?? 'Details'}
        tabIndex={-1}
        className={`peek-panel${isOpen ? ' peek-panel--open' : ''}`}
      >
        <div className="peek-header">
          <h2 className="peek-title">{payload?.title}</h2>
          <button
            type="button"
            className="peek-close"
            aria-label="Close panel"
            onClick={onClose}
          >
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
            >
              <path
                d="M3 3l10 10M13 3L3 13"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="peek-body">
          {payload?.content}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// PeekProvider
// ---------------------------------------------------------------------------

interface PeekProviderProps {
  children: ReactNode;
}

// Duration to keep the payload mounted after close, so the exit animation
// completes before unmounting. Matches --motion-base (180 ms) + buffer.
// Under prefers-reduced-motion the CSS sets transition: none, so 0 ms suffices;
// we use the longer value as a safe upper bound for both cases.
const PEEK_EXIT_DELAY_MS = 320;

export function PeekProvider({ children }: PeekProviderProps) {
  const [payload, setPayload] = useState<PeekContent | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback((next: PeekContent): void => {
    setPayload(next);
    setIsOpen(true);
  }, []);

  const close = useCallback((): void => {
    setIsOpen(false);
    // Keep payload mounted until exit animation ends.
    setTimeout(() => setPayload(null), PEEK_EXIT_DELAY_MS);
  }, []);

  const value: PeekContextValue = { open, close, isOpen };

  return (
    <PeekContext.Provider value={value}>
      {children}
      <PeekPanelInner payload={payload} isOpen={isOpen} onClose={close} />
    </PeekContext.Provider>
  );
}

// Public re-export for consumers who need the inner panel type
export { PeekPanelInner as PeekPanel };
