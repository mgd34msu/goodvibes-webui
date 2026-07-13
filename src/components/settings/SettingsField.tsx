/**
 * SettingsField — one typed config editor row, driven by the SDK schema.
 *
 *   boolean → toggle (commits immediately)
 *   enum    → <select> of the schema's enumValues (commits immediately)
 *   number  → numeric input, committed on blur/Enter, client-parsed to a finite
 *             number; the schema validationHint is shown as the accepted range
 *   string  → text input, committed on blur/Enter
 *   secret  → masked display + explicit "Replace" that reveals a WRITE-ONLY
 *             field (the stored value is never round-tripped back into an input)
 *   object  → a REAL structured editor, never a JSON blob: pricing.modelPrices
 *             gets the per-model price-row editor (ModelPricesEditor); any
 *             future object-typed key falls back to a validating JSON form
 *             that at least round-trips honestly until it gets its own editor
 *
 * Commits call onCommit(key, value); it resolves on success (the parent
 * reconciles via a config refetch) and rejects on daemon rejection, which this
 * row surfaces inline (plus the parent's toast). Nothing is faked: an unset key
 * shows its schema default distinctly, and a rejected write keeps the row's edit
 * state so the user can correct it.
 */
import { useState } from 'react';
import { maskSecretValue } from '../../lib/config-redaction';
import type { ConfigFieldModel } from '../../lib/settings-model';
import { ModelPricesEditor } from './ModelPricesEditor';

interface SettingsFieldProps {
  readonly field: ConfigFieldModel;
  readonly onCommit: (key: string, value: unknown) => Promise<void>;
}

function effectiveValue(field: ConfigFieldModel): unknown {
  return field.present ? field.liveValue : field.default;
}

/** Render a scalar config value into an input's text form, without stringifying objects blindly. */
function scalarToText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null || v === undefined) return '';
  return JSON.stringify(v);
}

export function SettingsField({ field, onCommit }: SettingsFieldProps) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Local draft for text/number/secret; boolean & enum commit without a draft.
  const initialText = scalarToText(effectiveValue(field));
  const [draft, setDraft] = useState(initialText);
  const [revealing, setRevealing] = useState(false);

  async function commit(value: unknown): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await onCommit(field.key, value);
      setRevealing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const defaultNote = !field.present ? (
    <span className="settings-field-default" title="Not set in the daemon config — showing the schema default.">
      default
    </span>
  ) : null;

  const control = (() => {
    // Object-typed keys get structured editors (see module header).
    if (field.type === 'object') {
      if (field.key === 'pricing.modelPrices') {
        // The editor owns its saving/error state — commits go straight to the
        // parent's config.set so a rejection surfaces inside the editor row.
        return <ModelPricesEditor value={effectiveValue(field)} onCommit={(next) => onCommit(field.key, next)} />;
      }
      return <ObjectJsonField field={field} saving={saving} onCommit={(value) => void commit(value)} />;
    }

    // Secret string — masked, write-only replace.
    if (field.isSecret && field.type === 'string') {
      const raw = effectiveValue(field);
      const masked = typeof raw === 'string' && raw ? maskSecretValue(raw) : '(unset)';
      if (!revealing) {
        return (
          <div className="settings-field-secret">
            <span className="settings-value settings-value--secret">{masked}</span>
            <button
              type="button"
              className="secondary-button settings-field-replace"
              onClick={() => {
                setDraft('');
                setRevealing(true);
              }}
            >
              Replace
            </button>
          </div>
        );
      }
      return (
        <div className="settings-field-secret">
          <input
            type="password"
            autoComplete="new-password"
            aria-label={`New value for ${field.key}`}
            value={draft}
            disabled={saving}
            placeholder="Enter new value (write-only)"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commit(draft);
            }}
          />
          <button type="button" className="primary-button settings-field-save" disabled={saving} onClick={() => void commit(draft)}>
            Save
          </button>
          <button type="button" className="secondary-button" disabled={saving} onClick={() => setRevealing(false)}>
            Cancel
          </button>
        </div>
      );
    }

    if (field.type === 'boolean') {
      const checked = Boolean(effectiveValue(field));
      return (
        <label className="settings-field-toggle">
          <input
            type="checkbox"
            checked={checked}
            disabled={saving}
            onChange={(e) => void commit(e.target.checked)}
          />
          <span>{checked ? 'On' : 'Off'}</span>
        </label>
      );
    }

    if (field.type === 'enum' && field.enumValues) {
      const current = effectiveValue(field);
      const value = typeof current === 'string' ? current : scalarToText(current);
      return (
        <select
          className="settings-field-select"
          aria-label={field.key}
          value={value}
          disabled={saving}
          onChange={(e) => void commit(e.target.value)}
        >
          {!field.enumValues.includes(value) && <option value={value}>{value || '(unset)'}</option>}
          {field.enumValues.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }

    if (field.type === 'number') {
      return (
        <input
          className="settings-field-input"
          type="number"
          inputMode="decimal"
          aria-label={field.key}
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          onBlur={() => {
            if (draft === initialText) return;
            const n = Number(draft);
            if (draft.trim() === '' || !Number.isFinite(n)) {
              setError(`Enter a finite number${field.validationHint ? ` (${field.validationHint})` : ''}`);
              return;
            }
            void commit(n);
          }}
        />
      );
    }

    // string (non-secret)
    return (
      <input
        className="settings-field-input"
        type="text"
        aria-label={field.key}
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        onBlur={() => {
          if (draft === initialText) return;
          void commit(draft);
        }}
      />
    );
  })();

  return (
    <div className="settings-field" data-config-key={field.key}>
      <div className="settings-field-head">
        <code className="settings-field-key">{field.key}</code>
        {defaultNote}
        {field.validationHint && field.type === 'number' && (
          <span className="settings-field-hint">{field.validationHint}</span>
        )}
      </div>
      {field.description && <p className="settings-field-desc">{field.description}</p>}
      <div className="settings-field-control">{control}</div>
      {error && (
        <div className="banner warning settings-field-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

/**
 * Fallback editor for an object-typed schema key that has no dedicated
 * structured editor yet: shows the current value and accepts a replacement as
 * validated JSON (must parse to a plain object — never silently committed as a
 * string). pricing.modelPrices never reaches this — it has ModelPricesEditor.
 */
function ObjectJsonField({
  field,
  saving,
  onCommit,
}: {
  readonly field: ConfigFieldModel;
  readonly saving: boolean;
  readonly onCommit: (value: unknown) => void;
}) {
  const current = field.present ? field.liveValue : field.default;
  const [draft, setDraft] = useState(() => JSON.stringify(current ?? {}, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  return (
    <div className="settings-field-object">
      <textarea
        aria-label={field.key}
        value={draft}
        disabled={saving}
        rows={Math.min(10, draft.split('\n').length + 1)}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button
        type="button"
        className="primary-button"
        disabled={saving}
        onClick={() => {
          try {
            const parsed: unknown = JSON.parse(draft);
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
              setParseError('Value must be a JSON object.');
              return;
            }
            setParseError(null);
            onCommit(parsed);
          } catch {
            setParseError('Not valid JSON.');
          }
        }}
      >
        Save
      </button>
      {parseError && (
        <div className="banner warning" role="alert">
          {parseError}
        </div>
      )}
    </div>
  );
}
