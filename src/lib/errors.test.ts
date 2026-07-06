import { describe, expect, test } from 'bun:test';
import { formatError, isAuthExpiredError, isMethodUnavailableError, isSessionActiveError, isSessionNotFoundError } from './errors';

describe('error formatting', () => {
  test('includes transport status and hint when present', () => {
    const error = Object.assign(new Error('Login failed'), {
      category: 'authentication',
      hint: 'Check your authentication token or credentials.',
      transport: {
        status: 401,
        body: { error: 'invalid credentials' },
      },
    });

    expect(formatError(error)).toContain('Login failed');
    expect(formatError(error)).toContain('HTTP 401');
    expect(formatError(error)).toContain('authentication');
  });

  test('detects daemon session-not-found errors', () => {
    expect(isSessionNotFoundError({ body: { code: 'SESSION_NOT_FOUND', error: 'Session not found' } })).toBe(true);
    expect(isSessionNotFoundError(Object.assign(new Error('Request failed'), {
      transport: { body: { code: 'SESSION_NOT_FOUND' } },
    }))).toBe(true);
    expect(isSessionNotFoundError(new Error('Session not found'))).toBe(true);
  });

  test('detects a 401 / category:authentication as an expired-token error', () => {
    expect(isAuthExpiredError(Object.assign(new Error('Unauthorized'), { category: 'authentication' }))).toBe(true);
    expect(isAuthExpiredError(Object.assign(new Error('Unauthorized'), { status: 401 }))).toBe(true);
    expect(isAuthExpiredError(Object.assign(new Error('Unreachable'), {
      transport: { status: 401, category: 'authentication' },
    }))).toBe(true);
  });

  test('does not misclassify a network failure or a generic 500 as auth-expired', () => {
    expect(isAuthExpiredError(Object.assign(new Error('offline'), { category: 'network', status: 0 }))).toBe(false);
    expect(isAuthExpiredError(Object.assign(new Error('boom'), { status: 500 }))).toBe(false);
    expect(isAuthExpiredError(null)).toBe(false);
    expect(isAuthExpiredError(undefined)).toBe(false);
  });

  test('detects the honest 409 SESSION_ACTIVE delete-rejection (W5-W2, delete-means-delete)', () => {
    expect(isSessionActiveError({ body: { code: 'SESSION_ACTIVE', error: 'Session is active — close it, then delete.' } })).toBe(true);
    expect(isSessionActiveError(new Error('Session is active — close it, then delete.'))).toBe(true);
    expect(isSessionActiveError({ body: { code: 'SESSION_NOT_FOUND' } })).toBe(false);
  });

  test('distinguishes "method not registered on this daemon" from a normal 404 on a known resource', () => {
    expect(isMethodUnavailableError({
      status: 404,
      body: { error: 'Unknown gateway method' },
    })).toBe(true);
    // A genuine SESSION_NOT_FOUND is ALSO a 404 but is a different honest signal
    // (the resource doesn't exist, not "this daemon has never heard of this verb") —
    // isMethodUnavailableError must not conflate the two.
    expect(isMethodUnavailableError({ status: 404, body: { code: 'SESSION_NOT_FOUND', error: 'Session not found' } })).toBe(false);
    expect(isMethodUnavailableError({ status: 500, body: { error: 'Unknown gateway method' } })).toBe(false);
    expect(isMethodUnavailableError(undefined)).toBe(false);
  });

  // W6-C4: the daemon now carries code: 'METHOD_NOT_FOUND' on this 404 (SDKErrorCodes.
  // METHOD_NOT_FOUND). Code-first, message-fallback — the same pattern as
  // isSessionClosedError/isSessionActiveError above.
  test('recognizes the machine code METHOD_NOT_FOUND (an upgraded daemon), no message-sniff needed', () => {
    expect(isMethodUnavailableError({
      status: 404,
      body: { code: 'METHOD_NOT_FOUND', error: 'Unknown gateway method: sessions.delete' },
    })).toBe(true);
    // Wire shape via transport (the SDK client's real error envelope), not a bare body.
    expect(isMethodUnavailableError(Object.assign(new Error('Request failed'), {
      transport: { status: 404, body: { code: 'METHOD_NOT_FOUND' } },
    }))).toBe(true);
  });

  test('back-compat: an un-upgraded daemon (pre-W6-C4, npm 0.38) with no code field still falls back to the message match', () => {
    expect(isMethodUnavailableError({
      status: 404,
      body: { error: 'Unknown gateway method: sessions.delete' },
    })).toBe(true);
  });
});
