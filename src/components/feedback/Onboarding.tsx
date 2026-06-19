/**
 * Onboarding — first-run teaching panel, dismissible and persisted via the
 * ui-preferences pattern. Each surface gets its own dismissal key via `id`.
 *
 * Persistence: uses the same localStorage key as WebUiPreferences but under
 * a namespaced key `goodvibes.webui.onboarding` to avoid polluting the
 * preferences schema.
 *
 * @example
 * <Onboarding
 *   id="knowledge-view"
 *   title="Knowledge base"
 *   description="Add files and URLs to give the AI context."
 *   steps={['Upload a file', 'Paste a URL', 'Ask a question']}
 * />
 */
import { type FC, type ReactNode, useCallback, useEffect, useState } from 'react';
import '../../styles/components/feedback.css';

const ONBOARDING_STORAGE_KEY = 'goodvibes.webui.onboarding';

function readDismissed(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeDismissed(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    const next = { ...readDismissed(), [id]: true };
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // silently ignore write failures
  }
}

export interface OnboardingProps {
  /**
   * Stable identifier for this surface's onboarding panel.
   * Used as the localStorage key so dismissal is persisted per surface.
   */
  id: string;
  title: string;
  description?: string;
  /** Ordered list of steps / tips to display as a simple numbered list. */
  steps?: string[];
  /** Optional call-to-action rendered below the steps. */
  action?: { label: string; onClick: () => void };
  /** Render anything custom in the panel body alongside the standard content. */
  children?: ReactNode;
  className?: string;
}

export const Onboarding: FC<OnboardingProps> = ({
  id,
  title,
  description,
  steps,
  action,
  children,
  className,
}) => {
  const [visible, setVisible] = useState<boolean>(() => !readDismissed()[id]);

  // Sync with external localStorage changes (e.g. another tab resets it)
  useEffect(() => {
    function onStorage(e: StorageEvent): void {
      if (e.key === ONBOARDING_STORAGE_KEY) {
        setVisible(!readDismissed()[id]);
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [id]);

  const handleDismiss = useCallback((): void => {
    writeDismissed(id);
    setVisible(false);
  }, [id]);

  if (!visible) return null;

  return (
    <aside
      className={['feedback-onboarding', className].filter(Boolean).join(' ')}
      aria-label={`${title} onboarding`}
    >
      <div className="feedback-onboarding__header">
        <p className="feedback-onboarding__title">{title}</p>
        <button
          type="button"
          className="feedback-onboarding__dismiss"
          onClick={handleDismiss}
          aria-label="Dismiss onboarding"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      {description && <p className="feedback-onboarding__description">{description}</p>}
      {steps && steps.length > 0 && (
        <ol className="feedback-onboarding__steps">
          {steps.map((step, i) => (
            <li key={i} className="feedback-onboarding__step">{step}</li>
          ))}
        </ol>
      )}
      {children}
      {action && (
        <button
          type="button"
          className="feedback-onboarding__action"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </aside>
  );
};
