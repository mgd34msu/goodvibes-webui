import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Brain, FileText, Link, Map, Search } from 'lucide-react';
import { invokeMethod, sdk } from '../lib/goodvibes';
import type { OperatorMethodInput } from '../lib/goodvibes';
import { queryKeys } from '../lib/queries';
import { DataBlock } from '../components/DataBlock';
import { RecordList } from '../components/RecordList';
import { bestTitle, firstArray, firstString, readPath } from '../lib/object';
import { formatError } from '../lib/errors';

type UrlSourceType = NonNullable<OperatorMethodInput<'knowledge.ingest.url'>['sourceType']>;

interface ProjectionSelection {
  key: string;
  kind: string;
  id?: string;
  target: unknown;
}

function splitTags(value: string): string[] {
  return value.split(',').map((tag) => tag.trim()).filter(Boolean);
}

function projectionSelection(target: unknown): ProjectionSelection | null {
  const kind = firstString(target, ['kind']);
  if (!kind) return null;
  const id = firstString(target, ['targetId', 'id', 'itemId']);
  return {
    key: `${kind}:${id}`,
    kind,
    ...(id ? { id } : {}),
    target,
  };
}

function projectionPayload(selection: ProjectionSelection, limit = 25): OperatorMethodInput<'knowledge.projection.render'> {
  return {
    kind: selection.kind,
    ...(selection.id ? { id: selection.id } : {}),
    limit,
  };
}

export function KnowledgeView() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'ask' | 'search'>('ask');
  const [ingestUrl, setIngestUrl] = useState('');
  const [ingestTitle, setIngestTitle] = useState('');
  const [ingestTags, setIngestTags] = useState('');
  const [ingestFolderPath, setIngestFolderPath] = useState('');
  const [sourceType, setSourceType] = useState<UrlSourceType>('url');
  const [allowPrivateHosts, setAllowPrivateHosts] = useState(false);
  const [mapFilter, setMapFilter] = useState('');
  const [projectionKey, setProjectionKey] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');

  const status = useQuery({ queryKey: queryKeys.knowledgeStatus, queryFn: () => sdk.knowledge.status() });
  const sources = useQuery({ queryKey: queryKeys.knowledgeSources, queryFn: () => invokeMethod('knowledge.sources.list', { limit: 100 }) });
  const nodes = useQuery({ queryKey: queryKeys.knowledgeNodes, queryFn: () => invokeMethod('knowledge.nodes.list', { limit: 100 }) });
  const issues = useQuery({ queryKey: queryKeys.knowledgeIssues, queryFn: () => invokeMethod('knowledge.issues.list', { limit: 100 }) });
  const refinement = useQuery({ queryKey: queryKeys.knowledgeRefinement, queryFn: () => invokeMethod('knowledge.refinement.tasks.list', { limit: 100 }) });
  const projections = useQuery({ queryKey: queryKeys.knowledgeProjections, queryFn: () => invokeMethod('knowledge.projections.list', { limit: 100 }) });
  const knowledgeMap = useQuery({
    queryKey: [...queryKeys.knowledgeMap, mapFilter],
    queryFn: () => sdk.knowledge.map({
      limit: 150,
      includeSources: true,
      includeIssues: true,
      includeGenerated: true,
      ...(mapFilter.trim() ? { query: mapFilter.trim() } : {}),
    }),
  });
  const itemDetail = useQuery({
    queryKey: ['knowledge', 'item', selectedItemId],
    enabled: Boolean(selectedItemId),
    queryFn: () => invokeMethod('knowledge.item.get', { id: selectedItemId }),
  });

  const projectionTargets = useMemo(() => firstArray(projections.data, ['targets', 'items', 'data']), [projections.data]);
  const selectedProjection = useMemo(() => {
    const selections = projectionTargets.map(projectionSelection).filter((item): item is ProjectionSelection => item !== null);
    return selections.find((selection) => selection.key === projectionKey) ?? selections[0] ?? null;
  }, [projectionKey, projectionTargets]);

  const ask = useMutation({
    mutationFn: () => mode === 'ask'
      ? sdk.knowledge.ask({
        query,
        limit: 10,
        includeSources: true,
        includeConfidence: true,
        includeLinkedObjects: true,
        timeoutMs: 20_000,
      })
      : sdk.knowledge.search({
        query,
        limit: 25,
        includeSources: true,
        includeNodes: true,
      }),
  });

  const ingest = useMutation({
    mutationFn: () => {
      const payload: OperatorMethodInput<'knowledge.ingest.url'> = {
        url: ingestUrl.trim(),
        sourceType,
        ...(ingestTitle.trim() ? { title: ingestTitle.trim() } : {}),
        ...(ingestFolderPath.trim() ? { folderPath: ingestFolderPath.trim() } : {}),
        ...(splitTags(ingestTags).length ? { tags: splitTags(ingestTags) } : {}),
        ...(allowPrivateHosts ? { allowPrivateHosts: true } : {}),
      };
      return invokeMethod('knowledge.ingest.url', payload);
    },
    onSuccess: async (result) => {
      setIngestUrl('');
      setIngestTitle('');
      const sourceId = firstString(readPath(result, ['source']), ['id']);
      if (sourceId) setSelectedItemId(sourceId);
      await queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });

  const renderProjection = useMutation({
    mutationFn: () => {
      if (!selectedProjection) throw new Error('Select a projection target');
      return invokeMethod('knowledge.projection.render', projectionPayload(selectedProjection));
    },
  });

  const materializeProjection = useMutation({
    mutationFn: () => {
      if (!selectedProjection) throw new Error('Select a projection target');
      return invokeMethod('knowledge.projection.materialize', projectionPayload(selectedProjection));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });

  const result = ask.data;
  const answerText = firstString(result, ['answer', 'text', 'summary', 'response']);
  const resultSources = useMemo(() => firstArray(result, ['sources']), [result]);
  const facts = useMemo(() => firstArray(result, ['facts']), [result]);
  const gaps = useMemo(() => firstArray(result, ['gaps', 'issues']), [result]);
  const linkedObjects = useMemo(() => firstArray(result, ['linkedObjects', 'objects']), [result]);
  const refinementIds = useMemo(() => firstArray(result, ['refinementTaskIds', 'refinementTasks']), [result]);
  const sourceItems = useMemo(() => firstArray(sources.data, ['sources', 'items', 'data']), [sources.data]);
  const nodeItems = useMemo(() => firstArray(nodes.data, ['nodes', 'items', 'data']), [nodes.data]);
  const issueItems = useMemo(() => firstArray(issues.data, ['issues', 'items', 'data']), [issues.data]);
  const refinementItems = useMemo(() => firstArray(refinement.data, ['tasks', 'items', 'data']), [refinement.data]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (query.trim()) ask.mutate();
  }

  function submitIngest(event: FormEvent) {
    event.preventDefault();
    if (ingestUrl.trim()) ingest.mutate();
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

      {ask.error && <div className="banner warning">{formatError(ask.error)}</div>}

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
        <section className="panel">
          <div className="panel-title">
            <h2>Add Link</h2>
            <Link size={18} />
          </div>
          <form className="form-grid" onSubmit={submitIngest}>
            <label>
              URL
              <input value={ingestUrl} onChange={(event) => setIngestUrl(event.target.value)} placeholder="https://example.com" />
            </label>
            <label>
              Title
              <input value={ingestTitle} onChange={(event) => setIngestTitle(event.target.value)} placeholder="Optional display title" />
            </label>
            <div className="form-split">
              <label>
                Source type
                <select value={sourceType} onChange={(event) => setSourceType(event.target.value as UrlSourceType)}>
                  <option value="url">URL</option>
                  <option value="bookmark">Bookmark</option>
                  <option value="manual">Manual</option>
                  <option value="document">Document</option>
                  <option value="repo">Repo</option>
                  <option value="dataset">Dataset</option>
                  <option value="image">Image</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                Folder
                <input value={ingestFolderPath} onChange={(event) => setIngestFolderPath(event.target.value)} placeholder="Optional folder path" />
              </label>
            </div>
            <label>
              Tags
              <input value={ingestTags} onChange={(event) => setIngestTags(event.target.value)} placeholder="Comma separated" />
            </label>
            <label className="check-row">
              <input type="checkbox" checked={allowPrivateHosts} onChange={(event) => setAllowPrivateHosts(event.target.checked)} />
              Allow private hosts
            </label>
            <button className="primary-button" type="submit" disabled={ingest.isPending || !ingestUrl.trim()}>
              Ingest URL
            </button>
          </form>
          {ingest.error && <div className="banner warning">{formatError(ingest.error)}</div>}
          <DataBlock title="Ingest Result" value={ingest.data} />
        </section>

        <section className="panel">
          <div className="panel-title">
            <h2>Knowledge Map</h2>
            <Map size={18} />
          </div>
          <div className="knowledge-map-controls">
            <input value={mapFilter} onChange={(event) => setMapFilter(event.target.value)} placeholder="Filter map" />
            <button className="secondary-button" type="button" onClick={() => void knowledgeMap.refetch()}>
              Refresh
            </button>
          </div>
          {knowledgeMap.error && <div className="banner warning">{formatError(knowledgeMap.error)}</div>}
          <DataBlock title="Map" value={knowledgeMap.data} />
        </section>
      </div>

      <section className="panel">
        <div className="panel-title">
          <h2>Wiki Projections</h2>
          <FileText size={18} />
        </div>
        <div className="projection-layout">
          <div className="record-list">
            {projectionTargets.map((target, index) => {
              const selection = projectionSelection(target);
              if (!selection) return null;
              const selected = selectedProjection?.key === selection.key;
              return (
                <button
                  key={`${selection.key}-${index}`}
                  type="button"
                  className={selected ? 'record-row selected' : 'record-row'}
                  onClick={() => setProjectionKey(selection.key)}
                >
                  <strong>{bestTitle(target, selection.kind)}</strong>
                  <span>{selection.kind}{selection.id ? ` · ${selection.id}` : ''}</span>
                </button>
              );
            })}
            {!projectionTargets.length && <p className="empty-state">No projection targets</p>}
          </div>
          <div className="projection-actions">
            <button className="primary-button" type="button" disabled={!selectedProjection || renderProjection.isPending} onClick={() => renderProjection.mutate()}>
              Render
            </button>
            <button className="secondary-button" type="button" disabled={!selectedProjection || materializeProjection.isPending} onClick={() => materializeProjection.mutate()}>
              Materialize
            </button>
          </div>
        </div>
        {renderProjection.error && <div className="banner warning">{formatError(renderProjection.error)}</div>}
        {materializeProjection.error && <div className="banner warning">{formatError(materializeProjection.error)}</div>}
        <div className="two-column projection-results">
          <DataBlock title="Rendered Projection" value={renderProjection.data} />
          <DataBlock title="Materialized Projection" value={materializeProjection.data} />
        </div>
      </section>

      <div className="two-column">
        <DataBlock title="Knowledge Status" value={status.data} />
        <DataBlock title="Refinement Tasks" value={refinementItems} />
      </div>

      <div className="three-column">
        <section className="panel">
          <h2>Sources</h2>
          <RecordList items={sourceItems} selectedId={selectedItemId} onSelect={setSelectedItemId} />
        </section>
        <section className="panel">
          <h2>Nodes</h2>
          <RecordList items={nodeItems} selectedId={selectedItemId} onSelect={setSelectedItemId} />
        </section>
        <section className="panel">
          <h2>Issues</h2>
          <RecordList items={issueItems} selectedId={selectedItemId} onSelect={setSelectedItemId} />
        </section>
      </div>

      <DataBlock title="Selected Item" value={itemDetail.data} empty={selectedItemId ? 'No item detail' : 'Select a source, node, or issue'} />
    </div>
  );
}
