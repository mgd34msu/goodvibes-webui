/**
 * FeatureUnitCard — a feature flag rendered as ONE unit (owner ruling,
 * 2026-07-11): its enable toggle together with the typed editors for the config
 * keys it governs. The flag's persisted override lives at
 * `featureFlags.<id>` in the daemon config, so the toggle writes that key
 * through the same config.set path as every other field.
 *
 * Honest states:
 *   - `killed` renders locked (the daemon will not re-enable a killed gate from
 *     a config write) with a plain note, never a toggle that silently no-ops.
 *   - a non-runtime-toggleable flag notes that its change applies on restart.
 *   - the current state distinguishes an explicit override from the flag default.
 */
import { useState } from 'react';
import type { FeatureUnitModel } from '../../lib/settings-model';
import { SettingsField } from './SettingsField';

interface FeatureUnitCardProps {
  readonly unit: FeatureUnitModel;
  readonly onCommit: (key: string, value: unknown) => Promise<void>;
}

export function FeatureUnitCard({ unit, onCommit }: FeatureUnitCardProps) {
  const { flag, state, overridden, fields } = unit;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const killed = state === 'killed';
  const enabled = state === 'enabled';

  async function toggle(next: boolean): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await onCommit(`featureFlags.${flag.id}`, next ? 'enabled' : 'disabled');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="feature-unit" data-flag-id={flag.id} data-flag-state={state}>
      <header className="feature-unit-head">
        <div className="feature-unit-title">
          <h3>{flag.name}</h3>
          <span className={`feature-unit-state feature-unit-state--${state}`}>
            {killed ? 'Killed' : enabled ? 'Enabled' : 'Disabled'}
            {overridden ? '' : ' (default)'}
          </span>
        </div>
        {killed ? (
          <span className="feature-unit-locked" title="A killed gate cannot be re-enabled from a config write.">
            Locked
          </span>
        ) : (
          <label className="settings-field-toggle feature-unit-toggle">
            <input
              type="checkbox"
              checked={enabled}
              disabled={saving}
              aria-label={`Enable ${flag.name}`}
              onChange={(e) => void toggle(e.target.checked)}
            />
            <span>{enabled ? 'On' : 'Off'}</span>
          </label>
        )}
      </header>
      {flag.description && <p className="feature-unit-desc">{flag.description}</p>}
      {!flag.runtimeToggleable && (
        <p className="feature-unit-note">Changes to this feature apply on daemon restart.</p>
      )}
      {error && (
        <div className="banner warning" role="alert">
          {error}
        </div>
      )}
      {fields.length > 0 && (
        <div className="feature-unit-fields">
          {fields.map((field) => (
            <SettingsField key={field.key} field={field} onCommit={onCommit} />
          ))}
        </div>
      )}
    </section>
  );
}
