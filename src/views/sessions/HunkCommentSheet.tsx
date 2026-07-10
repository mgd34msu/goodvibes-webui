/**
 * HunkCommentSheet — the touch-first composer for a comment attached to ONE diff hunk.
 *
 * Mirrors ConfirmSheet's idiom (bottom sheet on a phone, centered dialog on desktop,
 * focus trap, Escape/backdrop cancel) but carries a textarea instead of a yes/no: it
 * shows exactly which change is being commented on (file + line ranges + the hunk
 * excerpt) so the operator is never guessing, then sends the comment as a steer/
 * follow-up to the session. Presentational-with-state: it owns only the draft text and
 * the composer-key handling; the PARENT owns the mutation (the same sessions.steer /
 * sessions.followUp path the SteerComposer and fleet needs-input flow use) and passes
 * back `pending` / `error` / a `mode` label so this sheet stays free of any wire concern.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { SendHorizontal } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { shouldSubmitComposerKey } from '../../lib/composer-keys';
import { formatRange, hunkExcerpt, hunkNewRange, hunkOldRange, type DiffHunk } from '../../lib/unified-diff';
import '../../styles/components/session-changes.css';

export interface HunkCommentSheetProps {
  open: boolean;
  filePath: string;
  hunk: DiffHunk;
  /** Trust-in-labels: how/when the diff was captured (e.g. the checkpoint label + age). */
  capturedLabel: string;
  /** 'steer' while an agent is bound, else 'followUp' (queues a turn) — mirrors SteerComposer. */
  mode: 'steer' | 'followUp';
  pending: boolean;
  error?: string | null;
  onSubmit: (comment: string) => void;
  onCancel: () => void;
}

export function HunkCommentSheet({
  open,
  filePath,
  hunk,
  capturedLabel,
  mode,
  pending,
  error,
  onSubmit,
  onCancel,
}: HunkCommentSheetProps) {
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const [text, setText] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    setText('');
    textareaRef.current?.focus();
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
  const actionLabel = mode === 'steer' ? 'Send steer' : 'Queue follow-up';

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const comment = text.trim();
    if (!comment || pending) return;
    onSubmit(comment);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!shouldSubmitComposerKey(event)) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <div className="hunk-sheet-root">
      <div className="hunk-sheet-backdrop" aria-hidden="true" onClick={onCancel} />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="hunk-sheet"
      >
        <h2 id={titleId} className="hunk-sheet__title">Comment on this change</h2>
        <div className="hunk-sheet__context">
          <span className="hunk-sheet__path">{filePath}</span>
          <span className="hunk-sheet__lines">new {newRange} · old {oldRange}</span>
        </div>
        <p className="hunk-sheet__captured">{capturedLabel}</p>

        <pre className="hunk-sheet__excerpt" aria-label="Selected change">{hunkExcerpt(hunk)}</pre>

        <form className="hunk-sheet__form" onSubmit={submit}>
          <textarea
            ref={textareaRef}
            className="hunk-sheet__input"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={mode === 'steer'
              ? 'What should the agent do about this change?'
              : 'Queue a follow-up about this change…'}
            rows={3}
            aria-label="Comment on the selected change"
            aria-keyshortcuts="Enter"
            onKeyDown={handleKeyDown}
          />
          <p className="hunk-sheet__mode" role="status">
            {mode === 'steer'
              ? 'Sends as a mid-turn steer to the bound agent.'
              : 'No active agent — queues a follow-up turn.'}
          </p>
          {error && <p className="hunk-sheet__error" role="alert">{error}</p>}
          <div className="hunk-sheet__actions">
            <button type="button" className="hunk-sheet__cancel" onClick={onCancel} disabled={pending}>
              Cancel
            </button>
            <button
              type="submit"
              className="hunk-sheet__send"
              disabled={pending || !text.trim()}
              aria-label={actionLabel}
            >
              <SendHorizontal size={15} aria-hidden="true" />
              {pending ? 'Sending…' : mode === 'steer' ? 'Steer' : 'Queue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
