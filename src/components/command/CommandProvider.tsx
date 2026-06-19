/**
 * CommandProvider — WS1 Command System
 *
 * Mounts the CommandPalette and ShortcutCheatsheet, wires ⌘K / ? hotkeys,
 * and registers the default navigation commands.
 *
 * Integration phase usage:
 *   import CommandProvider from './components/command/CommandProvider';
 *   // In App.tsx (or shell wrapper), wrap children:
 *   <CommandProvider onNavigate={setActiveView}>
 *     {children}
 *   </CommandProvider>
 *
 * Or — if you just want to mount the command system at root without wrapping:
 *   <CommandProvider onNavigate={setActiveView} />
 *
 * onNavigate receives a view id: 'chat' | 'knowledge' | 'providers' | 'admin'
 * and a optional newChat boolean for "New chat" command.
 */

import { useCallback, useEffect, useState } from 'react';
import '../../styles/components/command.css';
import { registerCommand, unregisterCommand } from '../../lib/commands';
import { useHotkeys } from '../../hooks/useHotkeys';
import { CommandPalette } from './CommandPalette';
import { ShortcutCheatsheet } from './ShortcutCheatsheet';

export type ViewId = 'chat' | 'knowledge' | 'providers' | 'admin';

interface CommandProviderProps {
  /**
   * Called when a navigation command fires.
   * Integration phase wires this to App's setActiveView.
   */
  onNavigate?: (view: ViewId, options?: { newChat?: boolean }) => void;
  children?: React.ReactNode;
}

export default function CommandProvider({ onNavigate, children }: CommandProviderProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const openCheatsheet = useCallback(() => setCheatsheetOpen(true), []);
  const closeCheatsheet = useCallback(() => setCheatsheetOpen(false), []);

  // Register default navigation commands
  useEffect(() => {
    registerCommand({
      id: 'nav.chat',
      title: 'Go to Chat',
      group: 'navigation',
      keywords: ['chat', 'messages', 'live'],
      shortcut: 'g c',
      run: () => onNavigate?.('chat'),
    });
    registerCommand({
      id: 'nav.knowledge',
      title: 'Go to Knowledge',
      group: 'navigation',
      keywords: ['knowledge', 'wiki', 'docs'],
      shortcut: 'g k',
      run: () => onNavigate?.('knowledge'),
    });
    registerCommand({
      id: 'nav.providers',
      title: 'Go to Providers',
      group: 'navigation',
      keywords: ['providers', 'models', 'llm', 'ai'],
      shortcut: 'g p',
      run: () => onNavigate?.('providers'),
    });
    registerCommand({
      id: 'nav.admin',
      title: 'Go to Admin',
      group: 'navigation',
      keywords: ['admin', 'settings', 'auth', 'secure'],
      shortcut: 'g a',
      run: () => onNavigate?.('admin'),
    });
    registerCommand({
      id: 'chat.new',
      title: 'New Chat',
      group: 'chat',
      keywords: ['new', 'create', 'session'],
      shortcut: 'mod+shift+n',
      run: () => onNavigate?.('chat', { newChat: true }),
    });
    registerCommand({
      id: 'system.palette',
      title: 'Open Command Palette',
      group: 'system',
      keywords: ['command', 'palette', 'search'],
      shortcut: 'mod+k',
      run: openPalette,
    });
    registerCommand({
      id: 'system.shortcuts',
      title: 'Show Keyboard Shortcuts',
      group: 'system',
      keywords: ['shortcuts', 'hotkeys', 'help', 'cheatsheet'],
      shortcut: '?',
      run: openCheatsheet,
    });

    return () => {
      unregisterCommand('nav.chat');
      unregisterCommand('nav.knowledge');
      unregisterCommand('nav.providers');
      unregisterCommand('nav.admin');
      unregisterCommand('chat.new');
      unregisterCommand('system.palette');
      unregisterCommand('system.shortcuts');
    };
  }, [onNavigate, openPalette, openCheatsheet]);

  // Global hotkeys
  useHotkeys([
    {
      combo: 'mod+k',
      handler: () => setPaletteOpen((open) => !open),
      // Must fire even when the palette's own search input is focused (toggle/close)
      allowInInput: true,
    },
    {
      combo: '?',
      handler: () => setCheatsheetOpen((open) => !open),
    },
    // NOTE: Escape is intentionally NOT registered here globally.
    // Each overlay (CommandPalette, ShortcutCheatsheet) owns its own Escape
    // handler via onKeyDown so dismiss logic stays within the overlay's
    // event chain and does not interfere with other Escape consumers.
    // Sequence nav shortcuts
    { combo: 'g c', handler: () => { onNavigate?.('chat'); } },
    { combo: 'g k', handler: () => { onNavigate?.('knowledge'); } },
    { combo: 'g p', handler: () => { onNavigate?.('providers'); } },
    { combo: 'g a', handler: () => { onNavigate?.('admin'); } },
    {
      combo: 'mod+shift+n',
      handler: () => { onNavigate?.('chat', { newChat: true }); },
      allowInInput: true,
    },
  ]);

  return (
    <>
      {children}
      <CommandPalette open={paletteOpen} onClose={closePalette} />
      <ShortcutCheatsheet open={cheatsheetOpen} onClose={closeCheatsheet} />
    </>
  );
}
