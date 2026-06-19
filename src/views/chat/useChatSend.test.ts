/**
 * Unit tests for useChatSend branch-tracking logic.
 *
 * Tests use a lightweight React DOM harness (createRoot + flushSync) with
 * a real QueryClientProvider. The sdk module is mocked to prevent HTTP calls.
 * The mutation's network path is exercised only as a no-op stub — branch state
 * changes (the focus of these tests) are synchronous and testable in isolation.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useChatSend } from './useChatSend';
import type { UseChatSendReturn } from './useChatSend';
import type { ChatMessage } from './types';
import type { LocalCompanionMessage } from '../../lib/companion-chat';

// ---------------------------------------------------------------------------
// Mock sdk — prevents real HTTP calls from the mutation function
// ---------------------------------------------------------------------------
mock.module('../../lib/goodvibes', () => ({
  sdk: {
    chat: {
      sessions: { create: async () => ({ sessionId: 'sess-test' }) },
      messages: { create: async () => ({ messageId: 'msg-test' }) },
    },
    artifacts: { create: async () => ({ artifactId: 'art-test' }) },
  },
}));

// ---------------------------------------------------------------------------
// Hook harness
// ---------------------------------------------------------------------------

type HarnessOptions = {
  localMessages?: LocalCompanionMessage[];
  activeSessionId?: string;
};

type HarnessResult = {
  getReturn: () => UseChatSendReturn;
  getLocalMessages: () => LocalCompanionMessage[];
  unmount: () => void;
  queryClient: QueryClient;
};

function renderHook(opts: HarnessOptions = {}): HarnessResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const localMessages: LocalCompanionMessage[] = opts.localMessages
    ? [...opts.localMessages]
    : [];

  let returnValue!: UseChatSendReturn;

  function HookOwner(): null {
    const result = useChatSend({
      activeSessionId: opts.activeSessionId ?? 'sess-1',
      onActiveSessionChange: () => undefined,
      onDraftSessionRequestedChange: () => undefined,
      onLocalSessionCreated: () => undefined,
      onSessionMissing: () => undefined,
      setTurnState: () => undefined,
      setTurnError: () => undefined,
      setLiveText: () => undefined,
      setLocalMessages: (updater) => {
        if (typeof updater === 'function') {
          const next = updater(localMessages);
          // Mutate the array in-place so callers see the update
          localMessages.splice(0, localMessages.length, ...next);
        } else {
          localMessages.splice(0, localMessages.length, ...updater);
        }
      },
      setPendingUserMessageId: () => undefined,
      invalidateChatState: async () => undefined,
    });
    React.useLayoutEffect(() => { returnValue = result; });
    return null;
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  flushSync(() => {
    root.render(
      React.createElement(QueryClientProvider, { client: queryClient },
        React.createElement(HookOwner),
      ),
    );
  });

  return {
    getReturn: () => returnValue,
    getLocalMessages: () => localMessages,
    unmount: () => {
      flushSync(() => { root.unmount(); });
      if (container.parentNode) container.parentNode.removeChild(container);
    },
    queryClient,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUserMessage(id: string, content: string): LocalCompanionMessage {
  return {
    id,
    sessionId: 'sess-1',
    role: 'user',
    content,
    createdAt: Date.now(),
    deliveryState: 'sent',
  };
}

function makeChatMessage(id: string, role: string, content: string): ChatMessage {
  return { id, role, content, sessionId: 'sess-1' };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

let harness: HarnessResult | null = null;

afterEach(() => {
  if (harness) {
    harness.unmount();
    harness = null;
  }
});

// ---------------------------------------------------------------------------
// editAndResend
// ---------------------------------------------------------------------------

describe('editAndResend', () => {
  test('truncates local messages to before the edited message (no duplicate user bubble)', () => {
    const msgs: LocalCompanionMessage[] = [
      makeUserMessage('u1', 'Hello'),
      makeUserMessage('u2', 'World'), // this is the one we will "edit"
    ];
    harness = renderHook({ localMessages: msgs });
    const { editAndResend } = harness.getReturn();

    flushSync(() => {
      editAndResend('u2', 'World edited');
    });

    // setLocalMessages should have been called with a truncation to idx=1,
    // which means the slice is [...msgs.slice(0, 1)] = [u1]. The mutation
    // will re-add a new user message but we inspect ONLY the synchronous
    // truncation here (before the async mutation fires).
    const local = harness.getLocalMessages();
    // After synchronous truncation: only messages BEFORE index 1 remain.
    expect(local.length).toBe(1);
    expect(local[0].id).toBe('u1');
  });

  test('records original text as variant 0 before the new text as variant 1', () => {
    const msgs: LocalCompanionMessage[] = [
      makeUserMessage('u1', 'Original text'),
    ];
    harness = renderHook({ localMessages: msgs });
    const { editAndResend, branchMap } = harness.getReturn();

    flushSync(() => {
      editAndResend('u1', 'Edited text');
    });

    const record = harness.getReturn().branchMap.get('u1');
    expect(record).toBeDefined();
    if (!record) return;

    expect(record.variants.length).toBe(2);
    expect(record.variants[0].text).toBe('Original text');
    expect(record.variants[1].text).toBe('Edited text');
    // After recording, currentIndex should point to the latest variant
    expect(record.currentIndex).toBe(1);
    void branchMap; // suppress unused-var lint
  });

  test('does nothing when newText is empty or whitespace', () => {
    const msgs: LocalCompanionMessage[] = [
      makeUserMessage('u1', 'Hello'),
    ];
    harness = renderHook({ localMessages: msgs });
    const { editAndResend } = harness.getReturn();

    flushSync(() => {
      editAndResend('u1', '   ');
    });

    // No local message mutation and no variant recorded
    const local = harness.getLocalMessages();
    expect(local.length).toBe(1);
    expect(harness.getReturn().branchMap.get('u1')).toBeUndefined();
  });

  test('does not mutate local messages when messageId is not found', () => {
    const msgs: LocalCompanionMessage[] = [
      makeUserMessage('u1', 'Hello'),
    ];
    harness = renderHook({ localMessages: msgs });
    const { editAndResend } = harness.getReturn();

    flushSync(() => {
      editAndResend('unknown-id', 'Edited text');
    });

    // Local messages unchanged (idx === -1 guard)
    const local = harness.getLocalMessages();
    expect(local.length).toBe(1);
    // Variant IS recorded even when message not in local state (keyed by id)
    const record = harness.getReturn().branchMap.get('unknown-id');
    expect(record).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// regenerateFrom
// ---------------------------------------------------------------------------

describe('regenerateFrom', () => {
  test('records original assistant text as variant 0 (not empty string)', () => {
    const userMsg = makeChatMessage('u1', 'user', 'Tell me a joke');
    const assistantMsg = makeChatMessage('a1', 'assistant', 'Why did the chicken cross the road?');
    const messages: ChatMessage[] = [userMsg, assistantMsg];

    // Local state mirrors the messages
    const localMsgs: LocalCompanionMessage[] = [
      makeUserMessage('u1', 'Tell me a joke'),
    ];
    harness = renderHook({ localMessages: localMsgs });
    const { regenerateFrom } = harness.getReturn();

    flushSync(() => {
      regenerateFrom('a1', messages);
    });

    const record = harness.getReturn().branchMap.get('a1');
    expect(record).toBeDefined();
    if (!record) return;

    // variant 0 must have the original assistant text, not empty string
    expect(record.variants.length).toBe(2);
    expect(record.variants[0].text).toBe('Why did the chicken cross the road?');
    // variant 1 is the regeneration placeholder (empty until streaming completes)
    expect(record.variants[1].text).toBe('');
  });

  test('truncates local messages to before the user message (no duplicate user bubble)', () => {
    const userMsg = makeChatMessage('u1', 'user', 'Tell me a joke');
    const assistantMsg = makeChatMessage('a1', 'assistant', 'Why did the chicken cross the road?');
    const messages: ChatMessage[] = [userMsg, assistantMsg];

    const localMsgs: LocalCompanionMessage[] = [
      makeUserMessage('u1', 'Tell me a joke'),
    ];
    harness = renderHook({ localMessages: localMsgs });
    const { regenerateFrom } = harness.getReturn();

    flushSync(() => {
      regenerateFrom('a1', messages);
    });

    // After truncation: local messages should be empty because we drop the
    // user message at keepUntil=0 using slice(0, 0). The mutation re-adds it.
    const local = harness.getLocalMessages();
    expect(local.length).toBe(0);
  });

  test('does nothing when assistant message is not found', () => {
    const messages: ChatMessage[] = [
      makeChatMessage('u1', 'user', 'Hello'),
    ];
    harness = renderHook({});
    const { regenerateFrom } = harness.getReturn();

    flushSync(() => {
      regenerateFrom('unknown-id', messages);
    });

    expect(harness.getReturn().branchMap.size).toBe(0);
  });

  test('does nothing when no preceding user message is found', () => {
    const messages: ChatMessage[] = [
      makeChatMessage('a1', 'assistant', 'I appear alone'),
    ];
    harness = renderHook({});
    const { regenerateFrom } = harness.getReturn();

    flushSync(() => {
      regenerateFrom('a1', messages);
    });

    expect(harness.getReturn().branchMap.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// selectBranch
// ---------------------------------------------------------------------------

describe('selectBranch', () => {
  test('clamps index at lower bound (no-op for index < 0)', () => {
    harness = renderHook({});
    const { editAndResend, selectBranch } = harness.getReturn();

    // Seed two variants via editAndResend
    flushSync(() => {
      editAndResend('u1', 'First');
    });

    // At this point currentIndex === 1 (pointing to 'First' variant)
    const before = harness.getReturn().branchMap.get('u1')?.currentIndex;
    expect(before).toBe(1);

    flushSync(() => {
      selectBranch('u1', -1);
    });

    // Index out of range — should not change
    const after = harness.getReturn().branchMap.get('u1')?.currentIndex;
    expect(after).toBe(1);
  });

  test('clamps index at upper bound (no-op for index >= variants.length)', () => {
    harness = renderHook({});
    const { editAndResend, selectBranch } = harness.getReturn();

    flushSync(() => {
      editAndResend('u1', 'First');
    });

    // variants.length is 2 (original + edited); valid range is 0..1
    flushSync(() => {
      selectBranch('u1', 2);
    });

    const after = harness.getReturn().branchMap.get('u1')?.currentIndex;
    expect(after).toBe(1);
  });

  test('updates currentIndex to selected variant', () => {
    harness = renderHook({});
    const { editAndResend, selectBranch } = harness.getReturn();

    flushSync(() => {
      editAndResend('u1', 'First');
    });

    // Navigate back to variant 0 (original)
    flushSync(() => {
      selectBranch('u1', 0);
    });

    const record = harness.getReturn().branchMap.get('u1');
    expect(record?.currentIndex).toBe(0);
  });

  test('content swap: branchRecord.variants[currentIndex].text reflects selected variant', () => {
    harness = renderHook({});
    const { editAndResend, selectBranch } = harness.getReturn();

    flushSync(() => {
      editAndResend('u1', 'Edited text');
    });

    // Navigate to variant 0 — should see original text
    flushSync(() => {
      selectBranch('u1', 0);
    });

    const record = harness.getReturn().branchMap.get('u1');
    expect(record?.variants[record.currentIndex].text).toBe('');
  });

  test('does nothing for unknown rootMessageId', () => {
    harness = renderHook({});
    const { selectBranch } = harness.getReturn();

    // Should not throw, and branchMap stays empty
    flushSync(() => {
      selectBranch('nonexistent', 0);
    });

    expect(harness.getReturn().branchMap.size).toBe(0);
  });
});
