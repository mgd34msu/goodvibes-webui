import { asRecord, bestId, bestTitle, firstArrayAtPath, firstString, readPath } from './object';

export interface ProviderOption {
  id: string;
  label: string;
  value: unknown;
}

export interface ModelOption {
  id: string;
  label: string;
  value: unknown;
  providerId: string;
  rawModelId: string;
  registryKey: string;
}

export function providerOptionsFromResponse(value: unknown): ProviderOption[] {
  return firstArrayAtPath(value, [
    ['providers'],
    ['items'],
    ['data'],
    ['result', 'providers'],
    ['result', 'items'],
    ['result', 'data'],
  ])
    .map((provider) => {
      const id = bestId(provider);
      return id ? { id, label: bestTitle(provider, id), value: provider } : null;
    })
    .filter((provider): provider is ProviderOption => provider !== null);
}

function providerQualifiedKey(providerId: string, modelId: string, registryKey: string): string {
  if (registryKey.includes(':')) return registryKey;
  if (modelId.includes(':')) return modelId;
  return providerId && modelId ? `${providerId}:${modelId}` : '';
}

function normalizeModel(providerId: string, model: unknown): ModelOption | null {
  if (typeof model === 'string') {
    const rawModelId = model.trim();
    const registryKey = providerQualifiedKey(providerId, rawModelId, '');
    return registryKey ? { id: registryKey, label: rawModelId, value: model, providerId, rawModelId, registryKey } : null;
  }

  const explicitRegistryKey = firstString(model, ['registryKey', 'key']);
  const rawModelId = firstString(model, ['modelId', 'id', 'model', 'modelName', 'value', 'name'])
    || explicitRegistryKey.split(':').slice(1).join(':');
  const registryKey = providerQualifiedKey(providerId, rawModelId, explicitRegistryKey);
  if (!registryKey || !rawModelId) return null;
  return {
    id: registryKey,
    label: bestTitle(model, rawModelId),
    value: model,
    providerId,
    rawModelId,
    registryKey,
  };
}

function appendUnique(target: ModelOption[], model: ModelOption | null) {
  if (!model) return;
  if (target.some((item) => item.id === model.id)) return;
  target.push(model);
}

export function modelOptionsFromProvider(provider: unknown): ModelOption[] {
  const models: ModelOption[] = [];
  const providerId = bestId(provider);
  for (const path of [
    ['models'],
    ['availableModels'],
    ['modelCatalog'],
    ['catalog', 'models'],
    ['catalog', 'items'],
    ['runtime', 'models', 'models'],
    ['runtime', 'models', 'aliases'],
  ]) {
    for (const model of firstArrayAtPath(provider, [path])) {
      appendUnique(models, normalizeModel(providerId, model));
    }
  }

  const defaultModel = readPath(provider, ['runtime', 'models', 'defaultModel']);
  appendUnique(models, normalizeModel(providerId, defaultModel));

  const record = asRecord(provider);
  appendUnique(models, normalizeModel(providerId, record.defaultModel));

  return models;
}
