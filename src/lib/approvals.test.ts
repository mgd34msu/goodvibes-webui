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
import { auditEntryLabel, auditTrail } from './approvals';

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
