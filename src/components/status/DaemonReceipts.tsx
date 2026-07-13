/**
 * DaemonReceipts — one-line dismissible notices for the daemon's undelivered
 * receipts (a crash restart, a self-update, a migration), consumed exactly once
 * per connect. The daemon pre-renders each line; this surfaces it verbatim with
 * a dismiss control and renders nothing when the queue is empty.
 */
import { Bell, X } from 'lucide-react';
import { useDaemonReceipts } from '../../hooks/useDaemonReceipts';
import '../../styles/components/status.css';

export interface DaemonReceiptsProps {
  /** True once the daemon is reachable — the connect edge that consumes receipts. */
  readonly connected: boolean;
  /** True once authenticated — consuming requires an authorized read. */
  readonly signedIn: boolean;
}

export function DaemonReceipts({ connected, signedIn }: DaemonReceiptsProps) {
  const { receipts, dismiss } = useDaemonReceipts(connected, signedIn);

  if (receipts.length === 0) return null;

  return (
    <div className="daemon-receipts" role="status" aria-live="polite">
      {receipts.map((receipt) => (
        <div key={receipt.id} className="banner info daemon-receipt" data-testid="daemon-receipt">
          <Bell size={16} aria-hidden="true" />
          <span className="daemon-receipt__text" title={receipt.text}>{receipt.text}</span>
          <button
            type="button"
            className="daemon-receipt__dismiss"
            aria-label={`Dismiss notice: ${receipt.text}`}
            onClick={() => dismiss(receipt.id)}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
