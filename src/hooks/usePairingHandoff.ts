/**
 * usePairingHandoff — turn a `#pair=<token>` fragment into a signed-in session.
 *
 * When the URL fragment carries a pairing token (the QR from `goodvibes pair` in
 * the terminal), this:
 *   1. captures the token and strips it from the URL IMMEDIATELY, so the one-time
 *      secret never lingers in the address bar or a history entry;
 *   2. stores it via the existing token store and validates it against the
 *      daemon's cheap authenticated `auth.current` call (setExplicitAuthToken,
 *      which self-clears a token the daemon rejects);
 *   3. on success, invalidates every query so the shell reveals itself.
 *
 * WHY CAPTURE HAPPENS AT MODULE/RENDER TIME, NOT IN AN EFFECT: useUrlState's own
 * mount effect normalizes a bare URL to `?view=chat` and, in doing so, drops the
 * fragment. Its effect runs before this hook's effect (earlier hook order), so an
 * effect here would read an already-stripped hash and lose the token. The capture
 * runs once, synchronously, the first time the hook module is exercised — before
 * any effect — so it always beats that normalization.
 *
 * The status drives first paint: `pending` shows a neutral "pairing" splash
 * INSTEAD of the signed-out gate (no gate flash while the token validates);
 * `error` falls through to the gate, which surfaces the rejection.
 */

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { setExplicitAuthToken } from '../lib/goodvibes';
import { parsePairingTokenFromHash, stripPairingFragment } from '../lib/pairing';

export type PairingStatus = 'idle' | 'pending' | 'error';

export interface PairingHandoff {
  status: PairingStatus;
  error: unknown;
}

// The pairing token captured ONCE, the first time it is asked for — before any
// router normalization can strip the fragment. Consuming it here (and stripping
// the URL) is idempotent across React StrictMode's double render.
const capture: { done: boolean; token: string | null } = { done: false, token: null };

function capturePairingToken(): string | null {
  if (!capture.done) {
    capture.done = true;
    capture.token = typeof window !== 'undefined'
      ? parsePairingTokenFromHash(window.location.hash)
      : null;
    if (capture.token !== null) stripPairingFragment();
  }
  return capture.token;
}

/** Test-only: reset the module-level capture between cases. */
export function resetPairingCaptureForTest(): void {
  capture.done = false;
  capture.token = null;
}

export function usePairingHandoff(): PairingHandoff {
  const queryClient = useQueryClient();
  // capturePairingToken() runs during this first-render initializer — before any
  // effect (including useUrlState's URL normalization) — so the fragment is read
  // and scrubbed before it can be dropped.
  const [status, setStatus] = useState<PairingStatus>(() =>
    capturePairingToken() ? 'pending' : 'idle',
  );
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const token = capturePairingToken();
    if (token === null) return;
    void (async () => {
      try {
        await setExplicitAuthToken(token);
        // Auth/boot/health flip to signed-in and the shell reveals.
        await queryClient.invalidateQueries();
        setStatus('idle');
      } catch (err) {
        setError(err);
        setStatus('error');
      }
    })();
    // Mount-once: the token was captured synchronously above; a later hash change
    // is not a new pairing hand-off (the app is already mounted and interactive).
    // A setState after an unmount is a silent no-op in React 19, so no cancel flag
    // is needed for this one-shot hand-off.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status, error };
}
