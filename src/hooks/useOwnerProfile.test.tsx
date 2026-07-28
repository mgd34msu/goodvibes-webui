/**
 * useOwnerProfile — what the write hooks actually SEND on the wire.
 *
 * This file exists because the panel's own tests mock these hooks, so they assert what the
 * UI does with an answer and can say nothing about the request. A contract change that
 * made `authority` required on every profile write went unnoticed for exactly that reason:
 * a mock that accepts anything accepts a body the daemon would 400. So every assertion
 * here is on the request payload, not on the response.
 *
 * The generated input types cannot catch this either — `authority` is optional in
 * OperatorMethodInput<'profile.set'> and friends (the schemas' `required` arrays do not
 * list it) while routes/owner-profile.ts's readAuthority refuses an absent value at
 * runtime. The handler is stricter than the declared schema, which leaves this test as the
 * only thing standing between a missing authority and a 400 against a real daemon.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

interface WireCall {
  readonly verb: string;
  readonly input: unknown;
}

let calls: WireCall[] = [];

const WRITE_ANSWER = { ok: true, reason: null, changes: [], disclosure: '' };

function record(verb: string, input: unknown): Promise<unknown> {
  calls.push({ verb, input });
  return Promise.resolve(WRITE_ANSWER);
}

// queries.ts imports getCurrentAuth/invokeMethod/sdk from this module, so all three must
// be present or the module fails to link.
mock.module('../lib/goodvibes', () => ({
  getCurrentAuth: () => Promise.resolve({}),
  invokeMethod: () => Promise.resolve({}),
  sdk: {
    operator: {
      profile: {
        read: () => Promise.resolve({ state: { kind: 'loaded', path: '/p' }, sections: [] }),
        status: () => Promise.resolve({ kind: 'loaded', path: '/p' }),
        get: (fieldId: string) => record('get', { fieldId }),
        person: (name: string) => record('person', { name }),
        provenance: (fieldId: string) => record('provenance', { fieldId }),
        set: (input: unknown) => record('set', input),
        append: (input: unknown) => record('append', input),
        forget: (input: unknown) => record('forget', input),
        undo: (input: unknown) => record('undo', input),
      },
    },
  },
}));

const {
  useAppendOwnerProfileLine,
  useForgetOwnerProfile,
  useSetOwnerProfileField,
  useUndoOwnerProfile,
} = await import('./useOwnerProfile');

interface Harness {
  setField: (fieldId: string, value: string) => void;
  appendLine: (section: string, text: string) => void;
  forgetField: (fieldId: string) => void;
  forgetLine: (lineIndex: number) => void;
  undoField: (fieldId: string) => void;
}

let harness: Harness | null = null;
let cleanup: (() => void) | null = null;

function render(): void {
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

  function Probe() {
    const setField = useSetOwnerProfileField();
    const appendLine = useAppendOwnerProfileLine();
    const forget = useForgetOwnerProfile();
    const undo = useUndoOwnerProfile();
    harness = {
      setField: (fieldId, value) => { setField.mutate({ fieldId, value }); },
      appendLine: (section, text) => { appendLine.mutate({ section, text }); },
      forgetField: (fieldId) => { forget.mutate({ kind: 'field', fieldId }); },
      forgetLine: (lineIndex) => { forget.mutate({ kind: 'line', lineIndex }); },
      undoField: (fieldId) => { undo.mutate(fieldId); },
    };
    return null;
  }

  flushSync(() => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Probe)));
  });

  cleanup = () => {
    flushSync(() => { root.unmount(); });
    if (container.parentNode) container.parentNode.removeChild(container);
    client.clear();
  };
}

/** react-query runs mutationFn asynchronously; wait for the call to land. */
async function nextCall(): Promise<WireCall> {
  for (let i = 0; i < 20; i += 1) {
    if (calls.length > 0) return calls[0] as WireCall;
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  }
  throw new Error('no wire call was made');
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
  harness = null;
  calls = [];
});

/** The claim this surface makes about where a fact came from (§7 layer 1). */
const AUTHORITY = 'owner-direct';

describe('every profile write states its authority', () => {
  test('profile.set sends authority owner-direct, with the settings-surface provenance pair', async () => {
    render();
    harness?.setField('contact.phone', '+1 517 555 0199');
    const call = await nextCall();
    expect(call.verb).toBe('set');
    expect(call.input).toEqual({
      fieldId: 'contact.phone',
      value: '+1 517 555 0199',
      surface: 'webui',
      said: '(edited in settings)',
      authority: AUTHORITY,
    });
  });

  test('profile.append sends authority owner-direct', async () => {
    render();
    harness?.appendLine('People', 'Ken, neighbour');
    const call = await nextCall();
    expect(call.verb).toBe('append');
    expect(call.input).toEqual({
      section: 'People',
      text: 'Ken, neighbour',
      surface: 'webui',
      said: '(edited in settings)',
      authority: AUTHORITY,
    });
  });

  // The removal verbs matter most: §7 gives them an authority check and nothing else, so
  // an unstated authority here would be no gate at all rather than a weakened one.
  test('profile.forget sends authority owner-direct alongside a field target', async () => {
    render();
    harness?.forgetField('contact.phone');
    const call = await nextCall();
    expect(call.verb).toBe('forget');
    expect(call.input).toEqual({ fieldId: 'contact.phone', authority: AUTHORITY });
  });

  test('profile.forget sends authority owner-direct alongside a line target', async () => {
    render();
    harness?.forgetLine(41);
    const call = await nextCall();
    expect(call.verb).toBe('forget');
    expect(call.input).toEqual({ lineIndex: 41, authority: AUTHORITY });
  });

  test('profile.undo sends authority owner-direct', async () => {
    render();
    harness?.undoField('commerce.shippingAddress');
    const call = await nextCall();
    expect(call.verb).toBe('undo');
    expect(call.input).toEqual({ fieldId: 'commerce.shippingAddress', authority: AUTHORITY });
  });

  test('no write omits authority, and none sends explicitUserRequest', async () => {
    // explicitUserRequest is deliberately absent: refuseNonUserRequest() refuses only an
    // explicit `false`, and this surface cannot know the answer, so it makes no claim.
    render();
    harness?.setField('contact.phone', 'x');
    await nextCall();
    harness?.appendLine('Notes', 'y');
    harness?.forgetField('contact.phone');
    harness?.undoField('contact.phone');
    for (let i = 0; i < 20 && calls.length < 4; i += 1) {
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    }
    expect(calls.length).toBe(4);
    for (const call of calls) {
      const input = call.input as Record<string, unknown>;
      expect(input.authority, `${call.verb} omitted authority`).toBe(AUTHORITY);
      expect('explicitUserRequest' in input, `${call.verb} sent explicitUserRequest`).toBe(false);
    }
  });
});
