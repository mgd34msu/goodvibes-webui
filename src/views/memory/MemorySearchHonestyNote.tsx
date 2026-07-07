import { AlertTriangle, Info } from 'lucide-react';
import type { MemorySearchResult } from '../../lib/goodvibes';

/**
 * The recall-honesty contract, surfaced verbatim (memory-recall-contract.ts, promoted
 * onto the wire by memory.records.search). Three things this MUST NEVER do:
 *   1. Hide `indexUnavailableReason` — a silent empty result here would read as
 *      "nothing was ever stored" when the truth is "the semantic index couldn't be
 *      consulted, so this fell back to a literal scan". Shown verbatim, unparaphrased.
 *   2. Hide `caveat` — the softer "ran on the hashed-only fallback provider" note.
 *   3. Hide the recall-filter exclusion counts when `recallFiltered` is true — a
 *      caller who asked "what would the agent actually see" needs to know how many
 *      records were excluded and why, not just the surviving count.
 *
 * `totalBeforeRecallFilter` is NOT "every record that matches" — it is
 * `baseRecords.length` from `runHonestMemorySearch` (memory-recall-contract.ts), i.e.
 * whatever the underlying search returned, which is itself capped at the caller's own
 * `limit`. Labeling it "total before filtering" over-claims completeness (300 could
 * match while the label reads 100). `limit` is the exact `limit` this component's
 * caller searched with, so the label can say "of the first N" instead of implying N is
 * the whole matching set.
 *
 * The recall floor itself (`excludedBelowFloorCount`'s threshold) is NOT on the wire —
 * memory-recall-contract.ts's `MIN_PROMPT_MEMORY_CONFIDENCE` never travels in the
 * search result — so this never states a specific percentage as fact; if the SDK's
 * floor value ever changes, this label does not silently go stale.
 */
export function MemorySearchHonestyNote({ result, limit }: { result: MemorySearchResult; limit?: number }) {
  return (
    <div className="memory-honesty-note" aria-live="polite">
      <span className={`badge ${result.mode === 'semantic' ? 'ok' : 'neutral'}`}>
        {result.mode === 'semantic' ? 'Semantic search' : 'Literal search'}
      </span>

      {result.indexUnavailableReason !== null && (
        <div className="memory-honesty-note__banner memory-honesty-note__banner--degraded" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{result.indexUnavailableReason}</span>
        </div>
      )}

      {result.caveat !== null && (
        <div className="memory-honesty-note__banner memory-honesty-note__banner--caveat" role="status">
          <Info size={16} aria-hidden="true" />
          <span>{result.caveat}</span>
        </div>
      )}

      {result.recallFiltered && (
        <p className="memory-honesty-note__recall-stats">
          {result.records.length} shown after the recall filter
          {' · '}{result.excludedFlaggedCount} excluded (flagged stale/contradicted)
          {' · '}{result.excludedBelowFloorCount} excluded (below the store's configured recall floor)
          {' · '}{result.totalBeforeRecallFilter} {typeof limit === 'number' ? `of the first ${limit} matches` : 'total'} before the recall filter
        </p>
      )}
    </div>
  );
}
