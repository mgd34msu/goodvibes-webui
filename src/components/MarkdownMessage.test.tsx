import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownMessage } from './MarkdownMessage';

describe('MarkdownMessage', () => {
  test('renders a copy action for fenced code blocks', () => {
    const html = renderToStaticMarkup(<MarkdownMessage content={'```ts\nconst answer = 42;\n```'} />);
    expect(html).toContain('markdown-code-copy');
    expect(html).toContain('Copy');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('answer =');
    expect(html).toContain('hljs-number');
  });

  test('renders decorative line numbers when enabled', () => {
    const html = renderToStaticMarkup(<MarkdownMessage content={'```bash\nbun test\nbun run build\n```'} lineNumbers />);
    expect(html).toContain('markdown-code-block numbered');
    expect(html).toContain('markdown-code-line-number');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('bun ');
    expect(html).toContain('hljs-built_in');
    expect(html).toContain('bun run build');
  });
});
