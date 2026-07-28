/**
 * owner-profile.ts — the local response shapes and defensive wire readers for the
 * daemon's owner-profile verbs (profile.read / .get / .person / .provenance / .set /
 * .append / .forget / .undo / .status), per docs/owner-profile.md §11.1.
 *
 * WHY THESE TYPES ARE LOCAL, AND FOR HOW LONG
 * The installed @pellux/goodvibes-contracts (npm 1.18.1) has no `profile.*` method ids
 * yet, so there is no OperatorMethodInput/OutputMap entry to type these against — the
 * same standing situation memory-governance.ts and contract-bridge-types.ts already
 * document for their own verbs. Every interface below is a restatement of the design
 * document's own shapes (§5.1's ProfileLine/ProfileFieldValue, §11.1's verb table),
 * kept here so the hook/component/test files import a named type rather than reaching
 * into `unknown`. When the regenerated contracts package lands, swap the bodies of the
 * readers for the generated types and keep the names — every consumer imports from
 * here, so the swap is one file.
 *
 * WHY EVERY READER RETURNS null RATHER THAN CASTING
 * The brief's boundary rule is: an explicit narrowing plus a runtime shape check, never
 * a bare `any` and never an unchecked cast that lets a malformed daemon response blank
 * the page. Each reader narrows the raw value to a wire envelope whose members are all
 * `unknown` (the `as unknown as ...Wire` line, guarded by an isRecord check immediately
 * above it) and then reads every member defensively, exactly the stance
 * readMemoryGovernanceSnapshot takes: a 200 whose body does not actually carry a profile
 * is an honest error the caller renders as "could not read", never an empty profile and
 * never a crash on `undefined.length`.
 *
 * WHY THE READERS ARE LENIENT ABOUT FIELD NAMES
 * The SDK lane is being written concurrently with this one, so the exact wire key for
 * (say) a provenance quote is not yet fixed. The readers accept the small set of names
 * the design document itself uses and degrade each optional part individually. This is
 * leniency about SHAPE only — nothing is ever fabricated, and a missing part renders as
 * absent rather than as a plausible-looking default.
 *
 * CONTAINMENT (§10, §11.3)
 * Nothing in this module logs. No profile value is written to any store, and the
 * `People` section — facts about people who never agreed to be in a database — is
 * marked here (sectionHoldsThirdPartyData) so the rendering surface can keep it out of
 * copy/export affordances. `readProfileStatus` deliberately extracts state, path,
 * section NAMES, counts and invalid-field reasons and nothing else: the status verb is
 * the diagnostic one, and a diagnostic that carried values would defeat the point.
 */

// ---------------------------------------------------------------------------
// Response shapes (§11.1)
// ---------------------------------------------------------------------------

/** Load state every verb answers with — a stated state, never an empty profile (§4.4, §12). */
export type ProfileState = 'loaded' | 'disabled' | 'unavailable';

/**
 * The provenance suffix a learned line carries (§4.2): which surface, when, and his
 * verbatim words. Every part is optional because a line he edited by hand carries none,
 * and a part that is absent is rendered as absent rather than guessed at.
 */
export interface ProfileProvenance {
  readonly surface?: string;
  readonly date?: string;
  readonly said?: string;
}

/** A mechanical field (§4.3) — the only things parsed into typed values. */
export interface ProfileField {
  /** Dotted address, e.g. `commerce.shippingAddress`. The verbs' `key` argument. */
  readonly key: string;
  /** The label as written in the document, e.g. `shipping address`. */
  readonly label: string;
  readonly value: string;
  /** False when the value is preserved verbatim but did not validate (§4.3). */
  readonly valid: boolean;
  readonly invalidReason?: string;
  readonly provenance?: ProfileProvenance;
  /** How many `<!-- was: … -->` predecessors exist — undo is offered only above zero (§9.1). */
  readonly supersededCount: number;
}

/** A prose line — a bullet, a paragraph, anything that is not a mechanical field (§4.4). */
export interface ProfileProseLine {
  /** The line minus its provenance suffix, exactly as he wrote it. */
  readonly text: string;
  readonly provenance?: ProfileProvenance;
  /** Present when the daemon gives this line an addressable key of its own. */
  readonly key?: string;
  /** Index into the raw line array (§5.1) — the fallback address when there is no key. */
  readonly lineIndex?: number;
}

export interface ProfileSection {
  /** The heading text as written — his renames are respected (§4.5). */
  readonly name: string;
  /** The canonical section id when the daemon supplies one, else the written name. */
  readonly id: string;
  readonly fields: readonly ProfileField[];
  readonly lines: readonly ProfileProseLine[];
}

/** `profile.read` — the whole document, by section (§8.3). */
export interface ProfileDocument {
  readonly state: ProfileState;
  /** Why it could not be read, when state is 'unavailable' (§4.4). */
  readonly reason?: string;
  readonly path?: string;
  readonly sections: readonly ProfileSection[];
}

export interface ProfileInvalidField {
  readonly key: string;
  readonly reason: string;
}

/** `profile.status` — load state, path, section names, counts, invalid fields. No values (§11.3). */
export interface ProfileStatus {
  readonly state: ProfileState;
  readonly reason?: string;
  readonly path?: string;
  readonly sectionNames: readonly string[];
  readonly lineCount?: number;
  readonly fieldCount?: number;
  readonly invalidFields: readonly ProfileInvalidField[];
}

/** One `<!-- was: … -->` predecessor (§9.1), as `profile.provenance` reads them. */
export interface ProfileSupersededValue {
  readonly value?: string;
  readonly provenance?: ProfileProvenance;
  readonly supersededOn?: string;
}

/** `profile.provenance` — surface, date, verbatim, and superseded predecessors (§8.3). */
export interface ProfileProvenanceAnswer {
  /** Whether the line is in the document at all. */
  readonly found: boolean;
  /**
   * True when the line exists but carries no provenance suffix — he wrote or edited it
   * by hand, and the honest answer is to say so rather than dress it up as a source (§4.2).
   */
  readonly handEdited: boolean;
  readonly provenance?: ProfileProvenance;
  readonly superseded: readonly ProfileSupersededValue[];
}

/** `profile.set` / `.append` / `.undo` — did anything change, and what the daemon said. */
export interface ProfileWriteOutcome {
  readonly changed: boolean;
  /** True when the daemon stated the outcome explicitly rather than us inferring it from a 200. */
  readonly stated: boolean;
  readonly key?: string;
  /** describeProfileWrite's one-line receipt (§8.2), when the daemon returns one. */
  readonly disclosure?: string;
}

/**
 * `profile.forget` — three-way, deliberately. 'unclear' exists because a delete that
 * cannot say whether it deleted must not be rendered as a success (§9.2:
 * "Forgetting something that was not there reports that it was not there — it does not
 * report success").
 */
export type ProfileForgetVerdict = 'deleted' | 'not-present' | 'unclear';

export interface ProfileForgetOutcome {
  readonly verdict: ProfileForgetVerdict;
  readonly key?: string;
  /** What actually went, as the daemon names it. */
  readonly removed: readonly string[];
  readonly message?: string;
}

/**
 * What a verb is being asked about. A mechanical field is addressed by its dotted key;
 * a prose line by its section plus its index into the raw line array (§5.1) when the
 * daemon does not give it a key of its own.
 */
export type ProfileTarget =
  | { readonly kind: 'field'; readonly key: string }
  | { readonly kind: 'line'; readonly section: string; readonly lineIndex: number };

// ---------------------------------------------------------------------------
// Wire envelopes — the narrowing boundary
// ---------------------------------------------------------------------------

interface ProfileReadWire {
  readonly state?: unknown;
  readonly status?: unknown;
  readonly enabled?: unknown;
  readonly available?: unknown;
  readonly reason?: unknown;
  readonly error?: unknown;
  readonly path?: unknown;
  readonly sections?: unknown;
  readonly profile?: unknown;
}

interface ProfileStatusWire extends ProfileReadWire {
  readonly sectionNames?: unknown;
  readonly lineCount?: unknown;
  readonly lines?: unknown;
  readonly fieldCount?: unknown;
  readonly fields?: unknown;
  readonly invalidFields?: unknown;
  readonly invalid?: unknown;
}

interface ProfileProvenanceWire {
  readonly found?: unknown;
  readonly present?: unknown;
  readonly handEdited?: unknown;
  readonly provenance?: unknown;
  readonly superseded?: unknown;
  readonly predecessors?: unknown;
  readonly history?: unknown;
}

interface ProfileWriteWire {
  readonly changed?: unknown;
  readonly written?: unknown;
  readonly updated?: unknown;
  readonly restored?: unknown;
  readonly ok?: unknown;
  readonly key?: unknown;
  readonly field?: unknown;
  readonly disclosure?: unknown;
  readonly message?: unknown;
}

interface ProfileForgetWire {
  readonly deleted?: unknown;
  readonly forgotten?: unknown;
  readonly key?: unknown;
  readonly field?: unknown;
  readonly removed?: unknown;
  readonly removedLines?: unknown;
  readonly message?: unknown;
}

// ---------------------------------------------------------------------------
// Primitive readers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** A scalar rendered as text. Numbers and booleans are real mechanical values (§4.3's
 *  `approval window` is integer minutes), so they are read rather than dropped. */
function readScalar(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return undefined;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const found = readString(record[key]);
    if (found !== undefined) return found;
  }
  return undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

const STATES: readonly ProfileState[] = ['loaded', 'disabled', 'unavailable'];

/**
 * The load state. Read from an explicit field where the daemon states one, then from
 * the two booleans the design's own wording implies (`enabled: false` is §12's disabled
 * state; `available: false` is §4.4's unavailable state). Undefined when the answer
 * says nothing — the caller decides, and never guesses 'loaded' for an empty body.
 */
function readState(wire: ProfileReadWire): ProfileState | undefined {
  const raw = readString(wire.state) ?? readString(wire.status);
  if (raw !== undefined) {
    const exact = STATES.find((state) => state === raw);
    if (exact) return exact;
    if (raw === 'ok' || raw === 'ready' || raw === 'available') return 'loaded';
    if (raw === 'off' || raw === 'disabled') return 'disabled';
    if (raw === 'error' || raw === 'unreadable' || raw === 'failed') return 'unavailable';
  }
  if (wire.enabled === false) return 'disabled';
  if (wire.available === false) return 'unavailable';
  return undefined;
}

export function readProvenance(value: unknown): ProfileProvenance | undefined {
  if (!isRecord(value)) return undefined;
  const surface = firstString(value, ['surface', 'source']);
  const date = firstString(value, ['date', 'recordedAt', 'on']);
  const said = firstString(value, ['said', 'quote', 'verbatim', 'utterance']);
  if (surface === undefined && date === undefined && said === undefined) return undefined;
  return {
    ...(surface !== undefined ? { surface } : {}),
    ...(date !== undefined ? { date } : {}),
    ...(said !== undefined ? { said } : {}),
  };
}

// ---------------------------------------------------------------------------
// profile.read
// ---------------------------------------------------------------------------

/** `shipping address` from `commerce.shippingAddress`, when the daemon sends no label. */
export function labelFromKey(key: string): string {
  const last = key.split('.').pop() ?? key;
  return last
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
}

function readField(value: unknown): ProfileField | null {
  if (!isRecord(value)) return null;
  const key = firstString(value, ['key', 'id', 'field']);
  if (key === undefined) return null;
  const text = readScalar(value.value) ?? readScalar(value.text);
  if (text === undefined) return null;
  const label = firstString(value, ['label', 'name']) ?? labelFromKey(key);
  const invalidReason = firstString(value, ['invalidReason', 'reason']);
  const provenance = readProvenance(value.provenance);
  const superseded = Array.isArray(value.superseded) ? value.superseded.length : undefined;
  return {
    key,
    label,
    value: text,
    valid: value.valid !== false,
    ...(invalidReason !== undefined ? { invalidReason } : {}),
    ...(provenance !== undefined ? { provenance } : {}),
    supersededCount: readNumber(value.supersededCount) ?? superseded ?? 0,
  };
}

function readProseLine(value: unknown): ProfileProseLine | null {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? { text: value } : null;
  }
  if (!isRecord(value)) return null;
  const text = firstString(value, ['text', 'line', 'value']);
  if (text === undefined) return null;
  const provenance = readProvenance(value.provenance);
  const key = firstString(value, ['key', 'id']);
  const lineIndex = readNumber(value.lineIndex) ?? readNumber(value.index);
  return {
    text,
    ...(provenance !== undefined ? { provenance } : {}),
    ...(key !== undefined ? { key } : {}),
    ...(lineIndex !== undefined ? { lineIndex } : {}),
  };
}

function readSection(value: unknown, fallbackName?: string): ProfileSection | null {
  if (!isRecord(value)) return null;
  const name = firstString(value, ['name', 'section', 'heading', 'title']) ?? fallbackName;
  if (name === undefined) return null;
  const id = firstString(value, ['id', 'canonicalName']) ?? name;
  const rawFields = Array.isArray(value.fields) ? value.fields : Array.isArray(value.values) ? value.values : [];
  const rawLines = Array.isArray(value.lines)
    ? value.lines
    : Array.isArray(value.prose)
      ? value.prose
      : Array.isArray(value.bullets)
        ? value.bullets
        : [];
  const fields = rawFields.map(readField).filter((field): field is ProfileField => field !== null);
  const lines = rawLines.map(readProseLine).filter((line): line is ProfileProseLine => line !== null);
  return { name, id, fields, lines };
}

function readSections(value: unknown): ProfileSection[] {
  if (Array.isArray(value)) {
    return value.map((entry) => readSection(entry)).filter((section): section is ProfileSection => section !== null);
  }
  // A record keyed by section name is the other plausible serialization of "by section".
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([name, body]) => readSection(isRecord(body) ? body : { lines: body }, name))
      .filter((section): section is ProfileSection => section !== null);
  }
  return [];
}

/**
 * `profile.read` → the whole document, or null when the answer does not carry one.
 *
 * Null means "render the honest cannot-read state" — it is NOT an empty profile, and the
 * distinction is the whole point of §4.4: "I could not open the file" and "I know nothing
 * about you" are different sentences.
 */
export function readProfileDocument(value: unknown): ProfileDocument | null {
  if (!isRecord(value)) return null;
  const outer = value as unknown as ProfileReadWire;
  // A `{ profile: { … } }` envelope carries the state on either level; read the outer
  // first and let the inner fill what the outer did not say.
  const inner = isRecord(outer.profile) ? (outer.profile as unknown as ProfileReadWire) : undefined;
  const state = readState(outer) ?? (inner ? readState(inner) : undefined);
  const rawSections = outer.sections ?? inner?.sections;
  const sections = readSections(rawSections);
  const reason = readString(outer.reason) ?? readString(outer.error) ?? (inner ? readString(inner.reason) : undefined);
  const path = readString(outer.path) ?? (inner ? readString(inner.path) : undefined);

  // The load-bearing core: either the daemon stated a state, or it sent sections (which
  // can only mean 'loaded'). An answer with neither is not a profile — return null.
  const resolved: ProfileState | undefined = state ?? (rawSections !== undefined ? 'loaded' : undefined);
  if (resolved === undefined) return null;

  return {
    state: resolved,
    ...(reason !== undefined ? { reason } : {}),
    ...(path !== undefined ? { path } : {}),
    sections: resolved === 'loaded' ? sections : [],
  };
}

// ---------------------------------------------------------------------------
// profile.status
// ---------------------------------------------------------------------------

function readInvalidFields(value: unknown): ProfileInvalidField[] {
  if (Array.isArray(value)) {
    return value
      .map((entry): ProfileInvalidField | null => {
        if (!isRecord(entry)) return null;
        const key = firstString(entry, ['key', 'field', 'name']);
        if (key === undefined) return null;
        return { key, reason: firstString(entry, ['reason', 'invalidReason', 'message']) ?? 'no reason given' };
      })
      .filter((entry): entry is ProfileInvalidField => entry !== null);
  }
  if (isRecord(value)) {
    return Object.entries(value).map(([key, reason]) => ({
      key,
      reason: readString(reason) ?? 'no reason given',
    }));
  }
  return [];
}

/**
 * `profile.status` → the diagnostic answer, or null when the body does not carry one.
 * Values are deliberately not read here even if a daemon build were to send them (§11.3).
 */
export function readProfileStatus(value: unknown): ProfileStatus | null {
  if (!isRecord(value)) return null;
  const wire = value as unknown as ProfileStatusWire;
  const state = readState(wire);
  if (state === undefined) return null;
  const reason = readString(wire.reason) ?? readString(wire.error);
  const path = readString(wire.path);
  const sectionNames = readStringArray(wire.sectionNames).length
    ? readStringArray(wire.sectionNames)
    : readStringArray(wire.sections);
  const lineCount = readNumber(wire.lineCount) ?? readNumber(wire.lines);
  const fieldCount = readNumber(wire.fieldCount) ?? readNumber(wire.fields);
  return {
    state,
    ...(reason !== undefined ? { reason } : {}),
    ...(path !== undefined ? { path } : {}),
    sectionNames,
    ...(lineCount !== undefined ? { lineCount } : {}),
    ...(fieldCount !== undefined ? { fieldCount } : {}),
    invalidFields: readInvalidFields(wire.invalidFields ?? wire.invalid),
  };
}

// ---------------------------------------------------------------------------
// profile.provenance
// ---------------------------------------------------------------------------

function readSupersededValues(value: unknown): ProfileSupersededValue[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): ProfileSupersededValue | null => {
      if (typeof entry === 'string') return entry.trim().length > 0 ? { value: entry } : null;
      if (!isRecord(entry)) return null;
      const text = firstString(entry, ['value', 'text', 'was']);
      const provenance = readProvenance(entry.provenance) ?? readProvenance(entry);
      const supersededOn = firstString(entry, ['supersededOn', 'supersededAt', 'superseded']);
      if (text === undefined && provenance === undefined) return null;
      return {
        ...(text !== undefined ? { value: text } : {}),
        ...(provenance !== undefined ? { provenance } : {}),
        ...(supersededOn !== undefined ? { supersededOn } : {}),
      };
    })
    .filter((entry): entry is ProfileSupersededValue => entry !== null);
}

/**
 * `profile.provenance` → where a line came from, or null when the body carries nothing
 * recognisable. A line that exists with no suffix is reported as hand-edited, which is
 * §4.2's own honest answer ("no provenance recorded; you edited this line by hand") —
 * never dressed up as a recorded source.
 */
export function readProfileProvenanceAnswer(value: unknown): ProfileProvenanceAnswer | null {
  if (!isRecord(value)) return null;
  const wire = value as unknown as ProfileProvenanceWire;
  const provenance = readProvenance(wire.provenance);
  const superseded = readSupersededValues(wire.superseded ?? wire.predecessors ?? wire.history);
  const statedFound = readBoolean(wire.found) ?? readBoolean(wire.present);
  const statedHandEdited = readBoolean(wire.handEdited);
  if (statedFound === undefined && provenance === undefined && superseded.length === 0 && statedHandEdited === undefined) {
    return null;
  }
  const found = statedFound ?? true;
  return {
    found,
    handEdited: statedHandEdited ?? (found && provenance === undefined),
    ...(provenance !== undefined ? { provenance } : {}),
    superseded,
  };
}

// ---------------------------------------------------------------------------
// profile.set / .append / .undo / .forget
// ---------------------------------------------------------------------------

/**
 * `profile.set` / `.append` / `.undo` → what happened. A daemon that states the outcome
 * is believed; one that answers a bare 200 is reported as changed-but-not-stated, which
 * the surface renders as a plainer sentence than a stated receipt.
 */
export function readProfileWriteOutcome(value: unknown): ProfileWriteOutcome {
  if (!isRecord(value)) return { changed: true, stated: false };
  const wire = value as unknown as ProfileWriteWire;
  const stated =
    readBoolean(wire.changed) ?? readBoolean(wire.written) ?? readBoolean(wire.updated) ?? readBoolean(wire.restored) ?? readBoolean(wire.ok);
  const key = firstString(value, ['key', 'field']);
  const disclosure = firstString(value, ['disclosure', 'message']);
  return {
    changed: stated ?? true,
    stated: stated !== undefined,
    ...(key !== undefined ? { key } : {}),
    ...(disclosure !== undefined ? { disclosure } : {}),
  };
}

/**
 * `profile.forget` → deleted / not-present / unclear.
 *
 * The default is 'unclear', not 'deleted'. A delete verb that does not say whether it
 * deleted has not told us it deleted, and §9.2 is explicit that forgetting something
 * that was not there must not report success. The surface renders all three differently.
 */
export function readProfileForgetOutcome(value: unknown): ProfileForgetOutcome {
  if (!isRecord(value)) return { verdict: 'unclear', removed: [] };
  const wire = value as unknown as ProfileForgetWire;
  const deleted = readBoolean(wire.deleted) ?? readBoolean(wire.forgotten);
  const removed = readStringArray(wire.removed).length ? readStringArray(wire.removed) : readStringArray(wire.removedLines);
  const key = firstString(value, ['key', 'field']);
  const message = readString(wire.message);
  const verdict: ProfileForgetVerdict = deleted === true ? 'deleted' : deleted === false ? 'not-present' : 'unclear';
  return {
    verdict,
    ...(key !== undefined ? { key } : {}),
    removed,
    ...(message !== undefined ? { message } : {}),
  };
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

/**
 * The wire input a target-taking verb (`profile.provenance` / `.forget` / `.undo`)
 * carries: a dotted key, or a section plus a line index.
 */
export type ProfileVerbTarget =
  | { readonly key: string }
  | { readonly section: string; readonly lineIndex: number };

/** Input for `profile.set` — a supersede, with §9.3's settings-surface provenance. */
export interface ProfileSetInput {
  readonly key: string;
  readonly value: string;
  readonly surface: string;
  readonly said: string;
}

/** Input for `profile.append` — a new prose bullet in a prose-only section (§6). */
export interface ProfileAppendInput {
  readonly section: string;
  readonly text: string;
  readonly surface: string;
  readonly said: string;
}

/** The input a verb takes for a target — a dotted key, or a section plus a line index. */
export function profileTargetInput(target: ProfileTarget): ProfileVerbTarget {
  return target.kind === 'field'
    ? { key: target.key }
    : { section: target.section, lineIndex: target.lineIndex };
}

/** A stable string for react keys and query keys. Never rendered to the operator. */
export function profileTargetId(target: ProfileTarget): string {
  return target.kind === 'field' ? `field:${target.key}` : `line:${target.section}:${String(target.lineIndex)}`;
}

/**
 * The address of a prose line, or null when this daemon build gives the line neither a
 * key nor an index. Null means the per-line provenance/forget actions are genuinely not
 * available for that line, and the surface says so rather than sending a guess.
 */
export function targetForProseLine(section: ProfileSection, line: ProfileProseLine): ProfileTarget | null {
  if (line.key !== undefined) return { kind: 'field', key: line.key };
  if (line.lineIndex !== undefined) return { kind: 'line', section: section.id, lineIndex: line.lineIndex };
  return null;
}

// ---------------------------------------------------------------------------
// Third-party personal data (§10)
// ---------------------------------------------------------------------------

/**
 * Sections holding facts about people who never agreed to be in a database. Matched on
 * the canonical section id (or, for a heading he renamed, the heading text) with case
 * and surrounding whitespace collapsed — a section he renamed to something this set does
 * not know is NOT recognised, which is a real limit of matching by name and is stated in
 * the panel rather than papered over.
 */
export const THIRD_PARTY_SECTION_IDS: ReadonlySet<string> = new Set(['people']);

export function sectionHoldsThirdPartyData(section: ProfileSection): boolean {
  return THIRD_PARTY_SECTION_IDS.has(section.id.trim().toLowerCase())
    || THIRD_PARTY_SECTION_IDS.has(section.name.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function profileStateLabel(state: ProfileState): string {
  switch (state) {
    case 'loaded': return 'Loaded';
    case 'disabled': return 'Turned off';
    case 'unavailable': return 'Could not be read';
  }
}

/** The webui's own `.badge` tone classes, same idiom memoryTierBadgeClass uses. */
export function profileStateBadgeClass(state: ProfileState): 'ok' | 'neutral' | 'bad' {
  switch (state) {
    case 'loaded': return 'ok';
    case 'disabled': return 'neutral';
    case 'unavailable': return 'bad';
  }
}

/**
 * §4.4's own sentence, verbatim in shape: "Your profile could not be read: <reason>
 * (<path>)". A daemon that gives no reason gets an honest sentence saying so rather than
 * an invented one.
 */
export function profileUnavailableLine(reason?: string, path?: string): string {
  const head = reason !== undefined
    ? `Your profile could not be read: ${reason}`
    : 'Your profile could not be read, and the daemon did not give a reason';
  return path !== undefined ? `${head} (${path})` : `${head}.`;
}

/** §12's stated disabled state — never an empty profile. */
export function profileDisabledLine(): string {
  return 'Your profile is turned off, so nothing is loaded. Turn on profile.enabled in Settings to use it.';
}

/** One line for a provenance record: which surface, when, and his words (§4.2). */
export function provenanceSummary(provenance: ProfileProvenance): string {
  const parts = [provenance.surface, provenance.date].filter((part): part is string => part !== undefined);
  const head = parts.length > 0 ? parts.join(', ') : 'source not recorded';
  return provenance.said !== undefined ? `${head} — "${provenance.said}"` : head;
}

/** The `said` a settings-surface write carries (§7 layer 3, §9.3). */
export const SETTINGS_EDIT_UTTERANCE = '(edited in settings)';

/** The surface name a write from this app declares (§4.2's provenance suffix). */
export const WEBUI_PROFILE_SURFACE = 'webui';
