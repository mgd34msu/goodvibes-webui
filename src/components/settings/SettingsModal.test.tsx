import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../lib/toast';
import { FEATURE_SETTINGS } from '../../lib/generated/config-schema';

type ConfigOutcome = 'ok' | 'admin-required' | 'network-error';
let outcome: ConfigOutcome = 'ok';
const configSetCalls: [string, unknown][] = [];

// Enough of a live config to exercise: a typed string field (display.theme), a
// typed number field (display.collapseThreshold), a secret owned by a feature
// unit (surfaces.slack.botToken → slack-surface), and a flag override read.
const CONFIG_FIXTURE = {
  display: { theme: 'vaporwave', collapseThreshold: 30 },
  surfaces: { slack: { botToken: 'xoxb-super-secret-value-1234' } },
  behavior: { hitlMode: 'balanced' },
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
  test('renders domain groups only — the enablement bucket is gone', async () => {
    const { el, unmount } = render();
    await waitFor(() => Boolean([...el.querySelectorAll('.settings-category')].some((b) => b.textContent === 'Display')));
    const labels = [...el.querySelectorAll('.settings-category')].map((b) => b.textContent);
    expect(labels).toContain('Display');
    expect(labels).toContain('Surfaces');
    expect(labels).toContain('Permissions');
    expect(labels).toContain('Behavior');
    expect(labels).not.toContain('Feature Flags');
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
    await waitFor(() => Boolean(el.querySelector('[data-feature-id="slack-surface"]')));
    const tokenField = el.querySelector('[data-config-key="surfaces.slack.botToken"]') as HTMLElement;
    expect(tokenField).toBeTruthy();
    expect(tokenField.textContent).not.toContain('xoxb-super-secret-value-1234');
    expect(tokenField.textContent).toContain('1234'); // last 4 only
    expect(tokenField.querySelector('.settings-field-replace')).toBeTruthy();
    unmount();
  });

  test('a constant feature (surface adapter) offers no separate feature toggle — its own enabled key is the switch', async () => {
    const { el, unmount } = render();
    await waitFor(() => Boolean([...el.querySelectorAll('.settings-category')].some((b) => b.textContent === 'Surfaces')));
    clickCategory(el, 'Surfaces');
    await waitFor(() => Boolean(el.querySelector('[data-feature-id="slack-surface"]')));
    const unit = el.querySelector('[data-feature-id="slack-surface"]') as HTMLElement;
    expect(unit.querySelector('.feature-unit-toggle')).toBeNull();
    // The domain key renders as an ordinary typed toggle field inside the unit.
    expect(unit.querySelector('[data-config-key="surfaces.slack.enabled"] input[type="checkbox"]')).toBeTruthy();
    unmount();
  });

  test('toggling a boolean feature writes true/false to its domain settings key', async () => {
    const { el, unmount } = render();
    await waitFor(() => Boolean([...el.querySelectorAll('.settings-category')].some((b) => b.textContent === 'Permissions')));
    clickCategory(el, 'Permissions');
    await waitFor(() => Boolean(el.querySelector('[data-feature-id="permissions-simulation"] .feature-unit-toggle input')));
    const toggle = el.querySelector('[data-feature-id="permissions-simulation"] .feature-unit-toggle input') as HTMLInputElement;
    expect(toggle.checked).toBe(true); // ruled default: on
    // React fires a checkbox's onChange from the native click; click also flips checked.
    flushSync(() => {
      toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => configSetCalls.length > 0);
    expect(configSetCalls).toEqual([['permissions.simulation', false]]);
    unmount();
  });

  test('a restart-gated feature shows the pending-restart marker after its enablement changes', async () => {
    const { el, unmount } = render();
    await waitFor(() => Boolean([...el.querySelectorAll('.settings-category')].some((b) => b.textContent === 'Permissions')));
    clickCategory(el, 'Permissions');
    await waitFor(() => Boolean(el.querySelector('[data-feature-id="permissions-simulation"] .feature-unit-toggle input')));
    const unit = el.querySelector('[data-feature-id="permissions-simulation"]') as HTMLElement;
    // permissions-simulation is restart-gated; no marker before any change.
    expect(unit.querySelector('[data-pending-restart]')).toBeNull();
    const toggle = unit.querySelector('.feature-unit-toggle input') as HTMLInputElement;
    flushSync(() => {
      toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => Boolean(el.querySelector('[data-pending-restart="permissions-simulation"]')));
    expect(el.querySelector('[data-pending-restart="permissions-simulation"]')?.textContent).toContain('daemon restarts');
    unmount();
  });

  test('changing an enum feature mode writes the mode value to its domain settings key', async () => {
    const { el, unmount } = render();
    await waitFor(() => Boolean([...el.querySelectorAll('.settings-category')].some((b) => b.textContent === 'Behavior')));
    clickCategory(el, 'Behavior');
    await waitFor(() => Boolean(el.querySelector('[data-feature-id="hitl-ux-modes"] select')));
    const select = el.querySelector('[data-feature-id="hitl-ux-modes"] select') as HTMLSelectElement;
    expect(select.value).toBe('balanced'); // live fixture value
    // The full schema mode set is offered, inactive "off" included.
    expect([...select.options].map((o) => o.value)).toEqual(['off', 'quiet', 'balanced', 'operator']);
    flushSync(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(select, 'quiet');
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    await waitFor(() => configSetCalls.length > 0);
    expect(configSetCalls).toEqual([['behavior.hitlMode', 'quiet']]);
    unmount();
  });

  test('a runtime-toggleable feature never shows a pending-restart marker after a change', async () => {
    const { el, unmount } = render();
    await waitFor(() => Boolean([...el.querySelectorAll('.settings-category')].some((b) => b.textContent === 'Behavior')));
    clickCategory(el, 'Behavior');
    await waitFor(() => Boolean(el.querySelector('[data-feature-id="hitl-ux-modes"] select')));
    const select = el.querySelector('[data-feature-id="hitl-ux-modes"] select') as HTMLSelectElement;
    flushSync(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(select, 'operator');
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    await waitFor(() => configSetCalls.length > 0);
    expect(el.querySelector('[data-pending-restart]')).toBeNull();
    unmount();
  });

  test('a feature description renders in full — never truncated', async () => {
    const { el, unmount } = render();
    await waitFor(() => Boolean([...el.querySelectorAll('.settings-category')].some((b) => b.textContent === 'Behavior')));
    clickCategory(el, 'Behavior');
    await waitFor(() => Boolean(el.querySelector('[data-feature-id="hitl-ux-modes"] .feature-unit-desc')));
    const desc = el.querySelector('[data-feature-id="hitl-ux-modes"] .feature-unit-desc') as HTMLElement;
    const meta = FEATURE_SETTINGS.find((f) => f.id === 'hitl-ux-modes')!;
    expect(desc.textContent).toBe(meta.description);
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

describe('SettingsModal — object-typed pricing editor', () => {
  test('pricing.modelPrices renders the structured per-model editor, not a JSON textarea', async () => {
    const { el, unmount } = render();
    await waitFor(() => Boolean([...el.querySelectorAll('.settings-category')].some((b) => b.textContent === 'Pricing')));
    clickCategory(el, 'Pricing');
    await waitFor(() => Boolean(el.querySelector('[data-config-key="pricing.modelPrices"]')));
    const field = el.querySelector('[data-config-key="pricing.modelPrices"]') as HTMLElement;
    // Full description renders, the structured editor mounts, and no blob textarea exists.
    expect(field.querySelector('.settings-field-desc')?.textContent).toContain('Manual model prices');
    expect(field.querySelector('[data-testid="model-prices-editor"]')).not.toBeNull();
    expect(field.querySelector('textarea')).toBeNull();
    unmount();
  });
});
