import { describe, expect, test } from 'bun:test';
import {
  modelOptionsFromProvider,
  providerOptionsFromResponse,
} from './provider-models';

describe('provider model extraction', () => {
  test('extracts providers from daemon list response', () => {
    const options = providerOptionsFromResponse({
      providers: [
        { providerId: 'openai', label: 'OpenAI' },
        { providerId: 'anthropic' },
      ],
    });

    expect(options.map((option) => option.id)).toEqual(['openai', 'anthropic']);
    expect(options[0].label).toBe('OpenAI');
  });

  test('extracts runtime model strings from provider snapshots', () => {
    const models = modelOptionsFromProvider({
      providerId: 'openai',
      runtime: {
        models: {
          defaultModel: 'gpt-5.2',
          models: ['gpt-5.2', 'gpt-5.2-mini'],
          aliases: ['fast'],
        },
      },
    });

    expect(models.map((model) => model.id)).toEqual(['gpt-5.2', 'gpt-5.2-mini', 'fast']);
  });

  test('deduplicates object and string model ids', () => {
    const models = modelOptionsFromProvider({
      models: ['claude-sonnet-5', { modelId: 'claude-sonnet-5', label: 'Sonnet' }],
    });

    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('claude-sonnet-5');
  });

  test('uses daemon priced model metadata for labels and ids', () => {
    const models = modelOptionsFromProvider({
      providerId: 'openai',
      models: [
        {
          id: 'gpt-5.2',
          registryKey: 'openai:gpt-5.2',
          displayName: 'GPT-5.2',
          selectable: true,
        },
      ],
    });

    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('gpt-5.2');
    expect(models[0].label).toBe('GPT-5.2');
  });
});
