import {
  Activity,
  Brain,
  Gauge,
  KeyRound,
  MessageSquare,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  ServerCog,
  Settings,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from './components/shell/AppShell';
import { useUrlState } from './hooks/useUrlState';
import type { ViewId } from './lib/router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRealtimeInvalidation } from './hooks/useRealtimeInvalidation';
import { useSessionRealtime } from './hooks/useSessionRealtime';
import { getCurrentAuth, hasStoredTokenSync, sdk } from './lib/goodvibes';
import { loadBootSnapshot, queryKeys } from './lib/queries';
import { ChatView } from './views/ChatView';
import { SessionsView } from './views/sessions/SessionsView';
import { SignedOutGate } from './components/auth/SignedOutGate';
import { DaemonUnreachableGate } from './components/auth/DaemonUnreachableGate';
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
import { formatError, isDaemonUnreachableError, isSessionNotFoundError } from './lib/errors';

const views: {
  id: ViewId;
  label: string;
  short: string;
  icon: typeof MessageSquare;
}[] = [
  { id: 'chat', label: 'Chat', short: 'Live', icon: MessageSquare },
  { id: 'sessions', label: 'Sessions', short: 'Union', icon: Network },
  { id: 'knowledge', label: 'Knowledge', short: 'Wiki', icon: Brain },
  { id: 'providers', label: 'Providers', short: 'Models', icon: Gauge },
  { id: 'admin', label: 'Admin', short: 'Secure', icon: ServerCog },
];

export default function App() {
  const queryClient = useQueryClient();
  const { view, setView, session: activeChatSessionId, setSession } = useUrlState();
  const activeView: ViewId = view;
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
    // Auto-recovery: while the daemon is unreachable, keep re-probing so the shell
    // reveals itself the moment the daemon answers again. A 401 (genuinely signed out)
    // is NOT an unreachable error, so this does not busy-poll the sign-in front door.
    refetchInterval: (query) => (isDaemonUnreachableError(query.state.error) ? 5_000 : false),
  });
  // Session liveness: consume the raw un-domained session-update stream, but only once
  // signed in (opening it while signed-out just 401s). It degrades honestly on failure.
  const sessionRealtime = useSessionRealtime(auth.isSuccess);
  const chatSessions = useQuery({
    queryKey: ['companion-chat', 'sessions'],
    queryFn: () => sdk.chat.sessions.list({ limit: 100 }),
    enabled: view === 'chat',
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
      setLocalChatSessions((current) => current.filter((s) => bestId(s) !== sessionId));
      if (activeChatSessionId === sessionId) {
        setSession(nextSessionId, { replace: true });
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
      setSession(bestId(chatSessionItems[0]), { replace: true });
    }
  }, [activeChatSessionId, chatSessionItems, draftChatRequested, setSession]);

  useEffect(() => {
    if (!chatSessions.isSuccess || !activeChatSessionId) return;
    if (chatSessionItems.some((s) => bestId(s) === activeChatSessionId)) return;
    const nextSessionId = bestId(chatSessionItems[0]);
    setSession(nextSessionId, { replace: true });
    setDraftChatRequested(!nextSessionId);
  }, [activeChatSessionId, chatSessionItems, chatSessions.isSuccess, setSession]);

  useEffect(() => {
    writeStoredActiveCompanionSessionId(activeChatSessionId);
  }, [activeChatSessionId]);

  // Seed local session state from localStorage on first mount if URL has no session.
  useEffect(() => {
    if (!activeChatSessionId) {
      const stored = readStoredActiveCompanionSessionId();
      if (stored) setSession(stored, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setLocalChatSessions((current) => current.filter((s) => bestId(s) !== sessionId));
    queryClient.removeQueries({ queryKey: ['companion-chat', sessionId] });
    queryClient.removeQueries({ queryKey: ['companion-chat', sessionId, 'messages'] });
    if (activeChatSessionId === sessionId) {
      const nextSessionId = chatSessions.isSuccess
        ? chatSessionItems.map(bestId).find((id) => id && id !== sessionId) ?? ''
        : '';
      setSession(nextSessionId, { replace: true });
      setDraftChatRequested(!nextSessionId);
    }
    void queryClient.invalidateQueries({ queryKey: ['companion-chat', 'sessions'] });
  }, [activeChatSessionId, chatSessionItems, chatSessions.isSuccess, queryClient, setSession]);

  const handleNavigate = useCallback(
    (nextView: ViewId, options?: { newChat?: boolean }) => {
      setView(nextView);
      if (options?.newChat) {
        setSession('', { replace: true });
        setDraftChatRequested(true);
      }
    },
    [setView, setSession],
  );

  const title = useMemo(() => views.find((v) => v.id === activeView)?.label ?? 'GoodVibes', [activeView]);
  const subtitle = useMemo(() => views.find((v) => v.id === activeView)?.short ?? 'Surface', [activeView]);
  const SidebarToggleIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;

  // Honest login gate. Signed-out (auth.current 401 → query error) shows the front door
  // instead of the shell. On first load with a stored token, show a neutral splash while
  // it validates; with NO stored token, show the gate immediately (no white-screen, and
  // no working-looking-but-401ing shell).
  const authPending = auth.isPending;
  // A network failure with a stored token means the daemon is unreachable, NOT that the
  // operator is signed out. Keep the token and show the honest unreachable state; the
  // auth query re-probes on an interval and the shell recovers automatically.
  const daemonUnreachable = auth.isError && isDaemonUnreachableError(auth.error) && hasStoredTokenSync();
  const signedOut = (auth.isError && !daemonUnreachable) || (authPending && !hasStoredTokenSync());
  const showSplash = authPending && !auth.isError && hasStoredTokenSync();

  // The daemon-unreachable gate promises the operator will "pick up where it left
  // off" once the daemon comes back — that's only true if the workspace underneath
  // stays mounted through the outage. Render it as an overlay ON TOP of the still-
  // mounted (and inert, so it can't be typed into or clicked while hidden) workspace
  // instead of early-returning in its place; a remount would reset the selected
  // session and discard a half-typed steer/follow-up draft.
  if (signedOut) {
    return (
      <AppShell view={view} onNavigate={handleNavigate}>
        <SignedOutGate />
      </AppShell>
    );
  }

  if (showSplash) {
    return (
      <AppShell view={view} onNavigate={handleNavigate}>
        <div className="app-splash" role="status" aria-live="polite">
          <img className="app-splash__mark" src="/goodvibes-icon.png" alt="" aria-hidden="true" />
          <span>Signing in…</span>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell view={view} onNavigate={handleNavigate}>
    <div className="app-shell-root">
    {daemonUnreachable && (
      <div className="daemon-gate-overlay">
        <DaemonUnreachableGate
          detail={formatError(auth.error)}
          retrying={auth.isFetching}
          onRetry={() => void auth.refetch()}
        />
      </div>
    )}
    <div
      className={sidebarCollapsed ? 'app-shell sidebar-collapsed' : 'app-shell'}
      inert={daemonUnreachable || undefined}
      aria-hidden={daemonUnreachable || undefined}
    >
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
          {views.map((navItem) => {
            const Icon = navItem.icon;
            return (
              <button
                key={navItem.id}
                className={navItem.id === activeView ? 'nav-item active' : 'nav-item'}
                type="button"
                onClick={() => setView(navItem.id)}
              >
                <span className="nav-icon"><Icon size={18} /></span>
                <span className="nav-copy">
                  <strong>{navItem.label}</strong>
                  <small>{navItem.short}</small>
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
                  setSession('', { replace: true });
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
                        setSession(id, { replace: true });
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

      {/* Overlay scrim for mobile: tap-outside-to-close the sidebar.
          CSS (.app-shell:not(.sidebar-collapsed) .sidebar-scrim) makes it
          visible only at ≤980px when the sidebar is open. */}
      <div
        className="sidebar-scrim"
        aria-hidden="true"
        onClick={() => setSidebarCollapsed(true)}
      />

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
            <button className="icon-button" type="button" title="Auth and settings" onClick={() => setView('admin')}>
              <KeyRound size={18} />
            </button>
            <button className="icon-button" type="button" title="Admin" onClick={() => setView('admin')}>
              <Settings size={18} />
            </button>
          </div>
        </header>

        {realtimeError && <div className="banner warning"><Plug size={16} /> {realtimeError}</div>}
        {sessionRealtime.error && <div className="banner warning"><Plug size={16} /> {sessionRealtime.error}</div>}
        {deleteChat.error && !isSessionNotFoundError(deleteChat.error) && (
          <div className="banner warning"><Plug size={16} /> {formatError(deleteChat.error)}</div>
        )}

        <section className="view-frame">
          {activeView === 'chat' && (
            <ChatView
              activeSessionId={activeChatSessionId}
              sessionItems={chatSessionItems}
              onActiveSessionChange={(sessionId) => {
                setSession(sessionId, { replace: true });
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
          {activeView === 'sessions' && <SessionsView />}
          {activeView === 'knowledge' && <KnowledgeView />}
          {activeView === 'providers' && <ProvidersView />}
          {activeView === 'admin' && <AdminView realtimeError={realtimeError} />}
        </section>
      </main>
    </div>
    </div>
    </AppShell>
  );
}
