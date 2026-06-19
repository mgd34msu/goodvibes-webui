/**
 * Accessibility helpers shared across the app.
 * See: docs/ux-overhaul/TOKEN-CONTRACT.md
 */
import type React from 'react';
import { useId } from 'react';

let _counter = 0;

/**
 * Generate a stable unique DOM id for aria-labelledby / aria-describedby pairs.
 * Example: `const id = genId('dialog')` → "dialog-1"
 *
 * @deprecated NON-SSR-SAFE: uses a module-level mutable counter that is
 * shared across the entire process. This counter is NOT reset between
 * server renders, which means ids will differ between server and client
 * HTML and cause hydration mismatches. Prefer `useGenId` (below) in all
 * component code. Reserve `genId` only for non-component utilities that
 * genuinely cannot use a hook (e.g. plain functions, class methods).
 */
export function genId(prefix: string): string {
  return `${prefix}-${++_counter}`;
}

/**
 * React hook that generates a stable, hydration-safe unique id using
 * React's built-in `useId`. Drop-in replacement for `genId` in components.
 *
 * @example
 * function Dialog({ title }: { title: string }) {
 *   const titleId = useGenId('dialog-title');
 *   return <dialog aria-labelledby={titleId}>...</dialog>;
 * }
 */
export function useGenId(prefix: string): string {
  const reactId = useId();
  // useId returns ':r0:' style strings; strip colons for valid HTML id attr
  return `${prefix}-${reactId.replace(/:/g, '')}`;
}

/**
 * CSS class name that visually hides an element while keeping it
 * accessible to screen readers. Defined in feedback.css.
 */
export const SR_ONLY_CLASS = 'sr-only';

/**
 * Inline style equivalent of .sr-only — use when you cannot apply a class.
 */
export const srOnlyStyle: React.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  borderWidth: 0,
};
