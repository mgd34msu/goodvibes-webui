import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import '../../styles/components/ui.css';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** At most one primary button per view or dialog (design doc "Buttons"). */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon, drawn at 16. */
  icon?: ReactNode;
}

/** The kit button: primary (solid light), secondary, outline, ghost, danger; sm 28 or md 34 tall. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, className, children, type = 'button', ...rest },
  ref,
) {
  const classes = ['gv-button', `gv-button--${variant}`, size === 'sm' ? 'gv-button--sm' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button ref={ref} type={type} className={classes} {...rest}>
      {icon}
      {children}
    </button>
  );
});
