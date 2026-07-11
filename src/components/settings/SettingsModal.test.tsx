import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../lib/toast';

type ConfigOutcome = 'ok' | 'admin-required' | 'network-error';
let outcome: ConfigOutcome = 'ok';
const configSetCalls: [string, unknown][] = [];

// Enough of a live config to exercise: a typed string field (display.theme), a
// typed number field (display.collapseThreshold), a secret owned by a feature
// unit (surfaces.slack.botToken → slack-surface), and a flag override read.
const CONFIG_FIXTURE = {
  display: { theme: 'vaporwave', collapseThreshold: 30 },
  surfaces: { slack: { botToken: 'xoxb-super-secret-value-1234' } },
  featureFlags: {},
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

function clickCategory(el: HTMLElement, label: string): void {
  const tab = [...el.querySelectorAll('.settings-category')].find((b) => b.textContent === label);
  flushSync(() => {
    tab?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  flushSync(() => {
    setter?.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

// React 19 delegates onBlur to the bubbling `focusout` event at the root.
function commitByBlur(input: HTMLInputElement): void {
  flushSync(() => input.dispatchEvent(new window.Event('focusout', { bubbles: true })));
}

afterEach(() => {
  outcome = 'ok';
  configSetCalls.length = 0;
});

describe('SettingsModal — schema-driven structure', () => {
  test('renders namespace groups and the Feature Flags group', async () => {
    const { el, unmount } = render();
    await waitFor(() => Boolean([...el.querySelectorAll('.settings-category')].some((b) => b.textContent === 'Display')));
    const labels = [...el.querySelectorAll('.settings-category')].map((b) => b.textContent);
    expect(labels).toContain('Display');
    expect(labels).toContain('Surfaces');
    expect(labels).toContain('Feature Flags');
    unmount();
  });

  test('a schema string key renders as a typed input carrying its live value', async () => {
    const { el, unmount } = render();
    await waitFor(() => Boolean(el.querySelector('[data-config-key="display.theme"] input')));
    const input = el.querySelector('[data-config-key="display.theme"] input') as HTMLInputElement;
    expect(input.value).toBe('vaporwave');
    unmount();
  });

  test('editing a schema key commits the typed value through config.set', async () => {
    const { el, unmount } = render();
    await waitFor(() => Boolean(el.querySelector('[data-config-key="display.theme"] input')));
    const input = el.querySelector('[data-config-key="display.theme"] input') as HTMLInputElement;
    setInputValue(input, 'cyberpunk');
    commitByBlur(input);
    await waitFor(() => configSetCalls.length > 0);
    expect(configSetCalls).toEqual([['display.theme', 'cyberpunk']]);
    unmount();
  });

  test('a number key commits a parsed finite number, not a string', async () => {
    const { el, unmount } = render();
    await waitFor(() => Boolean(el.querySelector('[data-config-key="display.collapseThreshold"] input')));
    const input = el.querySelector('[data-config-key="display.collapseThreshold"] input') as HTMLInputElement;
    setInputValue(input, '42');
    commitByBlur(input);
    await waitFor(() => configSetCalls.length > 0);
    expect(configSetCalls).toEqual([['display.collapseThreshold', 42]]);
    unmount();
  });
});

describe('SettingsModal — feature units', () => {
  test('a secret key owned by a feature unit is masked, never raw, and offers write-only replace', async () => {
    const { el, unmount } = render();
    await waitFor(() => Boolean([...el.querySelectorAll('.settings-category')].some((b) => b.textContent === 'Surfaces')));
    clickCategory(el, 'Surfaces');
    await waitFor(() => Boolean(el.querySelector('[data-flag-id="slack-surface"]')));
    const tokenField = el.querySelector('[data-config-key="surfaces.slack.botToken"]') as HTMLElement;
    expect(tokenField).toBeTruthy();
    expect(tokenField.textContent).not.toContain('xoxb-super-secret-value-1234');
    expect(tokenField.textContent).toContain('1234'); // last 4 only
    expect(tokenField.querySelector('.settings-field-replace')).toBeTruthy();
    unmount();
  });

  test('toggling a feature flag writes featureFlags.<id> through config.set', async () => {
    const { el, unmount } = render();
    await waitFor(() => Boolean([...el.querySelectorAll('.settings-category')].some((b) => b.textContent === 'Surfaces')));
    clickCategory(el, 'Surfaces');
    await waitFor(() => Boolean(el.querySelector('[data-flag-id="slack-surface"] .feature-unit-toggle input')));
    const toggle = el.querySelector('[data-flag-id="slack-surface"] .feature-unit-toggle input') as HTMLInputElement;
    // React fires a checkbox's onChange from the native click; click also flips checked.
    flushSync(() => {
      toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => configSetCalls.length > 0);
    expect(configSetCalls).toEqual([['featureFlags.slack-surface', 'enabled']]);
    unmount();
  });
});

describe('SettingsModal — honest degraded states', () => {
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

describe('SettingsModal — Advanced unschema\'d escape hatch', () => {
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
