/**
 * PriceSourceNote — the price provenance line on dollar displays.
 * Pins: manual entry → "your price" with an Edit action; provider-level
 * pricingSource → "provider-served price"/"catalog price" (no fabricated
 * as-of date — the wire serves none); nothing truthful → "price source
 * unknown"; and the one-action Set price path opening the manual editor
 * seeded with this display's provider:model.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../lib/toast';

let configFixture: Record<string, unknown> = {};
let pricingSource = 'catalog';

mock.module('../../lib/goodvibes', () => ({
  // lib/queries.ts (transitively imported) needs these named exports too.
  getCurrentAuth: () => null,
  invokeMethod: () => Promise.resolve({}),
  sdk: {
    operator: {
      config: {
        get: () => Promise.resolve(configFixture),
        set: () => Promise.resolve({}),
      },
      providers: {
        usage: () => Promise.resolve({ providerId: 'openrouter', active: true, pricingSource, models: [], usage: {} }),
      },
    },
  },
}));

const { PriceSourceNote } = await import('./PriceSourceNote');

function render(props: { provider?: string; model?: string; priced: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(ToastProvider, null, React.createElement(PriceSourceNote, props)),
      ),
    );
  });
  return {
    el: container,
    unmount: () => {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    flushSync(() => {});
  }
}

afterEach(() => {
  configFixture = {};
  pricingSource = 'catalog';
});

describe('PriceSourceNote', () => {
  test('a manual entry labels the dollars "your price" and offers Edit', async () => {
    configFixture = { pricing: { modelPrices: { 'openrouter:deepseek/deepseek-chat': { input: 0.14, output: 0.28 } } } };
    const { el, unmount } = render({ provider: 'openrouter', model: 'deepseek/deepseek-chat', priced: true });
    await settle();
    expect(el.querySelector('.price-source-note__label')?.textContent).toBe('your price');
    expect(el.querySelector('.price-source-note__edit')?.textContent).toBe('Edit price');
    unmount();
  });

  test('no manual entry falls to the provider-level source — catalog, with no fabricated date', async () => {
    pricingSource = 'catalog';
    const { el, unmount } = render({ provider: 'openrouter', model: 'deepseek/deepseek-chat', priced: true });
    await settle();
    const label = el.querySelector('.price-source-note__label')?.textContent;
    expect(label).toBe('catalog price');
    expect(label).not.toMatch(/\d{4}/);
    expect(el.querySelector('.price-source-note__edit')?.textContent).toBe('Set price');
    unmount();
  });

  test('provider-served source labels as such', async () => {
    pricingSource = 'provider';
    const { el, unmount } = render({ provider: 'openrouter', model: 'x', priced: true });
    await settle();
    expect(el.querySelector('.price-source-note__label')?.textContent).toBe('provider-served price');
    unmount();
  });

  test('a priced display with no provider identity admits the source is unknown', async () => {
    const { el, unmount } = render({ priced: true });
    await settle();
    expect(el.querySelector('.price-source-note__label')?.textContent).toBe('price source unknown');
    unmount();
  });

  test('an unpriced display shows no source claim, only the Set price action', async () => {
    const { el, unmount } = render({ provider: 'openrouter', model: 'x', priced: false });
    await settle();
    expect(el.querySelector('.price-source-note__label')).toBeNull();
    expect(el.querySelector('.price-source-note__edit')?.textContent).toBe('Set price');
    unmount();
  });

  test('Set price opens the manual editor seeded with this provider:model', async () => {
    const { el, unmount } = render({ provider: 'openrouter', model: 'qwen/qwen-2.5', priced: false });
    await settle();
    flushSync(() => {
      el.querySelector('.price-source-note__edit')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await settle();
    const keyInput = document.querySelector('input[aria-label="Model key (provider:model)"]') as HTMLInputElement | null;
    expect(keyInput).not.toBeNull();
    expect(keyInput?.value).toBe('openrouter:qwen/qwen-2.5');
    unmount();
  });
});
