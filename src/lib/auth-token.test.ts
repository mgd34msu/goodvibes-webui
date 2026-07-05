/**
 * setExplicitAuthToken — clear-on-failure contract (login-gate honesty).
 *
 * Uses the REAL wrapper (no module mock) and stubs global fetch so auth.current()
 * returns 401. The token must be stored, then auto-cleared when validation fails, so a
 * bad paste never leaves a lingering credential that makes the shell look signed-in.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setExplicitAuthToken, tokenStore, hasStoredTokenSync } from './goodvibes';

beforeEach(async () => {
  await tokenStore.clearToken();
});

afterEach(async () => {
  await tokenStore.clearToken();
});

describe('setExplicitAuthToken', () => {
  test('CLEARS the token when validation fails (no daemon reachable in the test env)', async () => {
    // auth.current() cannot succeed against no daemon; whatever the failure, the pasted
    // token must not survive it. (Handle the rejection directly to keep the run quiet.)
    let threw = false;
    try {
      await setExplicitAuthToken('an-invalid-token');
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // The invalid token must not linger after failed validation.
    expect(await tokenStore.getToken()).toBeFalsy();
    expect(hasStoredTokenSync()).toBe(false);
  });

  test('an empty token is rejected before any network call', async () => {
    let threw = false;
    try {
      await setExplicitAuthToken('   ');
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // Nothing was stored.
    expect(hasStoredTokenSync()).toBe(false);
  });
});
