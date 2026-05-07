import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Brain, Search } from 'lucide-react';
import { invokeMethod } from '../lib/goodvibes';
import { queryKeys } from '../lib/queries';
import { DataBlock } from '../components/DataBlock';
import { RecordList } from '../components/RecordList';
import { firstArray, firstString } from '../lib/object';

export function KnowledgeView() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'ask' | 'search'>('ask');

  const status = useQuery({ queryKey: queryKeys.knowledgeStatus, queryFn: () => invokeMethod('knowledge.status') });
  const sources = useQuery({ queryKey: queryKeys.knowledgeSources, queryFn: () => invokeMethod('knowledge.sources.list', { limit: 100 }) });
  const nodes = useQuery({ queryKey: queryKeys.knowledgeNodes, queryFn: () => invokeMethod('knowledge.nodes.list', { limit: 100 }) });
  const issues = useQuery({ queryKey: queryKeys.knowledgeIssues, queryFn: () => invokeMethod('knowledge.issues.list', { limit: 100 }) });
  const refinement = useQuery({ queryKey: queryKeys.knowledgeRefinement, queryFn: () => invokeMethod('knowledge.refinement.tasks.list', { limit: 100 }) });

  const ask = useMutation({
    mutationFn: () => mode === 'ask'
      ? invokeMethod('knowledge.ask', {
        query,
        limit: 10,
        includeSources: true,
        includeConfidence: true,
        includeLinkedObjects: true,
        timeoutMs: 20_000,
      })
      : invokeMethod('knowledge.search', {
        query,
        limit: 25,
        includeSources: true,
        includeNodes: true,
      }),
  });

  const result = ask.data;
  const answerText = firstString(result, ['answer', 'text', 'summary', 'response']);
  const resultSources = useMemo(() => firstArray(result, ['sources']), [result]);
  const facts = useMemo(() => firstArray(result, ['facts']), [result]);
  const gaps = useMemo(() => firstArray(result, ['gaps', 'issues']), [result]);
  const linkedObjects = useMemo(() => firstArray(result, ['linkedObjects', 'objects']), [result]);
  const refinementIds = useMemo(() => firstArray(result, ['refinementTaskIds', 'refinementTasks']), [result]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (query.trim()) ask.mutate();
  }

  return (
    <div className="stack">
      <form className="knowledge-search" onSubmit={submit}>
        <div className="segmented">
          <button type="button" className={mode === 'ask' ? 'active' : ''} onClick={() => setMode('ask')}>
            <Brain size={16} />
            Ask
          </button>
          <button type="button" className={mode === 'search' ? 'active' : ''} onClick={() => setMode('search')}>
            <Search size={16} />
            Search
          </button>
        </div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Query regular knowledge" />
        <button className="primary-button" type="submit" disabled={ask.isPending || !query.trim()}>
          Run
        </button>
      </form>

      {ask.error && <div className="banner warning">{ask.error instanceof Error ? ask.error.message : String(ask.error)}</div>}

      {result !== undefined && result !== null && (
        <section className="answer-panel">
          <h2>{mode === 'ask' ? 'Answer' : 'Results'}</h2>
          {answerText ? <p className="answer-text">{answerText}</p> : <DataBlock title="Response" value={result} />}
          <div className="metadata-grid">
            <DataBlock title="Sources" value={resultSources} />
            <DataBlock title="Facts" value={facts} />
            <DataBlock title="Gaps" value={gaps} />
            <DataBlock title="Linked Objects" value={linkedObjects} />
            <DataBlock title="Refinement" value={refinementIds.length ? refinementIds : result} />
          </div>
        </section>
      )}

      <div className="two-column">
        <DataBlock title="Knowledge Status" value={status.data} />
        <DataBlock title="Refinement Tasks" value={firstArray(refinement.data, ['tasks', 'items', 'data'])} />
      </div>

      <div className="three-column">
        <section className="panel">
          <h2>Sources</h2>
          <RecordList items={firstArray(sources.data, ['sources', 'items', 'data'])} />
        </section>
        <section className="panel">
          <h2>Nodes</h2>
          <RecordList items={firstArray(nodes.data, ['nodes', 'items', 'data'])} />
        </section>
        <section className="panel">
          <h2>Issues</h2>
          <RecordList items={firstArray(issues.data, ['issues', 'items', 'data'])} />
        </section>
      </div>
    </div>
  );
}
