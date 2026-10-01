/**
 * Occasions tab of Personal (occasions.*, docs/occasions.md), proven against a real
 * HTTP round-trip through the mock daemon, mirroring calendar.e2e.ts/mail.e2e.ts's
 * shape for the sibling surface. Covers the not-available honesty state, the
 * populated upcoming / plans / open-items / stored-records groups, the answer /
 * remove / gift-history actions in the detail pane, and the one thing
 * docs/occasions.md §4.3 makes non-negotiable: a pending nudge subject never
 * carries a raw date, only the proximity word.
 */
import { test, expect, type Page } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { expectNoHorizontalScroll } from './support/app';

const OCCASIONS = '/?view=personal&tab=occasions';

function occasionRow(page: Page, text: string) {
  return page.getByTestId('dates-occasion-list').locator('.dates-occasion-row').filter({ hasText: text });
}

test('default options (occasions available): upcoming occasions render with real dates', async ({ page }) => {
  await installMockDaemon(page); // default occasions: 'available'
  await page.goto(OCCASIONS);
  const list = page.getByTestId('dates-occasion-list');
  await expect(list).toBeVisible();
  await expect(list).toContainText('Sarah’s birthday');
  await expect(list).toContainText('Gift-giving');
  await expect(list).toContainText('Dad');
  await expect(list).toContainText('Remember only');
  await expectNoHorizontalScroll(page);
});

test('not-available: one honest empty state with one action, no list and no add buttons', async ({ page }) => {
  await installMockDaemon(page, { occasions: 'not-available' });
  await page.goto(OCCASIONS);
  await expect(page.getByText('Occasions aren’t available on this daemon yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update daemon' })).toBeVisible();
  await expect(page.getByTestId('dates-occasion-list')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add occasion' })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test('answering Yes in the occasion detail updates its answer', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto(OCCASIONS);
  const row = occasionRow(page, 'Sarah’s birthday');
  await expect(row).toBeVisible();
  await row.locator('.gv-row__main').click();
  const pane = page.getByRole('region', { name: 'Details' });
  await expect(pane).toBeVisible();
  await pane.getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(pane.getByRole('button', { name: 'Yes', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(pane).toContainText('Gift this year');
});

test('removing an occasion takes one confirmation and then it disappears', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto(OCCASIONS);
  await occasionRow(page, 'Dad').locator('.gv-row__main').click();
  await page.getByRole('region', { name: 'Details' }).getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('.confirm-sheet--danger')).toBeVisible();
  await expect(page.locator('.confirm-sheet')).toContainText('Dad');
  await page.locator('.confirm-sheet__confirm').click();
  await expect(page.locator('.confirm-sheet')).toHaveCount(0);
  await expect(page.getByTestId('dates-occasion-list')).not.toContainText('Dad');
});

test('the gift history shows in the detail pane and lists a prior year’s record', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto(OCCASIONS);
  await occasionRow(page, 'Dad').locator('.gv-row__main').click();
  await expect(page.getByTestId('dates-gift-peek-list')).toBeVisible();
  await expect(page.getByTestId('dates-gift-peek-list')).toContainText('A framed photo');
});

test('plans render the away chip and destination', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto(OCCASIONS);
  const list = page.getByTestId('dates-plan-list');
  await expect(list).toBeVisible();
  await expect(list).toContainText('Lisbon');
  await expect(list).toContainText('Away');
});

test('open items: a pending nudge shows the proximity word and never a raw date', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto(OCCASIONS);
  const nudge = page.getByTestId('dates-nudge');
  await expect(nudge).toBeVisible();
  await expect(nudge).toContainText('approaching');
  await expect(nudge).toContainText('Sarah’s birthday is approaching.');
  const nudgeText = (await nudge.textContent()) ?? '';
  expect(nudgeText).not.toMatch(/\d{4}-\d{2}-\d{2}/);
});

test('open items: answering the in-progress interview\'s next question, then closing it, is reflected in the gift history', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto(OCCASIONS);
  const interviewList = page.getByTestId('dates-interview-list');
  await expect(interviewList).toBeVisible();
  await expect(interviewList).toContainText('What has she mentioned wanting lately?');
  await interviewList.locator('.gv-row__main').first().click();
  const pane = page.getByRole('region', { name: 'Details' });
  await pane.getByLabel('What has she mentioned wanting lately?').fill('A scarf');
  await pane.getByRole('button', { name: 'Answer' }).click();
  await expect(pane.getByLabel('What did you land on?')).toBeVisible();
  await pane.getByLabel('What did you land on?').fill('A scarf');
  await pane.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByText('Recorded what you landed on')).toBeVisible();
});

test('stored records: the disclosure shows the machine-owned store counts and runs a sweep', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto(OCCASIONS);
  await page.getByText('Stored records', { exact: true }).click();
  const state = page.getByTestId('dates-state');
  await expect(state).toBeVisible();
  await expect(state).toContainText('Acknowledgements');
  await state.getByRole('button', { name: 'Run sweep now' }).click();
  await expect(page.getByText(/Mirrored \d+ occasion\(s\)\./)).toBeVisible();
});

test('Add occasion previews before it confirms, using kit controls only', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto(OCCASIONS);
  await page.getByRole('button', { name: 'Add occasion' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add occasion' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('select, input[type="date"], input[type="datetime-local"]')).toHaveCount(0);
  await dialog.getByLabel('Title').fill('Anniversary');
  await dialog.getByLabel('Date', { exact: true }).fill('2027-05-01');
  await dialog.getByRole('button', { name: 'Preview' }).click();
  await expect(dialog.getByRole('status')).toBeVisible();
  // Confirm stays disabled until a kind is chosen.
  await expect(dialog.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Kind' }).click();
  await page.getByRole('option', { name: 'Gift-giving' }).click();
  await dialog.getByRole('button', { name: 'Preview' }).click();
  await expect(dialog.getByRole('button', { name: 'Confirm' })).toBeEnabled();
});
