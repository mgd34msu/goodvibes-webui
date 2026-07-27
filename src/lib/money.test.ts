import { describe, expect, test } from 'bun:test';
import {
  InvalidMoneyInputError,
  isMoneyConfigKey,
  majorTextToMinorUnits,
  minorUnitsToMajorText,
} from './money';

describe('isMoneyConfigKey', () => {
  test('recognizes every payments budget key stored in minor units', () => {
    expect(isMoneyConfigKey('payments.budget.dailyItemCents')).toBe(true);
    expect(isMoneyConfigKey('payments.budget.dailyOverageCents')).toBe(true);
    expect(isMoneyConfigKey('payments.budget.perPurchaseCeilingCents')).toBe(true);
    expect(isMoneyConfigKey('payments.budget.overageToleranceDailyAllowanceCents')).toBe(true);
  });

  test('does not flag a non-money number key or a boolean key', () => {
    expect(isMoneyConfigKey('payments.windows.vetoMinutes')).toBe(false);
    expect(isMoneyConfigKey('payments.budget.perPurchaseCeilingEnabled')).toBe(false);
    expect(isMoneyConfigKey('payments.enabled')).toBe(false);
  });
});

describe('major <-> minor unit round trip — exact, no float drift', () => {
  // Representative values including ones that break naive `Number(x) * 100` /
  // `/ 100` float math (0.1, 0.29 famously do not survive that round trip
  // exactly on IEEE 754 doubles).
  const cases: [string, number][] = [
    ['0.10', 10],
    ['0.29', 29],
    ['19.99', 1999],
    ['1234.56', 123456],
    ['0.00', 0],
    ['0', 0],
    ['50', 5000],
    ['1', 100],
    ['0.1', 10],
    ['0.9', 90],
  ];

  for (const [text, minor] of cases) {
    test(`"${text}" major <-> ${minor} minor`, () => {
      expect(majorTextToMinorUnits(text)).toBe(minor);
      expect(minorUnitsToMajorText(minor)).toBe(minorUnitsToMajorText(majorTextToMinorUnits(text)));
    });
  }

  test('minorUnitsToMajorText renders the canonical 2-decimal form', () => {
    expect(minorUnitsToMajorText(10)).toBe('0.10');
    expect(minorUnitsToMajorText(29)).toBe('0.29');
    expect(minorUnitsToMajorText(1999)).toBe('19.99');
    expect(minorUnitsToMajorText(123456)).toBe('1234.56');
    expect(minorUnitsToMajorText(0)).toBe('0.00');
  });

  test('never uses float multiplication that would drift: 0.1 and 0.29 are the classic float traps', () => {
    // Sanity-check the traps this module exists to avoid: naive float math
    // does not reliably give exactly 10 / 29 on every engine and rounding path.
    expect(majorTextToMinorUnits('0.10')).toBe(10);
    expect(majorTextToMinorUnits('0.29')).toBe(29);
  });

  test('a full round trip through both directions is lossless for every case', () => {
    for (const [text, minor] of cases) {
      const roundTripped = majorTextToMinorUnits(minorUnitsToMajorText(minor));
      expect(roundTripped).toBe(minor);
      expect(majorTextToMinorUnits(text)).toBe(minor);
    }
  });
});

describe('majorTextToMinorUnits — rejects malformed input honestly', () => {
  test('rejects empty, non-numeric, negative, and over-precise input', () => {
    expect(() => majorTextToMinorUnits('')).toThrow(InvalidMoneyInputError);
    expect(() => majorTextToMinorUnits('abc')).toThrow(InvalidMoneyInputError);
    expect(() => majorTextToMinorUnits('-5')).toThrow(InvalidMoneyInputError);
    expect(() => majorTextToMinorUnits('5.999')).toThrow(InvalidMoneyInputError);
    expect(() => majorTextToMinorUnits('5.')).toThrow(InvalidMoneyInputError);
    expect(() => majorTextToMinorUnits('5,00')).toThrow(InvalidMoneyInputError);
  });

  test('tolerates surrounding whitespace', () => {
    expect(majorTextToMinorUnits('  19.99  ')).toBe(1999);
  });
});

describe('minorUnitsToMajorText — rejects a value it cannot represent honestly', () => {
  test('rejects negative and non-integer minor-unit values rather than fabricating an amount', () => {
    expect(() => minorUnitsToMajorText(-1)).toThrow(InvalidMoneyInputError);
    expect(() => minorUnitsToMajorText(1.5)).toThrow(InvalidMoneyInputError);
  });
});
