/**
 * Memory consolidation receipts (memory.consolidation.receipts, SDK 1.8.0's
 * consolidation-reaches-the-review-queue work). Proves: pending proposals render
 * with what kind, which records, and why; a "Review" tap jumps to the existing
 * review queue and highlights exactly the referenced record (never filters the
 * rest away); the genuinely-empty and daemon-does-not-run-consolidation states are
 * each honest and distinct. Runs on both phone and desktop (default project set).
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { MEMORY_FACT, MEMORY_REVIEW_CANDIDATE } from './support/seed';

test('a pending contradiction proposal renders kind, reason, and both referenced record ids', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=memory');
  const panel = page.locator('[data-testid="consolidation-receipts"]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Contradiction');
  await expect(panel).toContainText('Same-summary records disagree');
  await expect(panel).toContainText(MEMORY_FACT.id);
  await expect(panel).toContainText(MEMORY_REVIEW_CANDIDATE.id);
});

test('one-tap "Review" jumps to the review queue and highlights exactly the referenced records, without hiding the rest', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=memory');
  const panel = page.locator('[data-testid="consolidation-receipts"]');
  await expect(panel).toBeVisible();

  const reviewQueue = page.locator('[aria-label="Review queue"]');
  const rowCountBeforeJump = await reviewQueue.locator('.memory-review-row').count();
  expect(rowCountBeforeJump).toBeGreaterThan(0);

  await panel.getByRole('button', { name: 'Review' }).click();

  await expect(reviewQueue).toBeInViewport();
  const highlighted = page.locator('.memory-review-row--highlighted');
  await expect(highlighted).toHaveCount(2);
  const ids = await highlighted.evaluateAll((rows) => rows.map((r) => r.getAttribute('data-record-id')));
  expect(ids.sort()).toEqual([MEMORY_FACT.id, MEMORY_REVIEW_CANDIDATE.id].sort());

  // The jump never filters the queue — the same rows that were there before the tap
  // are still all there after it, merely two of them now highlighted.
  await expect(reviewQueue.locator('.memory-review-row')).toHaveCount(rowCountBeforeJump);
});

test('a daemon build with no consolidation scheduler renders the honest "does not run consolidation" state', async ({ page }) => {
  await installMockDaemon(page, { consolidationReceipts: 'unavailable' });
  await page.goto('/?view=memory');
  const panel = page.locator('[data-testid="consolidation-receipts"]');
  await expect(panel).toContainText('This daemon does not run consolidation');
});

test('a genuinely empty history (no runs ever) is a distinct, honest empty state', async ({ page }) => {
  await installMockDaemon(page, { consolidationReceipts: 'empty' });
  await page.goto('/?view=memory');
  const panel = page.locator('[data-testid="consolidation-receipts"]');
  await expect(panel).toContainText('No consolidation runs yet');
  await expect(panel).not.toContainText('does not run consolidation');
});
