/**
 * check-workflows.test.ts: each rule reports a workflow that actually breaks
 * it, and a well-formed pair of workflows passes.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkWorkflows } from './check-workflows';
import { installTestCleanup, makeProjectTempDir } from './helpers/project-temp';

installTestCleanup(afterAll);

const GOOD_CI = `name: CI
on:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: bun run test
  release-gates:
    uses: ./.github/workflows/release-gates.yml
  auto-release:
    runs-on: ubuntu-latest
    needs: [test, release-gates]
    steps:
      - run: echo tag
`;

function withWorkflows(files: Record<string, string>): string {
  const dir = makeProjectTempDir('webui-check-workflows-');
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

function problemsFor(files: Record<string, string>): string[] {
  const dir = withWorkflows(files);
  try {
    return checkWorkflows(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('check-workflows', () => {
  test('a well-formed ci.yml passes', () => {
    expect(problemsFor({ 'ci.yml': GOOD_CI })).toEqual([]);
  });

  test('YAML that does not parse is reported', () => {
    expect(problemsFor({ 'ci.yml': 'name: CI\njobs: [unclosed' }).length).toBeGreaterThan(0);
  });

  test('a job-level continue-on-error is reported', () => {
    const text = GOOD_CI.replace('  test:\n    runs-on: ubuntu-latest\n', '  test:\n    runs-on: ubuntu-latest\n    continue-on-error: true\n');
    expect(problemsFor({ 'ci.yml': text }).join('\n')).toContain('test');
  });

  test('an auto-release that skips a job is reported', () => {
    const text = GOOD_CI.replace('needs: [test, release-gates]', 'needs: [release-gates]');
    expect(problemsFor({ 'ci.yml': text }).join('\n')).toContain('auto-release');
  });

  test('a needs edge to a job that does not exist is reported', () => {
    const text = GOOD_CI.replace('needs: [test, release-gates]', 'needs: [test, release-gates, e2e]');
    expect(problemsFor({ 'ci.yml': text }).join('\n')).toContain('e2e');
  });

  test('a job with neither steps nor uses is reported', () => {
    const text = GOOD_CI.replace('    steps:\n      - run: bun run test\n', '');
    expect(problemsFor({ 'ci.yml': text }).join('\n')).toContain('test');
  });

  test('the repo\'s own workflows pass', () => {
    expect(checkWorkflows(join(import.meta.dir, '..', '.github', 'workflows'))).toEqual([]);
  });
});
