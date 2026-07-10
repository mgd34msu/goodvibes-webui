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

  // The approval resolves to approved (the mock flips its status on the real POST).
  await expect(page.locator('.approval-card').first()).toContainText('approved');
  // A success toast confirms the decision landed.
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  // The one-shot action fragment is scrubbed from the URL.
  await expect.poll(() => new URL(page.url()).hash).not.toContain('approval-action');
});

test('a Deny hand-off denies the seeded approval', async ({ page }) => {
  await installMockDaemon(page);

  await page.goto('/?view=approvals-tasks#approval-action=deny&approval-id=appr-e2e-1');

  await expect(page.locator('.approval-card').first()).toContainText('denied');
  await expect.poll(() => new URL(page.url()).hash).not.toContain('approval-action');
});
