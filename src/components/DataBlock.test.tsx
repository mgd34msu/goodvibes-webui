import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataBlock } from './DataBlock';

describe('DataBlock', () => {
  // ── title rendering ──────────────────────────────────────────────────────

  test('renders title in an h3 element', () => {
    const html = renderToStaticMarkup(<DataBlock title="My Section" value="some content" />);
    expect(html).toContain('<h3>My Section</h3>');
  });

  // ── empty state ──────────────────────────────────────────────────────────

  test('renders default empty-state when value is undefined', () => {
    const html = renderToStaticMarkup(<DataBlock title="T" value={undefined} />);
    expect(html).toContain('empty-state');
    expect(html).toContain('No data');
  });

  test('renders default empty-state when value is null', () => {
    const html = renderToStaticMarkup(<DataBlock title="T" value={null} />);
    expect(html).toContain('empty-state');
    expect(html).toContain('No data');
  });

  test('renders default empty-state when value is an empty array', () => {
    const html = renderToStaticMarkup(<DataBlock title="T" value={[]} />);
    expect(html).toContain('empty-state');
  });

  test('renders custom empty prop when value is absent', () => {
    const html = renderToStaticMarkup(
      <DataBlock title="T" value={undefined} empty="Nothing to show" />,
    );
    expect(html).toContain('Nothing to show');
    expect(html).not.toContain('No data');
  });

  // ── string value — MarkdownMessage path ─────────────────────────────────

  test('renders string value inside data-block-markdown div', () => {
    const html = renderToStaticMarkup(
      <DataBlock title="Notes" value="Hello **world**" />,
    );
    expect(html).toContain('data-block-markdown');
    // Markdown rendered: **world** → <strong>world</strong>
    expect(html).toContain('<strong>');
    // Should NOT render a <pre> for string values
    expect(html).not.toContain('<pre>');
  });

  // ── non-string value — compactJson / pre path ────────────────────────────

  test('renders object value as JSON inside a pre element', () => {
    const value = { key: 'value', count: 42 };
    const html = renderToStaticMarkup(<DataBlock title="Data" value={value} />);
    expect(html).toContain('<pre>');
    expect(html).toContain('&quot;key&quot;');
    expect(html).toContain('&quot;value&quot;');
    expect(html).toContain('42');
    // Should not render a markdown div for non-string values
    expect(html).not.toContain('data-block-markdown');
  });

  test('renders nested object as pretty-printed JSON in pre', () => {
    const value = { user: { name: 'Alice', roles: ['admin', 'user'] } };
    const html = renderToStaticMarkup(<DataBlock title="Nested" value={value} />);
    expect(html).toContain('<pre>');
    expect(html).toContain('&quot;user&quot;');
    expect(html).toContain('Alice');
    expect(html).toContain('admin');
  });

  test('renders number value as pre (non-string)', () => {
    const html = renderToStaticMarkup(<DataBlock title="Count" value={99} />);
    expect(html).toContain('<pre>');
    expect(html).toContain('99');
  });

  test('renders non-empty array as pre (non-string)', () => {
    const html = renderToStaticMarkup(<DataBlock title="List" value={['a', 'b']} />);
    expect(html).toContain('<pre>');
    expect(html).toContain('&quot;a&quot;');
    expect(html).toContain('&quot;b&quot;');
  });

  // ── container structure ──────────────────────────────────────────────────

  test('wraps content in a section.data-block with a header', () => {
    const html = renderToStaticMarkup(<DataBlock title="Wrap" value="text" />);
    expect(html).toContain('data-block');
    expect(html).toContain('<header>');
  });
});
