/**
 * owner-profile.ts — the defensive wire readers for the profile.* verbs.
 *
 * The load-bearing assertions here are the honesty ones: a profile that could not be
 * read must never come back as an empty profile (docs/owner-profile.md §4.4), a forget
 * that did not say it deleted must never come back as a deletion (§9.2), and a status
 * answer must carry names and counts but no values (§11.3).
 */
import { describe, expect, test } from 'bun:test';
import {
  labelFromKey,
  profileDisabledLine,
  profileStateBadgeClass,
  profileStateLabel,
  profileTargetId,
  profileTargetInput,
  profileUnavailableLine,
  provenanceSummary,
  readProfileDocument,
  readProfileForgetOutcome,
  readProfileProvenanceAnswer,
  readProfileStatus,
  readProfileWriteOutcome,
  sectionHoldsThirdPartyData,
  targetForProseLine,
  type ProfileSection,
} from './owner-profile';

const LOADED_DOCUMENT = {
  state: 'loaded',
  path: '/home/owner/.goodvibes/daemon/owner-profile.md',
  sections: [
    {
      id: 'identity',
      name: 'Identity',
      fields: [
        { key: 'identity.name', label: 'name', value: 'Mike Davis', valid: true },
        { key: 'identity.goesBy', label: 'goes by', value: 'Mike', valid: true },
      ],
      lines: [],
    },
    {
      id: 'commerce',
      name: 'Commerce',
      fields: [
        {
          key: 'commerce.shippingAddress',
          label: 'shipping address',
          value: '200 Office Way, Lansing, MI 48933, US',
          valid: true,
          provenance: { surface: 'tui', date: '2026-07-27', said: 'ship it to my office instead' },
          supersededCount: 1,
        },
      ],
      lines: [],
    },
    {
      id: 'people',
      name: 'People',
      fields: [],
      lines: [
        {
          text: 'Sarah, sister, sarah@example.com',
          lineIndex: 41,
          provenance: { surface: 'tui', date: '2026-07-27', said: 'my sister Sarah, sarah@example.com' },
        },
        'Dave from work, handles the Pellux contracts',
      ],
    },
  ],
};

describe('readProfileDocument', () => {
  test('reads sections, mechanical fields, prose lines and provenance', () => {
    const document = readProfileDocument(LOADED_DOCUMENT);
    expect(document).not.toBeNull();
    expect(document?.state).toBe('loaded');
    expect(document?.path).toBe('/home/owner/.goodvibes/daemon/owner-profile.md');
    expect(document?.sections.length).toBe(3);

    const commerce = document?.sections.find((section) => section.id === 'commerce');
    expect(commerce?.fields[0]?.label).toBe('shipping address');
    expect(commerce?.fields[0]?.value).toBe('200 Office Way, Lansing, MI 48933, US');
    expect(commerce?.fields[0]?.provenance?.said).toBe('ship it to my office instead');
    expect(commerce?.fields[0]?.supersededCount).toBe(1);

    const people = document?.sections.find((section) => section.id === 'people');
    // A bare string line is a prose line too — his notes, preserved as written.
    expect(people?.lines.map((line) => line.text)).toEqual([
      'Sarah, sister, sarah@example.com',
      'Dave from work, handles the Pellux contracts',
    ]);
    expect(people?.lines[0]?.lineIndex).toBe(41);
  });

  test('a field with no superseded history reports zero, never a guess', () => {
    const document = readProfileDocument(LOADED_DOCUMENT);
    const identity = document?.sections.find((section) => section.id === 'identity');
    expect(identity?.fields[0]?.supersededCount).toBe(0);
  });

  test('an invalid mechanical value is preserved with its reason, not dropped', () => {
    const document = readProfileDocument({
      state: 'loaded',
      sections: [
        {
          id: 'location',
          name: 'Location',
          fields: [
            {
              key: 'location.timezone',
              label: 'timezone',
              value: 'Mars/Olympus',
              valid: false,
              invalidReason: 'not an IANA time zone',
            },
          ],
          lines: [],
        },
      ],
    });
    const field = document?.sections[0]?.fields[0];
    expect(field?.value).toBe('Mars/Olympus');
    expect(field?.valid).toBe(false);
    expect(field?.invalidReason).toBe('not an IANA time zone');
  });

  test('unavailable carries its reason and NO sections — never an empty profile', () => {
    const document = readProfileDocument({
      state: 'unavailable',
      reason: 'permission denied',
      path: '/home/owner/.goodvibes/daemon/owner-profile.md',
      sections: [{ id: 'identity', name: 'Identity', fields: [], lines: [] }],
    });
    expect(document?.state).toBe('unavailable');
    expect(document?.reason).toBe('permission denied');
    expect(document?.sections.length).toBe(0);
  });

  test('disabled is a stated state, not an empty profile', () => {
    const document = readProfileDocument({ state: 'disabled' });
    expect(document?.state).toBe('disabled');
    expect(document?.sections.length).toBe(0);
  });

  test('enabled:false is read as disabled even without a state string', () => {
    expect(readProfileDocument({ enabled: false })?.state).toBe('disabled');
  });

  test('a body that carries no profile at all is null, not an empty document', () => {
    expect(readProfileDocument(null)).toBeNull();
    expect(readProfileDocument('nope')).toBeNull();
    expect(readProfileDocument({})).toBeNull();
    expect(readProfileDocument({ unrelated: true })).toBeNull();
  });

  test('a { profile: … } envelope is unwrapped', () => {
    const document = readProfileDocument({ profile: { state: 'loaded', sections: [] } });
    expect(document?.state).toBe('loaded');
  });

  test('sections keyed by name are read as sections', () => {
    const document = readProfileDocument({
      state: 'loaded',
      sections: { Notes: { lines: ['Allergic to shellfish'] } },
    });
    expect(document?.sections[0]?.name).toBe('Notes');
    expect(document?.sections[0]?.lines[0]?.text).toBe('Allergic to shellfish');
  });

  test('numeric and boolean mechanical values are read, not dropped', () => {
    const document = readProfileDocument({
      state: 'loaded',
      sections: [{ id: 'defaults', name: 'Defaults', fields: [{ key: 'defaults.approvalWindow', value: 30 }], lines: [] }],
    });
    expect(document?.sections[0]?.fields[0]?.value).toBe('30');
  });
});

describe('readProfileStatus', () => {
  test('carries state, path, section names, counts and invalid-field reasons', () => {
    const status = readProfileStatus({
      state: 'loaded',
      path: '/home/owner/.goodvibes/daemon/owner-profile.md',
      sectionNames: ['Identity', 'Contact', 'People'],
      lineCount: 42,
      fieldCount: 11,
      invalidFields: [{ key: 'location.timezone', reason: 'not an IANA time zone' }],
    });
    expect(status?.state).toBe('loaded');
    expect(status?.sectionNames).toEqual(['Identity', 'Contact', 'People']);
    expect(status?.lineCount).toBe(42);
    expect(status?.invalidFields[0]?.reason).toBe('not an IANA time zone');
  });

  test('an invalid field with no reason says so rather than inventing one', () => {
    const status = readProfileStatus({ state: 'loaded', invalidFields: [{ key: 'commerce.currency' }] });
    expect(status?.invalidFields[0]?.reason).toBe('no reason given');
  });

  test('unavailable keeps its reason', () => {
    const status = readProfileStatus({ state: 'unavailable', reason: 'not valid UTF-8' });
    expect(status?.state).toBe('unavailable');
    expect(status?.reason).toBe('not valid UTF-8');
  });

  test('a body with no state is null', () => {
    expect(readProfileStatus({ sectionNames: ['Identity'] })).toBeNull();
    expect(readProfileStatus(42)).toBeNull();
  });
});

describe('readProfileProvenanceAnswer', () => {
  test('returns the suffix plus every superseded predecessor', () => {
    const answer = readProfileProvenanceAnswer({
      found: true,
      provenance: { surface: 'tui', date: '2026-07-27', said: 'ship it to my office instead' },
      superseded: [
        {
          value: '401 Home St, Lansing, MI 48933, US',
          provenance: { surface: 'tui', date: '2026-07-20', said: 'ship to 401 Home St' },
          supersededOn: '2026-07-27',
        },
      ],
    });
    expect(answer?.found).toBe(true);
    expect(answer?.handEdited).toBe(false);
    expect(answer?.provenance?.said).toBe('ship it to my office instead');
    expect(answer?.superseded[0]?.value).toBe('401 Home St, Lansing, MI 48933, US');
    expect(answer?.superseded[0]?.supersededOn).toBe('2026-07-27');
  });

  test('a line that exists with no suffix is reported as hand-edited', () => {
    const answer = readProfileProvenanceAnswer({ found: true });
    expect(answer?.found).toBe(true);
    expect(answer?.handEdited).toBe(true);
    expect(answer?.provenance).toBeUndefined();
  });

  test('a line that is not there is reported as not found', () => {
    const answer = readProfileProvenanceAnswer({ found: false });
    expect(answer?.found).toBe(false);
  });

  test('a body carrying nothing recognisable is null', () => {
    expect(readProfileProvenanceAnswer({})).toBeNull();
    expect(readProfileProvenanceAnswer(null)).toBeNull();
  });
});

describe('readProfileForgetOutcome', () => {
  test('deleted:true is a deletion, and names what went', () => {
    const outcome = readProfileForgetOutcome({ deleted: true, key: 'contact.phone', removed: ['contact.phone'] });
    expect(outcome.verdict).toBe('deleted');
    expect(outcome.removed).toEqual(['contact.phone']);
  });

  test('deleted:false is NOT a success — it is not-present', () => {
    const outcome = readProfileForgetOutcome({ deleted: false, key: 'contact.phone' });
    expect(outcome.verdict).toBe('not-present');
  });

  test('a response that does not say whether it deleted is unclear, never deleted', () => {
    expect(readProfileForgetOutcome({}).verdict).toBe('unclear');
    expect(readProfileForgetOutcome({ key: 'contact.phone' }).verdict).toBe('unclear');
    expect(readProfileForgetOutcome(null).verdict).toBe('unclear');
    expect(readProfileForgetOutcome('ok').verdict).toBe('unclear');
  });
});

describe('readProfileWriteOutcome', () => {
  test('a stated outcome is believed', () => {
    const outcome = readProfileWriteOutcome({ changed: true, key: 'contact.phone', disclosure: 'Noted — saved your phone number to your profile.' });
    expect(outcome.changed).toBe(true);
    expect(outcome.stated).toBe(true);
    expect(outcome.disclosure).toBe('Noted — saved your phone number to your profile.');
  });

  test('a stated no-op is reported as a no-op', () => {
    const outcome = readProfileWriteOutcome({ changed: false });
    expect(outcome.changed).toBe(false);
    expect(outcome.stated).toBe(true);
  });

  test('a bare 200 is changed-but-not-stated', () => {
    const outcome = readProfileWriteOutcome({});
    expect(outcome.changed).toBe(true);
    expect(outcome.stated).toBe(false);
  });
});

describe('targets', () => {
  test('a field target carries its dotted key', () => {
    expect(profileTargetInput({ kind: 'field', key: 'commerce.currency' })).toEqual({ key: 'commerce.currency' });
    expect(profileTargetId({ kind: 'field', key: 'commerce.currency' })).toBe('field:commerce.currency');
  });

  test('a prose line target carries its section and line index', () => {
    expect(profileTargetInput({ kind: 'line', section: 'people', lineIndex: 41 })).toEqual({ section: 'people', lineIndex: 41 });
    expect(profileTargetId({ kind: 'line', section: 'people', lineIndex: 41 })).toBe('line:people:41');
  });

  test('a prose line with neither a key nor an index has no address', () => {
    const section: ProfileSection = { id: 'notes', name: 'Notes', fields: [], lines: [] };
    expect(targetForProseLine(section, { text: 'Allergic to shellfish' })).toBeNull();
    expect(targetForProseLine(section, { text: 'x', lineIndex: 7 })).toEqual({ kind: 'line', section: 'notes', lineIndex: 7 });
    expect(targetForProseLine(section, { text: 'x', key: 'notes.7' })).toEqual({ kind: 'field', key: 'notes.7' });
  });
});

describe('third-party personal data', () => {
  test('the People section is recognised, by id or by heading', () => {
    expect(sectionHoldsThirdPartyData({ id: 'people', name: 'People', fields: [], lines: [] })).toBe(true);
    expect(sectionHoldsThirdPartyData({ id: 'People ', name: 'People', fields: [], lines: [] })).toBe(true);
  });

  test('other sections are not', () => {
    expect(sectionHoldsThirdPartyData({ id: 'places', name: 'Places', fields: [], lines: [] })).toBe(false);
  });
});

describe('display helpers', () => {
  test('the unavailable line states the reason and the path', () => {
    expect(profileUnavailableLine('permission denied', '/x/owner-profile.md')).toBe(
      'Your profile could not be read: permission denied (/x/owner-profile.md)',
    );
  });

  test('a missing reason says so rather than inventing one', () => {
    expect(profileUnavailableLine()).toBe(
      'Your profile could not be read, and the daemon did not give a reason.',
    );
  });

  test('the disabled line is a stated state', () => {
    expect(profileDisabledLine()).toContain('turned off');
  });

  test('state labels and tones are distinct per state', () => {
    expect(profileStateLabel('loaded')).toBe('Loaded');
    expect(profileStateLabel('disabled')).toBe('Turned off');
    expect(profileStateLabel('unavailable')).toBe('Could not be read');
    expect(profileStateBadgeClass('loaded')).toBe('ok');
    expect(profileStateBadgeClass('disabled')).toBe('neutral');
    expect(profileStateBadgeClass('unavailable')).toBe('bad');
  });

  test('a provenance summary is surface, date and his words', () => {
    expect(provenanceSummary({ surface: 'tui', date: '2026-07-27', said: 'ship it to my office instead' })).toBe(
      'tui, 2026-07-27 — "ship it to my office instead"',
    );
  });

  test('a partial provenance renders what is there, never a guess', () => {
    expect(provenanceSummary({ said: 'ship it to my office instead' })).toBe(
      'source not recorded — "ship it to my office instead"',
    );
  });

  test('a label falls back to the key\'s last segment', () => {
    expect(labelFromKey('commerce.shippingAddress')).toBe('shipping address');
    expect(labelFromKey('timezone')).toBe('timezone');
  });
});
