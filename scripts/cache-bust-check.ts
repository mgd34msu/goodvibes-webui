#!/usr/bin/env bun
/**
 * cache-bust-check, pins index.html's `?v=` cache-bust query strings to
 * package.json's version.
 *
 * The release rule says every shipped change updates the cache-bust values in
 * index.html, but the rule lived only in prose: 1.13.14 shipped with
 * `?v=1.12.1` still on every icon link, so returning installed-app users
 * could keep stale icons while the app itself moved two releases ahead. This
 * check moves the rule into the build. It fails on any `?v=` value that does
 * not equal package.json's version, and it fails when index.html carries no
 * `?v=` value at all, so the check can never pass vacuously after a refactor
 * that drops the query strings.
 *
 * Deliberately a check, not a rewrite step: the committed index.html stays
 * the exact document that ships (the docs' release checklist edits it as part
 * of a version bump), and this gate makes forgetting that edit a build
 * failure instead of a silent drift.
 *
 * Run standalone: `bun run cache-bust:check`
 * Wired into: `bun run build` (and therefore `bun run ci`, `bun run gate`,
 * and the CI workflow's Build step).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Every `?v=<value>` occurrence in an HTML document, in order. */
export const CACHE_BUST_PATTERN = /\?v=([^"'&\s]+)/g;

export interface CacheBustViolation {
  /** 1-based line number in the document. */
  readonly line: number;
  /** The stale value found after `?v=`. */
  readonly found: string;
}

/**
 * Compare every `?v=` value in `html` against `version`. Returns the
 * mismatches; an empty result with `occurrences: 0` is the vacuous case the
 * caller must also treat as a failure.
 */
export function checkCacheBust(
  html: string,
  version: string,
): { occurrences: number; violations: CacheBustViolation[] } {
  const violations: CacheBustViolation[] = [];
  let occurrences = 0;
  const lines = html.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index] ?? '';
    for (const match of lineText.matchAll(CACHE_BUST_PATTERN)) {
      occurrences += 1;
      const found = match[1] ?? '';
      if (found !== version) violations.push({ line: index + 1, found });
    }
  }
  return { occurrences, violations };
}

if (import.meta.main) {
  const root = process.cwd();
  const version = (
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string }
  ).version;
  if (!version) {
    console.error('[cache-bust:check] FAILED: package.json has no version field.');
    process.exit(1);
  }
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const { occurrences, violations } = checkCacheBust(html, version);
  if (occurrences === 0) {
    console.error(
      '[cache-bust:check] FAILED: index.html contains no ?v= cache-bust query strings at all. ' +
        'The icon links are expected to carry them; if that changed on purpose, update this check with the new mechanism.',
    );
    process.exit(1);
  }
  if (violations.length > 0) {
    console.error(`[cache-bust:check] FAILED: index.html cache-bust values do not match package.json version ${version}:`);
    for (const violation of violations) {
      console.error(`  index.html:${String(violation.line)}: ?v=${violation.found}`);
    }
    console.error('\n[cache-bust:check] Update every ?v= value in index.html to the current version as part of the version bump.');
    process.exit(1);
  }
  console.log(
    `[cache-bust:check] PASSED: ${String(occurrences)} cache-bust value${occurrences === 1 ? '' : 's'} match version ${version}.`,
  );
  process.exit(0);
}
