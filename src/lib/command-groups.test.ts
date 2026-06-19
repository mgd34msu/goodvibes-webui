import { describe, expect, test } from 'bun:test';
import { GROUP_LABELS, buildGroups } from './command-groups';
import type { CommandDef } from './commands';

// Minimal stubs — only the shape that buildGroups reads (group field)
function cmd(id: string, group: string): CommandDef {
  return { id, group, label: id, handler: () => {} } as unknown as CommandDef;
}

describe('GROUP_LABELS', () => {
  test('contains expected keys', () => {
    expect(GROUP_LABELS.navigation).toBe('Navigation');
    expect(GROUP_LABELS.chat).toBe('Chat');
    expect(GROUP_LABELS.admin).toBe('Admin');
    expect(GROUP_LABELS.system).toBe('System');
  });
});

describe('buildGroups', () => {
  test('returns empty array for empty input', () => {
    expect(buildGroups([])).toEqual([]);
  });

  test('single command produces one group with that command', () => {
    const result = buildGroups([cmd('a', 'chat')]);
    expect(result).toHaveLength(1);
    expect(result[0]!.group).toBe('chat');
    expect(result[0]!.commands).toHaveLength(1);
  });

  test('two commands in the same group are placed in the same group entry', () => {
    const result = buildGroups([cmd('a', 'chat'), cmd('b', 'chat')]);
    expect(result).toHaveLength(1);
    expect(result[0]!.commands).toHaveLength(2);
  });

  test('two commands in different groups produce two group entries', () => {
    const result = buildGroups([cmd('a', 'navigation'), cmd('b', 'chat')]);
    expect(result).toHaveLength(2);
    const groups = result.map(g => g.group);
    expect(groups).toContain('navigation');
    expect(groups).toContain('chat');
  });

  test('preserves insertion order of groups', () => {
    const input = [
      cmd('a', 'system'),
      cmd('b', 'chat'),
      cmd('c', 'system'),
      cmd('d', 'navigation'),
    ];
    const result = buildGroups(input);
    expect(result.map(g => g.group)).toEqual(['system', 'chat', 'navigation']);
  });

  test('commands within a group preserve their order', () => {
    const a = cmd('a', 'chat');
    const b = cmd('b', 'chat');
    const c = cmd('c', 'chat');
    const result = buildGroups([a, b, c]);
    expect(result[0]!.commands.map(c => c.id)).toEqual(['a', 'b', 'c']);
  });

  test('group key not in GROUP_LABELS is still preserved as-is', () => {
    const result = buildGroups([cmd('x', 'unknown-group')]);
    expect(result[0]!.group).toBe('unknown-group');
  });
});
