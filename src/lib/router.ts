/**
 * router.ts — dependency-free URL state encoder/decoder
 *
 * URL schema:
 *   ?view=chat|sessions|knowledge|memory|providers|admin|fleet|checkpoints|approvals-tasks|workstream|calendar|ci-watches|checkin
 *   &session=<sessionId>          (chat view only; omitted when empty)
 *   &filter[<key>]=<value>        (per-view filters; any number of pairs)
 *
 * No react-router. Uses window.history + URLSearchParams directly.
 *
 * 'fleet' and 'checkpoints' are wired end-to-end (App.tsx nav + render
 * switch, src/views/fleet, src/views/checkpoints). 'approvals-tasks' and
 * 'workstream' are registered here as valid ViewIds (so the URL round-trips
 * and never falls back to 'chat') ahead of the ApprovalsTasksView/
 * WorkstreamView components landing, which add their own App.tsx
 * nav/render-switch entries — see the nav-entries comment in App.tsx.
 */

export type ViewId =
  | 'chat'
  | 'sessions'
  | 'knowledge'
  | 'memory'
  | 'providers'
  | 'admin'
  | 'fleet'
  | 'checkpoints'
  | 'approvals-tasks'
  | 'workstream'
  | 'calendar'
  | 'ci-watches'
  | 'checkin';

export interface AppUrlState {
  view: ViewId;
  session: string;
  filters: Record<string, string>;
}

const VALID_VIEWS: ReadonlySet<string> = new Set<ViewId>([
  'chat',
  'sessions',
  'knowledge',
  'memory',
  'providers',
  'admin',
  'fleet',
  'checkpoints',
  'approvals-tasks',
  'workstream',
  'calendar',
  'ci-watches',
  'checkin',
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

  return { view, session, filters };
}

/** Encode AppUrlState into a URLSearchParams string (no leading '?'). */
export function encodeUrlState(state: AppUrlState): string {
  const params = new URLSearchParams();

  params.set('view', state.view);

  if (state.session) {
    params.set('session', state.session);
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

