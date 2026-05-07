import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Cpu, Route } from 'lucide-react';
import { sdk } from '../lib/goodvibes';
import { queryKeys } from '../lib/queries';
import { DataBlock } from '../components/DataBlock';
import { RecordList } from '../components/RecordList';
import { StatusBadge } from '../components/StatusBadge';
import { asRecord, bestId, bestTitle, firstString, readPath } from '../lib/object';
import { modelOptionsForProvider, providerOptionsFromResponse } from '../lib/provider-models';
import { formatError } from '../lib/errors';

export function ProvidersView() {
  const queryClient = useQueryClient();
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const providers = useQuery({ queryKey: queryKeys.providers, queryFn: () => sdk.operator.providers.list() });
  const modelCatalog = useQuery({ queryKey: ['models'], queryFn: () => sdk.operator.models.list() });
  const currentModel = useQuery({ queryKey: ['models', 'current'], queryFn: () => sdk.operator.models.current() });
  const accounts = useQuery({ queryKey: queryKeys.accounts, queryFn: () => sdk.operator.accounts.snapshot() });

  const catalogProviderOptions = useMemo(() => providerOptionsFromResponse(modelCatalog.data), [modelCatalog.data]);
  const providerOptions = useMemo(() => {
    const byId = new Map<string, ReturnType<typeof providerOptionsFromResponse>[number]>();
    for (const provider of providerOptionsFromResponse(providers.data)) byId.set(provider.id, provider);
    for (const provider of catalogProviderOptions) {
      const existing = byId.get(provider.id);
      byId.set(provider.id, existing ? { ...existing, value: { ...asRecord(existing.value), ...asRecord(provider.value) } } : provider);
    }
    return [...byId.values()];
  }, [catalogProviderOptions, providers.data]);
  const modelProviders = useMemo(() => catalogProviderOptions.map((provider) => provider.value), [catalogProviderOptions]);
  const providerList = useMemo(() => providerOptions.map((provider) => provider.value), [providerOptions]);
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
  const selectedProviderConfigured = selectedProviderRecord.configured === true
    || firstString(selectedProvider, ['configuredVia']).length > 0;
  const configuredVia = firstString(selectedProvider, ['configuredVia']);
  const selectedProviderDetail = providerDetail.data ?? selectedProviderSnapshot ?? selectedProvider;
  const models = modelOptionsForProvider(selectedProvider, modelProviders);
  const currentModelRecord = asRecord(readPath(currentModel.data, ['model']));
  const catalogCurrentModel = asRecord(readPath(modelCatalog.data, ['currentModel']));
  const currentRegistryKey = firstString(currentModelRecord, ['registryKey']) || firstString(catalogCurrentModel, ['registryKey']);
  const currentProvider = firstString(currentModelRecord, ['provider']) || firstString(catalogCurrentModel, ['provider']);
  const currentModelId = firstString(currentModelRecord, ['id']) || firstString(catalogCurrentModel, ['id']);

  const selectModel = useMutation({
    mutationFn: (registryKey: string) => sdk.operator.models.select(registryKey),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['models'] }),
        queryClient.invalidateQueries({ queryKey: ['models', 'current'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.providers }),
      ]);
    },
  });

  return (
    <div className="split-layout">
      <aside className="side-panel">
        <div className="panel-title">
          <h2>Providers</h2>
          <Cpu size={18} />
        </div>
        <RecordList
          items={providerList}
          selectedId={selectedId}
          onSelect={setSelectedProviderId}
          empty="No providers"
        />
      </aside>

      <section className="stack">
        <div className="detail-header">
          <div>
            <h2>{bestTitle(selectedProvider, selectedId || 'Provider')}</h2>
            <span>{selectedId || 'No provider selected'}</span>
          </div>
          <StatusBadge value={selectedProviderConfigured ? (configuredVia || 'configured') : 'not configured'} />
        </div>

        <section className="panel">
          <div className="panel-title">
            <h2>Current Model</h2>
            <Route size={18} />
          </div>
          <div className="current-model">
            <div>
              <strong>{currentModelId || 'No model selected'}</strong>
              <span>{currentRegistryKey || 'Daemon default is not configured'}</span>
            </div>
            <StatusBadge value={currentProvider || 'unknown'} />
          </div>
          {currentModel.isError && <div className="composer-error">{formatError(currentModel.error)}</div>}
        </section>

        <section className="panel">
          <div className="panel-title">
            <h2>Models</h2>
            <Route size={18} />
          </div>
          {selectModel.error && <div className="composer-error">{formatError(selectModel.error)}</div>}
          <div className="model-grid">
            {models.map((model) => {
              const isCurrent = model.registryKey === currentRegistryKey;
              return (
                <article key={model.id} className={isCurrent ? 'model-row selected' : 'model-row'}>
                  <div className="model-copy">
                    <strong>{model.label}</strong>
                    <span>{model.registryKey}</span>
                  </div>
                  <StatusBadge value={isCurrent ? 'current' : firstString(model.value, ['status', 'state', 'availability']) || 'available'} />
                  <button
                    type="button"
                    className={isCurrent ? 'secondary-button' : 'primary-button'}
                    disabled={isCurrent || selectModel.isPending}
                    onClick={() => selectModel.mutate(model.registryKey)}
                  >
                    {isCurrent ? <Check size={16} /> : null}
                    {isCurrent ? 'Current' : 'Use'}
                  </button>
                </article>
              );
            })}
            {!models.length && (
              <p className="empty-state">
                {modelCatalog.isLoading ? 'Loading models' : 'No models reported for this provider'}
              </p>
            )}
          </div>
        </section>

        <div className="two-column">
          <DataBlock title="Provider Runtime" value={selectedProviderDetail} />
          <DataBlock title="Usage" value={usage.data} />
        </div>

        <DataBlock title="Account Snapshot" value={accounts.data} />
      </section>
    </div>
  );
}
