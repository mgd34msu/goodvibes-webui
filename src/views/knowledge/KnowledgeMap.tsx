/**
 * KnowledgeMap — renders the knowledge map from the wire's pre-rendered `svg`
 * string (W8 fix) instead of dumping the map result as raw JSON.
 *
 * Honesty states (named, in priority order):
 *  1. loading            — the map or the status it needs to interpret is still in flight.
 *  2. error               — the map query failed.
 *  3. "No knowledge indexed yet" — nothing has run and nothing exists (0 jobs, 0 nodes).
 *  4. "N indexing jobs ran, 0 nodes" — the W8 gap: jobs ran, no nodes ever resulted.
 *  5. "No nodes match this filter" — the base has nodes, this filtered query found none.
 *  6. "Map returned 0 nodes" — an unfiltered read still came back empty despite a
 *     nonzero node count elsewhere; named rather than silently rendered as empty.
 *  7. populated           — the svg renders via an <img data:> URL (never
 *     dangerouslySetInnerHTML — an <img> cannot execute embedded script), with an
 *     honest counts header and a demoted "view raw" JSON toggle.
 *  8. "Map unavailable"   — nodeCount > 0 but the svg field is missing/malformed.
 */
import { useState } from 'react';
import { AlertTriangle, Map as MapIcon } from 'lucide-react';
import { countFrom, firstString } from '../../lib/object';
import { DataBlock } from '../../components/DataBlock';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';
import '../../styles/components/knowledge.css';

/** A well-formed-enough SVG document to hand to an <img> data URL. */
export function isRenderableSvg(svg: string): boolean {
  const trimmed = svg.trim();
  return trimmed.length > 0 && /^<svg[\s>]/i.test(trimmed) && /<\/svg>\s*$/i.test(trimmed);
}

/** An <img src="data:..."> URL — never dangerouslySetInnerHTML on daemon-sourced SVG. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export interface KnowledgeMapProps {
  isPending: boolean;
  error: unknown;
  data: unknown;
  onRetry: () => void;
  hasFilter: boolean;
  onClearFilter: () => void;
  onViewJobs: () => void;
  /** null = the status query that supplies this signal is unavailable/loading. */
  jobRunCount: number | null;
  overallNodeCount: number | null;
  statusPending: boolean;
}

export function KnowledgeMap({
  isPending,
  error,
  data,
  onRetry,
  hasFilter,
  onClearFilter,
  onViewJobs,
  jobRunCount,
  overallNodeCount,
  statusPending,
}: KnowledgeMapProps) {
  const [showRaw, setShowRaw] = useState(false);

  if (isPending || statusPending) {
    return (
      <div className="knowledge-skeleton-group">
        <SkeletonBlock width="100%" height={16} />
        <SkeletonBlock width="85%" height={16} />
        <SkeletonBlock width="100%" height={140} />
      </div>
    );
  }

  if (error) {
    return <ErrorState error={error} onRetry={onRetry} title="Map failed to load" />;
  }

  const nodeCount = countFrom(data, ['nodeCount']);
  const edgeCount = countFrom(data, ['edgeCount']);
  const totalNodeCount = countFrom(data, ['totalNodeCount']) || nodeCount;
  const totalEdgeCount = countFrom(data, ['totalEdgeCount']) || edgeCount;
  const svg = firstString(data, ['svg']);

  // Nothing to contrast against overall status — fall back to the map's own totals.
  const baseIsEmpty = overallNodeCount === null ? totalNodeCount === 0 : overallNodeCount === 0;

  if (baseIsEmpty) {
    if (jobRunCount && jobRunCount > 0) {
      return (
        <EmptyState
          icon={<AlertTriangle size={24} />}
          title={`${jobRunCount} indexing job${jobRunCount === 1 ? '' : 's'} ran, 0 nodes`}
          description="Indexing may still be in progress, filtered out everything, or be failing to produce nodes."
          action={{ label: 'View jobs', onClick: onViewJobs }}
        />
      );
    }
    return (
      <EmptyState
        icon={<MapIcon size={24} />}
        title="No knowledge indexed yet"
        description="Add a source above to start building the map."
      />
    );
  }

  if (nodeCount === 0 && hasFilter) {
    return (
      <EmptyState
        icon={<MapIcon size={24} />}
        title="No nodes match this filter"
        description="Try a different query, or clear the filter to see the full map."
        action={{ label: 'Clear filter', onClick: onClearFilter }}
      />
    );
  }

  if (nodeCount === 0) {
    return (
      <EmptyState
        icon={<AlertTriangle size={24} />}
        title="Map returned 0 nodes"
        description={`The knowledge base reports ${overallNodeCount ?? totalNodeCount} node(s) elsewhere, but this unfiltered read came back empty.`}
        action={{ label: 'View jobs', onClick: onViewJobs }}
      />
    );
  }

  const renderable = svg.length > 0 && isRenderableSvg(svg);

  return (
    <div className="knowledge-map-render">
      <div className="knowledge-map-render__header">
        <span>{nodeCount} node{nodeCount === 1 ? '' : 's'} · {edgeCount} edge{edgeCount === 1 ? '' : 's'}</span>
        {(totalNodeCount > nodeCount || totalEdgeCount > edgeCount) && (
          <span className="knowledge-map-render__total">of {totalNodeCount} / {totalEdgeCount} total</span>
        )}
      </div>
      {renderable ? (
        <div className="knowledge-map-render__canvas">
          <img
            src={svgDataUrl(svg)}
            alt={`Knowledge map: ${nodeCount} nodes, ${edgeCount} edges`}
          />
        </div>
      ) : (
        <EmptyState
          icon={<AlertTriangle size={24} />}
          title="Map unavailable"
          description="The daemon returned no renderable map for these nodes."
        />
      )}
      <button
        type="button"
        className="knowledge-map-render__toggle"
        onClick={() => setShowRaw((value) => !value)}
        aria-expanded={showRaw}
      >
        {showRaw ? 'Hide raw data' : 'View raw'}
      </button>
      {showRaw && <DataBlock title="Raw Map Data" value={data} />}
    </div>
  );
}
