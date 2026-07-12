#!/usr/bin/env bun
/**
 * generate-presentation-tokens.ts
 *
 * Bridges the SDK presentation contract (@pellux/goodvibes-sdk/platform/presentation
 * — the status-glyph registry, tone-token table, thinking-phrase pool and
 * waiting-state wording that the TUI and agent already render through) onto
 * two generated, checked-in artifacts:
 *
 *   - src/lib/generated/presentation-tokens.ts     — a typed TS mirror: a
 *     literal snapshot of the contract's data tables, consumed by
 *     src/lib/presentation-bridge.ts (the hand-written semantic mapping onto
 *     web UI components) and any other code that wants the raw contract shape.
 *   - src/styles/generated/presentation-tokens.css — CSS custom properties:
 *     glyph characters as quoted `content` strings (`--contract-glyph-*`) and
 *     the state tone-color table per theme mode (`--contract-state-*`).
 *
 * This file only SNAPSHOTS data (GLYPHS, STATE_GLYPHS, TONE_TOKENS,
 * SPINNER_FRAMES, THINKING_PHRASES) — genuinely-duplicable tables per the
 * presentation contract's own docstring. `waitingPhrase` is a pure function,
 * not a data table; it has no meaningful "generated" form (a text diff of a
 * re-export wouldn't catch a behavior change), so src/lib/presentation-bridge.ts
 * imports it directly from the SDK package instead of going through here.
 *
 * `--check` fails (exit 1) the moment either artifact drifts from a fresh
 * regeneration — mirrors the SDK's own refresh-contract-artifacts.ts /
 * check-contract-artifacts.ts convention (generate-or-check, checked-in
 * output, drift = CI/build failure).
 *
 * Usage:
 *   bun run scripts/generate-presentation-tokens.ts          # write/update
 *   bun run scripts/generate-presentation-tokens.ts --check  # exit 1 on drift
 *
 * Wired into `bun run build` as `presentation:check` (see package.json) so a
 * contract change that isn't regenerated fails the build, not just CI.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GLYPHS,
  STATE_GLYPHS,
  TONE_TOKENS,
  resolveTones,
  SPINNER_FRAMES,
  THINKING_PHRASES,
} from '@pellux/goodvibes-sdk/platform/presentation';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CHECK_ONLY = process.argv.includes('--check');

export const CSS_OUT_PATH = resolve(ROOT, 'src/styles/generated/presentation-tokens.css');
export const TS_OUT_PATH = resolve(ROOT, 'src/lib/generated/presentation-tokens.ts');

// ---------------------------------------------------------------------------
// Snapshot — the exact shape the render functions need. Pulled into its own
// type (rather than importing package types inline everywhere) so a test can
// hand renderCss/renderTs a mutated fixture snapshot without needing to fake
// the npm package itself.
// ---------------------------------------------------------------------------

export interface PresentationContractSnapshot {
  readonly glyphs: typeof GLYPHS;
  readonly stateGlyphs: typeof STATE_GLYPHS;
  readonly toneDark: typeof TONE_TOKENS;
  readonly toneLight: ReturnType<typeof resolveTones>;
  readonly spinnerFrames: typeof SPINNER_FRAMES;
  readonly thinkingPhrases: typeof THINKING_PHRASES;
}

/** Read the real contract from the installed @pellux/goodvibes-sdk. */
export function loadContractSnapshot(): PresentationContractSnapshot {
  return {
    glyphs: GLYPHS,
    stateGlyphs: STATE_GLYPHS,
    toneDark: TONE_TOKENS,
    toneLight: resolveTones('light'),
    spinnerFrames: SPINNER_FRAMES,
    thinkingPhrases: THINKING_PHRASES,
  };
}

// ---------------------------------------------------------------------------
// Rendering — pure functions, no fs access, deterministic for a given input.
// ---------------------------------------------------------------------------

/** camelCase -> kebab-case for CSS custom-property names (gradientStart -> gradient-start). */
function cssIdent(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function cssStringLiteral(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const GENERATED_BANNER = [
  'GENERATED FILE — DO NOT EDIT BY HAND.',
  'Produced by scripts/generate-presentation-tokens.ts from',
  '@pellux/goodvibes-sdk/platform/presentation (the presentation contract',
  'the TUI and agent already render through — see that package\'s own',
  'docstring for the parity-audit provenance).',
  '',
  'This is a layer SEPARATE from src/styles/tokens.css: tokens.css owns the',
  'web UI\'s own brand palette / layout / motion tokens (an explicitly',
  'webui-only, NOT-contract layer, documented at its own top); this file',
  'owns only the values the SDK contract actually defines — status glyphs',
  'and the state tone-color table.',
  '',
  'Regenerate: `bun run presentation:generate`.',
  'Verify (no write): `bun run presentation:check` — wired into `bun run',
  'build`, so a contract change that was not regenerated fails the build.',
].join('\n * ');

/** Strip trailing whitespace introduced by joining banner lines around blanks. */
function stripTrailingWhitespace(text: string): string {
  return text.replace(/[ \t]+$/gm, '');
}

export function renderCss(snapshot: PresentationContractSnapshot): string {
  const lines: string[] = [];
  lines.push(`/*\n * ${GENERATED_BANNER}\n */`);
  lines.push('');
  lines.push(':root {');
  lines.push('  /* Status glyphs — GLYPHS.status, quoted for `content:` use. All 16 keys are');
  lines.push('   * emitted for parity with the TS mirror (one snapshot, not a hand-picked');
  lines.push('   * subset) even though only 4 (success/warn/failure/info — the good/warn/bad/');
  lines.push('   * info bucket STATE_GLYPHS aliases) have a real `var()` consumer today: see');
  lines.push('   * `.badge[data-contract-state]::before` in src/styles.css (FleetView.tsx /');
  lines.push('   * WorkstreamView.tsx StateBadge). The other 12 (pending/active/idle/blocked/');
  lines.push('   * skipped/review/retry/handoff/reference/partial/dualPane/star) have no');
  lines.push('   * consumer YET — kept checked-in so a future component reaching for a more');
  lines.push('   * specific glyph than the 4-bucket alias affords never has to regenerate first. */');
  for (const [key, value] of Object.entries(snapshot.glyphs.status)) {
    lines.push(`  --contract-glyph-${cssIdent(key)}: ${cssStringLiteral(value)};`);
  }
  lines.push('');
  lines.push('  /* State tone colors — TONE_TOKENS.state (dark / default). Consumed by the same');
  lines.push('   * `.badge[data-contract-state]::before` rule (src/styles.css) — deliberately only');
  lines.push('   * for the glyph\'s own tint, never the badge\'s overall background/text color: this');
  lines.push('   * web UI\'s own palette (tokens.css) is NOT repainted onto the contract\'s colors');
  lines.push('   * (see presentation-bridge.ts\'s header for why — glyphs, not colors, are the');
  lines.push('   * cross-surface parity mechanism). */');
  for (const [key, value] of Object.entries(snapshot.toneDark.state)) {
    lines.push(`  --contract-state-${cssIdent(key)}: ${value};`);
  }
  lines.push('}');
  lines.push('');
  lines.push('/* State tone colors — light-mode override (resolveTones(\'light\')). */');
  lines.push(':root[data-theme="light"] {');
  for (const [key, value] of Object.entries(snapshot.toneLight.state)) {
    lines.push(`  --contract-state-${cssIdent(key)}: ${value};`);
  }
  lines.push('}');
  lines.push('');
  return stripTrailingWhitespace(lines.join('\n'));
}

export function renderTs(snapshot: PresentationContractSnapshot): string {
  const json = (value: unknown): string => JSON.stringify(value, null, 2);
  const text = [
    `/**\n * ${GENERATED_BANNER}\n *\n * Import from src/lib/presentation-bridge.ts for the semantic mapping\n * onto web UI components; import from here directly only if you need the\n * raw contract shape.\n */`,
    '',
    `export const CONTRACT_GLYPHS = ${json(snapshot.glyphs)} as const;`,
    '',
    `export const CONTRACT_STATE_GLYPHS = ${json(snapshot.stateGlyphs)} as const;`,
    '',
    `export const CONTRACT_TONE_DARK = ${json(snapshot.toneDark)} as const;`,
    '',
    `export const CONTRACT_TONE_LIGHT = ${json(snapshot.toneLight)} as const;`,
    '',
    `export const CONTRACT_SPINNER_FRAMES = ${json(snapshot.spinnerFrames)} as const;`,
    '',
    `export const CONTRACT_THINKING_PHRASES = ${json(snapshot.thinkingPhrases)} as const;`,
    '',
    '/** The four contract severity buckets STATE_GLYPHS aliases onto. */',
    'export type ContractStatusState = keyof typeof CONTRACT_STATE_GLYPHS;',
    '',
  ].join('\n');
  return stripTrailingWhitespace(text);
}

// ---------------------------------------------------------------------------
// CLI — generate-or-check against the two checked-in artifact paths.
// ---------------------------------------------------------------------------

export function writeIfChanged(path: string, content: string, checkOnly: boolean): boolean {
  let current: string | null;
  try {
    current = readFileSync(path, 'utf8');
  } catch {
    current = null;
  }
  if (current === content) return false;
  if (checkOnly) {
    console.error(`[presentation:check] drift: ${path}`);
    return true;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  console.log(`[presentation:generate] wrote: ${path}`);
  return true;
}

if (import.meta.main) {
  const snapshot = loadContractSnapshot();
  let drifted = false;
  drifted = writeIfChanged(CSS_OUT_PATH, renderCss(snapshot), CHECK_ONLY) || drifted;
  drifted = writeIfChanged(TS_OUT_PATH, renderTs(snapshot), CHECK_ONLY) || drifted;

  if (CHECK_ONLY && drifted) {
    console.error('[presentation:check] drift detected — run `bun run presentation:generate`');
    process.exit(1);
  }
  if (!drifted) {
    console.log(CHECK_ONLY ? '[presentation:check] up-to-date' : '[presentation:generate] up-to-date');
  }
}
