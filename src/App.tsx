import {
  Activity,
  Brain,
  CheckSquare,
  Gauge,
  KeyRound,
  LayoutDashboard,
  MessageSquare,
  Plug,
  Radio,
  ServerCog,
  Settings,
  Shield,
  Wifi,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeInvalidation } from './hooks/useRealtimeInvalidation';
import { getCurrentAuth } from './lib/goodvibes';
import { loadBootSnapshot, queryKeys } from './lib/queries';
import { ChatView } from './views/ChatView';
import { DashboardView } from './views/DashboardView';
import { KnowledgeView } from './views/KnowledgeView';
import { ProvidersView } from './views/ProvidersView';
import { WorkView } from './views/WorkView';
import { AdminView } from './views/AdminView';

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

  const title = useMemo(() => views.find((view) => view.id === activeView)?.label ?? 'GoodVibes', [activeView]);
  const subtitle = useMemo(() => views.find((view) => view.id === activeView)?.short ?? 'Surface', [activeView]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">GV</div>
          <div className="brand-copy">
            <strong>GoodVibes</strong>
            <span>Operator Shell</span>
          </div>
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

        <div className="surface-card">
          <div>
            <Radio size={16} />
            <strong>3423</strong>
          </div>
          <span>Browser surface</span>
          <div>
            <Wifi size={16} />
            <strong>3421</strong>
          </div>
          <span>Control plane</span>
        </div>

        <div className="sidebar-footer">
          <span className={realtimeError ? 'status-dot warning' : 'status-dot ok'} />
          <span>{realtimeError ? 'Realtime degraded' : 'Realtime listening'}</span>
        </div>
      </aside>

      <main className="workspace">
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
          {activeView === 'chat' && <ChatView />}
          {activeView === 'dashboard' && <DashboardView />}
          {activeView === 'knowledge' && <KnowledgeView />}
          {activeView === 'providers' && <ProvidersView />}
          {activeView === 'work' && <WorkView />}
          {activeView === 'admin' && <AdminView />}
        </section>
      </main>
    </div>
  );
}
