/**
 * SessionHeader — the paused-stream retry affordance (F6).
 *
 * The retry used to be a hover-`title` on the status badge: invisible on touch and
 * unreachable without a pointer. These tests pin the fix — when onRetryStream is
 * present the header renders an explicit, labelled Retry BUTTON alongside the badge,
 * and clicking it fires the callback; when it is absent the plain badge renders with
 * no button at all.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { SessionHeader } from './SessionHeader';

function render(props: Partial<React.ComponentProps<typeof SessionHeader>> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const full: React.ComponentProps<typeof SessionHeader> = {
    activeSessionId: 's-1',
    activeSessionTitle: 'A chat',
    isRenamingTitle: false,
    sessionTitleDraft: '',
    visibleTurnState: true,
    turnState: 'stream paused',
    onSetRenamingTitle: mock(() => {}),
    onSessionTitleDraftChange: mock(() => {}),
    onFinishRenamingTitle: mock(() => {}),
    onTitleKeyDown: mock(() => {}),
    ...props,
  };
  flushSync(() => root.render(React.createElement(SessionHeader, full)));
  return {
    el: container,
    unmount: () => {
      flushSync(() => root.unmount());
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

afterEach(() => {});

describe('SessionHeader — paused-stream retry affordance', () => {
  test('with onRetryStream, a real, labelled Retry button renders next to the paused badge', () => {
    const onRetryStream = mock(() => {});
    const { el, unmount } = render({ onRetryStream });

    const retry = el.querySelector('.chat-status__retry') as HTMLButtonElement | null;
    expect(retry).toBeTruthy();
    expect(retry?.tagName).toBe('BUTTON');
    // Visible text label, not just a hover-title.
    expect(retry?.textContent).toContain('Retry');
    expect(retry?.getAttribute('aria-label')).toBe('Retry the live stream');
    // The honest paused badge is still present alongside it.
    expect(el.querySelector('.chat-status__paused .badge')?.textContent).toBe('stream paused');
    unmount();
  });

  test('clicking Retry fires onRetryStream', () => {
    const onRetryStream = mock(() => {});
    const { el, unmount } = render({ onRetryStream });
    const retry = el.querySelector('.chat-status__retry') as HTMLButtonElement;
    flushSync(() => retry.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    expect(onRetryStream).toHaveBeenCalledTimes(1);
    unmount();
  });

  test('without onRetryStream, the plain badge renders and there is NO retry button', () => {
    const { el, unmount } = render({ onRetryStream: undefined, turnState: 'streaming' });
    expect(el.querySelector('.chat-status__retry')).toBeNull();
    expect(el.querySelector('.chat-status .badge')?.textContent).toBe('streaming');
    unmount();
  });
});
