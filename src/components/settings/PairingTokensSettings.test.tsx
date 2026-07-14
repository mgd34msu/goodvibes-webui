/**
 * PairingTokensSettings — list/rename/revoke per-device tokens, plus the
 * migrate-this-browser and revoke-shared-token affordances, each gated by the
 * real ConfirmSheet (never a bare click-to-destroy).
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../lib/toast';
import { ToastViewport } from '../toast/ToastViewport';

const listCalls: unknown[] = [];
const renameCalls: unknown[] = [];
const deleteCalls: unknown[] = [];
const migrateCalls: unknown[] = [];
const revokeSharedCalls: unknown[] = [];
const setExplicitAuthTokenCalls: string[] = [];

let listData: { tokens: { id: string; name: string; createdAt: number; lastSeenAt?: number }[]; legacySharedRevoked: boolean } = {
  tokens: [
    { id: 'tok-1', name: 'Phone', createdAt: 1_700_000_000_000, lastSeenAt: 1_700_100_000_000 },
    { id: 'tok-2', name: 'Laptop', createdAt: 1_700_000_500_000 },
  ],
  legacySharedRevoked: false,
};

mock.module('../../lib/goodvibes', () => ({
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  setExplicitAuthToken: (token: string) => {
    setExplicitAuthTokenCalls.push(token);
    return Promise.resolve({ authenticated: true });
  },
  sdk: {
    operator: {
      pairing: {
        tokens: {
          list: () => {
            listCalls.push(null);
            return Promise.resolve(listData);
          },
          rename: (id: string, name: string) => {
            renameCalls.push({ id, name });
            return Promise.resolve({ id, renamed: true });
          },
          delete: (id: string) => {
            deleteCalls.push(id);
            return Promise.resolve({ id, revoked: true });
          },
          migrate: (name: string) => {
            migrateCalls.push(name);
            return Promise.resolve({ token: { id: 'tok-new', name, token: 'raw-new-token', createdAt: Date.now() } });
          },
          revokeShared: () => {
            revokeSharedCalls.push(null);
            return Promise.resolve({ legacySharedRevoked: true });
          },
        },
      },
    },
  },
}));

const { PairingTokensSettings } = await import('./PairingTokensSettings');

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
        React.createElement(
          ToastProvider,
          null,
          React.createElement(PairingTokensSettings),
          React.createElement(ToastViewport),
        ),
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

function click(el: Element | null | undefined): void {
  flushSync(() => {
    el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
    flushSync(() => {});
  }
}

afterEach(() => {
  listCalls.length = 0;
  renameCalls.length = 0;
  deleteCalls.length = 0;
  migrateCalls.length = 0;
  revokeSharedCalls.length = 0;
  setExplicitAuthTokenCalls.length = 0;
  listData = {
    tokens: [
      { id: 'tok-1', name: 'Phone', createdAt: 1_700_000_000_000, lastSeenAt: 1_700_100_000_000 },
      { id: 'tok-2', name: 'Laptop', createdAt: 1_700_000_500_000 },
    ],
    legacySharedRevoked: false,
  };
});

describe('PairingTokensSettings rendering', () => {
  test('lists every device by name, with created/last-seen, never a secret', async () => {
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('Phone'));
    const text = el.textContent ?? '';
    expect(text).toContain('Phone');
    expect(text).toContain('Laptop');
    expect(text).toContain('last seen');
    expect(text).toContain('never seen'); // Laptop has no lastSeenAt
    expect(text).not.toContain('raw-new-token');
    unmount();
  });

  test('an empty list renders the honest empty state', async () => {
    listData = { tokens: [], legacySharedRevoked: false };
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('No per-device tokens yet'));
    unmount();
  });

  test('legacySharedRevoked hides the migrate/revoke-shared affordances', async () => {
    listData = { ...listData, legacySharedRevoked: true };
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('has been revoked'));
    expect(el.textContent).not.toContain('Give this browser its own token');
    expect(el.textContent).not.toContain('Revoke the shared token');
    unmount();
  });
});

describe('PairingTokensSettings rename', () => {
  test('renames a device inline', async () => {
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('Phone'));
    click(el.querySelector('[aria-label="Rename Phone"]'));
    const input = el.querySelector('input#pairing-token-rename-tok-1') as HTMLInputElement;
    expect(input).not.toBeNull();
    flushSync(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'My Phone');
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    const form = input.closest('form');
    flushSync(() => {
      form?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });
    await waitFor(() => renameCalls.length > 0);
    expect(renameCalls[0]).toEqual({ id: 'tok-1', name: 'My Phone' });
    unmount();
  });
});

describe('PairingTokensSettings revoke — confirm gate', () => {
  test('cancelling the confirm sheet does not revoke', async () => {
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('Phone'));
    const row = [...el.querySelectorAll('.pairing-token-row')].find((r) => r.textContent?.includes('Phone'));
    click(row?.querySelector('.pairing-token-row__revoke'));
    await waitFor(() => Boolean(el.querySelector('.confirm-sheet')));
    click(el.querySelector('.confirm-sheet__cancel'));
    await new Promise((r) => setTimeout(r, 20));
    expect(deleteCalls).toHaveLength(0);
    unmount();
  });

  test('confirming revokes exactly the clicked device', async () => {
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('Phone'));
    const row = [...el.querySelectorAll('.pairing-token-row')].find((r) => r.textContent?.includes('Phone'));
    click(row?.querySelector('.pairing-token-row__revoke'));
    await waitFor(() => Boolean(el.querySelector('.confirm-sheet')));
    click(el.querySelector('.confirm-sheet__confirm'));
    await waitFor(() => deleteCalls.length > 0);
    expect(deleteCalls).toEqual(['tok-1']);
    unmount();
  });
});

describe('PairingTokensSettings migrate + revoke-shared', () => {
  test('migrate mints a token for this browser and swaps the stored auth token', async () => {
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('Give this browser its own token'));
    click([...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Give this browser its own token')));
    await waitFor(() => Boolean(el.querySelector('.confirm-sheet')));
    click(el.querySelector('.confirm-sheet__confirm'));
    await waitFor(() => migrateCalls.length > 0);
    expect(migrateCalls[0]).toBe('This browser');
    await waitFor(() => setExplicitAuthTokenCalls.length > 0);
    expect(setExplicitAuthTokenCalls[0]).toBe('raw-new-token');
    unmount();
  });

  test('revoke-shared requires confirming a danger dialog', async () => {
    const { el, unmount } = render();
    await waitFor(() => (el.textContent ?? '').includes('Revoke the shared token'));
    click([...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Revoke the shared token')));
    await waitFor(() => Boolean(el.querySelector('.confirm-sheet')));
    // A destructive action reads as danger-toned in the sheet.
    expect(el.querySelector('.confirm-sheet')?.className).toContain('danger');
    click(el.querySelector('.confirm-sheet__confirm'));
    await waitFor(() => revokeSharedCalls.length > 0);
    unmount();
  });
});
