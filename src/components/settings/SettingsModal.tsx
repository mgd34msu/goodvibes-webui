/**
 * SettingsModal — the config/settings surface, moved off the always-visible
 * AdminView page and into a modal (the platform's surface doctrine: modals
 * are a configuration surface, panels/pages are observability — "provider
 * config" and "settings-sync" are named examples of what moves to modals).
 *
 * Reads config.get (honest degraded states: an admin-scope refusal reads
 * distinctly from a genuine fetch failure, mirroring CredentialStatusPanel's
 * pattern) and writes through config.set, one key at a time (the daemon's
 * real /config contract — see src/lib/goodvibes.ts's config.* comment).
 *
 * Categorized using the TUI's own settings-modal category naming
 * (src/lib/config-redaction.ts's CATEGORY_LABELS, ported from
 * goodvibes-tui's settings-modal-helpers.ts CATEGORY_LABELS) for cross-surface
 * naming parity. Every value is masked before rendering if the key is
 * secret-shaped (isSecretConfigKey) — never round-tripped back unless the
 * user explicitly retypes it.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { Modal } from '../modal/Modal';
import { sdk } from '../../lib/goodvibes';
import { formatError, serializeError } from '../../lib/errors';
import { asRecord } from '../../lib/object';
import { useToast } from '../../lib/toast';
import { ErrorState } from '../feedback/ErrorState';
import { SkeletonBlock } from '../feedback/SkeletonBlock';
import { displayConfigValue, flattenConfig, isSecretConfigKey } from '../../lib/config-redaction';
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
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [rawKey, setRawKey] = useState('');
  const [rawValue, setRawValue] = useState('');
  const [rawError, setRawError] = useState('');

  const config = useQuery({
    queryKey: ['config'],
    queryFn: () => sdk.operator.config.get(),
    enabled: open,
    retry: false,
  });

  const entries = useMemo(() => flattenConfig(config.data), [config.data]);
  const categories = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const entry of entries) {
      if (!seen.has(entry.category)) {
        seen.add(entry.category);
        ordered.push(entry.category);
      }
    }
    return ordered;
  }, [entries]);
  const currentCategory = activeCategory && categories.includes(activeCategory) ? activeCategory : categories[0] ?? '';
  const visibleEntries = useMemo(
    () => entries.filter((entry) => entry.category === currentCategory),
    [entries, currentCategory],
  );

  const refused = config.isError && isAdminRequiredError(config.error);
  const degraded = config.isError && !refused;

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
      // Validation errors (empty key) are shown inline only — no toast needed.
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
        <div className="settings-layout">
          <nav className="settings-categories" aria-label="Settings categories">
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className={category === currentCategory ? 'settings-category settings-category--active' : 'settings-category'}
                onClick={() => setActiveCategory(category)}
              >
                {category}
              </button>
            ))}
          </nav>
          <div className="settings-entries">
            {visibleEntries.length === 0 ? (
              <p className="empty-state">No settings in this category.</p>
            ) : (
              <table className="settings-table">
                <tbody>
                  {visibleEntries.map((entry) => (
                    <tr key={entry.key}>
                      <th scope="row">
                        {entry.key}
                        {isSecretConfigKey(entry.key) && <span className="settings-secret-flag"> (secret)</span>}
                      </th>
                      <td className={isSecretConfigKey(entry.key) ? 'settings-value settings-value--secret' : 'settings-value'}>
                        {displayConfigValue(entry.key, entry.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      <section className="settings-advanced panel">
        <div className="panel-title">
          <h2>Advanced</h2>
          <Save size={16} aria-hidden="true" />
        </div>
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
    </Modal>
  );
}
