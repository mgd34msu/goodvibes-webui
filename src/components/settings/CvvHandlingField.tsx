/**
 * CvvHandlingField — the typed editor for `payments.cvvHandling`.
 *
 * An ordinary enum select ('stored' | 'prompt'), with one addition: selecting
 * 'prompt' shows CVV_PROMPT_TRADEOFF_WARNING at the moment of selection — the
 * SDK's own wording, imported directly from
 * `@pellux/goodvibes-sdk/platform/payments` (that subpath has no node-only
 * dependencies, so it is safe to import at runtime — unlike `platform/config`,
 * which generate-config-schema.ts snapshots at build time instead). Selecting
 * 'stored' shows no warning: 'stored' is the owner's settled default, not
 * something this surface argues against.
 */
import { useState } from 'react';
import { CVV_PROMPT_TRADEOFF_WARNING } from '@pellux/goodvibes-sdk/platform/payments';

export interface CvvHandlingFieldProps {
  readonly value: string;
  readonly enumValues: readonly string[];
  readonly disabled?: boolean;
  readonly onCommit: (value: string) => void;
}

export function CvvHandlingField({ value, enumValues, disabled, onCommit }: CvvHandlingFieldProps) {
  const [showPromptWarning, setShowPromptWarning] = useState(value === 'prompt');

  function handleChange(next: string): void {
    setShowPromptWarning(next === 'prompt');
    onCommit(next);
  }

  return (
    <div className="cvv-handling-field" data-testid="cvv-handling-field">
      <select
        className="settings-field-select"
        aria-label="payments.cvvHandling"
        value={value}
        disabled={disabled}
        onChange={(e) => handleChange(e.target.value)}
      >
        {!enumValues.includes(value) && <option value={value}>{value || '(unset)'}</option>}
        {enumValues.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      {showPromptWarning && (
        <div className="banner warning cvv-prompt-warning" role="alert" data-testid="cvv-prompt-warning">
          {CVV_PROMPT_TRADEOFF_WARNING}
        </div>
      )}
    </div>
  );
}
