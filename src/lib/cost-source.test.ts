import { describe, expect, test } from 'bun:test';
import {
  costAmountLabel,
  hasManualPrice,
  manualPriceKey,
  priceSourceLabel,
  unpricedBlindSpotLabel,
} from './cost-source';

describe('manualPriceKey / hasManualPrice', () => {
  const config = {
    pricing: {
      modelPrices: {
        'openrouter:deepseek/deepseek-chat': { input: 0.14, output: 0.28 },
      },
    },
  };

  test('joins provider and model with a colon, null when either is missing', () => {
    expect(manualPriceKey('openrouter', 'deepseek/deepseek-chat')).toBe('openrouter:deepseek/deepseek-chat');
    expect(manualPriceKey(undefined, 'model')).toBeNull();
    expect(manualPriceKey('provider', undefined)).toBeNull();
  });

  test('finds a manual entry only for its exact provider:model', () => {
    expect(hasManualPrice(config, 'openrouter', 'deepseek/deepseek-chat')).toBe(true);
    expect(hasManualPrice(config, 'anthropic', 'deepseek/deepseek-chat')).toBe(false);
    expect(hasManualPrice(config, 'openrouter', 'other-model')).toBe(false);
    expect(hasManualPrice({}, 'openrouter', 'deepseek/deepseek-chat')).toBe(false);
    expect(hasManualPrice(undefined, 'openrouter', 'deepseek/deepseek-chat')).toBe(false);
  });

  test('a malformed manual entry does not count as a price', () => {
    const bad = { pricing: { modelPrices: { 'a:b': { input: -1, output: 2 } } } };
    expect(hasManualPrice(bad, 'a', 'b')).toBe(false);
  });
});

describe('priceSourceLabel', () => {
  test('manual wins as "your price" regardless of provider source', () => {
    expect(priceSourceLabel(true, 'catalog')).toBe('your price');
    expect(priceSourceLabel(true, undefined)).toBe('your price');
  });

  test('provider-level sources label without a fabricated date', () => {
    expect(priceSourceLabel(false, 'provider')).toBe('provider-served price');
    expect(priceSourceLabel(false, 'catalog')).toBe('catalog price');
  });

  test('nothing truthful to say -> null', () => {
    expect(priceSourceLabel(false, 'none')).toBeNull();
    expect(priceSourceLabel(false, undefined)).toBeNull();
  });
});

describe('costAmountLabel', () => {
  test('priced dollars render, sub-dollar with four decimals', () => {
    expect(costAmountLabel(1.5, 'priced')).toBe('$1.50');
    expect(costAmountLabel(0.0032, 'priced')).toBe('$0.0032');
  });

  test('estimated dollars carry the ~ prefix', () => {
    expect(costAmountLabel(2, 'estimated')).toBe('~$2.00');
  });

  test('unpriced is the explicit marker — never $0.00', () => {
    expect(costAmountLabel(null, 'unpriced')).toBe('price unknown');
    expect(costAmountLabel(0.5, 'unpriced')).toBe('price unknown');
    expect(costAmountLabel(null, 'priced')).toBe('price unknown');
    expect(costAmountLabel(undefined, 'priced')).toBe('price unknown');
  });
});

describe('unpricedBlindSpotLabel', () => {
  test('mixed aggregates state the floor', () => {
    expect(unpricedBlindSpotLabel(3, 1)).toBe('1 of 4 records unpriced — dollars shown are a floor');
  });

  test('fully-unpriced aggregates say so', () => {
    expect(unpricedBlindSpotLabel(0, 5)).toBe('all 5 records unpriced');
  });

  test('no blind spot -> empty string', () => {
    expect(unpricedBlindSpotLabel(10, 0)).toBe('');
    expect(unpricedBlindSpotLabel(0, 0)).toBe('');
  });
});
