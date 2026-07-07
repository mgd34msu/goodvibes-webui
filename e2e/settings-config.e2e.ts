/**
 * Settings modal — the config/settings surface (config.get/config.set),
 * per the platform's surface doctrine: configuration lives in a modal, not
 * an always-visible page section. Runs on BOTH phone and desktop.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { expectNoHorizontalScroll, only, PHONE } from './support/app';

test.beforeEach(async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=admin');
  await expect(page.locator('.stack')).toBeVisible();
});

test.describe('phone: the modal is a near-fullscreen sheet (MOBILE-ADAPT)', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => only(testInfo, PHONE));

  test('the panel fills the viewport instead of floating as a centered card', async ({ page }) => {
    await page.getByRole('button', { name: 'Open Settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (box && viewport) {
      expect(box.width).toBeGreaterThanOrEqual(viewport.width - 2);
      expect(box.height).toBeGreaterThanOrEqual(viewport.height - 2);
    }
    await expectNoHorizontalScroll(page);
  });
});

test('opens from the "Open Settings" launcher and shows TUI-parity categories', async ({ page }) => {
  await page.getByRole('button', { name: 'Open Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Display' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Helper' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Surfaces' })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('a secret-shaped surfaces.* key never renders its raw value', async ({ page }) => {
  await page.getByRole('button', { name: 'Open Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Surfaces' }).click();
  await expect(dialog.getByText('surfaces.slack.botToken')).toBeVisible();
  await expect(dialog.getByText('xoxb-e2e-hermetic-secret-9999')).toHaveCount(0);
  // Last 4 chars only, per the mask contract.
  await expect(dialog.locator('.settings-value--secret')).toContainText('9999');
});

test('an admin-scope refusal renders honestly, distinct from a generic failure', async ({ page }) => {
  await installMockDaemon(page, { config: 'admin-required' });
  await page.goto('/?view=admin');
  await page.getByRole('button', { name: 'Open Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByText('Admin access required')).toBeVisible();
});

test('the Advanced editor writes through config.set and the change is honestly reflected on reopen', async ({ page }) => {
  await page.getByRole('button', { name: 'Open Settings' }).click();
  let dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByPlaceholder('settings.path').fill('display.theme');
  await dialog.getByPlaceholder('JSON or text').fill('"cyberpunk"');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Config saved')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Reopen: the Display category shows the value just written, proving this is a
  // real config.get/config.set round-trip, not a client-side-only form.
  await page.getByRole('button', { name: 'Open Settings' }).click();
  dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByText('cyberpunk')).toBeVisible();
});
