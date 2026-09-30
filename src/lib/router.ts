/**
 * router.ts, dependency-free URL state encoder/decoder
 *
 * URL schema:
 *   ?view=chat|sessions|knowledge|memory|fleet|checkpoints|approvals-tasks|workstream|calendar|mail|ci-watches|checkin|phone|dates|hosted-sessions
 *   &session=<sessionId>          (chat view only; omitted when empty)
 *   &settings=<section>           (the settings dialog is open on that section)
 *   &filter[<key>]=<value>        (per-view filters; any number of pairs)
 *
 * Admin, Providers and Principals stopped being views: they are sections of
 * the settings dialog. Their old links still work, `?view=admin` decodes to
 * the chat view with the dialog open on Account, `?view=providers` on Models
 * and providers, `?view=principals` on People and channels
 * (LEGACY_SETTINGS_VIEWS).
 *
 * No react-router. Uses window.history + URLSearchParams directly.
 *
 * 'fleet' and 'checkpoints' are wired end-to-end (App.tsx nav + render
 * switch, src/views/fleet, src/views/checkpoints). 'approvals-tasks' and
 * 'workstream' are registered here as valid ViewIds (so the URL round-trips
 * and never falls back to 'chat') ahead of the ApprovalsTasksView/
 * WorkstreamView components landing, which add their own App.tsx
 * nav/render-switch entries, see the nav-entries comment in App.tsx.
 */

export type ViewId =
  | 'chat'
  | 'sessions'
  | 'knowledge'
  | 'memory'
  | 'fleet'
  | 'checkpoints'
  | 'approvals-tasks'
  | 'workstream'
  | 'calendar'
  | 'mail'
  | 'ci-watches'
  | 'checkin'
  | 'phone'
  | 'dates'
  | 'hosted-sessions';

export interface AppUrlState {
  view: ViewId;
  session: string;
  filters: Record<string, string>;
  /** The open settings dialog section; absent or '' while the dialog is closed. */
  settings?: string;
}

/** Old view ids that now open the settings dialog, and the section each opens on. */
export const LEGACY_SETTINGS_VIEWS: Readonly<Record<string, string>> = {
  admin: 'account',
  providers: 'models',
  principals: 'people',
};

const VALID_VIEWS: ReadonlySet<string> = new Set<ViewId>([
  'chat',
  'sessions',
  'knowledge',
  'memory',
  'fleet',
  'checkpoints',
  'approvals-tasks',
  'workstream',
  'calendar',
  'mail',
  'ci-watches',
  'checkin',
  'phone',
  'dates',
  'hosted-sessions',
]);

const DEFAULT_STATE: AppUrlState = {
  view: 'chat',
  session: '',
  filters: {},
};

const FILTER_PREFIX = 'filter[';

/** Parse the current URL (or a supplied search string) into AppUrlState. */
export function decodeUrlState(search: string = window.location.search): AppUrlState {
  const params = new URLSearchParams(search);

  const rawView = params.get('view') ?? '';
  const view: ViewId = VALID_VIEWS.has(rawView) ? (rawView as ViewId) : DEFAULT_STATE.view;
  const settings = params.get('settings') || LEGACY_SETTINGS_VIEWS[rawView] || '';

  const session = params.get('session') ?? '';

  const filters: Record<string, string> = {};
  params.forEach((value, key) => {
    if (key.startsWith(FILTER_PREFIX) && key.endsWith(']')) {
      const filterKey = key.slice(FILTER_PREFIX.length, -1);
      if (filterKey.length > 0) {
        filters[filterKey] = value;
      }
    }
  });

  return settings ? { view, session, filters, settings } : { view, session, filters };
}

/** True when the search string names an old view that now opens the settings dialog. */
export function isLegacySettingsView(search: string = window.location.search): boolean {
  const rawView = new URLSearchParams(search).get('view') ?? '';
  return rawView in LEGACY_SETTINGS_VIEWS;
}

/** Encode AppUrlState into a URLSearchParams string (no leading '?'). */
export function encodeUrlState(state: AppUrlState): string {
  const params = new URLSearchParams();

  params.set('view', state.view);

  if (state.session) {
    params.set('session', state.session);
  }

  if (state.settings) {
    params.set('settings', state.settings);
  }

  const filterKeys = Object.keys(state.filters).sort();
  for (const key of filterKeys) {
    const value = state.filters[key];
    if (value !== '') {
      params.set(`${FILTER_PREFIX}${key}]`, value);
    }
  }

  return params.toString();
}

/** Push a new history entry for the given state. */
export function pushState(state: AppUrlState): void {
  const search = encodeUrlState(state);
  const url = `${window.location.pathname}?${search}`;
  window.history.pushState(state, '', url);
}

/** Replace the current history entry with the given state. */
export function replaceState(state: AppUrlState): void {
  const search = encodeUrlState(state);
  const url = `${window.location.pathname}?${search}`;
  window.history.replaceState(state, '', url);
}

/** Read the current URL state without subscribing. */
export function getCurrentUrlState(): AppUrlState {
  return decodeUrlState(window.location.search);
}

