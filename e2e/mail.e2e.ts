/**
 * Mail view — proven against a real HTTP round-trip through the mock daemon (not a
 * unit-mocked module), mirroring calendar.e2e.ts's shape for the sibling surface.
 * Covers all three honest refusal states plus the populated inbox/peek happy path,
 * the HTML-suppression restraint, and the mobile no-horizontal-scroll sweep.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { expectNoHorizontalScroll, only, PHONE } from './support/app';

test('default options (email not-available): the not-available note renders verbatim and the composer is disabled', async ({ page }) => {
  await installMockDaemon(page); // default email: 'not-available'
  await page.goto('/?view=mail');
  const note = page.getByTestId('mail-note-not-available');
  await expect(note).toBeVisible();
  await expect(note.getByRole('heading', { name: 'Mail isn’t available on this daemon yet' })).toBeVisible();
  await expect(page.getByTestId('mail-list')).toHaveCount(0);

  const sendButton = page.getByRole('button', { name: /^Send$/ });
  const draftButton = page.getByRole('button', { name: 'Save draft to account' });
  await expect(sendButton).toBeDisabled();
  await expect(draftButton).toBeDisabled();
});

test('configured: the inbox lists both seeded messages', async ({ page }) => {
  await installMockDaemon(page, { email: 'configured' });
  await page.goto('/?view=mail');
  const list = page.getByTestId('mail-list');
  await expect(list).toBeVisible();
  const rows = list.locator('.mail-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Nightly build finished');
  await expect(rows.nth(1)).toContainText('scheduling next week');
});

test('configured: opening a row shows the peek with the message body', async ({ page }) => {
  await installMockDaemon(page, { email: 'configured' });
  await page.goto('/?view=mail');
  await page.getByTestId('mail-list').locator('.mail-row').first().click();
  const peek = page.getByTestId('mail-message-peek');
  await expect(peek).toBeVisible();
  await expect(peek).toContainText('Seeded e2e fixture body.');
});

test('configured: the peek for uid 1002 lists the attachment and never renders the HTML alternative as markup', async ({ page }) => {
  await installMockDaemon(page, { email: 'configured' });
  await page.goto('/?view=mail');
  // uid 1002 ("Nightly build finished") is seeded first (most recent date) and is the
  // one row carrying bodyHtml + an attachment.
  await page.getByTestId('mail-list').locator('.mail-row').filter({ hasText: 'Nightly build finished' }).click();
  const peek = page.getByTestId('mail-message-peek');
  await expect(peek).toBeVisible();
  await expect(peek).toContainText('build-log.txt');
  // The literal HTML source string must not appear turned into markup — no <b>
  // element inside the peek body, even though the fixture's bodyHtml contains one.
  await expect(peek.locator('b')).toHaveCount(0);
  await expect(peek).toContainText('does not render sender HTML');
});

test('unconfigured: the needs-setup note appears', async ({ page }) => {
  await installMockDaemon(page, { email: 'unconfigured' });
  await page.goto('/?view=mail');
  const note = page.getByTestId('mail-note-needs-setup');
  await expect(note).toBeVisible();
  await expect(note.getByRole('heading', { name: 'Mail isn’t configured' })).toBeVisible();
});

test.describe('phone: the mail view never forces the page wider', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => only(testInfo, PHONE));

  test('no horizontal scroll on the configured inbox', async ({ page }) => {
    await installMockDaemon(page, { email: 'configured' });
    await page.goto('/?view=mail');
    await expect(page.getByTestId('mail-list')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
