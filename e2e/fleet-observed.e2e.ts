/**
 * Fleet observed foreign agents (SDK 1.8.0) — externally-launched coding-agent
 * sessions goodvibes did not spawn, proven end to end against the hermetic mock
 * daemon on both viewports. Visibility only: honest external kind + liveness,
 * excluded from own-agent counts, no stop ever, steer only in the drill-in and
 * only when a genuine channel exists.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon, type MockDaemon } from './support/mock-daemon';
import { FLEET_AGENT_NODE, FLEET_OBSERVED_STEERABLE_NODE, FLEET_OBSERVED_NO_CHANNEL_NODE } from './support/seed';
import { expectNoHorizontalScroll, expectTappable, only, PHONE } from './support/app';

let daemon: MockDaemon;

test.beforeEach(async ({ page }) => {
  daemon = await installMockDaemon(page);
  await page.goto('/?view=fleet');
  await expect(page.locator('.app-shell')).toBeVisible();
});

test('both observed rows render with their honest external-kind label', async ({ page }) => {
  await expect(page.locator('.fleet-row', { hasText: FLEET_OBSERVED_STEERABLE_NODE.label })).toBeVisible();
  await expect(page.locator('.fleet-row', { hasText: FLEET_OBSERVED_NO_CHANNEL_NODE.label })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('observed rows are excluded from the own-agent "N node(s) / M active" counts', async ({ page }) => {
  const summary = page.locator('.fleet-toolbar__summary');
  // FLEET_AGENT_NODE is the one real own-agent in the seeded snapshot — the two
  // observed rows are named separately ("2 observed (external)"), never folded in.
  await expect(summary).toContainText('2 observed (external)');
  await expect(page.locator('.fleet-row', { hasText: FLEET_AGENT_NODE.label })).toBeVisible();
});

test('the steerable observed row: drill-in shows pid + channel and steer reaches fleet.observed.steer', async ({ page }) => {
  await page.locator('.fleet-row', { hasText: FLEET_OBSERVED_STEERABLE_NODE.label }).click();
  await expect(page.locator('.fleet-detail__observed')).toBeVisible();
  await expect(page.locator('.fleet-detail__observed')).toContainText(String(FLEET_OBSERVED_STEERABLE_NODE.observed.pid));
  await expect(page.locator('.fleet-detail__observed')).toContainText('tmux pane %3');

  // No stop/archive ever, for an observed row.
  await expect(page.getByRole('button', { name: /^Stop$/ })).toHaveCount(0);

  await page.locator('.fleet-detail__observed-steer textarea').fill('status check');
  await page.locator('.fleet-detail__observed-steer button', { hasText: 'Send' }).click();
  await expect.poll(() => daemon.observedSteerRequests).toEqual([{ id: FLEET_OBSERVED_STEERABLE_NODE.id, text: 'status check' }]);
  await expect(page.getByText('Sent')).toBeVisible();
});

test('the no-channel observed row renders the honest reason, never a dead send button', async ({ page }) => {
  await page.locator('.fleet-row', { hasText: FLEET_OBSERVED_NO_CHANNEL_NODE.label }).click();
  await expect(page.locator('.fleet-detail__observed-steer')).toHaveCount(0);
  await expect(page.locator('.fleet-detail__observed-no-channel')).toHaveText(FLEET_OBSERVED_NO_CHANNEL_NODE.observed.steer.reason);
  await expect(page.getByRole('button', { name: /^Stop$/ })).toHaveCount(0);
});

test.describe('phone: the observed drill-in stays legible, unlike the desktop-only owned-node actions', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => only(testInfo, PHONE));

  test('the steer composer and its send button clear the 44px tap-target floor, no horizontal scroll', async ({ page }) => {
    await page.locator('.fleet-row', { hasText: FLEET_OBSERVED_STEERABLE_NODE.label }).click();
    await expect(page.locator('.fleet-detail__observed')).toBeVisible();
    await expectTappable(page, '.fleet-detail__observed-steer textarea', 'observed steer textarea');
    await expectTappable(page, '.fleet-detail__observed-steer button', 'observed steer send button');
    await expectNoHorizontalScroll(page);
  });
});
