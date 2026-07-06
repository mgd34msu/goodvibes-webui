/**
 * Credential status panel (ProvidersView) — the cross-surface credential-status
 * facade's display-site adoption. Proves the three honest outcomes render
 * against a real HTTP round-trip through the mock daemon (mock-daemon.ts's
 * `credentials` option), not just against a unit-mocked module.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { expectNoHorizontalScroll } from './support/app';

test('available: configured/usable credentials render honestly, no fabricated state', async ({ page }) => {
  await installMockDaemon(page, { credentials: 'available' });
  await page.goto('/?view=providers');
  const panel = page.locator('.credential-status');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('ANTHROPIC_API_KEY')).toBeVisible();
  await expect(panel.getByText('usable', { exact: true }).first()).toBeVisible();
  // GOOGLE_API_KEY is configured but not usable in the seed — the honest
  // degraded label, distinct from plain "usable".
  await expect(panel.getByText('configured, not usable')).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('degraded: a 503 CREDENTIAL_STORE_UNAVAILABLE renders the honest reason, never "configured"', async ({ page }) => {
  await installMockDaemon(page, { credentials: 'store-unavailable' });
  await page.goto('/?view=providers');
  const panel = page.locator('.credential-status');
  await expect(panel.getByText('Credential status unavailable')).toBeVisible();
  await expect(panel.getByText('The daemon has no shared credential store wired.')).toBeVisible();
  await expect(panel.getByText('not configured')).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test('refused: a non-admin token\'s 403 renders honestly, distinct from the degraded-store message', async ({ page }) => {
  await installMockDaemon(page, { credentials: 'admin-required' });
  await page.goto('/?view=providers');
  const panel = page.locator('.credential-status');
  await expect(panel.getByText('Admin access required')).toBeVisible();
  await expect(panel.getByText('Sign in with an admin-scoped token to view credential status.')).toBeVisible();
  await expect(panel.getByText('shared credential store', { exact: false })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});
