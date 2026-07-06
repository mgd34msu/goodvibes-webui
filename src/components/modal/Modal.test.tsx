import { describe, expect, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Modal } from './Modal';

function render(props: { open: boolean; onClose: () => void }) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      React.createElement(Modal, { ...props, title: 'Test Modal', children: React.createElement('button', { type: 'button' }, 'Inside') }),
    );
  });
  return {
    el: container,
    rerender: (next: { open: boolean; onClose: () => void }) => {
      flushSync(() => {
        root.render(
          React.createElement(Modal, { ...next, title: 'Test Modal', children: React.createElement('button', { type: 'button' }, 'Inside') }),
        );
      });
    },
    unmount: () => {
      flushSync(() => root.unmount());
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

describe('Modal — unmounts entirely when closed', () => {
  test('renders nothing when open=false', () => {
    const { el, unmount } = render({ open: false, onClose: () => {} });
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    unmount();
  });

  test('renders the dialog with its title and content when open=true', () => {
    const { el, unmount } = render({ open: true, onClose: () => {} });
    const dialog = el.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(el.textContent).toContain('Test Modal');
    expect(el.textContent).toContain('Inside');
    unmount();
  });
});

describe('Modal — closes honestly on Escape and backdrop click', () => {
  test('Escape calls onClose', () => {
    let closed = false;
    const { unmount } = render({ open: true, onClose: () => { closed = true; } });
    flushSync(() => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(closed).toBe(true);
    unmount();
  });

  test('clicking the backdrop (not the panel) calls onClose', () => {
    let closed = false;
    const { el, unmount } = render({ open: true, onClose: () => { closed = true; } });
    const backdrop = el.querySelector('.modal-backdrop');
    flushSync(() => {
      backdrop?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(closed).toBe(true);
    unmount();
  });

  test('clicking inside the panel does NOT call onClose', () => {
    let closed = false;
    const { el, unmount } = render({ open: true, onClose: () => { closed = true; } });
    const panel = el.querySelector('.modal-panel');
    flushSync(() => {
      panel?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(closed).toBe(false);
    unmount();
  });
});

describe('Modal — focus management', () => {
  test('focus moves to the first focusable element inside the panel on open', async () => {
    const { el, unmount } = render({ open: true, onClose: () => {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const closeButton = el.querySelector('.modal-close');
    // Either the explicit close button or the "Inside" button should hold focus —
    // both are inside the panel, proving focus did not stay on <body>.
    expect(document.activeElement === closeButton || el.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
    unmount();
  });
});
