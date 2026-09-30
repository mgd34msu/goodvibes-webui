import { X } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRightPanel } from '../shell/ShellContext';
import { IconButton } from './IconButton';
import { useModalFocus } from './overlay';
import '../../styles/components/ui.css';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: 'left' | 'right';
  /** Accessible name; also the header title when `title` is not given. */
  label: string;
  title?: ReactNode;
  /** Panel width in px (right peek drawers are 440). A CSS length is also accepted. */
  width?: number | string;
  /**
   * Modal drawers sit over the scrim and trap focus (the phone navigation drawer).
   * Non-modal drawers leave the page usable (a right-side peek).
   */
  modal?: boolean;
  /** Render the default header (title and close button). */
  header?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Side drawer on glass. A right drawer tells the shell a right panel is open, so
 * the sidebar folds to its rail while it is; on a phone it becomes a bottom sheet.
 */
export function Drawer({
  open,
  onClose,
  side = 'right',
  label,
  title,
  width = side === 'right' ? 440 : '85%',
  modal = side === 'left',
  header = true,
  className,
  children,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useModalFocus(open && modal, panelRef);
  const numericWidth = typeof width === 'number' ? width : undefined;
  useRightPanel(open && side === 'right', { width: numericWidth, force: numericWidth === undefined });

  // A non-modal drawer still takes focus on open and gives it back on close.
  useEffect(() => {
    if (!open || modal) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open, modal]);

  if (!open || typeof document === 'undefined') return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return createPortal(
    <div className={modal ? 'gv-overlay' : 'gv-overlay gv-overlay--passthrough'} data-gv-layer="">
      {modal && <div className="scrim" aria-hidden="true" onClick={onClose} />}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={modal || undefined}
        aria-label={label}
        tabIndex={-1}
        className={['glass', 'gv-drawer', `gv-drawer--${side}`, className ?? ''].filter(Boolean).join(' ')}
        style={{ width: typeof width === 'number' ? `min(${width}px, 100vw)` : width }}
        onKeyDown={onKeyDown}
      >
        {header && (
          <div className="gv-drawer__header">
            <h2 className="gv-drawer__title">{title ?? label}</h2>
            <IconButton label="Close" icon={<X />} onClick={onClose} noTooltip />
          </div>
        )}
        <div className="gv-drawer__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
