/**
 * memory-helpers.ts — pure logic for MemoryView, kept separate so the honesty rules
 * and the persona projection are independently testable without mounting the view.
 */
import {
  VIBE_PERSONA_TAG,
  type MemoryClass,
  type MemoryProvenanceLink,
  type MemoryRecord,
  type MemoryReviewState,
  type MemoryScope,
} from '../../lib/goodvibes';

export const MEMORY_CLASSES: readonly MemoryClass[] = [
  'decision', 'constraint', 'incident', 'pattern', 'fact', 'risk', 'runbook', 'architecture', 'ownership',
];

export const MEMORY_SCOPES: readonly MemoryScope[] = ['session', 'project', 'team'];

export const MEMORY_REVIEW_STATES: readonly MemoryReviewState[] = ['fresh', 'reviewed', 'stale', 'contradicted'];

/** The store's own baseline trust — MemoryStore.add stamps new records at this
 * confidence, and it is the recall-injection floor (memory-recall-contract.ts). Shown
 * in the UI so "60%" reads as a real, documented threshold, not an arbitrary number. */
export const RECALL_CONFIDENCE_FLOOR = 60;

/**
 * True for a persona (VIBE.md) record: cls 'constraint', tagged VIBE_PERSONA_TAG.
 * Mirrors the SDK's vibe-projection.ts selectVibeRecords test exactly — there is no
 * `memory.fold`/projection verb on the wire ("fold is NOT on the wire" per the brief
 * this view implements), so browsing personas means re-deriving the same predicate
 * client-side over records already fetched through memory.records.search.
 */
export function isPersonaRecord(record: MemoryRecord): boolean {
  return record.cls === 'constraint' && record.tags.includes(VIBE_PERSONA_TAG);
}

/** Split tags input the same way KnowledgeView's ingest form does (comma separated,
 * trimmed, blanks dropped) — kept local rather than imported since it is one line. */
export function splitTags(value: string): string[] {
  return value.split(',').map((tag) => tag.trim()).filter(Boolean);
}

/** Review state badge tone, matching the severity a reader would expect: fresh/reviewed
 * read as fine, stale/contradicted are the flagged states the recall contract excludes
 * outright regardless of confidence. */
export function reviewStateTone(state: MemoryReviewState): 'ok' | 'warning' | 'bad' | 'neutral' {
  switch (state) {
    case 'reviewed': return 'ok';
    case 'fresh': return 'neutral';
    case 'stale': return 'warning';
    case 'contradicted': return 'bad';
    default: return 'neutral';
  }
}

export function isFlaggedReviewState(state: MemoryReviewState): boolean {
  return state === 'stale' || state === 'contradicted';
}

/** A confidence below the recall floor never clears prompt-injection even when the
 * record is not flagged — surfaced so a browsing operator can see WHY a record would
 * be silently skipped by the agent, without needing recall:true search semantics. */
export function isBelowRecallFloor(record: MemoryRecord): boolean {
  return record.confidence < RECALL_CONFIDENCE_FLOOR;
}

export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence)}%`;
}

export function formatProvenanceLink(link: MemoryProvenanceLink): string {
  return link.label ? `${link.label} (${link.kind}: ${link.ref})` : `${link.kind}: ${link.ref}`;
}

export function formatTimestamp(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return new Date(value).toLocaleString();
}
