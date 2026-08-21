#!/usr/bin/env bun
/**
 * release-gate, thin invocation of @pellux/goodvibes-toolchain's
 * sdk-pin-gate CLI, configured by this repo's toolchain.config.json.
 *
 * The six gates this used to implement locally (ported from
 * goodvibes-tui/scripts/publish-check.ts's SDK-pin section, plus this repo's
 * own exports-map addition) now live once in the shared toolchain package
 * (goodvibes-sdk/packages/toolchain/src/lib/sdk-pin-gate.ts) and are tested
 * there. This file only resolves the installed toolchain package's CLI
 * binary and execs it against this repo's cwd, no gate logic lives here.
 *
 * TOOLCHAIN-PIN: `@pellux/goodvibes-toolchain` is an explicit devDependency
 * in package.json, pinned exact to the same version as `@pellux/goodvibes-sdk`
 * (see bun.lock), so its resolved location matches what the sdk's own
 * transitive dependency would resolve to. This file needs no change when
 * that version bumps.
 *
 * Run standalone: `bun run scripts/release-gate.ts`
 * Wired into: `bun run release:gate`, `bun run gate`, and `prepublishOnly`,
 * plus the "Release gates" step in .github/workflows/ci.yml.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const toolchainPkgJson = require.resolve('@pellux/goodvibes-toolchain/package.json');
const sdkPinGateBin = join(dirname(toolchainPkgJson), 'dist/bin/sdk-pin-gate.js');

const result = spawnSync('bun', [sdkPinGateBin], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
