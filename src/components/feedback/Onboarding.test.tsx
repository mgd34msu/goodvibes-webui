/**
 * Tests for Onboarding component.
 * Uses react-dom/client + flushSync + happy-dom (bunfig.toml preload).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Onboarding } from './Onboarding';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'goodvibes.webui.onboarding';

function renderInto(
  ui: React.ReactElement,
): { el: HTMLElement; unmount: () => void } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  flushSync(() => { root.render(ui); });
  return {
    el,
    unmount: () => {
      flushSync(() => { root.unmount(); });
      if (el.parentNode) el.parentNode.removeChild(el);
    },
  };
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { localStorage.clear(); });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Onboarding', () => {
  test('renders when not previously dismissed', () => {
    const { el, unmount } = renderInto(
      <Onboarding id="test-surface" title="Welcome" description="Get started here." />,
    );
    expect(el.textContent).toContain('Welcome');
    expect(el.textContent).toContain('Get started here.');
    unmount();
  });

  test('does not render when already dismissed in localStorage', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'test-surface': true }));
    const { el, unmount } = renderInto(
      <Onboarding id="test-surface" title="Welcome" />,
    );
    expect(el.textContent).not.toContain('Welcome');
    unmount();
  });

  test('dismiss button hides the panel', () => {
    const { el, unmount } = renderInto(
      <Onboarding id="dismiss-test" title="Hello" />,
    );
    const btn = el.querySelector<HTMLButtonElement>('[aria-label="Dismiss onboarding"]')!;
    flushSync(() => { btn.click(); });
    expect(el.textContent).not.toContain('Hello');
    unmount();
  });

  test('dismissal is persisted to localStorage', () => {
    const { el, unmount } = renderInto(
      <Onboarding id="persist-test" title="Persist" />,
    );
    const btn = el.querySelector<HTMLButtonElement>('[aria-label="Dismiss onboarding"]')!;
    flushSync(() => { btn.click(); });
    const stored = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? '{}',
    ) as Record<string, boolean>;
    expect(stored['persist-test']).toBe(true);
    unmount();
  });

  test('renders steps as an ordered list', () => {
    const { el, unmount } = renderInto(
      <Onboarding
        id="steps-test"
        title="Steps"
        steps={['Step one', 'Step two', 'Step three']}
      />,
    );
    const items = el.querySelectorAll('.feedback-onboarding__step');
    expect(items.length).toBe(3);
    expect(items[0]?.textContent).toBe('Step one');
    expect(items[2]?.textContent).toBe('Step three');
    unmount();
  });

  test('action button triggers onClick callback', () => {
    const onAction = mock(() => {});
    const { el, unmount } = renderInto(
      <Onboarding
        id="action-test"
        title="Action"
        action={{ label: 'Go', onClick: onAction }}
      />,
    );
    const actionBtn = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent === 'Go',
    );
    expect(actionBtn).not.toBeNull();
    flushSync(() => { actionBtn!.click(); });
    expect(onAction.mock.calls.length).toBe(1);
    unmount();
  });

  test('different id values have independent dismissal state', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'surface-a': true }));
    const { el: elA, unmount: uA } = renderInto(
      <Onboarding id="surface-a" title="Surface A" />,
    );
    const { el: elB, unmount: uB } = renderInto(
      <Onboarding id="surface-b" title="Surface B" />,
    );
    expect(elA.textContent).not.toContain('Surface A');
    expect(elB.textContent).toContain('Surface B');
    uA();
    uB();
  });

  test('has correct aria-label on the aside element', () => {
    const { el, unmount } = renderInto(
      <Onboarding id="aria-test" title="My Feature" />,
    );
    const aside = el.querySelector('aside');
    expect(aside?.getAttribute('aria-label')).toBe('My Feature onboarding');
    unmount();
  });
});
