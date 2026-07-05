#!/usr/bin/env bun
/**
 * release-gate — SDK-pin integrity gates for goodvibes-webui.
 *
 * Ported from goodvibes-tui/scripts/publish-check.ts's SDK-pin section and
 * adapted for a browser bundle (no npm publish surface — this package is
 * private and ships as a built static bundle, not an npm package). Six gates,
 * each independently reportable:
 *
 *   1. local-sdk-overlay-absent   — scripts/sdk-dev.ts link marker must not exist
 *   2. sdk-pin-exact-semver       — package.json pin must be an exact X.Y.Z
 *   3. installed-matches-pin      — node_modules copy must equal the pin
 *   4. lockfile-resolves-pin      — bun.lock must resolve that exact version
 *   5. npm-specifier-only-imports — src may only import "@pellux/goodvibes-sdk..."
 *                                   (no relative/file:/link: paths to the SDK)
 *   6. exports-map-only-imports   — every "@pellux/goodvibes-sdk/<subpath>" import
 *                                   in src must be a subpath the SDK's own
 *                                   package.json "exports" map actually publishes
 *                                   (catches deep imports like ".../dist/foo.js"
 *                                   that bypass the public API and can break on
 *                                   any internal SDK reshuffle)
 *
 * Run standalone: `bun run scripts/release-gate.ts`
 * Wired into: `bun run gate` (local one-command parity bundle) and the
 * "Release gates" step in .github/workflows/ci.yml.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const SDK_NAME = '@pellux/goodvibes-sdk';

interface GateResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: GateResult[] = [];

function record(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const sdkPin: unknown = (pkg.dependencies ?? {})[SDK_NAME];
const installedPkgPath = join(root, 'node_modules', SDK_NAME, 'package.json');
const markerPath = join(root, 'node_modules', SDK_NAME, '.local-sdk-overlay.json');

// Gate 1 — local SDK overlay must not be active.
{
  const overlayActive = existsSync(markerPath);
  record(
    'local-sdk-overlay-absent',
    !overlayActive,
    overlayActive
      ? `overlay marker present at ${markerPath} — run \`bun scripts/sdk-dev.ts restore\` before releasing`
      : 'no overlay marker present',
  );
}

// Gate 2 — the pin itself must be an exact semver, not a range/tag/local ref.
{
  const isExact = typeof sdkPin === 'string' && /^\d+\.\d+\.\d+$/.test(sdkPin);
  record(
    'sdk-pin-exact-semver',
    isExact,
    isExact ? `pin is ${String(sdkPin)}` : `package.json dependency must be an exact semver (found: ${String(sdkPin)})`,
  );
}

// Gate 3 — the installed package must be the same version as the pin. A pin
// bump whose node_modules never moved ships the OLD SDK silently.
{
  const installed = existsSync(installedPkgPath)
    ? (JSON.parse(readFileSync(installedPkgPath, 'utf8')) as { version?: string }).version
    : undefined;
  const matches = typeof sdkPin === 'string' && installed === sdkPin;
  record(
    'installed-matches-pin',
    matches,
    matches
      ? `installed ${String(installed)} matches pin`
      : `installed ${SDK_NAME} (${String(installed)}) does not match the pin (${String(sdkPin)}) — run \`bun install\``,
  );
}

// Gate 4 — the lockfile must resolve the exact pinned version. A pin bump
// whose lockfile never moved can serve a cached older resolution.
{
  const lockPath = join(root, 'bun.lock');
  const lockExists = existsSync(lockPath);
  const lock = lockExists ? readFileSync(lockPath, 'utf8') : '';
  const resolves = typeof sdkPin === 'string' && lock.includes(`${SDK_NAME}@${sdkPin}`);
  record(
    'lockfile-resolves-pin',
    resolves,
    resolves
      ? `bun.lock resolves ${SDK_NAME}@${String(sdkPin)}`
      : `bun.lock does not resolve ${SDK_NAME}@${String(sdkPin)} — the lockfile lagged the pin bump`,
  );
}

// Gates 5 & 6 — source import sweep. scripts/sdk-dev.ts is the sole
// sanctioned local-path holder (the dev tool itself); it is excluded because
// it deliberately reads the SDK checkout off-disk to build the overlay.
{
  const importRegex = /(?:from\s+|require\(|import\()\s*['"]([^'"]*goodvibes-sdk[^'"]*)['"]/g;
  const nonNpmOffenders: string[] = [];
  const deepPathOffenders: string[] = [];

  let allowedSpecifiers: Set<string> | undefined;
  if (existsSync(installedPkgPath)) {
    const exportsMap = (JSON.parse(readFileSync(installedPkgPath, 'utf8')) as { exports?: Record<string, unknown> }).exports ?? {};
    allowedSpecifiers = new Set(
      Object.keys(exportsMap).map((key) => (key === '.' ? SDK_NAME : `${SDK_NAME}/${key.replace(/^\.\//, '')}`)),
    );
  }

  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(rel);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        const text = readFileSync(join(root, rel), 'utf8');
        for (const m of text.matchAll(importRegex)) {
          const specifier = m[1];
          if (!specifier.startsWith(SDK_NAME)) {
            nonNpmOffenders.push(`${rel}: ${specifier}`);
            continue;
          }
          if (allowedSpecifiers && !allowedSpecifiers.has(specifier)) {
            deepPathOffenders.push(`${rel}: ${specifier}`);
          }
        }
      }
    }
  };
  walk('src');

  record(
    'npm-specifier-only-imports',
    nonNpmOffenders.length === 0,
    nonNpmOffenders.length === 0
      ? 'all goodvibes-sdk imports use the npm specifier'
      : `non-npm goodvibes-sdk imports found:\n${nonNpmOffenders.join('\n')}`,
  );

  record(
    'exports-map-only-imports',
    deepPathOffenders.length === 0,
    deepPathOffenders.length === 0
      ? (allowedSpecifiers ? 'all goodvibes-sdk imports resolve to a published exports-map subpath' : 'skipped (installed package.json unavailable)')
      : `imports bypass the SDK's published exports map (deep/internal paths):\n${deepPathOffenders.join('\n')}`,
  );
}

// ── Report ───────────────────────────────────────────────────────────────

console.log('='.repeat(78));
console.log('release-gate — goodvibes-webui SDK-pin integrity');
console.log('='.repeat(78));

let anyFailed = false;
results.forEach((r, i) => {
  const status = r.passed ? 'PASS' : 'FAIL';
  console.log(`  [${status}] ${i + 1}. ${r.name}`);
  console.log(`         ${r.detail.split('\n').join('\n         ')}`);
  if (!r.passed) anyFailed = true;
});

console.log();
console.log(`Result: ${results.filter((r) => r.passed).length}/${results.length} gates passed`);

if (anyFailed) {
  console.error('\nrelease-gate: FAILED — one or more SDK-pin gates did not pass.');
  process.exit(1);
} else {
  console.log('\nrelease-gate: PASSED — SDK pin, lockfile, install, and import surface all agree.');
  process.exit(0);
}
