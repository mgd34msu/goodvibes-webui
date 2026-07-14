/**
 * Pairing tokens settings/security surface (pairing.tokens.*, SDK 1.8.0):
 * list/rename/revoke per device, the migrate-this-browser affordance, and the
 * revoke-shared-token action — each destructive step gated by the real
 * ConfirmSheet with a plain-language consequence, never a bare click-to-destroy.
 *
 * The cross-device revoke proof uses TWO Playwright contexts sharing one
 * MockPairingStore (support/mock-daemon.ts) — standing in for the operator's
 * own browser and a second paired device — so revoking the device's token from
 * the operator's session is checked against a REAL 401 on the device's own
 * next authenticated request, not just a UI state change.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon, createMockPairingStore } from './support/mock-daemon';
import { only, PHONE, expectTappable } from './support/app';

// eslint-disable-next-line no-empty-pattern -- Playwright requires the object-destructuring form even with no fixtures used
test.beforeEach(({}, testInfo) => {
  only(testInfo, PHONE);
});

async function openPairingSettings(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?view=admin');
  await expect(page.getByRole('heading', { name: 'Devices & pairing' })).toBeVisible();
}

test('lists paired devices with created/last-seen, never a secret, and renames inline', async ({ page }) => {
  const pairingStore = createMockPairingStore([
    { id: 'tok-phone', name: 'Phone', token: 'e2e-phone-token', createdAt: 1_700_000_000_000, lastSeenAt: 1_700_100_000_000 },
    { id: 'tok-laptop', name: 'Laptop', token: 'e2e-laptop-token', createdAt: 1_700_000_500_000 },
  ]);
  await installMockDaemon(page, { pairingStore });
  await openPairingSettings(page);

  await expect(page.getByText('Phone', { exact: true })).toBeVisible();
  await expect(page.getByText('Laptop', { exact: true })).toBeVisible();
  await expect(page.getByText(/last seen/)).toBeVisible();
  await expect(page.getByText('never seen')).toBeVisible(); // Laptop has no lastSeenAt
  // Never a secret in this list.
  await expect(page.getByText('e2e-phone-token')).toHaveCount(0);

  await page.getByRole('button', { name: 'Rename Phone' }).click();
  const input = page.locator('#pairing-token-rename-tok-phone');
  await input.fill('My Phone');
  await input.press('Enter');
  await expect(page.getByText('My Phone', { exact: true })).toBeVisible();
});

test('touch targets on the pairing tokens panel clear 44px at phone width', async ({ page }) => {
  const pairingStore = createMockPairingStore([
    { id: 'tok-phone', name: 'Phone', token: 'e2e-phone-token', createdAt: 1_700_000_000_000 },
  ]);
  await installMockDaemon(page, { pairingStore });
  await openPairingSettings(page);
  await expectTappable(page, '.pairing-token-row__revoke', 'revoke device');
  await expectTappable(page, '.pairing-tokens-legacy__actions button', 'give this browser its own token');
});

test('revoking one device 401s it while the current session (a different token) keeps working', async ({ page, browser }) => {
  const pairingStore = createMockPairingStore([
    { id: 'tok-phone', name: 'Phone', token: 'e2e-phone-token', createdAt: 1_700_000_000_000 },
  ]);
  // The operator's own browser: the default seeded session token, unrelated to
  // (and never affected by) anything that happens to the phone's token below.
  await installMockDaemon(page, { pairingStore });

  // A second, independent context/page stands in for the paired phone,
  // authenticated with the pairing token this test is about to revoke.
  const phoneContext = await browser.newContext();
  const phonePage = await phoneContext.newPage();
  await installMockDaemon(phonePage, { pairingStore, signedIn: false });
  await phonePage.addInitScript((token) => {
    window.localStorage.setItem('goodvibes.webui.token', token);
  }, 'e2e-phone-token');
  await phonePage.goto('/?view=chat');
  // Genuinely signed in, before the revoke.
  await expect(phonePage.locator('.app-shell')).toBeVisible();

  await openPairingSettings(page);
  const phoneRow = page.locator('.pairing-token-row', { hasText: 'Phone' });
  await phoneRow.getByRole('button', { name: /Revoke/ }).click();
  await expect(page.locator('.confirm-sheet')).toBeVisible();
  await expect(page.locator('.confirm-sheet')).toContainText('signed out immediately');
  await page.locator('.confirm-sheet__confirm').click();
  await expect(page.getByText('Phone', { exact: true })).toHaveCount(0);

  // The phone's own token is now revoked — its next authenticated call 401s.
  const status = await phonePage.evaluate(async () => {
    const res = await fetch('/api/control-plane/auth', { headers: { Authorization: 'Bearer e2e-phone-token' } });
    return res.status;
  });
  expect(status).toBe(401);

  // The operator's OWN session (a different token entirely) is unaffected.
  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Daemon-Owned Auth' })).toBeVisible();

  await phoneContext.close();
});

test('migrate mints this browser its own token; revoke-shared is gated by a danger confirm naming the consequence', async ({ page }) => {
  const pairingStore = createMockPairingStore();
  await installMockDaemon(page, { pairingStore });
  await openPairingSettings(page);

  await page.getByRole('button', { name: 'Give this browser its own token' }).click();
  await expect(page.locator('.confirm-sheet')).toBeVisible();
  await expect(page.locator('.confirm-sheet')).toContainText('you stay signed in');
  await page.locator('.confirm-sheet__confirm').click();
  await expect(page.getByText('This browser now has its own token')).toBeVisible();

  await page.getByRole('button', { name: 'Revoke the shared token' }).click();
  await expect(page.locator('.confirm-sheet')).toContainText('cannot be undone');
  const sheetClass = await page.locator('.confirm-sheet').getAttribute('class');
  expect(sheetClass).toContain('danger');
  await page.locator('.confirm-sheet__confirm').click();
  await expect(page.getByText('has been revoked')).toBeVisible();
});
