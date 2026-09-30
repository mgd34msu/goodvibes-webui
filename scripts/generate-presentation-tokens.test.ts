/**
 * generate-presentation-tokens.test.ts: a change in the SDK presentation
 * contract (a glyph, a tone color) reaches both emitted artifacts, the same
 * contract renders the same way every time, and the artifacts are written only
 * when their content changes. The artifacts themselves are regenerated at the
 * version bump (scripts/release-prepare.ts), so nothing here compares them with
 * the checked-in files.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeProjectTempDir } from './helpers/project-temp';
import {
  loadContractSnapshot,
  renderCss,
  renderTs,
  writeIfChanged,
  type PresentationContractSnapshot,
} from './generate-presentation-tokens';

function withSuccessGlyph(snapshot: PresentationContractSnapshot, glyph: string): PresentationContractSnapshot {
  return {
    ...snapshot,
    glyphs: { ...snapshot.glyphs, status: { ...snapshot.glyphs.status, success: glyph } },
  };
}

function withGoodTone(snapshot: PresentationContractSnapshot, color: string): PresentationContractSnapshot {
  return {
    ...snapshot,
    toneDark: { ...snapshot.toneDark, state: { ...snapshot.toneDark.state, good: color } },
  };
}

describe('generate-presentation-tokens', () => {
  test('a changed status glyph reaches both the CSS and the TS artifact', () => {
    const base = loadContractSnapshot();
    const changed = withSuccessGlyph(base, '☺');
    expect(renderCss(base)).not.toContain('☺');
    expect(renderCss(changed)).toContain('☺');
    expect(renderTs(changed)).toContain('☺');
  });

  test('a changed tone color reaches the CSS artifact', () => {
    const changed = withGoodTone(loadContractSnapshot(), '#123456');
    expect(renderCss(changed)).toContain('#123456');
  });

  test('two independent loads of the installed SDK render byte-identical output', () => {
    const a = loadContractSnapshot();
    const b = loadContractSnapshot();
    expect(renderCss(a)).toBe(renderCss(b));
    expect(renderTs(a)).toBe(renderTs(b));
  });

  test('writeIfChanged writes new content and reports identical content as unchanged', () => {
    const dir = makeProjectTempDir('webui-gen-presentation-');
    try {
      const path = join(dir, 'nested', 'tokens.css');
      expect(writeIfChanged(path, 'a {}')).toBe(true);
      expect(readFileSync(path, 'utf8')).toBe('a {}');
      expect(writeIfChanged(path, 'a {}')).toBe(false);
      expect(writeIfChanged(path, 'b {}')).toBe(true);
      expect(readFileSync(path, 'utf8')).toBe('b {}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
