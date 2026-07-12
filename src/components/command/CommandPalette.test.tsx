/**
 * DOM render tests for CommandPalette
 *
 * Uses react-dom/client + flushSync (same pattern as useAnnouncer.test.tsx).
 * Tests: open/close rendering, fuzzy filter, keyboard nav (↑↓ Enter Esc Tab),
 * grouped headings, aria-activedescendant tracking, backdrop click, item click.
 *
 * Registry is cleaned before/after each test to prevent cross-test bleed.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { CommandPalette } from './CommandPalette';
import { registerCommand, unregisterCommand, getCommands } from '../../lib/commands';
import type { CommandDef } from '../../lib/commands';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Root = ReturnType<typeof createRoot>;

function renderPalette(
  props: { open: boolean; onClose: () => void },
): { container: HTMLElement; root: Root; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => { root.render(<CommandPalette {...props} />); });
  return {
    container,
    root,
    unmount: () => {
      flushSync(() => { root.unmount(); });
      container.parentNode?.removeChild(container);
    },
  };
}

/** Fire a keydown event on the dialog element (where onKeyDown lives). */
function fireKeyDown(container: HTMLElement, key: string, options: KeyboardEventInit = {}): void {
  const dialog = container.querySelector('[role="dialog"]') as HTMLElement | null;
  if (!dialog) throw new Error('dialog not found');
  const event = new KeyboardEvent('keydown', { key, bubbles: true, ...options });
  dialog.dispatchEvent(event);
  flushSync(() => {});
}

/** Make a minimal CommandDef for tests. */
function makeCmd(
  id: string,
  overrides: Partial<CommandDef> = {},
): CommandDef {
  return {
    id,
    title: id,
    group: 'system' as const,
    run: () => undefined,
    ...overrides,
  };
}

// IDs we register per test — cleaned up in afterEach.
const TEST_CMD_IDS = [
  'test.alpha',
  'test.beta',
  'test.gamma',
  'test.navigation',
];

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Clear ALL commands so tests start from a known empty registry.
  for (const cmd of getCommands()) {
    unregisterCommand(cmd.id);
  }

  // Register a predictable set of test commands.
  registerCommand(makeCmd('test.alpha', {
    title: 'Alpha Command',
    group: 'system',
    keywords: ['first'],
    shortcut: 'a',
  }));
  registerCommand(makeCmd('test.beta', {
    title: 'Beta Command',
    group: 'system',
    keywords: ['second'],
    shortcut: 'b',
  }));
  registerCommand(makeCmd('test.gamma', {
    title: 'Gamma Navigation',
    group: 'navigation',
    keywords: ['third'],
  }));
});

afterEach(() => {
  for (const id of TEST_CMD_IDS) {
    unregisterCommand(id);
  }
  // Belt-and-suspenders: clear any stray commands.
  for (const cmd of getCommands()) {
    unregisterCommand(cmd.id);
  }
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('CommandPalette — rendering', () => {
  test('renders nothing when open=false', () => {
    const onClose = mock(() => undefined);
    const { container, unmount } = renderPalette({ open: false, onClose });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    unmount();
  });

  test('renders dialog when open=true', () => {
    const onClose = mock(() => undefined);
    const { container, unmount } = renderPalette({ open: true, onClose });
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-label')).toBe('Command palette');
    unmount();
  });

  test('renders search input with correct aria attributes', () => {
    const onClose = mock(() => undefined);
    const { container, unmount } = renderPalette({ open: true, onClose });
    const input = container.querySelector('input[aria-label="Search commands"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.getAttribute('aria-autocomplete')).toBe('list');
    expect(input?.getAttribute('aria-controls')).toBe('cmd-listbox');

    // Verify the listbox element the input points to actually exists with correct role.
    const listbox = container.querySelector('#cmd-listbox');
    expect(listbox).not.toBeNull();
    expect(listbox?.getAttribute('role')).toBe('listbox');
    unmount();
  });

  test('renders grouped section headings', () => {
    const onClose = mock(() => undefined);
    const { container, unmount } = renderPalette({ open: true, onClose });
    // We have commands in 'system' and 'navigation' groups.
    const groupLabels = Array.from(container.querySelectorAll('.cmd-group-label')).map(
      (el) => el.textContent,
    );
    // GROUP_LABELS maps 'system' -> 'System', 'navigation' -> 'Navigation'
    expect(groupLabels).toContain('System');
    expect(groupLabels).toContain('Navigation');
    unmount();
  });

  test('renders shortcut hint for commands that have one', () => {
    const onClose = mock(() => undefined);
    const { container, unmount } = renderPalette({ open: true, onClose });
    const kbds = Array.from(container.querySelectorAll('kbd')).map((k) => k.textContent);
    expect(kbds).toContain('a');
    expect(kbds).toContain('b');
    unmount();
  });

  test('shows empty state when query matches nothing', () => {
    // Clear registry so filteredCommands.length === 0 from the start.
    for (const cmd of getCommands()) unregisterCommand(cmd.id);

    const onClose = mock(() => undefined);
    const { container, unmount } = renderPalette({ open: true, onClose });

    const emptyEl = container.querySelector('.cmd-empty');
    expect(emptyEl).not.toBeNull();
    // Source: `No commands match "{query}"` where query is '' on open.
    expect(emptyEl?.textContent).toContain('No commands match');
    unmount();
  });
});

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

describe('CommandPalette — keyboard navigation', () => {
  test('first item is active by default (aria-selected=true on first option)', () => {
    const onClose = mock(() => undefined);
    const { container, unmount } = renderPalette({ open: true, onClose });
    const options = container.querySelectorAll('[role="option"]');
    expect(options.length).toBeGreaterThan(0);
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    unmount();
  });

  test('ArrowDown moves active item to next', () => {
    const onClose = mock(() => undefined);
    const { container, unmount } = renderPalette({ open: true, onClose });

    const optionsBefore = container.querySelectorAll('[role="option"]');
    expect(optionsBefore[0].getAttribute('aria-selected')).toBe('true');

    fireKeyDown(container, 'ArrowDown');

    const optionsAfter = container.querySelectorAll('[role="option"]');
    expect(optionsAfter[0].getAttribute('aria-selected')).toBe('false');
    expect(optionsAfter[1].getAttribute('aria-selected')).toBe('true');
    unmount();
  });

  test('ArrowUp from index 1 returns to index 0', () => {
    const onClose = mock(() => undefined);
    const { container, unmount } = renderPalette({ open: true, onClose });

    // Move down first.
    fireKeyDown(container, 'ArrowDown');
    const mid = container.querySelectorAll('[role="option"]');
    expect(mid[1].getAttribute('aria-selected')).toBe('true');

    // Then back up.
    fireKeyDown(container, 'ArrowUp');
    const after = container.querySelectorAll('[role="option"]');
    expect(after[0].getAttribute('aria-selected')).toBe('true');
    expect(after[1].getAttribute('aria-selected')).toBe('false');
    unmount();
  });

  test('ArrowDown clamps at last item', () => {
    const onClose = mock(() => undefined);
    const { container, unmount } = renderPalette({ open: true, onClose });

    const total = container.querySelectorAll('[role="option"]').length;
    // Press ArrowDown total+5 times to exceed the list length.
    for (let i = 0; i < total + 5; i++) {
      fireKeyDown(container, 'ArrowDown');
    }
    const options = container.querySelectorAll('[role="option"]');
    expect(options[total - 1].getAttribute('aria-selected')).toBe('true');
    unmount();
  });

  test('ArrowUp clamps at first item', () => {
    const onClose = mock(() => undefined);
    const { container, unmount } = renderPalette({ open: true, onClose });

    // Press ArrowUp 10 times from index 0.
    for (let i = 0; i < 10; i++) {
      fireKeyDown(container, 'ArrowUp');
    }
    const options = container.querySelectorAll('[role="option"]');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    unmount();
  });

  test('aria-activedescendant tracks the active item id', () => {
    const onClose = mock(() => undefined);
    const { container, unmount } = renderPalette({ open: true, onClose });

    const input = container.querySelector('input') as HTMLInputElement;
    // Index 0 is active: the first option's id should be set.
    const firstOption = container.querySelectorAll('[role="option"]')[0];
    const firstId = firstOption.getAttribute('id');
    expect(input.getAttribute('aria-activedescendant')).toBe(firstId);

    // Move down — aria-activedescendant should update to second option id.
    fireKeyDown(container, 'ArrowDown');
    const secondOption = container.querySelectorAll('[role="option"]')[1];
    const secondId = secondOption.getAttribute('id');
    expect(input.getAttribute('aria-activedescendant')).toBe(secondId);

    unmount();
  });

  test('Tab moves active item forward (same as ArrowDown)', () => {
    const onClose = mock(() => undefined);
    const { container, unmount } = renderPalette({ open: true, onClose });

    expect(container.querySelectorAll('[role="option"]')[0].getAttribute('aria-selected')).toBe('true');
    fireKeyDown(container, 'Tab');
    expect(container.querySelectorAll('[role="option"]')[1].getAttribute('aria-selected')).toBe('true');
    unmount();
  });

  test('Shift+Tab moves active item backward', () => {
    const onClose = mock(() => undefined);
    const { container, unmount } = renderPalette({ open: true, onClose });

    // Move to index 1 first.
    fireKeyDown(container, 'Tab');
    expect(container.querySelectorAll('[role="option"]')[1].getAttribute('aria-selected')).toBe('true');

    // Shift+Tab back to 0.
    fireKeyDown(container, 'Tab', { shiftKey: true });
    expect(container.querySelectorAll('[role="option"]')[0].getAttribute('aria-selected')).toBe('true');
    unmount();
  });
});

// ---------------------------------------------------------------------------
// Dispatch / close
// ---------------------------------------------------------------------------

describe('CommandPalette — command dispatch and close', () => {
  test('Enter runs the active command and calls onClose', () => {
    const ran = mock(() => undefined);
    const onClose = mock(() => undefined);

    // Register a command we can track.
    registerCommand(makeCmd('test.runme', { title: 'Run Me', group: 'system', run: ran }));

    const { container, unmount } = renderPalette({ open: true, onClose });

    // Navigate to the 'Run Me' command by iterating until it's active.
    const options = Array.from(container.querySelectorAll('[role="option"]'));
    const targetIdx = options.findIndex((el) => el.textContent?.includes('Run Me'));
    expect(targetIdx).toBeGreaterThanOrEqual(0);

    for (let i = 0; i < targetIdx; i++) {
      fireKeyDown(container, 'ArrowDown');
    }

    fireKeyDown(container, 'Enter');

    expect(ran).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    unregisterCommand('test.runme');
    unmount();
  });

  test('Escape calls onClose without running any command', () => {
    const ran = mock(() => undefined);
    const onClose = mock(() => undefined);
    registerCommand(makeCmd('test.escape', { title: 'Escape Me', group: 'system', run: ran }));

    const { container, unmount } = renderPalette({ open: true, onClose });
    fireKeyDown(container, 'Escape');

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(ran).not.toHaveBeenCalled();

    unregisterCommand('test.escape');
    unmount();
  });

  test('backdrop click calls onClose', () => {
    const onClose = mock(() => undefined);
    const { container, unmount } = renderPalette({ open: true, onClose });

    // The backdrop is the outermost div with role="presentation".
    const backdrop = container.querySelector('[role="presentation"]') as HTMLElement | null;
    expect(backdrop).not.toBeNull();

    // Simulate a click where currentTarget === target (i.e. direct backdrop click).
    const clickEvent = new MouseEvent('click', { bubbles: true });
    // Make target appear as the backdrop itself by dispatching on the element.
    // React's handler checks event.target === event.currentTarget.
    // Direct dispatch on the element satisfies that.
    backdrop!.dispatchEvent(clickEvent);
    flushSync(() => {});

    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
  });

  test('clicking an item runs its command and calls onClose', () => {
    const ran = mock(() => undefined);
    const onClose = mock(() => undefined);
    registerCommand(makeCmd('test.clickme', { title: 'Click Me', group: 'system', run: ran }));

    const { container, unmount } = renderPalette({ open: true, onClose });

    const options = Array.from(container.querySelectorAll('[role="option"]'));
    const target = options.find((el) => el.textContent?.includes('Click Me')) as HTMLElement | undefined;
    expect(target).toBeDefined();

    flushSync(() => {
      target!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(ran).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    unregisterCommand('test.clickme');
    unmount();
  });
});

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

describe('CommandPalette — fuzzy filter via registry + re-render', () => {
  test('all commands shown when palette opens (empty query)', () => {
    const onClose = mock(() => undefined);
    const { container, unmount } = renderPalette({ open: true, onClose });

    const options = container.querySelectorAll('[role="option"]');
    // 3 commands registered in beforeEach
    expect(options.length).toBe(3);
    unmount();
  });

  test('typing a query into the input narrows the rendered options', () => {
    const onClose = mock(() => undefined);
    const { container, unmount } = renderPalette({ open: true, onClose });

    // 3 commands registered in beforeEach: Alpha Command, Beta Command (system),
    // Gamma Navigation (navigation). Only Alpha + Beta contain "command".
    expect(container.querySelectorAll('[role="option"]').length).toBe(3);

    // Drive React's controlled input: use nativeInputValueSetter to bypass
    // React's own value tracking, then dispatch a synthetic 'change' event.
    const input = container.querySelector('input') as HTMLInputElement;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      'value',
    )?.set;
    flushSync(() => {
      nativeInputValueSetter?.call(input, 'command');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // "command" matches "Alpha Command" and "Beta Command" (title substring)
    // but NOT "Gamma Navigation".
    const options = container.querySelectorAll('[role="option"]');
    expect(options.length).toBe(2);
    const titles = Array.from(options).map((el) =>
      el.querySelector('.cmd-item-title')?.textContent,
    );
    expect(titles).toContain('Alpha Command');
    expect(titles).toContain('Beta Command');
    expect(titles).not.toContain('Gamma Navigation');

    unmount();
  });

  test('clearing the query restores all options', () => {
    const onClose = mock(() => undefined);
    const { container, unmount } = renderPalette({ open: true, onClose });

    const input = container.querySelector('input') as HTMLInputElement;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      'value',
    )?.set;

    // Narrow first.
    flushSync(() => {
      nativeInputValueSetter?.call(input, 'alpha');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelectorAll('[role="option"]').length).toBe(1);

    // Clear.
    flushSync(() => {
      nativeInputValueSetter?.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelectorAll('[role="option"]').length).toBe(3);

    unmount();
  });

  test('registry changes reflected in palette via subscribeCommands', () => {
    const onClose = mock(() => undefined);
    const { container, unmount } = renderPalette({ open: true, onClose });

    // Initially 3 commands.
    expect(container.querySelectorAll('[role="option"]').length).toBe(3);

    // Register a new command — the palette subscribes and should update.
    flushSync(() => {
      registerCommand(makeCmd('test.navigation', {
        title: 'Navigate Somewhere',
        group: 'navigation',
      }));
    });

    expect(container.querySelectorAll('[role="option"]').length).toBe(4);
    unmount();
  });

});
