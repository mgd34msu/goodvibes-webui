import { describe, expect, test } from 'bun:test';
import { deriveProviderStatus, providerHeaderLabel, providerStatusLabel } from './provider-status';
import { bestStatus } from './object';

describe('deriveProviderStatus — worst-wins freshness roll-up', () => {
  test('a single healthy route reads healthy, not "unknown"', () => {
    const status = deriveProviderStatus({
      routes: [{ route: 'api-key', label: 'API Key', configured: true, freshness: 'healthy' }],
    });
    expect(status.freshness).toBe('healthy');
    expect(providerStatusLabel(status)).toBe('healthy');
  });

  test('expiring, expired, and pending each render their own honest label', () => {
    expect(deriveProviderStatus({ routes: [{ configured: true, freshness: 'expiring' }] }).freshness).toBe('expiring');
    expect(deriveProviderStatus({ routes: [{ configured: true, freshness: 'expired' }] }).freshness).toBe('expired');
    expect(deriveProviderStatus({ routes: [{ configured: true, freshness: 'pending' }] }).freshness).toBe('pending');
  });

  test('a multi-route provider rolls up to the worst meaningful freshness (expired beats healthy)', () => {
    const status = deriveProviderStatus({
      routes: [
        { route: 'api-key', configured: true, freshness: 'healthy' },
        { route: 'service-oauth', configured: true, freshness: 'expired' },
      ],
    });
    expect(status.freshness).toBe('expired');
  });

  test('worst-wins ranking holds for every pair (expired > expiring > pending > healthy)', () => {
    const rollup = (a: string, b: string) =>
      deriveProviderStatus({ routes: [{ configured: true, freshness: a }, { configured: true, freshness: b }] }).freshness;
    expect(rollup('expiring', 'healthy')).toBe('expiring');
    expect(rollup('pending', 'healthy')).toBe('pending');
    expect(rollup('expired', 'expiring')).toBe('expired');
    expect(rollup('expired', 'pending')).toBe('expired');
  });

  test('a bad route is never hidden behind a good one — the detail list still carries every route', () => {
    const status = deriveProviderStatus({
      routes: [
        { route: 'api-key', configured: true, freshness: 'healthy' },
        { route: 'service-oauth', configured: true, freshness: 'expired', detail: 'token expired 2h ago' },
      ],
    });
    expect(status.freshness).toBe('expired');
    expect(status.routes).toHaveLength(2);
    expect(status.routes.find((r) => r.route === 'service-oauth')?.detail).toBe('token expired 2h ago');
  });
});

describe('deriveProviderStatus — configured header sourcing', () => {
  test('a configured provider with a usable model list reads "configured via env", not "not configured"', () => {
    const status = deriveProviderStatus({
      configured: true,
      configuredVia: 'env',
      routes: [{ route: 'api-key', configured: true, freshness: 'healthy' }],
    });
    expect(providerHeaderLabel(status)).toBe('configured via env');
  });

  test('configured flag nested at runtime.auth.configured (providers.get shape) is honored even with no flat configuredVia', () => {
    const status = deriveProviderStatus({
      runtime: { auth: { configured: true, routes: [{ route: 'api-key', configured: true, freshness: 'healthy' }] } },
    });
    expect(providerHeaderLabel(status)).toBe('configured');
  });

  test('a genuinely unconfigured provider reads "not configured"', () => {
    const status = deriveProviderStatus({ configured: false, routes: [{ route: 'api-key', configured: false, freshness: 'unconfigured' }] });
    expect(providerHeaderLabel(status)).toBe('not configured');
  });
});

describe('deriveProviderStatus — unconfigured vs status-unavailable (different truths)', () => {
  test('every route explicitly reporting "unconfigured" -> the pill reads "unconfigured"', () => {
    const status = deriveProviderStatus({
      routes: [{ route: 'api-key', configured: false, freshness: 'unconfigured' }],
    });
    expect(status.freshness).toBe('unconfigured');
  });

  test('no route data at all (health genuinely absent) -> "status unavailable", distinct from "unconfigured"', () => {
    const status = deriveProviderStatus({ id: 'some-provider', label: 'Some Provider' });
    expect(status.freshness).toBe('status unavailable');
    expect(status.freshness).not.toBe('unconfigured');
  });

  test('an empty routes array also reads "status unavailable" (no per-route signal to roll up)', () => {
    const status = deriveProviderStatus({ routes: [] });
    expect(status.freshness).toBe('status unavailable');
  });
});

describe('deriveProviderStatus — per-route detail', () => {
  test('carries freshness, detail, and repairHints per route for the expanded view', () => {
    const status = deriveProviderStatus({
      routes: [
        {
          route: 'service-oauth',
          label: 'Service OAuth',
          configured: true,
          freshness: 'expired',
          detail: 'refresh token expired',
          repairHints: ['re-authenticate via the service dashboard', 'check clock skew'],
        },
      ],
    });
    const [route] = status.routes;
    expect(route.freshness).toBe('expired');
    expect(route.detail).toBe('refresh token expired');
    expect(route.repairHints).toEqual(['re-authenticate via the service dashboard', 'check clock skew']);
  });
});

describe('bestStatus is unchanged for non-provider consumers (no regression)', () => {
  test('bestStatus still reads the generic status/state/phase/health/authFreshness/kind fallback chain', () => {
    expect(bestStatus({ status: 'running' })).toBe('running');
    expect(bestStatus({ state: 'blocked' })).toBe('blocked');
    expect(bestStatus({})).toBe('unknown');
  });
});
