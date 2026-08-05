/**
 * generate-config-ownership.test.ts
 *
 * Same three properties generate-presentation-tokens.test.ts and the
 * generate-config-schema suite already check for their generators:
 *
 *   1. Determinism — rendering the SAME snapshot twice yields byte-identical
 *      output.
 *   2. Drift gate — mutating the snapshot (simulating an SDK change to the
 *      ownership lists) changes the rendered output, so
 *      `writeIfChanged(..., checkOnly: true)` reports drift (would exit 1 in
 *      `bun run config-ownership:check`, wired into `bun run build`).
 *   3. The checked-in artifact under src/lib/generated/config-ownership.ts is
 *      itself up to date with the real, installed @pellux/goodvibes-sdk
 *      ownership tables — the same check `--check` performs, exercised
 *      directly here rather than via subprocess.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  TS_OUT_PATH,
  loadOwnershipSnapshot,
  renderTs,
  writeIfChanged,
  type ConfigOwnershipSnapshot,
} from './generate-config-ownership';

function mutatePrefixes(snapshot: ConfigOwnershipSnapshot): ConfigOwnershipSnapshot {
  return { ...snapshot, prefixes: [...snapshot.prefixes, 'stand-in-for-an-sdk-change.'] };
}

describe('generate-config-ownership: determinism', () => {
  test('renderTs is byte-identical across two calls with the same snapshot', () => {
    const snapshot = loadOwnershipSnapshot();
    expect(renderTs(snapshot)).toBe(renderTs(snapshot));
  });

  test('renderTs(loadOwnershipSnapshot()) matches the checked-in generated TS file', () => {
    const snapshot = loadOwnershipSnapshot();
    const checkedIn = readFileSync(TS_OUT_PATH, 'utf8');
    expect(renderTs(snapshot)).toBe(checkedIn);
  });

  test('the real ownership snapshot is stable across repeated loads', () => {
    const a = loadOwnershipSnapshot();
    const b = loadOwnershipSnapshot();
    expect(renderTs(a)).toBe(renderTs(b));
  });
});

describe('generate-config-ownership: drift gate', () => {
  test('a mutated prefix list changes renderTs output vs the checked-in file', () => {
    const mutated = mutatePrefixes(loadOwnershipSnapshot());
    const checkedIn = readFileSync(TS_OUT_PATH, 'utf8');
    expect(renderTs(mutated)).not.toBe(checkedIn);
  });

  test('writeIfChanged(checkOnly: true) reports drift for a mutated snapshot, without writing', () => {
    const mutated = mutatePrefixes(loadOwnershipSnapshot());
    const drifted = writeIfChanged(TS_OUT_PATH, renderTs(mutated), true);
    expect(drifted).toBe(true);
    // Prove it genuinely did not write: the file on disk is still the
    // unmutated, checked-in version.
    const stillCheckedIn = readFileSync(TS_OUT_PATH, 'utf8');
    expect(stillCheckedIn).toBe(renderTs(loadOwnershipSnapshot()));
  });

  test('writeIfChanged(checkOnly: true) reports NO drift when content is unchanged', () => {
    const snapshot = loadOwnershipSnapshot();
    const drifted = writeIfChanged(TS_OUT_PATH, renderTs(snapshot), true);
    expect(drifted).toBe(false);
  });
});

describe('generate-config-ownership: checked-in artifact up to date', () => {
  test('src/lib/generated/config-ownership.ts matches the installed SDK ownership tables', () => {
    const snapshot = loadOwnershipSnapshot();
    expect(writeIfChanged(TS_OUT_PATH, renderTs(snapshot), true)).toBe(false);
  });

  test('the snapshot includes the previously-missing conversationGate. and cluster. prefixes', () => {
    const snapshot = loadOwnershipSnapshot();
    expect(snapshot.prefixes).toContain('conversationGate.');
    expect(snapshot.prefixes).toContain('cluster.');
  });

  test('the connector credential keys are schema-owned now, not non-schema paths', () => {
    // Platform runtime 2.0.8 declared email.*, calendar.* and google.* as real
    // described schema keys under daemon-owned prefixes; keeping them in the
    // non-schema list too would double-count them in the ownership walk.
    const snapshot = loadOwnershipSnapshot();
    expect(snapshot.prefixes).toContain('email.');
    expect(snapshot.prefixes).toContain('calendar.');
    expect(snapshot.prefixes).toContain('google.');
    expect(snapshot.nonSchemaPaths).not.toContain('email.passwordRef');
    expect(snapshot.nonSchemaPaths).not.toContain('calendar.google.icsUrl');
    expect(snapshot.nonSchemaPaths).not.toContain('google.oauth.refreshToken');
  });
});
