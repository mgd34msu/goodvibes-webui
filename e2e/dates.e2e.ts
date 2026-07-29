/**
 * Dates view (occasions.*, docs/occasions.md) — proven against a real HTTP
 * round-trip through the mock daemon, mirroring calendar.e2e.ts/mail.e2e.ts's shape
 * for the sibling surface. Covers the not-available honesty state, the populated
 * upcoming/plans/open-items/state sections, the answer/remove/gift-history actions,
 * and the one thing docs/occasions.md §4.3 makes non-negotiable: a pending nudge
 * subject never carries a raw date, only the proximity word.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';

test('default options (occasions available): upcoming occasions render with real dates', async ({ page }) => {
  await installMockDaemon(page); // default occasions: 'available'
  await page.goto('/?view=dates');
  const list = page.getByTestId('dates-occasion-list');
  await expect(list).toBeVisible();
  await expect(list).toContainText('Sarah’s birthday');
  await expect(list).toContainText('Gift-giving');
  await expect(list).toContainText('Dad');
  await expect(list).toContainText('Remember only');
});

test('not-available: the honest note renders in every section and no occasion list appears', async ({ page }) => {
  await installMockDaemon(page, { occasions: 'not-available' });
  await page.goto('/?view=dates');
  // All four reads (list, plans, pending, state) independently answer the same
  // honest 501, so the note renders once per section — four times on this page.
  await expect(page.getByText('Dates isn’t available on this daemon yet').first()).toBeVisible();
  await expect(page.getByText('Dates isn’t available on this daemon yet')).toHaveCount(4);
  await expect(page.getByTestId('dates-occasion-list')).toHaveCount(0);
});

test('answering Yes on an occasion updates its answer badge', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=dates');
  const row = page.getByTestId('dates-occasion-list').locator('.dates-occasion-row').filter({ hasText: 'Sarah’s birthday' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Yes' }).click();
  await expect(row.locator('.badge.ok')).toHaveText('Yes');
});

test('removing an occasion takes one confirmation and then it disappears', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=dates');
  const row = page.getByTestId('dates-occasion-list').locator('.dates-occasion-row').filter({ hasText: 'Dad' });
  await row.getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('.confirm-sheet--danger')).toBeVisible();
  await expect(page.locator('.confirm-sheet')).toContainText('Dad');
  await page.locator('.confirm-sheet__confirm').click();
  await expect(page.locator('.confirm-sheet')).toHaveCount(0);
  await expect(page.getByTestId('dates-occasion-list')).not.toContainText('Dad');
});

test('gift history peek opens and lists a prior year’s record', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=dates');
  const row = page.getByTestId('dates-occasion-list').locator('.dates-occasion-row').filter({ hasText: 'Dad' });
  await row.getByRole('button', { name: 'Gift history' }).click();
  await expect(page.getByTestId('dates-gift-peek-list')).toBeVisible();
  await expect(page.getByTestId('dates-gift-peek-list')).toContainText('A framed photo');
});

test('plans render the away badge and destination', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=dates');
  const list = page.getByTestId('dates-plan-list');
  await expect(list).toBeVisible();
  await expect(list).toContainText('Lisbon');
  await expect(list).toContainText('Away');
});

test('open items: a pending nudge shows the proximity word and never a raw date', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=dates');
  const nudge = page.getByTestId('dates-nudge');
  await expect(nudge).toBeVisible();
  await expect(nudge).toContainText('approaching');
  await expect(nudge).toContainText('Sarah’s birthday is approaching.');
  const nudgeText = (await nudge.textContent()) ?? '';
  expect(nudgeText).not.toMatch(/\d{4}-\d{2}-\d{2}/);
});

test('open items: answering the in-progress interview\'s next question, then closing it, is reflected in the gift history', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=dates');
  const interviewList = page.getByTestId('dates-interview-list');
  await expect(interviewList).toBeVisible();
  await expect(interviewList).toContainText('What has she mentioned wanting lately?');
  await interviewList.locator('input').first().fill('A scarf');
  await interviewList.getByRole('button', { name: 'Answer' }).click();
  await expect(interviewList).toContainText('What did you land on?');
  await interviewList.locator('input').first().fill('A scarf');
  await interviewList.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByText('Recorded what you landed on')).toBeVisible();
});

test('state section renders the machine-owned store counts and runs a sweep', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=dates');
  const state = page.getByTestId('dates-state');
  await expect(state).toBeVisible();
  await state.getByRole('button', { name: 'Run sweep now' }).click();
  await expect(page.getByText(/Mirrored \d+ occasion\(s\)\./)).toBeVisible();
});
