/**
 * TailscaleSettings — the one confirmed action behind a "needs https — available
 * via tailscale" label, reachable from the browser instead of only the TUI
 * (tailscale.get / tailscale.serve.run, SDK 1.8.0's LAN-http posture work).
 *
 * READ-ONLY detection first: tailscale.get reports whether the binary is present,
 * the node is logged in, and its MagicDNS name. This panel renders NOTHING while
 * that detection is pending or when tailscale is not a usable environment — no nag,
 * no dead button, matching the daemon's own "quiet when absent" contract. Only when
 * tailscale reports available && loggedIn && a resolvable httpsUrl does the one
 * action appear: "Serve over tailscale", behind the shared ConfirmSheet idiom (same
 * pattern as PairingTokensSettings' revoke/migrate actions).
 *
 * tailscale.serve.run is the ONE state-changing tailscale command the daemon ever
 * runs. The attempt is recorded with an honest receipt either way — a failure
 * renders the daemon's own detail text, never a generic error. On success the
 * resulting https MagicDNS URL renders as a real link, and the daemon's
 * web.publicBaseUrl updates to it (publicBaseUrlUpdated echoes whether that write
 * landed).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Radio, XCircle } from 'lucide-react';
import { sdk } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import { formatError } from '../../lib/errors';
import { formatRelative } from '../../lib/object';
import { useToast } from '../../lib/toast';
import { useConfirmSheet } from '../confirm/useConfirmSheet';
import '../../styles/components/tailscale.css';

export function TailscaleSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirmSheet();

  const detection = useQuery({
    queryKey: queryKeys.tailscale,
    queryFn: () => sdk.operator.tailscale.get(),
  });

  const serveRun = useMutation({
    mutationFn: () => sdk.operator.tailscale.serveRun(),
    onSuccess: async (result) => {
      toast(
        result.receipt.ok
          ? { title: 'Serving over tailscale', description: result.receipt.detail, tone: 'success' }
          : { title: 'Tailscale serve failed', description: result.receipt.detail, tone: 'danger' },
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.tailscale });
    },
    onError: (error: unknown) => toast({ title: 'Tailscale serve failed', description: formatError(error), tone: 'danger' }),
  });

  async function handleServe(): Promise<void> {
    const ok = await confirm.ask({
      title: 'Serve over tailscale',
      description:
        'Runs `tailscale serve --bg` so tailscale fronts this daemon at its https MagicDNS URL. '
        + 'The daemon never mints its own certificate — tailscale terminates TLS. Safe to run again.',
      confirmLabel: 'Serve over tailscale',
    });
    if (!ok) return;
    serveRun.mutate();
  }

  // Quiet by construction: pending, errored, or genuinely absent all render nothing —
  // no nag, no dead button. A daemon build without tailscale.get at all (an older
  // daemon) also lands here since detection.data stays undefined.
  const usable = detection.data?.available && detection.data.loggedIn && detection.data.httpsUrl;
  if (!usable || !detection.data) return null;

  // Prefer the mutation's OWN just-returned receipt (instant, no refetch round-trip
  // needed) and fall back to the query's last-known receipt otherwise (e.g. on first
  // load, or after a page reload where a prior serve already ran). invalidateQueries
  // in the mutation's onSuccess still keeps the query itself in sync for any OTHER
  // consumer or a later remount.
  const lastServe = serveRun.data?.receipt ?? detection.data.lastServe;

  return (
    <section className="panel tailscale-panel" data-testid="tailscale-settings">
      {confirm.element}
      <div className="panel-title">
        <h2>Tailscale</h2>
        <Radio size={18} aria-hidden="true" />
      </div>
      <p className="form-note">
        Connected as <strong>{detection.data.magicDnsName}</strong>. Serving over tailscale fronts this
        daemon at an https MagicDNS URL — the one browser-gated capabilities need, without the daemon
        ever minting its own certificate.
      </p>

      {lastServe && (
        <div
          className={`tailscale-panel__receipt tailscale-panel__receipt--${lastServe.ok ? 'ok' : 'danger'}`}
          role="status"
        >
          {lastServe.ok ? <CheckCircle2 size={15} aria-hidden="true" /> : <XCircle size={15} aria-hidden="true" />}
          <span>
            {lastServe.ok && lastServe.url ? (
              <>
                Serving at{' '}
                <a href={lastServe.url} target="_blank" rel="noreferrer">{lastServe.url}</a>
              </>
            ) : (
              lastServe.detail
            )}
            {' · '}
            {formatRelative(lastServe.at)}
          </span>
        </div>
      )}

      <button
        type="button"
        className="primary-button"
        disabled={serveRun.isPending}
        onClick={() => void handleServe()}
      >
        {serveRun.isPending ? 'Setting up…' : lastServe?.ok ? 'Serve over tailscale again' : 'Serve over tailscale'}
      </button>

      {serveRun.isError && (
        <div className="banner warning" role="alert">{formatError(serveRun.error)}</div>
      )}
    </section>
  );
}
