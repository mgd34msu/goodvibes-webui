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
import type { ChatMessage } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = () => {};

const baseProps = {
  renderedMessageItems: [] as ChatMessage[],
  liveText: '',
  showJumpToBottom: false,
  isSendPending: false,
  copiedMessageId: '',
  scrollRef: { current: null } as React.RefObject<HTMLDivElement | null>,
  onScroll: noop,
  onJumpToBottom: noop,
  onCopyMessage: noop as (m: ChatMessage) => void,
  onResendMessage: noop as (m: ChatMessage) => void,
  onRegenerateFrom: noop as (messageId: string) => void,
};

function renderMessageList(props: Partial<typeof baseProps & { isStreaming?: boolean; onStop?: () => void }> = {}) {
  const merged = { ...baseProps, ...props };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  flushSync(() => {
    root.render(React.createElement(MessageList, merged));
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
  test('caret is absent when liveText is empty regardless of isStreaming', () => {
    const { container, unmount } = renderMessageList({ isStreaming: true, liveText: '' });
    expect(container.querySelector('.stream-caret')).toBeNull();
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

  test('aria-live region is absent when liveText is empty', () => {
    const { container, unmount } = renderMessageList({ isStreaming: true, liveText: '' });
    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeNull();
    unmount();
  });

  test('stream-caret has aria-hidden=true', () => {
    const { container, unmount } = renderMessageList({ isStreaming: true, liveText: 'text' });
    const caret = container.querySelector('.stream-caret');
    expect(caret?.getAttribute('aria-hidden')).toBe('true');
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
