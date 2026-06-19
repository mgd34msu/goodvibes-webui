import { useCallback, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Cpu, ExternalLink, Route } from 'lucide-react';
import { sdk } from '../lib/goodvibes';
import { queryKeys } from '../lib/queries';
import { DataBlock } from '../components/DataBlock';
import { RecordList } from '../components/RecordList';
import { StatusBadge } from '../components/StatusBadge';
import { asRecord, bestId, bestTitle, firstString, readPath } from '../lib/object';
import { modelOptionsForProvider, providerOptionsFromResponse } from '../lib/provider-models';
import { formatError } from '../lib/errors';
import { EmptyState } from '../components/feedback/EmptyState';
import { ErrorState } from '../components/feedback/ErrorState';
import { SkeletonBlock } from '../components/feedback/SkeletonBlock';
import ErrorBoundary from '../components/feedback/ErrorBoundary';
import { useToast } from '../lib/toast';
import { usePeek } from '../components/peek/PeekPanel';
import '../styles/components/providers.css';

export function ProvidersView() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { open: openPeek } = usePeek();
  const [selectedProviderId, setSelectedProviderId] = useState('');
  // aria-live announcement text
  const [liveMessage, setLiveMessage] = useState('');

  const providers = useQuery({
    queryKey: queryKeys.providers,
    queryFn: () => sdk.operator.providers.list(),
  });
  const modelCatalog = useQuery({
    queryKey: ['models'],
    queryFn: () => sdk.operator.models.list(),
  });
  const currentModel = useQuery({
    queryKey: ['models', 'current'],
    queryFn: () => sdk.operator.models.current(),
  });
  const accounts = useQuery({
    queryKey: queryKeys.accounts,
    queryFn: () => sdk.operator.accounts.snapshot(),
  });

  const catalogProviderOptions = useMemo(
    () => providerOptionsFromResponse(modelCatalog.data),
    [modelCatalog.data],
  );
  const providerOptions = useMemo(() => {
    const byId = new Map<string, ReturnType<typeof providerOptionsFromResponse>[number]>();
    for (const provider of providerOptionsFromResponse(providers.data)) byId.set(provider.id, provider);
    for (const provider of catalogProviderOptions) {
      const existing = byId.get(provider.id);
      byId.set(
        provider.id,
        existing
          ? { ...existing, value: { ...asRecord(existing.value), ...asRecord(provider.value) } }
          : provider,
      );
    }
    return [...byId.values()];
  }, [catalogProviderOptions, providers.data]);

  const modelProviders = useMemo(
    () => catalogProviderOptions.map((provider) => provider.value),
    [catalogProviderOptions],
  );
  const providerList = useMemo(
    () => providerOptions.map((provider) => provider.value),
    [providerOptions],
  );
  const selectedProvider = useMemo(() => {
    if (!selectedProviderId) return providerList[0];
    return providerList.find((provider) => bestId(provider) === selectedProviderId) ?? providerList[0];
  }, [providerList, selectedProviderId]);
  const selectedId = bestId(selectedProvider);
  const selectedProviderSnapshot = useMemo(
    () => providerOptions.find((provider) => provider.id === selectedId)?.value,
    [providerOptions, selectedId],
  );

  const providerDetail = useQuery({
    queryKey: ['providers', selectedId],
    enabled: Boolean(selectedId),
    queryFn: () => sdk.operator.providers.get(selectedId),
  });

  const usage = useQuery({
    queryKey: ['providers', selectedId, 'usage'],
    enabled: Boolean(selectedId),
    queryFn: () => sdk.operator.providers.usage(selectedId),
  });

  const selectedProviderRecord = asRecord(selectedProvider);
  const selectedProviderConfigured =
    selectedProviderRecord.configured === true ||
    firstString(selectedProvider, ['configuredVia']).length > 0;
  const configuredVia = firstString(selectedProvider, ['configuredVia']);
  const selectedProviderDetail = providerDetail.data ?? selectedProviderSnapshot ?? selectedProvider;
  const models = modelOptionsForProvider(selectedProvider, modelProviders);
  const currentModelRecord = asRecord(readPath(currentModel.data, ['model']));
  const catalogCurrentModel = asRecord(readPath(modelCatalog.data, ['currentModel']));
  const currentRegistryKey =
    firstString(currentModelRecord, ['registryKey']) || firstString(catalogCurrentModel, ['registryKey']);
  const currentProvider =
    firstString(currentModelRecord, ['provider']) || firstString(catalogCurrentModel, ['provider']);
  const currentModelId =
    firstString(currentModelRecord, ['id']) || firstString(catalogCurrentModel, ['id']);

  const selectModel = useMutation({
    mutationFn: (registryKey: string) => sdk.operator.models.select(registryKey),
    onSuccess: async (_data, registryKey) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['models'] }),
        queryClient.invalidateQueries({ queryKey: ['models', 'current'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
      ]);
      const label = registryKey.split(':').slice(1).join(':') || registryKey;
      toast({ title: 'Model changed', description: label, tone: 'success' });
      setLiveMessage(`Model changed to ${label}`);
    },
    onError: (error: unknown) => {
      toast({
        title: 'Failed to select model',
        description: formatError(error),
        tone: 'danger',
      });
    },
  });

  // ── Keyboard navigation for provider list ───────────────────────────────────
  const providerListRef = useRef<HTMLDivElement>(null);

  const handleProviderKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const rows = Array.from(
        providerListRef.current?.querySelectorAll<HTMLButtonElement>('.record-row') ?? [],
      );
      if (!rows.length) return;
      const currentIndex = rows.findIndex((el) => el === document.activeElement);
      let nextIndex = currentIndex;
      if (event.key === 'ArrowDown') nextIndex = Math.min(currentIndex + 1, rows.length - 1);
      else if (event.key === 'ArrowUp') nextIndex = Math.max(currentIndex - 1, 0);
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = rows.length - 1;
      rows[nextIndex]?.focus();
    },
    [],
  );

  // ── Peek handler ─────────────────────────────────────────────────────────────
  const handleOpenPeek = useCallback(() => {
    const title = bestTitle(selectedProvider, selectedId || 'Provider');
    openPeek({
      title,
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <DataBlock title="Provider Runtime" value={selectedProviderDetail} />
          <DataBlock title="Usage" value={usage.data} />
        </div>
      ),
    });
  }, [openPeek, selectedProvider, selectedId, selectedProviderDetail, usage.data]);

  // ── Loading skeleton for provider list ──────────────────────────────────────
  // Show skeleton while EITHER query is loading and no data has resolved yet.
  const isLoadingProviders = (providers.isLoading || modelCatalog.isLoading) && providerList.length === 0;

  return (
    <div className="split-layout">
      {/* aria-live region for selection announcements */}
      <div
        className="providers-live-region"
        aria-live="polite"
        aria-atomic="true"
        role="status"
      >
        {liveMessage}
      </div>

      <aside className="side-panel" aria-label="Providers">
        <div className="panel-title">
          <h2>Providers</h2>
          <Cpu size={18} aria-hidden="true" />
        </div>

        {providers.isError ? (
          <ErrorState
            error={providers.error}
            title="Failed to load providers"
            onRetry={() => {
              void providers.refetch();
              void modelCatalog.refetch();
            }}
          />
        ) : isLoadingProviders ? (
          <div className="providers-skeleton-list" aria-label="Loading providers" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonBlock key={i} variant="block" height={36} />
            ))}
          </div>
        ) : providerList.length === 0 ? (
          <EmptyState
            icon={<Cpu size={28} aria-hidden="true" />}
            title="No providers"
            description="No providers are registered with the daemon."
          />
        ) : (
          <div
            ref={providerListRef}
            className="providers-record-list"
            role="group"
            aria-label="Providers"
            onKeyDown={handleProviderKeyDown}
          >
            <RecordList
              items={providerList}
              selectedId={selectedId}
              onSelect={setSelectedProviderId}
              empty="No providers"
            />
          </div>
        )}
      </aside>

      <ErrorBoundary
        fallback={(err, reset) => (
          <ErrorState
            error={err}
            title="Provider view error"
            onRetry={reset}
            className="stack"
          />
        )}
      >
        <section className="stack" aria-label={selectedId ? bestTitle(selectedProvider, selectedId) : 'Provider detail'}>
          <div className="detail-header">
            <div>
              {/* Peek trigger on provider title */}
              <button
                type="button"
                className="providers-peek-trigger"
                onClick={handleOpenPeek}
                aria-label={`Open details for ${bestTitle(selectedProvider, selectedId || 'Provider')}`}
                disabled={!selectedId}
              >
                <h2>{bestTitle(selectedProvider, selectedId || 'Provider')}</h2>
                {selectedId && <ExternalLink size={14} aria-hidden="true" />}
              </button>
              <span>{selectedId || 'No provider selected'}</span>
            </div>
            <StatusBadge
              value={selectedProviderConfigured ? (configuredVia || 'configured') : 'not configured'}
            />
          </div>

          {/* Current model panel */}
          <section className="panel" aria-label="Current model">
            <div className="panel-title">
              <h2>Current Model</h2>
              <Route size={18} aria-hidden="true" />
            </div>

            {currentModel.isLoading ? (
              <div
                className="providers-current-model"
                aria-label="Loading current model"
                aria-busy="true"
              >
                <div className="providers-current-model__copy">
                  <SkeletonBlock variant="block" height={18} width={180} />
                  <SkeletonBlock variant="block" height={14} width={120} />
                </div>
              </div>
            ) : currentModel.isError ? (
              <ErrorState
                error={currentModel.error}
                title="Failed to load current model"
                onRetry={() => void currentModel.refetch()}
              />
            ) : (
              <div className="providers-current-model">
                <div className="providers-current-model__copy">
                  <strong>{currentModelId || 'No model selected'}</strong>
                  <span>{currentRegistryKey || 'Daemon default is not configured'}</span>
                </div>
                <StatusBadge value={currentProvider || 'unknown'} />
              </div>
            )}
          </section>

          {/* Models panel */}
          <section className="panel" aria-label="Models for selected provider">
            <div className="panel-title">
              <h2>Models</h2>
              <Route size={18} aria-hidden="true" />
            </div>

            {selectModel.isError && (
              <ErrorState
                error={selectModel.error}
                title="Model selection failed"
              />
            )}

            {modelCatalog.isError ? (
              <ErrorState
                error={modelCatalog.error}
                title="Failed to load models"
                onRetry={() => void modelCatalog.refetch()}
              />
            ) : modelCatalog.isLoading ? (
              <div
                className="providers-skeleton-grid"
                aria-label="Loading models"
                aria-busy="true"
              >
                {Array.from({ length: 3 }, (_, i) => (
                  <SkeletonBlock key={i} variant="block" height={54} />
                ))}
              </div>
            ) : models.length === 0 ? (
              <EmptyState
                icon={<Route size={24} aria-hidden="true" />}
                title="No models"
                description="No models reported for this provider."
              />
            ) : (
              <div
                className="providers-model-grid"
                role="list"
                aria-label="Available models"
              >
                {models.map((model) => {
                  const isCurrent = model.registryKey === currentRegistryKey;
                  return (
                    <article
                      key={model.id}
                      className={`providers-model-row${isCurrent ? ' providers-model-row--current' : ''}`}
                      role="listitem"
                      aria-label={`${model.label}${isCurrent ? ', currently selected' : ''}`}
                    >
                      {/* Non-color current indicator: Check icon */}
                      <div
                        className={`providers-model-row__current-icon${isCurrent ? '' : ' providers-model-row__current-icon--hidden'}`}
                        aria-hidden="true"
                      >
                        <Check size={16} />
                      </div>
                      <div className="providers-model-row__copy">
                        <strong>{model.label}</strong>
                        <span>{model.registryKey}</span>
                      </div>
                      <StatusBadge
                        value={
                          isCurrent
                            ? 'current'
                            : firstString(model.value, ['status', 'state', 'availability']) || 'available'
                        }
                      />
                      <div className="providers-model-row__actions">
                        <button
                          type="button"
                          className={isCurrent ? 'secondary-button' : 'primary-button'}
                          disabled={isCurrent || selectModel.isPending}
                          aria-pressed={isCurrent}
                          aria-label={
                            isCurrent
                              ? `${model.label} is the current model`
                              : `Use ${model.label}`
                          }
                          onClick={() => selectModel.mutate(model.registryKey)}
                        >
                          {isCurrent ? <Check size={16} aria-hidden="true" /> : null}
                          {isCurrent ? 'Current' : 'Use'}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <div className="two-column">
            <DataBlock title="Provider Runtime" value={selectedProviderDetail} />
            <DataBlock title="Usage" value={usage.data} />
          </div>

          <DataBlock title="Account Snapshot" value={accounts.data} />
        </section>
      </ErrorBoundary>
    </div>
  );
}
