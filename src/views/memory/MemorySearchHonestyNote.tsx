import { AlertTriangle, Info } from 'lucide-react';
import type { MemorySearchResult } from '../../lib/goodvibes';
import { RECALL_CONFIDENCE_FLOOR, formatConfidence } from './memory-helpers';

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
 */
export function MemorySearchHonestyNote({ result }: { result: MemorySearchResult }) {
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
          {' · '}{result.excludedBelowFloorCount} excluded (below the {formatConfidence(RECALL_CONFIDENCE_FLOOR)} recall floor)
          {' · '}{result.totalBeforeRecallFilter} total before filtering
        </p>
      )}
    </div>
  );
}
