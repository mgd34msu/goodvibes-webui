import { describe, expect, test } from 'bun:test';
import { formatError, isSessionNotFoundError } from './errors';

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
});
