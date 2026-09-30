/**
 * Navigation map (design doc "Navigation map"), phase-1 form.
 *
 * Thirteen-plus top-level views become four sidebar destinations. Until the
 * later phases build the real Work, Library and Personal views, each
 * destination groups the existing views and shows a temporary segmented switch
 * at its top (DestinationTabs) so every view stays one click away. Admin,
 * Providers and Principals are sections of the settings dialog now (the
 * router redirects their old links); the phone-node page and Check-ins are
 * still pages, reached from the settings dialog and the account menu.
 */
import type { ViewId } from '../../lib/router';

export type DestinationId = 'chat' | 'work' | 'library' | 'personal' | 'account';

export interface DestinationTab {
  view: ViewId;
  label: string;
}

export interface Destination {
  id: 'work' | 'library' | 'personal';
  label: string;
  /** The view a click on the destination opens. */
  defaultView: ViewId;
  tabs: readonly DestinationTab[];
}

export const WORK: Destination = {
  id: 'work',
  label: 'Work',
  defaultView: 'sessions',
  tabs: [
    { view: 'sessions', label: 'Sessions' },
    { view: 'hosted-sessions', label: 'Hosted' },
    { view: 'fleet', label: 'Processes' },
    { view: 'approvals-tasks', label: 'Needs you' },
    { view: 'workstream', label: 'Workstream' },
    { view: 'ci-watches', label: 'CI' },
    { view: 'checkpoints', label: 'Checkpoints' },
  ],
};

export const LIBRARY: Destination = {
  id: 'library',
  label: 'Library',
  defaultView: 'knowledge',
  tabs: [
    { view: 'knowledge', label: 'Knowledge' },
    { view: 'memory', label: 'Memory' },
  ],
};

export const PERSONAL: Destination = {
  id: 'personal',
  label: 'Personal',
  defaultView: 'calendar',
  tabs: [
    { view: 'calendar', label: 'Calendar' },
    { view: 'mail', label: 'Mail' },
    { view: 'dates', label: 'Occasions' },
  ],
};

export const DESTINATIONS: readonly Destination[] = [WORK, LIBRARY, PERSONAL];

/** Pages outside the destinations: the phone node (from Settings, Devices and pairing) and Check-ins (account menu). */
export const ACCOUNT_VIEWS: readonly { view: ViewId; label: string }[] = [
  { view: 'phone', label: 'Phone node' },
  { view: 'checkin', label: 'Check-ins' },
];

/** Which sidebar destination owns a view. */
export function destinationOf(view: ViewId): DestinationId {
  if (view === 'chat') return 'chat';
  for (const destination of DESTINATIONS) {
    if (destination.tabs.some((tab) => tab.view === view)) return destination.id;
  }
  return 'account';
}

export function destinationById(id: DestinationId): Destination | undefined {
  return DESTINATIONS.find((d) => d.id === id);
}

/** The page title the header shows for a view. */
export function viewTitle(view: ViewId): string {
  if (view === 'chat') return 'Chat';
  for (const destination of DESTINATIONS) {
    if (destination.tabs.some((tab) => tab.view === view)) return destination.label;
  }
  return ACCOUNT_VIEWS.find((entry) => entry.view === view)?.label ?? 'GoodVibes';
}
