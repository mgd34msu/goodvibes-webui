/**
 * sdk-dev.test.ts, checks for the sdk-dev ALIAS (scripts/sdk-dev.ts).
 *
 * scripts/sdk-dev.ts is now a thin alias (the overlay tool was consolidated
 * into the SDK checkout):
 * the overlay lifecycle logic (status states, the pin reader, the restore
 * version-agreement check, workspace-package enumeration incl. contracts)
 * moved to the SDK checkout's own scripts/sdk-dev.ts and is unit-tested
 * there (goodvibes-sdk/test/sdk-dev-tool.test.ts), that is now the ONE
 * place this logic is tested, closing the drift the three independently-
 * maintained copies (this one included, which never picked up the
 * all-siblings/contracts fix) had fallen into.
 *
 * This file covers what's left in webui's copy: the alias's own guard
 * clauses (missing checkout, checkout present but stale/missing the tool
 * script) and that a present checkout is actually forwarded to, proven
 * against a stand-in checkout whose tool echoes what it received, so the
 * test runs the same on a machine with no SDK checkout.
 *
 * The full link -> build -> overlay(9 pkgs incl. contracts) -> status ->
 * restore cycle is proven once against a real checkout in the SDK's own
 * suite / its manual consolidation proof, not duplicated here.
 */
import { describe, test, expect, afterAll } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { makeProjectTempDir, installTestCleanup } from './helpers/project-temp';

// process.on('exit') (makeProjectTempDir's fallback cleanup) never fires
// under bun:test's runner, only afterAll does. Both tests below already
// rmSync their own dir in a try/finally, so this is belt-and-suspenders
// against a future test in this file that forgets to, not the only thing
// standing between this file and a leak.
installTestCleanup(afterAll);

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

describe('sdk-dev alias', () => {
  test('fails fast and names the missing checkout when GOODVIBES_SDK_PATH does not exist', () => {
    const dir = makeProjectTempDir('webui-sdk-dev-');
    try {
      const missingPath = join(dir, 'does-not-exist');
      const { exitCode, output } = run(['status'], { env: { GOODVIBES_SDK_PATH: missingPath } });
      expect(exitCode).toBe(1);
      expect(output).toContain(missingPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fails when the checkout exists but has no scripts/sdk-dev.ts', () => {
    const dir = makeProjectTempDir('webui-sdk-dev-');
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true }); // no sdk-dev.ts inside
      const { exitCode } = run(['status'], { env: { GOODVIBES_SDK_PATH: dir } });
      expect(exitCode).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('forwards argv, this repo as cwd, and the exit code to the checkout\'s tool', () => {
    const dir = makeProjectTempDir('webui-sdk-dev-');
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      writeFileSync(
        join(dir, 'scripts', 'sdk-dev.ts'),
        "console.log('forwarded:' + JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));\nprocess.exit(3);\n",
      );
      const { exitCode, output } = run(['status', '--verbose'], { env: { GOODVIBES_SDK_PATH: dir } });
      expect(exitCode).toBe(3);
      const line = output.split('\n').find((l) => l.startsWith('forwarded:'));
      expect(line).toBeDefined();
      const payload = JSON.parse((line ?? '').slice('forwarded:'.length)) as { argv: string[]; cwd: string };
      expect(payload.argv).toEqual(['status', '--verbose']);
      expect(payload.cwd).toBe(REPO_ROOT);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
