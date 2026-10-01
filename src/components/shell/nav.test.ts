import { describe, expect, test } from 'bun:test';
import { LEGACY_VIEW_REDIRECTS, decodeUrlState } from '../../lib/router';
import type { ViewId } from '../../lib/router';
import { ACCOUNT_VIEWS, DESTINATIONS, LIBRARY, PERSONAL, WORK, destinationOf, resolveTab, viewTitle } from './nav';

// Every view the router accepts, the same list src/lib/router.ts validates against.
const ALL_VIEWS: ViewId[] = ['chat', 'work', 'library', 'personal', 'phone'];

describe('navigation map: nothing becomes unreachable', () => {
  test('the list above is exactly what the router accepts', () => {
    for (const view of ALL_VIEWS) expect(decodeUrlState(`?view=${view}`).view).toBe(view);
  });

  test('every view is chat, a destination, or an account-menu entry', () => {
    const reachable = new Set<ViewId>(['chat']);
    for (const d of DESTINATIONS) reachable.add(d.view);
    for (const entry of ACCOUNT_VIEWS) reachable.add(entry.view);
    expect([...ALL_VIEWS].filter((v) => !reachable.has(v))).toEqual([]);
  });

  test('every old view id lands on a destination tab that exists (checkpoints: a session tab)', () => {
    for (const [old, target] of Object.entries(LEGACY_VIEW_REDIRECTS)) {
      const destination = DESTINATIONS.find((d) => d.view === target.view);
      expect(destination, old).toBeDefined();
      if (old === 'checkpoints') continue;
      expect(destination!.tabs.map((t) => t.tab), old).toContain(target.tab);
    }
  });

  test('the design doc groups: Work, Library, Personal', () => {
    expect(destinationOf('work')).toBe('work');
    expect(destinationOf('library')).toBe('library');
    expect(destinationOf('personal')).toBe('personal');
    expect(destinationOf('chat')).toBe('chat');
    expect(WORK.tabs.map((t) => t.label)).toEqual(['All', 'Sessions', 'Agents', 'Processes']);
    expect(LIBRARY.tabs.map((t) => t.label)).toEqual(['Memory', 'Knowledge', 'Review']);
    expect(PERSONAL.tabs.map((t) => t.label)).toEqual(['Calendar', 'Mail', 'Occasions']);
  });

  test('an unknown or missing tab resolves to the first one', () => {
    expect(resolveTab(LIBRARY, 'knowledge')).toBe('knowledge');
    expect(resolveTab(LIBRARY, undefined)).toBe('memory');
    expect(resolveTab(PERSONAL, 'nope')).toBe('calendar');
  });

  test('titles name the destination, and account pages by their menu label', () => {
    expect(viewTitle('work')).toBe('Work');
    expect(viewTitle('personal')).toBe('Personal');
    expect(viewTitle('phone')).toBe('Phone node');
  });
});
