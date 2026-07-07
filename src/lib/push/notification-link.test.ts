import { describe, expect, test } from 'bun:test';
import { linkForNotification } from './notification-link';

describe('linkForNotification', () => {
  test('an approval push deep-links to the approvals view', () => {
    expect(linkForNotification({ kind: 'approval', approvalId: 'apr-1' })).toBe('/?view=approvals-tasks');
  });

  test('an explicit in-app url is honored', () => {
    expect(linkForNotification({ url: '/?view=sessions' })).toBe('/?view=sessions');
  });

  test('an off-site (non-relative) url is refused, falling back to the app root', () => {
    expect(linkForNotification({ url: 'https://evil.example/phish' })).toBe('/');
  });

  test('unknown / empty data falls back to the app root, never a dead tap', () => {
    expect(linkForNotification({})).toBe('/');
    expect(linkForNotification(undefined)).toBe('/');
    expect(linkForNotification(null)).toBe('/');
  });
});
