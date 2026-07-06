/**
 * Touch-target audit (W5-M): every interactive control on the phone hero journey
 * clears a 44px floor, measured from the RENDERED box (not the source). The session
 * delete is reachable without hover.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { STEERABLE_SESSION } from './support/seed';
import { only, PHONE, expectTappable } from './support/app';

test.beforeEach(async ({ page }, testInfo) => {
  only(testInfo, PHONE);
  await installMockDaemon(page);
});

test('every control on the steer-from-phone journey is >=44px', async ({ page }) => {
  await page.goto('/?view=sessions');
  await expect(page.locator('.app-shell')).toBeVisible();

  // Topbar actions (were 36px).
  await expectTappable(page, '.topbar-actions .icon-button', 'topbar action');

  // Collapsed-rail nav item — the tap that opens a view (were packed into ~80px cells).
  await expectTappable(page, '.nav-item', 'rail nav item');

  // Brand mark — the drawer-open affordance on the rail.
  await expectTappable(page, '.brand-mark-button', 'brand mark');

  // Sessions refresh (was 36px).
  await expectTappable(page, '.sessions-toolbar .icon-button', 'sessions refresh');

  // Open a session → steer controls.
  await page.getByRole('button', { name: new RegExp(STEERABLE_SESSION.title) }).click();
  await expect(page.locator('.session-detail__transcript')).toBeVisible();

  await expectTappable(page, '.session-detail__back', 'back to sessions');
  await expectTappable(page, '.steer-composer__input', 'steer input');
  await expectTappable(page, '.steer-composer__send', 'steer send');
});

test('the session delete is touch-reachable (not hover-only) in the chat rail', async ({ page }) => {
  await page.goto('/?view=chat');
  await expect(page.locator('.workspace-chat')).toBeVisible();
  // Open the drawer so the chat session list (with its per-row delete) is visible.
  await page.locator('.brand-mark-button').click();
  await expect(page.locator('.sidebar:not(.collapsed)')).toBeVisible();

  const del = page.locator('.sidebar-session-delete').first();
  const count = await del.count();
  if (count === 0) {
    test.skip(true, 'no companion chat sessions seeded to carry a delete control');
    return;
  }
  // Reachable means: rendered, non-zero opacity (not the hover-only opacity:0), 44px.
  const opacity = await del.evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(opacity)).toBeGreaterThan(0.5);
  await expectTappable(page, '.sidebar-session-delete', 'session delete');
});

test('nav labels are legible in the open drawer — no mid-word truncation', async ({ page }) => {
  await page.goto('/?view=sessions');
  await page.locator('.brand-mark-button').click();
  await expect(page.locator('.sidebar:not(.collapsed)')).toBeVisible();

  // Every nav label renders its full text without an ellipsis clip (scrollWidth fits).
  const clipped = await page.locator('.nav-copy strong').evaluateAll((els) =>
    els
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent),
  );
  expect(clipped, `truncated nav labels: ${clipped.join(', ')}`).toEqual([]);
});
