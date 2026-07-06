/**
 * The memory journey — search & browse, the recall-honesty degrade, add, review-queue,
 * delete-means-delete, and the persona read surface — on BOTH phone and desktop
 * viewports (no `only()` gate: this suite is not phone-exclusive like the steer hero).
 * Every step runs against the hermetic mock daemon (e2e/support/mock-daemon.ts); no
 * real daemon is ever contacted.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { MEMORY_FACT, MEMORY_PERSONA, MEMORY_REVIEW_CANDIDATE } from './support/seed';
import { expectNoHorizontalScroll } from './support/app';

test('the memory view loads the seeded records with an honest literal-search note', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=memory');
  await expect(page.locator('.app-shell')).toBeVisible();

  // Every seed record is reviewState 'fresh', so it shows in BOTH the Records panel
  // and the Review Queue panel — scope to Records to avoid a strict-mode
  // multiple-match failure on the shared summary text.
  const recordsPanel = page.locator('[aria-label="Memory records"]');
  await expect(recordsPanel.getByText(MEMORY_FACT.summary)).toBeVisible();
  await expect(recordsPanel.getByText(MEMORY_REVIEW_CANDIDATE.summary)).toBeVisible();
  // Literal search, plainly labeled — no semantic claim was made, none is shown.
  await expect(page.locator('.memory-honesty-note .badge')).toContainText(/Literal search/i);
  await expectNoHorizontalScroll(page);
});

test('a semantic search against an unavailable index states the reason verbatim — never a silent empty result', async ({ page }) => {
  await installMockDaemon(page, { memoryIndexUnavailable: true });
  await page.goto('/?view=memory');
  await expect(page.locator('.memory-search')).toBeVisible();

  await page.getByLabel('Semantic').check();
  await page.getByLabel('Search memory').fill('daemon');
  await page.getByRole('button', { name: 'Search' }).click();

  const degraded = page.locator('.memory-honesty-note__banner--degraded');
  await expect(degraded).toBeVisible();
  await expect(degraded).toContainText('Semantic index unavailable');
  await expect(degraded).toContainText('falling back to a literal scan');
});

test('add a memory — it appears in the list without a full reload', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=memory');
  await expect(page.locator('.memory-search')).toBeVisible();

  const summary = 'Playwright proved the add-a-memory composer round-trips';
  await page.getByLabel('Memory summary').fill(summary);
  await page.getByRole('button', { name: /Add memory/i }).click();

  // A fresh, sub-review-state add lands in BOTH the Records and Review Queue panels
  // (same fresh-record overlap as the seed) — scope to Records for a single match.
  const recordsPanel = page.locator('[aria-label="Memory records"]');
  await expect(recordsPanel.getByText(summary)).toBeVisible({ timeout: 10_000 });
  // The pre-existing seeded record is still there — add is additive, not a replace.
  await expect(recordsPanel.getByText(MEMORY_FACT.summary)).toBeVisible();
});

test('review queue: saving a review state round-trips into the record\'s badge', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=memory');
  const reviewRow = page.locator('.memory-review-row').filter({ hasText: MEMORY_REVIEW_CANDIDATE.summary });
  await expect(reviewRow).toBeVisible();
  await reviewRow.getByLabel(`Review state for ${MEMORY_REVIEW_CANDIDATE.summary}`).selectOption('reviewed');
  await reviewRow.getByRole('button', { name: /Save review/i }).click();

  // The saved state reflects back into the record's own badge in the Records panel.
  const recordsPanel = page.locator('[aria-label="Memory records"]');
  await expect(
    recordsPanel.locator('.memory-record-row', { hasText: MEMORY_REVIEW_CANDIDATE.summary }),
  ).toContainText('reviewed', { timeout: 10_000 });
});

test('delete means delete — the record is gone, not just hidden behind a client filter', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=memory');
  const recordsPanel = page.locator('[aria-label="Memory records"]');
  await expect(recordsPanel.getByText(MEMORY_FACT.summary)).toBeVisible();

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: `Delete ${MEMORY_FACT.summary}` }).click();

  // Gone from the Records panel AND the Review Queue (it was 'fresh' — deletion
  // removes the underlying record, not merely this panel's view of it).
  await expect(page.getByText(MEMORY_FACT.summary)).toHaveCount(0, { timeout: 10_000 });
});

test('a vibe-tagged constraint record renders under Personas, not just Records', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=memory');
  const personasPanel = page.locator('[aria-label="Personas"]');
  await expect(personasPanel).toContainText(MEMORY_PERSONA.summary);
});

test('a daemon that does not serve memory renders the honest degraded state, not a broken workspace', async ({ page }) => {
  await installMockDaemon(page, { memoryAvailable: false });
  await page.goto('/?view=memory');
  await expect(page.getByText('This daemon does not serve memory')).toBeVisible();
  await expect(page.locator('.memory-search')).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});
