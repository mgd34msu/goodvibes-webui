/**
 * KnowledgeView — the W8 honesty fix: the Knowledge Map panel used to dump
 * DataBlock's raw <pre>{JSON}</pre> branch regardless of the daemon's
 * "766 jobs ran / 0 nodes" activity signal. This covers that the map now
 * renders through KnowledgeMap (an svg <img>, or an honest named empty
 * state) and never falls back to the raw-JSON-as-primary anti-pattern.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PeekProvider } from '../components/peek/PeekPanel';

const SAMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="4"/></svg>';

let statusData: unknown = { ready: true, storagePath: '/tmp', sourceCount: 0, nodeCount: 0, edgeCount: 0, issueCount: 0, extractionCount: 0, jobRunCount: 0, usageCount: 0, candidateCount: 0, reportCount: 0, scheduleCount: 0 };
let mapData: unknown = { ok: true, title: 'Map', generatedAt: 1, width: 100, height: 100, nodeCount: 0, edgeCount: 0, nodes: [], edges: [], svg: '' };
let invokeImpl: (method: string, input?: unknown) => Promise<unknown> = (method) => {
  if (method === 'knowledge.sources.list') return Promise.resolve({ sources: [] });
  if (method === 'knowledge.nodes.list') return Promise.resolve({ nodes: [] });
  if (method === 'knowledge.issues.list') return Promise.resolve({ issues: [] });
  if (method === 'knowledge.projections.list') return Promise.resolve({ targets: [] });
  if (method === 'knowledge.refinement.tasks.list') return Promise.resolve({ tasks: [] });
  if (method === 'knowledge.jobs.list') return Promise.resolve({ jobs: [] });
  if (method === 'knowledge.job-runs.list') return Promise.resolve({ runs: [] });
  return Promise.resolve({});
};

mock.module('../lib/goodvibes', () => ({
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: (method: string, input?: unknown) => invokeImpl(method, input),
  sdk: {
    knowledge: {
      status: () => Promise.resolve(statusData),
      map: () => Promise.resolve(mapData),
      ask: () => Promise.resolve({}),
      search: () => Promise.resolve({}),
    },
  },
}));

const { KnowledgeView } = await import('./KnowledgeView');

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(PeekProvider, null, React.createElement(KnowledgeView)),
      ),
    );
  });
  return {
    el: container,
    unmount: () => {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
    flushSync(() => {});
  }
}

afterEach(() => {
  statusData = { ready: true, storagePath: '/tmp', sourceCount: 0, nodeCount: 0, edgeCount: 0, issueCount: 0, extractionCount: 0, jobRunCount: 0, usageCount: 0, candidateCount: 0, reportCount: 0, scheduleCount: 0 };
  mapData = { ok: true, title: 'Map', generatedAt: 1, width: 100, height: 100, nodeCount: 0, edgeCount: 0, nodes: [], edges: [], svg: '' };
  invokeImpl = (method) => {
    if (method === 'knowledge.sources.list') return Promise.resolve({ sources: [] });
    if (method === 'knowledge.nodes.list') return Promise.resolve({ nodes: [] });
    if (method === 'knowledge.issues.list') return Promise.resolve({ issues: [] });
    if (method === 'knowledge.projections.list') return Promise.resolve({ targets: [] });
    if (method === 'knowledge.refinement.tasks.list') return Promise.resolve({ tasks: [] });
    if (method === 'knowledge.jobs.list') return Promise.resolve({ jobs: [] });
    if (method === 'knowledge.job-runs.list') return Promise.resolve({ runs: [] });
    return Promise.resolve({});
  };
});

describe('KnowledgeView — the Knowledge Map panel never dumps raw JSON', () => {
  test('a genuinely empty base (0 jobs, 0 nodes) says "No knowledge indexed yet", not a <pre> dump', async () => {
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('No knowledge indexed yet'));
    // The map panel's live region must never fall back to a raw <pre> dump.
    const mapPanel = el.querySelector('[aria-live="polite"][aria-atomic="true"]');
    expect(mapPanel?.querySelector('pre')).toBeFalsy();
    unmount();
  });

  test('the "jobs ran, 0 nodes" gap reads as an honest activity state in BOTH the Map and Nodes panels', async () => {
    statusData = { ...(statusData as Record<string, unknown>), jobRunCount: 766, nodeCount: 0 };
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').match(/766 indexing jobs ran, 0 nodes/g)?.length === 2);
    const matches = (el.textContent ?? '').match(/766 indexing jobs ran, 0 nodes/g);
    expect(matches).toHaveLength(2);
    unmount();
  });

  test('a populated map renders the svg via <img>, not a raw JSON <pre>', async () => {
    statusData = { ...(statusData as Record<string, unknown>), jobRunCount: 5, nodeCount: 3 };
    mapData = { ok: true, title: 'Map', generatedAt: 1, width: 100, height: 100, nodeCount: 3, edgeCount: 2, nodes: [], edges: [], svg: SAMPLE_SVG };
    const { el, unmount } = render();
    await waitFor(() => Boolean(el.querySelector('.knowledge-map-render img')));
    const mapPanel = el.querySelector('.knowledge-map-render');
    expect(mapPanel?.querySelector('img')).toBeTruthy();
    // The raw JSON is demoted behind "View raw" — not present in the map panel by default
    // (the separate Knowledge Status diagnostic block below is untouched by this brief).
    expect(mapPanel?.querySelector('pre')).toBeFalsy();
    unmount();
  });

  test('"View jobs" opens the peek with job-run activity detail', async () => {
    statusData = { ...(statusData as Record<string, unknown>), jobRunCount: 4, nodeCount: 0 };
    invokeImpl = (method) => {
      if (method === 'knowledge.jobs.list') return Promise.resolve({ jobs: [{ id: 'reindex', kind: 'reindex', title: 'Reindex sources', description: '', defaultMode: 'background', metadata: {} }] });
      if (method === 'knowledge.job-runs.list') return Promise.resolve({ runs: [{ id: 'run-1', jobId: 'reindex', status: 'failed', mode: 'background', requestedAt: 1, error: 'no candidates extracted', result: {}, metadata: {}, createdAt: 1, updatedAt: 1 }] });
      return Promise.resolve({ sources: [], nodes: [], issues: [], targets: [], tasks: [] });
    };
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('4 indexing jobs ran'));
    const viewJobsButton = [...el.querySelectorAll('button')].find((b) => b.textContent === 'View jobs');
    expect(viewJobsButton).toBeTruthy();
    flushSync(() => { viewJobsButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    await waitFor(() => (el.textContent ?? '').includes('Reindex sources'));
    expect(el.textContent).toContain('no candidates extracted');
    unmount();
  });
});
