/**
 * CredentialStatusPanel — the credential-status facade's display-site adoption.
 *
 * Proves the three honest outcomes render distinctly and that no secret byte
 * can ever reach the DOM: the panel only ever reads
 * key/configured/usable/source/secure off CredentialStatusEntry, a type that
 * carries no value field by construction (see provider-status.ts).
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Module mock — mutable per-test credentials.get implementation
// ---------------------------------------------------------------------------

let _credentialsGet: () => Promise<unknown> = () => Promise.resolve({ available: true, credentials: [] });

mock.module('../lib/goodvibes', () => ({
  sdk: {
    operator: {
      credentials: {
        get: () => _credentialsGet(),
      },
    },
  },
}));

const { CredentialStatusPanel } = await import('./CredentialStatusPanel');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function render(selectedProviderId?: string): { el: HTMLElement; unmount: () => void } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(CredentialStatusPanel, { selectedProviderId }),
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

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
    flushSync(() => {});
  }
}

function rejection(status: number, body: unknown): Promise<never> {
  return Promise.reject(
    Object.assign(new Error(`GET /config/credentials failed: ${status}`), { status, body }),
  );
}

afterEach(() => {
  _credentialsGet = () => Promise.resolve({ available: true, credentials: [] });
});

// ---------------------------------------------------------------------------
// AVAILABLE — configured/usable, configured-but-unusable, and unconfigured
// ---------------------------------------------------------------------------

describe('CredentialStatusPanel — available (credentials.get resolves)', () => {
  test('a configured+usable credential reads "usable", not a fabricated "ok"/"healthy"', async () => {
    _credentialsGet = () =>
      Promise.resolve({
        available: true,
        credentials: [{ key: 'ANTHROPIC_API_KEY', configured: true, usable: true, source: 'env', secure: true }],
      });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('ANTHROPIC_API_KEY'));
    expect(el.textContent).toContain('usable');
    expect(el.textContent).toContain('env');
    unmount();
  });

  test('a configured-but-unusable credential shows the honest degraded label, distinct from "usable"', async () => {
    _credentialsGet = () =>
      Promise.resolve({
        available: true,
        credentials: [{ key: 'BROKEN_ENV_REF', configured: true, usable: false, source: 'env-ref' }],
      });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('BROKEN_ENV_REF'));
    expect(el.textContent).toContain('configured, not usable');
    // Never rendered as plain "usable" or a fabricated "ok".
    expect(el.querySelector('.badge.ok')).toBeNull();
    unmount();
  });

  test('an unconfigured credential reads "not configured"', async () => {
    _credentialsGet = () =>
      Promise.resolve({
        available: true,
        credentials: [{ key: 'GOOGLE_API_KEY', configured: false, usable: false }],
      });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('GOOGLE_API_KEY'));
    expect(el.textContent).toContain('not configured');
    unmount();
  });

  test('an empty credential list renders the honest empty state, not a degraded banner', async () => {
    _credentialsGet = () => Promise.resolve({ available: true, credentials: [] });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('No credentials'));
    expect(el.querySelector('.credential-status__degraded')).toBeNull();
    unmount();
  });

  test('a credential key matching the selected provider id is highlighted, a non-matching one is not', async () => {
    _credentialsGet = () =>
      Promise.resolve({
        available: true,
        credentials: [
          { key: 'ANTHROPIC_API_KEY', configured: true, usable: true, source: 'env' },
          { key: 'OPENAI_API_KEY', configured: true, usable: true, source: 'env' },
        ],
      });
    const { el, unmount } = render('anthropic');
    await waitFor(() => (el.textContent ?? '').includes('ANTHROPIC_API_KEY'));
    const rows = [...el.querySelectorAll('.providers-model-row')];
    const anthropicRow = rows.find((r) => r.textContent?.includes('ANTHROPIC_API_KEY'));
    const openaiRow = rows.find((r) => r.textContent?.includes('OPENAI_API_KEY'));
    expect(anthropicRow?.className).toContain('providers-model-row--current');
    expect(openaiRow?.className).not.toContain('providers-model-row--current');
    unmount();
  });
});

// ---------------------------------------------------------------------------
// DEGRADED — the facade's honest unavailable states, never fabricated-configured
// ---------------------------------------------------------------------------

describe('CredentialStatusPanel — degraded (store unavailable / older daemon / transport failure)', () => {
  test('a 503 CREDENTIAL_STORE_UNAVAILABLE shows the facade\'s own reason text', async () => {
    _credentialsGet = () => rejection(503, { error: 'Shared credential store unavailable', code: 'CREDENTIAL_STORE_UNAVAILABLE' });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('Credential status unavailable'));
    expect(el.textContent).toContain('The daemon has no shared credential store wired.');
    // Never a fabricated "configured" reading.
    expect(el.textContent).not.toContain('not configured');
    unmount();
  });

  test('METHOD_NOT_FOUND (an older daemon) degrades with the not-served reason', async () => {
    _credentialsGet = () => rejection(404, { error: 'Unknown gateway method', code: 'METHOD_NOT_FOUND' });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('Credential status unavailable'));
    expect(el.textContent).toContain('This daemon does not serve credential status yet.');
    unmount();
  });

  test('a network/transport failure (no status, no code) degrades generically, never silently as "0 credentials"', async () => {
    _credentialsGet = () => Promise.reject(new Error('fetch failed'));
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('Credential status unavailable'));
    expect(el.textContent).toContain('Credential status unavailable right now.');
    expect(el.textContent).not.toContain('No credentials');
    unmount();
  });
});

// ---------------------------------------------------------------------------
// REFUSED — admin-scope refusal, distinct from a broken/unavailable store
// ---------------------------------------------------------------------------

describe('CredentialStatusPanel — refused (non-admin token, 403)', () => {
  test('a 403 "Admin role required" renders the honest refused message, not the generic degraded one', async () => {
    _credentialsGet = () => rejection(403, { error: 'Admin role required' });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('Admin access required'));
    expect(el.textContent).toContain('Sign in with an admin-scoped token to view credential status.');
    // Distinct from the store-unavailable degraded copy — never conflated.
    expect(el.textContent).not.toContain('Credential status unavailable right now.');
    expect(el.textContent).not.toContain('shared credential store');
    unmount();
  });
});

// ---------------------------------------------------------------------------
// SECRET-FREE PIN — the type carries no value field; pin it dynamically too.
// ---------------------------------------------------------------------------

describe('CredentialStatusPanel — no secret bytes can render', () => {
  test('even if a wire response smuggled a `value`/`secret` field, the rendered DOM never contains it', async () => {
    _credentialsGet = () =>
      Promise.resolve({
        available: true,
        credentials: [
          {
            key: 'ANTHROPIC_API_KEY',
            configured: true,
            usable: true,
            source: 'env',
            // A malicious/buggy daemon build could add these — the entry
            // extraction in deriveCredentialAvailability only reads the five
            // known fields, so they must never reach the DOM.
            value: 'sk-ant-super-secret-do-not-render',
            secret: 'sk-ant-super-secret-do-not-render',
          },
        ],
      });
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('ANTHROPIC_API_KEY'));
    expect(el.textContent).not.toContain('sk-ant-super-secret-do-not-render');
    unmount();
  });
});
