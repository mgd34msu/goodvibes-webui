import { describe, expect, test } from 'bun:test';
import { followUpDisposition } from './session-followup';

describe('follow-up disposition', () => {
  test('treats spawned turns as running', () => {
    expect(followUpDisposition({ mode: 'spawn', input: { state: 'spawned' } }).state).toBe('running');
    expect(followUpDisposition({ mode: 'continued-live', agentId: 'agent-1' }).state).toBe('running');
  });

  test('treats queued follow-up as queued', () => {
    expect(followUpDisposition({ mode: 'queued-follow-up', input: { state: 'queued' } }).state).toBe('queued');
  });

  test('preserves rejection errors', () => {
    expect(followUpDisposition({ mode: 'rejected', input: { state: 'failed', error: 'no route' } })).toEqual({
      state: 'rejected',
      error: 'no route',
    });
  });
});
