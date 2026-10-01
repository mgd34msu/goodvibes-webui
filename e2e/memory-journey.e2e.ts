/**
 * The memory journey on the Library page: search and browse, the recall-honesty degrade,
 * add (a dialog), review (a record's pane on the Review tab), delete-means-delete (a
 * confirmation dialog), and the persona group, on BOTH phone and desktop viewports (no
 * `only()` gate: this suite is not phone-exclusive). Every step runs against the hermetic
 * mock daemon (e2e/support/mock-daemon.ts); no real daemon is ever contacted.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { MEMORY_FACT, MEMORY_PERSONA, MEMORY_REVIEW_CANDIDATE } from './support/seed';
import { expectNoHorizontalScroll } from './support/app';

test('the library loads the seeded records with an honest literal-search note', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=library&tab=memory');
  await expect(page.locator('.app-shell')).toBeVisible();

  const records = page.getByRole('list', { name: 'Records' });
  await expect(records.getByText(MEMORY_FACT.summary)).toBeVisible();
  await expect(records.getByText(MEMORY_REVIEW_CANDIDATE.summary)).toBeVisible();
  // Kind and scope are the row's meta; confidence sits on the right.
  await expect(records.getByRole('listitem').filter({ hasText: MEMORY_FACT.summary })).toContainText('Fact · project');
  await expect(records.getByRole('listitem').filter({ hasText: MEMORY_FACT.summary })).toContainText('82% confident');
  // Literal search, plainly labeled, no semantic claim was made, none is shown.
  await expect(page.locator('.lib-honesty__mode')).toContainText(/Literal search/i);
  await expectNoHorizontalScroll(page);
});

test('a semantic search against an unavailable index states the reason verbatim, never a silent empty result', async ({ page }) => {
  await installMockDaemon(page, { memoryIndexUnavailable: true });
  await page.goto('/?view=library&tab=memory');
  await expect(page.getByRole('group', { name: 'Memory filters' })).toBeVisible();

  await page.getByRole('checkbox', { name: 'Semantic' }).setChecked(true, { force: true });
  await page.getByLabel('Search memory and knowledge').fill('daemon');

  const degraded = page.locator('.lib-honesty__banner--degraded');
  await expect(degraded).toBeVisible();
  await expect(degraded).toContainText('Semantic index unavailable');
  await expect(degraded).toContainText('falling back to a literal scan');
});

test('add a memory: the dialog saves it and it appears in the list without a full reload', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=library&tab=memory');
  await expect(page.getByRole('group', { name: 'Memory filters' })).toBeVisible();

  const summary = 'Playwright proved the add-a-memory dialog round-trips';
  await page.getByRole('button', { name: 'Add memory' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add memory' });
  await dialog.getByLabel('Memory summary').fill(summary);
  await dialog.getByRole('button', { name: 'Add memory' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Records' }).getByText(summary)).toBeVisible({ timeout: 10_000 });
  // The pre-existing seeded record is still there, add is additive, not a replace.
  await expect(page.getByRole('list', { name: 'Records' }).getByText(MEMORY_FACT.summary)).toBeVisible();
});

test('review: saving a review state from the Review tab round-trips into the record\'s row', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=library&tab=review');
  const queue = page.getByRole('list', { name: 'Review queue' });
  await queue.getByRole('button', { name: new RegExp(MEMORY_REVIEW_CANDIDATE.summary) }).click();

  const pane = page.getByRole('region', { name: 'Review item' });
  await pane.getByRole('button', { name: `Review state for ${MEMORY_REVIEW_CANDIDATE.summary}` }).click();
  await page.getByRole('option', { name: 'Reviewed' }).click();
  await pane.getByRole('button', { name: 'Save review' }).click();

  // On a phone the review item is a bottom sheet over the page: close it first.
  const sheet = page.locator('.dv-peek.gv-drawer--sheet');
  if (await sheet.isVisible()) {
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  }

  // The saved state reflects back into the record's own row on the Memory tab.
  await page.getByRole('radio', { name: 'Memory' }).click();
  await expect(
    page.getByRole('list', { name: 'Records' }).getByRole('listitem').filter({ hasText: MEMORY_REVIEW_CANDIDATE.summary }),
  ).toContainText('reviewed', { timeout: 10_000 });
});

test('delete means delete. The record is gone after a confirmation, not just hidden behind a client filter', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=library&tab=memory');
  const records = page.getByRole('list', { name: 'Records' });
  await records.getByRole('button', { name: new RegExp(MEMORY_FACT.summary) }).click();

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete this memory?' });
  await expect(confirm).toContainText(MEMORY_FACT.summary);
  await confirm.getByRole('button', { name: 'Delete memory' }).click();

  // Gone from the list AND the Review tab (it was 'fresh'; deletion removes the
  // underlying record, not merely this list's view of it).
  await expect(page.getByText(MEMORY_FACT.summary)).toHaveCount(0, { timeout: 10_000 });
  await page.getByRole('radio', { name: /^Review/ }).click();
  await expect(page.getByText(MEMORY_FACT.summary)).toHaveCount(0);
});

test('a vibe-tagged constraint record renders under Personas', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=library&tab=memory');
  await expect(page.getByRole('list', { name: 'Personas' })).toContainText(MEMORY_PERSONA.summary);
});

test('a daemon that does not serve memory renders the honest degraded state, not a broken workspace', async ({ page }) => {
  await installMockDaemon(page, { memoryAvailable: false });
  await page.goto('/?view=library&tab=memory');
  await expect(page.getByText('This daemon does not serve memory')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Memory filters' })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test('the old ?view=memory link still lands on the Library Memory tab', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=memory');
  await expect(page.getByRole('radio', { name: 'Memory', checked: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Records' }).getByText(MEMORY_FACT.summary)).toBeVisible();
});
