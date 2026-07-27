import { describe, expect, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MoneyField } from './MoneyField';

function render(props: { minorUnits: number; currency: string; onCommit: (minor: number) => void }): {
  container: HTMLElement;
  input: HTMLInputElement;
  unmount: () => void;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(MoneyField, props));
  });
  const input = container.querySelector('input') as HTMLInputElement;
  return {
    container,
    input,
    unmount: () => {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
}

function typeAndBlur(input: HTMLInputElement, text: string): void {
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  flushSync(() => {
    nativeSetter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  flushSync(() => {
    // React's onBlur listens on the bubbling native 'focusout' event (plain
    // 'blur' does not bubble, so React never observes it via delegation).
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

describe('MoneyField', () => {
  test('renders the live minor-units value as a major-unit decimal string', () => {
    const { input, unmount } = render({ minorUnits: 1999, currency: 'USD', onCommit: () => {} });
    expect(input.value).toBe('19.99');
    unmount();
  });

  test('shows the currency code', () => {
    const { container, unmount } = render({ minorUnits: 0, currency: 'GBP', onCommit: () => {} });
    expect(container.textContent).toContain('GBP');
    unmount();
  });

  test('typing a major-unit amount and blurring commits the exact minor-unit integer', () => {
    const commits: number[] = [];
    const { input, unmount } = render({ minorUnits: 0, currency: 'USD', onCommit: (m) => commits.push(m) });
    typeAndBlur(input, '19.99');
    expect(commits).toEqual([1999]);
    unmount();
  });

  test('a whole-dollar amount converts exactly — "50" becomes 5000 cents, not 50', () => {
    const commits: number[] = [];
    const { input, unmount } = render({ minorUnits: 0, currency: 'USD', onCommit: (m) => commits.push(m) });
    typeAndBlur(input, '50');
    expect(commits).toEqual([5000]);
    unmount();
  });

  test('float-trap amounts (0.1, 0.29) convert exactly', () => {
    const commits: number[] = [];
    const { input, unmount } = render({ minorUnits: 0, currency: 'USD', onCommit: (m) => commits.push(m) });
    typeAndBlur(input, '0.10');
    expect(commits).toEqual([10]);
    unmount();

    const commits2: number[] = [];
    const second = render({ minorUnits: 0, currency: 'USD', onCommit: (m) => commits2.push(m) });
    typeAndBlur(second.input, '0.29');
    expect(commits2).toEqual([29]);
    second.unmount();
  });

  test('an invalid amount shows an inline error and does not commit', () => {
    const commits: number[] = [];
    const { input, container, unmount } = render({ minorUnits: 0, currency: 'USD', onCommit: (m) => commits.push(m) });
    typeAndBlur(input, 'not-a-number');
    expect(commits).toEqual([]);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    unmount();
  });

  test('leaving the value unchanged does not commit', () => {
    let commitCount = 0;
    const { input, unmount } = render({ minorUnits: 1999, currency: 'USD', onCommit: () => { commitCount += 1; } });
    typeAndBlur(input, '19.99');
    expect(commitCount).toBe(0);
    unmount();
  });
});
