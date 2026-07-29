/**
 * TimezonePicker — the typed editor for `daemon.timezone`.
 *
 * A searchable select over the real supported IANA zone set
 * (`Intl.supportedValuesOf('timeZone')`, via lib/timezones.ts), not a
 * free-text box: every writable value is a name the runtime itself
 * recognizes, plus an explicit "UTC (unset)" entry that writes the empty
 * string (the schema's default, meaning UTC).
 *
 * Commits immediately on selection, same as the other schema-driven enum/
 * select controls in SettingsField.
 */
import { useMemo, useState } from 'react';
import { filterTimezoneNames, UNSET_TIMEZONE_LABEL, UNSET_TIMEZONE_VALUE } from '../../lib/timezones';

export interface TimezonePickerProps {
  /** Current effective value ('' for unset/UTC, else an IANA zone name). */
  readonly value: string;
  readonly disabled?: boolean;
  readonly onCommit: (value: string) => void;
}

export function TimezonePicker({ value, disabled, onCommit }: TimezonePickerProps) {
  const [query, setQuery] = useState('');
  const zones = useMemo(() => filterTimezoneNames(query), [query]);

  const selectedIsUnset = value === UNSET_TIMEZONE_VALUE;
  const selectedIsListed = zones.includes(value);

  return (
    <div className="timezone-picker" data-testid="timezone-picker">
      <input
        type="search"
        className="settings-field-input timezone-picker-search"
        aria-label="Search timezones"
        placeholder="Search timezones…"
        value={query}
        disabled={disabled}
        onChange={(e) => setQuery(e.target.value)}
      />
      <select
        className="settings-field-select timezone-picker-select"
        aria-label="daemon.timezone"
        value={value}
        disabled={disabled}
        onChange={(e) => onCommit(e.target.value)}
      >
        <option value={UNSET_TIMEZONE_VALUE}>{UNSET_TIMEZONE_LABEL}</option>
        {/* The selected value must always resolve to a real <option>, or the
            <select> silently falls back to its first entry and reports a
            DIFFERENT effective zone than what is actually configured — pin it
            in even when the current search query filters it out of the list. */}
        {!selectedIsUnset && !selectedIsListed && (
          <option value={value}>{value}</option>
        )}
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
    </div>
  );
}
