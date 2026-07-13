/**
 * approvals.ts — unit coverage for the decision-trail helpers.
 *
 * The SDK's approval record carries a required `audit` array
 * (SharedApprovalAuditRecord, packages/sdk/src/platform/control-plane/
 * approval-broker.ts) that this client's hand-typed ApprovalRecord previously
 * omitted entirely. `audit` is optional on this client's type because
 * invokeMethod reads the wire response as-is with no runtime schema
 * validation — a mixed-version or pre-audit daemon record may genuinely omit
 * it, and that must read as "no trail recorded", never as an error or a
 * fabricated one.
 */
import { describe, expect, test } from 'bun:test';
import type { ApprovalAuditRecord, ApprovalRecord } from './goodvibes';
import {
  attributionLabel,
  auditEntryLabel,
  auditTrail,
  isDurableRememberTier,
  readExecPromptAsk,
  readRememberOptions,
  recordedRememberTier,
} from './approvals';

function baseRecord(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    id: 'appr-1',
    callId: 'call-1',
    status: 'approved',
    request: {
      callId: 'call-1',
      tool: 'exec',
      args: {},
      category: 'execute',
      analysis: { classification: 'exec', riskLevel: 'medium', summary: 'run a command', reasons: [] },
    },
    createdAt: 100,
    updatedAt: 100,
    metadata: {},
    ...overrides,
  };
}

describe('auditTrail', () => {
  test('returns the audit array verbatim when present', () => {
    const audit: ApprovalAuditRecord[] = [
      { id: 'a1', action: 'created', actor: 'agent-1', createdAt: 100 },
      { id: 'a2', action: 'approved', actor: 'operator', createdAt: 110 },
    ];
    expect(auditTrail(baseRecord({ audit }))).toEqual(audit);
  });

  test('returns an empty array (never undefined/null) when audit is absent', () => {
    const record = baseRecord();
    expect('audit' in record).toBe(false);
    expect(auditTrail(record)).toEqual([]);
  });

  test('returns an empty array when audit is present but empty', () => {
    expect(auditTrail(baseRecord({ audit: [] }))).toEqual([]);
  });
});

describe('auditEntryLabel', () => {
  test('renders action + actor', () => {
    const entry: ApprovalAuditRecord = { id: 'a1', action: 'created', actor: 'agent-1', createdAt: 100 };
    expect(auditEntryLabel(entry)).toBe('created by agent-1');
  });

  test('renders the actor surface in parentheses when present', () => {
    const entry: ApprovalAuditRecord = { id: 'a1', action: 'claimed', actor: 'operator', actorSurface: 'webui', createdAt: 100 };
    expect(auditEntryLabel(entry)).toBe('claimed by operator (webui)');
  });

  test('appends the note after a colon when present', () => {
    const entry: ApprovalAuditRecord = {
      id: 'a1', action: 'denied', actor: 'operator', actorSurface: 'webui', createdAt: 100, note: 'too risky',
    };
    expect(auditEntryLabel(entry)).toBe('denied by operator (webui): too risky');
  });

  test('omits surface and note segments cleanly when both are absent', () => {
    const entry: ApprovalAuditRecord = { id: 'a1', action: 'expired', actor: 'approval-broker', createdAt: 100 };
    expect(auditEntryLabel(entry)).toBe('expired by approval-broker');
  });
});

describe('readRememberOptions', () => {
  test('reads well-formed options verbatim and drops malformed entries', () => {
    const record = baseRecord({
      request: {
        callId: 'call-1', tool: 'bash', args: {}, category: 'execute',
        analysis: { classification: 'exec', riskLevel: 'medium', summary: 's', reasons: [] },
        rememberOptions: [
          { tier: 'command-class', label: 'every bun command', detail: 'bun ...' },
          { tier: 'exact' } as never,
          'nonsense' as never,
        ],
      },
    });
    expect(readRememberOptions(record)).toEqual([
      { tier: 'command-class', label: 'every bun command', detail: 'bun ...' },
    ]);
  });

  test('a pre-tier record (no rememberOptions) offers none', () => {
    expect(readRememberOptions(baseRecord())).toEqual([]);
  });
});

describe('isDurableRememberTier', () => {
  test('the four persisting tiers are durable; session is not', () => {
    for (const tier of ['exact', 'command-class', 'path', 'tool']) expect(isDurableRememberTier(tier)).toBe(true);
    expect(isDurableRememberTier('session')).toBe(false);
    expect(isDurableRememberTier('')).toBe(false);
  });
});

describe('readExecPromptAsk', () => {
  test('detects the exec-prompt ask by attribution kind and reads command/prompt/recentOutput', () => {
    const record = baseRecord({
      status: 'pending',
      request: {
        callId: 'c', tool: 'exec:prompt',
        args: { command: 'ssh host', prompt: 'Continue?', recentOutput: 'fingerprint' },
        category: 'execute',
        analysis: { classification: 'exec-terminal-prompt', riskLevel: 'medium', summary: 's', reasons: [] },
        attribution: { kind: 'exec-prompt', command: 'ssh host', prompt: 'Continue?' },
      },
    });
    expect(readExecPromptAsk(record)).toEqual({ command: 'ssh host', prompt: 'Continue?', recentOutput: 'fingerprint' });
  });

  test('falls back to the attribution strings when args are partial', () => {
    const record = baseRecord({
      status: 'pending',
      request: {
        callId: 'c', tool: 'exec:prompt', args: {}, category: 'execute',
        analysis: { classification: 'exec-terminal-prompt', riskLevel: 'medium', summary: 's', reasons: [] },
        attribution: { kind: 'exec-prompt', command: 'ssh host', prompt: 'Continue?' },
      },
    });
    expect(readExecPromptAsk(record)).toEqual({ command: 'ssh host', prompt: 'Continue?', recentOutput: '' });
  });

  test('a non-exec-prompt ask reads as null', () => {
    expect(readExecPromptAsk(baseRecord())).toBeNull();
  });
});

describe('recordedRememberTier', () => {
  test('reports only what the daemon recorded on the decision', () => {
    expect(recordedRememberTier(baseRecord({ decision: { approved: true, rememberTier: 'path' } }))).toBe('path');
    expect(recordedRememberTier(baseRecord({ decision: { approved: true } }))).toBeNull();
    expect(recordedRememberTier(baseRecord())).toBeNull();
    expect(recordedRememberTier(undefined)).toBeNull();
  });
});

describe('attributionLabel — exec-prompt', () => {
  test('names the waiting command', () => {
    expect(attributionLabel({ kind: 'exec-prompt', command: 'ssh host', prompt: 'Continue?' }))
      .toBe('Command waiting on its terminal: ssh host');
  });
});
