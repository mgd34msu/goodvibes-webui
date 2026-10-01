/**
 * Push "Allow"/"Deny" hand-off: opening the deep link the service worker builds
 * for an approval action button (`#approval-action=…&approval-id=…`) makes the
 * authenticated app run the real approve/deny call and scrub the fragment.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';

test('an Allow hand-off approves the seeded approval and clears the fragment', async ({ page }) => {
  await installMockDaemon(page);

  await page.goto('/?view=approvals-tasks#approval-action=approve&approval-id=appr-e2e-1');

  // A success toast confirms the decision landed.
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  // The one-shot action fragment is scrubbed from the URL.
  await expect.poll(() => new URL(page.url()).hash).not.toContain('approval-action');
  // The approval left Needs you and shows as approved among finished work.
  await expect(page.getByRole('region', { name: 'Needs you' }).locator('.gv-row', { hasText: /^Approve bash/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show' }).click();
  await page.getByRole('option', { name: 'Active and finished' }).click();
  await expect(page.getByRole('region', { name: 'Finished' }).locator('.gv-row', { hasText: /^Approve bash/ })).toContainText('Approved');
});

test('a Deny hand-off denies the seeded approval', async ({ page }) => {
  await installMockDaemon(page);

  await page.goto('/?view=approvals-tasks#approval-action=deny&approval-id=appr-e2e-1');

  await expect.poll(() => new URL(page.url()).hash).not.toContain('approval-action');
  await page.getByRole('button', { name: 'Show' }).click();
  await page.getByRole('option', { name: 'Active and finished' }).click();
  await expect(page.getByRole('region', { name: 'Finished' }).locator('.gv-row', { hasText: /^Approve bash/ })).toContainText('Denied');
});
