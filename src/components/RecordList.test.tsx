import { describe, expect, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { RecordList } from './RecordList';

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function renderInto(
  ui: React.ReactElement,
): { el: HTMLElement; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(ui);
  });
  return {
    el: container,
    unmount: () => {
      flushSync(() => {
        root.unmount();
      });
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RecordList', () => {
  // ── empty state ──────────────────────────────────────────────────────────

  test('renders default empty-state when items is empty', () => {
    const html = renderToStaticMarkup(<RecordList items={[]} />);
    expect(html).toContain('empty-state');
    expect(html).toContain('No records');
  });

  test('renders custom empty prop when items is empty', () => {
    const html = renderToStaticMarkup(<RecordList items={[]} empty="Nothing here" />);
    expect(html).toContain('Nothing here');
    expect(html).not.toContain('No records');
  });

  // ── item rendering ───────────────────────────────────────────────────────

  test('renders a single item with title and id visible', () => {
    const item = { id: 'abc-1', name: 'My Record' };
    const html = renderToStaticMarkup(<RecordList items={[item]} />);
    expect(html).toContain('My Record');
    expect(html).toContain('abc-1');
    expect(html).toContain('record-row');
  });

  test('renders all items — one row per item', () => {
    const items = [
      { id: 'r1', name: 'First' },
      { id: 'r2', name: 'Second' },
      { id: 'r3', name: 'Third' },
    ];
    const html = renderToStaticMarkup(<RecordList items={items} />);
    expect(html.split('record-row').length - 1).toBe(3);
    expect(html).toContain('First');
    expect(html).toContain('Third');
  });

  test('renders div rows (not buttons) when onSelect is not provided', () => {
    const item = { id: 'x', name: 'Item' };
    const html = renderToStaticMarkup(<RecordList items={[item]} />);
    expect(html).not.toContain('<button');
    expect(html).toContain('<div');
  });

  test('item without id field falls back to index as id', () => {
    const item = { name: 'No ID Item' };
    const html = renderToStaticMarkup(<RecordList items={[item]} />);
    // Index 0 used as fallback id — assert the id <span> specifically
    expect(html).toContain('<span>0</span>');
    expect(html).toContain('No ID Item');
  });

  // ── onSelect / interactivity ─────────────────────────────────────────────

  test('renders button rows when onSelect is provided', () => {
    const item = { id: 'btn-1', name: 'Clickable' };
    const html = renderToStaticMarkup(<RecordList items={[item]} onSelect={() => {}} />);
    expect(html).toContain('<button');
    expect(html).toContain('type="button"');
  });

  test('onSelect fires with the item id when a row is clicked', () => {
    const calls: string[] = [];
    const items = [{ id: 'sel-1', name: 'Alpha' }, { id: 'sel-2', name: 'Beta' }];
    const { el, unmount } = renderInto(
      <RecordList items={items} onSelect={(id) => calls.push(id)} />,
    );

    const buttons = el.querySelectorAll('button');
    expect(buttons.length).toBe(2);

    flushSync(() => {
      (buttons[1] as HTMLButtonElement).click();
    });
    expect(calls).toEqual(['sel-2']);

    flushSync(() => {
      (buttons[0] as HTMLButtonElement).click();
    });
    expect(calls).toEqual(['sel-2', 'sel-1']);

    unmount();
  });

  // ── selection state ──────────────────────────────────────────────────────

  test('selected item row has "selected" class; others do not', () => {
    const items = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
    const html = renderToStaticMarkup(
      <RecordList items={items} selectedId="b" onSelect={() => {}} />,
    );
    // Two rows: one selected, one not
    expect(html).toContain('record-row selected');
    // Count non-selected rows (class="record-row" without 'selected' immediately after)
    const plainCount = (html.match(/class="record-row"/g) ?? []).length;
    expect(plainCount).toBe(1);
  });

  // ── aria / keyboard ──────────────────────────────────────────────────────

  test('buttons have type="button" (prevents accidental form submit)', () => {
    const item = { id: 'kb-1', name: 'Keyboard Item' };
    const html = renderToStaticMarkup(
      <RecordList items={[item]} onSelect={() => {}} />,
    );
    expect(html).toContain('type="button"');
  });

  test('non-interactive list renders divs accessible as generic containers', () => {
    const item = { id: 'aria-1', name: 'Static Item' };
    const html = renderToStaticMarkup(<RecordList items={[item]} />);
    // Should have record-list wrapper div and record-row divs
    expect(html).toContain('record-list');
    expect(html).not.toContain('<button');
  });
});
