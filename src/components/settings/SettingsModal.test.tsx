import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../lib/toast';

type ConfigOutcome = 'ok' | 'admin-required' | 'network-error';
let outcome: ConfigOutcome = 'ok';
const configSetCalls: [string, unknown][] = [];

const CONFIG_FIXTURE = {
  display: { theme: 'vaporwave' },
  helper: { enabled: false, globalProvider: '', globalModel: '' },
  surfaces: { slack: { botToken: 'xoxb-super-secret-value-1234' } },
};

mock.module('../../lib/goodvibes', () => ({
  sdk: {
    operator: {
      config: {
        get: () => {
          if (outcome === 'admin-required') {
            const err = new Error('Admin role required') as Error & { status?: number };
            err.status = 403;
            return Promise.reject(err);
          }
          if (outcome === 'network-error') {
            return Promise.reject(new Error('Failed to fetch'));
          }
          return Promise.resolve(CONFIG_FIXTURE);
        },
        set: (key: string, value: unknown) => {
          configSetCalls.push([key, value]);
          return Promise.resolve({ success: true, key, value });
        },
      },
    },
  },
}));

const { SettingsModal } = await import('./SettingsModal');

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(ToastProvider, null, React.createElement(SettingsModal, { open: true, onClose: () => {} })),
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

afterEach(() => {
  outcome = 'ok';
  configSetCalls.length = 0;
});

describe('SettingsModal — honest reads', () => {
  test('renders categorized settings using TUI-parity category labels', async () => {
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('vaporwave') ?? false);
    expect(el.textContent).toContain('Display');
    expect(el.textContent).toContain('Helper');
    expect(el.textContent).toContain('Surfaces');
    unmount();
  });

  test('a secret-shaped key never renders its raw value', async () => {
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Surfaces') ?? false);
    const surfacesTab = [...el.querySelectorAll('.settings-category')].find((b) => b.textContent === 'Surfaces');
    flushSync(() => {
      surfacesTab?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(el.textContent).not.toContain('xoxb-super-secret-value-1234');
    expect(el.textContent).toContain('1234'); // last 4 chars only, per the mask contract
    expect(el.textContent).toContain('(secret)');
    unmount();
  });

  test('admin-scope refusal (403) renders distinctly from a generic fetch failure', async () => {
    outcome = 'admin-required';
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Admin access required') ?? false);
    expect(el.textContent).not.toContain('Config unavailable');
    unmount();
  });

  test('a genuine fetch failure shows the honest degraded ErrorState, not a fabricated "admin required"', async () => {
    outcome = 'network-error';
    const { el, unmount } = render();
    await waitFor(() => el.textContent?.includes('Config unavailable') ?? false);
    expect(el.textContent).not.toContain('Admin access required');
    unmount();
  });
});

describe('SettingsModal — Advanced raw editor', () => {
  test('saving a key/value calls config.set with the parsed value', async () => {
    const { el, unmount } = render();
    await waitFor(() => Boolean(el.querySelector('.settings-advanced input')));
    const keyInput = el.querySelector('.settings-advanced input') as HTMLInputElement;
    const valueTextarea = el.querySelector('.settings-advanced textarea') as HTMLTextAreaElement;
    flushSync(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(keyInput, 'display.theme');
      keyInput.dispatchEvent(new window.Event('input', { bubbles: true }));
      const taSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      taSetter?.call(valueTextarea, '"cyberpunk"');
      valueTextarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    const form = el.querySelector('.settings-advanced form') as HTMLFormElement;
    flushSync(() => {
      form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });
    await waitFor(() => configSetCalls.length > 0);
    expect(configSetCalls).toEqual([['display.theme', 'cyberpunk']]);
    unmount();
  });
});
