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

function normalizeModel(model: unknown): ModelOption | null {
  if (typeof model === 'string') {
    const id = model.trim();
    return id ? { id, label: id, value: model } : null;
  }

  const id = bestId(model) || firstString(model, ['model', 'modelName', 'value']);
  if (!id) return null;
  return {
    id,
    label: bestTitle(model, id),
    value: model,
  };
}

function appendUnique(target: ModelOption[], model: ModelOption | null) {
  if (!model) return;
  if (target.some((item) => item.id === model.id)) return;
  target.push(model);
}

export function modelOptionsFromProvider(provider: unknown): ModelOption[] {
  const models: ModelOption[] = [];
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
      appendUnique(models, normalizeModel(model));
    }
  }

  const defaultModel = readPath(provider, ['runtime', 'models', 'defaultModel']);
  appendUnique(models, normalizeModel(defaultModel));

  const record = asRecord(provider);
  appendUnique(models, normalizeModel(record.defaultModel));

  return models;
}
