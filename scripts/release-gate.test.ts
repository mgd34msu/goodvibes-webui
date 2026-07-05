/**
 * release-gate.test.ts — exercises scripts/release-gate.ts against isolated
 * fixture directories (never the real repo's node_modules/package.json), so
 * each gate's pass/fail boundary is verified deterministically and quickly.
 *
 * Each fixture is a throwaway temp directory shaped like a minimal webui
 * checkout (package.json, bun.lock, node_modules/@pellux/goodvibes-sdk,
 * src/). The gate script resolves everything off process.cwd(), so running
 * it with `cwd: fixtureDir` exercises the real script logic end-to-end
 * without touching this repo's actual install state.
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT_PATH = resolve(import.meta.dir, 'release-gate.ts');
const SDK_NAME = '@pellux/goodvibes-sdk';

const EXPORTS_MAP = {
  '.': { types: './dist/index.d.ts', import: './dist/index.js' },
  './package.json': './package.json',
  './auth': { types: './dist/auth.d.ts', import: './dist/auth.js' },
  './browser/knowledge': { types: './dist/browser-knowledge.d.ts', import: './dist/browser-knowledge.js' },
  './contracts': { types: './dist/contracts.d.ts', import: './dist/contracts.js' },
};

interface FixtureOptions {
  pin?: string;
  installedVersion?: string;
  lockResolvesPin?: boolean;
  overlayActive?: boolean;
  srcFiles?: Record<string, string>;
}

const fixtureDirs: string[] = [];

function buildFixture(opts: FixtureOptions = {}): string {
  const {
    pin = '0.33.30',
    installedVersion = pin,
    lockResolvesPin = true,
    overlayActive = false,
    srcFiles = { 'app.ts': "import { createClient } from '@pellux/goodvibes-sdk';\nexport { createClient };\n" },
  } = opts;

  const dir = mkdtempSync(join(tmpdir(), 'webui-release-gate-'));
  fixtureDirs.push(dir);

  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'fixture',
    dependencies: { [SDK_NAME]: pin },
  }, null, 2));

  writeFileSync(
    join(dir, 'bun.lock'),
    lockResolvesPin ? `"${SDK_NAME}@${pin}": {}\n` : `"${SDK_NAME}@0.0.0-stale": {}\n`,
  );

  const pkgDir = join(dir, 'node_modules', '@pellux', 'goodvibes-sdk');
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name: SDK_NAME,
    version: installedVersion,
    exports: EXPORTS_MAP,
  }, null, 2));

  if (overlayActive) {
    writeFileSync(join(pkgDir, '.local-sdk-overlay.json'), JSON.stringify({
      sourcePath: '/fixture/goodvibes-sdk',
      sdkGit: 'main@fixture (clean)',
      overlaidAt: new Date().toISOString(),
    }));
  }

  const srcDir = join(dir, 'src');
  mkdirSync(srcDir, { recursive: true });
  for (const [relPath, contents] of Object.entries(srcFiles)) {
    const filePath = join(srcDir, relPath);
    mkdirSync(resolve(filePath, '..'), { recursive: true });
    writeFileSync(filePath, contents);
  }

  return dir;
}

function runGate(cwd: string): { exitCode: number; stdout: string } {
  const result = Bun.spawnSync(['bun', SCRIPT_PATH], { cwd, stdout: 'pipe', stderr: 'pipe' });
  return { exitCode: result.exitCode, stdout: result.stdout.toString() + result.stderr.toString() };
}

afterEach(() => {
  while (fixtureDirs.length > 0) {
    const dir = fixtureDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('release-gate', () => {
  test('passes all 6 gates on a healthy fixture', () => {
    const dir = buildFixture();
    const { exitCode, stdout } = runGate(dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('6/6 gates passed');
  });

  test('fails when the local SDK overlay marker is present', () => {
    const dir = buildFixture({ overlayActive: true });
    const { exitCode, stdout } = runGate(dir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('[FAIL] 1. local-sdk-overlay-absent');
  });

  test('fails when the pin is not an exact semver', () => {
    const dir = buildFixture({ pin: '^0.33.30', installedVersion: '0.33.30' });
    const { exitCode, stdout } = runGate(dir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('[FAIL] 2. sdk-pin-exact-semver');
  });

  test('fails when the installed package does not match the pin', () => {
    const dir = buildFixture({ pin: '0.38.0', installedVersion: '0.33.30' });
    const { exitCode, stdout } = runGate(dir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('[FAIL] 3. installed-matches-pin');
  });

  test('fails when the lockfile does not resolve the pin', () => {
    const dir = buildFixture({ lockResolvesPin: false });
    const { exitCode, stdout } = runGate(dir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('[FAIL] 4. lockfile-resolves-pin');
  });

  test('fails on a non-npm-specifier import of the SDK', () => {
    const dir = buildFixture({
      srcFiles: {
        'offender.ts': "import { x } from '../../../goodvibes-sdk/packages/sdk/dist/browser';\nexport { x };\n",
      },
    });
    const { exitCode, stdout } = runGate(dir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('[FAIL] 5. npm-specifier-only-imports');
  });

  test('fails on a deep import that bypasses the published exports map', () => {
    const dir = buildFixture({
      srcFiles: {
        'offender.ts': "import { x } from '@pellux/goodvibes-sdk/dist/browser-knowledge.js';\nexport { x };\n",
      },
    });
    const { exitCode, stdout } = runGate(dir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('[FAIL] 6. exports-map-only-imports');
  });

  test('accepts every subpath actually used by the webui (auth, browser/knowledge, contracts)', () => {
    const dir = buildFixture({
      srcFiles: {
        'app.ts': [
          "import { a } from '@pellux/goodvibes-sdk/auth';",
          "import { b } from '@pellux/goodvibes-sdk/browser/knowledge';",
          "import { c } from '@pellux/goodvibes-sdk/contracts';",
          'export { a, b, c };',
          '',
        ].join('\n'),
      },
    });
    const { exitCode, stdout } = runGate(dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('6/6 gates passed');
  });
});
