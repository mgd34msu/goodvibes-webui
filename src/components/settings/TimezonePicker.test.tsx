import { describe, expect, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { TimezonePicker } from './TimezonePicker';
import { UNSET_TIMEZONE_LABEL, UNSET_TIMEZONE_VALUE } from '../../lib/timezones';

function render(props: { value: string; onCommit: (value: string) => void }): {
  container: HTMLElement;
  select: HTMLSelectElement;
  search: HTMLInputElement;
  unmount: () => void;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(TimezonePicker, props));
  });
  const select = container.querySelector('select') as HTMLSelectElement;
  const search = container.querySelector('input[type="search"]') as HTMLInputElement;
  return {
    container,
    select,
    search,
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

describe('TimezonePicker', () => {
  test('renders a select with the explicit "UTC (unset)" option always present', () => {
    const { select, unmount } = render({ value: '', onCommit: () => {} });
    const optionLabels = [...select.options].map((o) => o.textContent);
    const optionValues = [...select.options].map((o) => o.value);
    expect(optionLabels).toContain(UNSET_TIMEZONE_LABEL);
    expect(optionValues).toContain(UNSET_TIMEZONE_VALUE);
    unmount();
  });

  test('renders real IANA zone names as options', () => {
    const { select, unmount } = render({ value: '', onCommit: () => {} });
    const optionValues = [...select.options].map((o) => o.value);
    expect(optionValues).toContain('America/New_York');
    unmount();
  });

  test('the current value is selected when it is a real zone', () => {
    const { select, unmount } = render({ value: 'Europe/London', onCommit: () => {} });
    expect(select.value).toBe('Europe/London');
    unmount();
  });

  test('selecting a real zone commits that exact IANA name', () => {
    const commits: string[] = [];
    const { select, unmount } = render({ value: '', onCommit: (v) => commits.push(v) });
    selectValue(select, 'Asia/Tokyo');
    expect(commits).toEqual(['Asia/Tokyo']);
    unmount();
  });

  test('selecting the unset option commits the empty string', () => {
    const commits: string[] = [];
    const { select, unmount } = render({ value: 'Asia/Tokyo', onCommit: (v) => commits.push(v) });
    selectValue(select, UNSET_TIMEZONE_VALUE);
    expect(commits).toEqual(['']);
    unmount();
  });

  test('typing in the search box filters the zone list to matching names', () => {
    const { select, search, unmount } = render({ value: '', onCommit: () => {} });
    flushSync(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      nativeSetter.call(search, 'New_York');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const optionValues = [...select.options].map((o) => o.value);
    expect(optionValues).toContain('America/New_York');
    // Zones that clearly do not match the query are filtered out.
    expect(optionValues).not.toContain('Europe/London');
    unmount();
  });

  test('a search that filters out the current value still keeps it selectable, pinned in', () => {
    const { select, search, unmount } = render({ value: 'Europe/London', onCommit: () => {} });
    flushSync(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      nativeSetter.call(search, 'tokyo');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const optionValues = [...select.options].map((o) => o.value);
    expect(optionValues).toContain('Europe/London');
    expect(select.value).toBe('Europe/London');
    unmount();
  });
});
