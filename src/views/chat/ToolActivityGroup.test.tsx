/**
 * DOM render tests for ToolActivityGroup — the fold that keeps completed tool
 * calls visible on an assistant message instead of letting them evaporate once
 * the turn ends (see useChatStream's toolActivityByMessageId doc comment).
 *
 * Verifies:
 * 1. A single tool call renders one compact entry directly (no outer fold).
 * 2. Multiple tool calls fold behind a <details>/<summary> with a real,
 *    counted summary line.
 * 3. The summary line groups by friendly label with honest ×N counts.
 * 4. A long result renders truncated with the full text behind expand.
 * 5. A short result renders inline, with no truncation affordance.
 * 6. An error result gets the error styling hook + badge.
 * 7. Zero tool calls renders nothing.
 *
 * Uses createRoot + flushSync (project pattern from toast.dom.test.tsx).
 */
import { describe, expect, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ToolActivityGroup } from './ToolActivityGroup';
import type { CompletedToolCall } from './message-utils';

function render(toolActivity: readonly CompletedToolCall[]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(ToolActivityGroup, { toolActivity }));
  });
  return {
    container,
    unmount: () => {
      flushSync(() => { root.unmount(); });
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

describe('ToolActivityGroup — single tool call', () => {
  test('renders one compact entry directly, no outer <details> fold', () => {
    const { container, unmount } = render([
      { toolCallId: 'call-1', toolName: 'bash', toolInput: { command: 'ls -la' }, result: 'file.txt', isError: false },
    ]);
    expect(container.querySelector('details.message-tool-activity--group')).toBeNull();
    expect(container.querySelector('ul.message-tool-activity--single')).not.toBeNull();
    expect(container.querySelectorAll('.message-tool-activity__item').length).toBe(1);
    expect(container.querySelector('.message-tool-activity__label')?.textContent).toBe('exec');
    expect(container.querySelector('.message-tool-activity__arg')?.textContent).toBe('ls -la');
    unmount();
  });

  test('a short result renders inline (no truncation affordance)', () => {
    const { container, unmount } = render([
      { toolCallId: 'call-1', toolName: 'read', result: 'short content', isError: false },
    ]);
    expect(container.querySelector('.message-tool-activity__result-inline')?.textContent).toBe('short content');
    expect(container.querySelector('.message-tool-activity__result')).toBeNull();
    unmount();
  });

  test('a long result renders truncated, with the full text behind expand', () => {
    const longResult = 'x'.repeat(500);
    const { container, unmount } = render([
      { toolCallId: 'call-1', toolName: 'read', result: longResult, isError: false },
    ]);
    const details = container.querySelector('details.message-tool-activity__result');
    expect(details).not.toBeNull();
    expect((details as HTMLDetailsElement).open).toBe(false);
    const summary = details?.querySelector('summary')?.textContent ?? '';
    expect(summary.length).toBeLessThan(longResult.length);
    expect(summary.endsWith('…')).toBe(true);
    expect(details?.querySelector('pre')?.textContent).toBe(longResult);
    unmount();
  });

  test('an error result gets the error styling class and badge', () => {
    const { container, unmount } = render([
      { toolCallId: 'call-1', toolName: 'bash', result: 'command not found', isError: true },
    ]);
    expect(container.querySelector('.message-tool-activity__item--error')).not.toBeNull();
    expect(container.querySelector('.message-tool-activity__error-badge')?.textContent).toBe('error');
    unmount();
  });

  test('a call with no result renders no result block', () => {
    const { container, unmount } = render([
      { toolCallId: 'call-1', toolName: 'bash', isError: false },
    ]);
    expect(container.querySelector('.message-tool-activity__result-inline')).toBeNull();
    expect(container.querySelector('.message-tool-activity__result')).toBeNull();
    unmount();
  });
});

describe('ToolActivityGroup — multiple tool calls', () => {
  const multi: CompletedToolCall[] = [
    { toolCallId: 'call-1', toolName: 'read', result: 'a', isError: false },
    { toolCallId: 'call-2', toolName: 'read', result: 'b', isError: false },
    { toolCallId: 'call-3', toolName: 'bash', result: 'c', isError: false },
  ];

  test('folds behind a closed <details> with a real, counted summary line', () => {
    const { container, unmount } = render(multi);
    const details = container.querySelector('details.message-tool-activity--group') as HTMLDetailsElement | null;
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
    expect(details!.querySelector('summary')?.textContent).toBe('3 tools · read×2, exec — expand');
    unmount();
  });

  test('expanding renders every tool call as its own entry, in order', () => {
    const { container, unmount } = render(multi);
    const items = container.querySelectorAll('.message-tool-activity__item');
    expect(items.length).toBe(3);
    expect(items[0]?.querySelector('.message-tool-activity__label')?.textContent).toBe('read');
    expect(items[2]?.querySelector('.message-tool-activity__label')?.textContent).toBe('exec');
    unmount();
  });
});

describe('ToolActivityGroup — no tool calls', () => {
  test('renders nothing at all', () => {
    const { container, unmount } = render([]);
    expect(container.innerHTML).toBe('');
    unmount();
  });
});
