/**
 * OwnerProfileSettings — the admin owner-profile panel.
 *
 * The two assertions this file exists for, both honesty rules from
 * docs/owner-profile.md:
 *   - a profile that could not be read renders its REASON, never an empty profile
 *     (§4.4: "I could not open the file" and "I know nothing about you" are different
 *     sentences);
 *   - a forget of something that was not there reports that it was not there, and never
 *     renders as a success (§9.2).
 *
 * Everything else here covers the states around them: loading, a daemon that does not
 * serve the verbs at all, the turned-off state, the loaded document (mechanical fields as
 * labelled values, his prose as prose), the People section's containment marking, the
 * supersede/undo affordance, and the per-line provenance disclosure.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type {
  ProfileDocument,
  ProfileForgetOutcome,
  ProfileProvenanceAnswer,
  ProfileStatus,
  ProfileTarget,
  ProfileWriteOutcome,
} from '../../lib/owner-profile';

interface QueryLike<T> {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error?: unknown;
  data?: T;
  refetch: () => void;
}

interface MutationLike<TVars, TResult> {
  isPending: boolean;
  mutate: (
    vars: TVars,
    options?: { onSuccess?: (result: TResult) => void; onError?: (error: unknown) => void },
  ) => void;
}

function idleQuery<T>(): QueryLike<T> {
  return { isPending: false, isError: false, isSuccess: false, refetch: () => { /* no-op */ } };
}

function successQuery<T>(data: T): QueryLike<T> {
  return { isPending: false, isError: false, isSuccess: true, data, refetch: () => { /* no-op */ } };
}

function errorQuery<T>(error: unknown): QueryLike<T> {
  return { isPending: false, isError: true, isSuccess: false, error, refetch: () => { /* no-op */ } };
}

let mockDocument: QueryLike<ProfileDocument> = idleQuery();
let mockStatus: QueryLike<ProfileStatus> = idleQuery();
let mockProvenance: QueryLike<ProfileProvenanceAnswer> = idleQuery();
let provenanceTargets: (ProfileTarget | null)[] = [];

let setCalls: { key: string; value: string }[] = [];
let setResult: ProfileWriteOutcome = { changed: true, stated: true };
let appendCalls: { section: string; text: string }[] = [];
let forgetCalls: ProfileTarget[] = [];
let forgetResult: ProfileForgetOutcome = { verdict: 'deleted', removed: [] };
let undoCalls: ProfileTarget[] = [];
let undoResult: ProfileWriteOutcome = { changed: true, stated: true };

const setMutation: MutationLike<{ key: string; value: string }, ProfileWriteOutcome> = {
  isPending: false,
  mutate: (vars, options) => { setCalls.push(vars); options?.onSuccess?.(setResult); },
};
const appendMutation: MutationLike<{ section: string; text: string }, ProfileWriteOutcome> = {
  isPending: false,
  mutate: (vars, options) => { appendCalls.push(vars); options?.onSuccess?.({ changed: true, stated: true }); },
};
const forgetMutation: MutationLike<ProfileTarget, ProfileForgetOutcome> = {
  isPending: false,
  mutate: (vars, options) => { forgetCalls.push(vars); options?.onSuccess?.(forgetResult); },
};
const undoMutation: MutationLike<ProfileTarget, ProfileWriteOutcome> = {
  isPending: false,
  mutate: (vars, options) => { undoCalls.push(vars); options?.onSuccess?.(undoResult); },
};

mock.module('../../hooks/useOwnerProfile', () => ({
  useOwnerProfileDocument: () => mockDocument,
  useOwnerProfileStatus: () => mockStatus,
  useOwnerProfileProvenance: (target: ProfileTarget | null) => {
    provenanceTargets.push(target);
    return mockProvenance;
  },
  useSetOwnerProfileField: () => setMutation,
  useAppendOwnerProfileLine: () => appendMutation,
  useForgetOwnerProfile: () => forgetMutation,
  useUndoOwnerProfile: () => undoMutation,
}));

const { OwnerProfileSettings } = await import('./OwnerProfileSettings');

function render(): { el: HTMLElement; unmount: () => void } {
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => { root.render(React.createElement(OwnerProfileSettings)); });
  return {
    el: container,
    unmount: () => {
      flushSync(() => { root.unmount(); });
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

/**
 * Let the confirm sheet's promise continuation run and React render the result. The
 * forget flow is genuinely asynchronous — the sheet resolves, THEN the mutation runs —
 * so the state update lands outside any React event handler and needs both a real task
 * tick and an explicit flush before it is observable.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    flushSync(() => { /* flush whatever the continuation queued */ });
  }
}

function buttonIn(scope: Element | null, label: string): HTMLButtonElement {
  const found = Array.from(scope?.querySelectorAll('button') ?? []).find(
    (button) => (button.textContent ?? '').startsWith(label),
  );
  if (!found) throw new Error(`No "${label}" button found`);
  return found;
}

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  mockDocument = idleQuery();
  mockStatus = idleQuery();
  mockProvenance = idleQuery();
  provenanceTargets = [];
  setCalls = [];
  setResult = { changed: true, stated: true };
  appendCalls = [];
  forgetCalls = [];
  forgetResult = { verdict: 'deleted', removed: [] };
  undoCalls = [];
  undoResult = { changed: true, stated: true };
});

const LOADED: ProfileDocument = {
  state: 'loaded',
  path: '/home/owner/.goodvibes/daemon/owner-profile.md',
  sections: [
    {
      id: 'contact',
      name: 'Contact',
      fields: [
        { key: 'contact.email', label: 'email', value: 'owner@example.com', valid: true, supersededCount: 0 },
        { key: 'contact.phone', label: 'phone', value: '+1 517 555 0134', valid: true, supersededCount: 0 },
      ],
      lines: [],
    },
    {
      id: 'commerce',
      name: 'Commerce',
      fields: [
        {
          key: 'commerce.shippingAddress',
          label: 'shipping address',
          value: '200 Office Way, Lansing, MI 48933, US',
          valid: true,
          supersededCount: 1,
          provenance: { surface: 'tui', date: '2026-07-27', said: 'ship it to my office instead' },
        },
      ],
      lines: [],
    },
    {
      id: 'people',
      name: 'People',
      fields: [],
      lines: [
        { text: 'Sarah, sister, sarah@example.com', lineIndex: 41 },
        { text: 'Dave from work, handles the Pellux contracts' },
      ],
    },
  ],
};

describe('OwnerProfileSettings', () => {
  test('loading renders a skeleton and no sections', () => {
    mockDocument = { isPending: true, isError: false, isSuccess: false, refetch: () => { /* no-op */ } };
    const { el, unmount } = render();
    cleanup = unmount;
    expect(el.textContent).toContain('Owner profile');
    expect(el.querySelector('.owner-profile__section')).toBeNull();
  });

  test('a daemon that does not serve the verbs (404) says so, not "empty profile"', () => {
    mockDocument = errorQuery(Object.assign(new Error('Unknown gateway method'), { status: 404, code: 'METHOD_NOT_FOUND' }));
    const { el, unmount } = render();
    cleanup = unmount;
    expect(el.textContent).toContain('This daemon does not serve an owner profile');
    expect(el.textContent).not.toContain('loaded and empty');
  });

  test('a genuine fetch failure renders a retriable error, distinct from the unavailable state', () => {
    mockDocument = errorQuery(Object.assign(new Error('network down'), { status: 0, category: 'network' }));
    const { el, unmount } = render();
    cleanup = unmount;
    expect(el.textContent).toContain('Owner profile unavailable');
    expect(el.querySelector('.feedback-error-state__retry')).not.toBeNull();
  });

  // The load-bearing honesty assertion (§4.4).
  test('an unavailable profile renders its reason, NOT an empty profile', () => {
    mockDocument = successQuery<ProfileDocument>({
      state: 'unavailable',
      reason: 'permission denied',
      path: '/home/owner/.goodvibes/daemon/owner-profile.md',
      sections: [],
    });
    mockStatus = successQuery<ProfileStatus>({
      state: 'unavailable',
      reason: 'permission denied',
      path: '/home/owner/.goodvibes/daemon/owner-profile.md',
      sectionNames: [],
      invalidFields: [],
    });
    const { el, unmount } = render();
    cleanup = unmount;

    const banner = el.querySelector('[data-testid="profile-unavailable"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('Your profile could not be read: permission denied');
    expect(banner?.textContent).toContain('/home/owner/.goodvibes/daemon/owner-profile.md');
    expect(el.textContent).toContain('not because your profile is empty');
    // No empty-profile state, and no sections, are rendered in its place.
    expect(el.textContent).not.toContain('Your profile is loaded and empty');
    expect(el.querySelector('.owner-profile__section')).toBeNull();
    expect(el.querySelector('[data-testid="profile-status"]')?.textContent).toContain('Could not be read');
  });

  test('a turned-off profile is a stated state, not an empty one', () => {
    mockDocument = successQuery<ProfileDocument>({ state: 'disabled', sections: [] });
    const { el, unmount } = render();
    cleanup = unmount;
    expect(el.querySelector('[data-testid="profile-disabled"]')?.textContent).toContain('turned off');
    expect(el.textContent).not.toContain('Your profile is loaded and empty');
  });

  test('a loaded profile renders mechanical fields as labelled values and prose as prose', () => {
    mockDocument = successQuery(LOADED);
    const { el, unmount } = render();
    cleanup = unmount;

    const email = el.querySelector('[data-testid="profile-field-contact.email"]');
    expect(email?.querySelector('.owner-profile__field-label')?.textContent).toBe('email');
    expect(email?.querySelector('.owner-profile__value')?.textContent).toBe('owner@example.com');

    // His prose is rendered as the line he wrote — not split into label/value columns.
    const people = el.querySelector('[data-testid="profile-section-people"]');
    expect(people?.querySelectorAll('.owner-profile__field').length).toBe(0);
    expect(people?.textContent).toContain('Sarah, sister, sarah@example.com');
    expect(people?.textContent).toContain('Dave from work, handles the Pellux contracts');

    // The compact provenance suffix rides the line it belongs to (§4.2).
    const shipping = el.querySelector('[data-testid="profile-field-commerce.shippingAddress"]');
    expect(shipping?.textContent).toContain('tui, 2026-07-27 — "ship it to my office instead"');
  });

  test('the People section is marked as third-party material and carries its containment note', () => {
    mockDocument = successQuery(LOADED);
    const { el, unmount } = render();
    cleanup = unmount;
    const people = el.querySelector('[data-testid="profile-section-people"]');
    expect(people?.getAttribute('data-third-party')).toBe('true');
    expect(people?.querySelector('.owner-profile__containment')?.textContent).toContain('facts about other people');
    // No link, no copy affordance — plain inert text only.
    expect(people?.querySelector('a')).toBeNull();
    const contact = el.querySelector('[data-testid="profile-section-contact"]');
    expect(contact?.getAttribute('data-third-party')).toBeNull();
  });

  test('an invalid mechanical value is shown as written, with its reason', () => {
    mockDocument = successQuery<ProfileDocument>({
      state: 'loaded',
      sections: [
        {
          id: 'location',
          name: 'Location',
          fields: [
            {
              key: 'location.timezone',
              label: 'timezone',
              value: 'Mars/Olympus',
              valid: false,
              invalidReason: 'not an IANA time zone',
              supersededCount: 0,
            },
          ],
          lines: [],
        },
      ],
    });
    const { el, unmount } = render();
    cleanup = unmount;
    expect(el.textContent).toContain('Mars/Olympus');
    expect(el.textContent).toContain('not an IANA time zone');
    expect(el.textContent).toContain('falls back as if it were unset');
  });

  test('editing a field calls profile.set and reports the supersede', () => {
    mockDocument = successQuery(LOADED);
    const { el, unmount } = render();
    cleanup = unmount;

    const row = el.querySelector('[data-testid="profile-field-contact.phone"]');
    flushSync(() => { buttonIn(row, 'Edit').click(); });

    const input = el.querySelector<HTMLInputElement>('[data-testid="profile-field-contact.phone"] input');
    expect(input).not.toBeNull();
    const form = input?.closest('form');
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '+1 517 555 0199');
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    }
    flushSync(() => { form?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });

    expect(setCalls.length).toBe(1);
    expect(setCalls[0]?.key).toBe('contact.phone');
    expect(el.querySelector('.owner-profile__report')?.textContent).toContain('Undo puts it back');
  });

  test('Undo is offered only where a superseded value exists', () => {
    mockDocument = successQuery(LOADED);
    const { el, unmount } = render();
    cleanup = unmount;

    const shipping = el.querySelector('[data-testid="profile-field-commerce.shippingAddress"]');
    const email = el.querySelector('[data-testid="profile-field-contact.email"]');
    expect(Array.from(shipping?.querySelectorAll('button') ?? []).some((b) => (b.textContent ?? '').startsWith('Undo'))).toBe(true);
    expect(Array.from(email?.querySelectorAll('button') ?? []).some((b) => (b.textContent ?? '').startsWith('Undo'))).toBe(false);

    flushSync(() => { buttonIn(shipping, 'Undo').click(); });
    expect(undoCalls).toEqual([{ kind: 'field', key: 'commerce.shippingAddress' }]);
  });

  // The second load-bearing honesty assertion (§9.2).
  test('forgetting something that was not there reports that — never a success', async () => {
    mockDocument = successQuery(LOADED);
    forgetResult = { verdict: 'not-present', key: 'contact.phone', removed: [] };
    const { el, unmount } = render();
    cleanup = unmount;

    const row = el.querySelector('[data-testid="profile-field-contact.phone"]');
    flushSync(() => { buttonIn(row, 'Forget').click(); });

    // Confirm first — deleting is permanent, so it is never a bare click.
    const confirmButton = window.document.querySelector<HTMLButtonElement>('.confirm-sheet__confirm');
    expect(confirmButton).not.toBeNull();
    flushSync(() => { confirmButton?.click(); });
    await settle();

    expect(forgetCalls).toEqual([{ kind: 'field', key: 'contact.phone' }]);
    const report = el.querySelector('.owner-profile__report')?.textContent ?? '';
    expect(report).toContain('Nothing to forget — phone was not in your profile.');
    expect(report).not.toContain('Deleted');
  });

  test('a forget the daemon does not confirm is reported as unclear, not as a deletion', async () => {
    mockDocument = successQuery(LOADED);
    forgetResult = { verdict: 'unclear', removed: [] };
    const { el, unmount } = render();
    cleanup = unmount;

    flushSync(() => { buttonIn(el.querySelector('[data-testid="profile-field-contact.phone"]'), 'Forget').click(); });
    flushSync(() => { window.document.querySelector<HTMLButtonElement>('.confirm-sheet__confirm')?.click(); });
    await settle();

    const report = el.querySelector('.owner-profile__report')?.textContent ?? '';
    expect(report).toContain('did not say whether phone was deleted');
    expect(report).not.toContain('Deleted phone');
  });

  test('a real deletion names what actually went', async () => {
    mockDocument = successQuery(LOADED);
    forgetResult = { verdict: 'deleted', key: 'contact.phone', removed: ['contact.phone'] };
    const { el, unmount } = render();
    cleanup = unmount;

    flushSync(() => { buttonIn(el.querySelector('[data-testid="profile-field-contact.phone"]'), 'Forget').click(); });
    flushSync(() => { window.document.querySelector<HTMLButtonElement>('.confirm-sheet__confirm')?.click(); });
    await settle();

    expect(el.querySelector('.owner-profile__report')?.textContent).toContain('Deleted contact.phone from your profile.');
  });

  test('cancelling the confirm deletes nothing', async () => {
    mockDocument = successQuery(LOADED);
    const { el, unmount } = render();
    cleanup = unmount;

    flushSync(() => { buttonIn(el.querySelector('[data-testid="profile-field-contact.phone"]'), 'Forget').click(); });
    flushSync(() => { window.document.querySelector<HTMLButtonElement>('.confirm-sheet__cancel')?.click(); });
    await settle();

    expect(forgetCalls.length).toBe(0);
  });

  test('provenance is reachable per line, and asks only for the line it was opened on', () => {
    mockDocument = successQuery(LOADED);
    mockProvenance = successQuery<ProfileProvenanceAnswer>({
      found: true,
      handEdited: false,
      provenance: { surface: 'tui', date: '2026-07-20', said: 'ship to 401 Home St' },
      superseded: [
        {
          value: '401 Home St, Lansing, MI 48933, US',
          provenance: { surface: 'tui', date: '2026-07-20', said: 'ship to 401 Home St' },
          supersededOn: '2026-07-27',
        },
      ],
    });
    const { el, unmount } = render();
    cleanup = unmount;

    // Nothing is fetched until it is asked for — no bulk dump on mount.
    expect(el.querySelector('[data-testid="profile-provenance-detail"]')).toBeNull();

    const shipping = el.querySelector('[data-testid="profile-field-commerce.shippingAddress"]');
    flushSync(() => { buttonIn(shipping, 'Where did you get that?').click(); });

    const detail = shipping?.querySelector('[data-testid="profile-provenance-detail"]');
    expect(detail?.textContent).toContain('401 Home St, Lansing, MI 48933, US');
    expect(detail?.textContent).toContain('superseded 2026-07-27');
    expect(provenanceTargets).toContainEqual({ kind: 'field', key: 'commerce.shippingAddress' });
    // Only the opened line was asked about.
    expect(provenanceTargets.filter((target) => target !== null).length).toBe(1);
  });

  test('a hand-edited line says so rather than inventing a source', () => {
    mockDocument = successQuery(LOADED);
    mockProvenance = successQuery<ProfileProvenanceAnswer>({ found: true, handEdited: true, superseded: [] });
    const { el, unmount } = render();
    cleanup = unmount;

    flushSync(() => { buttonIn(el.querySelector('[data-testid="profile-field-contact.email"]'), 'Where did you get that?').click(); });
    expect(el.querySelector('[data-testid="profile-provenance-detail"]')?.textContent).toContain(
      'No provenance recorded — you wrote or edited this line by hand.',
    );
  });

  test('a prose line with no address offers no forget, and says why', () => {
    mockDocument = successQuery(LOADED);
    const { el, unmount } = render();
    cleanup = unmount;

    const lines = el.querySelectorAll('[data-testid="profile-section-people"] .owner-profile__line');
    const addressless = lines[1];
    expect(Array.from(addressless?.querySelectorAll('button') ?? []).some((b) => b.textContent === 'Forget')).toBe(false);
    flushSync(() => { buttonIn(addressless ?? null, 'Where did you get that?').click(); });
    expect(addressless?.textContent).toContain('no address of its own');
  });

  test('the status strip surfaces invalid fields by name and reason, with no values', () => {
    mockDocument = successQuery(LOADED);
    mockStatus = successQuery<ProfileStatus>({
      state: 'loaded',
      path: '/home/owner/.goodvibes/daemon/owner-profile.md',
      sectionNames: ['Contact', 'Commerce', 'People'],
      lineCount: 42,
      fieldCount: 11,
      invalidFields: [{ key: 'location.timezone', reason: 'not an IANA time zone' }],
    });
    const { el, unmount } = render();
    cleanup = unmount;
    const strip = el.querySelector('[data-testid="profile-status"]');
    expect(strip?.textContent).toContain('Loaded');
    expect(strip?.textContent).toContain('42 lines');
    const invalid = el.querySelector('.owner-profile__invalid-list');
    expect(invalid?.textContent).toContain('location.timezone — not an IANA time zone');
  });

  test('adding a line calls profile.append for that section', () => {
    mockDocument = successQuery(LOADED);
    const { el, unmount } = render();
    cleanup = unmount;

    const notes = el.querySelector('[data-testid="profile-section-people"]');
    flushSync(() => { buttonIn(notes, 'Add a line to').click(); });
    const input = notes?.querySelector<HTMLInputElement>('input');
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'Ken, neighbour');
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    }
    flushSync(() => {
      input?.closest('form')?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(appendCalls).toEqual([{ section: 'people', text: 'Ken, neighbour' }]);
  });
});
