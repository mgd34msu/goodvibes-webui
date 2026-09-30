import { X } from 'lucide-react';
import { useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './IconButton';
import { useModalFocus } from './overlay';
import '../../styles/components/ui.css';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  /** confirm: 420 wide. default: 560. large: 880 by 640 (the settings dialog). */
  size?: 'confirm' | 'default' | 'large';
  /** Right-aligned buttons: secondary Cancel, then the one primary or danger action. */
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Hide the close button (confirm dialogs that already have Cancel). */
  hideClose?: boolean;
  children?: ReactNode;
}

/**
 * Modal dialog: glass, 16 radius, centered over the scrim; a bottom sheet with
 * a grabber on phones. Focus is trapped and returned on close; Escape and a
 * scrim click close it.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  size = 'default',
  footer,
  initialFocusRef,
  hideClose = false,
  children,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  useModalFocus(open, panelRef, initialFocusRef);

  if (!open || typeof document === 'undefined') return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  const sizeClass = size === 'confirm' ? 'gv-dialog--confirm' : size === 'large' ? 'gv-dialog--large' : '';
  return createPortal(
    <div className="gv-overlay" data-gv-layer="">
      <div className="scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={['glass', 'gv-dialog', sizeClass].filter(Boolean).join(' ')}
        onKeyDown={onKeyDown}
      >
        <div className="gv-dialog__header">
          <div className="gv-dialog__titles">
            <h2 id={titleId} className="gv-dialog__title">{title}</h2>
            {description && <p id={descriptionId} className="gv-dialog__description">{description}</p>}
          </div>
          {!hideClose && <IconButton label="Close" icon={<X />} onClick={onClose} noTooltip />}
        </div>
        {children && <div className="gv-dialog__body">{children}</div>}
        {footer && <div className="gv-dialog__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
