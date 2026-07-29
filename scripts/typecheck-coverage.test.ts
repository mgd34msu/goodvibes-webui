/**
 * typecheck-coverage.test.ts — the gate's own gate.
 *
 * A coverage check that silently covers nothing is the exact failure it exists to
 * catch, so the first thing proved here is that findUncoveredFiles can answer NO:
 * given a covered set with a file genuinely missing, it names that file. Then the
 * usual direction (a fully covered set passes), then two facts about the real repo:
 * the project list this gate walks is the same list `bun run typecheck` runs, and
 * the enumeration actually finds files under scripts/ and e2e/ — the directories
 * that were blind.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COVERAGE_EXEMPT_PATHS,
  TYPECHECK_PROJECTS,
  findUncoveredFiles,
  isTypeScriptPath,
  listProjectFiles,
  listRepoTypeScriptFiles,
} from './typecheck-coverage';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('findUncoveredFiles can answer NO', () => {
  test('a file absent from the covered set is reported', () => {
    const all = ['src/a.ts', 'scripts/b.ts', 'e2e/c.ts'];
    const covered = ['src/a.ts', 'e2e/c.ts'];
    expect(findUncoveredFiles(all, covered)).toEqual(['scripts/b.ts']);
  });

  test('the exact historical gap — an entire directory outside every project — is reported', () => {
    // The real 2026-07 shape: tsconfig included src only, so all of scripts/ and
    // e2e/ were invisible. If this gate had existed, this is what it would have said.
    const all = ['src/main.tsx', 'scripts/release-gate.ts', 'e2e/support/mock-daemon.ts', 'e2e/pwa.e2e.ts'];
    const coveredBySrcOnlyProject = ['src/main.tsx'];
    expect(findUncoveredFiles(all, coveredBySrcOnlyProject)).toEqual([
      'e2e/pwa.e2e.ts',
      'e2e/support/mock-daemon.ts',
      'scripts/release-gate.ts',
    ]);
  });

  test('several missing files are all reported, sorted, not just the first', () => {
    const all = ['a/z.ts', 'a/a.ts', 'b/m.ts'];
    expect(findUncoveredFiles(all, [])).toEqual(['a/a.ts', 'a/z.ts', 'b/m.ts']);
  });

  test('an empty covered set does NOT vacuously pass', () => {
    expect(findUncoveredFiles(['src/only.ts'], [])).toHaveLength(1);
  });
});

describe('findUncoveredFiles answers YES only when coverage is real', () => {
  test('a fully covered set reports nothing', () => {
    const all = ['src/a.ts', 'scripts/b.ts'];
    expect(findUncoveredFiles(all, ['src/a.ts', 'scripts/b.ts', 'extra/not-tracked.ts'])).toEqual([]);
  });

  test('an empty repo reports nothing (no false positive on nothing)', () => {
    expect(findUncoveredFiles([], [])).toEqual([]);
  });
});

describe('isTypeScriptPath', () => {
  test('accepts the authored extensions', () => {
    for (const path of ['a.ts', 'a.tsx', 'a.mts', 'a.cts']) {
      expect(isTypeScriptPath(path)).toBe(true);
    }
  });

  test('rejects non-TypeScript and declaration files', () => {
    for (const path of ['a.js', 'a.jsx', 'a.json', 'a.css', 'vite-env.d.ts']) {
      expect(isTypeScriptPath(path)).toBe(false);
    }
  });
});

describe('the gate is wired to the command CI actually runs', () => {
  test('every project in TYPECHECK_PROJECTS is compiled by package.json\'s "typecheck"', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    // `typecheck` is a chain of sub-scripts; flatten it to the text that actually runs.
    const typecheckChain = pkg.scripts.typecheck
      .split('&&')
      .map((part) => part.trim())
      .map((part) => {
        const named = /^bun run ([\w:-]+)$/.exec(part);
        return named ? (pkg.scripts[named[1]] ?? part) : part;
      })
      .join(' && ');

    // tsconfig.json is the default project for a bare `tsc --noEmit`.
    expect(typecheckChain).toContain('tsc --noEmit');
    for (const project of TYPECHECK_PROJECTS) {
      if (project === 'tsconfig.json') continue;
      const projectDir = project.replace(/\/tsconfig\.json$/, '');
      expect(typecheckChain).toContain(`tsc -p ${projectDir} --noEmit`);
    }
    // And the coverage gate itself runs, or nothing above is enforced.
    expect(typecheckChain).toContain('scripts/typecheck-coverage.ts');
  });

  test('build runs the full typecheck chain, not a bare tsc', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.build).toContain('bun run typecheck');
  });
});

describe('against the real repo', () => {
  test('enumeration finds TypeScript under src, scripts, and e2e', () => {
    const files = listRepoTypeScriptFiles(ROOT);
    expect(files.some((f) => f.startsWith('src/'))).toBe(true);
    expect(files.some((f) => f.startsWith('scripts/'))).toBe(true);
    expect(files.some((f) => f.startsWith('e2e/'))).toBe(true);
    // The five test files that used to compile nowhere.
    expect(files).toContain('scripts/internal-identifier-check.test.ts');
    expect(files).toContain('e2e/support/assert-contract-shape.test.ts');
    expect(files).toContain('playwright.config.ts');
  });

  test('the scripts project really loads scripts/ files (not an empty program)', () => {
    const files = listProjectFiles('scripts/tsconfig.json', ROOT);
    expect(files).toContain('scripts/internal-identifier-check.test.ts');
    expect(files).toContain('scripts/typecheck-coverage.ts');
  });

  test('the e2e project really loads e2e/ files (not an empty program)', () => {
    const files = listProjectFiles('e2e/tsconfig.json', ROOT);
    expect(files).toContain('e2e/support/mock-daemon.ts');
    expect(files).toContain('e2e/support/assert-contract-shape.test.ts');
  });

  test('no file is exempt without a reviewed entry', () => {
    // A growing exemption list is how this gate would quietly stop meaning
    // anything; keeping the assertion here forces the change to be deliberate.
    expect(COVERAGE_EXEMPT_PATHS).toEqual([]);
  });
});
