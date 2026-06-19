/**
 * Tests for useAnnouncer hook.
 * Uses react-dom/client + flushSync + happy-dom (bunfig.toml preload).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { _announcerSnapshot, _resetAnnouncerStore, useAnnouncer } from './useAnnouncer';

// ---------------------------------------------------------------------------
// Types / helpers
// ---------------------------------------------------------------------------

type AnnouncerHandle = ReturnType<typeof useAnnouncer>;

function renderInto(
  ui: React.ReactElement,
  el?: HTMLElement,
): { el: HTMLElement; root: ReturnType<typeof createRoot>; unmount: () => void } {
  const container = el ?? document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => { root.render(ui); });
  return {
    el: container,
    root,
    unmount: () => {
      flushSync(() => { root.unmount(); });
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

function HookOwner({ onHandle }: { onHandle: (h: AnnouncerHandle) => void }): null {
  const handle = useAnnouncer();
  React.useLayoutEffect(() => { onHandle(handle); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => { _resetAnnouncerStore(); });
afterEach(() => { _resetAnnouncerStore(); });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAnnouncer', () => {
  test('polite message appears in the polite live region', async () => {
    let handle!: AnnouncerHandle;
    const owner = renderInto(<HookOwner onHandle={(h) => { handle = h; }} />);
    const { AnnouncerRegion } = handle;
    const region = renderInto(<AnnouncerRegion />);

    handle.announce('File saved');
    // Wait for the clear (0ms) + set (50ms) timers
    await new Promise((r) => setTimeout(r, 80));
    // Flush any pending React state updates from the store
    flushSync(() => {});

    const politeEl = region.el.querySelector('[aria-live="polite"]');
    expect(politeEl?.textContent).toBe('File saved');

    owner.unmount();
    region.unmount();
  });

  test('assertive message appears in the assertive live region', async () => {
    let handle!: AnnouncerHandle;
    const owner = renderInto(<HookOwner onHandle={(h) => { handle = h; }} />);
    const region = renderInto(<handle.AnnouncerRegion />);

    handle.announce('Critical error', 'assertive');
    await new Promise((r) => setTimeout(r, 80));
    flushSync(() => {});

    const assertiveEl = region.el.querySelector('[aria-live="assertive"]');
    expect(assertiveEl?.textContent).toBe('Critical error');

    owner.unmount();
    region.unmount();
  });

  test('assertive message does NOT appear in polite region', async () => {
    let handle!: AnnouncerHandle;
    const owner = renderInto(<HookOwner onHandle={(h) => { handle = h; }} />);
    const region = renderInto(<handle.AnnouncerRegion />);

    handle.announce('Alert!', 'assertive');
    await new Promise((r) => setTimeout(r, 80));
    flushSync(() => {});

    const politeEl = region.el.querySelector('[aria-live="polite"]');
    expect(politeEl?.textContent).toBe('');

    owner.unmount();
    region.unmount();
  });

  test('same message announced twice cycles through empty for re-read', async () => {
    let handle!: AnnouncerHandle;
    const owner = renderInto(<HookOwner onHandle={(h) => { handle = h; }} />);
    const region = renderInto(<handle.AnnouncerRegion />);

    // First announce
    handle.announce('Saved');
    await new Promise((r) => setTimeout(r, 80));
    flushSync(() => {});
    expect(region.el.querySelector('[aria-live="polite"]')?.textContent).toBe('Saved');

    // Second announce — must clear first, then re-set
    handle.announce('Saved');
    await new Promise((r) => setTimeout(r, 10));
    flushSync(() => {});
    // Region cleared
    expect(region.el.querySelector('[aria-live="polite"]')?.textContent).toBe('');

    await new Promise((r) => setTimeout(r, 60));
    flushSync(() => {});
    expect(region.el.querySelector('[aria-live="polite"]')?.textContent).toBe('Saved');

    owner.unmount();
    region.unmount();
  });

  test('rapid announce() calls cancel previous timer — only last message shows', async () => {
    let handle!: AnnouncerHandle;
    const owner = renderInto(<HookOwner onHandle={(h) => { handle = h; }} />);
    const region = renderInto(<handle.AnnouncerRegion />);

    handle.announce('First');
    handle.announce('Second');
    handle.announce('Third');
    await new Promise((r) => setTimeout(r, 100));
    flushSync(() => {});

    expect(region.el.querySelector('[aria-live="polite"]')?.textContent).toBe('Third');

    owner.unmount();
    region.unmount();
  });

  test('AnnouncerRegion re-renders even when not co-located with hook owner', async () => {
    let handle!: AnnouncerHandle;
    const owner = renderInto(<HookOwner onHandle={(h) => { handle = h; }} />);
    // Region in a separate container entirely
    const regionEl = document.createElement('div');
    document.body.appendChild(regionEl);
    const region = renderInto(<handle.AnnouncerRegion />, regionEl);

    handle.announce('Remote message');
    await new Promise((r) => setTimeout(r, 80));
    flushSync(() => {});

    expect(regionEl.querySelector('[aria-live="polite"]')?.textContent).toBe('Remote message');

    owner.unmount();
    region.unmount();
  });

  test('both polite and assertive regions rendered inside sr-only wrapper', () => {
    let handle!: AnnouncerHandle;
    const owner = renderInto(<HookOwner onHandle={(h) => { handle = h; }} />);
    const region = renderInto(<handle.AnnouncerRegion />);

    const srOnly = region.el.querySelector('.sr-only');
    expect(srOnly).not.toBeNull();
    expect(srOnly?.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(srOnly?.querySelector('[aria-live="assertive"]')).not.toBeNull();

    owner.unmount();
    region.unmount();
  });

  test('module-level store snapshot reflects state changes', async () => {
    const snap1 = _announcerSnapshot();
    expect(snap1.polite).toBe('');
    expect(snap1.assertive).toBe('');

    let handle!: AnnouncerHandle;
    const owner = renderInto(<HookOwner onHandle={(h) => { handle = h; }} />);

    handle.announce('Store test', 'assertive');
    await new Promise((r) => setTimeout(r, 80));

    const snap2 = _announcerSnapshot();
    expect(snap2.assertive).toBe('Store test');
    owner.unmount();
  });
});
