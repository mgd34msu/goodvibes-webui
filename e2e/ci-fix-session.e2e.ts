/**
 * CI fix-session — the "open session" affordances, on both start paths:
 *   - auto-start: the started id rides the ci.watches.run verb result
 *     (SDK 8eecbd32) — the CI view offers Open fix session.
 *   - accepted "fix this?" offer: the broker stamps the started id onto the
 *     resolved APPROVED approval record, published live (SDK 1d6a85e2) — the
 *     approvals view's resolved card offers Open fix session once the record
 *     updates post-acceptance.
 * Both navigate to the session's chat view so the operator can watch or steer
 * the fix as it works.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { gotoView } from './support/app';
import { CI_FIX_OFFER_APPROVAL } from './support/seed';

test('a failed watch that starts a fix session offers to open it, and opening navigates to the session', async ({ page }) => {
  await installMockDaemon(page);
  await gotoView(page, 'ci-watches');

  // Create a watch that starts a fix session on failure. Scope to the list
  // pane's create form — the detail pane's ad-hoc lookup shares field labels.
  await page.getByRole('button', { name: 'New watch' }).click();
  const createForm = page.locator('.ci-watches-list-pane form');
  await createForm.getByLabel('Repository').fill('acme/example');
  await createForm.getByLabel('Delivery channel').fill('slack:#ci');
  await createForm.getByLabel('Start a fix-session on failure').check();
  await createForm.getByRole('button', { name: /Create watch/ }).click();

  // Select the new watch — it carries the "fix-session on failure" badge, which
  // tells it apart from the seeded passing watch on the same repo — and run it.
  await page.locator('.ci-watches-row', { hasText: 'fix-session on failure' }).click();
  await page.getByRole('button', { name: /Check now/ }).click();

  await expect(page.getByText('A fix-session was started.')).toBeVisible();
  const openButton = page.getByRole('button', { name: 'Open fix session' });
  await expect(openButton).toBeVisible();

  await openButton.click();
  // The affordance navigates to the session's chat view. (The mock hosts no live
  // runtime for this id, so the chat view reconciles the session param to its own
  // default once mounted — the navigation to the chat surface is the proof here;
  // the exact verb-result id is pinned by the component test.)
  await expect(page).toHaveURL(/view=chat/);
  await expect(page.locator('.ci-watches-view')).toHaveCount(0);
});

test('accepting a "fix this?" offer updates the record with the spawned session id, and opening lands on chat', async ({ page }) => {
  const daemon = await installMockDaemon(page, { approvals: [CI_FIX_OFFER_APPROVAL] });
  await gotoView(page, 'approvals-tasks');

  // The offer renders as a normal approval card; accept it.
  const card = page.locator('.approval-card', { hasText: 'start a fix session for lint?' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Approve', exact: true }).click();
  expect(daemon.approvalActions[0]).toMatchObject({ approvalId: CI_FIX_OFFER_APPROVAL.id, action: 'approve' });

  // Post-acceptance the record updates (broker stamp, published live — here via
  // the approve-driven refetch) and the resolved card gains the affordance.
  const openButton = card.getByRole('button', { name: /Open fix session/ });
  await expect(openButton).toBeVisible();
  await openButton.click();
  await expect(page).toHaveURL(/view=chat/);
  await expect(page.locator('.approvals-tasks-view')).toHaveCount(0);
});

test('denying a "fix this?" offer never grows an open-session affordance', async ({ page }) => {
  await installMockDaemon(page, { approvals: [CI_FIX_OFFER_APPROVAL] });
  await gotoView(page, 'approvals-tasks');
  const card = page.locator('.approval-card', { hasText: 'start a fix session for lint?' });
  await card.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(card).toContainText('denied');
  await expect(card.getByRole('button', { name: /Open fix session/ })).toHaveCount(0);
});

test('a passing watch (or one without fix-on-failure) shows no open-session affordance', async ({ page }) => {
  // The seeded watch has triggerFixSession:false — running it never starts a fix session.
  await installMockDaemon(page);
  await gotoView(page, 'ci-watches');
  await page.locator('.ci-watches-row', { hasText: 'acme/example' }).click();
  await page.getByRole('button', { name: /Check now/ }).click();
  await expect(page.locator('.ci-report')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open fix session' })).toHaveCount(0);
});
