/**
 * Every `@pellux/*` subpath this app imports actually resolves.
 *
 * WHY THIS EXISTS, given the SDK already has a subpath checker. That checker iterates
 * FROM the package's `manifest.exports` map, so it validates what the SDK *declares* and
 * can never see a subpath a consumer imports but the map does not list — the one failure
 * it needs to catch. A missing export entry is invisible to it by construction.
 *
 * This test iterates from the other end: it scans this repo's own source for `@pellux/*`
 * specifiers and resolves each one. That is the direction that catches a consumer
 * importing something the published package does not expose.
 *
 * The list is DERIVED by scanning, never hand-maintained. A hand-written list would drift
 * the moment someone adds an import, which is the same weakness as validating the exports
 * map — the check has to start from the imports themselves or it proves nothing.
 *
 * A caveat worth stating rather than hiding: a `file:` overlay install can resolve more
 * leniently than a published tarball, so passing here is necessary but not sufficient. It
 * is a real check against whatever is installed, and it fails loudly against a package
 * that dropped a subpath — it is not a substitute for resolving against the published
 * artifact at release time.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC_ROOT = join(import.meta.dir, '..');

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Comments out, so prose describing an import is not mistaken for one. Found the hard
 * way: this file's own doc comment names three specimen specifiers, and the first run
 * reported all three as unresolved imports of a package that does not exist. A
 * commented-out import is not an import either, and would have failed the same way.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every distinct `@pellux/...` specifier this app imports, from static and dynamic forms. */
function importedPelluxSpecifiers(): Map<string, string[]> {
  const bySpecifier = new Map<string, string[]>();
  // Matches the static, side-effect and dynamic import forms.
  const pattern = /(?:from|import)\s*\(?\s*['"](@pellux\/[^'"]+)['"]/g;
  for (const file of sourceFiles(SRC_ROOT)) {
    const text = withoutComments(readFileSync(file, 'utf8'));
    for (const match of text.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const users = bySpecifier.get(specifier) ?? [];
      users.push(file.slice(SRC_ROOT.length + 1));
      bySpecifier.set(specifier, users);
    }
  }
  return bySpecifier;
}

describe('@pellux subpath imports resolve against the installed packages', () => {
  const specifiers = importedPelluxSpecifiers();

  test('the scan finds imports at all — a scanner that matched nothing would pass vacuously', () => {
    expect(specifiers.size).toBeGreaterThan(3);
    // The transport seam and the generated facade are load-bearing; if the scan stopped
    // finding them, the regex has drifted rather than the imports having gone away.
    expect([...specifiers.keys()]).toContain('@pellux/goodvibes-sdk/contracts');
    expect([...specifiers.keys()]).toContain('@pellux/goodvibes-contracts/generated/webui-facade');
  });

  test('every imported subpath resolves', () => {
    const unresolved: string[] = [];
    for (const [specifier, users] of specifiers) {
      try {
        // Resolution only — the exports map plus file existence, which is exactly the
        // failure mode. Importing would additionally execute the module, which this
        // check does not need and which would drag node-only deps into the test.
        Bun.resolveSync(specifier, SRC_ROOT);
      } catch {
        unresolved.push(`${specifier} (imported by ${users.join(', ')})`);
      }
    }
    expect(unresolved).toEqual([]);
  });

  test('the artifact subpaths are declared exports, not deep reaches into dist', () => {
    // A consumer reaching past the exports map (…/dist/… directly) works locally and
    // breaks on a published package that does not declare it. Nothing here may do that.
    const deepReaches = [...specifiers.keys()].filter((specifier) => specifier.includes('/dist/'));
    expect(deepReaches).toEqual([]);
  });
});
