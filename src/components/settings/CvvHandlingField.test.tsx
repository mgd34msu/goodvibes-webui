import { describe, expect, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { CvvHandlingField } from './CvvHandlingField';
import { CVV_PROMPT_TRADEOFF_WARNING } from '@pellux/goodvibes-sdk/platform/payments';

const ENUM_VALUES = ['stored', 'prompt'] as const;

function render(props: { value: string; onCommit: (value: string) => void }): {
  container: HTMLElement;
  select: HTMLSelectElement;
  unmount: () => void;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(CvvHandlingField, { ...props, enumValues: ENUM_VALUES }));
  });
  const select = container.querySelector('select') as HTMLSelectElement;
  return {
    container,
    select,
    unmount: () => {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
}

function selectValue(select: HTMLSelectElement, value: string): void {
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  flushSync(() => {
    nativeSetter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('CvvHandlingField', () => {
  test('starting on "stored" shows no warning', () => {
    const { container, unmount } = render({ value: 'stored', onCommit: () => {} });
    expect(container.querySelector('[data-testid="cvv-prompt-warning"]')).toBeNull();
    unmount();
  });

  test('starting on "prompt" shows the warning immediately (a saved config already set to prompt)', () => {
    const { container, unmount } = render({ value: 'prompt', onCommit: () => {} });
    expect(container.textContent).toContain(CVV_PROMPT_TRADEOFF_WARNING);
    unmount();
  });

  test('selecting "prompt" surfaces the exact trade-off warning at the moment of selection', () => {
    const commits: string[] = [];
    const { container, select, unmount } = render({ value: 'stored', onCommit: (v) => commits.push(v) });
    selectValue(select, 'prompt');
    expect(commits).toEqual(['prompt']);
    expect(container.textContent).toContain(CVV_PROMPT_TRADEOFF_WARNING);
    unmount();
  });

  test('selecting "stored" does not surface a warning, and commits', () => {
    const commits: string[] = [];
    const { container, select, unmount } = render({ value: 'prompt', onCommit: (v) => commits.push(v) });
    selectValue(select, 'stored');
    expect(commits).toEqual(['stored']);
    expect(container.querySelector('[data-testid="cvv-prompt-warning"]')).toBeNull();
    unmount();
  });

  test('switching from prompt back to stored removes the warning', () => {
    const { container, select, unmount } = render({ value: 'prompt', onCommit: () => {} });
    expect(container.querySelector('[data-testid="cvv-prompt-warning"]')).not.toBeNull();
    selectValue(select, 'stored');
    expect(container.querySelector('[data-testid="cvv-prompt-warning"]')).toBeNull();
    unmount();
  });
});
