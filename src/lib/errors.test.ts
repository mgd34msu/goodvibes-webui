import { describe, expect, test } from 'bun:test';
import { formatError, isSessionNotFoundError, isAuthExpiredError } from './errors';

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
});
