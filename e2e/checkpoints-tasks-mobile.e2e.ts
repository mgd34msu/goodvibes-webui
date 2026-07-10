/**
 * Checkpoints + Tasks mobile mutations (confirm sheets).
 *
 * Both are fully actionable on a phone now: browsing stays available AND the
 * mutations (checkpoints create/restore; task submit/cancel/retry) are present,
 * each routed through a touch-first confirm sheet before it runs. Checkpoint
 * restore — a destructive, git-backed workspace rewrite the daemon executes
 * immediately — confirms on every viewport, desktop included.
 *
 * Approvals — the other half of this view — are audited as the headline mobile
 * action and proven elsewhere (fleet-depth.e2e.ts, touch-targets.e2e.ts); this
 * file only re-checks they stay actionable alongside the tasks changes.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { only, PHONE, DESKTOP, expectNoHorizontalScroll, expectTappable } from './support/app';

test.beforeEach(async ({ page }) => {
  await installMockDaemon(page);
});

test.describe('Checkpoints — desktop', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => only(testInfo, DESKTOP));

  test('create and restore controls are present; restore confirms via a sheet', async ({ page }) => {
    await page.goto('/?view=checkpoints');
    await expect(page.locator('.checkpoints-create-row')).toBeVisible();
    await page.locator('.checkpoints-row', { hasText: 'Before the mobile pass' }).click();
    await expect(page.locator('.checkpoint-detail__restore')).toBeVisible();
    // Restore opens a confirm sheet (destructive → confirms on desktop too).
    await page.locator('.checkpoint-detail__restore').click();
    await expect(page.locator('.confirm-sheet')).toBeVisible();
    await expect(page.locator('.confirm-sheet')).toContainText('Before the mobile pass');
    await page.locator('.confirm-sheet__cancel').click();
    await expect(page.locator('.confirm-sheet')).toHaveCount(0);
  });
});

test.describe('Checkpoints — phone: browsable AND actionable via confirm sheets', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => only(testInfo, PHONE));

  test('the list is browsable and creating opens a confirm sheet', async ({ page }) => {
    await page.goto('/?view=checkpoints');
    await expect(page.locator('.checkpoints-row', { hasText: 'Before the mobile pass' })).toBeVisible();
    await expect(page.locator('.checkpoints-create-row')).toBeVisible();
    await expectTappable(page, '.checkpoints-create-button', 'checkpoint create');
    await page.locator('.checkpoints-create-button').click();
    await expect(page.locator('.confirm-sheet')).toBeVisible();
    await expectTappable(page, '.confirm-sheet__confirm', 'confirm sheet primary');
    await expectTappable(page, '.confirm-sheet__cancel', 'confirm sheet cancel');
    await page.locator('.confirm-sheet__cancel').click();
    await expectNoHorizontalScroll(page);
  });

  test('selecting a checkpoint shows its diff; restore opens a danger confirm sheet', async ({ page }) => {
    await page.goto('/?view=checkpoints');
    await page.locator('.checkpoints-row', { hasText: 'Before the mobile pass' }).click();
    await expect(page.locator('.checkpoints-detail__back')).toBeVisible();
    await expect(page.locator('.checkpoints-list-pane')).toBeHidden();
    await expect(page.locator('.checkpoint-detail__restore')).toBeVisible();
    await expectTappable(page, '.checkpoint-detail__restore', 'checkpoint restore');
    await page.locator('.checkpoint-detail__restore').click();
    await expect(page.locator('.confirm-sheet--danger')).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.locator('.confirm-sheet__cancel').click();
    await page.locator('.checkpoints-detail__back').click();
    await expect(page.locator('.checkpoints-list-pane')).toBeVisible();
  });
});

test.describe('Tasks — desktop', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => only(testInfo, DESKTOP));

  test('submit, cancel, and retry controls are present and run bare on desktop', async ({ page }) => {
    await page.goto('/?view=approvals-tasks');
    await expect(page.locator('.tasks-create')).toBeVisible();
    await expect(page.locator('.task-row', { hasText: 'Run the release checklist' }).locator('.task-row__cancel')).toBeVisible();
    await expect(page.locator('.task-row', { hasText: 'Rebuild the search index' }).locator('.task-row__retry')).toBeVisible();
    // Desktop cancel runs immediately — no confirm sheet.
    await page.locator('.task-row', { hasText: 'Run the release checklist' }).locator('.task-row__cancel').click();
    await expect(page.locator('.confirm-sheet')).toHaveCount(0);
  });
});

test.describe('Tasks — phone: fully actionable via confirm sheets', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => only(testInfo, PHONE));

  test('the queue is readable and cancel opens a confirm sheet', async ({ page }) => {
    await page.goto('/?view=approvals-tasks');
    await expect(page.locator('.task-row', { hasText: 'Run the release checklist' })).toBeVisible();
    await expect(page.locator('.tasks-create')).toBeVisible();
    await expect(page.locator('.task-row__actions')).toHaveCount(2);
    const cancel = page.locator('.task-row', { hasText: 'Run the release checklist' }).locator('.task-row__cancel');
    await expectTappable(page, '.task-row__cancel', 'task cancel');
    await cancel.click();
    await expect(page.locator('.confirm-sheet--danger')).toBeVisible();
    await expect(page.locator('.confirm-sheet')).toContainText('Run the release checklist');
    await page.locator('.confirm-sheet__cancel').click();
    await expectNoHorizontalScroll(page);
  });

  test('approvals in the same view stay fully actionable on phone', async ({ page }) => {
    await page.goto('/?view=approvals-tasks');
    await expect(page.locator('.approval-card')).toBeVisible();
    await expect(page.locator('.approval-card__approve-all')).toBeVisible();
    await expect(page.locator('.approval-card__deny')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
