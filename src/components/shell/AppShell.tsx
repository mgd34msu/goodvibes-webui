/**
 * AppShell — Phase-2 composition module.
 *
 * Nests all UX provider modules into ONE mountable shell, removing the
 * serialization bottleneck from App.tsx. App.tsx edit is exactly 3 lines:
 *
 * ```tsx
 * // 1. Add import:
 * import AppShell from './components/shell/AppShell';
 * // 2. Add hook call inside App (before JSX):
 * const { view, setView } = useUrlState();
 * // 3. Wrap children with AppShell:
 * return <AppShell view={view} onNavigate={setView}>{children}</AppShell>;
 * ```
 *
 * Provider nesting (outermost → innermost):
 *   ThemeProvider → ErrorBoundary → ToastProvider → CommandProvider → PeekProvider
 *
 * Always-on chrome rendered inside PeekProvider:
 *   <ToastViewport />, <StatusStrip />, <AnnouncerRegion />
 *
 * AppShell registers two commands not covered by CommandProvider:
 *   - system.toggleTheme  (group: 'system')
 *   - system.toggleDensity (group: 'view')
 *
 * CommandProvider already registers nav + chat + system.palette + system.shortcuts;
 * those are NOT re-registered here to prevent double-registration.
 */

import { useEffect, type ReactNode } from 'react';
import { ThemeProvider, useTheme } from '../../hooks/useTheme';
import ErrorBoundary from '../feedback/ErrorBoundary';
import { ToastProvider } from '../../lib/toast';
import { ToastViewport } from '../toast/ToastViewport';
import CommandProvider from '../command/CommandProvider';
import { PeekProvider } from '../peek/PeekPanel';
import { StatusStrip } from '../status/StatusStrip';
import { useAnnouncer } from '../../hooks/useAnnouncer';
import { registerCommand, unregisterCommand } from '../../lib/commands';
import type { ViewId } from '../../lib/router';

// ─── Props ─────────────────────────────────────────────────────────────────

export interface AppShellProps {
  children: ReactNode;
  /**
   * The currently active view. Read from useUrlState() in App.
   * Passed through to CommandProvider.onNavigate so palette commands
   * can trigger view transitions.
   */
  view: ViewId;
  /**
   * Navigation callback. Wire to App's navigate handler:
   *   <AppShell view={view} onNavigate={handleNavigate}>
   *
   * Receives an optional options bag; when options.newChat is true the
   * caller should start a fresh chat draft in addition to switching to
   * the chat view.
   */
  onNavigate: (view: ViewId, options?: { newChat?: boolean }) => void;
}

// ─── Inner shell (rendered inside ThemeProvider so useTheme is available) ──

interface InnerShellProps {
  children: ReactNode;
  onNavigate: (view: ViewId, options?: { newChat?: boolean }) => void;
}

function InnerShell({ children, onNavigate }: InnerShellProps) {
  const { toggleTheme, density, setDensity } = useTheme();
  const { AnnouncerRegion } = useAnnouncer();

  // Register AppShell-owned commands (theme + density toggles).
  // Guard: registerCommand is idempotent on id — if this runs twice in
  // StrictMode the second call silently overwrites with the same def.
  // Cleanup unregisters so they are removed on unmount.
  useEffect(() => {
    registerCommand({
      id: 'system.toggleTheme',
      title: 'Toggle Theme',
      group: 'system',
      keywords: ['theme', 'dark', 'light', 'color'],
      shortcut: 'mod+shift+t',
      run: toggleTheme,
    });
    registerCommand({
      id: 'view.toggleDensity',
      title: 'Toggle Density',
      group: 'view',
      keywords: ['density', 'compact', 'comfortable', 'spacious'],
      run: () => setDensity(density === 'compact' ? 'default' : 'compact'),
    });

    return () => {
      unregisterCommand('system.toggleTheme');
      unregisterCommand('view.toggleDensity');
    };
    // Re-register if theme/density callbacks change identity.
  }, [toggleTheme, density, setDensity]);

  return (
    <ErrorBoundary>
      <ToastProvider>
        <CommandProvider onNavigate={onNavigate}>
          <PeekProvider>
            {children}
            <ToastViewport />
            <StatusStrip />
            <AnnouncerRegion />
          </PeekProvider>
        </CommandProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}

// ─── AppShell (public export) ───────────────────────────────────────────────

export default function AppShell({ children, view: _view, onNavigate }: AppShellProps) {
  // _view is accepted but not used internally — CommandProvider receives
  // onNavigate and fires it; the current view is owned by App via useUrlState.
  // It is in the prop signature so App.tsx has a clear contract and can
  // conditionally pass data-view attributes or similar in a future iteration.
  return (
    <ThemeProvider>
      <InnerShell onNavigate={onNavigate}>
        {children}
      </InnerShell>
    </ThemeProvider>
  );
}
