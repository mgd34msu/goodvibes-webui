#!/usr/bin/env bun
/**
 * release:prepare, the one command that makes a version bump complete.
 *
 * Every file that is generated from the installed SDK, or that carries the
 * version or a pinned SHA, is rewritten here, at the bump, instead of being
 * policed by a red CI run on every push. A stale generated file is fixed by
 * regenerating it; it is not a regression.
 *
 * Usage:
 *   bun run release:prepare --patch | --minor | --major
 *   bun run release:prepare --version 1.14.0     bump to an exact version
 *   bun run release:prepare --no-bump            regenerate at the current version
 *                                                (what `npm version` runs, through
 *                                                the `version` script, after it
 *                                                has bumped package.json itself)
 *   --no-changelog  skip the CHANGELOG section scaffold
 *   --no-install    skip the relock (offline, or the lockfile is already current)
 *   --no-pins       skip the workflow pin rewrite (offline)
 *
 * Steps, in dependency order:
 *   1. package.json version (unless --no-bump)
 *   2. relock: `bun install`, so bun.lock and node_modules resolve the pinned
 *      SDK and toolchain versions from package.json
 *   3. the SDK-derived modules, each in a fresh process so it imports the SDK
 *      the relock just installed: src/lib/generated/config-schema.ts,
 *      src/lib/generated/config-ownership.ts, and the presentation tokens
 *      (src/lib/generated/presentation-tokens.ts,
 *      src/styles/generated/presentation-tokens.css)
 *   4. every `?v=` cache-bust value in index.html set to the version, and the
 *      README's WebUI, SDK and Bun version badges set to the version, the SDK
 *      pin and packageManager's Bun
 *   5. workflow pins: every `mgd34msu/goodvibes-sdk/.github/workflows/*.yml@<sha>`
 *      reference moves to the commit the pinned SDK version's tag points at,
 *      and every `@pellux/goodvibes-toolchain@<version>` moves to the
 *      devDependencies pin (the network lookup only happens when a workflow
 *      actually carries an SDK reference)
 *   6. a `## [X.Y.Z] - YYYY-MM-DD` CHANGELOG section scaffold above the newest
 *      section, when none exists for the version (unless --no-changelog)
 *
 * It never commits, tags or pushes. Review `git diff` afterwards and write the
 * release notes into the scaffolded section.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const SDK_REPO_URL = 'https://github.com/mgd34msu/goodvibes-sdk';
const SDK_WORKFLOW_REF = /mgd34msu\/goodvibes-sdk\/\.github\/workflows\/[\w.-]+\.ya?ml@[0-9a-f]{40}/;

/** The generators step 3 runs, in order. */
export const GENERATORS = [
  'scripts/generate-config-schema.ts',
  'scripts/generate-config-ownership.ts',
  'scripts/generate-presentation-tokens.ts',
] as const;

export type BumpKind = 'patch' | 'minor' | 'major';

/** The next semver for a bump kind. Pre-release suffixes are dropped. */
export function bumpVersion(current: string, kind: BumpKind): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(current);
  if (!match) throw new Error(`package.json version is not semver: ${current}`);
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** Rewrites only the top-level "version" field, leaving the rest of the file's bytes alone. */
export function setManifestVersionText(text: string, version: string): string {
  const next = text.replace(/^(\s*"version"\s*:\s*")[^"]*(")/m, `$1${version}$2`);
  if (next === text && !text.includes(`"version": "${version}"`)) {
    throw new Error('package.json has no top-level "version" field');
  }
  return next;
}

/**
 * index.html with every `?v=<value>` cache-bust query string set to `version`.
 * Throws when the document carries none, so a refactor that drops the query
 * strings is noticed at the bump rather than silently shipping stale icons.
 */
export function rewriteCacheBustText(html: string, version: string): string {
  const pattern = /\?v=[^"'&\s]+/g;
  if (!pattern.test(html)) {
    throw new Error('index.html has no ?v= cache-bust values; the icon links are expected to carry them');
  }
  return html.replace(pattern, `?v=${version}`);
}

/**
 * README text with the `WebUI`, `SDK` and `Bun` shields.io badges (alt text
 * and badge URL) set to the given versions. A badge that is absent stays absent.
 */
export function rewriteReadmeBadgesText(
  readme: string,
  versions: { readonly webui: string; readonly sdk: string; readonly bun: string | null },
): string {
  const set = (text: string, label: string, version: string): string =>
    text.replace(
      new RegExp(`!\\[${label} [^\\]]*\\]\\(https://img\\.shields\\.io/badge/${label}-[^-)]+-`, 'g'),
      `![${label} ${version}](https://img.shields.io/badge/${label}-${version}-`,
    );
  let next = set(readme, 'WebUI', versions.webui);
  next = set(next, 'SDK', versions.sdk);
  if (versions.bun !== null) next = set(next, 'Bun', versions.bun);
  return next;
}

/**
 * CHANGELOG text with a section for `version` inserted above the newest `## `
 * heading (this changelog keeps its newest release on top, under the intro).
 * Unchanged when a section for the version already exists.
 */
export function scaffoldChangelogText(changelog: string, version: string, date: string): string {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`^##\\s*\\[${escaped}\\]`, 'm').test(changelog)) return changelog;
  const section = `## [${version}] - ${date}\n\n### Changes\n\n- \n\n`;
  const first = changelog.search(/^## /m);
  if (first === -1) return `${changelog.trimEnd()}\n\n${section}`;
  return `${changelog.slice(0, first)}${section}${changelog.slice(first)}`;
}

/**
 * A workflow file with every SDK reusable-workflow reference pointed at
 * `sdkSha` (the commit the SDK's `v<sdkVersion>` tag points at, with its
 * trailing `# sdk <version> release` note kept in step), and every pinned
 * toolchain spec set to `toolchainVersion`.
 */
export function rewriteWorkflowPins(
  text: string,
  pins: { readonly sdkVersion: string; readonly sdkSha: string | null; readonly toolchainVersion: string },
): string {
  let next = text.replace(/(@pellux\/goodvibes-toolchain@)\d+\.\d+\.\d+/g, `$1${pins.toolchainVersion}`);
  if (pins.sdkSha !== null) {
    next = next.replace(
      /(mgd34msu\/goodvibes-sdk\/\.github\/workflows\/[\w.-]+\.ya?ml@)[0-9a-f]{40}( # sdk )\d+\.\d+\.\d+( release)?/g,
      `$1${pins.sdkSha}$2${pins.sdkVersion} release`,
    );
  }
  return next;
}

/** The commit a tag points at, from `git ls-remote` output (the peeled `^{}` line wins). */
export function peeledTagSha(lsRemoteOutput: string, tag: string): string | null {
  let direct: string | null = null;
  for (const line of lsRemoteOutput.split('\n')) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (!sha || !ref || !/^[0-9a-f]{40}$/.test(sha)) continue;
    if (ref === `refs/tags/${tag}^{}`) return sha;
    if (ref === `refs/tags/${tag}`) direct = sha;
  }
  return direct;
}

interface PrepareArgs {
  readonly bump: BumpKind | { readonly exact: string } | null;
  readonly changelog: boolean;
  readonly install: boolean;
  readonly pins: boolean;
}

export function parseArgs(argv: readonly string[]): PrepareArgs {
  const kinds = (['patch', 'minor', 'major'] as const).filter((kind) => argv.includes(`--${kind}`));
  const versionIdx = argv.indexOf('--version');
  const exact = versionIdx >= 0 ? argv[versionIdx + 1] : undefined;
  const noBump = argv.includes('--no-bump');
  const chosen = kinds.length + (versionIdx >= 0 ? 1 : 0) + (noBump ? 1 : 0);
  if (chosen !== 1 || (versionIdx >= 0 && (exact === undefined || !/^\d+\.\d+\.\d+$/.test(exact)))) {
    throw new Error(
      'Usage: bun run release:prepare (--patch | --minor | --major | --version X.Y.Z | --no-bump) [--no-changelog] [--no-install] [--no-pins]',
    );
  }
  return {
    bump: noBump ? null : exact !== undefined ? { exact } : (kinds[0] ?? 'patch'),
    changelog: !argv.includes('--no-changelog'),
    install: !argv.includes('--no-install'),
    pins: !argv.includes('--no-pins'),
  };
}

function run(label: string, command: string, args: readonly string[]): void {
  console.log(`[release:prepare] ${label}: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${label} failed (exit ${String(result.status ?? 'signal')})`);
}

function resolveSdkTagSha(sdkVersion: string): string {
  const tag = `v${sdkVersion}`;
  const result = spawnSync('git', ['ls-remote', SDK_REPO_URL, `refs/tags/${tag}`, `refs/tags/${tag}^{}`], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  const sha = result.status === 0 ? peeledTagSha(result.stdout, tag) : null;
  if (!sha) {
    throw new Error(`could not resolve ${SDK_REPO_URL} tag ${tag}; rerun with network, or pass --no-pins and update the SHAs by hand`);
  }
  return sha;
}

function rewriteFile(path: string, rewrite: (text: string) => string, label: string): void {
  const before = readFileSync(path, 'utf8');
  const after = rewrite(before);
  if (after !== before) {
    writeFileSync(path, after);
    console.log(`[release:prepare] ${label}`);
  }
}

function main(argv: readonly string[]): void {
  const args = parseArgs(argv);
  const pkgPath = join(ROOT, 'package.json');
  const pkgText = readFileSync(pkgPath, 'utf8');
  const current = (JSON.parse(pkgText) as { version: string }).version;

  let version = current;
  if (args.bump !== null) {
    version = typeof args.bump === 'string' ? bumpVersion(current, args.bump) : args.bump.exact;
    writeFileSync(pkgPath, setManifestVersionText(pkgText, version));
    console.log(`[release:prepare] package.json ${current} -> ${version}`);
  }

  if (args.install) run('relock', 'bun', ['install']);
  for (const generator of GENERATORS) run('regenerate', 'bun', ['run', generator]);

  rewriteFile(join(ROOT, 'index.html'), (html) => rewriteCacheBustText(html, version), `index.html: ?v=${version}`);
  {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      packageManager?: string;
      dependencies?: Record<string, string>;
    };
    const sdk = pkg.dependencies?.['@pellux/goodvibes-sdk'] ?? '';
    const bun = /^bun@(\d+\.\d+\.\d+)$/.exec(pkg.packageManager ?? '')?.[1] ?? null;
    if (/^\d+\.\d+\.\d+$/.test(sdk)) {
      rewriteFile(
        join(ROOT, 'README.md'),
        (readme) => rewriteReadmeBadgesText(readme, { webui: version, sdk, bun }),
        `README.md: badges WebUI ${version}, SDK ${sdk}${bun ? `, Bun ${bun}` : ''}`,
      );
    }
  }

  if (args.pins) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const sdkVersion = pkg.dependencies?.['@pellux/goodvibes-sdk'];
    const toolchainVersion = pkg.devDependencies?.['@pellux/goodvibes-toolchain'];
    if (!sdkVersion || !/^\d+\.\d+\.\d+$/.test(sdkVersion)) {
      throw new Error(`@pellux/goodvibes-sdk is not pinned to an exact version: ${String(sdkVersion)}`);
    }
    if (!toolchainVersion || !/^\d+\.\d+\.\d+$/.test(toolchainVersion)) {
      throw new Error(`@pellux/goodvibes-toolchain is not pinned to an exact version: ${String(toolchainVersion)}`);
    }
    const workflowsDir = join(ROOT, '.github', 'workflows');
    const workflows = readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f));
    const needsSha = workflows.some((name) => SDK_WORKFLOW_REF.test(readFileSync(join(workflowsDir, name), 'utf8')));
    const sdkSha = needsSha ? resolveSdkTagSha(sdkVersion) : null;
    for (const name of workflows) {
      rewriteFile(
        join(workflowsDir, name),
        (text) => rewriteWorkflowPins(text, { sdkVersion, sdkSha, toolchainVersion }),
        `.github/workflows/${name}: sdk ${sdkVersion}, toolchain ${toolchainVersion}`,
      );
    }
  }

  if (args.changelog) {
    const changelogPath = join(ROOT, 'CHANGELOG.md');
    const before = readFileSync(changelogPath, 'utf8');
    const after = scaffoldChangelogText(before, version, new Date().toISOString().slice(0, 10));
    if (after !== before) {
      writeFileSync(changelogPath, after);
      console.log(`[release:prepare] CHANGELOG.md: scaffolded ## [${version}]; write the notes before pushing.`);
    } else {
      console.log(`[release:prepare] CHANGELOG.md already has a ## [${version}] section.`);
    }
  }
  console.log('[release:prepare] done; review `git diff`.');
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`[release:prepare] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
