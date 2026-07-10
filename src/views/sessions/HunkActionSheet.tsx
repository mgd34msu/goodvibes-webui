/**
 * HunkActionSheet — the touch-first action chooser for ONE reviewed hunk in the session
 * review cockpit. Tapping a hunk in the multibuffer opens this; it names the change (file
 * + line ranges + excerpt) and offers the three cockpit actions as full-width ≥44px sheet
 * buttons, so a phone review is thumb-driven:
 *   - APPROVE — mark this hunk reviewed (purely client-side progress tracking; toggles back
 *     to "Mark reviewed" when already approved). No wire call.
 *   - COMMENT & STEER — hand off to the existing HunkCommentSheet / steer-follow-up flow.
 *   - REJECT & REVERT — hand off to the revert preview → confirm → checkpoints.revertHunk
 *     flow (HunkRevertSheet).
 *
 * Presentational only: it renders when `open` and calls the handler the parent supplies.
 * Bottom sheet on a phone, centered dialog on desktop, focus trap + Escape/backdrop cancel
 * — the same idiom as ConfirmSheet / HunkCommentSheet.
 */
import { useEffect, useId, type KeyboardEvent } from 'react';
import { Check, MessageSquare, Undo2 } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { formatRange, hunkExcerpt, hunkNewRange, hunkOldRange, type DiffHunk } from '../../lib/unified-diff';
import '../../styles/components/session-changes.css';

export interface HunkActionSheetProps {
  open: boolean;
  filePath: string;
  hunk: DiffHunk;
  /** True when this hunk is already marked reviewed — the Approve button toggles it off. */
  reviewed: boolean;
  /** 'steer' while an agent is bound, else 'followUp' — labels the Comment action honestly. */
  commentMode: 'steer' | 'followUp';
  onApprove: () => void;
  onComment: () => void;
  onReject: () => void;
  onCancel: () => void;
}

export function HunkActionSheet({
  open,
  filePath,
  hunk,
  reviewed,
  commentMode,
  onApprove,
  onComment,
  onReject,
  onCancel,
}: HunkActionSheetProps) {
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event: KeyboardEvent | globalThis.KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const newRange = formatRange(hunkNewRange(hunk));
  const oldRange = formatRange(hunkOldRange(hunk));

  return (
    <div className="hunk-sheet-root">
      <div className="hunk-sheet-backdrop" aria-hidden="true" onClick={onCancel} />
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="hunk-sheet">
        <h2 id={titleId} className="hunk-sheet__title">Review this change</h2>
        <div className="hunk-sheet__context">
          <span className="hunk-sheet__path">{filePath}</span>
          <span className="hunk-sheet__lines">new {newRange} · old {oldRange}</span>
        </div>
        <pre className="hunk-sheet__excerpt" aria-label="Selected change">{hunkExcerpt(hunk)}</pre>

        <div className="hunk-actions">
          <button type="button" className="hunk-actions__btn hunk-actions__btn--approve" onClick={onApprove}>
            <Check size={16} aria-hidden="true" />
            {reviewed ? 'Marked reviewed — undo' : 'Approve (mark reviewed)'}
          </button>
          <button type="button" className="hunk-actions__btn" onClick={onComment}>
            <MessageSquare size={16} aria-hidden="true" />
            {commentMode === 'steer' ? 'Comment & steer' : 'Comment & queue follow-up'}
          </button>
          <button type="button" className="hunk-actions__btn hunk-actions__btn--reject" onClick={onReject}>
            <Undo2 size={16} aria-hidden="true" />
            Reject & revert this hunk
          </button>
          <button type="button" className="hunk-actions__cancel" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
