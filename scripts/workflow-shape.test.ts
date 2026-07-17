/**
 * Workflow-shape gate — local proof that .github/workflows/ci.yml is
 * well-formed, since CI itself can't be exercised without pushing.
 *
 * Follows goodvibes-sdk/test/workflow-shape.test.ts's approach (parse the
 * YAML, assert on job graph/hygiene) scaled to this repo's actual pipeline:
 * three independent jobs (test, lint, e2e) with no `needs` edges between
 * them, plus a fourth `auto-release` job that needs all three and is the
 * repo's entire zero-touch release surface (tag + GitHub release page; this
 * repo ships no other artifacts).
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CI_PATH = resolve(ROOT, '.github/workflows/ci.yml');

type Step = Record<string, unknown> & { uses?: string; with?: Record<string, unknown>; run?: string };
type Job = Record<string, unknown> & {
  'runs-on'?: string;
  'timeout-minutes'?: number;
  steps?: Step[];
};
interface Workflow {
  on?: unknown;
  env?: Record<string, string>;
  jobs?: Record<string, Job>;
}

function load(): Workflow {
  return Bun.YAML.parse(readFileSync(CI_PATH, 'utf8')) as Workflow;
}
function jobs(wf: Workflow): [string, Job][] {
  return Object.entries(wf.jobs ?? {});
}
function steps(job: Job): Step[] {
  return job.steps ?? [];
}

describe('ci.yml: shape and hygiene', () => {
  const wf = load();

  test('has exactly the four expected jobs, with no needs edges between the three validation jobs', () => {
    const names = jobs(wf).map(([n]) => n);
    expect(names.sort()).toEqual(['auto-release', 'e2e', 'lint', 'test']);
    for (const [name, job] of jobs(wf)) {
      if (name === 'auto-release') continue;
      expect(job.needs).toBeUndefined();
    }
  });

  test('the Bun version is single-sourced via the top-level env block', () => {
    expect(wf.env?.BUN_VERSION).toBeTruthy();
    // auto-release doesn't run any bun scripts (tag + gh release only), so it
    // carries no "Set up Bun" step and is exempt from this check.
    for (const [name, job] of jobs(wf)) {
      if (name === 'auto-release') continue;
      const setupBun = steps(job).find((s) => s.uses?.toString().startsWith('oven-sh/setup-bun@'));
      expect(setupBun, `${name} must have a "Set up Bun" step`).toBeTruthy();
      expect(setupBun!.with?.['bun-version'], `${name}'s bun-version must reference env.BUN_VERSION`).toBe(
        '${{ env.BUN_VERSION }}',
      );
    }
  });

  test('no job or step uses continue-on-error: true (per-job-green is the only green)', () => {
    for (const [, job] of jobs(wf)) {
      expect(job['continue-on-error']).not.toBe(true);
      for (const step of steps(job)) {
        expect(step['continue-on-error']).not.toBe(true);
      }
    }
  });

  test('every job declares a timeout cap', () => {
    for (const [name, job] of jobs(wf)) {
      expect(job['timeout-minutes'], `${name} needs timeout-minutes`).toBeGreaterThan(0);
    }
  });

  test('the test job still runs typecheck, tests, build, and the release gate', () => {
    const text = JSON.stringify(steps(wf.jobs!.test!));
    for (const cmd of ['bun run typecheck', 'bun run test', 'bun run build', 'bun run release:gate']) {
      expect(text).toContain(cmd);
    }
  });

  test('the e2e job stays blocking (no continue-on-error, real timeout) per the 2026-07-07 decision', () => {
    const e2e = wf.jobs!.e2e!;
    expect(e2e['continue-on-error']).not.toBe(true);
    expect(e2e['timeout-minutes']).toBeGreaterThan(0);
  });

  describe('auto-release: the repo\'s entire zero-touch release surface', () => {
    const autoRelease = () => wf.jobs!['auto-release']!;

    test('needs every other job in the file', () => {
      const otherJobNames = jobs(wf)
        .map(([name]) => name)
        .filter((name) => name !== 'auto-release');
      const needs = autoRelease().needs as string | string[] | undefined;
      const needsList = Array.isArray(needs) ? needs : needs ? [needs] : [];
      for (const name of otherJobNames) {
        expect(needsList, `auto-release must need "${name}"`).toContain(name);
      }
      expect(needsList).toHaveLength(otherJobNames.length);
    });

    test('only runs on a push to main (never on pull_request)', () => {
      expect(autoRelease().if).toBe("github.ref == 'refs/heads/main' && github.event_name == 'push'");
    });

    test('grants contents: write (to create the tag and the release)', () => {
      const permissions = autoRelease().permissions as Record<string, string> | undefined;
      expect(permissions?.contents).toBe('write');
    });

    test('checks whether the release tag already exists before creating one', () => {
      const text = JSON.stringify(steps(autoRelease()));
      expect(text).toContain('git ls-remote --tags origin');
      expect(text).toContain('refs/tags/v');
    });

    test('creates the GitHub release from the extracted changelog section', () => {
      const text = JSON.stringify(steps(autoRelease()));
      expect(text).toContain('CHANGELOG.md');
      expect(text).toContain('gh release create');
      expect(text).toContain('--verify-tag');
    });
  });
});
