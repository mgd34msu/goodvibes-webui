/**
 * ProvidersView — real provider status pills.
 *
 * Proves the pill is derived from the actual per-route freshness the wire
 * returns (ProviderAuthRouteDescriptor.freshness), never a decorative
 * default, and that the header's "configured" text is sourced correctly
 * even when the merged list record lacks a flat `configured` field (the
 * bug this brief fixes — see src/lib/provider-status.ts).
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../lib/toast';
import { PeekProvider } from '../components/peek/PeekPanel';

const getCalls: string[] = [];

// Providers as returned by providers.list()/providers.get() — ProviderRuntimeSnapshot
// shape: routes live nested at runtime.auth.routes, configured at runtime.auth.configured.
const OPENAI_SNAPSHOT = {
  providerId: 'openai',
  active: true,
  modelCount: 1,
  runtime: {
    auth: {
      mode: 'api-key',
      configured: true,
      routes: [{ route: 'api-key', label: 'API Key', configured: true, freshness: 'healthy' }],
    },
  },
  models: [{ id: 'gpt-5', registryKey: 'openai:gpt-5', displayName: 'GPT-5', selectable: true, contextWindow: 200000 }],
};

const ANTHROPIC_SNAPSHOT = {
  providerId: 'anthropic',
  active: false,
  modelCount: 0,
  runtime: {
    auth: {
      mode: 'oauth',
      configured: false,
      routes: [{ route: 'service-oauth', label: 'Service OAuth', configured: false, freshness: 'unconfigured' }],
    },
  },
  models: [],
};

// Present ONLY in providers.list (no models.list catalog match) — the
// merged record has no flat `configured`/`configuredVia`, only the nested
// runtime.auth.configured. Proves the header sources from the real signal.
const MISTRAL_SNAPSHOT = {
  providerId: 'mistral',
  active: true,
  modelCount: 1,
  runtime: {
    auth: {
      mode: 'api-key',
      configured: true,
      routes: [{ route: 'api-key', label: 'API Key', configured: true, freshness: 'healthy' }],
    },
  },
  models: [{ id: 'mistral-large', registryKey: 'mistral:mistral-large', displayName: 'Mistral Large', selectable: true, contextWindow: 128000 }],
};

const AZURE_SNAPSHOT = {
  providerId: 'azure',
  active: true,
  modelCount: 1,
  runtime: {
    auth: {
      mode: 'api-key',
      configured: true,
      routes: [
        { route: 'api-key', label: 'API Key', configured: true, freshness: 'healthy' },
        {
          route: 'secret-ref',
          label: 'Secret Reference',
          configured: true,
          freshness: 'expired',
          detail: 'refresh token expired 2h ago',
          repairHints: ['re-authenticate in the daemon settings'],
        },
      ],
    },
  },
  models: [{ id: 'gpt-5-azure', registryKey: 'azure:gpt-5-azure', displayName: 'GPT-5 (Azure)', selectable: true, contextWindow: 200000 }],
};

const PROVIDERS_LIST_FIXTURE = {
  providers: [OPENAI_SNAPSHOT, ANTHROPIC_SNAPSHOT, MISTRAL_SNAPSHOT, AZURE_SNAPSHOT],
};

// models.list() catalog — ModelRouteProviderRecord shape: flat configured/configuredVia/routes.
// Deliberately omits 'mistral' to simulate the catalog-mismatch bug.
const MODELS_LIST_FIXTURE = {
  providers: [
    {
      id: 'openai',
      label: 'OpenAI',
      configured: true,
      configuredVia: 'env',
      envVars: ['OPENAI_API_KEY'],
      routes: [{ route: 'api-key', label: 'API Key', configured: true, freshness: 'healthy' }],
      models: [{ id: 'gpt-5', registryKey: 'openai:gpt-5', provider: 'openai', label: 'GPT-5' }],
    },
    {
      id: 'anthropic',
      label: 'Anthropic',
      configured: false,
      envVars: [],
      routes: [{ route: 'service-oauth', label: 'Service OAuth', configured: false, freshness: 'unconfigured' }],
      models: [],
    },
    {
      id: 'azure',
      label: 'Azure',
      configured: true,
      configuredVia: 'secrets',
      envVars: [],
      routes: [
        { route: 'api-key', label: 'API Key', configured: true, freshness: 'healthy' },
        { route: 'secret-ref', label: 'Secret Reference', configured: true, freshness: 'expired', detail: 'refresh token expired 2h ago', repairHints: ['re-authenticate in the daemon settings'] },
      ],
      models: [{ id: 'gpt-5-azure', registryKey: 'azure:gpt-5-azure', provider: 'azure', label: 'GPT-5 (Azure)' }],
    },
  ],
  currentModel: { registryKey: 'openai:gpt-5', provider: 'openai', id: 'gpt-5' },
  secretsResolutionSkipped: false,
};

mock.module('../lib/goodvibes', () => ({
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  sdk: {
    operator: {
      providers: {
        list: () => Promise.resolve(PROVIDERS_LIST_FIXTURE),
        get: (providerId: string) => {
          getCalls.push(providerId);
          const byId: Record<string, unknown> = {
            openai: OPENAI_SNAPSHOT,
            anthropic: ANTHROPIC_SNAPSHOT,
            mistral: MISTRAL_SNAPSHOT,
            azure: AZURE_SNAPSHOT,
          };
          return Promise.resolve(byId[providerId] ?? null);
        },
        usage: () => Promise.resolve({ providerId: 'openai', active: true, pricingSource: 'none', models: [], usage: { streaming: true, toolCalling: true, parallelTools: true } }),
      },
      models: {
        list: () => Promise.resolve(MODELS_LIST_FIXTURE),
        current: () => Promise.resolve({ model: { registryKey: 'openai:gpt-5', provider: 'openai', id: 'gpt-5' }, configured: true }),
        select: () => Promise.resolve({}),
      },
      accounts: {
        snapshot: () => Promise.resolve({}),
      },
    },
  },
}));

const { ProvidersView } = await import('./ProvidersView');

function render(): { el: HTMLElement; unmount: () => void } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(ToastProvider, null, React.createElement(PeekProvider, null, React.createElement(ProvidersView))),
      ),
    );
  });
  return {
    el: container,
    unmount: () => {
      flushSync(() => root.unmount());
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

function click(el: Element | null | undefined) {
  flushSync(() => {
    el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
    flushSync(() => {});
  }
}

function rows(el: HTMLElement): Element[] {
  return [...el.querySelectorAll('.record-row')];
}

function rowFor(el: HTMLElement, text: string): Element | undefined {
  return rows(el).find((r) => r.textContent?.includes(text));
}

afterEach(() => {
  getCalls.length = 0;
});

describe('ProvidersView — real per-provider pills (never decorative "unknown")', () => {
  test('a provider with a healthy route shows a "healthy" pill', async () => {
    const { el, unmount } = render();
    await waitFor(() => rows(el).length > 0);
    const row = rowFor(el, 'openai');
    expect(row?.textContent).toContain('healthy');
    expect(row?.textContent).not.toContain('unknown');
    unmount();
  });

  test('a multi-route provider rolls up to the worst freshness — expired beats healthy', async () => {
    const { el, unmount } = render();
    await waitFor(() => rows(el).length > 0);
    const row = rowFor(el, 'azure');
    expect(row?.textContent).toContain('expired');
    unmount();
  });

  test('a provider whose only route is unconfigured shows "unconfigured", distinct from "status unavailable"', async () => {
    const { el, unmount } = render();
    await waitFor(() => rows(el).length > 0);
    const row = rowFor(el, 'anthropic');
    expect(row?.textContent).toContain('unconfigured');
    expect(row?.textContent).not.toContain('status unavailable');
    unmount();
  });
});

describe('ProvidersView — header sourced from the real configured signal', () => {
  test('the default-selected (first) provider header reads "configured via env"', async () => {
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('configured via'));
    expect(el.textContent).toContain('configured via env');
    unmount();
  });

  test('a provider present only in providers.list (no catalog match, no flat `configured`) still reads configured, not "not configured"', async () => {
    const { el, unmount } = render();
    await waitFor(() => rows(el).length > 0);
    click(rowFor(el, 'mistral'));
    await waitFor(() => getCalls.includes('mistral'));
    // mistral's runtime.auth.configured is true but it has no catalog
    // configuredVia — the honest header text is bare "configured".
    await waitFor(() => (el.textContent ?? '').includes('mistral'));
    expect(el.textContent).toContain('configured');
    expect(el.textContent).not.toContain('not configured');
    unmount();
  });

  test('selecting the unconfigured provider reads "not configured" in the header', async () => {
    const { el, unmount } = render();
    await waitFor(() => rows(el).length > 0);
    click(rowFor(el, 'anthropic'));
    await waitFor(() => getCalls.includes('anthropic'));
    await waitFor(() => (el.textContent ?? '').includes('not configured'));
    expect(el.textContent).toContain('not configured');
    unmount();
  });
});

describe('ProvidersView — per-route detail on selection', () => {
  test('selecting a provider with an expired route shows its detail and repair hints', async () => {
    const { el, unmount } = render();
    await waitFor(() => rows(el).length > 0);
    click(rowFor(el, 'azure'));
    await waitFor(() => getCalls.includes('azure'));
    await waitFor(() => (el.textContent ?? '').includes('refresh token expired 2h ago'));
    expect(el.textContent).toContain('refresh token expired 2h ago');
    expect(el.textContent).toContain('re-authenticate in the daemon settings');
    unmount();
  });
});
