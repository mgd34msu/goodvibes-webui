import {
  Activity,
  Brain,
  CheckSquare,
  Gauge,
  KeyRound,
  LayoutDashboard,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Radio,
  ServerCog,
  Settings,
  Shield,
  Wifi,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeInvalidation } from './hooks/useRealtimeInvalidation';
import { getCurrentAuth, sdk } from './lib/goodvibes';
import { loadBootSnapshot, queryKeys } from './lib/queries';
import { ChatView } from './views/ChatView';
import { DashboardView } from './views/DashboardView';
import { KnowledgeView } from './views/KnowledgeView';
import { ProvidersView } from './views/ProvidersView';
import { WorkView } from './views/WorkView';
import { AdminView } from './views/AdminView';
import { bestId, bestTitle, firstArrayAtPath, firstString } from './lib/object';
import { companionSessionFromDetail, mergeCompanionSessions } from './lib/companion-chat';

type ViewId = 'chat' | 'dashboard' | 'knowledge' | 'providers' | 'work' | 'admin';

const views: Array<{
  id: ViewId;
  label: string;
  short: string;
  icon: typeof MessageSquare;
}> = [
  { id: 'chat', label: 'Chat', short: 'Live', icon: MessageSquare },
  { id: 'dashboard', label: 'Dashboard', short: 'Posture', icon: LayoutDashboard },
  { id: 'knowledge', label: 'Knowledge', short: 'Wiki', icon: Brain },
  { id: 'providers', label: 'Providers', short: 'Models', icon: Gauge },
  { id: 'work', label: 'Work', short: 'Queue', icon: CheckSquare },
  { id: 'admin', label: 'Admin', short: 'Secure', icon: ServerCog },
];

export default function App() {
  const [activeView, setActiveView] = useState<ViewId>('chat');
  const [activeChatSessionId, setActiveChatSessionId] = useState('');
  const [draftChatRequested, setDraftChatRequested] = useState(false);
  const [localChatSessions, setLocalChatSessions] = useState<unknown[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const realtimeError = useRealtimeInvalidation(true);
  const boot = useQuery({
    queryKey: ['boot'],
    queryFn: loadBootSnapshot,
  });
  const auth = useQuery({
    queryKey: queryKeys.auth,
    queryFn: getCurrentAuth,
    retry: false,
  });
  const chatSessions = useQuery({
    queryKey: ['companion-chat', 'sessions'],
    queryFn: () => sdk.chat.sessions.list({ limit: 100 }),
    enabled: activeView === 'chat',
  });

  const fetchedChatSessions = useMemo(() => {
    return firstArrayAtPath(chatSessions.data, [
      ['sessions'],
      ['items'],
      ['data'],
      ['result', 'sessions'],
      ['result', 'items'],
      ['result', 'data'],
    ]).map(companionSessionFromDetail);
  }, [chatSessions.data]);
  const chatSessionItems = useMemo(
    () => mergeCompanionSessions(localChatSessions, fetchedChatSessions),
    [fetchedChatSessions, localChatSessions],
  );

  useEffect(() => {
    if (!activeChatSessionId && !draftChatRequested && chatSessionItems.length) {
      setActiveChatSessionId(bestId(chatSessionItems[0]));
    }
  }, [activeChatSessionId, chatSessionItems, draftChatRequested]);

  const title = useMemo(() => views.find((view) => view.id === activeView)?.label ?? 'GoodVibes', [activeView]);
  const subtitle = useMemo(() => views.find((view) => view.id === activeView)?.short ?? 'Surface', [activeView]);
  const SidebarToggleIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <div className={sidebarCollapsed ? 'app-shell sidebar-collapsed' : 'app-shell'}>
      <aside className={sidebarCollapsed ? 'sidebar collapsed' : 'sidebar'}>
        <div className="brand">
          <img className="brand-mark" src="/goodvibes-icon.png" alt="" aria-hidden="true" />
          <div className="brand-copy">
            <strong>GOODVIBES</strong>
            <span>Operator Shell</span>
          </div>
          <button
            className="sidebar-toggle"
            type="button"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setSidebarCollapsed((current) => !current)}
          >
            <SidebarToggleIcon size={17} />
          </button>
        </div>

        <nav className="nav-list" aria-label="Primary">
          {views.map((view) => {
            const Icon = view.icon;
            return (
              <button
                key={view.id}
                className={view.id === activeView ? 'nav-item active' : 'nav-item'}
                type="button"
                onClick={() => setActiveView(view.id)}
              >
                <span className="nav-icon"><Icon size={18} /></span>
                <span className="nav-copy">
                  <strong>{view.label}</strong>
                  <small>{view.short}</small>
                </span>
              </button>
            );
          })}
        </nav>

        {activeView === 'chat' && (
          <section className="sidebar-sessions">
            <div className="sidebar-section-title">
              <span>Chats</span>
              <button
                type="button"
                title="New chat"
                onClick={() => {
                  setActiveChatSessionId('');
                  setDraftChatRequested(true);
                }}
              >
                +
              </button>
            </div>
            <div className="sidebar-session-list">
              {chatSessionItems.map((session, index) => {
                const id = bestId(session) || String(index);
                return (
                  <button
                    key={`${id}-${index}`}
                    type="button"
                    className={activeChatSessionId === id ? 'sidebar-session active' : 'sidebar-session'}
                    onClick={() => {
                      setActiveChatSessionId(id);
                      setDraftChatRequested(false);
                    }}
                  >
                    <span>{bestTitle(session, id)}</span>
                    <small>{firstString(session, ['status', 'state']) || 'active'}</small>
                  </button>
                );
              })}
              {!chatSessionItems.length && <span className="sidebar-empty">No chat sessions</span>}
            </div>
          </section>
        )}

      </aside>

      <main className={activeView === 'chat' ? 'workspace workspace-chat' : 'workspace'}>
        <header className="topbar">
          <div className="topbar-title">
            <span className="eyebrow">{subtitle}</span>
            <h1>{title}</h1>
          </div>
          <div className="status-strip" aria-label="Runtime status">
            <span><Shield size={15} /> Auth</span>
            <span><Radio size={15} /> 3423</span>
            <span><Wifi size={15} /> 3421</span>
            <span className={boot.isFetching ? 'syncing' : ''}>
              <Activity size={15} /> {boot.isFetching ? 'Syncing' : 'Current'}
            </span>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" type="button" title="Refresh" onClick={() => void boot.refetch()}>
              <Activity size={18} />
            </button>
            <button className="icon-button" type="button" title="Auth and settings" onClick={() => setActiveView('admin')}>
              <KeyRound size={18} />
            </button>
            <button className="icon-button" type="button" title="Admin" onClick={() => setActiveView('admin')}>
              <Settings size={18} />
            </button>
          </div>
        </header>

        {auth.isError && (
          <div className="banner warning action-banner">
            <Plug size={16} />
            <span>Sign in through daemon-owned auth before using operator APIs.</span>
            <button type="button" onClick={() => setActiveView('admin')}>Open auth</button>
          </div>
        )}
        {realtimeError && <div className="banner warning"><Plug size={16} /> {realtimeError}</div>}

        <section className="view-frame">
          {activeView === 'chat' && (
            <ChatView
              activeSessionId={activeChatSessionId}
              sessionItems={chatSessionItems}
              onActiveSessionChange={(sessionId) => {
                setActiveChatSessionId(sessionId);
                setDraftChatRequested(false);
              }}
              onDraftSessionRequestedChange={setDraftChatRequested}
              onLocalSessionCreated={(session) => setLocalChatSessions((current) => [
                companionSessionFromDetail(session),
                ...current.filter((item) => bestId(item) !== bestId(session)),
              ])}
              onLocalSessionUpdated={(sessionId, session) => setLocalChatSessions((current) => {
                const normalized = companionSessionFromDetail(session);
                const next = current.filter((item) => bestId(item) !== sessionId);
                return [bestId(normalized) ? normalized : { id: sessionId, sessionId, title: bestTitle(session, sessionId) }, ...next];
              })}
            />
          )}
          {activeView === 'dashboard' && <DashboardView />}
          {activeView === 'knowledge' && <KnowledgeView />}
          {activeView === 'providers' && <ProvidersView />}
          {activeView === 'work' && <WorkView />}
          {activeView === 'admin' && <AdminView realtimeError={realtimeError} />}
        </section>
      </main>
    </div>
  );
}
