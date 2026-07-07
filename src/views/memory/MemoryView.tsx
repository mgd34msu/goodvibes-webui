/**
 * MemoryView — the web UI's first consumer of the canonical, cross-surface memory
 * store (memory.records.* / memory.review-queue, SDK 1.1.0). Search & browse, add,
 * review-queue, delete, and a read-only personas surface (VIBE.md constraint records).
 *
 * HONESTY. The recall-honesty contract (memory-recall-contract.ts) is applied
 * server-side and surfaced here verbatim via MemorySearchHonestyNote: which search
 * mode actually ran (literal vs semantic), the stated reason when the semantic index
 * could not be consulted (never a silent empty result), the soft hashed-provider
 * caveat, and the recall-filter exclusion counts. A daemon that does not serve memory
 * at all (METHOD_NOT_FOUND on the list query) gets an honest "this daemon does not
 * serve memory" state, never a blank panel that reads as "nothing is stored".
 */
import { useCallback, useMemo, useState, type SyntheticEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Search, Users } from 'lucide-react';
import {
  sdk,
  VIBE_PERSONA_TAG,
  type MemoryAddInput,
  type MemoryClass,
  type MemoryRecord,
  type MemorySearchInput,
  type MemoryScope,
  type MemoryUpdateReviewInput,
} from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import { isMethodUnavailableError } from '../../lib/errors';
import { usePeek } from '../../components/peek/PeekPanel';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';
import ErrorBoundary from '../../components/feedback/ErrorBoundary';
import { MemoryRecordRow } from './MemoryRecordRow';
import { MemoryRecordDetail } from './MemoryRecordDetail';
import { MemorySearchHonestyNote } from './MemorySearchHonestyNote';
import { ReviewQueuePanel } from './ReviewQueuePanel';
import { AddMemoryForm } from './AddMemoryForm';
import { MEMORY_CLASSES, MEMORY_SCOPES, isPersonaRecord, splitTags } from './memory-helpers';
import '../../styles/components/memory.css';

const DEFAULT_FILTERS: MemorySearchInput = { limit: 100 };
const PERSONA_FILTER: MemorySearchInput = { cls: 'constraint', tags: [VIBE_PERSONA_TAG], limit: 100 };

export function MemoryView() {
  const queryClient = useQueryClient();
  const peek = usePeek();

  const [queryText, setQueryText] = useState('');
  const [semantic, setSemantic] = useState(false);
  const [scopeFilter, setScopeFilter] = useState<MemoryScope | ''>('');
  const [clsFilter, setClsFilter] = useState<MemoryClass | ''>('');
  const [tagsInput, setTagsInput] = useState('');
  const [recall, setRecall] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState<MemorySearchInput>(DEFAULT_FILTERS);

  const list = useQuery({
    queryKey: [...queryKeys.memoryList, appliedFilters],
    queryFn: () => sdk.operator.memory.search(appliedFilters),
  });

  const personas = useQuery({
    queryKey: queryKeys.memoryPersonas,
    queryFn: () => sdk.operator.memory.search(PERSONA_FILTER),
  });

  const reviewQueue = useQuery({
    queryKey: queryKeys.memoryReviewQueue,
    queryFn: () => sdk.operator.memory.reviewQueue({ limit: 50 }),
  });

  const invalidateAll = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['memory'] });
  }, [queryClient]);

  const addMutation = useMutation({
    mutationFn: (input: MemoryAddInput) => sdk.operator.memory.add(input),
    onSuccess: invalidateAll,
  });

  const deleteMutation = useMutation({
    mutationFn: (record: MemoryRecord) => sdk.operator.memory.delete(record.id),
    onSuccess: invalidateAll,
  });

  const updateReviewMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: MemoryUpdateReviewInput }) => sdk.operator.memory.updateReview(id, input),
    onSuccess: invalidateAll,
  });

  const personaRecords = useMemo(
    () => (personas.data?.records ?? []).filter(isPersonaRecord),
    [personas.data],
  );

  const openDetail = useCallback((record: MemoryRecord) => {
    peek.open({ title: record.summary, content: <MemoryRecordDetail record={record} /> });
  }, [peek]);

  const requestDelete = useCallback((record: MemoryRecord) => {
    if (!window.confirm(`Delete "${record.summary}" permanently?\n\nThis removes the memory record — it cannot be undone.`)) return;
    deleteMutation.mutate(record);
  }, [deleteMutation]);

  function submitSearch(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const tags = splitTags(tagsInput);
    setAppliedFilters({
      limit: 100,
      ...(queryText.trim() ? { query: queryText.trim() } : {}),
      ...(semantic ? { semantic: true } : {}),
      ...(scopeFilter ? { scope: scopeFilter } : {}),
      ...(clsFilter ? { cls: clsFilter } : {}),
      ...(tags.length ? { tags } : {}),
      ...(recall ? { recall: true } : {}),
    });
  }

  function resetSearch() {
    setQueryText('');
    setSemantic(false);
    setScopeFilter('');
    setClsFilter('');
    setTagsInput('');
    setRecall(false);
    setAppliedFilters(DEFAULT_FILTERS);
  }

  // Honest degrade: this daemon build genuinely does not serve the memory verbs at
  // all (a real 404 METHOD_NOT_FOUND on the capability, not a transient failure) —
  // replace the whole view rather than showing five separately-broken panels.
  const memoryUnavailable = list.isError && isMethodUnavailableError(list.error);
  if (memoryUnavailable) {
    return (
      <div className="stack">
        <EmptyState
          icon={<Database size={28} />}
          title="This daemon does not serve memory"
          description="The connected daemon build has no memory.records.* service. Upgrade it to browse, add, review, or delete memory records here."
        />
      </div>
    );
  }

  return (
    <ErrorBoundary
      fallback={(err, reset) => <ErrorState error={err} onRetry={reset} title="Memory view failed" />}
    >
      <div className="stack memory-view-stack">
        <form className="memory-search" onSubmit={submitSearch}>
          <input
            value={queryText}
            onChange={(event) => setQueryText(event.target.value)}
            placeholder="Search memory (leave blank to browse everything)"
            aria-label="Search memory"
          />
          <label className="check-row">
            <input type="checkbox" checked={semantic} onChange={(event) => setSemantic(event.target.checked)} />
            Semantic
          </label>
          <select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value as MemoryScope | '')} aria-label="Filter by scope">
            <option value="">Any scope</option>
            {MEMORY_SCOPES.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <select value={clsFilter} onChange={(event) => setClsFilter(event.target.value as MemoryClass | '')} aria-label="Filter by type">
            <option value="">Any type</option>
            {MEMORY_CLASSES.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <input
            value={tagsInput}
            onChange={(event) => setTagsInput(event.target.value)}
            placeholder="Tags (comma separated)"
            aria-label="Filter by tags"
          />
          <label className="check-row" title="Apply the recall-injection contract server-side: exclude flagged records outright and drop records below the 60% confidence floor, so this shows what the agent would actually recall.">
            <input type="checkbox" checked={recall} onChange={(event) => setRecall(event.target.checked)} />
            What the agent would recall
          </label>
          <button className="primary-button" type="submit" disabled={list.isFetching}>
            <Search size={15} aria-hidden="true" />
            {list.isFetching ? 'Searching…' : 'Search'}
          </button>
          <button className="secondary-button" type="button" onClick={resetSearch}>
            Reset
          </button>
        </form>

        <div aria-live="polite" aria-atomic="false">
          {list.isPending && (
            <div className="memory-skeleton-group">
              <SkeletonBlock width="100%" height={36} />
              <SkeletonBlock width="100%" height={36} />
            </div>
          )}
          {/* memoryUnavailable already short-circuits to the whole-view degraded state
              above, so any error reaching here is a different (non-capability) failure. */}
          {list.error && (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Search failed" />
          )}
          {list.data && <MemorySearchHonestyNote result={list.data} limit={appliedFilters.limit} />}
        </div>

        <div className="two-column">
          <AddMemoryForm
            isPending={addMutation.isPending}
            error={addMutation.error}
            onSubmit={(input) => addMutation.mutate(input)}
          />
          <section className="panel" aria-label="Review queue">
            <div className="panel-title">
              <h2>Review Queue</h2>
            </div>
            <ReviewQueuePanel
              records={reviewQueue.data?.records ?? []}
              isPending={reviewQueue.isPending}
              error={reviewQueue.error}
              onRetry={() => void reviewQueue.refetch()}
              savingId={updateReviewMutation.isPending ? updateReviewMutation.variables.id : null}
              onSave={(id, input) => updateReviewMutation.mutate({ id, input })}
            />
            {updateReviewMutation.error && (
              <ErrorState error={updateReviewMutation.error} title="Could not save the review" />
            )}
          </section>
        </div>

        <div className="two-column">
          <section className="panel memory-record-panel" aria-label="Memory records">
            <h2>Records</h2>
            {!list.isPending && !list.error && (
              list.data.records.length === 0
                ? (
                  <EmptyState
                    icon={<Database size={24} />}
                    title="No memory recorded yet"
                    description="Add a memory above, or broaden your search filters."
                  />
                )
                : (
                  <div className="memory-record-panel__list">
                    {list.data.records.map((record) => (
                      <MemoryRecordRow
                        key={record.id}
                        record={record}
                        onOpen={openDetail}
                        onDelete={requestDelete}
                        deleting={deleteMutation.isPending && deleteMutation.variables.id === record.id}
                      />
                    ))}
                  </div>
                )
            )}
            {deleteMutation.error && (
              <ErrorState error={deleteMutation.error} title="Delete failed" />
            )}
          </section>

          <section className="panel memory-record-panel" aria-label="Personas">
            <div className="panel-title">
              <h2>Personas</h2>
              <Users size={18} aria-hidden="true" />
            </div>
            {personas.isPending && (
              <div className="memory-skeleton-group">
                <SkeletonBlock width="100%" height={36} />
              </div>
            )}
            {personas.error && !isMethodUnavailableError(personas.error) && (
              <ErrorState error={personas.error} onRetry={() => void personas.refetch()} title="Personas unavailable" />
            )}
            {!personas.isPending && !personas.error && (
              personaRecords.length === 0
                ? (
                  <EmptyState
                    icon={<Users size={24} />}
                    title="No persona records"
                    description="VIBE.md persona/preference lines appear here once imported as memory records."
                  />
                )
                : (
                  <div className="memory-record-panel__list">
                    {personaRecords.map((record) => (
                      <MemoryRecordRow
                        key={record.id}
                        record={record}
                        onOpen={openDetail}
                        onDelete={requestDelete}
                        deleting={deleteMutation.isPending && deleteMutation.variables.id === record.id}
                      />
                    ))}
                  </div>
                )
            )}
          </section>
        </div>
      </div>
    </ErrorBoundary>
  );
}
