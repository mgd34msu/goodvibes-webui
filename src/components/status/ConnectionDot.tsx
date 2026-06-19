import type { ConnectionState } from '../../lib/daemon-health';

interface ConnectionDotProps {
  state: ConnectionState;
  className?: string;
}

/**
 * A small aria-hidden colored dot indicating connection state.
 * Color is expressed via CSS classes mapped to semantic tokens
 * so it works in both light and dark themes.
 */
export function ConnectionDot({ state, className }: ConnectionDotProps) {
  return (
    <span
      className={`status-strip__dot status-strip__dot--${state}${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    />
  );
}
