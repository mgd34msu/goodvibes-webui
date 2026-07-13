/**
 * PriceSourceNote — the price provenance line on dollar displays, rendered
 * straight from the wire's `costSource` + `pricingAsOf`.
 * Pins: 'user' → "your price" with an Edit action; 'catalog' → "catalog price,
 * as of <date>"; 'provider'/'mixed' → their honest labels; absent → no source
 * claim (only the Set price action); and the one-action Set price path opening
 * the manual editor seeded with this display's provider:model.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../lib/toast';
import type { WireCostSource } from '../../lib/cost-source';

// The note no longer probes the daemon for provenance — the source rides its
// props. The editor modal it can open still imports lib/goodvibes transitively,
// so the module is stubbed to the minimum those imports need.
mock.module('../../lib/goodvibes', () => ({
  getCurrentAuth: () => null,
  invokeMethod: () => Promise.resolve({}),
  sdk: {
    operator: {
      config: {
        get: () => Promise.resolve({}),
        set: () => Promise.resolve({}),
      },
    },
  },
}));

const { PriceSourceNote } = await import('./PriceSourceNote');

function render(props: {
  costSource?: WireCostSource | null;
  pricingAsOf?: string | null;
  provider?: string;
  model?: string;
}) {
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
  document.body.innerHTML = '';
});

describe('PriceSourceNote', () => {
  test('the user tier labels the dollars "your price" and offers Edit', async () => {
    const { el, unmount } = render({ costSource: 'user', provider: 'openrouter', model: 'deepseek/deepseek-chat' });
    await settle();
    expect(el.querySelector('.price-source-note__label')?.textContent).toBe('your price');
    expect(el.querySelector('.price-source-note__edit')?.textContent).toBe('Edit price');
    unmount();
  });

  test('catalog renders the source AND the as-of date the wire served', async () => {
    const { el, unmount } = render({
      costSource: 'catalog',
      pricingAsOf: '2026-07-01T00:00:00.000Z',
      provider: 'openrouter',
      model: 'deepseek/deepseek-chat',
    });
    await settle();
    const label = el.querySelector('.price-source-note__label')?.textContent;
    expect(label).toBe('catalog price, as of Jul 1, 2026');
    expect(label).toMatch(/2026/);
    expect(el.querySelector('.price-source-note__edit')?.textContent).toBe('Set price');
    unmount();
  });

  test('provider-served source labels as such', async () => {
    const { el, unmount } = render({ costSource: 'provider', provider: 'openrouter', model: 'x' });
    await settle();
    expect(el.querySelector('.price-source-note__label')?.textContent).toBe('provider-served price');
    unmount();
  });

  test('a mixed aggregate labels honestly, dated', async () => {
    const { el, unmount } = render({ costSource: 'mixed', pricingAsOf: '2026-07-01T00:00:00.000Z' });
    await settle();
    expect(el.querySelector('.price-source-note__label')?.textContent).toBe('mixed pricing sources, as of Jul 1, 2026');
    unmount();
  });

  test('an absent source makes no claim — only the Set price action', async () => {
    const { el, unmount } = render({ costSource: null, provider: 'openrouter', model: 'x' });
    await settle();
    expect(el.querySelector('.price-source-note__label')).toBeNull();
    expect(el.querySelector('.price-source-note__edit')?.textContent).toBe('Set price');
    unmount();
  });

  test('Set price opens the manual editor seeded with this provider:model', async () => {
    const { el, unmount } = render({ costSource: 'catalog', provider: 'openrouter', model: 'qwen/qwen-2.5' });
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
