/**
 * SettingsModal — the schema-driven config/settings surface.
 *
 * Rows are driven by the SDK's CONFIG_SCHEMA (types / enums / defaults /
 * descriptions / validation hints), merged with the daemon's live config.get()
 * values, so each key gets a TYPED editor: booleans toggle, enums select,
 * numbers validate, strings text, secrets stay masked/write-only
 * (config-redaction.ts). Every feature flag renders as ONE unit — its enable
 * toggle together with the config keys it governs (FEATURE_FLAG_CONFIG_MAP) —
 * placed in the topical group its category implies (settings-model.ts). Owned
 * keys never double-list as orphan rows in their namespace.
 *
 * Honesty bars preserved from the read-only version:
 *   - an admin-scope refusal (403) on config.get reads distinctly from a generic
 *     fetch failure;
 *   - a secret-shaped key never renders its stored value;
 *   - a key the daemon holds but the schema does not know still renders (as a
 *     read-only raw row) so nothing becomes invisible.
 *
 * Writes go through config.set one key at a time (the daemon's real /config
 * contract); the raw key/value form remains, demoted to an explicit escape hatch
 * for unschema'd keys.
 */
import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { Modal } from '../modal/Modal';
import { sdk } from '../../lib/goodvibes';
import { formatError, serializeError } from '../../lib/errors';
import { asRecord } from '../../lib/object';
import { useToast } from '../../lib/toast';
import { ErrorState } from '../feedback/ErrorState';
import { SkeletonBlock } from '../feedback/SkeletonBlock';
import { StepUpSettings } from './StepUpSettings';
import { SettingsField } from './SettingsField';
import { FeatureUnitCard } from './FeatureUnitCard';
import { displayConfigValue } from '../../lib/config-redaction';
import { buildSettingsModel, filterSettingsModel } from '../../lib/settings-model';
import '../../styles/components/settings.css';

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

/** Mirrors CredentialStatusPanel's isAdminRequiredError — the daemon's real 403
 *  admin-scope refusal on config.get carries no machine `code`, status only. */
function isAdminRequiredError(error: unknown): boolean {
  const serialized = serializeError(error);
  const transport = asRecord(serialized.transport);
  const status = typeof serialized.status === 'number' ? serialized.status : typeof transport.status === 'number' ? transport.status : undefined;
  return status === 403;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeGroup, setActiveGroup] = useState<string>('');
  const [search, setSearch] = useState('');
  const [rawKey, setRawKey] = useState('');
  const [rawValue, setRawValue] = useState('');
  const [rawError, setRawError] = useState('');

  const config = useQuery({
    queryKey: ['config'],
    queryFn: () => sdk.operator.config.get(),
    enabled: open,
    retry: false,
  });

  const allGroups = useMemo(() => buildSettingsModel(config.data), [config.data]);
  const groups = useMemo(() => filterSettingsModel(allGroups, search), [allGroups, search]);
  const currentGroup =
    groups.length > 0 ? (groups.find((g) => g.id === activeGroup) ?? groups[0]) : null;

  const refused = config.isError && isAdminRequiredError(config.error);
  const degraded = config.isError && !refused;

  /** Single write path: config.set one key, reconcile via refetch, surface errors. */
  const commitConfig = useCallback(
    async (key: string, value: unknown): Promise<void> => {
      try {
        await sdk.operator.config.set(key, value);
        await queryClient.invalidateQueries({ queryKey: ['config'] });
        toast({ title: 'Config saved', description: `${key} updated.`, tone: 'success' });
      } catch (error) {
        toast({ title: 'Failed to save config', description: formatError(error), tone: 'danger' });
        throw error;
      }
    },
    [queryClient, toast],
  );

  const saveRaw = useMutation({
    mutationFn: () => {
      const key = rawKey.trim();
      if (!key) throw new Error('Config key is required');
      let parsed: unknown = rawValue;
      if (rawValue.trim()) {
        try {
          parsed = JSON.parse(rawValue);
        } catch {
          parsed = rawValue;
        }
      }
      return sdk.operator.config.set(key, parsed);
    },
    onSuccess: async () => {
      const key = rawKey.trim();
      setRawKey('');
      setRawValue('');
      setRawError('');
      await queryClient.invalidateQueries({ queryKey: ['config'] });
      toast({ title: 'Config saved', description: `Key "${key}" updated.`, tone: 'success' });
    },
    onError: (error: unknown) => {
      const message = formatError(error);
      setRawError(message);
      if (message === 'Config key is required') return;
      toast({ title: 'Failed to save config', description: message, tone: 'danger' });
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Settings" size="lg">
      {config.isPending ? (
        <div className="settings-skeleton" aria-label="Loading settings" aria-busy="true">
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonBlock key={i} variant="block" height={32} />
          ))}
        </div>
      ) : refused ? (
        <div className="settings-degraded" role="status">
          <strong>Admin access required</strong>
          <span>Sign in with an admin-scoped token to view and edit config.</span>
        </div>
      ) : degraded ? (
        <ErrorState error={config.error} title="Config unavailable" onRetry={() => void config.refetch()} />
      ) : (
        <>
          <div className="settings-search">
            <input
              type="search"
              value={search}
              placeholder="Search settings, features, keys…"
              aria-label="Search settings"
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="settings-layout">
            <nav className="settings-categories" aria-label="Settings categories">
              {groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  className={
                    group.id === currentGroup?.id
                      ? 'settings-category settings-category--active'
                      : 'settings-category'
                  }
                  onClick={() => setActiveGroup(group.id)}
                >
                  {group.label}
                </button>
              ))}
            </nav>
            <div className="settings-entries">
              {!currentGroup ? (
                <p className="empty-state">No settings match your search.</p>
              ) : (
                <>
                  {currentGroup.featureUnits.map((unit) => (
                    <FeatureUnitCard key={unit.flag.id} unit={unit} onCommit={commitConfig} />
                  ))}
                  {currentGroup.plainRows.length > 0 && (
                    <div className="settings-plain-rows">
                      {currentGroup.plainRows.map((field) => (
                        <SettingsField key={field.key} field={field} onCommit={commitConfig} />
                      ))}
                    </div>
                  )}
                  {currentGroup.rawRows.length > 0 && (
                    <div className="settings-raw-rows">
                      <p className="settings-raw-note">
                        Held by the daemon but not in the config schema — shown read-only. Edit via the
                        Advanced form below.
                      </p>
                      <table className="settings-table">
                        <tbody>
                          {currentGroup.rawRows.map((row) => (
                            <tr key={row.key}>
                              <th scope="row">
                                {row.key}
                                {row.isSecret && <span className="settings-secret-flag"> (secret)</span>}
                              </th>
                              <td className={row.isSecret ? 'settings-value settings-value--secret' : 'settings-value'}>
                                {displayConfigValue(row.key, row.value)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      <section className="settings-advanced panel">
        <div className="panel-title">
          <h2>Advanced — unschema'd keys</h2>
          <Save size={16} aria-hidden="true" />
        </div>
        <p className="settings-advanced-note">
          Escape hatch for keys the config schema does not define. Schema-known keys have typed
          editors above; prefer those.
        </p>
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            saveRaw.mutate();
          }}
        >
          <label>
            Key
            <input value={rawKey} onChange={(event) => setRawKey(event.target.value)} placeholder="settings.path" />
          </label>
          <label>
            Value
            <textarea value={rawValue} onChange={(event) => setRawValue(event.target.value)} placeholder="JSON or text" />
          </label>
          <button className="primary-button" type="submit" disabled={saveRaw.isPending || !rawKey.trim()}>
            Save
          </button>
        </form>
        {rawError && <div className="banner warning" role="alert">{rawError}</div>}
      </section>

      <StepUpSettings />
    </Modal>
  );
}
