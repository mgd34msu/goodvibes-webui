/**
 * useFocusTrap — traps keyboard focus within a container element.
 * Intended for palette, peek slide-over, and modal surfaces.
 *
 * Contract: part of a11y helpers per docs/ux-overhaul/TOKEN-CONTRACT.md
 *
 * @example
 * const ref = useFocusTrap<HTMLDivElement>(isOpen);
 * // <div ref={ref}>...</div>
 */
import type React from 'react';
import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'details > summary',
].join(',');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)).filter(
    (el) => !el.closest('[inert]') && el.offsetParent !== null,
  );
}

/**
 * Returns a ref to attach to the trap container.
 * When `active` is true, focus is constrained within the container.
 * Restores focus to the previously focused element on deactivation.
 *
 * Two complementary mechanisms enforce the trap:
 *
 * 1. **keydown on container** — intercepts Tab/Shift+Tab and cycles focus
 *    within the focusable elements list. Handles the common case where the
 *    user navigates by keyboard and focus never leaves the container.
 *
 * 2. **focusin on document** — recovery guard. Fires whenever focus moves
 *    to ANY element in the document. If focus has escaped the container
 *    (e.g. programmatic `.focus()` call, browser chrome interaction, or
 *    a race during SSR hydration), focus is immediately returned to the
 *    first focusable element inside the container. This makes the trap
 *    robust against all programmatic focus escape paths.
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>(
  active: boolean,
): React.RefObject<T | null> {
  const containerRef = useRef<T>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;

    const container: T | null = containerRef.current;
    if (!container) return;
    const trapContainer: T = container;

    // Capture the currently focused element to restore later
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    // Move focus into the trap immediately
    const focusable = getFocusableElements(container);
    if (focusable.length > 0) {
      focusable[0].focus();
    } else {
      container.focus();
    }

    // 1. Tab cycling — bound at container level for efficient routing
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Tab') return;

      const focusableNow = getFocusableElements(trapContainer);
      if (focusableNow.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusableNow[0];
      const last = focusableNow[focusableNow.length - 1];

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

    // 2. Focusin recovery — bound at document level.
    //    Catches programmatic focus escapes that bypass Tab handling.
    function handleFocusIn(event: FocusEvent): void {
      // Ignore focus events targeting the container itself or its descendants
      if (trapContainer.contains(event.target as Node | null)) return;

      // Focus escaped — pull it back to the first focusable element
      const focusableNow = getFocusableElements(trapContainer);
      if (focusableNow.length > 0) {
        // Intentional recovery: always return to the first focusable element on escape.
        focusableNow[0].focus();
      } else {
        trapContainer.focus();
      }
    }

    container.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn, true);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn, true);
      // Restore focus on deactivation
      previousFocusRef.current?.focus();
    };
  }, [active]);

  return containerRef;
}
