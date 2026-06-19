/**
 * command-groups — WS1 Command System
 *
 * Shared utilities for grouping commands by category.
 * Imported by CommandPalette and ShortcutCheatsheet to avoid duplication.
 */

import { type CommandDef } from './commands';

export interface GroupedCommands {
  group: string;
  commands: CommandDef[];
}

/** Human-readable labels for each CommandGroup value. */
export const GROUP_LABELS: Record<string, string> = {
  navigation: 'Navigation',
  chat: 'Chat',
  knowledge: 'Knowledge',
  providers: 'Providers',
  admin: 'Admin',
  view: 'View',
  system: 'System',
};

/**
 * Group a flat list of commands by their group property,
 * preserving insertion order of groups.
 */
export function buildGroups(commands: CommandDef[]): GroupedCommands[] {
  const groupMap = new Map<string, CommandDef[]>();
  for (const cmd of commands) {
    const existing = groupMap.get(cmd.group);
    if (existing) {
      existing.push(cmd);
    } else {
      groupMap.set(cmd.group, [cmd]);
    }
  }
  return Array.from(groupMap.entries()).map(([group, cmds]) => ({
    group,
    commands: cmds,
  }));
}
