import { describe, expect, test } from 'bun:test';
import {
  PERMISSION_MODES,
  currentPermissionMode,
  isPermissionMode,
  permissionModeLabel,
} from './permission-mode';

describe('isPermissionMode', () => {
  test('recognizes every value of the SDK PermissionMode enum', () => {
    for (const mode of PERMISSION_MODES) expect(isPermissionMode(mode)).toBe(true);
  });

  test('rejects an unknown string', () => {
    expect(isPermissionMode('yolo')).toBe(false);
    expect(isPermissionMode('')).toBe(false);
  });
});

describe('permissionModeLabel', () => {
  test('gives plain-language labels for the known modes', () => {
    expect(permissionModeLabel('prompt')).toBe('Normal');
    expect(permissionModeLabel('allow-all')).toBe('Auto');
    expect(permissionModeLabel('plan')).toBe('Plan');
    expect(permissionModeLabel('accept-edits')).toBe('Accept edits');
    expect(permissionModeLabel('custom')).toBe('Custom');
  });

  test('an unrecognized mode renders verbatim, never dropped', () => {
    expect(permissionModeLabel('future-mode')).toBe('future-mode');
  });

  test('an absent mode renders as Unknown, never a guessed default', () => {
    expect(permissionModeLabel('')).toBe('Unknown');
  });
});

describe('currentPermissionMode', () => {
  test('reads permissions.mode out of a config.get() response', () => {
    expect(currentPermissionMode({ permissions: { mode: 'plan', backgroundAgents: 'inherit' } })).toBe('plan');
  });

  test('returns empty string when the daemon config tree has no permissions section', () => {
    expect(currentPermissionMode({ danger: { mode: 'restricted' } })).toBe('');
  });

  test('returns empty string for a non-object response, never throws', () => {
    expect(currentPermissionMode(null)).toBe('');
    expect(currentPermissionMode(undefined)).toBe('');
    expect(currentPermissionMode('nope')).toBe('');
  });
});
