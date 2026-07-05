import { Activity, KeyRound, Radio, ShieldCheck, Zap } from 'lucide-react';
import { useDaemonHealth } from '../../hooks/useDaemonHealth';
import {
  connectionLabel,
  authLabel,
  workingLabel,
  formatLatency,
  sseLabel,
} from '../../lib/daemon-health';
import { ConnectionDot } from './ConnectionDot';
import '../../styles/components/status.css';

/**
 * Persistent status strip rendered at the bottom of the shell.
 * Height is controlled by the `--statusstrip-height` layout token (32px).
 *
 * Accessibility:
 * - Outer element is a semantic <footer> (implicit contentinfo role).
 *   It does NOT carry role="status" — that would broadcast every latency
 *   update and task count to screen readers repeatedly.
 * - The single visually-hidden aria-live="polite" region owns all
 *   screen-reader announcements (connection state changes only).
 * - Color is never the sole indicator (dot + label + icon).
 */
export function StatusStrip() {
  const { connection, signedIn, working, latencyMs, sse, activeTurns, queuedTasks, modelName } = useDaemonHealth();

  const isBusy = activeTurns > 0 || queuedTasks > 0;

  return (
    <footer className="status-strip">
      {/* Live region — announces the three honest axes to screen readers. Never
          collapses reachable into "Connected": a reachable-but-401 daemon is
          reported as reachable AND signed-out AND no-access, three signals that
          can disagree. */}
      <span
        className="status-strip__live-region"
        aria-live="polite"
        aria-atomic="true"
      >
        {`${connectionLabel(connection)}, ${authLabel(signedIn)}, ${workingLabel(working)}`}
      </span>

      {/* REACHABLE axis */}
      <div className="status-strip__segment status-strip__segment--connection">
        <ConnectionDot state={connection} />
        <span className="status-strip__label">{connectionLabel(connection)}</span>
      </div>

      {/* SIGNED-IN axis */}
      <div
        className={`status-strip__segment status-strip__segment--auth-${signedIn}`}
        aria-label={`Auth: ${authLabel(signedIn)}`}
      >
        <KeyRound className="status-strip__icon" aria-hidden="true" size={11} />
        <span className="status-strip__label">{authLabel(signedIn)}</span>
      </div>

      {/* WORKING axis (an authed read succeeds without 401) */}
      <div
        className={`status-strip__segment status-strip__segment--working-${working}`}
        aria-label={`Access: ${workingLabel(working)}`}
      >
        <ShieldCheck className="status-strip__icon" aria-hidden="true" size={11} />
        <span className="status-strip__label">{workingLabel(working)}</span>
      </div>

      {/* Latency */}
      <div className="status-strip__segment" aria-label={`Latency: ${formatLatency(latencyMs)}`}>
        <Zap className="status-strip__icon" aria-hidden="true" size={11} />
        <span className="status-strip__label">{formatLatency(latencyMs)}</span>
      </div>

      {/* Active work */}
      <div
        className={`status-strip__segment${isBusy ? ' status-strip__segment--active' : ''}`}
        aria-label={`Active turns: ${activeTurns}, queued: ${queuedTasks}`}
      >
        <Activity className="status-strip__icon" aria-hidden="true" size={11} />
        <span className="status-strip__label">
          {activeTurns > 0 ? `${activeTurns} active` : null}
          {activeTurns > 0 && queuedTasks > 0 ? ', ' : null}
          {queuedTasks > 0 ? `${queuedTasks} queued` : null}
          {!isBusy ? 'Idle' : null}
        </span>
      </div>

      {/* SSE health */}
      <div
        className={`status-strip__segment status-strip__segment--sse-${sse}`}
        aria-label={`Realtime stream: ${sseLabel(sse)}`}
      >
        <Radio className="status-strip__icon" aria-hidden="true" size={11} />
        <span className="status-strip__label">{sseLabel(sse)}</span>
      </div>

      {/* Model name (rightmost, optional) */}
      {modelName !== null && (
        <div className="status-strip__segment status-strip__segment--model status-strip__segment--right">
          <span className="status-strip__label status-strip__label--mono">{modelName}</span>
        </div>
      )}
    </footer>
  );
}
