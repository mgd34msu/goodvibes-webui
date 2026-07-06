/**
 * Desktop unregressed (W5-M): the responsive changes are phone-scoped. At 1280px the
 * drawer defaults OPEN, the Sessions list and detail sit side-by-side (no master-detail
 * collapse, no phone back button), and the steer still sends.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon, type MockDaemon } from './support/mock-daemon';
import { STEERABLE_SESSION } from './support/seed';
import { only, DESKTOP, expectNoHorizontalScroll } from './support/app';

let daemon: MockDaemon;

test.beforeEach(async ({ page }, testInfo) => {
  only(testInfo, DESKTOP);
  daemon = await installMockDaemon(page);
});

test('the drawer defaults OPEN on desktop', async ({ page }) => {
  await page.goto('/?view=sessions');
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.sidebar:not(.collapsed)')).toBeVisible();
  await expect(page.locator('.app-shell.sidebar-collapsed')).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test('Sessions shows list and detail side-by-side, no phone back button', async ({ page }) => {
  await page.goto('/?view=sessions');
  await page.getByRole('button', { name: new RegExp(STEERABLE_SESSION.title) }).click();

  // Both panes visible together on desktop.
  await expect(page.locator('.sessions-list-pane')).toBeVisible();
  await expect(page.locator('.session-detail__transcript')).toBeVisible();

  // The back affordance is present in the DOM but hidden on desktop (display:none).
  await expect(page.locator('.session-detail__back')).toBeHidden();
});

test('steer still sends on desktop', async ({ page }) => {
  await page.goto('/?view=sessions');
  await page.getByRole('button', { name: new RegExp(STEERABLE_SESSION.title) }).click();
  const input = page.locator('.steer-composer__input');
  await input.fill('Desktop steer path still works');
  await input.press('Enter');
  await expect.poll(() => daemon.steerRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(page.locator('.steer-dispatch').first()).toContainText(/steer · delivered/i);
});

test('nav labels render full text in the open desktop drawer', async ({ page }) => {
  await page.goto('/?view=sessions');
  await expect(page.getByRole('button', { name: 'Checkpoints' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Workstream' })).toBeVisible();
});
