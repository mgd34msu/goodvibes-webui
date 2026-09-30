/**
 * release-prepare.test.ts: the rewrites a version bump applies. Each one is a
 * pure text transform, so the tests hand it a document and read the result.
 */
import { describe, expect, test } from 'bun:test';
import {
  bumpVersion,
  parseArgs,
  peeledTagSha,
  rewriteCacheBustText,
  rewriteReadmeBadgesText,
  rewriteWorkflowPins,
  scaffoldChangelogText,
  setManifestVersionText,
} from './release-prepare';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

describe('version', () => {
  test('bump kinds reset the lower fields', () => {
    expect(bumpVersion('1.13.20', 'patch')).toBe('1.13.21');
    expect(bumpVersion('1.13.20', 'minor')).toBe('1.14.0');
    expect(bumpVersion('1.13.20', 'major')).toBe('2.0.0');
    expect(() => bumpVersion('next', 'patch')).toThrow();
  });

  test('only the top-level version field changes; dependency versions and formatting stay', () => {
    const text = '{\n  "name": "x",\n  "version": "1.0.0",\n  "dependencies": { "y": "1.0.0" }\n}\n';
    expect(setManifestVersionText(text, '1.0.1')).toBe(
      '{\n  "name": "x",\n  "version": "1.0.1",\n  "dependencies": { "y": "1.0.0" }\n}\n',
    );
    expect(() => setManifestVersionText('{ "name": "x" }', '1.0.1')).toThrow();
  });

  test('exactly one bump mode is required', () => {
    expect(parseArgs(['--minor']).bump).toBe('minor');
    expect(parseArgs(['--version', '2.0.0']).bump).toEqual({ exact: '2.0.0' });
    expect(parseArgs(['--no-bump', '--no-changelog']).changelog).toBe(false);
    expect(() => parseArgs([])).toThrow();
    expect(() => parseArgs(['--patch', '--minor'])).toThrow();
    expect(() => parseArgs(['--version', 'latest'])).toThrow();
  });
});

describe('index.html cache-bust values', () => {
  test('every ?v= value becomes the version, whatever it was', () => {
    const html = [
      '<link rel="icon" href="/favicon.ico?v=1.12.1" />',
      '<link rel="apple-touch-icon" href="/icons/a.png?v=1.13.20" /><link href="/b.png?v=old">',
    ].join('\n');
    const out = rewriteCacheBustText(html, '1.14.0');
    expect(out.match(/\?v=[^"'&\s>]+/g)).toEqual(['?v=1.14.0', '?v=1.14.0', '?v=1.14.0']);
    expect(out.replace(/\?v=1\.14\.0/g, '')).toBe(html.replace(/\?v=[^"'&\s]+/g, ''));
  });

  test('a document with no cache-bust values is refused', () => {
    expect(() => rewriteCacheBustText('<link rel="icon" href="/favicon.ico" />', '1.0.0')).toThrow();
  });
});

describe('README badges', () => {
  const readme = [
    '[![CI](https://github.com/x/y/actions/workflows/ci.yml/badge.svg)](https://github.com/x/y)',
    '![WebUI 1.13.14](https://img.shields.io/badge/WebUI-1.13.14-00d7ff)',
    '![SDK 2.0.19](https://img.shields.io/badge/SDK-2.0.19-8b5cf6)',
    '![Bun 1.3.14](https://img.shields.io/badge/Bun-1.3.14-f7a8ff)',
  ].join('\n');

  test('the WebUI, SDK and Bun badges carry the given versions; colors and other badges stay', () => {
    const out = rewriteReadmeBadgesText(readme, { webui: '1.14.0', sdk: '2.1.0', bun: '1.3.15' });
    expect(out.split('\n')).toEqual([
      '[![CI](https://github.com/x/y/actions/workflows/ci.yml/badge.svg)](https://github.com/x/y)',
      '![WebUI 1.14.0](https://img.shields.io/badge/WebUI-1.14.0-00d7ff)',
      '![SDK 2.1.0](https://img.shields.io/badge/SDK-2.1.0-8b5cf6)',
      '![Bun 1.3.15](https://img.shields.io/badge/Bun-1.3.15-f7a8ff)',
    ]);
  });

  test('without a Bun version the Bun badge is left as it was', () => {
    const out = rewriteReadmeBadgesText(readme, { webui: '1.14.0', sdk: '2.1.0', bun: null });
    expect(out).toContain('![Bun 1.3.14](https://img.shields.io/badge/Bun-1.3.14-f7a8ff)');
  });
});

describe('changelog scaffold', () => {
  const changelog = '# Changelog\n\nIntro.\n\n## [1.0.0] - 2026-01-01\n\n### Changes\n\n- First.\n';

  test('a new section lands above the newest release, under the intro', () => {
    const out = scaffoldChangelogText(changelog, '1.0.1', '2026-02-02');
    expect(out).toBe(
      '# Changelog\n\nIntro.\n\n## [1.0.1] - 2026-02-02\n\n### Changes\n\n- \n\n## [1.0.0] - 2026-01-01\n\n### Changes\n\n- First.\n',
    );
  });

  test('an existing section for the version is left alone', () => {
    expect(scaffoldChangelogText(changelog, '1.0.0', '2026-02-02')).toBe(changelog);
  });
});

describe('workflow pins', () => {
  const workflow = [
    `    uses: mgd34msu/goodvibes-sdk/.github/workflows/setup.yml@${SHA_A} # sdk 2.0.0 release`,
    '    run: bunx @pellux/goodvibes-toolchain@2.0.0 sdk-pin-gate',
    `    uses: actions/checkout@${SHA_A} # v5`,
  ].join('\n');

  test('SDK workflow refs and toolchain specs move; unrelated action pins do not', () => {
    const out = rewriteWorkflowPins(workflow, { sdkVersion: '2.1.0', sdkSha: SHA_B, toolchainVersion: '2.1.0' });
    expect(out.split('\n')).toEqual([
      `    uses: mgd34msu/goodvibes-sdk/.github/workflows/setup.yml@${SHA_B} # sdk 2.1.0 release`,
      '    run: bunx @pellux/goodvibes-toolchain@2.1.0 sdk-pin-gate',
      `    uses: actions/checkout@${SHA_A} # v5`,
    ]);
  });

  test('with no SHA resolved, only the toolchain spec moves', () => {
    const out = rewriteWorkflowPins(workflow, { sdkVersion: '2.1.0', sdkSha: null, toolchainVersion: '2.1.0' });
    expect(out).toContain(`setup.yml@${SHA_A} # sdk 2.0.0 release`);
    expect(out).toContain('goodvibes-toolchain@2.1.0');
  });

  test('the peeled tag line wins over the tag object', () => {
    const output = `${SHA_A}\trefs/tags/v2.1.0\n${SHA_B}\trefs/tags/v2.1.0^{}\n`;
    expect(peeledTagSha(output, 'v2.1.0')).toBe(SHA_B);
    expect(peeledTagSha(`${SHA_A}\trefs/tags/v2.1.0\n`, 'v2.1.0')).toBe(SHA_A);
    expect(peeledTagSha('', 'v2.1.0')).toBeNull();
  });
});
