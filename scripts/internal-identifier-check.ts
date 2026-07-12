#!/usr/bin/env bun
/**
 * internal-identifier-check — bans internal planning identifiers (workstream
 * ids, wave ids, work-order ids, debt-register ids, round ids, and lettered
 * finding/brief ids) from every git-tracked text file in this repo.
 *
 * Ported from goodvibes-tui/scripts/internal-identifier-rule.ts and extended
 * with the workstream-id shape ("WS" + digits) that had leaked into this
 * repo's file headers. These tokens are coordination shorthand for planning
 * conversations only — the owner's doctrine, quoted verbatim in the failure
 * message below, is that they must never appear in code, comments, docs, or
 * test names. A sweep removed every instance from this repo; this check
 * exists so a new one can never land again without failing the build.
 *
 * Provenance belongs in decision-record paths (docs/decisions/*.md) or
 * version numbers (CHANGELOG.md entries) instead.
 *
 * Shape notes carried over from the original rule:
 *  - F-plus-digits is deliberately NOT in the lettered-finding range: F1..F12
 *    are function keys, genuine technical vocabulary.
 *  - The bare lettered token (a capital A-E plus one or two digits, no
 *    surrounding delimiter) is deliberately NOT banned — it has too many
 *    genuine technical uses (API object ids, base64 fragments, spreadsheet
 *    cells) to ban without an unacceptable false-positive rate. Only three
 *    unambiguous shapes are banned: the token alone inside parentheses, a
 *    test/describe/it title starting with the token plus a colon/em-dash,
 *    and two or more tokens chained by forward slashes.
 *  - Only git-TRACKED files are scanned: build artifacts (dist/, the
 *    playwright report under e2e/.artifacts/) contain minified variable
 *    names that pattern-collide — compiler output, not planning shorthand.
 *
 * Run standalone: `bun run internal-identifiers:check`
 * Wired into: `bun run build` (and therefore `bun run ci`, `bun run gate`,
 * and the CI workflow's Build step).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const OWNER_DOCTRINE =
  'never put wave/work-order/register ids in outward-facing or in-code text; ' +
  'plain language only; provenance via decision-record paths or versions';

export const INTERNAL_IDENTIFIER_PATTERNS: readonly RegExp[] = [
  /\bWS-?[0-9]{1,2}\b/g, // workstream id: "WS" (optionally hyphenated) plus 1-2 digits — the shape this repo leaked
  /\bW[0-9]{1,2}\.[0-9]{1,2}\b/g, // wave.item id: a capital W, 1-2 digits, a dot, 1-2 digits
  /\bwo[0-9]{3,4}\b/gi, // numeric work-order id: "wo" followed by 3-4 digits
  /\bWO-[A-Z]\b/g, // lettered work-order id: "WO-" followed by one capital letter
  /\bWO-[0-9]{2,4}\b/g, // numbered work-order id: "WO-" followed by 2-4 digits
  /\bDEBT-[0-9]+\b/g, // debt-register id: "DEBT-" followed by digits
  /\bUX-[A-Z]\b/g, // UX-workstream id: "UX-" followed by one capital letter
  /\bWave[- ][0-9]+\b/g, // wave word-form: "Wave" plus a hyphen or space plus digits
  /\bW[0-9]+-R[0-9]+\b/g, // wave-round id: a capital W, digits, a hyphen, capital R, digits
  /\([A-E][0-9]{1,2}\)/g, // a lettered finding id (A-E, 1-2 digits) alone inside parentheses — F excluded (function keys)
  /\b(?:describe|test|it)\(\s*['"][A-E][0-9]{1,2}\s*(?::|—)/g, // a test/describe/it title starting with a lettered finding id plus a colon or em-dash
  /\b[A-E][0-9]{1,2}(?:\/[A-E][0-9]{1,2}){1,}\b/g, // two or more lettered finding ids chained by forward slashes
];

export interface InternalIdentifierCandidate {
  readonly relPath: string;
  readonly text: string;
}

export interface ExemptionConfig {
  /** Exact repo-relative paths (forward-slash form) skipped entirely. */
  readonly exemptFiles?: readonly string[];
  /** Repo-relative path prefixes (forward-slash form) skipped entirely. */
  readonly exemptPrefixes?: readonly string[];
}

/**
 * The standing exemption lists. The sweep left no product file that needs
 * one; the single entry is this rule's own test file, whose fixture strings
 * must spell the banned shapes literally to exercise every pattern. Any
 * future genuine need (a dated historical record, a pinned byte-for-byte
 * fixture) gets a reviewed entry here instead of an ad-hoc pattern
 * carve-out.
 */
export const EXEMPT_FILES: readonly string[] = ['scripts/internal-identifier-check.test.ts'];
export const EXEMPT_PREFIXES: readonly string[] = [];

export function isExempt(relPath: string, config: ExemptionConfig = {}): boolean {
  const normalized = relPath.split('\\').join('/');
  const files = config.exemptFiles ?? EXEMPT_FILES;
  const prefixes = config.exemptPrefixes ?? EXEMPT_PREFIXES;
  return files.includes(normalized) || prefixes.some((p) => normalized.startsWith(p));
}

export function checkNoInternalIdentifiers(
  candidates: readonly InternalIdentifierCandidate[],
  config: ExemptionConfig = {},
): string[] {
  const violations: string[] = [];
  for (const { relPath, text } of candidates) {
    if (isExempt(relPath, config)) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const pattern of INTERNAL_IDENTIFIER_PATTERNS) {
        pattern.lastIndex = 0;
        const match = pattern.exec(line);
        if (match) {
          violations.push(
            `${relPath}:${i + 1}: internal planning identifier "${match[0]}" — ${OWNER_DOCTRINE} [internal-identifier]`,
          );
          break;
        }
      }
    }
  }
  return violations;
}

/** File extensions treated as scannable text. Everything else is skipped. */
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.md',
  '.html',
  '.json',
  '.svg',
  '.yml',
  '.yaml',
  '.toml',
  '.txt',
]);

function hasTextExtension(relPath: string): boolean {
  const dot = relPath.lastIndexOf('.');
  return dot !== -1 && TEXT_EXTENSIONS.has(relPath.slice(dot).toLowerCase());
}

/** Enumerate git-tracked text files under `root` (build artifacts are untracked, so never scanned). */
export function collectTrackedTextCandidates(root: string): InternalIdentifierCandidate[] {
  const proc = Bun.spawnSync(['git', 'ls-files', '-z'], { cwd: root });
  if (proc.exitCode !== 0) {
    throw new Error(`git ls-files failed in ${root}: ${proc.stderr.toString()}`);
  }
  const relPaths = proc.stdout
    .toString()
    .split('\0')
    .filter((p) => p.length > 0 && hasTextExtension(p));
  return relPaths.map((relPath) => ({
    relPath,
    text: readFileSync(join(root, relPath), 'utf8'),
  }));
}

if (import.meta.main) {
  const root = process.cwd();
  const candidates = collectTrackedTextCandidates(root);
  const violations = checkNoInternalIdentifiers(candidates);
  if (violations.length > 0) {
    console.error('[internal-identifiers:check] FAILED — internal planning identifiers found:');
    for (const v of violations) console.error(`  ${v}`);
    console.error(
      `\n[internal-identifiers:check] Owner doctrine: ${OWNER_DOCTRINE}. ` +
        'Rewrite the flagged text in plain language describing the actual thing.',
    );
    process.exit(1);
  }
  console.log(
    `[internal-identifiers:check] PASSED — ${String(candidates.length)} tracked text files, no internal planning identifiers.`,
  );
  process.exit(0);
}
