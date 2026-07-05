#!/usr/bin/env bun
/**
 * sdk-dev — rapid local SDK development for the WebUI.
 *
 * `link`    Build the local SDK checkout (~/Projects/goodvibes-sdk) and overlay
 *           its packages/sdk/dist (and package.json) into this repo's
 *           node_modules/@pellux/goodvibes-sdk, so SDK changes are testable in
 *           the WebUI immediately — no npm release round-trip.
 * `status`  Report whether the overlay is active and what it was built from.
 * `restore` Remove the overlay and reinstall the pinned npm version byte-exact.
 *
 * The overlay writes a marker file (.local-sdk-overlay.json) inside the
 * package directory. Release/build tooling (scripts/release-gate.ts and the
 * build-time overlay guard in scripts/build.ts) hard-fails while the marker
 * exists or while the package.json dependency is anything but an exact
 * semver — so the fast path cannot leak into a production bundle. CI is
 * immune regardless: it fresh-installs from the lockfile.
 *
 * Ported from goodvibes-tui/scripts/sdk-dev.ts.
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const WEBUI_ROOT = process.cwd();
const SDK_ROOT = process.env.GOODVIBES_SDK_PATH ?? resolve(homedir(), 'Projects/goodvibes-sdk');
const SDK_PKG_DIST = join(SDK_ROOT, 'packages/sdk/dist');
const SDK_PKG_JSON = join(SDK_ROOT, 'packages/sdk/package.json');
const INSTALLED_PKG = join(WEBUI_ROOT, 'node_modules/@pellux/goodvibes-sdk');
const MARKER = join(INSTALLED_PKG, '.local-sdk-overlay.json');

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

function fail(msg: string): never {
  console.error(`sdk-dev: ${msg}`);
  process.exit(1);
}

function link(): void {
  if (!existsSync(SDK_ROOT)) fail(`local SDK checkout not found at ${SDK_ROOT} (set GOODVIBES_SDK_PATH to override)`);
  if (!existsSync(INSTALLED_PKG)) fail('node_modules/@pellux/goodvibes-sdk missing — run bun install first');

  const sha = sh('git rev-parse --short HEAD', SDK_ROOT);
  const branch = sh('git rev-parse --abbrev-ref HEAD', SDK_ROOT);
  const dirty = sh('git status --porcelain', SDK_ROOT) ? 'dirty' : 'clean';

  console.log(`sdk-dev: building local SDK (${branch}@${sha}, ${dirty} tree)...`);
  execSync('bun run build && bun run prepare:sdk', { cwd: SDK_ROOT, stdio: 'inherit' });
  if (!existsSync(SDK_PKG_DIST)) fail(`SDK build produced no dist at ${SDK_PKG_DIST}`);

  console.log('sdk-dev: overlaying dist into node_modules/@pellux/goodvibes-sdk...');
  rmSync(join(INSTALLED_PKG, 'dist'), { recursive: true, force: true });
  cpSync(SDK_PKG_DIST, join(INSTALLED_PKG, 'dist'), { recursive: true });
  // package.json too, so new subpath exports added in the local SDK resolve.
  //
  // bun's default install backend hardlinks node_modules files to a shared
  // global cache (~/.bun/install/cache/@pellux/goodvibes-sdk@<version>@@@1).
  // Overwriting an existing file in place (cpSync onto a file that already
  // exists) writes through that hardlink and corrupts the SAME cache entry
  // every other project on the machine resolves for that pinned version —
  // discovered live during WO-0B verification (0.33.30's cache silently
  // became 0.38.0's content). Always unlink the destination first so cpSync
  // creates a fresh inode instead of truncating the shared one.
  rmSync(join(INSTALLED_PKG, 'package.json'), { force: true });
  cpSync(SDK_PKG_JSON, join(INSTALLED_PKG, 'package.json'));

  writeFileSync(MARKER, JSON.stringify({
    sourcePath: SDK_ROOT,
    sdkGit: `${branch}@${sha} (${dirty})`,
    overlaidAt: new Date().toISOString(),
    note: 'Local SDK overlay active. Run `bun scripts/sdk-dev.ts restore` before building for release; release gates and the production build fail while this file exists.',
  }, null, 2));

  console.log(`sdk-dev: LINKED — WebUI now runs the local SDK (${branch}@${sha}, ${dirty}).`);
  console.log('sdk-dev: run `bun scripts/sdk-dev.ts restore` to return to the pinned npm version.');
  console.log('sdk-dev: `bun run build` will refuse to run while this overlay is active (set GOODVIBES_ALLOW_OVERLAY_BUILD=1 for a local-only dev build).');
}

function status(): void {
  if (existsSync(MARKER)) {
    const m = JSON.parse(readFileSync(MARKER, 'utf8'));
    console.log(`sdk-dev: OVERLAY ACTIVE — ${m.sdkGit}, overlaid ${m.overlaidAt} from ${m.sourcePath}`);
    process.exit(2);
  }
  const pkg = JSON.parse(readFileSync(join(INSTALLED_PKG, 'package.json'), 'utf8'));
  console.log(`sdk-dev: clean — npm @pellux/goodvibes-sdk@${pkg.version} installed.`);
}

function restore(): void {
  if (!existsSync(MARKER)) {
    console.log('sdk-dev: no overlay active; nothing to restore.');
    return;
  }
  console.log('sdk-dev: removing overlay and reinstalling from lockfile...');
  rmSync(INSTALLED_PKG, { recursive: true, force: true });
  execSync('bun install', { cwd: WEBUI_ROOT, stdio: 'inherit' });
  if (existsSync(MARKER)) fail('marker still present after reinstall — restore failed');
  const pkg = JSON.parse(readFileSync(join(INSTALLED_PKG, 'package.json'), 'utf8'));
  const pinned = JSON.parse(readFileSync(join(WEBUI_ROOT, 'package.json'), 'utf8')).dependencies['@pellux/goodvibes-sdk'];
  if (pkg.version !== pinned) fail(`restored version ${pkg.version} does not match pinned ${pinned}`);
  console.log(`sdk-dev: RESTORED — npm @pellux/goodvibes-sdk@${pkg.version}.`);
}

const cmd = process.argv[2];
if (cmd === 'link') link();
else if (cmd === 'status') status();
else if (cmd === 'restore') restore();
else {
  console.log('usage: bun scripts/sdk-dev.ts <link|status|restore>');
  process.exit(cmd ? 1 : 0);
}
