import { describe, expect, test } from 'bun:test';
import {
  KNOWN_SESSION_KINDS,
  SESSION_UPDATE_WIRE_EVENT,
  SESSION_UPDATE_INTENT_MAP,
  sessionUpdateIntent,
  unionSessionFromRecord,
  unionSessionsFromListResponse,
  unionSessionsTotal,
  isKnownKind,
  kindLabel,
  projectLabel,
  statusLabel,
  isClosedStatus,
  canSteer,
  retentionLabel,
  sortUnionSessions,
} from './sessions-union';

// A fixture union covering every declared kind, an UNKNOWN future kind, a closed
// history record, and a record carrying the retention truncation marker.
const FIXTURE_UNION = {
  totals: { sessions: 137 },
  sessions: [
    { id: 's-tui', kind: 'tui', project: 'goodvibes-tui', title: 'TUI coding', status: 'active', updatedAt: 50, messageCount: 12 },
    { id: 's-agent', kind: 'agent', project: 'goodvibes-tui', title: 'Agent run', status: 'active', updatedAt: 40, messageCount: 3, activeAgentId: 'agent-1' },
    { id: 's-webui', kind: 'webui', project: 'goodvibes-webui', title: 'WebUI', status: 'active', updatedAt: 30, messageCount: 5 },
    { id: 's-auto', kind: 'automation', project: 'goodvibes-webui', title: 'Nightly', status: 'active', updatedAt: 20, messageCount: 8 },
    { id: 's-chat', kind: 'companion-chat', project: '', title: 'Phone chat', status: 'active', updatedAt: 60, messageCount: 2 },
    { id: 's-closed', kind: 'tui', project: 'goodvibes-tui', title: 'Old session', status: 'closed', updatedAt: 10, messageCount: 300, retainedMessageCount: 50 },
    { id: 's-future', kind: 'quantum-surface', project: 'lab', title: 'Future kind', status: 'active', updatedAt: 70, messageCount: 1 },
  ],
};

describe('SESSION_UPDATE intent map', () => {
  test('wire event constant is the un-domained name', () => {
    expect(SESSION_UPDATE_WIRE_EVENT).toBe('session-update');
  });

  test('maps concrete wire events to coarse intents (mirrors SDK map)', () => {
    expect(sessionUpdateIntent('session-created')).toBe('created');
    expect(sessionUpdateIntent('session-message-appended')).toBe('updated');
    expect(sessionUpdateIntent('session-reopened')).toBe('updated');
    expect(sessionUpdateIntent('session-input-delivered')).toBe('steered');
    expect(sessionUpdateIntent('session-message-forwarded')).toBe('steered');
    expect(sessionUpdateIntent('session-closed')).toBe('closed');
  });

  test('an unknown future wire event maps to null (caller invalidates defensively)', () => {
    expect(sessionUpdateIntent('session-teleported')).toBeNull();
  });

  test('intent map has exactly the four documented intents', () => {
    expect(Object.keys(SESSION_UPDATE_INTENT_MAP).sort()).toEqual(['closed', 'created', 'steered', 'updated']);
  });
});

describe('tolerant union extraction', () => {
  test('unwraps {totals, sessions} and normalizes every entry (all kinds render)', () => {
    const records = unionSessionsFromListResponse(FIXTURE_UNION);
    expect(records).toHaveLength(7);
    const kinds = records.map((r) => r.kind);
    for (const known of KNOWN_SESSION_KINDS) {
      // every known kind present in the fixture survives extraction
      if (FIXTURE_UNION.sessions.some((s) => s.kind === known)) {
        expect(kinds).toContain(known);
      }
    }
    // the UNKNOWN future kind is not dropped
    expect(kinds).toContain('quantum-surface');
  });

  test('unknown kind renders verbatim as a neutral-badge label, no throw', () => {
    const record = unionSessionFromRecord({ id: 'x', kind: 'quantum-surface' });
    expect(isKnownKind(record.kind)).toBe(false);
    expect(kindLabel(record.kind)).toBe('quantum-surface');
  });

  test('total is read from the totals envelope for the capped-list honesty note', () => {
    expect(unionSessionsTotal(FIXTURE_UNION)).toBe(137);
    expect(unionSessionsTotal({ sessions: [] })).toBeNull();
  });

  test('does not impose companion literal types — reads kind/status as open strings', () => {
    const record = unionSessionFromRecord({ id: 'a', kind: 'automation', status: 'closed' });
    expect(record.kind).toBe('automation');
    expect(record.status).toBe('closed');
  });

  test('garbage input never throws', () => {
    expect(() => unionSessionsFromListResponse(null)).not.toThrow();
    expect(() => unionSessionsFromListResponse('nope')).not.toThrow();
    expect(unionSessionFromRecord(42).id).toBe('');
  });
});

describe('retention honesty marker', () => {
  test('renders "N of M retained" only when retainedMessageCount < messageCount', () => {
    const record = unionSessionFromRecord({ id: 'r', messageCount: 300, retainedMessageCount: 50 });
    expect(retentionLabel(record)).toBe('50 of 300 retained');
  });

  test('absent retainedMessageCount → NO marker (fully retained, never infer loss)', () => {
    const record = unionSessionFromRecord({ id: 'r', messageCount: 12 });
    expect(record.retainedMessageCount).toBeNull();
    expect(retentionLabel(record)).toBeNull();
  });

  test('retainedMessageCount equal to messageCount → no marker', () => {
    const record = unionSessionFromRecord({ id: 'r', messageCount: 12, retainedMessageCount: 12 });
    expect(retentionLabel(record)).toBeNull();
  });
});

describe('badge labels', () => {
  test('projectLabel: absent project → "unknown"', () => {
    expect(projectLabel('')).toBe('unknown');
    expect(projectLabel('goodvibes-tui')).toBe('goodvibes-tui');
  });

  test('statusLabel: empty status falls back to "active"', () => {
    expect(statusLabel('')).toBe('active');
    expect(statusLabel('closed')).toBe('closed');
  });

  test('isClosedStatus is case-insensitive', () => {
    expect(isClosedStatus('closed')).toBe(true);
    expect(isClosedStatus('CLOSED')).toBe(true);
    expect(isClosedStatus('active')).toBe(false);
  });
});

describe('steer eligibility', () => {
  test('steer only when open AND an agent is bound', () => {
    expect(canSteer(unionSessionFromRecord({ id: 'a', status: 'active', activeAgentId: 'agent-1' }))).toBe(true);
  });

  test('no active agent → not steerable (offer follow-up instead)', () => {
    expect(canSteer(unionSessionFromRecord({ id: 'a', status: 'active' }))).toBe(false);
  });

  test('closed session → not steerable even with an agent id', () => {
    expect(canSteer(unionSessionFromRecord({ id: 'a', status: 'closed', activeAgentId: 'agent-1' }))).toBe(false);
  });
});

describe('sortUnionSessions', () => {
  test('sorts newest-first by updatedAt', () => {
    const records = unionSessionsFromListResponse(FIXTURE_UNION);
    const sorted = sortUnionSessions(records);
    expect(sorted[0].id).toBe('s-future'); // updatedAt 70, highest
    expect(sorted[sorted.length - 1].id).toBe('s-closed'); // updatedAt 10, lowest
  });
});
