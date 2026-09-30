import { describe, expect, test } from 'bun:test';
import { activityPhrase, connectionPhrase, connectionTone, latencyPhrase } from './AccountMenu';

describe('account menu wording: plain words, never transport jargon', () => {
  test('connection phrase per state', () => {
    expect(connectionPhrase({ connection: 'connected', route: 'direct' })).toBe('Connected to your daemon');
    expect(connectionPhrase({ connection: 'connected', route: 'relay' })).toBe('Connected to your daemon through the relay');
    expect(connectionPhrase({ connection: 'reconnecting', route: null })).toBe('Reconnecting to your daemon');
    expect(connectionPhrase({ connection: 'down', route: null })).toBe('Cannot reach your daemon');
  });

  test('the avatar dot tone follows connection and access', () => {
    expect(connectionTone({ connection: 'connected', working: 'working' })).toBe('ok');
    expect(connectionTone({ connection: 'connected', working: 'blocked' })).toBe('warn');
    expect(connectionTone({ connection: 'reconnecting', working: 'working' })).toBe('warn');
    expect(connectionTone({ connection: 'down', working: 'unknown' })).toBe('bad');
  });

  test('latency reads in milliseconds with a space', () => {
    expect(latencyPhrase(null)).toBe('');
    expect(latencyPhrase(4)).toBe('<10 ms');
    expect(latencyPhrase(31.4)).toBe('31 ms');
    expect(latencyPhrase(1500)).toBe('1.5 s');
  });

  test('activity line: turns, queue and live updates in words', () => {
    expect(activityPhrase({ activeTurns: 1, queuedTasks: 0, sse: 'active', working: 'working' })).toBe('1 turn running · live updates on');
    expect(activityPhrase({ activeTurns: 2, queuedTasks: 3, sse: 'error', working: 'working' })).toBe('2 turns running · 3 queued · live updates paused');
    expect(activityPhrase({ activeTurns: 0, queuedTasks: 0, sse: 'relay-unsupported', working: 'blocked' }))
      .toBe('Nothing running · no live updates over the relay · this sign-in cannot read data');
  });
});
