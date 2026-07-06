import type { MemoryRecord } from '../../lib/goodvibes';
import { formatConfidence, formatProvenanceLink, formatTimestamp, isFlaggedReviewState, reviewStateTone } from './memory-helpers';

/**
 * Record detail — type (cls), scope, review-state, and provenance, per the memory-view
 * brief's acceptance bar. Renders every field verbatim (no re-interpretation, no
 * secret-shaped special-casing): a provenance `ref` that happens to look like a file
 * path is shown as plain text exactly like any other ref, never turned into a link or
 * fetched — this view has no read-file capability and never invents one.
 */
export function MemoryRecordDetail({ record }: { record: MemoryRecord }) {
  const flagged = isFlaggedReviewState(record.reviewState);

  return (
    <div className="memory-record-detail">
      <section className="memory-record-detail__section">
        <h3>{record.summary}</h3>
        <dl className="memory-record-detail__facts">
          <div>
            <dt>Type</dt>
            <dd><span className="badge neutral">{record.cls}</span></dd>
          </div>
          <div>
            <dt>Scope</dt>
            <dd><span className="badge neutral">{record.scope}</span></dd>
          </div>
          <div>
            <dt>Review state</dt>
            <dd><span className={`badge ${reviewStateTone(record.reviewState)}`}>{record.reviewState}</span></dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>{formatConfidence(record.confidence)}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{formatTimestamp(record.createdAt)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatTimestamp(record.updatedAt)}</dd>
          </div>
          {record.reviewedAt !== undefined && (
            <div>
              <dt>Reviewed</dt>
              <dd>{formatTimestamp(record.reviewedAt)}{record.reviewedBy ? ` by ${record.reviewedBy}` : ''}</dd>
            </div>
          )}
        </dl>
      </section>

      {flagged && record.staleReason && (
        <section className="memory-record-detail__section memory-record-detail__stale-reason" role="note">
          <h4>Why this is flagged</h4>
          <p>{record.staleReason}</p>
        </section>
      )}

      {record.detail && (
        <section className="memory-record-detail__section">
          <h4>Detail</h4>
          <p className="memory-record-detail__detail">{record.detail}</p>
        </section>
      )}

      <section className="memory-record-detail__section">
        <h4>Tags</h4>
        {record.tags.length
          ? (
            <div className="memory-record-detail__tags">
              {record.tags.map((tag) => <span key={tag} className="memory-tag-chip">{tag}</span>)}
            </div>
          )
          : <p className="empty-state">No tags</p>}
      </section>

      <section className="memory-record-detail__section">
        <h4>Provenance</h4>
        {record.provenance.length
          ? (
            <ul className="memory-record-detail__provenance">
              {record.provenance.map((link, index) => (
                <li key={`${link.kind}-${link.ref}-${index}`}>{formatProvenanceLink(link)}</li>
              ))}
            </ul>
          )
          : <p className="empty-state">No provenance recorded</p>}
      </section>
    </div>
  );
}
