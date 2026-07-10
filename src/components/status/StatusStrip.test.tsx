/**
 * Tests for StatusStrip.
 * Uses react-dom/client + flushSync + happy-dom (bunfig.toml preload).
 *
 * StatusStrip calls useDaemonHealth() internally. We mock the module so tests
 * control every field of the returned DaemonHealth object.
 *
 * CSS import from StatusStrip (../../styles/components/status.css) is handled
 * transparently by bun's test runner (CSS files are no-op'd).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { DaemonHealth } from '../../lib/daemon-health';
import { CONTRACT_STATE_GLYPHS } from '../../lib/generated/presentation-tokens';

// ---------------------------------------------------------------------------
// Module mock — must be called before any import that transitively requires it
// ---------------------------------------------------------------------------

let _mockHealth: DaemonHealth = {
  connection: 'connected',
  route: 'direct',
  signedIn: 'signed-in',
  working: 'working',
  latencyMs: 42,
  sse: 'active',
  activeTurns: 0,
  queuedTasks: 0,
  modelName: null,
};

// Bun mock.module — synchronous module override for bun:test
import { mock } from 'bun:test';
mock.module('../../hooks/useDaemonHealth', () => ({
  useDaemonHealth: () => _mockHealth,
}));

// Import after mock registration
const { StatusStrip } = await import('./StatusStrip');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderStrip(): { el: HTMLElement; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => { root.render(React.createElement(StatusStrip)); });
  return {
    el: container,
    unmount: () => {
      flushSync(() => { root.unmount(); });
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

function setHealth(partial: Partial<DaemonHealth>): void {
  _mockHealth = { ..._mockHealth, ...partial };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let cleanup: (() => void) | null = null;

beforeEach(() => {
  _mockHealth = {
    connection: 'connected',
    route: 'direct',
    signedIn: 'signed-in',
    working: 'working',
    latencyMs: 42,
    sse: 'active',
    activeTurns: 0,
    queuedTasks: 0,
    modelName: null,
  };
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StatusStrip', () => {
  // -------------------------------------------------------------------------
  // Semantic structure / accessibility
  // -------------------------------------------------------------------------
  describe('semantic structure', () => {
    test('outer element is a <footer> (contentinfo role)', () => {
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const footer = el.querySelector('footer');
      expect(footer).not.toBeNull();
      expect(footer?.className).toContain('status-strip');
    });

    test('contains exactly one aria-live region', () => {
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const liveRegions = el.querySelectorAll('[aria-live]');
      expect(liveRegions.length).toBe(1);
    });

    test('aria-live region is polite', () => {
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const liveRegion = el.querySelector('[aria-live]');
      expect(liveRegion?.getAttribute('aria-live')).toBe('polite');
    });

    test('aria-live region is aria-atomic', () => {
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const liveRegion = el.querySelector('[aria-live]');
      expect(liveRegion?.getAttribute('aria-atomic')).toBe('true');
    });

    test('aria-live region is visually hidden (sr-only class)', () => {
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const liveRegion = el.querySelector('[aria-live]');
      expect(liveRegion?.className).toContain('status-strip__live-region');
    });
  });

  // -------------------------------------------------------------------------
  // Connection states — label + dot (non-color cue)
  // -------------------------------------------------------------------------
  describe('connection state: connected', () => {
    test('shows "Reachable" label in connection segment (never "Connected")', () => {
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const connectionSeg = el.querySelector('.status-strip__segment--connection');
      expect(connectionSeg?.textContent).toContain('Reachable');
      expect(connectionSeg?.textContent).not.toContain('Connected');
    });

    test('live region reports all three axes, never a bare "Connected"', () => {
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const liveRegion = el.querySelector('[aria-live="polite"]');
      expect(liveRegion?.textContent).toContain('Reachable');
      expect(liveRegion?.textContent).toContain('Signed in');
      expect(liveRegion?.textContent).toContain('Working');
      expect(liveRegion?.textContent).not.toBe('Connected');
    });

    test('ConnectionDot has dot--connected class (non-color visual cue)', () => {
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const dot = el.querySelector('.status-strip__dot');
      expect(dot?.className).toContain('status-strip__dot--connected');
    });

    test('ConnectionDot is aria-hidden', () => {
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const dot = el.querySelector('.status-strip__dot');
      expect(dot?.getAttribute('aria-hidden')).toBe('true');
    });

    // Component-level assertion (WEBUI-PRESENTATION-BRIDGE): the connection
    // segment's leading glyph is the SDK presentation contract's own glyph
    // for the 'good' severity bucket (CONTRACT_STATE_GLYPHS.good), sourced
    // via src/lib/presentation-bridge.ts — not a hardcoded literal.
    test('connection segment carries the contract glyph for "good" (connected)', () => {
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const connectionSeg = el.querySelector('.status-strip__segment--connection');
      const label = connectionSeg?.querySelector('.status-strip__label');
      expect(label?.getAttribute('data-contract-glyph')).toBe(CONTRACT_STATE_GLYPHS.good);
      // Attribute-driven (CSS ::before content), not a child text node — the
      // accessible label text is unaffected.
      expect(label?.textContent).toBe('Reachable');
    });
  });

  describe('connection state: reconnecting', () => {
    beforeEach(() => { setHealth({ connection: 'reconnecting' }); });

    test('shows "Reconnecting" label', () => {
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const connectionSeg = el.querySelector('.status-strip__segment--connection');
      expect(connectionSeg?.textContent).toContain('Reconnecting');
    });

    test('live region contains "Reconnecting"', () => {
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const liveRegion = el.querySelector('[aria-live="polite"]');
      expect(liveRegion?.textContent).toContain('Reconnecting');
    });

    test('dot has dot--reconnecting class', () => {
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const dot = el.querySelector('.status-strip__dot');
      expect(dot?.className).toContain('status-strip__dot--reconnecting');
    });

    test('connection segment carries the contract glyph for "warn" (reconnecting)', () => {
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const connectionSeg = el.querySelector('.status-strip__segment--connection');
      const label = connectionSeg?.querySelector('.status-strip__label');
      expect(label?.getAttribute('data-contract-glyph')).toBe(CONTRACT_STATE_GLYPHS.warn);
      expect(label?.textContent).toBe('Reconnecting');
    });
  });

  describe('connection state: down', () => {
    beforeEach(() => { setHealth({ connection: 'down' }); });

    test('shows "Offline" label', () => {
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const connectionSeg = el.querySelector('.status-strip__segment--connection');
      expect(connectionSeg?.textContent).toContain('Offline');
    });

    test('live region contains "Offline"', () => {
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const liveRegion = el.querySelector('[aria-live="polite"]');
      expect(liveRegion?.textContent).toContain('Offline');
    });

    test('dot has dot--down class', () => {
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const dot = el.querySelector('.status-strip__dot');
      expect(dot?.className).toContain('status-strip__dot--down');
    });

    test('connection segment carries the contract glyph for "bad" (down)', () => {
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const connectionSeg = el.querySelector('.status-strip__segment--connection');
      const label = connectionSeg?.querySelector('.status-strip__label');
      expect(label?.getAttribute('data-contract-glyph')).toBe(CONTRACT_STATE_GLYPHS.bad);
      expect(label?.textContent).toBe('Offline');
    });
  });

  // -------------------------------------------------------------------------
  // Latency formatting
  // -------------------------------------------------------------------------
  describe('latency display', () => {
    test('null latency renders em-dash fallback', () => {
      setHealth({ latencyMs: null });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const latencySeg = el.querySelector('[aria-label^="Latency:"]');
      expect(latencySeg?.getAttribute('aria-label')).toBe('Latency: —');
      expect(latencySeg?.textContent).toContain('—');
    });

    test('latency < 10 ms renders "<10ms"', () => {
      setHealth({ latencyMs: 5 });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const latencySeg = el.querySelector('[aria-label^="Latency:"]');
      expect(latencySeg?.getAttribute('aria-label')).toBe('Latency: <10ms');
      expect(latencySeg?.textContent).toContain('<10ms');
    });

    test('latency in ms range renders "42ms"', () => {
      setHealth({ latencyMs: 42 });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const latencySeg = el.querySelector('[aria-label^="Latency:"]');
      expect(latencySeg?.getAttribute('aria-label')).toBe('Latency: 42ms');
    });

    test('latency >= 1000 ms renders in seconds (e.g. "1.2s")', () => {
      setHealth({ latencyMs: 1200 });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const latencySeg = el.querySelector('[aria-label^="Latency:"]');
      expect(latencySeg?.getAttribute('aria-label')).toBe('Latency: 1.2s');
    });

    test('latency segment has Zap icon (aria-hidden)', () => {
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      // Lucide icons render as SVG; check the segment has an aria-hidden icon
      const latencySeg = el.querySelector('[aria-label^="Latency:"]');
      const icon = latencySeg?.querySelector('.status-strip__icon');
      expect(icon).not.toBeNull();
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    });
  });

  // -------------------------------------------------------------------------
  // Active work counts
  // -------------------------------------------------------------------------
  describe('active work segment', () => {
    test('shows "Idle" when no active turns or queued tasks', () => {
      setHealth({ activeTurns: 0, queuedTasks: 0 });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const workSeg = el.querySelector('[aria-label^="Active turns:"]');
      expect(workSeg?.textContent).toContain('Idle');
    });

    test('shows "1 active" when 1 active turn', () => {
      setHealth({ activeTurns: 1, queuedTasks: 0 });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const workSeg = el.querySelector('[aria-label^="Active turns:"]');
      expect(workSeg?.textContent).toContain('1 active');
      expect(workSeg?.textContent).not.toContain('Idle');
    });

    test('shows "2 queued" when 2 queued tasks', () => {
      setHealth({ activeTurns: 0, queuedTasks: 2 });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const workSeg = el.querySelector('[aria-label^="Active turns:"]');
      expect(workSeg?.textContent).toContain('2 queued');
      expect(workSeg?.textContent).not.toContain('Idle');
    });

    test('shows both counts when active and queued', () => {
      setHealth({ activeTurns: 3, queuedTasks: 1 });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const workSeg = el.querySelector('[aria-label^="Active turns:"]');
      expect(workSeg?.textContent).toContain('3 active');
      expect(workSeg?.textContent).toContain('1 queued');
    });

    test('aria-label reflects active turns and queued counts', () => {
      setHealth({ activeTurns: 2, queuedTasks: 3 });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const workSeg = el.querySelector('[aria-label^="Active turns:"]');
      expect(workSeg?.getAttribute('aria-label')).toBe('Active turns: 2, queued: 3');
    });

    test('segment gains --active modifier class when working', () => {
      setHealth({ activeTurns: 1, queuedTasks: 0 });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const workSeg = el.querySelector('[aria-label^="Active turns:"]');
      expect(workSeg?.className).toContain('status-strip__segment--active');
    });

    test('segment lacks --active modifier class when idle', () => {
      setHealth({ activeTurns: 0, queuedTasks: 0 });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const workSeg = el.querySelector('[aria-label^="Active turns:"]');
      expect(workSeg?.className).not.toContain('status-strip__segment--active');
    });
  });

  // -------------------------------------------------------------------------
  // SSE state
  // -------------------------------------------------------------------------
  describe('SSE state', () => {
    test('sse active renders "Live" label', () => {
      setHealth({ sse: 'active' });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const sseSeg = el.querySelector('[aria-label^="Realtime stream:"]');
      expect(sseSeg?.textContent).toContain('Live');
      expect(sseSeg?.getAttribute('aria-label')).toBe('Realtime stream: Live');
    });

    test('sse connecting renders "SSE…" label', () => {
      setHealth({ sse: 'connecting' });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const sseSeg = el.querySelector('[aria-label^="Realtime stream:"]');
      expect(sseSeg?.textContent).toContain('SSE…');
    });

    test('sse error renders "SSE error" label', () => {
      setHealth({ sse: 'error' });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const sseSeg = el.querySelector('[aria-label^="Realtime stream:"]');
      expect(sseSeg?.textContent).toContain('SSE error');
      expect(sseSeg?.getAttribute('aria-label')).toBe('Realtime stream: SSE error');
    });

    test('sse disabled renders "SSE off" label', () => {
      setHealth({ sse: 'disabled' });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const sseSeg = el.querySelector('[aria-label^="Realtime stream:"]');
      expect(sseSeg?.textContent).toContain('SSE off');
    });

    test('SSE segment has state-specific class modifier', () => {
      setHealth({ sse: 'active' });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const sseSeg = el.querySelector('[aria-label^="Realtime stream:"]');
      expect(sseSeg?.className).toContain('status-strip__segment--sse-active');
    });

    test('SSE segment has Radio icon (aria-hidden)', () => {
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const sseSeg = el.querySelector('[aria-label^="Realtime stream:"]');
      const icon = sseSeg?.querySelector('.status-strip__icon');
      expect(icon).not.toBeNull();
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    });

    test('sse relay-unsupported renders a distinct honest label, not a generic error', () => {
      setHealth({ sse: 'relay-unsupported' });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const sseSeg = el.querySelector('[aria-label^="Realtime stream:"]');
      expect(sseSeg?.textContent).toContain('Unavailable (relay)');
      expect(sseSeg?.className).toContain('status-strip__segment--sse-relay-unsupported');
      expect(sseSeg?.className).not.toContain('status-strip__segment--sse-error');
    });
  });

  // -------------------------------------------------------------------------
  // Route (direct / via relay / offline)
  // -------------------------------------------------------------------------
  describe('route segment', () => {
    test('route absent (offline) renders no route segment at all', () => {
      setHealth({ route: null });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      expect(el.querySelector('[aria-label^="Route:"]')).toBeNull();
    });

    test('direct route renders the Direct label', () => {
      setHealth({ route: 'direct' });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const routeSeg = el.querySelector('[aria-label^="Route:"]');
      expect(routeSeg?.textContent).toContain('Direct');
      expect(routeSeg?.getAttribute('aria-label')).toBe('Route: Direct');
      expect(routeSeg?.className).toContain('status-strip__segment--route-direct');
    });

    test('relay route renders the honest "Via relay" label, distinct from direct', () => {
      setHealth({ route: 'relay' });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const routeSeg = el.querySelector('[aria-label^="Route:"]');
      expect(routeSeg?.textContent).toContain('Via relay');
      expect(routeSeg?.className).toContain('status-strip__segment--route-relay');
      expect(routeSeg?.className).not.toContain('status-strip__segment--route-direct');
    });

    test('live region announces the route only when there is a verdict', () => {
      setHealth({ route: null });
      const { el, unmount } = renderStrip();
      const liveRegion = el.querySelector('.status-strip__live-region');
      expect(liveRegion?.textContent).not.toContain('Direct');
      expect(liveRegion?.textContent).not.toContain('Via relay');
      unmount();

      setHealth({ route: 'relay' });
      const rendered = renderStrip();
      cleanup = rendered.unmount;
      expect(rendered.el.querySelector('.status-strip__live-region')?.textContent).toContain('Via relay');
    });
  });

  // -------------------------------------------------------------------------
  // Model name
  // -------------------------------------------------------------------------
  describe('model name segment', () => {
    test('model segment absent when modelName is null', () => {
      setHealth({ modelName: null });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const modelSeg = el.querySelector('.status-strip__segment--model');
      expect(modelSeg).toBeNull();
    });

    test('model segment present and shows name when modelName set', () => {
      setHealth({ modelName: 'claude-sonnet-4-6' });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const modelSeg = el.querySelector('.status-strip__segment--model');
      expect(modelSeg).not.toBeNull();
      expect(modelSeg?.textContent).toContain('claude-sonnet-4-6');
    });

    test('model segment has --right alignment class', () => {
      setHealth({ modelName: 'fable' });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const modelSeg = el.querySelector('.status-strip__segment--model');
      expect(modelSeg?.className).toContain('status-strip__segment--right');
    });

    test('model name uses mono label class', () => {
      setHealth({ modelName: 'test-model' });
      const { el, unmount } = renderStrip();
      cleanup = unmount;
      const monoLabel = el.querySelector('.status-strip__label--mono');
      expect(monoLabel).not.toBeNull();
      expect(monoLabel?.textContent).toBe('test-model');
    });
  });
});
