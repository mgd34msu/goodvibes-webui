import { describe, expect, test, mock } from 'bun:test';
import { normaliseCombo, eventToCombo } from './useHotkeys';
import type { HotkeyBinding } from './useHotkeys';

// In the test environment, navigator is undefined, so isMac() returns false.
// Therefore "mod" normalises to "Control".

describe('normaliseCombo', () => {
  test('normalises single letter to lowercase', () => {
    expect(normaliseCombo('K')).toBe('k');
  });

  test('normalises mod+k to Control+k (non-Mac env)', () => {
    // In test env: no navigator -> isMac() = false -> mod = Control
    expect(normaliseCombo('mod+k')).toBe('Control+k');
  });

  test('normalises ctrl alias to Control', () => {
    expect(normaliseCombo('ctrl+k')).toBe('Control+k');
  });

  test('normalises cmd alias to Meta', () => {
    expect(normaliseCombo('cmd+k')).toBe('Meta+k');
  });

  test('normalises meta alias to Meta', () => {
    expect(normaliseCombo('meta+k')).toBe('Meta+k');
  });

  test('normalises alt token to Alt', () => {
    expect(normaliseCombo('alt+f')).toBe('Alt+f');
  });

  test('normalises shift token to Shift', () => {
    expect(normaliseCombo('shift+Enter')).toBe('Shift+Enter');
  });

  test('normalises mod+shift+n correctly', () => {
    expect(normaliseCombo('mod+shift+n')).toBe('Control+Shift+n');
  });

  test('normalises two-key sequence "g c"', () => {
    expect(normaliseCombo('g c')).toBe('g c');
  });

  test('normalises two-key sequence with uppercase "G C"', () => {
    expect(normaliseCombo('G C')).toBe('g c');
  });

  test('normalises two-key sequence with modified first key "Ctrl+x y"', () => {
    expect(normaliseCombo('Ctrl+x y')).toBe('Control+x y');
  });

  test('normalises named key Escape', () => {
    expect(normaliseCombo('Escape')).toBe('Escape');
  });

  test('normalises named key Enter', () => {
    expect(normaliseCombo('Enter')).toBe('Enter');
  });

  test('handles extra whitespace in sequence', () => {
    expect(normaliseCombo('  g   c  ')).toBe('g c');
  });

  test('question mark passthrough — single printable', () => {
    // "?" is a single char, normalises to "?"
    expect(normaliseCombo('?')).toBe('?');
  });
});

describe('eventToCombo', () => {
  /** Minimal KeyboardEvent-like stub */
  function mkEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
    return {
      key: 'a',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      ...overrides,
    } as KeyboardEvent;
  }

  test('plain letter produces lowercase key', () => {
    expect(eventToCombo(mkEvent({ key: 'k' }))).toBe('k');
  });

  test('Ctrl+k produces Control+k', () => {
    expect(eventToCombo(mkEvent({ key: 'k', ctrlKey: true }))).toBe('Control+k');
  });

  test('Meta+k produces Meta+k', () => {
    expect(eventToCombo(mkEvent({ key: 'k', metaKey: true }))).toBe('Meta+k');
  });

  test('Ctrl+Shift+N produces Control+Shift+n (Shift kept when Ctrl also held)', () => {
    // key="N" length 1, but Ctrl is also held — so Shift is NOT suppressed.
    // This is the regression: previously produced "Control+n" (Shift incorrectly dropped).
    expect(eventToCombo(mkEvent({ key: 'N', ctrlKey: true, shiftKey: true }))).toBe('Control+Shift+n');
  });

  test('Shift+? (bare shifted printable, no other modifier) does NOT include Shift prefix', () => {
    // "?" is a single printable char (length 1), no Ctrl/Meta/Alt — Shift is suppressed
    expect(eventToCombo(mkEvent({ key: '?', shiftKey: true }))).toBe('?');
  });

  test('Shift+ArrowUp includes Shift (named key)', () => {
    expect(eventToCombo(mkEvent({ key: 'ArrowUp', shiftKey: true }))).toBe('Shift+ArrowUp');
  });

  test('Shift+Enter includes Shift (named key)', () => {
    expect(eventToCombo(mkEvent({ key: 'Enter', shiftKey: true }))).toBe('Shift+Enter');
  });

  test('Alt+f produces Alt+f', () => {
    expect(eventToCombo(mkEvent({ key: 'f', altKey: true }))).toBe('Alt+f');
  });

  test('Escape produces Escape', () => {
    expect(eventToCombo(mkEvent({ key: 'Escape' }))).toBe('Escape');
  });

  test('Meta+Ctrl+k includes both modifiers', () => {
    expect(eventToCombo(mkEvent({ key: 'k', metaKey: true, ctrlKey: true }))).toBe('Meta+Control+k');
  });

  test('space bar (key = " ") is treated as named — Shift IS included', () => {
    // key === ' ' has length 1 but the guard is key !== ' ', so Shift is included
    expect(eventToCombo(mkEvent({ key: ' ', shiftKey: true }))).toBe('Shift+ ');
  });

  test('Meta+Shift+N keeps Shift when Meta is held', () => {
    // Same class of bug as Ctrl+Shift+N — Shift must NOT be suppressed when Meta is held
    expect(eventToCombo(mkEvent({ key: 'N', metaKey: true, shiftKey: true }))).toBe('Meta+Shift+n');
  });

  test('Alt+Shift+X keeps Shift when Alt is held', () => {
    // Shift must NOT be suppressed when Alt is also held
    expect(eventToCombo(mkEvent({ key: 'X', altKey: true, shiftKey: true }))).toBe('Alt+Shift+x');
  });
});

// ---------------------------------------------------------------------------
// DISPATCH-LEVEL tests
//
// These tests exercise the full pipeline: binding registration → keydown event
// → eventToCombo → normaliseCombo → handler dispatch. They use a manual hook
// harness that mirrors exactly what useHotkeys registers on document, verifying
// that handlers fire (or are blocked) as required.
//
// The harness imports the internal logic via the exported functions and
// reproduces the dispatch loop in isolation — consistent with this repo's
// test style (no DOM environment required for the harness; real KeyboardEvent
// stubs are constructed as plain objects matching the interface).
// ---------------------------------------------------------------------------

/**
 * Minimal KeyboardEvent stub for dispatch harness.
 * Matches the subset of KeyboardEvent used by eventToCombo + useHotkeys handler.
 */
function mkKeyEvent(
  key: string,
  mods: {
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
  } = {},
  target?: EventTarget | null,
  defaultPreventedRef?: { prevented: boolean },
): KeyboardEvent {
  const prevented = defaultPreventedRef ?? { prevented: false };
  return {
    key,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    altKey: mods.altKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    target: target ?? null,
    preventDefault: () => { prevented.prevented = true; },
  } as unknown as KeyboardEvent;
}

/**
 * Dispatch harness: mirrors the handler logic inside useHotkeys.
 * Runs a single keydown event through a set of bindings.
 * Returns which handler IDs fired.
 */
function runDispatch(
  event: KeyboardEvent,
  bindings: (HotkeyBinding & { id: string })[],
  pendingSeq: { key: string; ts: number } | null = null,
  isEditable = false,
): { fired: string[]; newPending: { key: string; ts: number } | null } {
  const SEQUENCE_TIMEOUT_MS = 1000;
  const fired: string[] = [];
  let pending = pendingSeq;
  const currentCombo = eventToCombo(event);

  for (const binding of bindings) {
    const { combo, handler: bindingHandler, allowInInput = false, id } = binding;
    if (isEditable && !allowInInput) continue;

    const normCombo = normaliseCombo(combo);

    if (normCombo.includes(' ')) {
      const [firstKey, secondKey] = normCombo.split(' ');

      if (
        pending &&
        pending.key === firstKey &&
        Date.now() - pending.ts < SEQUENCE_TIMEOUT_MS &&
        currentCombo === secondKey
      ) {
        bindingHandler(event);
        fired.push(id);
        return { fired, newPending: null };
      }

      if (currentCombo === firstKey) {
        pending = { key: firstKey, ts: Date.now() };
        return { fired, newPending: pending };
      }
      continue;
    }

    if (currentCombo === normCombo) {
      bindingHandler(event);
      fired.push(id);
      return { fired, newPending: null };
    }
  }

  return { fired, newPending: pending };
}

describe('dispatch-level: full pipeline (event → combo → handler fires)', () => {
  // Standard bindings mirroring CommandProvider (test env: mod=Control)
  function makeBindings(): (HotkeyBinding & { id: string })[] {
    return [
      { id: 'mod+k',        combo: 'mod+k',        handler: mock(() => {}), allowInInput: true },
      { id: '?',            combo: '?',            handler: mock(() => {}) },
      { id: 'g c',          combo: 'g c',          handler: mock(() => {}) },
      { id: 'g k',          combo: 'g k',          handler: mock(() => {}) },
      { id: 'g p',          combo: 'g p',          handler: mock(() => {}) },
      { id: 'g a',          combo: 'g a',          handler: mock(() => {}) },
      { id: 'mod+shift+n',  combo: 'mod+shift+n',  handler: mock(() => {}), allowInInput: true },
    ];
  }

  test('mod+k fires: Ctrl+k event dispatches to mod+k binding', () => {
    const bindings = makeBindings();
    const event = mkKeyEvent('k', { ctrlKey: true });
    const { fired } = runDispatch(event, bindings);
    expect(fired).toContain('mod+k');
  });

  test('mod+shift+n fires: Ctrl+Shift+N event dispatches to mod+shift+n binding (regression fix)', () => {
    // This is the critical regression: previously eventToCombo produced "Control+n"
    // (Shift incorrectly suppressed), so the handler never fired.
    // After the fix: Shift is kept when Ctrl is also held → "Control+Shift+n" matches.
    const bindings = makeBindings();
    const event = mkKeyEvent('N', { ctrlKey: true, shiftKey: true });
    const { fired } = runDispatch(event, bindings);
    expect(fired).toContain('mod+shift+n');
  });

  test('? fires: Shift+/ event (key="?") dispatches to ? binding', () => {
    // Shift is suppressed for bare printable chars — so "?" still matches
    const bindings = makeBindings();
    const event = mkKeyEvent('?', { shiftKey: true });
    const { fired } = runDispatch(event, bindings);
    expect(fired).toContain('?');
  });

  test('g c sequence fires within timeout', () => {
    const bindings = makeBindings();
    // Step 1: press "g" — arms the sequence
    const gEvent = mkKeyEvent('g');
    const { fired: fired1, newPending } = runDispatch(gEvent, bindings);
    expect(fired1).toHaveLength(0); // no handler yet
    expect(newPending).not.toBeNull();
    expect(newPending?.key).toBe('g');

    // Step 2: press "c" within timeout — fires the handler
    const cEvent = mkKeyEvent('c');
    const { fired: fired2 } = runDispatch(cEvent, bindings, newPending);
    expect(fired2).toContain('g c');
  });

  test('g c sequence does NOT fire after timeout', () => {
    const bindings = makeBindings();
    // Simulate an expired pending sequence (ts far in the past)
    const expiredPending = { key: 'g', ts: Date.now() - 2000 }; // 2 s ago > 1 s timeout
    const cEvent = mkKeyEvent('c');
    const { fired } = runDispatch(cEvent, bindings, expiredPending);
    expect(fired).not.toContain('g c');
  });

  test('editable-target guard: non-allowInInput binding blocked inside input', () => {
    const bindings = makeBindings();
    // "?" has no allowInInput — should be blocked when focus is in an input
    const event = mkKeyEvent('?', { shiftKey: true });
    const { fired } = runDispatch(event, bindings, null, /* isEditable */ true);
    expect(fired).not.toContain('?');
  });

  test('allowInInput: mod+k fires inside input (allowInInput: true)', () => {
    const bindings = makeBindings();
    const event = mkKeyEvent('k', { ctrlKey: true });
    const { fired } = runDispatch(event, bindings, null, /* isEditable */ true);
    expect(fired).toContain('mod+k');
  });

  test('allowInInput: mod+shift+n fires inside input (allowInInput: true)', () => {
    const bindings = makeBindings();
    const event = mkKeyEvent('N', { ctrlKey: true, shiftKey: true });
    const { fired } = runDispatch(event, bindings, null, /* isEditable */ true);
    expect(fired).toContain('mod+shift+n');
  });

  test('unrelated key does not fire any handler', () => {
    const bindings = makeBindings();
    const event = mkKeyEvent('z');
    const { fired } = runDispatch(event, bindings);
    expect(fired).toHaveLength(0);
  });
});

describe('dispatch-level: end-to-end combo audit (all 7 advertised shortcuts)', () => {
  // Verify normaliseCombo → eventToCombo agreement for every advertised binding.
  // These are the exact bindings from CommandProvider.
  // In test env (non-Mac): mod → Control.

  const cases: {
    label: string;
    combo: string;
    event: KeyboardEvent;
    expectMatch: boolean;
  }[] = [
    {
      label: 'g c (first key)',
      combo: 'g c',
      event: mkKeyEvent('g'),
      expectMatch: false, // first key of sequence — not a direct match
    },
    {
      label: 'g k (first key)',
      combo: 'g k',
      event: mkKeyEvent('g'),
      expectMatch: false,
    },
    {
      label: 'g p (first key)',
      combo: 'g p',
      event: mkKeyEvent('g'),
      expectMatch: false,
    },
    {
      label: 'g a (first key)',
      combo: 'g a',
      event: mkKeyEvent('g'),
      expectMatch: false,
    },
    {
      label: 'mod+shift+n: Ctrl+Shift+N matches Control+Shift+n',
      combo: 'mod+shift+n',
      event: mkKeyEvent('N', { ctrlKey: true, shiftKey: true }),
      expectMatch: true,
    },
    {
      label: 'mod+k: Ctrl+k matches Control+k',
      combo: 'mod+k',
      event: mkKeyEvent('k', { ctrlKey: true }),
      expectMatch: true,
    },
    {
      label: '?: Shift+/ (key="?") matches ?',
      combo: '?',
      event: mkKeyEvent('?', { shiftKey: true }),
      expectMatch: true,
    },
  ];

  for (const { label, combo, event, expectMatch } of cases) {
    const normCombo = normaliseCombo(combo);
    // For sequence combos, skip full match check (they use two-step dispatch)
    if (!normCombo.includes(' ')) {
      test(`${label}`, () => {
        const produced = eventToCombo(event);
        if (expectMatch) {
          expect(produced).toBe(normCombo);
        } else {
          expect(produced).not.toBe(normCombo);
        }
      });
    }
  }

  // Sequence shortcuts: verify first and second key combos individually
  test('g c sequence: first key "g" arms pending, second key "c" fires', () => {
    expect(eventToCombo(mkKeyEvent('g'))).toBe('g');
    expect(normaliseCombo('g c').split(' ')[0]).toBe('g');
    expect(eventToCombo(mkKeyEvent('c'))).toBe('c');
    expect(normaliseCombo('g c').split(' ')[1]).toBe('c');
  });

  test('g k sequence: first key "g" arms pending, second key "k" fires', () => {
    expect(eventToCombo(mkKeyEvent('g'))).toBe('g');
    expect(eventToCombo(mkKeyEvent('k'))).toBe('k');
    expect(normaliseCombo('g k')).toBe('g k');
  });

  test('g p sequence: first key "g" arms pending, second key "p" fires', () => {
    expect(eventToCombo(mkKeyEvent('g'))).toBe('g');
    expect(eventToCombo(mkKeyEvent('p'))).toBe('p');
    expect(normaliseCombo('g p')).toBe('g p');
  });

  test('g a sequence: first key "g" arms pending, second key "a" fires', () => {
    expect(eventToCombo(mkKeyEvent('g'))).toBe('g');
    expect(eventToCombo(mkKeyEvent('a'))).toBe('a');
    expect(normaliseCombo('g a')).toBe('g a');
  });
});
