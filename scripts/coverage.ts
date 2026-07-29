#!/usr/bin/env bun
/**
 * coverage.ts — sweep this repo's stale scratch dirs, then run the full
 * coverage suite.
 *
 * .github/workflows/ci.yml's "Coverage" step ran `bun test --isolate
 * --coverage` directly rather than through `bun run test`, so it never fired
 * the `pretest` hook (see package.json) that sweeps stale scratch dirs
 * before the normal test run — the sweep only happened because the "Run
 * tests" step (which does go through `bun run test`) ran earlier in the
 * same CI job. That's fragile: anyone running coverage standalone (locally,
 * or from a future CI job that doesn't also run `bun run test` first) would
 * get zero sweep coverage, and this repo's live-daemon-smoke.ts is a
 * confirmed real leak source from a direct-tmpdir path (see the comment on
 * makeRealTempDir in scripts/helpers/project-temp.ts).
 *
 * Wiring the sweep in here directly — rather than relying on step ordering
 * within one CI job — closes that gap, matching how goodvibes-tui and
 * goodvibes-agent wire their own coverage entry points.
 *
 * Run standalone: `bun run coverage` (wired from package.json's "coverage"
 * script, which .github/workflows/ci.yml's "Coverage" step now calls
 * instead of the raw `bun test --isolate --coverage` command).
 */
import { spawnSync } from 'node:child_process';
import { sweepStaleProjectTempDirs } from './helpers/project-temp';

const removed = sweepStaleProjectTempDirs();
if (removed.length > 0) {
  process.stdout.write(
    `coverage: swept ${removed.length} stale scratch dir(s):\n${removed.map((p) => `  - ${p}`).join('\n')}\n`,
  );
} else {
  process.stdout.write('coverage: nothing stale to sweep\n');
}

const result = spawnSync('bun', ['test', '--isolate', '--coverage'], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
