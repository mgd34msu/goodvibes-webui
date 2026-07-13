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
    { id: 's-reaped', kind: 'tui', project: 'goodvibes-tui', title: 'Reaped session', status: 'closed', updatedAt: 5, messageCount: 4, metadata: { closeReason: 'idle-reaped' } },
  ],
};

// DELETE-MEANS-DELETE fixtures/state. `unionListFixture` starts as
// FIXTURE_UNION but individual describe blocks reassign it (via resetUnionFixtures)
// so close/delete mutations have a live store to mutate and the proof-of-gone
// reconcile has something real to check against. `methodInfoAvailable` toggles the
// honest capability probe (control.methods.get) between "sessions.delete exists on
// this daemon" and "unknown gateway method" (an older, un-upgraded daemon).
let unionListFixture: typeof FIXTURE_UNION = FIXTURE_UNION;
let unionCloseCalls: string[] = [];
let unionReopenCalls: string[] = [];
let unionDeleteCalls: string[] = [];
let unionDeleteReallyRemoves = true;
let methodInfoAvailable = true;
// When true, the capability probe fails with a TRANSIENT (non-404) error — a network/
// 5xx blip, NOT the daemon's honest "Unknown gateway method" absence. The view must
// treat this as "couldn't check", never as "delete unavailable".
let methodInfoTransientError = false;
// Permission-mode / context-usage fixtures (PermissionModeControl, ContextUsageChip —
// sessions.permissionMode.get/set + sessions.contextUsage.get). `permissionModeLocalId`
// names the ONE session id these mocked verbs answer for honestly — any other selected
// session gets the real SESSION_NOT_LOCAL 404, matching the daemon's own session-scoped
// contract. Defaults to '' (no session is "local") so most tests exercise the honest
// unavailable state; individual tests reassign it to prove the available path.
let permissionModeLocalId = '';
let permissionMode = 'normal';
let permissionModeSetCalls: { sessionId: string; mode: string }[] = [];
let contextUsageFixture: { estimatedContextTokens: number; contextWindow: number; contextUsagePct: number; contextRemainingTokens: number } | null = null;
// Cost attribution fixture (CostChip — cost.attribution.get, SDK 1.6.1). One row per
// entry, keyed by session id; a session with no entry has no recorded usage in the
// window — the honest "no cost recorded" state, not a fabricated $0.
let costAttributionRows: { key: string; costUsd: number | null; costState: 'priced' | 'estimated' | 'unpriced'; pricedRecordCount: number; unpricedRecordCount: number; tokens: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number } }[] = [];

function sessionNotLocal(sessionId: string) {
  return Promise.reject(Object.assign(new Error(`This daemon does not host a live runtime for session ${sessionId}.`), {
    status: 404,
    body: { code: 'SESSION_NOT_LOCAL', error: `This daemon does not host a live runtime for session ${sessionId}.` },
  }));
}

function resetUnionMutationFixtures() {
  unionListFixture = FIXTURE_UNION;
  unionCloseCalls = [];
  unionReopenCalls = [];
  unionDeleteCalls = [];
  unionDeleteReallyRemoves = true;
  methodInfoAvailable = true;
  methodInfoTransientError = false;
  permissionModeLocalId = '';
  permissionMode = 'normal';
  permissionModeSetCalls = [];
  contextUsageFixture = null;
  costAttributionRows = [];
}

mock.module('../../lib/goodvibes', () => ({
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  DEFAULT_SSE_RECONNECT: { enabled: true, baseDelayMs: 1, maxDelayMs: 2, backoffFactor: 2, maxAttempts: 3 },
  sdk: {
    // useCompactionReceipts (mounted inside SessionDetail) opens this raw stream —
    // a no-op open that never delivers a frame keeps the compaction chip/receipts
    // in their honest "not observed yet" empty state for these fixture-driven tests.
    streams: {
      open: () => Promise.resolve(() => {}),
    },
    operator: {
      control: {
        methodInfo: (methodId: string) => {
          if (methodId === 'sessions.delete' && methodInfoTransientError) {
            return Promise.reject(Object.assign(new Error('Bad gateway'), { status: 502, body: { error: 'Bad gateway' } }));
          }
          if (methodId === 'sessions.delete' && !methodInfoAvailable) {
            return Promise.reject(Object.assign(new Error('Unknown gateway method'), { status: 404, body: { error: 'Unknown gateway method' } }));
          }
          return Promise.resolve({ method: { id: methodId, invokable: true } });
        },
      },
      sessions: {
        list: () => Promise.resolve(unionListFixture),
        messages: { list: () => Promise.resolve({ messages: [] }) },
        steer: (id: string, body: unknown) => { steerCalls.push({ id, body }); return Promise.resolve({}); },
        followUp: (id: string, body: unknown) => { followUpCalls.push({ id, body }); return Promise.resolve({}); },
        close: (sessionId: string) => {
          unionCloseCalls.push(sessionId);
          unionListFixture = {
            ...unionListFixture,
            sessions: unionListFixture.sessions.map((s) => (s.id === sessionId ? { ...s, status: 'closed' } : s)),
          };
          return Promise.resolve({ session: unionListFixture.sessions.find((s) => s.id === sessionId) });
        },
        reopen: (sessionId: string) => {
          unionReopenCalls.push(sessionId);
          unionListFixture = {
            ...unionListFixture,
            sessions: unionListFixture.sessions.map((s) => (s.id === sessionId ? { ...s, status: 'active' } : s)),
          };
          return Promise.resolve({ session: unionListFixture.sessions.find((s) => s.id === sessionId) });
        },
        delete: (sessionId: string) => {
          unionDeleteCalls.push(sessionId);
          if (unionDeleteReallyRemoves) {
            unionListFixture = {
              ...unionListFixture,
              sessions: unionListFixture.sessions.filter((s) => s.id !== sessionId),
            };
            return Promise.resolve({ sessionId, deleted: true });
          }
          // A daemon whose delete lies (resolves success without actually removing
          // the record) — the proof-of-gone reconcile below must catch this, not the
          // resolved value here.
          return Promise.resolve({ sessionId, deleted: true });
        },
        // sessions.permissionMode.get/set + sessions.contextUsage.get (SDK 1.6.1) —
        // session-scoped, honest SESSION_NOT_LOCAL for any id other than
        // permissionModeLocalId (see that fixture's header comment above).
        permissionMode: {
          get: (sessionId: string) => {
            if (sessionId !== permissionModeLocalId) return sessionNotLocal(sessionId);
            return Promise.resolve({ sessionId, mode: permissionMode });
          },
          set: (sessionId: string, mode: string) => {
            if (sessionId !== permissionModeLocalId) return sessionNotLocal(sessionId);
            permissionModeSetCalls.push({ sessionId, mode });
            const previousMode = permissionMode;
            permissionMode = mode;
            return Promise.resolve({ sessionId, mode, previousMode });
          },
        },
        contextUsage: {
          get: (sessionId: string) => {
            if (sessionId !== permissionModeLocalId) return sessionNotLocal(sessionId);
            if (!contextUsageFixture) {
              return Promise.resolve({ sessionId, estimatedContextTokens: 0, contextWindow: 0, contextUsagePct: 0, contextRemainingTokens: 0, estimated: true });
            }
            return Promise.resolve({ sessionId, ...contextUsageFixture, estimated: true });
          },
        },
      },
      cost: {
        attribution: {
          get: (_input: { window: string; dimension: string }) => Promise.resolve({
            window: '24h', windowStartMs: 1, dimension: 'session',
            totalCostUsd: costAttributionRows.reduce((sum, r) => (r.costUsd === null ? sum : sum + r.costUsd), 0) || null,
            costState: costAttributionRows.length ? 'estimated' : 'unpriced',
            pricedRecordCount: 0, unpricedRecordCount: 0,
            tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
            rows: costAttributionRows,
          }),
        },
      },
    },
  },
}));

const { SessionsView } = await import('./SessionsView');

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
  resetUnionMutationFixtures();
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

  test('reaped-as-reaped: an idle-reaped closed session badges "reaped", not "closed · history"', () => {
    const { el, unmount } = render();
    const reapedRow = [...el.querySelectorAll('.sessions-row')].find((r) => r.textContent?.includes('Reaped session'));
    expect(reapedRow).toBeTruthy();
    expect(reapedRow?.textContent).toContain('reaped');
    expect(reapedRow?.textContent).not.toContain('closed · history');
    const reapedBadge = [...(reapedRow?.querySelectorAll('.badge') ?? [])].find((b) => b.textContent === 'reaped');
    expect(reapedBadge?.className).toContain('info');
    unmount();
  });

  test('a deliberately-closed session still badges "closed · history" alongside a reaped one (both present)', () => {
    const { el, unmount } = render();
    const closedRow = [...el.querySelectorAll('.sessions-row')].find((r) => r.textContent?.includes('Old session'));
    expect(closedRow?.textContent).toContain('closed · history');
    const closedBadge = [...(closedRow?.querySelectorAll('.badge') ?? [])].find((b) => b.textContent === 'closed · history');
    expect(closedBadge?.className).toContain('neutral');
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

async function flushMicrotasks(times = 8) {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('SessionsView: close/reopen/delete (delete-means-delete)', () => {
  const originalConfirm = window.confirm;

  afterEach(() => {
    window.confirm = originalConfirm;
  });

  test('an active session offers Close, never Reopen or a conflated Delete-that-closes', async () => {
    const { el, unmount } = render();
    await flushMicrotasks();
    click([...el.querySelectorAll('.sessions-row')].find((r) => r.textContent?.includes('TUI coding')));
    await flushMicrotasks();

    const actions = el.querySelector('.session-detail__actions');
    expect(actions?.textContent).toContain('Close');
    expect(actions?.textContent).not.toContain('Reopen');
    unmount();
  });

  test('a closed session offers Reopen instead of Close', async () => {
    const { el, unmount } = render();
    await flushMicrotasks();
    click([...el.querySelectorAll('.sessions-row')].find((r) => r.textContent?.includes('Old session')));
    await flushMicrotasks();

    const actions = el.querySelector('.session-detail__actions');
    expect(actions?.textContent).toContain('Reopen');
    expect(actions?.textContent).not.toContain('>Close<');
    unmount();
  });

  test('capability check unavailable (an older daemon): no Delete button renders, an honest note explains why, Close still works', async () => {
    methodInfoAvailable = false;
    const { el, unmount } = render();
    await flushMicrotasks();
    click([...el.querySelectorAll('.sessions-row')].find((r) => r.textContent?.includes('TUI coding')));
    await flushMicrotasks();

    const actions = el.querySelector('.session-detail__actions');
    const deleteButton = [...(actions?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Delete');
    expect(deleteButton).toBeUndefined();
    // Daemon-scoped wording, not per-kind (delete availability is a daemon capability,
    // never a property of the session's kind).
    expect(actions?.textContent).toContain("Permanent delete isn't available on this daemon yet");
    expect(actions?.textContent).not.toContain('tui sessions');

    window.confirm = () => true;
    click([...(actions?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Close'));
    await flushMicrotasks();
    expect(unionCloseCalls).toEqual(['s-tui']);

    unmount();
  });

  test('a TRANSIENT probe failure (5xx/network, not a 404) shows a neutral "couldn\'t check" with a Retry — never a false "unavailable"', async () => {
    methodInfoTransientError = true;
    const { el, unmount } = render();
    await flushMicrotasks();
    click([...el.querySelectorAll('.sessions-row')].find((r) => r.textContent?.includes('TUI coding')));
    await flushMicrotasks();

    const actions = el.querySelector('.session-detail__actions');
    // No Delete button (we can't confirm the verb), but crucially NOT the false
    // "isn't available on this daemon" message a bare isSuccess gate would have shown.
    expect([...(actions?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Delete')).toBeUndefined();
    expect(actions?.textContent).toContain("Couldn't check whether permanent delete is available");
    expect(actions?.textContent).not.toContain("isn't available on this daemon");

    // The recovery path: once the daemon answers, Retry surfaces the real capability.
    const retry = [...(actions?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Retry');
    expect(retry).toBeTruthy();
    methodInfoTransientError = false;
    click(retry);
    await flushMicrotasks();
    const actionsAfter = el.querySelector('.session-detail__actions');
    expect([...(actionsAfter?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Delete')).toBeTruthy();

    unmount();
  });

  test('capability available: the confirm gate blocks delete until accepted', async () => {
    const { el, unmount } = render();
    await flushMicrotasks();
    click([...el.querySelectorAll('.sessions-row')].find((r) => r.textContent?.includes('Old session')));
    await flushMicrotasks();

    window.confirm = () => false;
    const actions = el.querySelector('.session-detail__actions');
    click([...(actions?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Delete'));
    await flushMicrotasks();

    expect(unionCloseCalls).toEqual([]);
    expect(unionDeleteCalls).toEqual([]);
    unmount();
  });

  test('a genuine delete: closes first, then removes — proof-of-gone confirms real absence, session detail clears', async () => {
    window.confirm = () => true;
    unionDeleteReallyRemoves = true;
    const { el, unmount } = render();
    await flushMicrotasks();
    click([...el.querySelectorAll('.sessions-row')].find((r) => r.textContent?.includes('Old session')));
    await flushMicrotasks();

    const actions = el.querySelector('.session-detail__actions');
    click([...(actions?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Delete'));
    await flushMicrotasks();

    expect(unionCloseCalls).toEqual(['s-closed']);
    expect(unionDeleteCalls).toEqual(['s-closed']);
    expect(unionListFixture.sessions.some((s) => s.id === 's-closed')).toBe(false);
    // The record is genuinely gone — the union list no longer renders it, and the
    // detail pane falls back to the empty "select a session" state.
    expect(el.textContent).not.toContain('Old session');
    expect(el.textContent).toContain('Select a session to view and steer it.');
    unmount();
  });

  test('a daemon whose delete lies (200 but the record is not actually gone): the reconcile catches it and surfaces an honest failure', async () => {
    window.confirm = () => true;
    unionDeleteReallyRemoves = false;
    const { el, unmount } = render();
    await flushMicrotasks();
    click([...el.querySelectorAll('.sessions-row')].find((r) => r.textContent?.includes('Old session')));
    await flushMicrotasks();

    const actions = el.querySelector('.session-detail__actions');
    click([...(actions?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Delete'));
    await flushMicrotasks();

    expect(unionDeleteCalls).toEqual(['s-closed']);
    // The mocked delete() resolved {deleted:true} without touching unionListFixture —
    // the reconcile (a fresh sessions.list()) must catch this lie rather than trust it.
    expect(el.textContent).toContain('Old session');
    expect(el.textContent).toContain('Delete did not complete');
    unmount();
  });
});

describe('SessionsView permission-mode control (session-scoped: sessions.permissionMode.get/set)', () => {
  test('no session selected: chip shows "Select a session", disabled', async () => {
    const { el, unmount } = render();
    await flushMicrotasks();
    const chip = el.querySelector('.permission-mode-chip');
    expect(chip?.textContent).toContain('Select a session');
    expect((chip as HTMLButtonElement)?.disabled).toBe(true);
    unmount();
  });

  test('a selected session that is NOT the daemon\'s live local session: honest "unavailable", never a silent daemon-wide fallback', async () => {
    permissionModeLocalId = 'some-other-session';
    const { el, unmount } = render();
    await flushMicrotasks();
    click([...el.querySelectorAll('.sessions-row')].find((r) => r.textContent?.includes('TUI coding')));
    await flushMicrotasks();

    const chip = el.querySelector('.permission-mode-chip');
    expect(chip?.textContent).toContain('Unavailable');
    expect((chip as HTMLButtonElement)?.disabled).toBe(true);
    unmount();
  });

  test('renders the current mode once sessions.permissionMode.get() reports one for the local session', async () => {
    permissionModeLocalId = 's-tui';
    permissionMode = 'plan';
    const { el, unmount } = render();
    await flushMicrotasks();
    click([...el.querySelectorAll('.sessions-row')].find((r) => r.textContent?.includes('TUI coding')));
    await flushMicrotasks();

    const chip = el.querySelector('.permission-mode-chip');
    expect(chip?.textContent).toContain('Plan');
    expect((chip as HTMLButtonElement)?.disabled).toBe(false);
    unmount();
  });

  test('opens a picker sheet and writes the selected mode via sessions.permissionMode.set(sessionId, mode)', async () => {
    permissionModeLocalId = 's-tui';
    const { el, unmount } = render();
    await flushMicrotasks();
    click([...el.querySelectorAll('.sessions-row')].find((r) => r.textContent?.includes('TUI coding')));
    await flushMicrotasks();
    click(el.querySelector('.permission-mode-chip'));
    await flushMicrotasks();

    expect(el.textContent).toContain('Set permission mode');
    const options = [...el.querySelectorAll('.permission-mode-sheet__option')];
    // 'Custom' must never appear as a selectable option — it is read-only on the wire.
    expect(options.some((b) => b.textContent?.startsWith('Custom'))).toBe(false);
    click(options.find((b) => b.textContent?.startsWith('Auto')));
    await flushMicrotasks();

    expect(permissionModeSetCalls).toEqual([{ sessionId: 's-tui', mode: 'auto' }]);
    unmount();
  });
});

describe('SessionsView context-usage chip (session-scoped: sessions.contextUsage.get)', () => {
  test('no local answer available (SESSION_NOT_LOCAL): honest "unavailable"', async () => {
    const { el, unmount } = render();
    await flushMicrotasks();
    click([...el.querySelectorAll('.sessions-row')].find((r) => r.textContent?.includes('TUI coding')));
    await flushMicrotasks();

    const chip = el.querySelector('.context-usage-chip');
    expect(chip?.textContent).toContain('unavailable');
    unmount();
  });

  test('renders the estimate as an approximate percent, prefixed "~", never a bare provider-measured number', async () => {
    permissionModeLocalId = 's-tui';
    contextUsageFixture = { estimatedContextTokens: 62000, contextWindow: 100000, contextUsagePct: 62, contextRemainingTokens: 38000 };
    const { el, unmount } = render();
    await flushMicrotasks();
    click([...el.querySelectorAll('.sessions-row')].find((r) => r.textContent?.includes('TUI coding')));
    await flushMicrotasks();

    const chip = el.querySelector('.context-usage-chip');
    expect(chip?.textContent).toContain('~62%');
    unmount();
  });
});

describe('SessionsView cost chip (cost.attribution.get, SDK 1.6.1)', () => {
  test('a session with no row in the 24h window renders the honest "no cost recorded" state, never a fabricated $0', async () => {
    costAttributionRows = [];
    const { el, unmount } = render();
    await flushMicrotasks();
    click([...el.querySelectorAll('.sessions-row')].find((r) => r.textContent?.includes('TUI coding')));
    await flushMicrotasks();

    const chip = el.querySelector('.cost-chip');
    expect(chip?.textContent).toContain('none (24h)');
    unmount();
  });

  test('a priced row renders a dollar figure', async () => {
    costAttributionRows = [{
      key: 's-tui', costUsd: 0.42, costState: 'priced', pricedRecordCount: 3, unpricedRecordCount: 0,
      tokens: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
    }];
    const { el, unmount } = render();
    await flushMicrotasks();
    click([...el.querySelectorAll('.sessions-row')].find((r) => r.textContent?.includes('TUI coding')));
    await flushMicrotasks();

    const chip = el.querySelector('.cost-chip');
    expect(chip?.textContent).toContain('$0.42');
    expect(chip?.textContent).not.toContain('est.');
    unmount();
  });

  test('an unpriced row renders the explicit "price unknown" marker with its blind spot, never a fabricated dollar amount', async () => {
    costAttributionRows = [{
      key: 's-tui', costUsd: null, costState: 'unpriced', pricedRecordCount: 0, unpricedRecordCount: 2,
      tokens: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
    }];
    const { el, unmount } = render();
    await flushMicrotasks();
    click([...el.querySelectorAll('.sessions-row')].find((r) => r.textContent?.includes('TUI coding')));
    await flushMicrotasks();

    const chip = el.querySelector('.cost-chip');
    expect(chip?.textContent).toContain('price unknown');
    expect(chip?.textContent).not.toContain('$');
    expect(chip?.textContent).toContain('all 2 records unpriced');
    // Manual-price editing is one action away from the display.
    expect(chip?.querySelector('.price-source-note__edit')?.textContent).toContain('price');
    unmount();
  });

  test('an estimated row (a mix of priced and unpriced records) is labeled "(est.)", never presented as a firm figure', async () => {
    costAttributionRows = [{
      key: 's-tui', costUsd: 0.18, costState: 'estimated', pricedRecordCount: 4, unpricedRecordCount: 1,
      tokens: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
    }];
    const { el, unmount } = render();
    await flushMicrotasks();
    click([...el.querySelectorAll('.sessions-row')].find((r) => r.textContent?.includes('TUI coding')));
    await flushMicrotasks();

    const chip = el.querySelector('.cost-chip');
    expect(chip?.textContent).toContain('$0.18 (est.)');
    // The blind spot behind the estimate is stated, not implied.
    expect(chip?.textContent).toContain('1 of 5 records unpriced — dollars shown are a floor');
    unmount();
  });
});
