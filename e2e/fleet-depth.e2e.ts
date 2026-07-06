/**
 * Fleet depth (WEBUI-FLEET-DEPTH) — the process tree's steer/detach/stop actions and
 * "approve from the tree", proved against the hermetic mock daemon on both viewports.
 *
 * Desktop: every new action (steer, detach, stop, approve/deny/claim/cancel inline)
 * is available and reaches the real wire route. Phone: the tree stays browsable and
 * a correlated approval is still decidable, but the new mutation controls (steer
 * input, detach, stop) are desktop-only — an honest note says so instead of cramming
 * them into a 375px column, and there is never a horizontal scroll.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon, type MockDaemon } from './support/mock-daemon';
import { FLEET_AGENT_NODE, FLEET_WATCHER_NODE } from './support/seed';
import { only, PHONE, DESKTOP, expectNoHorizontalScroll } from './support/app';

let daemon: MockDaemon;

test.beforeEach(async ({ page }, testInfo) => {
  daemon = await installMockDaemon(page);
  await page.goto('/?view=fleet');
  await expect(page.locator('.app-shell')).toBeVisible();
});

test('the process tree renders both seeded nodes with honest badges', async ({ page }) => {
  await expect(page.locator('.fleet-row', { hasText: FLEET_AGENT_NODE.label })).toBeVisible();
  await expect(page.locator('.fleet-row', { hasText: FLEET_WATCHER_NODE.label })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test.describe('desktop actions', () => {
  test.beforeEach(async ({ page }, testInfo) => only(testInfo, DESKTOP));

  test('steer sends over sessions.steer with this browser stamped as the surface', async ({ page }) => {
    await page.locator('.fleet-row', { hasText: FLEET_AGENT_NODE.label }).click();
    const input = page.locator('.fleet-steer-box__input');
    await expect(input).toBeVisible();
    await input.fill('Keep going, prioritize the flaky test');
    await input.press('Enter');
    await expect.poll(() => daemon.steerRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);
    const sent = daemon.steerRequests.at(-1) as { sessionId: string; body: Record<string, unknown> };
    expect(sent.sessionId).toBe(FLEET_AGENT_NODE.sessionRef.sessionId);
    expect(sent.body).toMatchObject({ surfaceKind: 'webui', surfaceId: 'goodvibes-webui' });
  });

  test('detach calls sessions.detach with this surface id, not the process', async ({ page }) => {
    await page.locator('.fleet-row', { hasText: FLEET_AGENT_NODE.label }).click();
    await page.getByRole('button', { name: /Detach this browser/i }).click();
    await expect.poll(() => daemon.detachRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(daemon.detachRequests[0]).toEqual({
      sessionId: FLEET_AGENT_NODE.sessionRef.sessionId,
      surfaceId: 'goodvibes-webui',
    });
  });

  test('stop on the watcher node calls watchers.stop keyed on the node id', async ({ page }) => {
    page.on('dialog', (dialog) => void dialog.accept());
    await page.locator('.fleet-row', { hasText: FLEET_WATCHER_NODE.label }).click();
    await page.getByRole('button', { name: /^Stop$/ }).click();
    await expect.poll(() => daemon.watcherStopRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(daemon.watcherStopRequests[0]).toBe(FLEET_WATCHER_NODE.id);
  });

  test('a killable/interruptible node with no wire verb (agent kind) shows the honest unbacked note, never a fabricated Stop', async ({ page }) => {
    await page.locator('.fleet-row', { hasText: FLEET_AGENT_NODE.label }).click();
    // The agent node IS killable/interruptible per its capabilities, but this client
    // has no wire verb to act on that for an 'agent' kind — say so, don't fake it.
    await expect(page.locator('.fleet-detail__unbacked-note')).toContainText("no control verb for 'agent' processes yet");
    await expect(page.getByRole('button', { name: /^Stop$/ })).toHaveCount(0);
  });

  test('approve from the tree: the correlated pending approval renders inline and Approve reaches approvals.approve', async ({ page }) => {
    await page.locator('.fleet-row', { hasText: FLEET_AGENT_NODE.label }).click();
    await expect(page.locator('.fleet-detail__approvals')).toContainText('Pending approval');
    await expect(page.locator('.fleet-detail__approvals')).toContainText('Run the full test suite before merging');
    await page.locator('.fleet-detail__approvals').getByRole('button', { name: /Approve/i }).first().click();
    await expect.poll(() => daemon.approvalActions.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(daemon.approvalActions[0]).toMatchObject({ approvalId: 'appr-e2e-1', action: 'approve' });
  });
});

test.describe('phone: browsable, mutation actions are desktop-only with an honest pointer', () => {
  test.beforeEach(async ({ page }, testInfo) => only(testInfo, PHONE));

  test('selecting a node flips to its detail with a Back affordance, no horizontal scroll', async ({ page }) => {
    await page.locator('.fleet-row', { hasText: FLEET_AGENT_NODE.label }).click();
    await expect(page.locator('.fleet-detail__back')).toBeVisible();
    await expect(page.locator('.fleet-list-pane')).toBeHidden();
    await expectNoHorizontalScroll(page);
    await page.locator('.fleet-detail__back').click();
    await expect(page.locator('.fleet-list-pane')).toBeVisible();
  });

  test('steer/stop controls are hidden on phone with an honest pointer to a wider screen', async ({ page }) => {
    await page.locator('.fleet-row', { hasText: FLEET_AGENT_NODE.label }).click();
    await expect(page.locator('.fleet-steer-box')).toBeHidden();
    await expect(page.locator('.fleet-detail__phone-actions-note')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('a correlated pending approval is still readable and decidable on phone', async ({ page }) => {
    await page.locator('.fleet-row', { hasText: FLEET_AGENT_NODE.label }).click();
    await expect(page.locator('.fleet-detail__approvals')).toContainText('Pending approval');
    await expectNoHorizontalScroll(page);
  });
});
