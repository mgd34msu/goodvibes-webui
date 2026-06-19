import {
  Activity,
  Brain,
  Gauge,
  KeyRound,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  ServerCog,
  Settings,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRealtimeInvalidation } from './hooks/useRealtimeInvalidation';
import { getCurrentAuth, sdk } from './lib/goodvibes';
import { loadBootSnapshot, queryKeys } from './lib/queries';
import { ChatView } from './views/ChatView';
import { KnowledgeView } from './views/KnowledgeView';
import { ProvidersView } from './views/ProvidersView';
import { AdminView } from './views/AdminView';
import { bestId, bestTitle, firstString } from './lib/object';
import {
  companionSessionFromDetail,
  companionSessionsFromListResponse,
  mergeCompanionSessions,
  readStoredActiveCompanionSessionId,
  readStoredCompanionSessions,
  writeStoredActiveCompanionSessionId,
  writeStoredCompanionSessions,
} from './lib/companion-chat';
import { formatError, isSessionNotFoundError } from './lib/errors';

type ViewId = 'chat' | 'knowledge' | 'providers' | 'admin';

const views: {
  id: ViewId;
  label: string;
  short: string;
  icon: typeof MessageSquare;
}[] = [
  { id: 'chat', label: 'Chat', short: 'Live', icon: MessageSquare },
  { id: 'knowledge', label: 'Knowledge', short: 'Wiki', icon: Brain },
  { id: 'providers', label: 'Providers', short: 'Models', icon: Gauge },
  { id: 'admin', label: 'Admin', short: 'Secure', icon: ServerCog },
];

export default function App() {
  const queryClient = useQueryClient();
  const [activeView, setActiveView] = useState<ViewId>('chat');
  const [activeChatSessionId, setActiveChatSessionId] = useState(() => readStoredActiveCompanionSessionId());
  const [draftChatRequested, setDraftChatRequested] = useState(false);
  const [localChatSessions, setLocalChatSessions] = useState<unknown[]>(() => readStoredCompanionSessions());
  const [createdChatSessionIds, setCreatedChatSessionIds] = useState<Set<string>>(() => new Set());
  const [deletedChatSessionIds, setDeletedChatSessionIds] = useState<Set<string>>(() => new Set());
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
    return companionSessionsFromListResponse(chatSessions.data);
  }, [chatSessions.data]);
  const mergedChatSessionItems = useMemo(
    () => {
      if (chatSessions.isSuccess) {
        return mergeCompanionSessions(
          localChatSessions.filter((session) => createdChatSessionIds.has(bestId(session))),
          fetchedChatSessions,
        );
      }
      return mergeCompanionSessions(localChatSessions, fetchedChatSessions);
    },
    [chatSessions.isSuccess, createdChatSessionIds, fetchedChatSessions, localChatSessions],
  );
  const chatSessionItems = useMemo(
    () => mergedChatSessionItems.filter((session) => !deletedChatSessionIds.has(bestId(session))),
    [deletedChatSessionIds, mergedChatSessionItems],
  );

  const deleteChat = useMutation({
    mutationFn: (sessionId: string) => sdk.chat.sessions.delete(sessionId),
    onMutate: async (sessionId) => {
      await queryClient.cancelQueries({ queryKey: ['companion-chat', 'sessions'] });
      const nextSessionId = chatSessionItems.map(bestId).find((id) => id && id !== sessionId) ?? '';
      setDeletedChatSessionIds((current) => new Set(current).add(sessionId));
      setCreatedChatSessionIds((current) => {
        const next = new Set(current);
        next.delete(sessionId);
        return next;
      });
      setLocalChatSessions((current) => current.filter((session) => bestId(session) !== sessionId));
      if (activeChatSessionId === sessionId) {
        setActiveChatSessionId(nextSessionId);
        setDraftChatRequested(!nextSessionId);
      }
    },
    onError: (error, sessionId) => {
      if (isSessionNotFoundError(error)) return;
      setDeletedChatSessionIds((current) => {
        const next = new Set(current);
        next.delete(sessionId);
        return next;
      });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['companion-chat', 'sessions'] });
    },
  });

  useEffect(() => {
    if (!activeChatSessionId && !draftChatRequested && chatSessionItems.length) {
      setActiveChatSessionId(bestId(chatSessionItems[0]));
    }
  }, [activeChatSessionId, chatSessionItems, draftChatRequested]);

  useEffect(() => {
    if (!chatSessions.isSuccess || !activeChatSessionId) return;
    if (chatSessionItems.some((session) => bestId(session) === activeChatSessionId)) return;
    const nextSessionId = bestId(chatSessionItems[0]);
    setActiveChatSessionId(nextSessionId);
    setDraftChatRequested(!nextSessionId);
  }, [activeChatSessionId, chatSessionItems, chatSessions.isSuccess]);

  useEffect(() => {
    writeStoredActiveCompanionSessionId(activeChatSessionId);
  }, [activeChatSessionId]);

  useEffect(() => {
    if (chatSessions.isSuccess || chatSessionItems.length) writeStoredCompanionSessions(chatSessionItems);
  }, [chatSessionItems, chatSessions.isSuccess]);

  useEffect(() => {
    if (!chatSessions.isSuccess || !createdChatSessionIds.size) return;
    const fetchedIds = new Set(fetchedChatSessions.map(bestId).filter(Boolean));
    setCreatedChatSessionIds((current) => {
      const next = new Set([...current].filter((id) => !fetchedIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [chatSessions.isSuccess, createdChatSessionIds.size, fetchedChatSessions]);

  const handleMissingChatSession = useCallback((sessionId: string) => {
    setDeletedChatSessionIds((current) => new Set(current).add(sessionId));
    setCreatedChatSessionIds((current) => {
      const next = new Set(current);
      next.delete(sessionId);
      return next;
    });
    setLocalChatSessions((current) => current.filter((session) => bestId(session) !== sessionId));
    queryClient.removeQueries({ queryKey: ['companion-chat', sessionId] });
    queryClient.removeQueries({ queryKey: ['companion-chat', sessionId, 'messages'] });
    if (activeChatSessionId === sessionId) {
      const nextSessionId = chatSessions.isSuccess
        ? chatSessionItems.map(bestId).find((id) => id && id !== sessionId) ?? ''
        : '';
      setActiveChatSessionId(nextSessionId);
      setDraftChatRequested(!nextSessionId);
    }
    void queryClient.invalidateQueries({ queryKey: ['companion-chat', 'sessions'] });
  }, [activeChatSessionId, chatSessionItems, chatSessions.isSuccess, queryClient]);

  const title = useMemo(() => views.find((view) => view.id === activeView)?.label ?? 'GoodVibes', [activeView]);
  const subtitle = useMemo(() => views.find((view) => view.id === activeView)?.short ?? 'Surface', [activeView]);
  const SidebarToggleIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <div className={sidebarCollapsed ? 'app-shell sidebar-collapsed' : 'app-shell'}>
      <aside
        className={sidebarCollapsed ? 'sidebar collapsed' : 'sidebar'}
        onClick={(event) => {
          if (!sidebarCollapsed) return;
          const target = event.target as HTMLElement;
          if (target.closest('.nav-item')) return;
          setSidebarCollapsed(false);
        }}
      >
        <div className="brand">
          <button
            className="brand-mark-button"
            type="button"
            title={sidebarCollapsed ? 'Expand sidebar' : 'GoodVibes'}
            onClick={() => sidebarCollapsed && setSidebarCollapsed(false)}
          >
            <img className="brand-mark" src="/goodvibes-icon.png" alt="" aria-hidden="true" />
          </button>
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
                  <div
                    key={`${id}-${index}`}
                    className={activeChatSessionId === id ? 'sidebar-session-row active' : 'sidebar-session-row'}
                  >
                    <button
                      type="button"
                      className="sidebar-session"
                      onClick={() => {
                        setActiveChatSessionId(id);
                        setDraftChatRequested(false);
                      }}
                    >
                      <span>{bestTitle(session, id)}</span>
                      <small>{firstString(session, ['status', 'state']) || 'active'}</small>
                    </button>
                    <button
                      className="sidebar-session-delete"
                      type="button"
                      title={`Delete ${bestTitle(session, id)}`}
                      disabled={deleteChat.isPending}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!window.confirm(`Delete "${bestTitle(session, id)}"?`)) return;
                        deleteChat.mutate(id);
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
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
        {deleteChat.error && !isSessionNotFoundError(deleteChat.error) && (
          <div className="banner warning"><Plug size={16} /> {formatError(deleteChat.error)}</div>
        )}

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
              onLocalSessionCreated={(session) => {
                const normalized = companionSessionFromDetail(session);
                const id = bestId(normalized);
                if (id) setCreatedChatSessionIds((current) => new Set(current).add(id));
                setLocalChatSessions((current) => [
                  normalized,
                  ...current.filter((item) => bestId(item) !== id),
                ]);
              }}
              onLocalSessionUpdated={(sessionId, session) => setLocalChatSessions((current) => {
                const normalized = companionSessionFromDetail(session);
                const next = current.filter((item) => bestId(item) !== sessionId);
                return [bestId(normalized) ? normalized : { id: sessionId, sessionId, title: bestTitle(session, sessionId) }, ...next];
              })}
              onSessionMissing={handleMissingChatSession}
            />
          )}
          {activeView === 'knowledge' && <KnowledgeView />}
          {activeView === 'providers' && <ProvidersView />}
          {activeView === 'admin' && <AdminView realtimeError={realtimeError} />}
        </section>
      </main>
    </div>
  );
}
