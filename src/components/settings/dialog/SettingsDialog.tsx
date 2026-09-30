/**
 * The settings dialog (design doc "Menus and modals", "Settings dialog
 * sections"; deep dive "Settings dialog"). One glass dialog, 880 by 640 on
 * desktop over the scrim, a full-screen sheet on a phone.
 *
 * Left column (220): a search field that filters sections and individual
 * settings, then the grouped section list in the sidebar's nav-item style.
 * Right column: the section title, its content, scrolling on its own. The
 * close button sits top right; Escape closes; focus is trapped and returned
 * (the kit Dialog). On a phone the two columns become two screens: the list,
 * and a section with a back button.
 *
 * The open section lives in the URL (`?settings=<section>`, App.tsx), so a
 * link opens the dialog on a section and Back closes it.
 */
import {
  Activity,
  Bell,
  BookOpen,
  Box,
  ChevronLeft,
  ChevronRight,
  Globe,
  Info,
  KeyRound,
  Mic,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { ViewId } from '../../../lib/router';
import ErrorBoundary from '../../feedback/ErrorBoundary';
import { ErrorState } from '../../feedback/ErrorState';
import { Dialog } from '../../ui/Dialog';
import { IconButton } from '../../ui/IconButton';
import { Input } from '../../ui/Field';
import { PHONE_QUERY, useMediaQuery } from '../../ui/overlay';
import { ConfigGroupList, ConfigSettingsProvider, useConfigSettings } from './ConfigSettings';
import {
  groupsForSection,
  matchSettingsSections,
  resolveSettingsSection,
  sectionGroups,
  settingsSection,
  type SettingsSectionId,
} from './sections';
import { GeneralSection } from './sections/GeneralSection';
import { AccountSection } from './sections/AccountSection';
import { ModelsSection } from './sections/ModelsSection';
import {
  AboutSection,
  AllSettingsSection,
  CredentialsSection,
  DevicesSection,
  MemorySection,
  NetworkSection,
  NotificationsSection,
  PeopleSection,
  PermissionsSection,
  UsageSection,
  VoiceSection,
} from './sections/MoreSections';
import '../../../styles/components/settings.css';
import '../../../styles/components/settings-dialog.css';

const SECTION_ICONS: Record<SettingsSectionId, ReactNode> = {
  general: <Settings2 aria-hidden="true" />,
  account: <UserRound aria-hidden="true" />,
  devices: <Smartphone aria-hidden="true" />,
  people: <Users aria-hidden="true" />,
  models: <Box aria-hidden="true" />,
  credentials: <KeyRound aria-hidden="true" />,
  usage: <Activity aria-hidden="true" />,
  voice: <Mic aria-hidden="true" />,
  notifications: <Bell aria-hidden="true" />,
  memory: <BookOpen aria-hidden="true" />,
  permissions: <ShieldCheck aria-hidden="true" />,
  network: <Globe aria-hidden="true" />,
  all: <SlidersHorizontal aria-hidden="true" />,
  about: <Info aria-hidden="true" />,
};

export interface SettingsDialogProps {
  open: boolean;
  /** The `?settings=` value; unknown values open General. */
  section: string;
  onSectionChange: (section: SettingsSectionId) => void;
  onClose: () => void;
  /** Leave the dialog for a page (the phone node). */
  onOpenView: (view: ViewId) => void;
  realtimeError?: string | null;
}

export function SettingsDialog(props: SettingsDialogProps) {
  if (!props.open) return null;
  return (
    <ConfigSettingsProvider>
      <SettingsDialogBody {...props} />
    </ConfigSettingsProvider>
  );
}

function SettingsDialogBody({ section, onSectionChange, onClose, onOpenView, realtimeError }: SettingsDialogProps) {
  const phone = useMediaQuery(PHONE_QUERY);
  const { groups } = useConfigSettings();
  const [query, setQuery] = useState('');
  const requested = resolveSettingsSection(section);
  // Phone: the list is its own screen. A link or menu entry naming a section
  // opens straight on it; the plain "Settings" entry (General) opens the list.
  const [phoneList, setPhoneList] = useState(() => requested === 'general');
  const searchRef = useRef<HTMLInputElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const matches = useMemo(() => matchSettingsSections(query, groups), [query, groups]);
  const matchById = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);
  const searching = query.trim().length > 0;
  // While a search hides the open section, show the first match instead.
  const activeId: SettingsSectionId | null = matchById.has(requested) ? requested : (matches[0]?.id ?? null);
  const active = activeId ? settingsSection(activeId) : null;
  const activeMatch = activeId ? matchById.get(activeId) : undefined;

  const select = (id: SettingsSectionId) => {
    onSectionChange(id);
    setPhoneList(false);
  };

  const nav = (
    <nav className="settings-nav" aria-label="Settings sections">
      <div className="settings-search">
        <Search className="settings-search__icon" aria-hidden="true" />
        <Input
          ref={searchRef}
          type="search"
          value={query}
          placeholder="Search settings"
          aria-label="Search settings"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {matches.length === 0 ? (
        <p className="settings-nav__empty" role="status">No settings match “{query.trim()}”.</p>
      ) : (
        sectionGroups(matches.map((m) => m.id)).map((group) => (
          <div key={group.label} className="settings-nav__group" role="group" aria-label={group.label}>
            <div className="settings-nav__group-label" aria-hidden="true">{group.label}</div>
            {group.sections.map((s) => {
              const count = matchById.get(s.id)?.settingCount ?? 0;
              const current = !phone && s.id === activeId;
              return (
                <button
                  key={s.id}
                  type="button"
                  className="shell-nav-item settings-nav-item"
                  aria-current={current ? 'page' : undefined}
                  data-section={s.id}
                  onClick={() => select(s.id)}
                >
                  <span className="shell-nav-item__icon">{SECTION_ICONS[s.id]}</span>
                  <span className="shell-nav-item__label">{s.label}</span>
                  {searching && count > 0 && (
                    <span className="settings-nav-item__count" aria-label={`${count} matching setting${count === 1 ? '' : 's'}`}>{count}</span>
                  )}
                  {phone && <ChevronRight className="settings-nav-item__chevron" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        ))
      )}
    </nav>
  );

  const closeButton = (
    <IconButton ref={closeRef} label="Close" icon={<X />} onClick={onClose} noTooltip className="settings-close" />
  );

  const showList = phone && phoneList;

  return (
    <Dialog
      open
      bare
      size="large"
      title="Settings"
      className="settings-dialog"
      onClose={onClose}
      initialFocusRef={phone ? closeRef : searchRef}
    >
      <div className={showList ? 'settings-layout settings-layout--list' : 'settings-layout'}>
        {(!phone || showList) && (
          <aside className="settings-sidebar">
            {phone && (
              <div className="settings-pane-head settings-pane-head--list">
                <div className="settings-pane-head__titles">
                  <div className="settings-pane-title" aria-hidden="true">Settings</div>
                </div>
                {closeButton}
              </div>
            )}
            {nav}
          </aside>
        )}
        {!showList && (
          <div className="settings-main">
            <div className="settings-pane-head">
              {phone && (
                <IconButton label="Back to settings" icon={<ChevronLeft />} onClick={() => setPhoneList(true)} noTooltip />
              )}
              <div className="settings-pane-head__titles">
                <h2 className="settings-pane-title">{active ? active.label : 'Settings'}</h2>
                {active && <p className="settings-pane-description">{active.description}</p>}
              </div>
              {closeButton}
            </div>
            <div className="settings-pane" key={`${activeId ?? 'none'}:${searching && !activeMatch?.whole ? 'search' : 'full'}`}>
              {!active ? (
                <p className="settings-empty">No settings match “{query.trim()}”.</p>
              ) : searching && activeMatch && !activeMatch.whole ? (
                <>
                  <p className="settings-search-note" role="status">
                    Settings in {active.label} matching “{query.trim()}”.
                  </p>
                  <ConfigGroupList groups={groupsForSection(active.id, groups)} query={query} />
                </>
              ) : (
                <ErrorBoundary
                  fallback={(err, reset) => <ErrorState error={err} title="This section failed to load" onRetry={reset} />}
                >
                  <SectionContent id={active.id} onOpenView={onOpenView} realtimeError={realtimeError} />
                </ErrorBoundary>
              )}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function SectionContent({
  id,
  onOpenView,
  realtimeError,
}: {
  id: SettingsSectionId;
  onOpenView: (view: ViewId) => void;
  realtimeError?: string | null;
}) {
  switch (id) {
    case 'general': return <GeneralSection />;
    case 'account': return <AccountSection />;
    case 'devices': return <DevicesSection onOpenView={onOpenView} />;
    case 'people': return <PeopleSection />;
    case 'models': return <ModelsSection />;
    case 'credentials': return <CredentialsSection />;
    case 'usage': return <UsageSection />;
    case 'voice': return <VoiceSection />;
    case 'notifications': return <NotificationsSection />;
    case 'memory': return <MemorySection />;
    case 'permissions': return <PermissionsSection />;
    case 'network': return <NetworkSection />;
    case 'all': return <AllSettingsSection />;
    case 'about': return <AboutSection realtimeError={realtimeError} />;
  }
}
