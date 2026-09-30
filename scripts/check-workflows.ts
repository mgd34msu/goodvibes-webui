#!/usr/bin/env bun
/**
 * check-workflows.ts, structural check of the GitHub Actions workflows under
 * .github/workflows/, run by the per-push typecheck job.
 *
 *   - every workflow file parses as YAML;
 *   - every workflow declares `name`, `on`, and a non-empty `jobs` map;
 *   - every job declares `runs-on` and steps, or `uses` (a reusable call);
 *   - every `needs` names a job that exists in the same workflow;
 *   - no job carries `continue-on-error: true` (a run that reports success
 *     over a failing job is a false green);
 *   - ci.yml's `auto-release` job needs every other job in ci.yml, so no
 *     version is tagged and released unless everything the push ran is green.
 *
 * It reads structure, never wording. Exit 0 = no problems.
 *
 * The first CLI argument overrides the directory to check; the test points it at
 * fixture workflows to prove each rule reports a broken workflow.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function needsOf(job: Json): string[] {
  const needs = job.needs;
  if (typeof needs === 'string') return [needs];
  if (Array.isArray(needs)) return needs.filter((n): n is string => typeof n === 'string');
  return [];
}

/** Every structural problem in the workflow files under `dir`, as `file: message` lines. */
export function checkWorkflows(dir: string): string[] {
  const problems: string[] = [];
  const fail = (file: string, message: string): void => {
    problems.push(`${file}: ${message}`);
  };
  const files = readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  if (files.length === 0) return [`${dir}: no workflow files`];

  for (const file of files) {
    let doc: unknown;
    try {
      doc = Bun.YAML.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (err) {
      fail(file, `does not parse as YAML: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (!isObject(doc)) {
      fail(file, 'top-level document is not a mapping');
      continue;
    }
    if (typeof doc.name !== 'string' || doc.name.trim().length === 0) fail(file, 'missing a non-empty `name`');
    // Some YAML 1.1 parsers fold `on:` to the boolean key true; accept both.
    if (!('on' in doc) && !('true' in doc)) fail(file, 'missing an `on` trigger block');
    const jobs = doc.jobs;
    if (!isObject(jobs) || Object.keys(jobs).length === 0) {
      fail(file, 'missing a non-empty `jobs` map');
      continue;
    }

    for (const [jobName, job] of Object.entries(jobs)) {
      if (!isObject(job)) {
        fail(file, `job "${jobName}" is not a mapping`);
        continue;
      }
      if (typeof job.uses !== 'string') {
        if (!('runs-on' in job)) fail(file, `job "${jobName}" is missing runs-on`);
        if (!Array.isArray(job.steps) || job.steps.length === 0) fail(file, `job "${jobName}" has no steps`);
      }
      for (const need of needsOf(job)) {
        if (!(need in jobs)) fail(file, `job "${jobName}" needs "${need}", which is not a job in this workflow`);
      }
      if (job['continue-on-error'] === true) {
        fail(file, `job "${jobName}" declares continue-on-error: true (it hides a failing job behind a green run)`);
      }
    }

    if (file === 'ci.yml') {
      const release = jobs['auto-release'];
      if (!isObject(release)) {
        fail(file, 'has no "auto-release" job');
      } else {
        const needs = new Set(needsOf(release));
        for (const other of Object.keys(jobs)) {
          if (other !== 'auto-release' && !needs.has(other)) {
            fail(file, `"auto-release" does not need "${other}", so a release could be cut without it`);
          }
        }
      }
    }
  }
  return problems;
}

if (import.meta.main) {
  const dir = process.argv[2] ? resolve(process.argv[2]) : join(import.meta.dir, '..', '.github', 'workflows');
  const problems = checkWorkflows(dir);
  if (problems.length > 0) {
    console.error(`check-workflows: ${String(problems.length)} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('check-workflows: OK');
}
