/**
 * DOM render tests for MessageList.
 *
 * Verifies:
 * 1. Caret shows only when isStreaming=true AND liveText is non-empty
 * 2. Stop button renders only when onStop is provided
 * 3. aria-label "Stop generating" is present on the stop button
 * 4. reduced-motion class is applied to caret when useReducedMotion returns true
 * 5. aria-live region is present during streaming
 *
 * Uses createRoot + flushSync (project pattern from toast.dom.test.tsx).
 * matchMedia is stubbed in test-setup.ts — useReducedMotion reads it via
 * window.matchMedia; we override it per-test when needed.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MessageList } from './MessageList';
import { PeekProvider } from '../../components/peek/PeekPanel';
import { ToastProvider } from '../../lib/toast';
import type { LineageNode } from './lineage';
import type { ChatMessage } from './types';
import type { ActiveToolCall } from './useChatStream';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = () => {};

const baseProps = {
  nodes: [] as LineageNode[],
  liveText: '',
  showJumpToBottom: false,
  isSendPending: false,
  copiedMessageId: '',
  highlightedMessageId: '',
  scrollRef: { current: null } as React.RefObject<HTMLDivElement | null>,
  onScroll: noop,
  onJumpToBottom: noop,
  onCopyMessage: noop as (m: ChatMessage) => void,
  onResendMessage: noop as (m: ChatMessage) => void,
  onRegenerateFrom: noop as (messageId: string) => void,
};

function renderMessageList(props: Partial<typeof baseProps & {
  isStreaming?: boolean;
  onStop?: () => void;
  activeToolCalls?: readonly ActiveToolCall[];
  onCancelToolCall?: (callId: string) => void;
}> = {}) {
  const merged = { ...baseProps, ...props };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  flushSync(() => {
    // MessageItem calls useArtifactsPanel unconditionally (for its "View
    // artifacts" affordance), which needs ToastProvider + PeekProvider
    // ancestors whenever `nodes` is non-empty — most existing tests here pass
    // nodes: [] and never actually mount a MessageItem, but the highlight
    // tests below do.
    root.render(
      React.createElement(
        ToastProvider,
        null,
        React.createElement(PeekProvider, null, React.createElement(MessageList, merged)),
      ),
    );
  });

  return {
    container,
    unmount: () => {
      flushSync(() => { root.unmount(); });
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Default matchMedia stub returns matches: false (motion allowed)
  installGlobal('matchMedia', (_query: string) => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  // Reset to default no-motion stub
  installGlobal('matchMedia', (_query: string) => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
});

/** Redefine a globalThis property (mirrors test-setup.ts pattern). */
function installGlobal(key: string, value: unknown): void {
  try {
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  } catch {
    // non-configurable — skip
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MessageList — streaming caret', () => {
  test('caret renders while streaming even before the first token — Stop must be reachable during the thinking window', () => {
    const { container, unmount } = renderMessageList({ isStreaming: true, liveText: '' });
    expect(container.querySelector('.stream-caret')).not.toBeNull();
    unmount();
  });

  test('caret is absent when liveText present but isStreaming is false', () => {
    const { container, unmount } = renderMessageList({ isStreaming: false, liveText: 'hello' });
    expect(container.querySelector('.stream-caret')).toBeNull();
    unmount();
  });

  test('caret is absent when isStreaming is omitted (default false)', () => {
    const { container, unmount } = renderMessageList({ liveText: 'hello' });
    expect(container.querySelector('.stream-caret')).toBeNull();
    unmount();
  });

  test('caret is present when isStreaming=true AND liveText is non-empty', () => {
    const { container, unmount } = renderMessageList({ isStreaming: true, liveText: 'typing...' });
    expect(container.querySelector('.stream-caret')).not.toBeNull();
    unmount();
  });
});

describe('MessageList — Stop button', () => {
  test('Stop button is absent when onStop is not provided', () => {
    const { container, unmount } = renderMessageList({ isStreaming: true, liveText: 'typing...' });
    expect(container.querySelector('.stream-stop-btn')).toBeNull();
    unmount();
  });

  test('Stop button is present when onStop is provided and streaming', () => {
    const { container, unmount } = renderMessageList({
      isStreaming: true,
      liveText: 'typing...',
      onStop: noop,
    });
    const btn = container.querySelector('.stream-stop-btn');
    expect(btn).not.toBeNull();
    unmount();
  });

  test('Stop button has aria-label "Stop generating"', () => {
    const { container, unmount } = renderMessageList({
      isStreaming: true,
      liveText: 'typing...',
      onStop: noop,
    });
    const btn = container.querySelector('.stream-stop-btn');
    expect(btn?.getAttribute('aria-label')).toBe('Stop generating');
    unmount();
  });

  test('Stop button calls onStop when clicked', () => {
    const onStop = mock(noop);
    const { container, unmount } = renderMessageList({
      isStreaming: true,
      liveText: 'typing...',
      onStop,
    });
    const btn = container.querySelector('.stream-stop-btn') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    flushSync(() => { btn!.click(); });
    expect(onStop).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe('MessageList — aria attributes', () => {
  test('aria-live polite region is present during streaming', () => {
    const { container, unmount } = renderMessageList({ isStreaming: true, liveText: 'hello' });
    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    unmount();
  });

  test('aria-live region renders while streaming even before the first token (the responding bubble)', () => {
    const { container, unmount } = renderMessageList({ isStreaming: true, liveText: '' });
    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    unmount();
  });

  test('aria-live region is absent when idle with no liveText', () => {
    const { container, unmount } = renderMessageList({ isStreaming: false, liveText: '' });
    expect(container.querySelector('[aria-live="polite"]')).toBeNull();
    unmount();
  });

  test('stream-caret has aria-hidden=true', () => {
    const { container, unmount } = renderMessageList({ isStreaming: true, liveText: 'text' });
    const caret = container.querySelector('.stream-caret');
    expect(caret?.getAttribute('aria-hidden')).toBe('true');
    unmount();
  });
});

describe('MessageList — search jump-to-message highlight', () => {
  // Both nodes use tone 'user': an assistant node with text would also mount
  // SpeakButton (useTts -> real sdk.operator.voice.status() network call —
  // unrelated to what this suite covers), so 'user' keeps the fixture
  // focused on the highlight/data-message-id wiring under test.
  const nodes: LineageNode[] = [
    { message: { id: 'msg-1', role: 'user', content: 'first' } as ChatMessage, priorMessages: [] },
    { message: { id: 'msg-2', role: 'user', content: 'second' } as ChatMessage, priorMessages: [] },
  ];

  test('each rendered message carries its id as data-message-id, for the scroll-to-message lookup', () => {
    const { container, unmount } = renderMessageList({ nodes });
    const articles = container.querySelectorAll('article.message');
    expect(articles.length).toBe(2);
    expect(articles[0]?.getAttribute('data-message-id')).toBe('msg-1');
    expect(articles[1]?.getAttribute('data-message-id')).toBe('msg-2');
    unmount();
  });

  test('highlightedMessageId flashes only the matching message', () => {
    const { container, unmount } = renderMessageList({ nodes, highlightedMessageId: 'msg-2' });
    const first = container.querySelector('[data-message-id="msg-1"]');
    const second = container.querySelector('[data-message-id="msg-2"]');
    expect(first?.classList.contains('message--search-highlight')).toBe(false);
    expect(second?.classList.contains('message--search-highlight')).toBe(true);
    unmount();
  });

  test('no message is highlighted when highlightedMessageId is omitted (default "")', () => {
    const { container, unmount } = renderMessageList({ nodes });
    expect(container.querySelector('.message--search-highlight')).toBeNull();
    unmount();
  });

  test('no message is highlighted when highlightedMessageId does not match any loaded message', () => {
    const { container, unmount } = renderMessageList({ nodes, highlightedMessageId: 'msg-does-not-exist' });
    expect(container.querySelector('.message--search-highlight')).toBeNull();
    unmount();
  });
});

describe('MessageList — reduced-motion class', () => {
  test('stream-caret--reduced class is NOT applied when prefers-reduced-motion is false', () => {
    // matchMedia returns matches: false (set in beforeEach)
    const { container, unmount } = renderMessageList({ isStreaming: true, liveText: 'typing...' });
    const caret = container.querySelector('.stream-caret');
    expect(caret?.classList.contains('stream-caret--reduced')).toBe(false);
    unmount();
  });

  test('stream-caret--reduced class IS applied when prefers-reduced-motion is true', () => {
    // Override matchMedia to simulate prefers-reduced-motion: reduce
    installGlobal('matchMedia', (_query: string) => ({
      matches: true,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));

    const { container, unmount } = renderMessageList({ isStreaming: true, liveText: 'typing...' });
    const caret = container.querySelector('.stream-caret');
    expect(caret?.classList.contains('stream-caret--reduced')).toBe(true);
    unmount();
  });
});

describe('MessageList — running tool calls + cancel (SDK 1.8.0 interaction-wins round)', () => {
  test('no active-tool-calls list renders when activeToolCalls is empty', () => {
    const { container, unmount } = renderMessageList({ isStreaming: true, liveText: 'typing...' });
    expect(container.querySelector('.active-tool-calls')).toBeNull();
    unmount();
  });

  test('a running tool call renders with a Cancel button', () => {
    const { container, unmount } = renderMessageList({
      isStreaming: true,
      liveText: 'typing...',
      activeToolCalls: [{ turnId: 't1', toolCallId: 'call-1', toolName: 'bash', cancelled: false }],
      onCancelToolCall: noop as (callId: string) => void,
    });
    const item = container.querySelector('.active-tool-call');
    expect(item?.textContent).toContain('Running: bash');
    const cancelBtn = item?.querySelector('.active-tool-call__cancel');
    expect(cancelBtn).not.toBeNull();
    expect(cancelBtn?.getAttribute('aria-label')).toBe('Cancel tool call bash');
    unmount();
  });

  test('clicking Cancel calls onCancelToolCall with the toolCallId', () => {
    const calls: string[] = [];
    const { container, unmount } = renderMessageList({
      isStreaming: true,
      liveText: 'typing...',
      activeToolCalls: [{ turnId: 't1', toolCallId: 'call-1', toolName: 'bash', cancelled: false }],
      onCancelToolCall: (callId: string) => { calls.push(callId); },
    });
    const cancelBtn = container.querySelector('.active-tool-call__cancel') as HTMLButtonElement;
    flushSync(() => { cancelBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    expect(calls).toEqual(['call-1']);
    unmount();
  });

  test('a cancelled tool call shows "Cancelled" and no Cancel button', () => {
    const { container, unmount } = renderMessageList({
      isStreaming: true,
      liveText: 'typing...',
      activeToolCalls: [{ turnId: 't1', toolCallId: 'call-1', toolName: 'bash', cancelled: true }],
      onCancelToolCall: noop as (callId: string) => void,
    });
    const item = container.querySelector('.active-tool-call');
    expect(item?.textContent).toContain('Cancelled: bash');
    expect(item?.querySelector('.active-tool-call__cancel')).toBeNull();
    unmount();
  });

  test('multiple concurrent tool calls each render their own row', () => {
    const { container, unmount } = renderMessageList({
      isStreaming: true,
      liveText: 'typing...',
      activeToolCalls: [
        { turnId: 't1', toolCallId: 'call-1', toolName: 'bash', cancelled: false },
        { turnId: 't1', toolCallId: 'call-2', toolName: 'read', cancelled: false },
      ],
      onCancelToolCall: noop as (callId: string) => void,
    });
    expect(container.querySelectorAll('.active-tool-call').length).toBe(2);
    unmount();
  });

  test('the Cancel button clears the 44px phone-width tap-target floor via its CSS class', () => {
    const { container, unmount } = renderMessageList({
      isStreaming: true,
      liveText: 'typing...',
      activeToolCalls: [{ turnId: 't1', toolCallId: 'call-1', toolName: 'bash', cancelled: false }],
      onCancelToolCall: noop as (callId: string) => void,
    });
    const cancelBtn = container.querySelector('.active-tool-call__cancel');
    expect(cancelBtn?.className).toContain('active-tool-call__cancel');
    unmount();
  });
});
