/**
 * LAN-http posture, at a REAL private-network origin (SDK 1.8.0).
 *
 * Runs on the "lan-origin" Playwright project only (playwright.config.ts), which serves
 * THIS app from the host's own real private-network interface address (10/8, 172.16/12,
 * 192.168/16) instead of loopback — so Chromium's OWN secure-context determination is
 * the genuine one for a LAN deployment (privateNetwork:true, secureContext:false), not a
 * mocked window.location. When the host has no such interface (a loopback-only sandbox)
 * every test here skips rather than failing on an environment where the proof cannot
 * exist at all.
 *
 * Proves:
 *   - the app LOADS here (no "needs HTTPS" wall — that wall now guards a genuinely
 *     public origin only, never a private-network one);
 *   - the three browser-gated capabilities (service worker/install, push, microphone)
 *     render the daemon's OWN "needs https — available via tailscale" wording, not a
 *     client-fabricated guess;
 *   - a plain `#pair=<token>` hand-off (no offer set) renders the daemon's one honest
 *     plain-http-on-LAN notice line, verbatim, exactly once.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { installChatMockDaemon } from './support/chat-mock';

const NEEDS_HTTPS_REASON = 'needs https — available via tailscale';
const LAN_PLAIN_HTTP_NOTICE =
  'Connection is unencrypted on your LAN. Everything works except browser-gated features; Tailscale gives encrypted access with the full app.';

test.beforeEach(async ({ page, baseURL }, testInfo) => {
  const isRealLanOrigin = testInfo.project.name === 'lan-origin'
    && baseURL !== undefined
    && new URL(baseURL).hostname !== '127.0.0.1';
  test.skip(!isRealLanOrigin, 'no real private-network interface on this host — nothing to prove this spec against');
  void page;
});

test('the app loads at a real private-network http origin — no "needs HTTPS" wall', async ({ page, baseURL }) => {
  expect(new URL(baseURL ?? '').protocol).toBe('http:');
  await installMockDaemon(page);
  await page.goto('/?view=admin');
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.getByText('This page needs HTTPS')).toHaveCount(0);
});

test('Notifications & install: both the push and install sections show the daemon\'s exact reason text', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=admin');
  await expect(page.locator('.app-shell')).toBeVisible();

  const panel = page.locator('.notifications-panel');
  await expect(panel).toBeVisible();
  // Both the push banner and the install section's insecure-origin banner render the
  // SAME daemon reason text — proves neither fell back to a generic/dead-button state.
  const occurrences = await panel.getByText(NEEDS_HTTPS_REASON).count();
  expect(occurrences).toBeGreaterThanOrEqual(2);
  // Never a dead, unexplained fallback for install on this origin.
  await expect(panel.getByText('Use your browser')).toHaveCount(0);
});

test('MicButton: dictation is labeled with the daemon\'s exact reason, not a generic client guess', async ({ page }) => {
  await installChatMockDaemon(page);
  await page.goto('/?view=chat');
  await expect(page.locator('.app-shell')).toBeVisible();

  const mic = page.locator('.voice-mic-btn');
  await expect(mic).toBeVisible();
  await expect(mic).toBeDisabled();
  await expect(page.locator('.voice-mic-note')).toContainText(NEEDS_HTTPS_REASON);
});

test('a plain #pair=<token> hand-off (no offers) renders the daemon\'s LAN notice line once, verbatim', async ({ page }) => {
  await installMockDaemon(page, { signedIn: false });
  await page.goto('/?view=chat#pair=e2e-lan-token');

  await expect(page.locator('.pairing-posture-notice')).toBeVisible();
  await expect(page.locator('.pairing-posture-notice')).toContainText(LAN_PLAIN_HTTP_NOTICE);
  // The fragment never lingers.
  await expect.poll(() => new URL(page.url()).hash).not.toContain('pair=');

  // Dismiss — never reappears (the whole point of "never a nag").
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.locator('.pairing-posture-notice')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.pairing-posture-notice')).toHaveCount(0);
});
