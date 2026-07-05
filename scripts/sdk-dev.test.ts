/**
 * sdk-dev.test.ts — fast-path lifecycle checks for scripts/sdk-dev.ts.
 *
 * These cover the parts of link/status/restore that don't require building
 * the actual ~large local SDK checkout (no CI machine has one, and doing a
 * full SDK build per test run would be far too slow). They verify:
 *   - status() correctly reports "clean" against this repo's real install
 *     and exits 0; and reports "OVERLAY ACTIVE" + exit 2 when a marker
 *     fixture is planted.
 *   - link() fails fast and loud when GOODVIBES_SDK_PATH doesn't exist.
 *   - restore() is a no-op (exit 0) when no overlay is active.
 *
 * The full link -> build -> overlay -> status -> restore cycle, including a
 * real production build against the overlay's browser dist paths and a
 * verification that the overlay never corrupts bun's shared global install
 * cache, was run manually end-to-end against an isolated detached worktree
 * of the local SDK checkout as part of WO-0B (see engineer report). That
 * full cycle is not automated here because it requires a local SDK checkout
 * this repo's CI does not have.
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT_PATH = resolve(import.meta.dir, 'sdk-dev.ts');
const REPO_ROOT = resolve(import.meta.dir, '..');

function run(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): { exitCode: number; output: string } {
  const result = Bun.spawnSync(['bun', SCRIPT_PATH, ...args], {
    cwd: opts.cwd ?? REPO_ROOT,
    env: { ...process.env, ...opts.env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { exitCode: result.exitCode, output: result.stdout.toString() + result.stderr.toString() };
}

const fixtureDirs: string[] = [];
afterEach(() => {
  while (fixtureDirs.length > 0) {
    const dir = fixtureDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('sdk-dev', () => {
  test('status reports clean against the real repo install and exits 0', () => {
    // Guard: this assumes no overlay is active in the real repo while tests
    // run, which is the expected state outside of an active `sdk:link`
    // session. If this fails locally, run `bun scripts/sdk-dev.ts restore`.
    const markerPath = join(REPO_ROOT, 'node_modules/@pellux/goodvibes-sdk/.local-sdk-overlay.json');
    if (existsSync(markerPath)) {
      throw new Error('local SDK overlay is active — run `bun scripts/sdk-dev.ts restore` before running tests');
    }
    const { exitCode, output } = run(['status']);
    expect(exitCode).toBe(0);
    expect(output).toContain('sdk-dev: clean');
  });

  test('status reports OVERLAY ACTIVE and exits 2 when a marker fixture is present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'webui-sdk-dev-'));
    fixtureDirs.push(dir);
    const pkgDir = join(dir, 'node_modules', '@pellux', 'goodvibes-sdk');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@pellux/goodvibes-sdk', version: '9.9.9' }));
    writeFileSync(join(pkgDir, '.local-sdk-overlay.json'), JSON.stringify({
      sourcePath: '/fixture/goodvibes-sdk',
      sdkGit: 'main@fixture (clean)',
      overlaidAt: new Date().toISOString(),
    }));

    const { exitCode, output } = run(['status'], { cwd: dir });
    expect(exitCode).toBe(2);
    expect(output).toContain('OVERLAY ACTIVE');
  });

  test('restore is a no-op and exits 0 when no overlay is active', () => {
    const dir = mkdtempSync(join(tmpdir(), 'webui-sdk-dev-'));
    fixtureDirs.push(dir);
    const pkgDir = join(dir, 'node_modules', '@pellux', 'goodvibes-sdk');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@pellux/goodvibes-sdk', version: '0.33.30' }));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { '@pellux/goodvibes-sdk': '0.33.30' } }));

    const { exitCode, output } = run(['restore'], { cwd: dir });
    expect(exitCode).toBe(0);
    expect(output).toContain('no overlay active; nothing to restore');
  });

  test('link fails fast and names the missing checkout when GOODVIBES_SDK_PATH does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'webui-sdk-dev-'));
    fixtureDirs.push(dir);
    const missingPath = join(dir, 'does-not-exist');

    const { exitCode, output } = run(['link'], { cwd: dir, env: { GOODVIBES_SDK_PATH: missingPath } });
    expect(exitCode).toBe(1);
    expect(output).toContain('local SDK checkout not found');
    expect(output).toContain(missingPath);
  });

  test('usage message is printed and exit is non-zero for an unknown command', () => {
    const { exitCode, output } = run(['bogus']);
    expect(exitCode).toBe(1);
    expect(output).toContain('usage: bun scripts/sdk-dev.ts');
  });
});
