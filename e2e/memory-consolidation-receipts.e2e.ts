/**
 * Memory consolidation on the Library's Review tab (memory.consolidation.receipts, SDK
 * 1.8.0's consolidation-reaches-the-review-queue work). Proves: pending proposals render
 * with what kind, how many records and why; "Resolve" opens the proposal and highlights
 * exactly the referenced queue rows (never filtering the rest away); the genuinely-empty and
 * daemon-does-not-run-consolidation states are each honest and distinct. Runs on both
 * phone and desktop (default project set).
 */
import { test, expect, type Page } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { MEMORY_FACT, MEMORY_REVIEW_CANDIDATE } from './support/seed';

const PANEL = '[data-testid="consolidation-receipts"]';

/** On a phone the proposal's detail is a bottom sheet over the list; Escape closes it. */
async function backToListIfPhone(page: Page): Promise<void> {
  const sheet = page.locator('.dv-peek.gv-drawer--sheet');
  if (await sheet.isVisible()) {
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  }
}

test('a pending contradiction proposal renders kind, reason and record count', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=library&tab=review');
  const panel = page.locator(PANEL);
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Contradiction');
  await expect(panel).toContainText('Same-summary records disagree');
  await expect(panel).toContainText('2 records');
  // The tab label counts the rows waiting there.
  await expect(page.getByRole('radio', { name: /^Review · \d+$/ })).toBeVisible();
});

test('"Resolve" opens the proposal and highlights exactly the referenced records, without hiding the rest', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=library&tab=review');
  const panel = page.locator(PANEL);
  await expect(panel).toBeVisible();

  const queueRows = page.getByRole('list', { name: 'Review queue' }).getByRole('listitem');
  const rowCountBeforeJump = await queueRows.count();
  expect(rowCountBeforeJump).toBeGreaterThan(0);

  await panel.getByRole('button', { name: 'Resolve' }).click();
  // The proposal's own pane names both records.
  const pane = page.getByRole('region', { name: 'Review item' });
  await expect(pane).toContainText('Same-summary records disagree');
  await expect(pane).toContainText(MEMORY_FACT.id);
  await expect(pane).toContainText(MEMORY_REVIEW_CANDIDATE.id);
  await backToListIfPhone(page);

  const highlighted = page.locator('.lib-row--highlight');
  await expect(highlighted).toHaveCount(2);
  await expect(highlighted.filter({ hasText: MEMORY_FACT.summary })).toHaveCount(1);
  await expect(highlighted.filter({ hasText: MEMORY_REVIEW_CANDIDATE.summary })).toHaveCount(1);

  // The jump never filters the queue, the same rows that were there before are all still
  // there, merely two of them now highlighted.
  await expect(queueRows).toHaveCount(rowCountBeforeJump);
});

test('a daemon build with no consolidation scheduler renders the honest "does not run consolidation" state', async ({ page }) => {
  await installMockDaemon(page, { consolidationReceipts: 'unavailable' });
  await page.goto('/?view=library&tab=review');
  await expect(page.locator(PANEL)).toContainText('This daemon does not run consolidation');
});

test('a genuinely empty history (no runs ever) is a distinct, honest empty state', async ({ page }) => {
  await installMockDaemon(page, { consolidationReceipts: 'empty' });
  await page.goto('/?view=library&tab=review');
  const panel = page.locator(PANEL);
  await expect(panel).toContainText('No consolidation runs yet');
  await expect(panel).not.toContainText('does not run consolidation');
});
