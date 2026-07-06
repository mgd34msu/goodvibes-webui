#!/usr/bin/env bun
/**
 * sdk-dev — alias.
 *
 * The canonical local-SDK overlay tool (link/status/restore, all 9 public
 * @pellux workspace packages including goodvibes-contracts) now lives in the
 * SDK checkout itself (goodvibes-sdk/scripts/sdk-dev.ts), consolidated by
 * W6-DEV (Wave 6) to end the three-way drift between this repo's copy and
 * the TUI's and the agent's. This repo's copy never picked up the
 * all-siblings fix, so it never refreshed
 * node_modules/@pellux/goodvibes-contracts on link (the live re-sync gap
 * this brief closes) — see the SDK tool's file header. This file only
 * locates that checkout and forwards argv + this repo as cwd; it carries no
 * overlay logic of its own so the three copies can never drift again. The
 * build-time overlay guard (GOODVIBES_ALLOW_OVERLAY_BUILD) lives in
 * vite.config.ts, independent of this file, and needs no change.
 *
 * Override the checkout location with GOODVIBES_SDK_PATH (default
 * ~/Projects/goodvibes-sdk), same as before.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const SDK_ROOT = resolve(process.env.GOODVIBES_SDK_PATH ?? resolve(homedir(), 'Projects/goodvibes-sdk'));
const TOOL = resolve(SDK_ROOT, 'scripts/sdk-dev.ts');

if (!existsSync(SDK_ROOT)) {
  console.error(`sdk-dev: local SDK checkout not found at ${SDK_ROOT} (set GOODVIBES_SDK_PATH to override)`);
  process.exit(1);
}
if (!existsSync(TOOL)) {
  console.error(`sdk-dev: local SDK checkout at ${SDK_ROOT} has no scripts/sdk-dev.ts (is it up to date?)`);
  process.exit(1);
}

const result = Bun.spawnSync(['bun', TOOL, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: ['inherit', 'inherit', 'inherit'],
});
process.exit(result.exitCode ?? 1);
