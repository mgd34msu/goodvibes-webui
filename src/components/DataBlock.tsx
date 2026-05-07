import { compactJson } from '../lib/object';
import { MarkdownMessage } from './MarkdownMessage';

interface DataBlockProps {
  title: string;
  value: unknown;
  empty?: string;
}

export function DataBlock({ title, value, empty = 'No data' }: DataBlockProps) {
  const hasValue = value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0);

  return (
    <section className="data-block">
      <header>
        <h3>{title}</h3>
      </header>
      {hasValue
        ? typeof value === 'string'
          ? <div className="data-block-markdown"><MarkdownMessage content={value} /></div>
          : <pre>{compactJson(value)}</pre>
        : <p className="empty-state">{empty}</p>}
    </section>
  );
}
