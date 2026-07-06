import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusBadge } from './StatusBadge';
import { CONTRACT_STATE_GLYPHS } from '../lib/generated/presentation-tokens';

describe('StatusBadge', () => {
  test('maps healthy status to ok tone', () => {
    const html = renderToStaticMarkup(<StatusBadge value="healthy" />);
    expect(html).toContain('badge ok');
    expect(html).toContain('healthy');
  });

  test('maps pending status to warning tone', () => {
    const html = renderToStaticMarkup(<StatusBadge value="pending approval" />);
    expect(html).toContain('badge warning');
  });

  test('maps failures to bad tone', () => {
    const html = renderToStaticMarkup(<StatusBadge value="task failed" />);
    expect(html).toContain('badge bad');
  });

  // Provider auth-freshness vocabulary (src/lib/provider-status.ts).
  test('maps expired to bad tone — dead credentials are a fault', () => {
    const html = renderToStaticMarkup(<StatusBadge value="expired" />);
    expect(html).toContain('badge bad');
    expect(html).toContain('expired');
  });

  test('maps expiring to warning tone — still working, needs attention', () => {
    const html = renderToStaticMarkup(<StatusBadge value="expiring" />);
    expect(html).toContain('badge warning');
    expect(html).toContain('expiring');
  });

  test('maps unconfigured to neutral tone — not set up is not a fault', () => {
    const html = renderToStaticMarkup(<StatusBadge value="unconfigured" />);
    expect(html).toContain('badge neutral');
  });

  test('maps "status unavailable" to neutral tone — absent health is not a fault', () => {
    const html = renderToStaticMarkup(<StatusBadge value="status unavailable" />);
    expect(html).toContain('badge neutral');
  });

  // Component-level assertion (WEBUI-PRESENTATION-BRIDGE): the glyph StatusBadge
  // carries (painted via `.badge::before { content: attr(data-contract-glyph) }`,
  // src/styles.css) is the SDK presentation contract's own glyph for that
  // severity bucket (CONTRACT_STATE_GLYPHS, src/lib/generated/presentation-tokens.ts),
  // not a hardcoded literal — so a future SDK glyph change propagates here on
  // the next `bun run presentation:generate`, and this test would visibly fail
  // if StatusBadge silently forked its own copy instead. It is an attribute,
  // not a child text node, precisely so existing exact-`.textContent` callers
  // (RecordList, SessionHeader, ProvidersView, ...) are unaffected.
  describe('carries the contract glyph via data-contract-glyph, not a hardcoded literal', () => {
    test('ok tone carries CONTRACT_STATE_GLYPHS.good', () => {
      const html = renderToStaticMarkup(<StatusBadge value="healthy" />);
      expect(html).toContain(`data-contract-glyph="${CONTRACT_STATE_GLYPHS.good}"`);
    });

    test('warning tone carries CONTRACT_STATE_GLYPHS.warn', () => {
      const html = renderToStaticMarkup(<StatusBadge value="expiring" />);
      expect(html).toContain(`data-contract-glyph="${CONTRACT_STATE_GLYPHS.warn}"`);
    });

    test('bad tone carries CONTRACT_STATE_GLYPHS.bad', () => {
      const html = renderToStaticMarkup(<StatusBadge value="expired" />);
      expect(html).toContain(`data-contract-glyph="${CONTRACT_STATE_GLYPHS.bad}"`);
    });

    test('neutral tone carries CONTRACT_STATE_GLYPHS.info', () => {
      const html = renderToStaticMarkup(<StatusBadge value="unconfigured" />);
      expect(html).toContain(`data-contract-glyph="${CONTRACT_STATE_GLYPHS.info}"`);
    });

    test('the glyph attribute does not leak into the accessible label text', () => {
      const html = renderToStaticMarkup(<StatusBadge value="healthy" />);
      // The rendered text node is exactly the value — data-contract-glyph is
      // an attribute, not additional visible/accessible text content.
      expect(html).toMatch(/>healthy<\/span>$/);
    });
  });
});
