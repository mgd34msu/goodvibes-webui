/**
 * PrincipalsView — read-first admin over the named-identity registry (principals.*)
 * and per-channel profile bindings (channels.profiles.*).
 *
 * Principals: list every principal with its channel identities (principals.list);
 * create/update/delete each go through a confirm sheet — these mutate who a channel
 * message resolves to, and delete is permanent (delete-means-delete, an honest
 * `deleted` boolean, never a phantom-removal 200).
 *
 * Channel profiles: list every surface/channel binding (channels.profiles.list) — the
 * model/provider/permission defaults a channel's originated sessions inherit — with
 * set (upsert) and delete (behind a confirm sheet).
 *
 * Neither family emits a wire event yet (a standing gap shared with fleet.*,
 * checkpoints.*, ci.*, checkin.* — see queryKeys.principals/channelProfiles), so
 * freshness comes from mutation-driven invalidation and a manual refresh.
 */

import { useState, type SyntheticEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Settings2, Trash2, Users } from 'lucide-react';
import { sdk } from '../../lib/goodvibes';
import type { OperatorMethodInput, OperatorMethodOutput } from '../../lib/goodvibes';
import { queryKeys } from '../../lib/queries';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { SkeletonBlock } from '../../components/feedback/SkeletonBlock';
import { useConfirmSheet } from '../../components/confirm/useConfirmSheet';
import { formatError, isMethodUnavailableError } from '../../lib/errors';
import { useToast } from '../../lib/toast';
import '../../styles/components/principals.css';

type Principal = OperatorMethodOutput<'principals.list'>['principals'][number];
type PrincipalKind = Principal['kind'];
type ChannelBinding = OperatorMethodOutput<'channels.profiles.list'>['bindings'][number];
type PermissionMode = NonNullable<ChannelBinding['permissionMode']>;

const PRINCIPAL_KINDS: readonly PrincipalKind[] = ['user', 'bot', 'service', 'token'];
const PERMISSION_MODES: readonly PermissionMode[] = ['plan', 'normal', 'accept-edits', 'auto'];

function identitiesFromDraft(draft: string): OperatorMethodInput<'principals.create'>['identities'] {
  // One "channel:value" pair per line — the simplest phone-friendly encoding for a
  // repeatable field without a dynamic row-add control.
  return draft
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [channel, ...rest] = line.split(':');
      return { channel: channel.trim(), value: rest.join(':').trim() };
    })
    .filter((identity) => identity.channel && identity.value);
}

function identitiesToDraft(identities: Principal['identities']): string {
  return identities.map((i) => `${i.channel}:${i.value}`).join('\n');
}

function PrincipalForm({
  initial,
  onSubmit,
  onCancel,
  submitting,
  submitLabel,
}: {
  initial?: Pick<Principal, 'name' | 'kind' | 'identities'>;
  onSubmit: (input: { name: string; kind: PrincipalKind; identities: OperatorMethodInput<'principals.create'>['identities'] }) => void;
  onCancel: () => void;
  submitting: boolean;
  submitLabel: string;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<PrincipalKind>(initial?.kind ?? 'user');
  const [identitiesDraft, setIdentitiesDraft] = useState(initial ? identitiesToDraft(initial.identities) : '');

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), kind, identities: identitiesFromDraft(identitiesDraft) });
  }

  return (
    <form className="principals-form" onSubmit={handleSubmit}>
      <label>
        Name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={submitting} required />
      </label>
      <label>
        Kind
        <select value={kind} onChange={(e) => setKind(e.target.value as PrincipalKind)} disabled={submitting}>
          {PRINCIPAL_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
      <label>
        Channel identities (one per line, "channel:value")
        <textarea
          value={identitiesDraft}
          onChange={(e) => setIdentitiesDraft(e.target.value)}
          placeholder="slack:U123ABC"
          rows={3}
          disabled={submitting}
        />
      </label>
      <div className="principals-form__actions">
        <button type="submit" disabled={submitting || !name.trim()}>{submitting ? 'Saving…' : submitLabel}</button>
        <button type="button" className="secondary" onClick={onCancel} disabled={submitting}>Cancel</button>
      </div>
    </form>
  );
}

function PrincipalsSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirmSheet();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState('');

  const list = useQuery({
    queryKey: queryKeys.principals,
    queryFn: () => sdk.operator.principals.list(),
  });
  const principals = list.data?.principals ?? [];
  const unavailable = list.isError && isMethodUnavailableError(list.error);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.principals });

  const create = useMutation({
    mutationFn: (input: OperatorMethodInput<'principals.create'>) => sdk.operator.principals.create(input),
    onSuccess: async () => {
      setShowCreate(false);
      await invalidate();
      toast({ title: 'Principal created', tone: 'success' });
    },
    onError: (error: unknown) => toast({ title: 'Failed to create principal', description: formatError(error), tone: 'danger' }),
  });

  const update = useMutation({
    mutationFn: ({ principalId, input }: { principalId: string; input: Omit<OperatorMethodInput<'principals.update'>, 'principalId'> }) =>
      sdk.operator.principals.update(principalId, input),
    onSuccess: async () => {
      setEditingId('');
      await invalidate();
      toast({ title: 'Principal updated', tone: 'success' });
    },
    onError: (error: unknown) => toast({ title: 'Failed to update principal', description: formatError(error), tone: 'danger' }),
  });

  const remove = useMutation({
    mutationFn: (principalId: string) => sdk.operator.principals.delete(principalId),
    onSuccess: async (result) => {
      if (!result.deleted) toast({ title: 'Principal already gone', description: 'No principal with that id existed.', tone: 'info' });
      await invalidate();
    },
    onError: (error: unknown) => toast({ title: 'Failed to delete principal', description: formatError(error), tone: 'danger' }),
  });

  async function handleCreate(input: { name: string; kind: PrincipalKind; identities: OperatorMethodInput<'principals.create'>['identities'] }): Promise<void> {
    const ok = await confirm.ask({
      title: 'Create this principal',
      target: input.name,
      description: `Kind: ${input.kind}. ${input.identities?.length ? `${input.identities.length} channel identit${input.identities.length === 1 ? 'y' : 'ies'} mapped.` : 'No channel identities mapped yet.'}`,
      confirmLabel: 'Create',
    });
    if (!ok) return;
    create.mutate(input);
  }

  async function handleUpdate(principal: Principal, input: { name: string; kind: PrincipalKind; identities: OperatorMethodInput<'principals.create'>['identities'] }): Promise<void> {
    const ok = await confirm.ask({
      title: 'Save changes to this principal',
      target: principal.name,
      description: `Name: ${input.name}. Kind: ${input.kind}. ${input.identities?.length ?? 0} channel identit${(input.identities?.length ?? 0) === 1 ? 'y' : 'ies'} mapped — this REPLACES the identity set.`,
      confirmLabel: 'Save',
    });
    if (!ok) return;
    update.mutate({ principalId: principal.id, input });
  }

  async function handleDelete(principal: Principal): Promise<void> {
    const ok = await confirm.ask({
      title: 'Delete this principal',
      target: principal.name,
      description: 'This is permanent. Any channel identities mapped to it will resolve as unknown until re-mapped.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    remove.mutate(principal.id);
  }

  return (
    <section className="principals-section">
      {confirm.element}
      <div className="principals-section__header">
        <h2>Principals</h2>
        <div className="principals-section__actions">
          <button className="icon-button" type="button" title="New principal" onClick={() => setShowCreate((v) => !v)}>
            <Plus size={15} />
          </button>
          <button className="icon-button" type="button" title="Refresh" onClick={() => void list.refetch()}>
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {showCreate && (
        <PrincipalForm submitting={create.isPending} submitLabel="Create" onCancel={() => setShowCreate(false)} onSubmit={(input) => void handleCreate(input)} />
      )}

      {list.isPending && <SkeletonBlock variant="text" lines={4} />}
      {unavailable && <div className="principals-empty" role="note">Principals are unavailable on this daemon.</div>}
      {list.isError && !unavailable && (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load principals" />
      )}
      {list.isSuccess && principals.length === 0 && (
        <EmptyState
          icon={<Users size={28} />}
          title="No principals yet"
          description="Create one to attribute channel messages to a named identity."
          action={{ label: 'New principal', onClick: () => setShowCreate(true) }}
        />
      )}

      {principals.length > 0 && (
        <ul className="principals-rows">
          {principals.map((principal) => (
            <li key={principal.id} className="principals-row">
              {editingId === principal.id ? (
                <PrincipalForm
                  initial={principal}
                  submitting={update.isPending}
                  submitLabel="Save"
                  onCancel={() => setEditingId('')}
                  onSubmit={(input) => void handleUpdate(principal, input)}
                />
              ) : (
                <>
                  <div className="principals-row__main">
                    <span className="principals-row__name">{principal.name}</span>
                    <span className="badge neutral">{principal.kind}</span>
                    <div className="principals-row__identities">
                      {principal.identities.length === 0
                        ? <span className="principals-row__meta">no channel identities</span>
                        : principal.identities.map((identity, index) => (
                          <span key={index} className="badge neutral">{identity.channel}:{identity.value}</span>
                        ))}
                    </div>
                  </div>
                  <div className="principals-row__actions">
                    <button type="button" className="icon-button" title="Edit" onClick={() => setEditingId(principal.id)}>
                      <Settings2 size={14} />
                    </button>
                    <button type="button" className="icon-button" title="Delete" onClick={() => void handleDelete(principal)} disabled={remove.isPending}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ChannelProfileForm({
  initial,
  onSubmit,
  onCancel,
  submitting,
}: {
  initial?: Partial<ChannelBinding>;
  onSubmit: (input: OperatorMethodInput<'channels.profiles.set'>) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [surfaceKind, setSurfaceKind] = useState(initial?.surfaceKind ?? '');
  const [channelId, setChannelId] = useState(initial?.channelId ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [provider, setProvider] = useState(initial?.provider ?? '');
  const [permissionMode, setPermissionMode] = useState<PermissionMode | ''>(initial?.permissionMode ?? '');

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!surfaceKind.trim()) return;
    onSubmit({
      surfaceKind: surfaceKind.trim(),
      ...(channelId.trim() ? { channelId: channelId.trim() } : {}),
      ...(model.trim() ? { model: model.trim() } : {}),
      ...(provider.trim() ? { provider: provider.trim() } : {}),
      ...(permissionMode ? { permissionMode } : {}),
    });
  }

  return (
    <form className="principals-form" onSubmit={handleSubmit}>
      <label>
        Surface kind
        <input type="text" value={surfaceKind} onChange={(e) => setSurfaceKind(e.target.value)} placeholder="slack" disabled={submitting || Boolean(initial?.surfaceKind)} required />
      </label>
      <label>
        Channel id (optional — scopes the binding to one channel)
        <input type="text" value={channelId} onChange={(e) => setChannelId(e.target.value)} disabled={submitting || Boolean(initial?.channelId)} />
      </label>
      <label>
        Model (optional)
        <input type="text" value={model} onChange={(e) => setModel(e.target.value)} disabled={submitting} />
      </label>
      <label>
        Provider (optional)
        <input type="text" value={provider} onChange={(e) => setProvider(e.target.value)} disabled={submitting} />
      </label>
      <label>
        Permission mode (optional)
        <select value={permissionMode} onChange={(e) => setPermissionMode(e.target.value as PermissionMode | '')} disabled={submitting}>
          <option value="">— unset —</option>
          {PERMISSION_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
        </select>
      </label>
      <div className="principals-form__actions">
        <button type="submit" disabled={submitting || !surfaceKind.trim()}>{submitting ? 'Saving…' : 'Save'}</button>
        <button type="button" className="secondary" onClick={onCancel} disabled={submitting}>Cancel</button>
      </div>
    </form>
  );
}

function ChannelProfilesSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirmSheet();
  const [showCreate, setShowCreate] = useState(false);
  const [editingKey, setEditingKey] = useState('');

  const list = useQuery({
    queryKey: queryKeys.channelProfiles,
    queryFn: () => sdk.operator.channels.profiles.list(),
  });
  const bindings = list.data?.bindings ?? [];
  const unavailable = list.isError && isMethodUnavailableError(list.error);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.channelProfiles });

  const set = useMutation({
    mutationFn: (input: OperatorMethodInput<'channels.profiles.set'>) => sdk.operator.channels.profiles.set(input),
    onSuccess: async () => {
      setShowCreate(false);
      setEditingKey('');
      await invalidate();
      toast({ title: 'Channel profile saved', tone: 'success' });
    },
    onError: (error: unknown) => toast({ title: 'Failed to save channel profile', description: formatError(error), tone: 'danger' }),
  });

  const remove = useMutation({
    mutationFn: ({ surfaceKind, channelId }: { surfaceKind: string; channelId?: string }) => sdk.operator.channels.profiles.delete(surfaceKind, channelId),
    onSuccess: async (result) => {
      if (!result.deleted) toast({ title: 'Binding already gone', description: 'No binding with that key existed.', tone: 'info' });
      await invalidate();
    },
    onError: (error: unknown) => toast({ title: 'Failed to delete channel profile', description: formatError(error), tone: 'danger' }),
  });

  async function handleDelete(binding: ChannelBinding): Promise<void> {
    const ok = await confirm.ask({
      title: 'Delete this channel profile binding',
      target: binding.channelId ? `${binding.surfaceKind}:${binding.channelId}` : binding.surfaceKind,
      description: 'Sessions this channel originates will no longer inherit these defaults.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    remove.mutate({ surfaceKind: binding.surfaceKind, channelId: binding.channelId });
  }

  return (
    <section className="principals-section">
      {confirm.element}
      <div className="principals-section__header">
        <h2>Channel profiles</h2>
        <div className="principals-section__actions">
          <button className="icon-button" type="button" title="New binding" onClick={() => setShowCreate((v) => !v)}>
            <Plus size={15} />
          </button>
          <button className="icon-button" type="button" title="Refresh" onClick={() => void list.refetch()}>
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {showCreate && (
        <ChannelProfileForm submitting={set.isPending} onCancel={() => setShowCreate(false)} onSubmit={(input) => set.mutate(input)} />
      )}

      {list.isPending && <SkeletonBlock variant="text" lines={4} />}
      {unavailable && <div className="principals-empty" role="note">Channel profiles are unavailable on this daemon.</div>}
      {list.isError && !unavailable && (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} title="Failed to load channel profiles" />
      )}
      {list.isSuccess && bindings.length === 0 && (
        <EmptyState title="No channel profile bindings yet" description="Bind a surface (and optionally one channel within it) to model/permission defaults." />
      )}

      {bindings.length > 0 && (
        <ul className="principals-rows">
          {bindings.map((binding) => {
            const key = `${binding.surfaceKind}:${binding.channelId ?? ''}`;
            return (
              <li key={key} className="principals-row">
                {editingKey === key ? (
                  <ChannelProfileForm
                    initial={binding}
                    submitting={set.isPending}
                    onCancel={() => setEditingKey('')}
                    onSubmit={(input) => set.mutate(input)}
                  />
                ) : (
                  <>
                    <div className="principals-row__main">
                      <span className="principals-row__name">{binding.surfaceKind}{binding.channelId ? `:${binding.channelId}` : ''}</span>
                      {binding.model && <span className="badge neutral">model: {binding.model}</span>}
                      {binding.provider && <span className="badge neutral">provider: {binding.provider}</span>}
                      {binding.permissionMode && <span className="badge neutral">{binding.permissionMode}</span>}
                    </div>
                    <div className="principals-row__actions">
                      <button type="button" className="icon-button" title="Edit" onClick={() => setEditingKey(key)}>
                        <Settings2 size={14} />
                      </button>
                      <button type="button" className="icon-button" title="Delete" onClick={() => void handleDelete(binding)} disabled={remove.isPending}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function PrincipalsView() {
  return (
    <div className="principals-view">
      <PrincipalsSection />
      <ChannelProfilesSection />
    </div>
  );
}
