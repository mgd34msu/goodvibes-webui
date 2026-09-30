/**
 * DOM render tests for ToolActivityGroup, the fold that keeps completed tool
 * calls visible on an assistant message instead of letting them evaporate once
 * the turn ends (see useChatStream's toolActivityByMessageId doc comment).
 *
 * Verifies:
 * 1. Every turn, one call or many, collapses to ONE closed line
 *    ("Read 2 files, ran 1 command · 4 s") that expands inline.
 * 2. The line counts honestly, names failures, and shows a duration only
 *    when this browser timed the calls.
 * 3. Expanded, each call renders its label, key argument and result.
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

describe('ToolActivityGroup: the collapsed line', () => {
  test('a single tool call collapses to one closed line naming what it did', () => {
    const { container, unmount } = render([
      { toolCallId: 'call-1', toolName: 'bash', toolInput: { command: 'ls -la' }, result: 'file.txt', isError: false },
    ]);
    const details = container.querySelector('details.message-tool-activity') as HTMLDetailsElement | null;
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
    expect(details!.querySelector('.message-tool-activity__line')?.textContent).toBe('Ran 1 command');
    unmount();
  });

  test('several calls read as one sentence with real counts', () => {
    const { container, unmount } = render([
      { toolCallId: 'call-1', toolName: 'read', result: 'a', isError: false },
      { toolCallId: 'call-2', toolName: 'read', result: 'b', isError: false },
      { toolCallId: 'call-3', toolName: 'WebSearch', result: 'c', isError: false },
    ]);
    expect(container.querySelector('.message-tool-activity__line')?.textContent).toBe('Read 2 files, searched the web');
    expect(container.querySelectorAll('details.message-tool-activity').length).toBe(1);
    unmount();
  });

  test('the duration shows when this browser timed the calls', () => {
    const { container, unmount } = render([
      { toolCallId: 'call-1', toolName: 'read', isError: false, startedAt: 1_000, finishedAt: 2_000 },
      { toolCallId: 'call-2', toolName: 'websearch', isError: false, startedAt: 2_100, finishedAt: 5_200 },
    ]);
    expect(container.querySelector('.message-tool-activity__line')?.textContent).toBe('Read 1 file, searched the web · 4 s');
    unmount();
  });

  test('a failed call is counted in the line, not hidden', () => {
    const { container, unmount } = render([
      { toolCallId: 'call-1', toolName: 'bash', result: 'command not found', isError: true },
    ]);
    expect(container.querySelector('.message-tool-activity__line')?.textContent).toBe('Ran 1 command, 1 failed');
    expect(container.querySelector('.message-tool-activity--has-error')).not.toBeNull();
    unmount();
  });
});

describe('ToolActivityGroup: the expanded detail', () => {
  test('each call renders its label and key argument, in order', () => {
    const { container, unmount } = render([
      { toolCallId: 'call-1', toolName: 'bash', toolInput: { command: 'ls -la' }, result: 'file.txt', isError: false },
      { toolCallId: 'call-2', toolName: 'read', toolInput: { file_path: '/a.ts' }, result: 'x', isError: false },
    ]);
    const items = container.querySelectorAll('.message-tool-activity__item');
    expect(items.length).toBe(2);
    expect(items[0]?.querySelector('.message-tool-activity__label')?.textContent).toBe('exec');
    expect(items[0]?.querySelector('.message-tool-activity__arg')?.textContent).toBe('ls -la');
    expect(items[1]?.querySelector('.message-tool-activity__label')?.textContent).toBe('read');
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

describe('ToolActivityGroup: no tool calls', () => {
  test('renders nothing at all', () => {
    const { container, unmount } = render([]);
    expect(container.innerHTML).toBe('');
    unmount();
  });
});
