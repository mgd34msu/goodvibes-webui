/**
 * cache-bust-check.test.ts, exercises the comparison function directly
 * (match, mismatch, vacuous-none) and the CLI end-to-end against throwaway
 * fixture directories, proving a stale `?v=` fails the gate, a missing
 * `?v=` fails the gate, and the repo's own index.html currently passes
 * against the repo's own package.json version.
 */
import { describe, test, expect, afterEach, afterAll } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { checkCacheBust } from './cache-bust-check';
import { makeProjectTempDir, installTestCleanup } from './helpers/project-temp';

installTestCleanup(afterAll);

const SCRIPT_PATH = resolve(import.meta.dir, 'cache-bust-check.ts');
const REPO_ROOT = resolve(import.meta.dir, '..');

describe('checkCacheBust', () => {
  test('all values matching the version yields no violations', () => {
    const html = '<link href="/a.ico?v=1.13.14" />\n<link href="/b.png?v=1.13.14" />';
    const result = checkCacheBust(html, '1.13.14');
    expect(result.occurrences).toBe(2);
    expect(result.violations).toEqual([]);
  });

  test('a stale value is reported with its line number and the found value', () => {
    const html = '<link href="/a.ico?v=1.13.14" />\n<link href="/b.png?v=1.12.1" />';
    const result = checkCacheBust(html, '1.13.14');
    expect(result.occurrences).toBe(2);
    expect(result.violations).toEqual([{ line: 2, found: '1.12.1' }]);
  });

  test('a document with no ?v= at all reports zero occurrences (the vacuous case the CLI fails on)', () => {
    const result = checkCacheBust('<link href="/a.ico" />', '1.13.14');
    expect(result.occurrences).toBe(0);
    expect(result.violations).toEqual([]);
  });

  test('multiple values on one line are each counted', () => {
    const html = '<link href="/a.ico?v=1.0.0" /><link href="/b.png?v=1.0.0" />';
    const result = checkCacheBust(html, '2.0.0');
    expect(result.occurrences).toBe(2);
    expect(result.violations).toHaveLength(2);
  });
});

describe('CLI end-to-end', () => {
  const fixtures: string[] = [];
  afterEach(() => {
    for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function makeFixture(version: string, html: string): string {
    const dir = makeProjectTempDir('cache-bust-fixture-');
    fixtures.push(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }));
    writeFileSync(join(dir, 'index.html'), html);
    return dir;
  }

  function run(cwd: string): { exitCode: number; output: string } {
    try {
      const stdout = execFileSync('bun', [SCRIPT_PATH], { cwd, encoding: 'utf8' });
      return { exitCode: 0, output: stdout };
    } catch (error) {
      const failed = error as { status?: number; stdout?: string; stderr?: string };
      return { exitCode: failed.status ?? 1, output: `${failed.stdout ?? ''}${failed.stderr ?? ''}` };
    }
  }

  test('passes when every ?v= matches the version', () => {
    const dir = makeFixture('3.4.5', '<link href="/a.ico?v=3.4.5" />');
    const { exitCode, output } = run(dir);
    expect(exitCode).toBe(0);
    expect(output).toContain('PASSED');
  });

  test('fails on a stale ?v= and names the line and value', () => {
    const dir = makeFixture('3.4.5', '<link href="/a.ico?v=3.4.5" />\n<link href="/b.png?v=1.12.1" />');
    const { exitCode, output } = run(dir);
    expect(exitCode).toBe(1);
    expect(output).toContain('index.html:2: ?v=1.12.1');
  });

  test('fails when index.html carries no ?v= at all (no vacuous pass)', () => {
    const dir = makeFixture('3.4.5', '<link href="/a.ico" />');
    const { exitCode, output } = run(dir);
    expect(exitCode).toBe(1);
    expect(output).toContain('no ?v= cache-bust query strings');
  });

  test("the repo's own index.html matches the repo's own package.json version", () => {
    const version = (
      JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { version: string }
    ).version;
    const html = readFileSync(join(REPO_ROOT, 'index.html'), 'utf8');
    const result = checkCacheBust(html, version);
    expect(result.occurrences).toBeGreaterThan(0);
    expect(result.violations).toEqual([]);
  });
});
