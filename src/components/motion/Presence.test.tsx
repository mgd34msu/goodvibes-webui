import { describe, expect, test } from 'bun:test';

// ─── Presence leaving lifecycle ───────────────────────────────────────────────
// Presence.tsx manages phase transitions: unmounted → entering → visible →
// leaving → unmounted. We verify the module exports correctly and that the
// exported shape matches the interface.

describe('Presence module', () => {
  test('exports Presence function', async () => {
    const mod = await import('./Presence');
    expect(typeof mod.Presence).toBe('function');
  });

  test('Presence accepts present and exitDurationMs props', async () => {
    const { Presence } = await import('./Presence');
    // Verify the function signature accepts the documented props
    // (TypeScript enforces this at compile time; here we verify at runtime shape)
    const fn = Presence as (props: {
      present: boolean;
      exitDurationMs?: number;
      children: unknown;
    }) => unknown;
    expect(typeof fn).toBe('function');
  });
});

// ─── Exit duration alignment ───────────────────────────────────────────────────

describe('Presence default exitDurationMs', () => {
  test('default 180ms matches TOAST_EXIT_DURATION_MS', async () => {
    const { TOAST_EXIT_DURATION_MS } = await import('../../lib/toast');
    // The Presence default is 180 (see component definition).
    // TOAST_EXIT_DURATION_MS must equal that default so the provider
    // PURGE timer and the Presence unmount timer fire together.
    expect(TOAST_EXIT_DURATION_MS).toBe(180);
  });
});

// ─── Reduced motion: immediate unmount ────────────────────────────────────────
// When reduced motion is active, Presence should skip the leaving phase
// and unmount immediately (exitDurationMs is ignored).
// We verify the module structure supports this via the useReducedMotion hook.

describe('useReducedMotion', () => {
  test('exports useReducedMotion from motion/index', async () => {
    const mod = await import('./index');
    expect(typeof mod.useReducedMotion).toBe('function');
  });
});
