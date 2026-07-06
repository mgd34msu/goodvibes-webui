/**
 * KnowledgeMap — the W8 fix: render the wire's pre-rendered svg instead of a
 * raw JSON dump, and contrast jobRunCount vs nodeCount so "jobs ran, 0 nodes"
 * reads as an honest activity state rather than a blank map.
 */
import { describe, expect, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { KnowledgeMap, isRenderableSvg, svgDataUrl } from './KnowledgeMap';

const SAMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="4"/></svg>';

function baseProps(overrides: Partial<React.ComponentProps<typeof KnowledgeMap>> = {}) {
  return {
    isPending: false,
    error: null,
    data: {},
    onRetry: () => {},
    hasFilter: false,
    onClearFilter: () => {},
    onViewJobs: () => {},
    jobRunCount: null,
    overallNodeCount: null,
    statusPending: false,
    ...overrides,
  };
}

describe('isRenderableSvg / svgDataUrl', () => {
  test('accepts a well-formed <svg>...</svg> document', () => {
    expect(isRenderableSvg(SAMPLE_SVG)).toBe(true);
  });

  test('rejects an empty string', () => {
    expect(isRenderableSvg('')).toBe(false);
    expect(isRenderableSvg('   ')).toBe(false);
  });

  test('rejects a non-svg / malformed value', () => {
    expect(isRenderableSvg('{"not":"svg"}')).toBe(false);
    expect(isRenderableSvg('<svg>unterminated')).toBe(false);
  });

  test('svgDataUrl produces a data: URL an <img> can consume without executing script', () => {
    const url = svgDataUrl(SAMPLE_SVG);
    expect(url.startsWith('data:image/svg+xml')).toBe(true);
    expect(url).toContain(encodeURIComponent('<svg'));
  });
});

describe('KnowledgeMap — loading / error', () => {
  test('shows a skeleton while the map query is pending', () => {
    const html = renderToStaticMarkup(<KnowledgeMap {...baseProps({ isPending: true })} />);
    expect(html).toContain('knowledge-skeleton-group');
  });

  test('shows a skeleton while the status query (jobRunCount source) is still pending, even if the map resolved', () => {
    const html = renderToStaticMarkup(
      <KnowledgeMap {...baseProps({ statusPending: true, data: { nodeCount: 3, edgeCount: 2, svg: SAMPLE_SVG } })} />,
    );
    expect(html).toContain('knowledge-skeleton-group');
  });

  test('shows an error state when the map query failed', () => {
    const html = renderToStaticMarkup(
      <KnowledgeMap {...baseProps({ error: new Error('boom') })} />,
    );
    expect(html).toContain('Map failed to load');
  });
});

describe('KnowledgeMap — the W8 honesty states', () => {
  test('true empty (0 jobs, 0 nodes) reads "No knowledge indexed yet", never a raw dump', () => {
    const html = renderToStaticMarkup(
      <KnowledgeMap {...baseProps({ jobRunCount: 0, overallNodeCount: 0, data: { nodeCount: 0, edgeCount: 0 } })} />,
    );
    expect(html).toContain('No knowledge indexed yet');
    expect(html).not.toContain('<pre>');
  });

  test('the "766 jobs ran / 0 nodes" gap reads as an honest activity state, not a blank map', () => {
    const html = renderToStaticMarkup(
      <KnowledgeMap {...baseProps({ jobRunCount: 766, overallNodeCount: 0, data: { nodeCount: 0, edgeCount: 0 } })} />,
    );
    expect(html).toContain('766 indexing jobs ran, 0 nodes');
    expect(html).toContain('View jobs');
  });

  test('singular phrasing for exactly 1 job run', () => {
    const html = renderToStaticMarkup(
      <KnowledgeMap {...baseProps({ jobRunCount: 1, overallNodeCount: 0, data: { nodeCount: 0, edgeCount: 0 } })} />,
    );
    expect(html).toContain('1 indexing job ran, 0 nodes');
  });

  test('an active filter matching nothing reads "No nodes match this filter", distinct from true-empty', () => {
    const html = renderToStaticMarkup(
      <KnowledgeMap {...baseProps({
        jobRunCount: 12,
        overallNodeCount: 40,
        hasFilter: true,
        data: { nodeCount: 0, edgeCount: 0, totalNodeCount: 40 },
      })} />,
    );
    expect(html).toContain('No nodes match this filter');
    expect(html).not.toContain('No knowledge indexed yet');
  });

  test('an unfiltered read that comes back empty despite a nonzero base count is named honestly', () => {
    const html = renderToStaticMarkup(
      <KnowledgeMap {...baseProps({
        jobRunCount: 12,
        overallNodeCount: 40,
        hasFilter: false,
        data: { nodeCount: 0, edgeCount: 0, totalNodeCount: 40 },
      })} />,
    );
    expect(html).toContain('Map returned 0 nodes');
  });

  test('populated: renders the svg via an <img> with an honest counts header, not a <pre> dump', () => {
    const html = renderToStaticMarkup(
      <KnowledgeMap {...baseProps({
        jobRunCount: 12,
        overallNodeCount: 5,
        data: { nodeCount: 5, edgeCount: 4, totalNodeCount: 5, totalEdgeCount: 4, svg: SAMPLE_SVG },
      })} />,
    );
    expect(html).toContain('<img');
    expect(html).toContain('5 nodes');
    expect(html).toContain('4 edges');
    expect(html).not.toContain('<pre>');
  });

  test('populated with a subset shown vs. the total surfaces the "of N total" contrast', () => {
    const html = renderToStaticMarkup(
      <KnowledgeMap {...baseProps({
        jobRunCount: 12,
        overallNodeCount: 40,
        data: { nodeCount: 5, edgeCount: 4, totalNodeCount: 40, totalEdgeCount: 30, svg: SAMPLE_SVG },
      })} />,
    );
    expect(html).toContain('of 40 / 30 total');
  });

  test('nodeCount > 0 but a missing svg reads "Map unavailable", not a crash or a raw dump', () => {
    const html = renderToStaticMarkup(
      <KnowledgeMap {...baseProps({
        jobRunCount: 12,
        overallNodeCount: 5,
        data: { nodeCount: 5, edgeCount: 4 },
      })} />,
    );
    expect(html).toContain('Map unavailable');
    expect(html).not.toContain('<pre>');
  });

  test('a malformed svg string also reads "Map unavailable" rather than rendering broken markup', () => {
    const html = renderToStaticMarkup(
      <KnowledgeMap {...baseProps({
        jobRunCount: 12,
        overallNodeCount: 5,
        data: { nodeCount: 5, edgeCount: 4, svg: 'not an svg document' },
      })} />,
    );
    expect(html).toContain('Map unavailable');
  });
});

describe('KnowledgeMap — "view raw" is demoted, never the primary surface', () => {
  function render(props: Partial<React.ComponentProps<typeof KnowledgeMap>>) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    flushSync(() => {
      root.render(<KnowledgeMap {...baseProps(props)} />);
    });
    return {
      el: container,
      unmount: () => {
        flushSync(() => root.unmount());
        container.remove();
      },
    };
  }

  test('the raw JSON is hidden by default and only appears after toggling "View raw"', () => {
    const { el, unmount } = render({
      jobRunCount: 12,
      overallNodeCount: 5,
      data: { nodeCount: 5, edgeCount: 4, svg: SAMPLE_SVG },
    });
    expect(el.textContent).not.toContain('"nodeCount"');
    const toggle = [...el.querySelectorAll('button')].find((b) => b.textContent === 'View raw');
    expect(toggle).toBeTruthy();
    flushSync(() => { toggle?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    expect(el.textContent).toContain('"nodeCount"');
    unmount();
  });

  test('an svg that passes the well-formedness gate but fails to decode in the browser flips to "Map unavailable" (F7c)', () => {
    const { el, unmount } = render({
      jobRunCount: 12,
      overallNodeCount: 5,
      data: { nodeCount: 5, edgeCount: 4, svg: SAMPLE_SVG },
    });
    const img = el.querySelector('.knowledge-map-render__canvas img') as HTMLImageElement | null;
    expect(img).toBeTruthy();
    // The browser could not decode the data: URL — React's onError fires.
    flushSync(() => { img?.dispatchEvent(new window.Event('error')); });
    expect(el.textContent).toContain('Map unavailable');
    expect(el.querySelector('.knowledge-map-render__canvas img')).toBeNull();
    unmount();
  });
});
