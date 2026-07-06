/**
 * generate-presentation-tokens.test.ts
 *
 * Proves the three properties the presentation-bridge work order calls for:
 *
 *   1. Determinism — rendering the SAME contract snapshot twice (or the real,
 *      installed contract against the checked-in generated artifacts) yields
 *      byte-identical output.
 *   2. Drift gate — mutating the contract snapshot (simulating an SDK upgrade
 *      that changes a glyph or a tone color) changes the rendered output, so
 *      `writeIfChanged(..., checkOnly: true)` reports drift (would exit 1 in
 *      `bun run presentation:check`, wired into `bun run build`).
 *   3. The checked-in artifacts under src/lib/generated and
 *      src/styles/generated are themselves up to date with the real,
 *      installed @pellux/goodvibes-sdk contract (the same check `--check`
 *      performs, exercised directly here rather than via subprocess).
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  CSS_OUT_PATH,
  TS_OUT_PATH,
  loadContractSnapshot,
  renderCss,
  renderTs,
  writeIfChanged,
  type PresentationContractSnapshot,
} from './generate-presentation-tokens';

function mutateGlyph(snapshot: PresentationContractSnapshot): PresentationContractSnapshot {
  return {
    ...snapshot,
    glyphs: {
      ...snapshot.glyphs,
      status: {
        ...snapshot.glyphs.status,
        success: '☺', // stand-in for "the SDK shipped a different glyph"
      },
    },
  };
}

function mutateToneColor(snapshot: PresentationContractSnapshot): PresentationContractSnapshot {
  return {
    ...snapshot,
    toneDark: {
      ...snapshot.toneDark,
      state: {
        ...snapshot.toneDark.state,
        good: '#123456', // stand-in for "the SDK shipped a different tone color"
      },
    },
  };
}

describe('generate-presentation-tokens: determinism', () => {
  test('renderCss is byte-identical across two calls with the same snapshot', () => {
    const snapshot = loadContractSnapshot();
    expect(renderCss(snapshot)).toBe(renderCss(snapshot));
  });

  test('renderTs is byte-identical across two calls with the same snapshot', () => {
    const snapshot = loadContractSnapshot();
    expect(renderTs(snapshot)).toBe(renderTs(snapshot));
  });

  test('renderCss(loadContractSnapshot()) matches the checked-in generated CSS file', () => {
    const snapshot = loadContractSnapshot();
    const checkedIn = readFileSync(CSS_OUT_PATH, 'utf8');
    expect(renderCss(snapshot)).toBe(checkedIn);
  });

  test('renderTs(loadContractSnapshot()) matches the checked-in generated TS file', () => {
    const snapshot = loadContractSnapshot();
    const checkedIn = readFileSync(TS_OUT_PATH, 'utf8');
    expect(renderTs(snapshot)).toBe(checkedIn);
  });

  test('the real contract snapshot itself is stable across repeated loads', () => {
    // Not the same object reference every time (loadContractSnapshot builds a
    // fresh object), but the SAME data — proven via the rendered text.
    const a = loadContractSnapshot();
    const b = loadContractSnapshot();
    expect(renderCss(a)).toBe(renderCss(b));
    expect(renderTs(a)).toBe(renderTs(b));
  });
});

describe('generate-presentation-tokens: drift gate', () => {
  test('a mutated glyph changes renderCss output vs the checked-in file', () => {
    const mutated = mutateGlyph(loadContractSnapshot());
    const checkedIn = readFileSync(CSS_OUT_PATH, 'utf8');
    expect(renderCss(mutated)).not.toBe(checkedIn);
  });

  test('a mutated glyph changes renderTs output vs the checked-in file', () => {
    const mutated = mutateGlyph(loadContractSnapshot());
    const checkedIn = readFileSync(TS_OUT_PATH, 'utf8');
    expect(renderTs(mutated)).not.toBe(checkedIn);
  });

  test('a mutated tone color changes renderCss output vs the checked-in file', () => {
    const mutated = mutateToneColor(loadContractSnapshot());
    const checkedIn = readFileSync(CSS_OUT_PATH, 'utf8');
    expect(renderCss(mutated)).not.toBe(checkedIn);
  });

  test('writeIfChanged(checkOnly: true) reports drift for a mutated snapshot, without writing', () => {
    const mutated = mutateGlyph(loadContractSnapshot());
    const drifted = writeIfChanged(CSS_OUT_PATH, renderCss(mutated), true);
    expect(drifted).toBe(true);
    // Prove it genuinely did not write: the file on disk is still the
    // unmutated, checked-in version.
    const stillCheckedIn = readFileSync(CSS_OUT_PATH, 'utf8');
    expect(stillCheckedIn).toBe(renderCss(loadContractSnapshot()));
  });

  test('writeIfChanged(checkOnly: true) reports NO drift when content is unchanged', () => {
    const snapshot = loadContractSnapshot();
    const drifted = writeIfChanged(CSS_OUT_PATH, renderCss(snapshot), true);
    expect(drifted).toBe(false);
  });
});

describe('generate-presentation-tokens: checked-in artifacts up to date', () => {
  test('src/styles/generated/presentation-tokens.css matches the installed SDK contract', () => {
    const snapshot = loadContractSnapshot();
    expect(writeIfChanged(CSS_OUT_PATH, renderCss(snapshot), true)).toBe(false);
  });

  test('src/lib/generated/presentation-tokens.ts matches the installed SDK contract', () => {
    const snapshot = loadContractSnapshot();
    expect(writeIfChanged(TS_OUT_PATH, renderTs(snapshot), true)).toBe(false);
  });
});
