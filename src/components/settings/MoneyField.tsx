/**
 * MoneyField — the typed editor for the payments budget's `...Cents` keys.
 *
 * The schema stores these in minor units (cents); a person types an amount in
 * major units ("19.99"), currency-labeled from the live `payments.currency`
 * value. Conversion is exact integer arithmetic (lib/money.ts) — never
 * `Number(text) * 100` — so a typed "50" reliably becomes 5000 cents, not 50.
 *
 * Commits on blur/Enter, same convention as SettingsField's plain number
 * field; a malformed amount shows inline and is never silently coerced.
 */
import { useState } from 'react';
import { InvalidMoneyInputError, majorTextToMinorUnits, minorUnitsToMajorText } from '../../lib/money';

export interface MoneyFieldProps {
  /** The live value in minor units (cents). */
  readonly minorUnits: number;
  /** payments.currency's live value (e.g. "USD"), for the label only. */
  readonly currency: string;
  readonly disabled?: boolean;
  readonly onCommit: (minorUnits: number) => void;
}

function safeMinorText(minorUnits: number): string {
  try {
    return minorUnitsToMajorText(Number.isFinite(minorUnits) ? Math.trunc(minorUnits) : 0);
  } catch {
    return '0.00';
  }
}

export function MoneyField({ minorUnits, currency, disabled, onCommit }: MoneyFieldProps) {
  const initialText = safeMinorText(minorUnits);
  const [draft, setDraft] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const label = currency.trim() || 'USD';

  function submit(): void {
    if (draft === initialText) return;
    try {
      const minor = majorTextToMinorUnits(draft);
      setError(null);
      onCommit(minor);
    } catch (err) {
      setError(err instanceof InvalidMoneyInputError ? err.message : 'Enter a valid amount');
    }
  }

  return (
    <div className="money-field" data-testid="money-field">
      <div className="money-field-row">
        <span className="money-field-currency" aria-hidden="true">
          {label}
        </span>
        <input
          type="text"
          inputMode="decimal"
          className="settings-field-input money-field-amount"
          aria-label={`Amount in ${label} (major units)`}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          onBlur={submit}
        />
      </div>
      <p className="money-field-hint">
        Stored as minor units (cents): {Number.isFinite(minorUnits) ? Math.trunc(minorUnits) : 0}.
      </p>
      {error && (
        <div className="banner warning money-field-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
