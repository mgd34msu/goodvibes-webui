import { describe, expect, test } from 'bun:test';
import { decodeUrlState } from '../../lib/router';
import type { ViewId } from '../../lib/router';
import { ACCOUNT_VIEWS, DESTINATIONS, destinationOf, viewTitle } from './nav';

// Every view the router accepts, the same list src/lib/router.ts validates against.
const ALL_VIEWS: ViewId[] = [
  'chat', 'sessions', 'knowledge', 'memory', 'providers', 'admin', 'fleet', 'checkpoints',
  'approvals-tasks', 'workstream', 'calendar', 'mail', 'ci-watches', 'checkin', 'principals',
  'phone', 'dates', 'hosted-sessions',
];

describe('navigation map: nothing becomes unreachable', () => {
  test('the list above is exactly what the router accepts', () => {
    for (const view of ALL_VIEWS) expect(decodeUrlState(`?view=${view}`).view).toBe(view);
  });

  test('every view is chat, a destination tab, or an account-menu entry', () => {
    const reachable = new Set<ViewId>(['chat']);
    for (const d of DESTINATIONS) for (const tab of d.tabs) reachable.add(tab.view);
    for (const entry of ACCOUNT_VIEWS) reachable.add(entry.view);
    expect([...ALL_VIEWS].filter((v) => !reachable.has(v))).toEqual([]);
  });

  test('the design doc groups: Work, Library, Personal', () => {
    expect(destinationOf('fleet')).toBe('work');
    expect(destinationOf('approvals-tasks')).toBe('work');
    expect(destinationOf('hosted-sessions')).toBe('work');
    expect(destinationOf('memory')).toBe('library');
    expect(destinationOf('knowledge')).toBe('library');
    expect(destinationOf('mail')).toBe('personal');
    expect(destinationOf('dates')).toBe('personal');
    expect(destinationOf('admin')).toBe('account');
    expect(destinationOf('chat')).toBe('chat');
  });

  test('titles name the destination, and account pages by their menu label', () => {
    expect(viewTitle('ci-watches')).toBe('Work');
    expect(viewTitle('calendar')).toBe('Personal');
    expect(viewTitle('providers')).toBe('Models and usage');
  });
});
