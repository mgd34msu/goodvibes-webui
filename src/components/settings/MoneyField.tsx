/**
 * MoneyField — the typed editor for the payments budget's `...Cents` keys.
 *
 * The schema stores these in minor units; a person types an amount in major
 * units ("19.99"), currency-labeled from the live `payments.currency` value.
 * Conversion is exact integer arithmetic, exponent-aware per currency
 * (lib/money.ts) — never `Number(text) * 100` and never a hardcoded 2
 * decimals — so a typed "50" reliably becomes 5000 cents for USD, and a typed
 * "5000" stays 5000 for JPY (which has no minor unit at all), never 500000.
 *
 * Commits on blur/Enter, same convention as SettingsField's plain number
 * field; a malformed amount shows inline and is never silently coerced.
 */
import { useState } from 'react';
import { InvalidMoneyInputError, majorTextToMinorUnits, minorUnitsToMajorText } from '../../lib/money';

export interface MoneyFieldProps {
  /** The live value in minor units. */
  readonly minorUnits: number;
  /** payments.currency's live value (e.g. "USD"), for the label and for exponent (decimal places). */
  readonly currency: string;
  readonly disabled?: boolean;
  readonly onCommit: (minorUnits: number) => void;
}

function safeMinorText(minorUnits: number, currency: string): string {
  try {
    return minorUnitsToMajorText(Number.isFinite(minorUnits) ? Math.trunc(minorUnits) : 0, currency);
  } catch {
    return '0';
  }
}

export function MoneyField({ minorUnits, currency, disabled, onCommit }: MoneyFieldProps) {
  const label = currency.trim() || 'USD';
  const initialText = safeMinorText(minorUnits, label);
  const [draft, setDraft] = useState(initialText);
  const [error, setError] = useState<string | null>(null);

  function submit(): void {
    if (draft === initialText) return;
    try {
      const minor = majorTextToMinorUnits(draft, label);
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
