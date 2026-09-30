import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { useFloatingPosition, type Placement } from './overlay';
import '../../styles/components/ui.css';

export interface TooltipProps {
  content: ReactNode;
  /** Keyboard hint shown after the text, e.g. "Ctrl K". */
  shortcut?: string;
  placement?: Placement;
  /** Hover delay before showing. Focus shows immediately. */
  delayMs?: number;
  /**
   * When true the tooltip only repeats the trigger's accessible name (an icon
   * button's aria-label), so it is not wired with aria-describedby; screen
   * readers would otherwise announce the same words twice.
   */
  labelOnly?: boolean;
  disabled?: boolean;
  children: ReactElement<TooltipChildProps>;
}

interface TooltipChildProps {
  ref?: Ref<HTMLElement>;
  onMouseEnter?: (event: MouseEvent<HTMLElement>) => void;
  onMouseLeave?: (event: MouseEvent<HTMLElement>) => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
  'aria-describedby'?: string;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else (ref as { current: T | null }).current = value;
}

/**
 * Tooltip on hover (after `delayMs`) and on keyboard focus; Escape hides it.
 * Rendered in a portal so no ancestor overflow clips it.
 */
export function Tooltip({
  content,
  shortcut,
  placement = 'bottom',
  delayMs = 400,
  labelOnly = false,
  disabled = false,
  children,
}: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const position = useFloatingPosition(open, anchorRef, tipRef, placement);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = useCallback((immediate: boolean) => {
    clear();
    if (immediate) setOpen(true);
    else timer.current = setTimeout(() => setOpen(true), delayMs);
  }, [delayMs]);
  const hide = useCallback(() => {
    clear();
    setOpen(false);
  }, []);

  useEffect(() => clear, []);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!isValidElement(children)) return children;
  const childProps = children.props;
  const childRef = (children as unknown as { props: { ref?: Ref<HTMLElement> } }).props.ref;

  const trigger = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node;
      assignRef(childRef, node);
    },
    onMouseEnter: (event: MouseEvent<HTMLElement>) => {
      childProps.onMouseEnter?.(event);
      if (!disabled) show(false);
    },
    onMouseLeave: (event: MouseEvent<HTMLElement>) => {
      childProps.onMouseLeave?.(event);
      hide();
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      childProps.onFocus?.(event);
      if (!disabled && event.currentTarget.matches(':focus-visible')) show(true);
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      childProps.onBlur?.(event);
      hide();
    },
    'aria-describedby': !labelOnly && open
      ? [childProps['aria-describedby'], id].filter(Boolean).join(' ')
      : childProps['aria-describedby'],
  });

  return (
    <>
      {trigger}
      {open && !disabled && typeof document !== 'undefined' && createPortal(
        <div
          ref={tipRef}
          id={id}
          role="tooltip"
          className="gv-tooltip"
          data-gv-layer=""
          aria-hidden={labelOnly || undefined}
          style={position ? { top: position.top, left: position.left } : { top: -9999, left: -9999 }}
        >
          {content}
          {shortcut && <span className="gv-kbd">{shortcut}</span>}
        </div>,
        document.body,
      )}
    </>
  );
}
