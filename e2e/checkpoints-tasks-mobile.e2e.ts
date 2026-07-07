/**
 * Checkpoints + Tasks mobile tiering (MOBILE-ADAPT) — both are audited as
 * "view-only" on a phone (parity audit rows 15 and 17): browsing stays fully
 * available, but mutations (checkpoints create/restore; task submit/cancel/retry)
 * defer to a wider screen, mirroring the fleet-depth desktop-only-mutation pattern
 * (an honest note explains why, never a dead or missing control).
 *
 * Approvals — the other half of this view — are audited as "full" (the headline
 * mobile action) and already proven end to end elsewhere (fleet-depth.e2e.ts,
 * touch-targets.e2e.ts); this file does not re-prove approve/deny.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { only, PHONE, DESKTOP, expectNoHorizontalScroll } from './support/app';

test.beforeEach(async ({ page }) => {
  await installMockDaemon(page);
});

test.describe('Checkpoints — desktop', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => only(testInfo, DESKTOP));

  test('create and restore controls are present and reachable', async ({ page }) => {
    await page.goto('/?view=checkpoints');
    await expect(page.locator('.checkpoints-create-row')).toBeVisible();
    await page.locator('.checkpoints-row', { hasText: 'Before the mobile pass' }).click();
    await expect(page.locator('.checkpoint-detail__restore')).toBeVisible();
    await expect(page.locator('.checkpoints-phone-note')).toBeHidden();
  });
});

test.describe('Checkpoints — phone: browsable, mutations desktop-only with an honest pointer', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => only(testInfo, PHONE));

  test('the list is browsable, creating defers to a wider screen', async ({ page }) => {
    await page.goto('/?view=checkpoints');
    await expect(page.locator('.checkpoints-row', { hasText: 'Before the mobile pass' })).toBeVisible();
    await expect(page.locator('.checkpoints-create-row')).toBeHidden();
    await expect(page.locator('.checkpoints-phone-note')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('selecting a checkpoint shows its diff with a Back affordance; restore is hidden', async ({ page }) => {
    await page.goto('/?view=checkpoints');
    await page.locator('.checkpoints-row', { hasText: 'Before the mobile pass' }).click();
    await expect(page.locator('.checkpoints-detail__back')).toBeVisible();
    await expect(page.locator('.checkpoints-list-pane')).toBeHidden();
    await expect(page.locator('.checkpoint-detail__restore')).toBeHidden();
    await expect(page.locator('.checkpoint-detail__diff-files, .checkpoints-empty')).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.locator('.checkpoints-detail__back').click();
    await expect(page.locator('.checkpoints-list-pane')).toBeVisible();
  });
});

test.describe('Tasks — desktop', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => only(testInfo, DESKTOP));

  test('submit, cancel, and retry controls are present', async ({ page }) => {
    await page.goto('/?view=approvals-tasks');
    await expect(page.locator('.tasks-create')).toBeVisible();
    await expect(page.locator('.task-row', { hasText: 'Run the release checklist' }).locator('.task-row__cancel')).toBeVisible();
    await expect(page.locator('.task-row', { hasText: 'Rebuild the search index' }).locator('.task-row__retry')).toBeVisible();
    await expect(page.locator('.tasks-phone-note')).toBeHidden();
  });
});

test.describe('Tasks — phone: queue readable, mutations desktop-only with an honest pointer', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => only(testInfo, PHONE));

  test('the task queue is readable; submit/cancel/retry defer to a wider screen', async ({ page }) => {
    await page.goto('/?view=approvals-tasks');
    await expect(page.locator('.task-row', { hasText: 'Run the release checklist' })).toBeVisible();
    await expect(page.locator('.task-row', { hasText: 'Rebuild the search index' })).toBeVisible();
    await expect(page.locator('.tasks-create')).toBeHidden();
    await expect(page.locator('.task-row__actions')).toHaveCount(2);
    for (const actions of await page.locator('.task-row__actions').all()) {
      await expect(actions).toBeHidden();
    }
    await expect(page.locator('.tasks-phone-note')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('approvals in the same view stay fully actionable on phone (full tier)', async ({ page }) => {
    await page.goto('/?view=approvals-tasks');
    await expect(page.locator('.approval-card')).toBeVisible();
    await expect(page.locator('.approval-card__approve-all')).toBeVisible();
    await expect(page.locator('.approval-card__deny')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
