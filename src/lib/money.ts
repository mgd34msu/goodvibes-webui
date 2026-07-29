/**
 * money.ts — exact major-unit <-> minor-unit conversion for the payments
 * budget fields (`payments.budget.*Cents`, `payments.budget.*CeilingCents`,
 * `payments.budget.*AllowanceCents`). The schema stores these in minor units;
 * a user types an amount in major units ("19.99"). A user typing "50" for a
 * daily budget must set fifty DOLLARS (5000 cents), never fifty cents — so
 * every `...Cents` key gets this conversion, not the raw number field.
 *
 * Never uses floating-point multiplication/division on the money value
 * itself. `Number(text) * 100` looks right and is wrong: binary floating
 * point cannot represent most decimal fractions exactly (0.1, 0.29, 19.99 —
 * all in the round-trip cases this module is tested against — do not survive
 * a `* 100` / `/ 100` round trip bit-for-bit on every JS engine and rounding
 * path). All arithmetic here is on integers parsed directly out of the
 * decimal string, so the conversion is exact by construction.
 *
 * Currency-exponent-aware: NOT every currency has 2 decimal digits. Mirrors
 * the SDK's `platform/payments/message.ts` exponent table exactly (its
 * ZERO_DECIMAL / THREE_DECIMAL sets) — not imported directly, because that
 * module's `exponentFor` is a private helper (only the DISPLAY formatter
 * `formatMinorUnits`, which returns a currency-prefixed, comma-grouped
 * string, is exported — not suitable as a bare, re-parseable input value).
 * Getting this wrong is a real bug, not a cosmetic one: assuming 2 decimals
 * for a JPY budget would turn a typed "5000" into 500000 minor units — fifty
 * times the intended amount, since JPY has no minor unit at all.
 */

export class InvalidMoneyInputError extends Error {}

/** Minor units per major unit, by ISO-4217 code — mirrors the SDK's table exactly. */
const THREE_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);
const ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'XAF', 'XOF', 'XPF']);

/** How many fraction digits `currency`'s minor unit represents (0, 2, or 3). Defaults to 2. */
export function minorUnitExponent(currency: string): number {
  const code = currency.trim().toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  return 2;
}

function majorUnitPattern(exponent: number): RegExp {
  return exponent === 0 ? /^(\d+)$/ : new RegExp(`^(\\d+)(?:\\.(\\d{1,${exponent}}))?$`);
}

/** True for config keys stored in minor units that need the major-unit-entry /
 *  minor-unit-storage conversion, e.g. `payments.budget.dailyItemCents`. */
export function isMoneyConfigKey(key: string): boolean {
  const lastSegment = key.split('.').pop() ?? key;
  return lastSegment.endsWith('Cents');
}

/**
 * Parse a major-unit decimal string (e.g. "19.99", "50", "5000" for JPY) into
 * an exact integer count of minor units, for `currency` (default 'USD', 2
 * decimal places). Throws InvalidMoneyInputError for anything that is not a
 * non-negative amount with at most `currency`'s number of fraction digits —
 * never silently truncates or rounds a value the user typed.
 */
export function majorTextToMinorUnits(text: string, currency = 'USD'): number {
  const exponent = minorUnitExponent(currency);
  const trimmed = text.trim();
  const match = majorUnitPattern(exponent).exec(trimmed);
  if (!match) {
    throw new InvalidMoneyInputError(
      exponent === 0
        ? `Enter a non-negative whole amount (got "${text}")`
        : `Enter a non-negative amount with at most ${exponent} decimal place${exponent === 1 ? '' : 's'} (got "${text}")`,
    );
  }
  const [, wholePart, fracPart = ''] = match;
  const whole = Number.parseInt(wholePart, 10);
  if (!Number.isSafeInteger(whole)) {
    throw new InvalidMoneyInputError('Amount is too large');
  }
  const divisor = 10 ** exponent;
  const frac = exponent === 0 ? 0 : Number.parseInt(fracPart.padEnd(exponent, '0'), 10);
  const minor = whole * divisor + frac;
  if (!Number.isSafeInteger(minor)) {
    throw new InvalidMoneyInputError('Amount is too large');
  }
  return minor;
}

/**
 * Render an exact integer count of minor units as a major-unit decimal string
 * for `currency` (e.g. 1999/"USD" -> "19.99", 5000/"JPY" -> "5000",
 * 1000/"KWD" -> "1.000"). Throws InvalidMoneyInputError for a non-integer or
 * negative input — the daemon's schema range (`intRange(0, MAX_MINOR_UNITS)`)
 * never produces one, but this must never fabricate a plausible-looking
 * amount for a value it cannot represent honestly.
 */
export function minorUnitsToMajorText(minor: number, currency = 'USD'): string {
  if (!Number.isInteger(minor) || minor < 0) {
    throw new InvalidMoneyInputError(`Minor units must be a non-negative integer (got ${String(minor)})`);
  }
  const exponent = minorUnitExponent(currency);
  if (exponent === 0) return String(minor);
  const divisor = 10 ** exponent;
  const whole = Math.trunc(minor / divisor);
  const frac = minor - whole * divisor;
  return `${whole}.${String(frac).padStart(exponent, '0')}`;
}
