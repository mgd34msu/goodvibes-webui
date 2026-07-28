/**
 * project-temp.ts — scratch-directory helper for this repo's own tests.
 *
 * WHY THIS EXISTS: tests that call `mkdtempSync(join(tmpdir(), prefix))`
 * scatter scratch directories across the REAL OS tmpfs. Cleanup normally
 * happens in `afterEach`/`finally`, but that code never runs if the process
 * is killed by a signal (CI cancellation, a timeout kill, ctrl-C) — so the
 * directories accumulate forever. This is not hypothetical: it happened for
 * real across this ecosystem's repos and exhausted /tmp's inode table
 * (1,048,436 of 1,048,576 inodes in use) from roughly 40 distinct leak
 * prefixes. This repo's contribution to that was small — exactly 3 call
 * sites — but the same failure mode applies here.
 *
 * This module gives those 3 call sites
 * (scripts/internal-identifier-check.test.ts, scripts/sdk-dev.test.ts,
 * scripts/live-daemon-smoke.ts) one place to create and clean up scratch
 * directories:
 *
 *   - `makeProjectTempDir` roots scratch dirs under an in-repo `.test-tmp/`
 *     directory (already gitignored) instead of the shared OS tmpdir, so a
 *     leaked directory only ever competes with THIS repo's own runs, is easy
 *     to find (`ls .test-tmp`), and can be swept without any risk of
 *     touching another project's leftovers in the shared /tmp.
 *
 *   - `makeRealTempDir` is the same thing but rooted at the real
 *     `os.tmpdir()`. It exists for exactly one caller today
 *     (live-daemon-smoke.ts's daemon home/work dirs) — see the long comment
 *     on that function for why.
 *
 *   - Both register the directory for best-effort removal via
 *     `process.on('exit', ...)`. This mirrors what a normal
 *     `afterEach`/`finally` already does and does NOT add any new
 *     guarantee — a SIGKILL skips 'exit' handlers exactly like it skips
 *     `afterAll`. The actual backstop for that case is `sweepStaleProjectTempDirs`
 *     below, run before the suite via the `pretest` hook (see package.json).
 *
 *   - `sweepStaleProjectTempDirs` removes only directories whose basename
 *     starts with one of THIS repo's own known prefixes, only when they are
 *     older than a threshold, from both roots. It is intentionally narrow:
 *     no blanket tmpdir sweep, ever.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Repo root, resolved from this file's location (scripts/helpers/..). */
export const REPO_ROOT = resolve(import.meta.dir, '../..');

/** In-repo scratch root. Already listed in .gitignore. */
export const PROJECT_TEMP_ROOT = join(REPO_ROOT, '.test-tmp');

/**
 * Every mkdtemp prefix this repo's tests use, in one place, so the stale
 * sweep and the ESLint rule's allowlist (if ever needed) have a single
 * source of truth instead of three independently-drifting copies.
 *
 * - 'internal-id-check-'   scripts/internal-identifier-check.test.ts
 * - 'webui-sdk-dev-'       scripts/sdk-dev.test.ts
 * - 'gv-live-smoke-home-'  scripts/live-daemon-smoke.ts (daemon home dir)
 * - 'gv-live-smoke-work-'  scripts/live-daemon-smoke.ts (daemon working dir)
 */
export const KNOWN_TEMP_PREFIXES = [
  'internal-id-check-',
  'webui-sdk-dev-',
  'gv-live-smoke-home-',
  'gv-live-smoke-work-',
] as const;

/**
 * Age threshold for the stale sweep: 60 minutes.
 *
 * This repo's full `bun test --isolate` run takes well under a minute
 * (~45s for ~2,000 tests measured locally) and `live-daemon-smoke.ts` runs
 * in a few seconds, so any of this repo's own scratch directories are
 * either cleaned up within seconds of creation or abandoned outright by a
 * killed process. A 60-minute threshold gives enormous headroom against a
 * slow or debugger-paused local run (so the sweep can never delete a
 * directory a concurrently-running test still owns) while still reaping
 * anything left over from a killed process within the same CI job or the
 * same working day — nothing here is expected to legitimately survive an
 * hour.
 */
export const STALE_AGE_MS = 60 * 60 * 1000;

const registeredForCleanup: string[] = [];
let exitHookInstalled = false;

/**
 * Remove every directory registered via `register` below and clear the
 * registry. Idempotent (an empty registry is a no-op) and safe to call
 * multiple times or from multiple call sites (the `process.on('exit')`
 * handler and a `bun:test` `afterAll` both call this same function).
 */
function drainRegistered(): void {
  for (const dir of registeredForCleanup.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort. sweepStaleProjectTempDirs is the real backstop for
      // anything this leaves behind (e.g. a signal-killed process that
      // skips both this and any 'exit'/afterAll handler entirely).
    }
  }
}

/**
 * Best-effort fallback cleanup for plain `bun run` invocations (e.g.
 * live-daemon-smoke.ts). Empirically verified: Bun's TEST RUNNER never
 * fires `process.on('exit')` handlers — a `bun test` file that registers
 * one never sees it run, while the identical handler in a plain
 * `bun run some-script.ts` fires correctly. So this hook is a real cleanup
 * mechanism for a script invoked directly, but is silently inert under
 * `bun test`. `.test.ts` files MUST NOT rely on this alone — see
 * `installTestCleanup` below, which uses `bun:test`'s `afterAll` instead
 * (confirmed to fire reliably under the test runner).
 */
function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', drainRegistered);
}

function register(dir: string): string {
  installExitHook();
  registeredForCleanup.push(dir);
  return dir;
}

/**
 * Wire this registry's cleanup into `bun:test`'s `afterAll` lifecycle hook,
 * which — unlike `process.on('exit')` — Bun's test runner actually drives.
 *
 * Call this ONCE at module top level in every `.test.ts` file that uses
 * `makeProjectTempDir`, passing `afterAll` imported from `bun:test`:
 *
 *   import { afterAll, test, expect } from 'bun:test';
 *   import { makeProjectTempDir, installTestCleanup } from './helpers/project-temp';
 *   installTestCleanup(afterAll);
 *
 * This module does not import `bun:test` itself and call `afterAll`
 * directly, because this file is also imported by live-daemon-smoke.ts — a
 * plain script, not a test — where `bun:test` lifecycle hooks do not apply
 * and importing them would be a lie about what this module is.
 */
export function installTestCleanup(afterAllFn: (fn: () => void) => void): void {
  afterAllFn(drainRegistered);
}

/**
 * Create a scratch directory under the in-repo `.test-tmp/` root (gitignored)
 * and register it for best-effort removal.
 *
 * Use this for scratch dirs that never boot a real daemon or otherwise
 * depend on living outside the checkout — today that's
 * internal-identifier-check.test.ts and sdk-dev.test.ts. Both of those are
 * `.test.ts` files, so BOTH must also call `installTestCleanup(afterAll)`
 * once at module top level (see that function's doc comment) — the
 * `process.on('exit')` fallback registered here does not fire under
 * `bun test` and exists only for non-test-runner callers.
 */
export function makeProjectTempDir(prefix: string): string {
  mkdirSync(PROJECT_TEMP_ROOT, { recursive: true });
  return register(mkdtempSync(join(PROJECT_TEMP_ROOT, prefix)));
}

/**
 * Create a scratch directory under the REAL `os.tmpdir()` (NOT `.test-tmp`),
 * and register it for best-effort removal on normal process exit.
 *
 * live-daemon-smoke.ts's home/work directories use this instead of
 * `makeProjectTempDir`. Unlike `makeProjectTempDir`, this does NOT need
 * `installTestCleanup` — live-daemon-smoke.ts is invoked as a plain script
 * (`bun run scripts/live-daemon-smoke.ts`, wired as the `test:live` npm
 * script), never picked up by `bun test --isolate`, and the
 * `process.on('exit')` fallback this registers is empirically confirmed to
 * fire correctly for a plain `bun run` invocation (it is only inert under
 * `bun test`). live-daemon-smoke.ts also has its own explicit
 * `finally { rmSync(...) }` cleanup independent of this hook, so in
 * practice this is defense-in-depth, not the only cleanup path.
 *
 * WHY: the analogous fix in goodvibes-sdk's own repo hit a real bug from
 * rooting a similar daemon-test scratch dir in-repo — a tool walked upward
 * from the temp dir looking for `tsconfig.json` and found the REAL repo's
 * tsconfig.json sitting above the test fixture, instead of finding none,
 * which corrupted that test's expectations. That is the exact class of
 * hazard to check for here before assuming an in-repo root is safe for a
 * script that boots a real daemon.
 *
 * Checked before deciding, rather than assuming:
 *   - ConfigManager (@pellux/goodvibes-sdk dist/platform/config/manager.js)
 *     builds `settings.json` paths by joining directly under the given
 *     `workingDir`/`homeDirectory` — it does not walk upward looking for
 *     anything.
 *   - Nothing in `bootDaemon`'s own construction/start path
 *     (dist/platform/daemon/boot.js, facade.js, facade-composition.js) calls
 *     `detectProject` (dist/platform/tools/inspect/project.js, the function
 *     that reads package.json/tsconfig.json) or does any git-toplevel
 *     detection. `detectProject` is reached only from the "inspect project"
 *     agent tool's executor — a code path live-daemon-smoke.ts never
 *     reaches, because it is deliberately model-free (see that file's own
 *     top-of-file comment): it never drives an agent turn, a tool call, or a
 *     hook, so the upward-walking tsconfig lookup that caused the SDK repo's
 *     bug is never invoked here.
 *   - Empirically verified by pointing this script's home/work dirs at an
 *     in-repo directory and running it against the real (unlinked, npm)
 *     `@pellux/goodvibes-sdk` package: it passed cleanly, and the only file
 *     the daemon wrote under the scratch dir was its own
 *     `.goodvibes/logs/activity.md` — no tsconfig, no project-detection
 *     artifact, nothing outside the scratch dir itself.
 *
 * Kept outside the checkout anyway, as a deliberate margin rather than a
 * discovered hazard: this file's entire purpose is booting a REAL daemon
 * process, or it should be trivial for a good faith agent, and if a future
 * change to this smoke test starts driving real tool/hook invocations (the
 * one thing that WOULD reach the upward-walking code path), an in-repo root
 * chosen today for an unrelated reason would silently reintroduce the SDK's
 * bug. Paying that margin costs nothing (`os.tmpdir()` is exactly as easy to
 * use as `.test-tmp`) and `sweepStaleProjectTempDirs` already covers
 * `os.tmpdir()` for this file's two prefixes, so keeping it there does not
 * reopen the leak this whole change exists to close.
 */
export function makeRealTempDir(prefix: string): string {
  return register(mkdtempSync(join(tmpdir(), prefix)));
}

/**
 * Remove this repo's own stale scratch directories from both roots
 * (`.test-tmp/` and the real `os.tmpdir()`), scoped strictly to
 * `KNOWN_TEMP_PREFIXES` and to entries older than `STALE_AGE_MS`.
 *
 * Never a blanket sweep: a directory is only ever a candidate if its
 * basename starts with one of this repo's own known prefixes, so this can
 * never touch another project's scratch directories (which use their own,
 * different prefixes) or a different round's directories that are still
 * within the age window.
 *
 * Returns the absolute paths actually removed, for logging/verification.
 */
export function sweepStaleProjectTempDirs(
  options: { now?: number; roots?: readonly string[]; prefixes?: readonly string[] } = {},
): string[] {
  const now = options.now ?? Date.now();
  const roots = options.roots ?? [PROJECT_TEMP_ROOT, tmpdir()];
  const prefixes = options.prefixes ?? KNOWN_TEMP_PREFIXES;
  const removed: string[] = [];

  for (const root of roots) {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue; // root doesn't exist yet (e.g. .test-tmp before first run) — nothing to sweep
    }

    for (const entry of entries) {
      if (!prefixes.some((prefix) => entry.startsWith(prefix))) continue;

      const fullPath = join(root, entry);
      let mtimeMs: number;
      try {
        mtimeMs = statSync(fullPath).mtimeMs;
      } catch {
        continue; // removed by something else between readdir and stat — nothing to do
      }

      if (now - mtimeMs < STALE_AGE_MS) continue; // too recent: may still be in use

      try {
        rmSync(fullPath, { recursive: true, force: true });
        removed.push(fullPath);
      } catch {
        // Best-effort: leave it for the next sweep rather than fail the caller.
      }
    }
  }

  return removed;
}
