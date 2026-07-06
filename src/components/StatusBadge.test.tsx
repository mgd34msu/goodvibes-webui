import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  test('maps healthy status to ok tone', () => {
    const html = renderToStaticMarkup(<StatusBadge value="healthy" />);
    expect(html).toContain('badge ok');
    expect(html).toContain('healthy');
  });

  test('maps pending status to warning tone', () => {
    const html = renderToStaticMarkup(<StatusBadge value="pending approval" />);
    expect(html).toContain('badge warning');
  });

  test('maps failures to bad tone', () => {
    const html = renderToStaticMarkup(<StatusBadge value="task failed" />);
    expect(html).toContain('badge bad');
  });

  // Provider auth-freshness vocabulary (src/lib/provider-status.ts, W5-W3).
  test('maps expired to bad tone — dead credentials are a fault', () => {
    const html = renderToStaticMarkup(<StatusBadge value="expired" />);
    expect(html).toContain('badge bad');
    expect(html).toContain('expired');
  });

  test('maps expiring to warning tone — still working, needs attention', () => {
    const html = renderToStaticMarkup(<StatusBadge value="expiring" />);
    expect(html).toContain('badge warning');
    expect(html).toContain('expiring');
  });

  test('maps unconfigured to neutral tone — not set up is not a fault', () => {
    const html = renderToStaticMarkup(<StatusBadge value="unconfigured" />);
    expect(html).toContain('badge neutral');
  });

  test('maps "status unavailable" to neutral tone — absent health is not a fault', () => {
    const html = renderToStaticMarkup(<StatusBadge value="status unavailable" />);
    expect(html).toContain('badge neutral');
  });
});
