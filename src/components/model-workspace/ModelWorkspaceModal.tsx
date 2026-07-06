/**
 * ModelWorkspaceModal — the multi-target model picker (main/helper/tool/tts/
 * embeddings), search + filter, toward the TUI's Model Workspace standard
 * (src/renderer/model-workspace.ts + src/input/model-picker.ts). Launched from
 * ProvidersView's "Browse Models" button. See src/lib/model-catalog.ts for the
 * full grounding on what's wire-honest here (price filter/group are real,
 * from providers.list()'s tier+pricing; capability filter has no wire data
 * today and renders disabled rather than a silent no-op).
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Search } from 'lucide-react';
import { Modal } from '../modal/Modal';
import { sdk } from '../../lib/goodvibes';
import { formatError } from '../../lib/errors';
import { readPath } from '../../lib/object';
import { useToast } from '../../lib/toast';
import { EmptyState } from '../feedback/EmptyState';
import { ErrorState } from '../feedback/ErrorState';
import { SkeletonBlock } from '../feedback/SkeletonBlock';
import {
  buildTargetEnableEntry,
  buildTargetWriteEntries,
  configuredProviderIdsFromProvidersResponse,
  filterModels,
  groupModels,
  hasAnyCapabilityData,
  hasAnyQualityTierData,
  hasAnyTierData,
  MODEL_TARGETS,
  modelsFromProvidersResponse,
  providerIdsFromProvidersResponse,
  readTargetRouting,
  TARGET_LABELS,
  targetHasNoModelConcept,
  type CategoryFilter,
  type CatalogModel,
  type GroupByMode,
  type ModelTarget,
} from '../../lib/model-catalog';
import '../../styles/components/model-workspace.css';

export interface ModelWorkspaceModalProps {
  open: boolean;
  onClose: () => void;
}

export function ModelWorkspaceModal({ open, onClose }: ModelWorkspaceModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [target, setTarget] = useState<ModelTarget>('main');
  const [query, setQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [groupBy, setGroupBy] = useState<GroupByMode>('provider');
  const [availableOnly, setAvailableOnly] = useState(false);

  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => sdk.operator.providers.list(),
    enabled: open,
  });
  const currentModel = useQuery({
    queryKey: ['models', 'current'],
    queryFn: () => sdk.operator.models.current(),
    enabled: open,
  });
  const config = useQuery({
    queryKey: ['config'],
    queryFn: () => sdk.operator.config.get(),
    enabled: open,
  });

  const allModels = useMemo(() => modelsFromProvidersResponse(providers.data), [providers.data]);
  const providerIds = useMemo(() => providerIdsFromProvidersResponse(providers.data), [providers.data]);
  const configuredProviderIds = useMemo(
    () => configuredProviderIdsFromProvidersResponse(providers.data),
    [providers.data],
  );
  const priceDataAvailable = useMemo(() => hasAnyTierData(allModels), [allModels]);
  const capabilityDataAvailable = useMemo(() => hasAnyCapabilityData(allModels), [allModels]);
  const qualityTierDataAvailable = useMemo(() => hasAnyQualityTierData(allModels), [allModels]);

  const routing = useMemo(
    () => readTargetRouting(target, config.data, readPath(currentModel.data, ['model']) as { registryKey?: string; provider?: string; id?: string } | null),
    [target, config.data, currentModel.data],
  );

  const filtered = useMemo(
    () =>
      filterModels(allModels, {
        query,
        provider: providerFilter || undefined,
        categoryFilter,
        availableOnly,
        configuredProviderIds,
      }),
    [allModels, query, providerFilter, categoryFilter, availableOnly, configuredProviderIds],
  );

  const effectiveGroupBy: GroupByMode = groupBy === 'qualityTier' && !qualityTierDataAvailable ? 'provider' : groupBy;
  const groups = useMemo(() => groupModels(filtered, effectiveGroupBy), [filtered, effectiveGroupBy]);

  const useModel = useMutation({
    mutationFn: async (model: CatalogModel) => {
      if (target === 'main') {
        return sdk.operator.models.select(model.registryKey);
      }
      const entries = buildTargetWriteEntries(target, model.provider, model.id) ?? [];
      // Sequential, not Promise.all: the daemon's /config route accepts one key at a
      // time (see src/lib/goodvibes.ts's config.set comment) — writing several keys
      // for one target (e.g. helper.globalProvider + helper.globalModel + helper.enabled)
      // means several awaited config.set calls in a row.
      for (const [key, value] of entries) {
        await sdk.operator.config.set(key, value);
      }
      return { entries };
    },
    onSuccess: async (_data, model) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['config'] }),
        queryClient.invalidateQueries({ queryKey: ['models'] }),
        queryClient.invalidateQueries({ queryKey: ['providers'] }),
      ]);
      toast({ title: `${TARGET_LABELS[target]} updated`, description: model.label, tone: 'success' });
    },
    onError: (error: unknown) => {
      toast({ title: 'Model selection failed', description: formatError(error), tone: 'danger' });
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: async (enabled: boolean) => {
      const entry = buildTargetEnableEntry(target, enabled);
      if (!entry) return;
      await sdk.operator.config.set(entry[0], entry[1]);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['config'] });
    },
    onError: (error: unknown) => {
      toast({ title: 'Failed to update', description: formatError(error), tone: 'danger' });
    },
  });

  const isLoading = providers.isLoading || (target === 'main' && currentModel.isLoading) || (target !== 'main' && config.isLoading);
  const hasError = providers.isError || (target === 'main' && currentModel.isError) || (target !== 'main' && config.isError);
  const embeddingsMode = targetHasNoModelConcept(target);
  const enableEntry = buildTargetEnableEntry(target, true);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Model Workspace"
      size="lg"
      headerExtra={
        <div className="model-workspace-targets" role="tablist" aria-label="Model routing target">
          {MODEL_TARGETS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={t === target}
              className={t === target ? 'model-workspace-target model-workspace-target--active' : 'model-workspace-target'}
              onClick={() => setTarget(t)}
            >
              {TARGET_LABELS[t]}
            </button>
          ))}
        </div>
      }
    >
      <div className="model-workspace-routing" aria-live="polite">
        {routing.unset ? (
          <span className="model-workspace-routing__note">
            {routing.label}: not configured{routing.configuredNote ? ` — ${routing.configuredNote}` : ''}
          </span>
        ) : (
          <span className="model-workspace-routing__current">
            {routing.label}: <strong>{embeddingsMode ? routing.provider : `${routing.provider}:${routing.model}`}</strong>
            {routing.configuredNote ? ` (${routing.configuredNote})` : ''}
          </span>
        )}
        {enableEntry && (
          <label className="check-row model-workspace-enable-toggle">
            <input
              type="checkbox"
              checked={routing.enabled}
              disabled={toggleEnabled.isPending}
              onChange={(event) => toggleEnabled.mutate(event.target.checked)}
            />
            <span>Enabled</span>
          </label>
        )}
      </div>

      <div className="model-workspace-filters">
        <label className="model-workspace-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search models"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search models"
          />
        </label>

        {!embeddingsMode && (
          <>
            <label className="model-workspace-filter">
              <span>Provider</span>
              <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}>
                <option value="">All</option>
                {providerIds.map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            </label>

            <label className="model-workspace-filter" title={priceDataAvailable ? undefined : 'Not reported by this daemon'}>
              <span>Price</span>
              <select
                value={categoryFilter}
                disabled={!priceDataAvailable}
                onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)}
              >
                <option value="all">All</option>
                <option value="free">Free</option>
                <option value="paid">Paid</option>
                <option value="subscription">Subscription</option>
              </select>
              {!priceDataAvailable && <small className="model-workspace-filter__note">Not reported by this daemon</small>}
            </label>

            <label className="model-workspace-filter" title="Not reported by this daemon">
              <span>Capability</span>
              <select value="none" disabled={!capabilityDataAvailable}>
                <option value="none">None</option>
                <option value="reasoning">Reasoning</option>
                <option value="toolUse">Tool use</option>
                <option value="multimodal">Multimodal</option>
              </select>
              <small className="model-workspace-filter__note">Not reported by this daemon</small>
            </label>

            <label className="model-workspace-filter">
              <span>Group</span>
              <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as GroupByMode)}>
                <option value="provider">Provider</option>
                <option value="family">Family</option>
                <option value="pricingTier">Pricing tier</option>
                <option value="qualityTier" disabled={!qualityTierDataAvailable}>
                  Quality tier{qualityTierDataAvailable ? '' : ' (unavailable)'}
                </option>
              </select>
            </label>

            <label className="check-row model-workspace-available-only">
              <input
                type="checkbox"
                checked={availableOnly}
                onChange={(event) => setAvailableOnly(event.target.checked)}
              />
              <span>Available only</span>
            </label>
          </>
        )}
      </div>

      {isLoading ? (
        <div className="model-workspace-skeleton" aria-label="Loading model workspace" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonBlock key={i} variant="block" height={48} />
          ))}
        </div>
      ) : hasError ? (
        <ErrorState
          error={providers.error ?? currentModel.error ?? config.error}
          title="Failed to load the model workspace"
          onRetry={() => {
            void providers.refetch();
            void currentModel.refetch();
            void config.refetch();
          }}
        />
      ) : embeddingsMode ? (
        providerIds.length === 0 ? (
          <EmptyState title="No providers" description="No providers are registered with the daemon." />
        ) : (
          <div className="providers-model-grid" role="list" aria-label="Embedding providers">
            {providerIds.map((id) => {
              const isCurrent = id === routing.provider;
              return (
                <article key={id} className={isCurrent ? 'providers-model-row providers-model-row--current' : 'providers-model-row'} role="listitem">
                  <div className="providers-model-row__current-icon" aria-hidden="true">
                    {isCurrent && <Check size={16} />}
                  </div>
                  <div className="providers-model-row__copy">
                    <strong>{id}</strong>
                  </div>
                  <div className="providers-model-row__actions">
                    <button
                      type="button"
                      className={isCurrent ? 'secondary-button' : 'primary-button'}
                      disabled={isCurrent || useModel.isPending}
                      onClick={() => useModel.mutate({ id: '', registryKey: '', provider: id, label: id })}
                    >
                      {isCurrent ? 'Current' : 'Use'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )
      ) : filtered.length === 0 ? (
        <EmptyState title="No models" description="No models match the current search/filter." />
      ) : (
        <div className="model-workspace-groups">
          {groups.map((group) => (
            <section key={group.key} className="model-workspace-group" aria-label={group.label}>
              {groups.length > 1 && <h3 className="model-workspace-group__title">{group.label}</h3>}
              <div className="providers-model-grid" role="list" aria-label={`Models in ${group.label}`}>
                {group.models.map((model) => {
                  const isCurrent = model.registryKey === routing.model || (target === 'main' && `${model.provider}:${model.id}` === `${routing.provider}:${routing.model}`);
                  return (
                    <article
                      key={model.registryKey}
                      className={isCurrent ? 'providers-model-row providers-model-row--current' : 'providers-model-row'}
                      role="listitem"
                    >
                      <div className="providers-model-row__current-icon" aria-hidden="true">
                        {isCurrent && <Check size={16} />}
                      </div>
                      <div className="providers-model-row__copy">
                        <strong>{model.label}</strong>
                        <span>{model.registryKey}</span>
                        {(model.tier ?? model.pricing) && (
                          <span className="model-workspace-price">
                            {model.tier ?? ''}
                            {model.pricing
                              ? ` · $${model.pricing.inputPerMillionTokens}/$${model.pricing.outputPerMillionTokens} per M tok`
                              : ''}
                          </span>
                        )}
                      </div>
                      <div className="providers-model-row__actions">
                        <button
                          type="button"
                          className={isCurrent ? 'secondary-button' : 'primary-button'}
                          disabled={isCurrent || useModel.isPending}
                          onClick={() => useModel.mutate(model)}
                        >
                          {isCurrent ? 'Current' : 'Use'}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}
