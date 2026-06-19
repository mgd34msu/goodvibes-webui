import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { compactJson } from '../lib/object';
import { MarkdownMessage } from './MarkdownMessage';
import { useOptionalToast } from '../lib/toast';

interface DataBlockProps {
  title: string;
  value: unknown;
  empty?: string;
}

/** Copy button for the JSON <pre> branch. */
function DataBlockCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const toastCtx = useOptionalToast();

  function handleCopy(): void {
    if (!navigator.clipboard) {
      toastCtx?.toast({ title: 'Copy failed', description: 'Clipboard API unavailable', tone: 'danger', durationMs: 3000 });
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1300);
      },
      () => {
        toastCtx?.toast({ title: 'Copy failed', description: 'Could not write to clipboard', tone: 'danger', durationMs: 3000 });
      },
    );
  }

  return (
    <button
      type="button"
      className="data-block-copy"
      onClick={handleCopy}
      title="Copy"
      aria-label="Copy value"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
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
          : (
            <div className="data-block-pre-wrap">
              <DataBlockCopyButton text={compactJson(value)} />
              <pre>{compactJson(value)}</pre>
            </div>
          )
        : <p className="empty-state">{empty}</p>}
    </section>
  );
}
