import { type SyntheticEvent, useState } from 'react';
import { PlusCircle } from 'lucide-react';
import type { MemoryAddInput, MemoryClass, MemoryScope } from '../../lib/goodvibes';
import { ErrorState } from '../../components/feedback/ErrorState';
import { MEMORY_CLASSES, MEMORY_SCOPES, splitTags } from './memory-helpers';

interface AddMemoryFormProps {
  isPending: boolean;
  error: unknown;
  onSubmit: (input: MemoryAddInput) => void;
}

/** The add-a-memory composer. New records default to confidence 60 (the recall floor)
 * and reviewState 'fresh' on the daemon side — this form does not offer to override
 * either, keeping "add" honest about what a freshly-stored fact starts as. */
export function AddMemoryForm({ isPending, error, onSubmit }: AddMemoryFormProps) {
  const [cls, setCls] = useState<MemoryClass>('fact');
  const [scope, setScope] = useState<MemoryScope>('project');
  const [summary, setSummary] = useState('');
  const [detail, setDetail] = useState('');
  const [tags, setTags] = useState('');

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!summary.trim()) return;
    const tagList = splitTags(tags);
    onSubmit({
      cls,
      summary: summary.trim(),
      scope,
      ...(detail.trim() ? { detail: detail.trim() } : {}),
      ...(tagList.length ? { tags: tagList } : {}),
    });
    setSummary('');
    setDetail('');
    setTags('');
  }

  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Add Memory</h2>
        <PlusCircle size={18} aria-hidden="true" />
      </div>
      <form className="form-grid" onSubmit={submit}>
        <div className="form-split">
          <label>
            Type
            <select value={cls} onChange={(event) => setCls(event.target.value as MemoryClass)} aria-label="Memory type">
              {MEMORY_CLASSES.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>
            Scope
            <select value={scope} onChange={(event) => setScope(event.target.value as MemoryScope)} aria-label="Memory scope">
              {MEMORY_SCOPES.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        </div>
        <label>
          Summary
          <input
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="A one-line fact, decision, or constraint"
            aria-label="Memory summary"
            required
          />
        </label>
        <label>
          Detail
          <textarea
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            placeholder="Optional longer explanation"
            aria-label="Memory detail"
            rows={3}
          />
        </label>
        <label>
          Tags
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="Comma separated"
            aria-label="Tags, comma separated"
          />
        </label>
        <button
          className="primary-button"
          type="submit"
          disabled={isPending || !summary.trim()}
          aria-busy={isPending}
        >
          {isPending ? 'Saving…' : 'Add memory'}
        </button>
      </form>
      {Boolean(error) && (
        <ErrorState error={error} title="Could not save the memory" />
      )}
    </section>
  );
}
