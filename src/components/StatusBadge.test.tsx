import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  test('maps healthy status to the ok dot', () => {
    const html = renderToStaticMarkup(<StatusBadge value="healthy" />);
    expect(html).toContain('data-tone="ok"');
    expect(html).toContain('gv-dot--ok');
    expect(html).toContain('healthy');
  });

  test('maps pending status to the warn dot', () => {
    const html = renderToStaticMarkup(<StatusBadge value="pending approval" />);
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain('gv-dot--warn');
  });

  test('maps failures to the bad dot', () => {
    const html = renderToStaticMarkup(<StatusBadge value="task failed" />);
    expect(html).toContain('data-tone="bad"');
    expect(html).toContain('gv-dot--bad');
  });

  // Provider auth-freshness vocabulary (src/lib/provider-status.ts).
  test('maps expired to bad: dead credentials are a fault', () => {
    const html = renderToStaticMarkup(<StatusBadge value="expired" />);
    expect(html).toContain('gv-dot--bad');
    expect(html).toContain('expired');
  });

  test('maps expiring to warn: still working, needs attention', () => {
    const html = renderToStaticMarkup(<StatusBadge value="expiring" />);
    expect(html).toContain('gv-dot--warn');
    expect(html).toContain('expiring');
  });

  test('maps unconfigured to the idle dot: not set up is not a fault', () => {
    const html = renderToStaticMarkup(<StatusBadge value="unconfigured" />);
    expect(html).toContain('data-tone="neutral"');
    expect(html).toContain('gv-dot--idle');
  });

  test('maps "status unavailable" to the idle dot: absent health is not a fault', () => {
    const html = renderToStaticMarkup(<StatusBadge value="status unavailable" />);
    expect(html).toContain('gv-dot--idle');
  });

  test('renders as a neutral kit chip, never a legacy badge', () => {
    const html = renderToStaticMarkup(<StatusBadge value="healthy" />);
    expect(html).toContain('gv-chip');
    expect(html).not.toContain('class="badge');
  });

  test('the value is the only text node, so exact-text callers keep working', () => {
    const html = renderToStaticMarkup(<StatusBadge value="healthy" />);
    expect(html).toMatch(/>healthy<\/span>$/);
  });
});
