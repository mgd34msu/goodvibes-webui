/**
 * SignedOutGate — the signed-out first paint and paste-token flow.
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const tokenCalls: string[] = [];
let tokenShouldReject = false;

mock.module('../../lib/goodvibes', () => ({
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  setExplicitAuthToken: (raw: string) => {
    tokenCalls.push(raw);
    return tokenShouldReject
      ? Promise.reject(Object.assign(new Error('rejected'), { status: 401 }))
      : Promise.resolve({ authenticated: true });
  },
  login: () => Promise.resolve({}),
  sdk: {},
}));

const { SignedOutGate } = await import('./SignedOutGate');

function render(): { el: HTMLElement; unmount: () => void } {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(SignedOutGate)));
  });
  return {
    el: container,
    unmount: () => {
      flushSync(() => root.unmount());
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

async function tick() {
  await new Promise((r) => setTimeout(r, 10));
}

afterEach(() => {
  tokenCalls.length = 0;
  tokenShouldReject = false;
});

describe('SignedOutGate first paint', () => {
  test('renders a real signed-in prompt with a token field', () => {
    const { el, unmount } = render();
    expect(el.textContent).toContain('Sign in to GoodVibes');
    expect(el.querySelector('input[type="password"]')).not.toBeNull();
    unmount();
  });

  test('recovery guidance points to the daemon startup output / operator-tokens.json', () => {
    const { el, unmount } = render();
    const text = el.textContent ?? '';
    expect(text).toContain('Where do I find a token');
    expect(text).toContain('startup output');
    expect(text).toContain('operator-tokens.json');
    unmount();
  });

  test('password login is NOT presented co-equal — hidden behind a secondary toggle', () => {
    const { el, unmount } = render();
    // Username field is not present until the secondary path is expanded.
    expect(el.querySelector('input[autocomplete="username"]')).toBeNull();
    expect(el.textContent).toContain('username');
    unmount();
  });
});

describe('SignedOutGate token flow', () => {
  test('submitting a token calls setExplicitAuthToken with the trimmed value', async () => {
    const { el, unmount } = render();
    const input = el.querySelector('input[type="password"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, '  paste-me  ');
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    flushSync(() => {});

    const form = el.querySelector('form') as HTMLFormElement;
    flushSync(() => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
    await tick();

    expect(tokenCalls).toContain('paste-me');
    unmount();
  });

  test('a rejected token surfaces an honest error with the "cleared, paste fresh" note', async () => {
    tokenShouldReject = true;
    const { el, unmount } = render();
    const input = el.querySelector('input[type="password"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, 'bad-token');
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    flushSync(() => {});

    const form = el.querySelector('form') as HTMLFormElement;
    flushSync(() => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
    await tick();

    const alert = el.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain('cleared');
    unmount();
  });
});
