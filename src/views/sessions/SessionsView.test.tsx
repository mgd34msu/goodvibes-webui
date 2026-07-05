/**
 * SessionsView — union rendering from a fixture, covering the honesty markers:
 * all kinds render (incl. an unknown future kind verbatim), closed-as-history,
 * the retainedMessageCount truncation marker, and the capped-50 affordance.
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const steerCalls: { id: string; body: unknown }[] = [];
const followUpCalls: { id: string; body: unknown }[] = [];

mock.module('../../lib/goodvibes', () => ({
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  sdk: {
    operator: {
      sessions: {
        list: () => Promise.resolve(FIXTURE_UNION),
        messages: { list: () => Promise.resolve({ messages: [] }) },
        steer: (id: string, body: unknown) => { steerCalls.push({ id, body }); return Promise.resolve({}); },
        followUp: (id: string, body: unknown) => { followUpCalls.push({ id, body }); return Promise.resolve({}); },
      },
    },
  },
}));

const { SessionsView } = await import('./SessionsView');

const FIXTURE_UNION = {
  totals: { sessions: 137 },
  sessions: [
    { id: 's-tui', kind: 'tui', project: 'goodvibes-tui', title: 'TUI coding', status: 'active', updatedAt: 50, messageCount: 12 },
    { id: 's-agent', kind: 'agent', project: 'goodvibes-tui', title: 'Agent run', status: 'active', updatedAt: 40, messageCount: 3, activeAgentId: 'agent-1' },
    { id: 's-webui', kind: 'webui', project: 'goodvibes-webui', title: 'WebUI sess', status: 'active', updatedAt: 30, messageCount: 5 },
    { id: 's-auto', kind: 'automation', project: 'goodvibes-webui', title: 'Nightly', status: 'active', updatedAt: 20, messageCount: 8 },
    { id: 's-chat', kind: 'companion-chat', project: '', title: 'Phone chat', status: 'active', updatedAt: 60, messageCount: 2 },
    { id: 's-closed', kind: 'tui', project: 'goodvibes-tui', title: 'Old session', status: 'closed', updatedAt: 10, messageCount: 300, retainedMessageCount: 50 },
    { id: 's-future', kind: 'quantum-surface', project: 'lab', title: 'Future kind', status: 'active', updatedAt: 70, messageCount: 1 },
  ],
};

function render(seed?: unknown): { el: HTMLElement; unmount: () => void } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['sessions'], seed ?? FIXTURE_UNION);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(SessionsView)));
  });
  return {
    el: container,
    unmount: () => {
      flushSync(() => root.unmount());
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

function click(el: Element | null | undefined) {
  flushSync(() => {
    el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
}

afterEach(() => {
  steerCalls.length = 0;
  followUpCalls.length = 0;
});

describe('SessionsView union rendering', () => {
  test('renders every kind including an unknown future kind, none dropped', () => {
    const { el, unmount } = render();
    const text = el.textContent ?? '';
    for (const title of ['TUI coding', 'Agent run', 'WebUI sess', 'Nightly', 'Phone chat', 'Old session', 'Future kind']) {
      expect(text).toContain(title);
    }
    // unknown kind badge shows verbatim
    expect(text).toContain('quantum-surface');
    unmount();
  });

  test('unknown kind badge carries the honesty warning tone + title', () => {
    const { el, unmount } = render();
    const badges = [...el.querySelectorAll('.badge')].filter((b) => b.textContent === 'quantum-surface');
    expect(badges.length).toBeGreaterThan(0);
    expect(badges[0].className).toContain('warning');
    unmount();
  });

  test('closed session renders "closed · history"', () => {
    const { el, unmount } = render();
    expect(el.textContent).toContain('closed · history');
    unmount();
  });

  test('retention truncation marker renders "50 of 300 retained"', () => {
    const { el, unmount } = render();
    expect(el.textContent).toContain('50 of 300 retained');
    unmount();
  });

  test('a session with no retainedMessageCount shows NO retention marker', () => {
    const { el, unmount } = render();
    // s-tui (messageCount 12, no retained) must not fabricate a "N of 12 retained".
    expect(el.textContent).not.toContain('of 12 retained');
    unmount();
  });

  test('absent project groups under an "unknown" project badge', () => {
    const { el, unmount } = render();
    // s-chat has project '' → grouped as 'unknown'
    const groupBadges = [...el.querySelectorAll('.sessions-group__header .badge')].map((b) => b.textContent);
    expect(groupBadges).toContain('unknown');
    unmount();
  });

  test('capped-50 snapshot shows the "50 most recent" honesty note', () => {
    const fifty = { totals: { sessions: 200 }, sessions: Array.from({ length: 50 }, (_, i) => ({
      id: `s${i}`, kind: 'tui', project: 'p', title: `S${i}`, status: 'active', updatedAt: i, messageCount: 1,
    })) };
    const { el, unmount } = render(fifty);
    expect(el.textContent).toContain('50 most recent');
    expect(el.textContent).toContain('of 200');
    unmount();
  });

  test('under the cap, no completeness affordance is shown', () => {
    const { el, unmount } = render();
    expect(el.textContent).not.toContain('most recent');
    unmount();
  });
});

describe('SessionsView: filtered-empty vs true-empty honesty', () => {
  test('a true-empty union (no sessions at all) shows the true-empty note', () => {
    const { el, unmount } = render({ totals: { sessions: 0 }, sessions: [] });
    expect(el.textContent).toContain('No sessions in the union yet.');
    expect(el.textContent).not.toContain('No sessions match the current filters.');
    unmount();
  });

  test('filtering down to zero rows shows a distinct "no match" note with a clear-filters affordance, not the true-empty copy', () => {
    const { el, unmount } = render();
    // The project select has no option matching a kind of 'quantum-surface' AND
    // project 'goodvibes-tui' at once — pick a kind filter with zero matches
    // among the TUI-project rows by combining two selects that don't co-occur.
    const kindSelect = el.querySelector('select[aria-label="Filter by kind"]') as HTMLSelectElement;
    const projectSelect = el.querySelector('select[aria-label="Filter by project"]') as HTMLSelectElement;
    flushSync(() => {
      const kindSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
      kindSetter.call(kindSelect, 'companion-chat');
      kindSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    flushSync(() => {
      const projectSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
      projectSetter.call(projectSelect, 'goodvibes-tui');
      projectSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    });

    // s-chat (companion-chat) has no project, and goodvibes-tui rows are never
    // kind 'companion-chat' — this combination matches zero records.
    expect(el.textContent).toContain('No sessions match the current filters.');
    expect(el.textContent).not.toContain('No sessions in the union yet.');

    const clearButton = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Clear filters');
    expect(clearButton).toBeTruthy();
    click(clearButton);

    // Clearing restores every row.
    expect(el.textContent).toContain('TUI coding');
    expect(el.textContent).not.toContain('No sessions match the current filters.');
    unmount();
  });
});

describe('SessionsView steer branch', () => {
  test('selecting an agent-bound session offers STEER', () => {
    const { el, unmount } = render();
    const agentRow = [...el.querySelectorAll('.sessions-row')].find((r) => r.textContent?.includes('Agent run'));
    click(agentRow);
    expect(el.textContent).toContain('Steer · agent bound');
    unmount();
  });

  test('selecting an active session with no agent offers FOLLOW-UP, not steer', () => {
    const { el, unmount } = render();
    const tuiRow = [...el.querySelectorAll('.sessions-row')].find((r) => r.textContent?.includes('TUI coding'));
    click(tuiRow);
    expect(el.textContent).toContain('Follow-up');
    unmount();
  });

  test('selecting a closed session disables dispatch with an honest note', () => {
    const { el, unmount } = render();
    const closedRow = [...el.querySelectorAll('.sessions-row')].find((r) => r.textContent?.includes('Old session'));
    click(closedRow);
    expect(el.textContent).toContain('Session closed');
    unmount();
  });

  async function typeAndSubmit(el: HTMLElement, value: string) {
    const textarea = el.querySelector('.steer-composer textarea') as HTMLTextAreaElement;
    const form = el.querySelector('.steer-composer__form') as HTMLFormElement;
    flushSync(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, value);
      textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    flushSync(() => {
      form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });
    // The mutation's mutationFn runs on a microtask after mutate() is called.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  test('WIRE: submitting a steer sends the canonical `body` field, never `message`', async () => {
    const { el, unmount } = render();
    const agentRow = [...el.querySelectorAll('.sessions-row')].find((r) => r.textContent?.includes('Agent run'));
    click(agentRow);
    await typeAndSubmit(el, 'Focus on the failing test');

    expect(steerCalls.length).toBe(1);
    expect(steerCalls[0].id).toBe('s-agent');
    expect(steerCalls[0].body).toEqual({ body: 'Focus on the failing test' });
    expect((steerCalls[0].body as Record<string, unknown>).message).toBeUndefined();
    expect(followUpCalls.length).toBe(0);
    unmount();
  });

  test('WIRE: submitting a follow-up (no bound agent) also sends `body`, never `message`', async () => {
    const { el, unmount } = render();
    const tuiRow = [...el.querySelectorAll('.sessions-row')].find((r) => r.textContent?.includes('TUI coding'));
    click(tuiRow);
    await typeAndSubmit(el, 'Queue this turn');

    expect(followUpCalls.length).toBe(1);
    expect(followUpCalls[0].body).toEqual({ body: 'Queue this turn' });
    expect((followUpCalls[0].body as Record<string, unknown>).message).toBeUndefined();
    expect(steerCalls.length).toBe(0);
    unmount();
  });
});
