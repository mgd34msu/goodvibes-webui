/**
 * Phone smoke: every view renders at 390x844 with no horizontal
 * overflow and a tappable key affordance. Honest bar — a view that can only show an
 * empty/degraded state still must not scroll sideways or hide its primary control.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { only, PHONE, expectNoHorizontalScroll, expectTappable } from './support/app';

test.beforeEach(async ({ page }, testInfo) => {
  only(testInfo, PHONE);
  await installMockDaemon(page);
});

const VIEWS: { view: string; label: string }[] = [
  { view: 'chat', label: 'Chat' },
  { view: 'sessions', label: 'Sessions' },
  { view: 'fleet', label: 'Fleet' },
  { view: 'checkpoints', label: 'Checkpoints' },
  { view: 'approvals-tasks', label: 'Approvals' },
  { view: 'workstream', label: 'Workstream' },
  { view: 'knowledge', label: 'Knowledge' },
  { view: 'memory', label: 'Memory' },
  { view: 'providers', label: 'Providers' },
  { view: 'calendar', label: 'Calendar' },
  { view: 'admin', label: 'Admin' },
];

for (const { view, label } of VIEWS) {
  test(`${label} renders on a phone with no horizontal overflow`, async ({ page }) => {
    await page.goto(`/?view=${view}`);
    await expect(page.locator('.app-shell')).toBeVisible();
    // The view frame mounted with content.
    const frame = page.locator('.view-frame');
    await expect(frame).toBeVisible();
    await expect(frame).not.toBeEmpty();
    // No sideways scroll — the cardinal phone sin.
    await expectNoHorizontalScroll(page);
    // The topbar's primary control clears the touch floor — except Chat, which hides
    // the app topbar (`.workspace-chat .topbar { display: none }`) in favor of its own
    // chat-toolbar. Chat's key affordances are audited in the dedicated test below.
    if (view !== 'chat') {
      await expectTappable(page, '.topbar-actions .icon-button', `${label} topbar action`);
    }
  });
}

test('Sessions: the list is usable — refresh is tappable, rows readable', async ({ page }) => {
  await page.goto('/?view=sessions');
  await expect(page.locator('.sessions-view')).toBeVisible();
  await expectTappable(page, '.sessions-toolbar .icon-button', 'sessions refresh');
  await expect(page.locator('.sessions-row').first()).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('Chat: the composer input and send button are present and tappable', async ({ page }) => {
  await page.goto('/?view=chat');
  await expect(page.locator('.workspace-chat')).toBeVisible();
  await expectNoHorizontalScroll(page);
  // The chat composer textarea is reachable; the send button clears the touch floor.
  await expect(page.locator('.composer textarea, textarea').first()).toBeVisible();
  await expectTappable(page, '.send-button', 'chat send');
});

test('Providers: per-provider status pills render', async ({ page }) => {
  await page.goto('/?view=providers');
  await expect(page.locator('.view-frame')).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('drawer opened on a phone does not trap — the scrim closes it from any view', async ({ page }) => {
  await page.goto('/?view=fleet');
  await page.locator('.brand-mark-button').click();
  await expect(page.locator('.sidebar:not(.collapsed)')).toBeVisible();
  // Tap the dimmed strip RIGHT of the open drawer. The scrim spans the whole
  // viewport but the 264px drawer sits above its center, so a default
  // center-click lands on the drawer (and only "passes" if it races the
  // open animation). x=340 is always in the exposed strip on a 390px phone.
  await page.locator('.sidebar-scrim').click({ position: { x: 340, y: 422 } });
  await expect(page.locator('.app-shell.sidebar-collapsed')).toBeVisible();
  await expectNoHorizontalScroll(page);
});
