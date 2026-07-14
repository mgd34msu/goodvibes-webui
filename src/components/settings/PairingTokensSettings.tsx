/**
 * PairingTokensSettings — the settings/security surface for per-device pairing
 * tokens (SDK 1.8.0's pairing.tokens.* family), replacing the old single
 * shared token model. Lists every paired device (pairing.tokens.list: name,
 * created, last-seen) — the token secret itself is NEVER served here; it is
 * only ever handed back once, at mint time (create/migrate/handoff.create),
 * which is why this list never shows one.
 *
 * Two extra affordances, each with a plain-language description of what it
 * actually does:
 *
 *   - Migrate this browser — mints a fresh, named token for THIS session and
 *     immediately swaps the stored auth token to it (setExplicitAuthToken), so
 *     a browser still relying on the legacy shared token gets its own without
 *     ever being signed out mid-flow.
 *   - Revoke the shared token — a one-way action, gated by a danger confirm
 *     naming the exact consequence (every device still on the shared token is
 *     signed out at once, including this one if it has not migrated yet).
 *     Hidden once legacySharedRevoked is already true — nothing left to revoke.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, RefreshCw, ShieldAlert, Smartphone, Trash2 } from 'lucide-react';
import { sdk, setExplicitAuthToken } from '../../lib/goodvibes';
import type { PublicPairingToken } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import { formatError } from '../../lib/errors';
import { formatRelative } from '../../lib/object';
import { useToast } from '../../lib/toast';
import { useConfirmSheet } from '../confirm/useConfirmSheet';
import { EmptyState } from '../feedback/EmptyState';
import { ErrorState } from '../feedback/ErrorState';
import { SkeletonBlock } from '../feedback/SkeletonBlock';
import '../../styles/components/pairing-tokens.css';

export function PairingTokensSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirmSheet();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const tokens = useQuery({
    queryKey: queryKeys.pairingTokens,
    queryFn: () => sdk.operator.pairing.tokens.list(),
  });

  async function invalidateTokens(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: queryKeys.pairingTokens });
  }

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => sdk.operator.pairing.tokens.rename(id, name),
    onSuccess: async (result) => {
      setEditingId(null);
      if (!result.renamed) {
        toast({ title: 'Rename failed', description: 'The daemon reported no such token.', tone: 'danger' });
      }
      await invalidateTokens();
    },
    onError: (error: unknown) => toast({ title: 'Rename failed', description: formatError(error), tone: 'danger' }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => sdk.operator.pairing.tokens.delete(id),
    onSuccess: async (result) => {
      toast(
        result.revoked
          ? { title: 'Device revoked', description: 'It will be signed out the next time it tries to connect.', tone: 'info' }
          : { title: 'Already revoked', description: 'The daemon reported no such token.', tone: 'info' },
      );
      await invalidateTokens();
    },
    onError: (error: unknown) => toast({ title: 'Revoke failed', description: formatError(error), tone: 'danger' }),
  });

  const migrate = useMutation({
    mutationFn: (name: string) => sdk.operator.pairing.tokens.migrate(name),
    onSuccess: async (result) => {
      // Swap THIS browser over to its own new token immediately — the daemon just
      // minted it for the same principal, so the swap never signs this tab out.
      await setExplicitAuthToken(result.token.token);
      await invalidateTokens();
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth });
      toast({
        title: 'This browser now has its own token',
        description: `Named "${result.token.name}" — it no longer relies on the shared token.`,
        tone: 'success',
      });
    },
    onError: (error: unknown) => toast({ title: 'Migrate failed', description: formatError(error), tone: 'danger' }),
  });

  const revokeShared = useMutation({
    mutationFn: () => sdk.operator.pairing.tokens.revokeShared(),
    onSuccess: async () => {
      toast({ title: 'Shared token revoked', description: 'Any device still using it is now signed out.', tone: 'success' });
      await invalidateTokens();
    },
    onError: (error: unknown) => toast({ title: 'Revoke failed', description: formatError(error), tone: 'danger' }),
  });

  async function handleRevoke(token: PublicPairingToken): Promise<void> {
    const ok = await confirm.ask({
      title: 'Revoke this device',
      target: token.name,
      description: 'It will be signed out immediately and will need to pair again to reconnect.',
      confirmLabel: 'Revoke',
      tone: 'danger',
    });
    if (!ok) return;
    revoke.mutate(token.id);
  }

  async function handleMigrate(): Promise<void> {
    const ok = await confirm.ask({
      title: 'Give this browser its own pairing token',
      description:
        'Mints a new token for this browser and switches it over immediately — you stay signed in, and this browser no longer relies on the shared token.',
      confirmLabel: 'Migrate this browser',
    });
    if (!ok) return;
    migrate.mutate('This browser');
  }

  async function handleRevokeShared(): Promise<void> {
    const ok = await confirm.ask({
      title: 'Revoke the shared token',
      description:
        'This permanently disables it. Any device that has not yet migrated to its own token — including this one, if it still relies on the shared token — is signed out immediately. This cannot be undone.',
      confirmLabel: 'Revoke the shared token',
      tone: 'danger',
    });
    if (!ok) return;
    revokeShared.mutate();
  }

  function startRename(token: PublicPairingToken): void {
    setEditingId(token.id);
    setDraftName(token.name);
  }

  function saveRename(id: string): void {
    const name = draftName.trim();
    if (!name) return;
    rename.mutate({ id, name });
  }

  const rows = tokens.data?.tokens ?? [];
  const legacySharedRevoked = tokens.data?.legacySharedRevoked ?? false;

  return (
    <section className="panel pairing-tokens-panel" data-testid="pairing-tokens">
      {confirm.element}
      <div className="panel-title">
        <h2>Devices &amp; pairing</h2>
        <KeyRound size={18} aria-hidden="true" />
      </div>
      <p className="form-note">
        Every paired surface (a phone, another browser…) has its own token. Renaming or
        revoking one never affects any other device — the token itself is only ever shown
        once, at the moment it is minted; this list never shows one.
      </p>

      <div className="pairing-tokens-toolbar">
        <button type="button" className="icon-button" title="Refresh devices" onClick={() => void tokens.refetch()}>
          <RefreshCw size={15} className={tokens.isFetching ? 'spin' : undefined} />
        </button>
      </div>

      {tokens.isPending && <SkeletonBlock variant="text" lines={3} />}

      {tokens.isError && (
        <ErrorState error={tokens.error} onRetry={() => void tokens.refetch()} title="Failed to load paired devices" />
      )}

      {tokens.isSuccess && rows.length === 0 && (
        <EmptyState
          icon={<Smartphone size={28} />}
          title="No per-device tokens yet"
          description="Pairing a device (goodvibes pair, or the hand-off QR) mints one automatically."
        />
      )}

      {tokens.isSuccess && rows.length > 0 && (
        <ul className="pairing-tokens-rows">
          {rows.map((token) => (
            <li key={token.id} className="pairing-token-row" data-token-id={token.id}>
              {editingId === token.id ? (
                <form
                  className="pairing-token-row__rename-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveRename(token.id);
                  }}
                >
                  <label className="sr-only" htmlFor={`pairing-token-rename-${token.id}`}>
                    Device name
                  </label>
                  <input
                    id={`pairing-token-rename-${token.id}`}
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    autoFocus
                  />
                  <button type="submit" className="secondary-button" disabled={rename.isPending || !draftName.trim()}>
                    Save
                  </button>
                  <button type="button" className="secondary-button" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="pairing-token-row__main">
                  <strong className="pairing-token-row__name">{token.name}</strong>
                  <small className="pairing-token-row__meta">
                    created {formatRelative(token.createdAt)} ·{' '}
                    {token.lastSeenAt ? `last seen ${formatRelative(token.lastSeenAt)}` : 'never seen'}
                  </small>
                </div>
              )}
              {editingId !== token.id && (
                <div className="pairing-token-row__actions">
                  <button
                    type="button"
                    className="icon-button"
                    title={`Rename ${token.name}`}
                    aria-label={`Rename ${token.name}`}
                    onClick={() => startRename(token)}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="secondary-button pairing-token-row__revoke"
                    disabled={revoke.isPending && revoke.variables === token.id}
                    onClick={() => void handleRevoke(token)}
                  >
                    <Trash2 size={14} /> {revoke.isPending && revoke.variables === token.id ? 'Revoking…' : 'Revoke'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="pairing-tokens-legacy">
        <div className="pairing-tokens-legacy__head">
          <ShieldAlert size={16} aria-hidden="true" />
          <strong>Shared token</strong>
        </div>
        {legacySharedRevoked ? (
          <p className="form-note">The legacy shared token has been revoked. Every device now needs its own token.</p>
        ) : (
          <>
            <p className="form-note">
              Older devices may still be signed in with one shared token. Give each its own token
              before revoking the shared one — revoking it signs out anything still using it.
            </p>
            <div className="pairing-tokens-legacy__actions">
              <button
                type="button"
                className="secondary-button"
                disabled={migrate.isPending}
                onClick={() => void handleMigrate()}
              >
                {migrate.isPending ? 'Migrating…' : 'Give this browser its own token'}
              </button>
              <button
                type="button"
                className="secondary-button pairing-tokens-legacy__revoke"
                disabled={revokeShared.isPending}
                onClick={() => void handleRevokeShared()}
              >
                {revokeShared.isPending ? 'Revoking…' : 'Revoke the shared token'}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
