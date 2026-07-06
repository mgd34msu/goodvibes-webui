import { describe, expect, test } from 'bun:test';
import type { FleetProcessNode } from './goodvibes';
import {
  activeCount,
  buildFleetRows,
  costLabel,
  formatDurationMs,
  isAwaitingApprovalState,
  isKnownProcessKind,
  isKnownProcessState,
  isStalledState,
  isTerminalState,
  kindLabel,
  stateLabel,
} from './fleet';

function node(overrides: Partial<FleetProcessNode> & { id: string }): FleetProcessNode {
  return {
    kind: 'agent',
    label: overrides.id,
    state: 'thinking',
    elapsedMs: 0,
    costUsd: null,
    costState: 'unpriced',
    capabilities: { interruptible: true, killable: true, pausable: false, resumable: false, steerable: true },
    ...overrides,
  };
}

describe('isKnownProcessKind / isKnownProcessState', () => {
  test('known kinds/states return true', () => {
    expect(isKnownProcessKind('agent')).toBe(true);
    expect(isKnownProcessKind('workflow')).toBe(true);
    expect(isKnownProcessState('thinking')).toBe(true);
    expect(isKnownProcessState('stalled')).toBe(true);
  });

  test('an unknown future kind/state is NOT known — rendered verbatim, not dropped', () => {
    expect(isKnownProcessKind('quantum-process')).toBe(false);
    expect(isKnownProcessState('quantum-state')).toBe(false);
  });
});

describe('kindLabel / stateLabel', () => {
  test('empty string falls back to "unknown"', () => {
    expect(kindLabel('')).toBe('unknown');
    expect(stateLabel('')).toBe('unknown');
  });

  test('non-empty values render verbatim', () => {
    expect(kindLabel('wrfc-chain')).toBe('wrfc-chain');
    expect(stateLabel('awaiting-approval')).toBe('awaiting-approval');
  });
});

describe('isTerminalState / isStalledState / isAwaitingApprovalState', () => {
  test('done/failed/killed/interrupted are terminal', () => {
    for (const s of ['done', 'failed', 'killed', 'interrupted']) expect(isTerminalState(s)).toBe(true);
  });

  test('thinking/executing-tool/stalled are NOT terminal', () => {
    for (const s of ['thinking', 'executing-tool', 'stalled', 'awaiting-approval']) expect(isTerminalState(s)).toBe(false);
  });

  test('stalled/awaiting-approval flags', () => {
    expect(isStalledState('stalled')).toBe(true);
    expect(isStalledState('thinking')).toBe(false);
    expect(isAwaitingApprovalState('awaiting-approval')).toBe(true);
    expect(isAwaitingApprovalState('stalled')).toBe(false);
  });
});

describe('costLabel', () => {
  test('unpriced state never shows a dollar figure, even if costUsd is somehow set', () => {
    expect(costLabel(node({ id: 'n1', costState: 'unpriced', costUsd: 1.23 }))).toBe('unpriced');
  });

  test('priced state with a costUsd shows a dollar figure', () => {
    expect(costLabel(node({ id: 'n1', costState: 'priced', costUsd: 1.5 }))).toBe('$1.50');
  });

  test('priced state with a sub-dollar amount shows 4 decimal places', () => {
    expect(costLabel(node({ id: 'n1', costState: 'priced', costUsd: 0.0032 }))).toBe('$0.0032');
  });

  test('estimated state prefixes with a tilde', () => {
    expect(costLabel(node({ id: 'n1', costState: 'estimated', costUsd: 2 }))).toBe('~$2.00');
  });

  test('estimated state with no costUsd yet shows "estimating…" rather than a fake number', () => {
    expect(costLabel(node({ id: 'n1', costState: 'estimated', costUsd: null }))).toBe('estimating…');
  });
});

describe('formatDurationMs', () => {
  test('formats seconds', () => {
    expect(formatDurationMs(45_000)).toBe('45s');
  });

  test('formats minutes and seconds', () => {
    expect(formatDurationMs(125_000)).toBe('2m 5s');
  });

  test('formats hours and minutes', () => {
    expect(formatDurationMs(3_725_000)).toBe('1h 2m');
  });

  test('non-finite/negative/undefined is honestly "unknown", never 0s', () => {
    expect(formatDurationMs(undefined)).toBe('unknown');
    expect(formatDurationMs(-5)).toBe('unknown');
    expect(formatDurationMs(NaN)).toBe('unknown');
  });
});

describe('activeCount', () => {
  test('counts only non-terminal nodes', () => {
    const nodes = [
      node({ id: 'a', state: 'thinking' }),
      node({ id: 'b', state: 'done' }),
      node({ id: 'c', state: 'stalled' }),
      node({ id: 'd', state: 'killed' }),
    ];
    expect(activeCount(nodes)).toBe(2);
  });
});

describe('buildFleetRows', () => {
  test('a flat list with no parentId is all roots at depth 0', () => {
    const nodes = [node({ id: 'a' }), node({ id: 'b' })];
    const rows = buildFleetRows(nodes);
    expect(rows.map((r) => r.depth)).toEqual([0, 0]);
    expect(rows.map((r) => r.node.id).sort()).toEqual(['a', 'b']);
  });

  test('children are nested immediately after their parent, at depth+1', () => {
    const nodes = [
      node({ id: 'root', startedAt: 100 }),
      node({ id: 'child', parentId: 'root', startedAt: 90 }),
      node({ id: 'grandchild', parentId: 'child', startedAt: 80 }),
    ];
    const rows = buildFleetRows(nodes);
    expect(rows.map((r) => r.node.id)).toEqual(['root', 'child', 'grandchild']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2]);
  });

  test('a parentId pointing outside the snapshot is treated as a root (not dropped)', () => {
    const nodes = [node({ id: 'orphan', parentId: 'not-in-snapshot' })];
    const rows = buildFleetRows(nodes);
    expect(rows).toHaveLength(1);
    expect(rows[0].depth).toBe(0);
  });

  test('roots and sibling groups sort newest-started-first', () => {
    const nodes = [
      node({ id: 'old-root', startedAt: 10 }),
      node({ id: 'new-root', startedAt: 20 }),
    ];
    const rows = buildFleetRows(nodes);
    expect(rows.map((r) => r.node.id)).toEqual(['new-root', 'old-root']);
  });

  test('a parentId cycle degrades to a flat list instead of hanging', () => {
    const nodes = [
      node({ id: 'a', parentId: 'b' }),
      node({ id: 'b', parentId: 'a' }),
    ];
    const rows = buildFleetRows(nodes);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.node.id).sort()).toEqual(['a', 'b']);
  });

  test('every node in the input appears exactly once in the output', () => {
    const nodes = [
      node({ id: 'r1' }),
      node({ id: 'r2' }),
      node({ id: 'c1', parentId: 'r1' }),
      node({ id: 'c2', parentId: 'r1' }),
      node({ id: 'gc1', parentId: 'c1' }),
    ];
    const rows = buildFleetRows(nodes);
    expect(rows).toHaveLength(nodes.length);
    expect(new Set(rows.map((r) => r.node.id)).size).toBe(nodes.length);
  });
});
