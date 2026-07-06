/**
 * Cascade-order-independence guard for the W7 white-band fix (W5-W4).
 *
 * The bug this test exists to prevent: .topbar (and the sibling
 * .chat-surface/.chat-header/.detail-header/.knowledge-search surfaces) used
 * to declare a light-literal background AND a separately-positioned unscoped
 * "dark" override of the same property — both selectors carry identical
 * specificity, so whichever rule happened to sit LATER in the file won,
 * regardless of theme. At HEAD (before this fix) the dark override always
 * came later and so always won, masking the bug — but reordering the two
 * blocks (an entirely plausible future edit, since nothing in the source
 * signals they are coupled) would have resurrected a white top band in dark
 * theme. See commit fc6dcf8 for the identical anti-pattern, previously fixed
 * for .badge.*.
 *
 * This is a structural/textual guard (a "scoped-selector lint"), not a
 * rendered-style assertion: happy-dom's CSS engine does not reliably resolve
 * attribute-selector specificity (verified during this fix — a manual check
 * against a [data-theme="light"] rule and a same-specificity plain-class rule
 * returned the wrong winner), so it cannot be trusted to assert real cascade
 * behavior. The live, real-browser proof (computed background color in both
 * themes, desktop + phone, against an isolated daemon) lives in the
 * Playwright proof run for this work order; this test guards the SOURCE
 * shape that makes that proof durable against a future reorder.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STYLES_PATH = join(import.meta.dir, 'styles.css');
const css = readFileSync(STYLES_PATH, 'utf8');

/** Extract every top-level rule block whose selector list matches `selectorRe`. */
function findRuleBlocks(selectorRe: RegExp): string[] {
  const blocks: string[] = [];
  let index = 0;
  while (index < css.length) {
    const openBrace = css.indexOf('{', index);
    if (openBrace === -1) break;
    // Selector text is everything since the end of the previous rule's closing brace.
    const selectorStart = css.lastIndexOf('}', openBrace) + 1;
    const selector = css.slice(selectorStart, openBrace);
    const closeBrace = css.indexOf('}', openBrace);
    if (closeBrace === -1) break;
    if (selectorRe.test(selector)) {
      blocks.push(css.slice(openBrace + 1, closeBrace));
    }
    index = closeBrace + 1;
  }
  return blocks;
}

describe('styles.css — .topbar / dark-surface cascade region (W5-W4)', () => {
  test('.topbar declares `background` exactly once — no unscoped duplicate to reorder', () => {
    // Matches a selector block whose selector list is EXACTLY `.topbar` (not
    // `.topbar h1`, `.topbar-actions`, etc. — those are unrelated declarations
    // this guard must not trip on).
    const topbarBlocks = findRuleBlocks(/(^|,)\s*\.topbar\s*(,|$)/);
    const blocksWithBackground = topbarBlocks.filter((block) => /(?<![-\w])background\s*:/.test(block));
    expect(blocksWithBackground.length).toBe(1);
  });

  test('.topbar background is token-driven (var(--surface-raised)), not a literal color', () => {
    const topbarBlocks = findRuleBlocks(/(^|,)\s*\.topbar\s*(,|$)/);
    const backgroundBlock = topbarBlocks.find((block) => /(?<![-\w])background\s*:/.test(block));
    expect(backgroundBlock).toBeDefined();
    expect(backgroundBlock).toMatch(/background:\s*var\(--surface-raised\)/);
  });

  test('the shared panel/chat-surface/detail-header/knowledge-search light background is theme-scoped, not a bare unscoped literal', () => {
    // The near-white rgb(255 255 255 / 94%) literal must live under
    // :root[data-theme="light"] — never as a bare, unscoped selector, which
    // is exactly what let the later unscoped dark block's win depend on file
    // order instead of the theme attribute.
    const scopedLightBlocks = findRuleBlocks(/:root\[data-theme="light"\]\s*\.(panel|data-block|answer-panel|side-panel|chat-surface|detail-header|knowledge-search)\b/);
    const hasScopedLightLiteral = scopedLightBlocks.some((block) => /background:\s*rgb\(255 255 255 \/ 94%\)/.test(block));
    expect(hasScopedLightLiteral).toBe(true);

    // And the SAME literal must not also appear on a bare (unscoped) selector
    // list for that group — that would reintroduce the two-rules-same-
    // specificity race this fix removed.
    const bareBlocks = findRuleBlocks(/(^|,)\s*\.(panel|data-block|answer-panel|side-panel|chat-surface|detail-header|knowledge-search)\s*(,|{|$)/);
    const bareHasLightLiteral = bareBlocks.some((block) => /background:\s*rgb\(255 255 255 \/ 94%\)/.test(block));
    expect(bareHasLightLiteral).toBe(false);
  });

  test('.chat-surface and .chat-header backgrounds are token-driven, not near-white literals with no dark counterpart', () => {
    const chatSurfaceBlocks = findRuleBlocks(/(^|,)\s*\.chat-surface\s*(,|{|$)/)
      .filter((block) => /(?<![-\w])background\s*:/.test(block));
    const chatHeaderBlocks = findRuleBlocks(/(^|,)\s*\.chat-header\s*(,|{|$)/)
      .filter((block) => /(?<![-\w])background\s*:/.test(block));

    expect(chatSurfaceBlocks.length).toBe(1);
    expect(chatSurfaceBlocks[0]).toMatch(/background:\s*var\(--surface-raised\)/);

    expect(chatHeaderBlocks.length).toBe(1);
    expect(chatHeaderBlocks[0]).toMatch(/background:\s*var\(--surface-raised\)/);
  });

  test('--surface-raised itself is defined per-theme in tokens.css (the mechanism these fixes rely on)', () => {
    const tokensPath = join(import.meta.dir, 'styles', 'tokens.css');
    const tokens = readFileSync(tokensPath, 'utf8');
    expect(tokens).toMatch(/:root\s*{[^}]*--surface-raised:\s*rgb\(8 8 15 \/ 86%\)/s);
    expect(tokens).toMatch(/:root\[data-theme="light"\]\s*{[^}]*--surface-raised:\s*#ffffff/s);
  });
});
