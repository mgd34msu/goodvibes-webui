import { classifyBadgeTone, contractGlyphForBadgeTone } from '../lib/presentation-bridge';

interface StatusBadgeProps {
  value: string;
}

/**
 * Tone classification (classifyBadgeTone) and the leading glyph
 * (contractGlyphForBadgeTone) both live in src/lib/presentation-bridge.ts —
 * the glyph is sourced from the SDK presentation contract that the TUI and
 * agent already render through, so the same visual severity vocabulary shows
 * up here. See that module for the full tone<->contract mapping and its
 * honesty rationale.
 *
 * The glyph is carried as a `data-contract-glyph` attribute and painted via
 * a `.badge::before { content: attr(data-contract-glyph) }` CSS rule
 * (src/styles.css), NOT as a child text node — StatusBadge's `value` is
 * consumed elsewhere (RecordList, SessionHeader, ProvidersView, ...) with
 * exact-text assertions on `.textContent`; a generated-content pseudo-element
 * adds the visual glyph without changing what `.textContent` reports.
 */
export function StatusBadge({ value }: StatusBadgeProps) {
  const tone = classifyBadgeTone(value);

  return (
    <span className={`badge ${tone}`} data-contract-glyph={contractGlyphForBadgeTone(tone)}>
      {value}
    </span>
  );
}
