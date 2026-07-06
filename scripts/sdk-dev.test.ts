/**
 * sdk-dev.test.ts — checks for the sdk-dev ALIAS (scripts/sdk-dev.ts).
 *
 * scripts/sdk-dev.ts is now a thin alias (consolidated by W6-DEV, Wave 6):
 * the overlay lifecycle logic (status states, the pin reader, the restore
 * version-agreement check, workspace-package enumeration incl. contracts)
 * moved to the SDK checkout's own scripts/sdk-dev.ts and is unit-tested
 * there (goodvibes-sdk/test/sdk-dev-tool.test.ts) — that is now the ONE
 * place this logic is tested, closing the drift the three independently-
 * maintained copies (this one included, which never picked up the
 * all-siblings/contracts fix) had fallen into.
 *
 * This file covers what's left in webui's copy: the alias's own guard
 * clauses (missing checkout, checkout present but stale/missing the tool
 * script) and that a present checkout is actually forwarded to. The
 * forwarding assertions are skipped when no local SDK checkout exists at the
 * resolved default path (no CI machine has one — the same precedent this
 * suite already used pre-consolidation for its "real overlay active" case).
 *
 * The full link -> build -> overlay(9 pkgs incl. contracts) -> status ->
 * restore cycle is proven once against a real checkout in the SDK's own
 * suite / the W6-DEV manual proof, not duplicated here.
 */
import { describe, test, expect } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT_PATH = resolve(import.meta.dir, 'sdk-dev.ts');
const REPO_ROOT = resolve(import.meta.dir, '..');
const DEFAULT_SDK_ROOT = resolve(process.env.GOODVIBES_SDK_PATH ?? resolve(homedir(), 'Projects/goodvibes-sdk'));
// Forwarding only succeeds once the checkout HAS the canonical tool (this
// brief's own deliverable) — a checkout dir existing without it (e.g. an SDK
// main that hasn't landed W6-DEV yet) must gate the same as "no checkout".
const SDK_TOOL_AVAILABLE = existsSync(join(DEFAULT_SDK_ROOT, 'scripts/sdk-dev.ts'));

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
    const dir = mkdtempSync(join(tmpdir(), 'webui-sdk-dev-'));
    try {
      const missingPath = join(dir, 'does-not-exist');
      const { exitCode, output } = run(['status'], { env: { GOODVIBES_SDK_PATH: missingPath } });
      expect(exitCode).toBe(1);
      expect(output).toContain('local SDK checkout not found');
      expect(output).toContain(missingPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fails with a distinct message when the checkout exists but has no scripts/sdk-dev.ts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'webui-sdk-dev-'));
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true }); // no sdk-dev.ts inside
      const { exitCode, output } = run(['status'], { env: { GOODVIBES_SDK_PATH: dir } });
      expect(exitCode).toBe(1);
      expect(output).toContain('has no scripts/sdk-dev.ts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Skipped (not failed) rather than asserting a hard requirement: no local
  // SDK checkout is a legitimate CI/sandbox state, not a regression.
  test.skipIf(!SDK_TOOL_AVAILABLE)('forwards to the canonical SDK tool and reports this repo\'s clean/overlay state', () => {
    const { exitCode, output } = run(['status']);
    expect([0, 2]).toContain(exitCode);
    expect(output).toMatch(/sdk-dev: (clean|OVERLAY ACTIVE)/);
  });

  test('usage message is printed and exit is non-zero for an unknown command', () => {
    if (!SDK_TOOL_AVAILABLE) return;
    const { exitCode, output } = run(['bogus']);
    expect(exitCode).toBe(1);
    expect(output).toContain('usage: bun scripts/sdk-dev.ts');
  });
});
