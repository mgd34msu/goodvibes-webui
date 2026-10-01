/**
 * Fleet observed foreign agents (SDK 1.8.0), externally-launched coding-agent
 * sessions goodvibes did not spawn, proven end to end against the hermetic mock
 * daemon on both viewports. Visibility only: honest external kind + liveness,
 * excluded from own-agent counts, no stop ever, steer only in the drill-in and
 * only when a genuine channel exists.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon, type MockDaemon } from './support/mock-daemon';
import {
  FLEET_AGENT_NODE,
  FLEET_OBSERVED_STEERABLE_NODE,
  FLEET_OBSERVED_NO_CHANNEL_NODE,
  FLEET_OBSERVED_NO_CHANNEL_REASON,
} from './support/seed';
import { expectNoHorizontalScroll, expectTappable, listRow, only, openRow, PHONE } from './support/app';

let daemon: MockDaemon;

test.beforeEach(async ({ page }) => {
  daemon = await installMockDaemon(page);
  await page.goto('/?view=work&tab=agents');
  await expect(page.locator('.app-shell')).toBeVisible();
});

test('both observed rows render with their honest external-kind label', async ({ page }) => {
  await expect(listRow(page, FLEET_OBSERVED_STEERABLE_NODE.label)).toContainText('External');
  await expect(listRow(page, FLEET_OBSERVED_NO_CHANNEL_NODE.label)).toContainText('External');
  await expectNoHorizontalScroll(page);
});

test('observed rows are counted on their own, never folded into "running"', async ({ page }) => {
  await expect(page.locator('.dv-description')).toContainText('2 external');
  await expect(listRow(page, FLEET_AGENT_NODE.label)).toBeVisible();
});

test('the steerable observed row: detail shows pid + channel and steer reaches fleet.observed.steer', async ({ page }) => {
  const detail = await openRow(page, FLEET_OBSERVED_STEERABLE_NODE.label);
  await expect(detail).toContainText(String(FLEET_OBSERVED_STEERABLE_NODE.observed.pid));
  await expect(detail).toContainText('tmux pane %3');

  // No stop or archive, ever, for an observed row.
  await expect(detail.getByRole('button', { name: /^Stop$/ })).toHaveCount(0);

  const form = detail.getByRole('form', { name: 'Observed foreign agent' });
  await form.locator('textarea').fill('status check');
  await form.getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => daemon.observedSteerRequests).toEqual([{ id: FLEET_OBSERVED_STEERABLE_NODE.id, text: 'status check' }]);
  await expect(page.getByText('Sent', { exact: true })).toBeVisible();
});

test('the no-channel observed row renders the honest reason, never a dead send button', async ({ page }) => {
  const detail = await openRow(page, FLEET_OBSERVED_NO_CHANNEL_NODE.label);
  await expect(detail.getByRole('form', { name: 'Observed foreign agent' })).toHaveCount(0);
  await expect(detail.getByRole('note').filter({ hasText: FLEET_OBSERVED_NO_CHANNEL_REASON })).toBeVisible();
  await expect(detail.getByRole('button', { name: /^Stop$/ })).toHaveCount(0);
});

test.describe('phone: the observed detail stays legible', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => only(testInfo, PHONE));

  test('the steer field and its send button clear the 44px tap-target floor, no horizontal scroll', async ({ page }) => {
    await openRow(page, FLEET_OBSERVED_STEERABLE_NODE.label);
    await expectTappable(page, '.dv-detail form[aria-label="Observed foreign agent"] textarea', 'observed steer textarea');
    await expectTappable(page, '.dv-detail form[aria-label="Observed foreign agent"] button', 'observed steer send button');
    await expectNoHorizontalScroll(page);
  });
});
