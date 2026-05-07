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
});
