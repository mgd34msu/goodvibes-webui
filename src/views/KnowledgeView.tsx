import { SyntheticEvent, useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Brain, FileText, Link, Map, Search, GitBranch, AlertCircle, BookOpen } from 'lucide-react';
import { invokeMethod, sdk } from '../lib/goodvibes';
import type { OperatorMethodInput } from '../lib/goodvibes';
import { queryKeys } from '../lib/queries';
import { DataBlock } from '../components/DataBlock';
import { MarkdownMessage } from '../components/MarkdownMessage';
import { RecordList } from '../components/RecordList';
import { bestTitle, countFrom, firstArray, firstString, readPath } from '../lib/object';
import { EmptyState } from '../components/feedback/EmptyState';
import { ErrorState } from '../components/feedback/ErrorState';
import { SkeletonBlock } from '../components/feedback/SkeletonBlock';
import ErrorBoundary from '../components/feedback/ErrorBoundary';
import { usePeek } from '../components/peek/PeekPanel';
import { KnowledgeMap } from './knowledge/KnowledgeMap';
import { KnowledgeJobsPeekBody } from './knowledge/KnowledgeJobsPeek';
import '../styles/components/knowledge.css';

type UrlSourceType = NonNullable<OperatorMethodInput<'knowledge.ingest.url'>['sourceType']>;

const PAGE_SIZE_SOURCES = 25;
const PAGE_SIZE_NODES = 25;
const PAGE_SIZE_ISSUES = 10;
const PAGE_SIZE_PROJECTIONS = 25;

/** Slice a full array to the current page window. */
function pageSlice<T>(items: T[], page: number, pageSize: number): T[] {
  const start = page * pageSize;
  return items.slice(start, start + pageSize);
}

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

function isProjectionSelection(item: ProjectionSelection | null): item is ProjectionSelection {
  return item !== null;
}

function projectionPayload(selection: ProjectionSelection, limit = 25): OperatorMethodInput<'knowledge.projection.render'> {
  return {
    kind: selection.kind,
    ...(selection.id ? { id: selection.id } : {}),
    limit,
  };
}

function markdownTextFromValue(value: unknown): string {
  return firstString(value, ['markdown', 'content', 'body', 'text', 'answer', 'summary', 'response'])
    || firstString(readPath(value, ['projection']), ['markdown', 'content', 'body', 'text'])
    || firstString(readPath(value, ['page']), ['markdown', 'content', 'body', 'text'])
    || firstString(readPath(value, ['result']), ['markdown', 'content', 'body', 'text']);
}

function ProjectionResultBlock({ title, value }: { title: string; value: unknown }) {
  const markdown = markdownTextFromValue(value);
  if (!markdown) return <DataBlock title={title} value={value} />;

  return (
    <section className="data-block">
      <header>
        <h3>{title}</h3>
      </header>
      <div className="data-block-markdown">
        <MarkdownMessage content={markdown} />
      </div>
    </section>
  );
}

function KnowledgeItemPeekBody({ itemId }: { itemId: string }) {
  const detail = useQuery({
    queryKey: ['knowledge', 'item', itemId],
    enabled: Boolean(itemId),
    queryFn: () => invokeMethod('knowledge.item.get', { id: itemId }),
  });

  if (detail.isPending) {
    return (
      <div className="knowledge-peek-loading">
        <SkeletonBlock width="60%" height={18} />
        <SkeletonBlock width="100%" height={14} />
        <SkeletonBlock width="80%" height={14} />
        <SkeletonBlock width="90%" height={14} />
      </div>
    );
  }

  if (detail.error) {
    return (
      <div className="knowledge-peek-body">
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      </div>
    );
  }

  return (
    <div className="knowledge-peek-body">
      <DataBlock title="Item Detail" value={detail.data} />
    </div>
  );
}

export function KnowledgeView() {
  const queryClient = useQueryClient();
  const peek = usePeek();

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

  // Pagination offsets
  const [sourcePage, setSourcePage] = useState(0);
  const [nodePage, setNodePage] = useState(0);
  const [issuePage, setIssuePage] = useState(0);
  const [projectionPage, setProjectionPage] = useState(0);

  const status = useQuery({ queryKey: queryKeys.knowledgeStatus, queryFn: () => sdk.knowledge.status() });
  const sources = useQuery({
    queryKey: queryKeys.knowledgeSources,
    queryFn: () => invokeMethod('knowledge.sources.list', { limit: 100 }),
  });
  const nodes = useQuery({
    queryKey: queryKeys.knowledgeNodes,
    queryFn: () => invokeMethod('knowledge.nodes.list', { limit: 100 }),
  });
  const issues = useQuery({
    queryKey: queryKeys.knowledgeIssues,
    queryFn: () => invokeMethod('knowledge.issues.list', { limit: 100 }),
  });
  const refinement = useQuery({ queryKey: queryKeys.knowledgeRefinement, queryFn: () => invokeMethod('knowledge.refinement.tasks.list', { limit: 100 }) });
  const projections = useQuery({
    queryKey: queryKeys.knowledgeProjections,
    queryFn: () => invokeMethod('knowledge.projections.list', { limit: 100 }),
  });
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
      await queryClient.invalidateQueries({ queryKey: ['knowledge'] });
      // Open the newly ingested source in peek if we have an ID
      if (sourceId) {
        openItemPeek(sourceId, 'Ingested Source');
      }
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
  const allSourceItems = useMemo(() => firstArray(sources.data, ['sources', 'items', 'data']), [sources.data]);
  const allNodeItems = useMemo(() => firstArray(nodes.data, ['nodes', 'items', 'data']), [nodes.data]);
  const allIssueItems = useMemo(() => firstArray(issues.data, ['issues', 'items', 'data']), [issues.data]);
  const allProjectionTargets = useMemo(() => firstArray(projections.data, ['targets', 'items', 'data']), [projections.data]);
  const refinementItems = useMemo(() => firstArray(refinement.data, ['tasks', 'items', 'data']), [refinement.data]);

  // Client-side paginated slices
  const sourceItems = useMemo(() => pageSlice(allSourceItems, sourcePage, PAGE_SIZE_SOURCES), [allSourceItems, sourcePage]);
  const nodeItems = useMemo(() => pageSlice(allNodeItems, nodePage, PAGE_SIZE_NODES), [allNodeItems, nodePage]);
  const issueItems = useMemo(() => pageSlice(allIssueItems, issuePage, PAGE_SIZE_ISSUES), [allIssueItems, issuePage]);
  const projectionPageItems = useMemo(() => pageSlice(allProjectionTargets, projectionPage, PAGE_SIZE_PROJECTIONS), [allProjectionTargets, projectionPage]);
  const projectionSelections = useMemo(
    () => allProjectionTargets.map(projectionSelection).filter(isProjectionSelection),
    [allProjectionTargets],
  );
  const selectedProjection: ProjectionSelection | null =
    projectionSelections.find((s) => s.key === projectionKey)
    ?? (projectionSelections.length > 0 ? projectionSelections[0] : null);

  const openItemPeek = useCallback((id: string, label: string) => {
    peek.open({
      title: label,
      content: <KnowledgeItemPeekBody itemId={id} />,
    });
  }, [peek]);

  const openJobsPeek = useCallback(() => {
    peek.open({
      title: 'Knowledge Job Activity',
      content: <KnowledgeJobsPeekBody />,
    });
  }, [peek]);

  // W8 activity honesty: jobRunCount/nodeCount live side by side on knowledge.status
  // but were never contrasted (a '766 jobs ran / 0 nodes' state read as a blank map).
  // null signals "the status query hasn't resolved yet" so the Map/Nodes panels don't
  // flash a false "empty" reading before the real numbers arrive.
  const statusKnown = !status.isPending && !status.error;
  const statusJobRunCount = statusKnown ? countFrom(status.data, ['jobRunCount']) : null;
  const statusNodeCount = statusKnown ? countFrom(status.data, ['nodeCount']) : null;

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (query.trim()) ask.mutate();
  }

  function submitIngest(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ingestUrl.trim()) ingest.mutate();
  }

  return (
    <ErrorBoundary
      fallback={(err, reset) => (
        <ErrorState error={err} onRetry={reset} title="Knowledge view failed" />
      )}
    >
      <div className="stack">
        <form className="knowledge-search" onSubmit={submit}>
          <div className="segmented">
            <button
              type="button"
              className={mode === 'ask' ? 'active' : ''}
              aria-pressed={mode === 'ask'}
              onClick={() => setMode('ask')}
            >
              <Brain size={16} aria-hidden="true" />
              Ask
            </button>
            <button
              type="button"
              className={mode === 'search' ? 'active' : ''}
              aria-pressed={mode === 'search'}
              onClick={() => setMode('search')}
            >
              <Search size={16} aria-hidden="true" />
              Search
            </button>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Query knowledge base"
            aria-label={mode === 'ask' ? 'Ask a question' : 'Search knowledge'}
          />
          <button className="primary-button" type="submit" disabled={ask.isPending || !query.trim()}>
            {ask.isPending ? 'Running…' : 'Run'}
          </button>
        </form>

        {/* Async status region — screen readers announced on change */}
        <div
          aria-live="polite"
          aria-atomic="false"
          className="knowledge-status-region"
        >
          {ask.isPending && (
            <div className="knowledge-skeleton-group">
              <SkeletonBlock variant="text" lines={3} />
            </div>
          )}
          {ask.error && (
            <ErrorState
              error={ask.error}
              onRetry={() => { if (query.trim()) ask.mutate(); }}
              title="Query failed"
            />
          )}
        </div>

        {result !== undefined && result !== null && (
          <section className="answer-panel" aria-label={mode === 'ask' ? 'Answer' : 'Search results'}>
            <h2>{mode === 'ask' ? 'Answer' : 'Results'}</h2>
            {answerText ? (
              <div className="answer-text">
                <MarkdownMessage content={answerText} />
              </div>
            ) : <DataBlock title="Response" value={result} />}
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
              <Link size={18} aria-hidden="true" />
            </div>
            <form className="form-grid" onSubmit={submitIngest}>
              <label>
                URL
                <input
                  value={ingestUrl}
                  onChange={(event) => setIngestUrl(event.target.value)}
                  placeholder="https://example.com"
                  aria-label="URL to ingest"
                />
              </label>
              <label>
                Title
                <input
                  value={ingestTitle}
                  onChange={(event) => setIngestTitle(event.target.value)}
                  placeholder="Optional display title"
                  aria-label="Optional display title"
                />
              </label>
              <div className="form-split">
                <label>
                  Source type
                  <select
                    value={sourceType}
                    onChange={(event) => setSourceType(event.target.value as UrlSourceType)}
                    aria-label="Source type"
                  >
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
                  <input
                    value={ingestFolderPath}
                    onChange={(event) => setIngestFolderPath(event.target.value)}
                    placeholder="Optional folder path"
                    aria-label="Optional folder path"
                  />
                </label>
              </div>
              <label>
                Tags
                <input
                  value={ingestTags}
                  onChange={(event) => setIngestTags(event.target.value)}
                  placeholder="Comma separated"
                  aria-label="Tags, comma separated"
                />
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={allowPrivateHosts}
                  onChange={(event) => setAllowPrivateHosts(event.target.checked)}
                />
                Allow private hosts
              </label>
              <button
                className="primary-button"
                type="submit"
                disabled={ingest.isPending || !ingestUrl.trim()}
                aria-busy={ingest.isPending}
              >
                {ingest.isPending ? 'Ingesting…' : 'Ingest URL'}
              </button>
            </form>
            {ingest.error && (
              <ErrorState
                error={ingest.error}
                onRetry={() => { if (ingestUrl.trim()) ingest.mutate(); }}
                title="Ingest failed"
              />
            )}
            <DataBlock title="Ingest Result" value={ingest.data} />
          </section>

          <section className="panel">
            <div className="panel-title">
              <h2>Knowledge Map</h2>
              <Map size={18} aria-hidden="true" />
            </div>
            <div className="knowledge-map-controls">
              <input
                value={mapFilter}
                onChange={(event) => setMapFilter(event.target.value)}
                placeholder="Filter map"
                aria-label="Filter knowledge map"
              />
              <button
                className="secondary-button"
                type="button"
                aria-label="Refresh knowledge map"
                onClick={() => void knowledgeMap.refetch()}
              >
                Refresh
              </button>
            </div>
            <div aria-live="polite" aria-atomic="true">
              <KnowledgeMap
                isPending={knowledgeMap.isPending}
                error={knowledgeMap.error}
                data={knowledgeMap.data}
                onRetry={() => void knowledgeMap.refetch()}
                hasFilter={Boolean(mapFilter.trim())}
                onClearFilter={() => setMapFilter('')}
                onViewJobs={openJobsPeek}
                jobRunCount={statusJobRunCount}
                overallNodeCount={statusNodeCount}
                statusPending={status.isPending}
              />
            </div>
          </section>
        </div>

        <section className="panel">
          <div className="panel-title">
            <h2>Wiki Projections</h2>
            <FileText size={18} aria-hidden="true" />
          </div>

          {projections.isPending && (
            <div className="knowledge-skeleton-group">
              <SkeletonBlock width="100%" height={32} />
              <SkeletonBlock width="100%" height={32} />
            </div>
          )}
          {projections.error && (
            <ErrorState
              error={projections.error}
              onRetry={() => void projections.refetch()}
              title="Failed to load projections"
            />
          )}

          {!projections.isPending && !projections.error && (
            <div className="projection-layout">
              <div className="record-list" role="listbox" aria-label="Projection targets">
                {projectionPageItems.length === 0 ? (
                  <EmptyState
                    icon={<FileText size={24} />}
                    title="No projection targets"
                    description="Add sources to generate wiki projections."
                  />
                ) : (
                  projectionPageItems.map((target, index) => {
                    const selection = projectionSelection(target);
                    if (!selection) return null;
                    const selected = selectedProjection?.key === selection.key;
                    return (
                      <button
                        key={`${selection.key}-${index}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={selected ? 'record-row selected' : 'record-row'}
                        onClick={() => setProjectionKey(selection.key)}
                      >
                        <strong>{bestTitle(target, selection.kind)}</strong>
                        <span>{selection.kind}{selection.id ? ` · ${selection.id}` : ''}</span>
                      </button>
                    );
                  })
                )}
              </div>

              {allProjectionTargets.length > 0 && (
                <div className="knowledge-load-more">
                  <span>{projectionPage * PAGE_SIZE_PROJECTIONS + 1}–{projectionPage * PAGE_SIZE_PROJECTIONS + projectionPageItems.length} shown</span>
                  <div>
                    <button
                      type="button"
                      className="knowledge-load-more__button"
                      disabled={projectionPage === 0}
                      aria-label="Previous page of projections"
                      onClick={() => setProjectionPage((p) => Math.max(0, p - 1))}
                    >
                      Prev
                    </button>
                    {' '}
                    <button
                      type="button"
                      className="knowledge-load-more__button"
                      disabled={(projectionPage + 1) * PAGE_SIZE_PROJECTIONS >= allProjectionTargets.length}
                      aria-label="Next page of projections"
                      onClick={() => setProjectionPage((p) => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}

              <div className="projection-actions">
                <button
                  className="primary-button"
                  type="button"
                  disabled={!selectedProjection || renderProjection.isPending}
                  aria-busy={renderProjection.isPending}
                  onClick={() => renderProjection.mutate()}
                >
                  Render
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!selectedProjection || materializeProjection.isPending}
                  aria-busy={materializeProjection.isPending}
                  onClick={() => materializeProjection.mutate()}
                >
                  Materialize
                </button>
              </div>
            </div>
          )}

          {renderProjection.error && (
            <ErrorState
              error={renderProjection.error}
              onRetry={() => renderProjection.mutate()}
              title="Render failed"
            />
          )}
          {materializeProjection.error && (
            <ErrorState
              error={materializeProjection.error}
              onRetry={() => materializeProjection.mutate()}
              title="Materialize failed"
            />
          )}
          <div className="two-column projection-results">
            <ProjectionResultBlock title="Rendered Projection" value={renderProjection.data} />
            <ProjectionResultBlock title="Materialized Projection" value={materializeProjection.data} />
          </div>
        </section>

        <div className="two-column">
          <section className="panel" aria-label="Knowledge status">
            {status.isPending ? (
              <div className="knowledge-skeleton-group">
                <SkeletonBlock width="40%" height={16} />
                <SkeletonBlock width="100%" height={60} />
              </div>
            ) : status.error ? (
              <ErrorState
                error={status.error}
                onRetry={() => void status.refetch()}
                title="Status unavailable"
              />
            ) : (
              <DataBlock title="Knowledge Status" value={status.data} />
            )}
          </section>
          <section className="panel" aria-label="Refinement tasks">
            {refinement.isPending ? (
              <div className="knowledge-skeleton-group">
                <SkeletonBlock width="40%" height={16} />
                <SkeletonBlock width="100%" height={60} />
              </div>
            ) : refinement.error ? (
              <ErrorState
                error={refinement.error}
                onRetry={() => void refinement.refetch()}
                title="Refinement tasks unavailable"
              />
            ) : (
              <DataBlock title="Refinement Tasks" value={refinementItems} />
            )}
          </section>
        </div>

        <div className="three-column">
          {/* Sources panel */}
          <section className="panel knowledge-record-panel" aria-label="Knowledge sources">
            <h2>Sources</h2>
            <div aria-live="polite" aria-atomic="false">
              {sources.isPending ? (
                <div className="knowledge-skeleton-group">
                  <SkeletonBlock width="100%" height={36} />
                  <SkeletonBlock width="100%" height={36} />
                  <SkeletonBlock width="100%" height={36} />
                </div>
              ) : sources.error ? (
                <ErrorState
                  error={sources.error}
                  onRetry={() => void sources.refetch()}
                  title="Failed to load sources"
                />
              ) : sourceItems.length === 0 ? (
                <EmptyState
                  icon={<BookOpen size={24} />}
                  title="No sources"
                  description="Ingest a URL to add your first source."
                />
              ) : (
                <div className="knowledge-record-panel__list">
                  <RecordList
                    items={sourceItems}
                    onSelect={(id) => openItemPeek(id, 'Source Detail')}
                  />
                </div>
              )}
            </div>
            {allSourceItems.length > 0 && (
              <div className="knowledge-load-more">
                <span>Page {sourcePage + 1}</span>
                <div>
                  <button
                    type="button"
                    className="knowledge-load-more__button"
                    disabled={sourcePage === 0}
                    aria-label="Previous page of sources"
                    onClick={() => setSourcePage((p) => Math.max(0, p - 1))}
                  >
                    Prev
                  </button>
                  {' '}
                  <button
                    type="button"
                    className="knowledge-load-more__button"
                    disabled={(sourcePage + 1) * PAGE_SIZE_SOURCES >= allSourceItems.length}
                    aria-label="Next page of sources"
                    onClick={() => setSourcePage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Nodes panel */}
          <section className="panel knowledge-record-panel" aria-label="Knowledge nodes">
            <h2>Nodes</h2>
            <div aria-live="polite" aria-atomic="false">
              {nodes.isPending ? (
                <div className="knowledge-skeleton-group">
                  <SkeletonBlock width="100%" height={36} />
                  <SkeletonBlock width="100%" height={36} />
                  <SkeletonBlock width="100%" height={36} />
                </div>
              ) : nodes.error ? (
                <ErrorState
                  error={nodes.error}
                  onRetry={() => void nodes.refetch()}
                  title="Failed to load nodes"
                />
              ) : nodeItems.length === 0 ? (
                statusJobRunCount && statusJobRunCount > 0 ? (
                  <EmptyState
                    icon={<AlertCircle size={24} />}
                    title={`${statusJobRunCount} indexing job${statusJobRunCount === 1 ? '' : 's'} ran, 0 nodes`}
                    description="Indexing may still be in progress, filtered out everything, or be failing to produce nodes."
                    action={{ label: 'View jobs', onClick: openJobsPeek }}
                  />
                ) : (
                  <EmptyState
                    icon={<GitBranch size={24} />}
                    title="No nodes yet"
                    description="Nodes appear after processing sources."
                  />
                )
              ) : (
                <div className="knowledge-record-panel__list">
                  <RecordList
                    items={nodeItems}
                    onSelect={(id) => openItemPeek(id, 'Node Detail')}
                  />
                </div>
              )}
            </div>
            {allNodeItems.length > 0 && (
              <div className="knowledge-load-more">
                <span>Page {nodePage + 1}</span>
                <div>
                  <button
                    type="button"
                    className="knowledge-load-more__button"
                    disabled={nodePage === 0}
                    aria-label="Previous page of nodes"
                    onClick={() => setNodePage((p) => Math.max(0, p - 1))}
                  >
                    Prev
                  </button>
                  {' '}
                  <button
                    type="button"
                    className="knowledge-load-more__button"
                    disabled={(nodePage + 1) * PAGE_SIZE_NODES >= allNodeItems.length}
                    aria-label="Next page of nodes"
                    onClick={() => setNodePage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Issues panel */}
          <section className="panel knowledge-record-panel" aria-label="Knowledge issues">
            <h2>Issues</h2>
            <div aria-live="polite" aria-atomic="false">
              {issues.isPending ? (
                <div className="knowledge-skeleton-group">
                  <SkeletonBlock width="100%" height={36} />
                  <SkeletonBlock width="100%" height={36} />
                </div>
              ) : issues.error ? (
                <ErrorState
                  error={issues.error}
                  onRetry={() => void issues.refetch()}
                  title="Failed to load issues"
                />
              ) : issueItems.length === 0 ? (
                <EmptyState
                  icon={<AlertCircle size={24} />}
                  title="No issues"
                  description="Issues are flagged automatically during processing."
                />
              ) : (
                <div className="knowledge-record-panel__list">
                  <RecordList
                    items={issueItems}
                    onSelect={(id) => openItemPeek(id, 'Issue Detail')}
                  />
                </div>
              )}
            </div>
            {allIssueItems.length > 0 && (
              <div className="knowledge-load-more">
                <span>Page {issuePage + 1}</span>
                <div>
                  <button
                    type="button"
                    className="knowledge-load-more__button"
                    disabled={issuePage === 0}
                    aria-label="Previous page of issues"
                    onClick={() => setIssuePage((p) => Math.max(0, p - 1))}
                  >
                    Prev
                  </button>
                  {' '}
                  <button
                    type="button"
                    className="knowledge-load-more__button"
                    disabled={(issuePage + 1) * PAGE_SIZE_ISSUES >= allIssueItems.length}
                    aria-label="Next page of issues"
                    onClick={() => setIssuePage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </ErrorBoundary>
  );
}
