/**
 * internal-identifier-check.test.ts — exercises the rule function directly
 * (per-pattern hit and legitimate-token non-regression cases) and the CLI
 * end-to-end against throwaway git fixture repos, proving a planted
 * violation fails with the owner doctrine quoted and that untracked files
 * (build artifacts) are never scanned.
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  OWNER_DOCTRINE,
  checkNoInternalIdentifiers,
  collectTrackedTextCandidates,
  isExempt,
  EXEMPT_FILES,
  EXEMPT_PREFIXES,
} from './internal-identifier-check';

const SCRIPT_PATH = resolve(import.meta.dir, 'internal-identifier-check.ts');
const REPO_ROOT = resolve(import.meta.dir, '..');

function check(line: string): string[] {
  return checkNoInternalIdentifiers([{ relPath: 'src/example.ts', text: line }]);
}

describe('banned internal-identifier shapes', () => {
  const banned: Record<string, string> = {
    'workstream id': '// CommandPalette — WS1 Command System',
    'hyphenated workstream id': '// see the WS-2 module',
    'wave.item id': '// carried over from W4.2',
    'numeric work-order id': '// wo123 follow-up',
    'lettered work-order id': '// WO-A owns this file',
    'numbered work-order id': '// WO-12 owns this file',
    'debt-register id': '// tracked as DEBT-7',
    'UX-workstream id': '// UX-B polish item',
    'wave word-form with space': '// landed in Wave 3',
    'wave word-form with hyphen': '// landed in Wave-12',
    'wave-round id': '// docstring for the W4-R1 parity audit',
    'parenthesized lettered finding id': "/* Decision trail (B2): audit provenance. */",
    'finding-id test title with colon': "test('B1: idle-reaped session badges reaped', () => {});",
    'finding-id test title with em-dash': "describe('C3 — approvals decision trail', () => {});",
    'slash-chained finding ids': '// covers A1/B2 from the review',
  };
  for (const [name, line] of Object.entries(banned)) {
    test(`flags ${name}`, () => {
      const violations = check(line);
      expect(violations.length).toBe(1);
      expect(violations[0]).toContain('src/example.ts:1');
      expect(violations[0]).toContain(OWNER_DOCTRINE);
      expect(violations[0]).toContain('[internal-identifier]');
    });
  }

  test('reports every offending line, one violation per line', () => {
    const violations = checkNoInternalIdentifiers([
      { relPath: 'src/a.ts', text: '// WS1\nclean line\n// DEBT-4 and also WS2 on the same line' },
    ]);
    expect(violations.length).toBe(2);
    expect(violations[0]).toContain('src/a.ts:1');
    expect(violations[1]).toContain('src/a.ts:3');
  });
});

describe('legitimate technical tokens are not flagged', () => {
  const legit: Record<string, string> = {
    'CSS hex colors': 'color: #E5E7EB; border-color: #B00; background: #D97706;',
    'CSS scrim rgb values': 'background: rgb(0 0 0 / 0.55);',
    'base64 data URI': "url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA')",
    'base64 fragment containing WS1 mid-token': 'const hash = "sha512-xxWS1yyB2zz==";',
    'viewport sizes': 'viewport: { width: 390, height: 844 } // 1280x720 desktop',
    'function keys (F excluded from the letter range)': 'press (F1) for help, F5 reloads',
    'ES target names': '"target": "ES2022", "lib": ["DOM", "ES2022"]',
    'bare lettered token in running text': 'the A11 control-set name and cell B2 stay legal bare',
    'accessibility shorthand': 'the a11y sweep and aria-live wiring',
    'websocket URLs': "new WebSocket('ws://127.0.0.1:3423/api/events')",
    'semver strings': '"version": "1.4.0", pinned to 0.33.30',
    'react error URL': 'https://react.dev/errors/522?args[]=x',
    'wide characters in words': 'the workstream noun itself is fine, as is Waveform 2-column',
  };
  for (const [name, line] of Object.entries(legit)) {
    test(`keeps ${name}`, () => {
      expect(check(line)).toEqual([]);
    });
  }
});

describe('exemption mechanism', () => {
  test('standing exemptions cover exactly this test file (its fixtures spell banned shapes literally)', () => {
    expect(EXEMPT_FILES).toEqual(['scripts/internal-identifier-check.test.ts']);
    expect(EXEMPT_PREFIXES.length).toBe(0);
  });

  test('exact-file exemption skips the file', () => {
    const candidates = [{ relPath: 'docs/history/old-plan.md', text: 'WS1 Command system' }];
    expect(checkNoInternalIdentifiers(candidates)).toHaveLength(1);
    expect(
      checkNoInternalIdentifiers(candidates, { exemptFiles: ['docs/history/old-plan.md'] }),
    ).toEqual([]);
  });

  test('prefix exemption skips the subtree and normalizes backslashes', () => {
    const candidates = [{ relPath: 'docs\\history\\old-plan.md', text: 'DEBT-9' }];
    expect(checkNoInternalIdentifiers(candidates, { exemptPrefixes: ['docs/history/'] })).toEqual(
      [],
    );
    expect(isExempt('docs/history/x.md', { exemptPrefixes: ['docs/history/'] })).toBe(true);
    expect(isExempt('src/x.ts', { exemptPrefixes: ['docs/history/'] })).toBe(false);
  });
});

describe('CLI end-to-end', () => {
  const fixtureDirs: string[] = [];
  afterEach(() => {
    for (const dir of fixtureDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function buildGitFixture(): string {
    const dir = mkdtempSync(join(tmpdir(), 'internal-id-check-'));
    fixtureDirs.push(dir);
    execFileSync('git', ['init', '--quiet'], { cwd: dir });
    return dir;
  }

  function runCli(cwd: string): { exitCode: number; stdout: string; stderr: string } {
    const proc = Bun.spawnSync(['bun', SCRIPT_PATH], { cwd });
    return {
      exitCode: proc.exitCode,
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
    };
  }

  test('this repo is clean: the wired check passes against the real working tree', () => {
    const result = runCli(REPO_ROOT);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('PASSED');
    expect(result.exitCode).toBe(0);
  });

  test('a tracked planted violation fails the check quoting the owner doctrine', () => {
    const dir = buildGitFixture();
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src/palette.tsx'), '/** CommandPalette — WS1 Command System */\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    const result = runCli(dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('src/palette.tsx:1');
    expect(result.stderr).toContain('"WS1"');
    expect(result.stderr).toContain(OWNER_DOCTRINE);
  });

  test('untracked files (build artifacts) are never scanned', () => {
    const dir = buildGitFixture();
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src/clean.ts'), 'export const ok = true;\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    // Untracked minified-artifact lookalike with a paren-wrapped lettered token.
    writeFileSync(join(dir, 'src/report.html'), 'function a3(){if(g2)return(A2)}\n');
    const result = runCli(dir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('PASSED');
  });

  test('collectTrackedTextCandidates skips non-text extensions and untracked paths', () => {
    const dir = buildGitFixture();
    writeFileSync(join(dir, 'a.ts'), 'tracked');
    writeFileSync(join(dir, 'b.png'), 'binary-ish');
    writeFileSync(join(dir, 'c.md'), 'untracked');
    execFileSync('git', ['add', 'a.ts', 'b.png'], { cwd: dir });
    const rels = collectTrackedTextCandidates(dir).map((c) => c.relPath);
    expect(rels).toEqual(['a.ts']);
  });
});
