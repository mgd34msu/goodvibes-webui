import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cpu, Route } from 'lucide-react';
import { sdk } from '../lib/goodvibes';
import { queryKeys } from '../lib/queries';
import { DataBlock } from '../components/DataBlock';
import { RecordList } from '../components/RecordList';
import { StatusBadge } from '../components/StatusBadge';
import { bestId, bestTitle, firstArray, firstString } from '../lib/object';
import { modelOptionsFromProvider, providerOptionsFromResponse } from '../lib/provider-models';

export function ProvidersView() {
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const providers = useQuery({ queryKey: queryKeys.providers, queryFn: () => sdk.operator.providers.list() });
  const accounts = useQuery({ queryKey: queryKeys.accounts, queryFn: () => sdk.operator.accounts.snapshot() });

  const providerOptions = useMemo(() => providerOptionsFromResponse(providers.data), [providers.data]);
  const providerList = useMemo(() => providerOptions.map((provider) => provider.value), [providerOptions]);
  const selectedProvider = useMemo(() => {
    if (!selectedProviderId) return providerList[0];
    return providerList.find((provider) => bestId(provider) === selectedProviderId) ?? providerList[0];
  }, [providerList, selectedProviderId]);
  const selectedId = bestId(selectedProvider);

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

  const models = modelOptionsFromProvider(providerDetail.data ?? selectedProvider);

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
          <StatusBadge value={firstString(selectedProvider, ['status', 'health', 'authFreshness']) || 'unknown'} />
        </div>

        <div className="two-column">
          <DataBlock title="Provider Snapshot" value={providerDetail.data ?? selectedProvider} />
          <DataBlock title="Usage" value={usage.data} />
        </div>

        <section className="panel">
          <div className="panel-title">
            <h2>Models</h2>
            <Route size={18} />
          </div>
          <div className="model-grid">
            {models.map((model) => {
              const modelId = model.id;
              return (
                <article key={modelId} className="model-row">
                  <strong>{model.label}</strong>
                  <span>{modelId}</span>
                  <StatusBadge value={firstString(model.value, ['status', 'state', 'availability']) || 'available'} />
                </article>
              );
            })}
            {!models.length && <p className="empty-state">No models reported for this provider</p>}
          </div>
        </section>

        <DataBlock title="Account Snapshot" value={accounts.data} />
      </section>
    </div>
  );
}
