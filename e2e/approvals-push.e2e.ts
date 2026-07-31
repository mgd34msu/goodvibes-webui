/**
 * Approvals push (control.approval_update) — the webui's own SSE consumer
 * (useApprovalUpdates), not the SDK's node-side stream helper. Proves a pushed
 * approval-update frame drives a real render change (a new pending card
 * appearing) rather than only the poll fallback — see mock-daemon.ts's
 * approvalUpdateFrames option for how the mock ties the emitted frame to a
 * genuinely new record in the daemon's live approvals store.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { PENDING_APPROVAL, PENDING_APPROVAL_SAME_CLASS } from './support/seed';

test('a pushed approval-update frame renders a new pending approval without a manual refresh', async ({ page }) => {
  await installMockDaemon(page, {
    approvals: [PENDING_APPROVAL],
    approvalUpdateFrames: [PENDING_APPROVAL_SAME_CLASS],
  });
  await page.goto('/?view=approvals-tasks');

  await expect(page.locator('.approvals-toolbar__summary').first()).toContainText('1 pending');
  await expect(page.locator('.approval-card', { hasText: 'Typecheck the workspace' })).toHaveCount(0);

  // The mock emits the seeded approval-update frame ~1s after the subscription
  // opens — no click, no manual refresh: the push path alone drives this.
  await expect(page.locator('.approvals-toolbar__summary').first()).toContainText('2 pending', { timeout: 5000 });
  await expect(page.locator('.approval-card', { hasText: 'Typecheck the workspace' })).toBeVisible();
});

test('while push has not connected, the toolbar states it is polling — never a silent "Live" claim', async ({ page }) => {
  await installMockDaemon(page, { approvals: [PENDING_APPROVAL] });
  await page.goto('/?view=approvals-tasks');
  await expect(page.locator('.approvals-toolbar__mode')).toContainText('Polling every 15s');
});
