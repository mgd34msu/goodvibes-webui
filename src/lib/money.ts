/**
 * money.ts — exact major-unit <-> minor-unit conversion for the payments
 * budget fields (`payments.budget.*Cents`, `payments.budget.*CeilingCents`,
 * `payments.budget.*AllowanceCents`). The schema stores these in minor units
 * (cents); a user types an amount in major units ("19.99"). A user typing
 * "50" for a daily budget must set fifty DOLLARS (5000 cents), never fifty
 * cents — so every `...Cents` key gets this conversion, not the raw number
 * field.
 *
 * Never uses floating-point multiplication/division on the money value
 * itself. `Number(text) * 100` looks right and is wrong: binary floating
 * point cannot represent most decimal fractions exactly (0.1, 0.29, 19.99 —
 * all in the round-trip cases this module is tested against — do not survive
 * a `* 100` / `/ 100` round trip bit-for-bit on every JS engine and rounding
 * path). All arithmetic here is on integers parsed directly out of the
 * decimal string, so the conversion is exact by construction.
 *
 * Assumes a 2-decimal-digit currency (USD default, and every currency this
 * round's examples use). CONFIG_SCHEMA does not carry a per-currency minor-
 * unit exponent table (zero-decimal currencies like JPY, three-decimal like
 * BHD), so that refinement is not implemented here — see the engineering
 * report for this round.
 */

export class InvalidMoneyInputError extends Error {}

const MAJOR_UNIT_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/;

/** True for config keys stored in minor units (cents) that need the
 *  major-unit-entry / minor-unit-storage conversion, e.g. `payments.budget.dailyItemCents`. */
export function isMoneyConfigKey(key: string): boolean {
  const lastSegment = key.split('.').pop() ?? key;
  return lastSegment.endsWith('Cents');
}

/**
 * Parse a major-unit decimal string (e.g. "19.99", "50", "0.10") into an
 * exact integer count of minor units (cents). Throws InvalidMoneyInputError
 * for anything that is not a non-negative amount with at most 2 fraction
 * digits — never silently truncates or rounds a value the user typed.
 */
export function majorTextToMinorUnits(text: string): number {
  const trimmed = text.trim();
  const match = MAJOR_UNIT_PATTERN.exec(trimmed);
  if (!match) {
    throw new InvalidMoneyInputError(`Enter a non-negative amount like 19.99 (got "${text}")`);
  }
  const [, wholePart, fracPart = ''] = match;
  const whole = Number.parseInt(wholePart, 10);
  const frac = Number.parseInt(fracPart.padEnd(2, '0'), 10);
  if (!Number.isSafeInteger(whole)) {
    throw new InvalidMoneyInputError('Amount is too large');
  }
  const minor = whole * 100 + frac;
  if (!Number.isSafeInteger(minor)) {
    throw new InvalidMoneyInputError('Amount is too large');
  }
  return minor;
}

/**
 * Render an exact integer count of minor units (cents) as a major-unit
 * decimal string (e.g. 1999 -> "19.99", 10 -> "0.10"). Throws
 * InvalidMoneyInputError for a non-integer or negative input — the daemon's
 * schema range (`intRange(0, MAX_MINOR_UNITS)`) never produces one, but this
 * must never fabricate a plausible-looking amount for a value it cannot
 * represent honestly.
 */
export function minorUnitsToMajorText(minor: number): string {
  if (!Number.isInteger(minor) || minor < 0) {
    throw new InvalidMoneyInputError(`Minor units must be a non-negative integer (got ${String(minor)})`);
  }
  const whole = Math.trunc(minor / 100);
  const frac = minor - whole * 100;
  return `${whole}.${String(frac).padStart(2, '0')}`;
}
