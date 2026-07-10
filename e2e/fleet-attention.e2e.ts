/**
 * Fleet attention + live subscription — proves the consumer-side attention work
 * against the hermetic mock daemon:
 *
 *   - a node the daemon flagged as needsAttention shows a distinct badge, floats to
 *     the top of its sibling group, and drives a count badge on the Fleet nav entry;
 *   - a needs-input push deep link (?view=fleet#fleet-node=…&fleet-session=…) opens
 *     the Fleet view focused on that node;
 *   - a fleet event delivered over the multiplexed control-plane subscription adds
 *     the announced node to the tree (the subscription drives a live update, not a
 *     poll);
 *   - when the subscription is dropped, the tree still renders from the poll fallback.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { FLEET_AGENT_NODE, FLEET_BLOCKED_NODE, FLEET_EVENT_NODE, FLEET_WATCHER_NODE } from './support/seed';

test('the Fleet nav entry shows an attention count badge for a blocked node', async ({ page }) => {
  await installMockDaemon(page);
  // Start on another view — the badge is derived app-wide, not only on the Fleet view.
  await page.goto('/?view=sessions');
  await expect(page.locator('.app-shell')).toBeVisible();
  // One seeded node (FLEET_BLOCKED_NODE) needs attention → count of 1, named in the
  // nav entry's accessible label and shown as a small badge on the icon.
  await expect(page.getByRole('button', { name: /Fleet, 1 needs attention/ })).toBeVisible();
  await expect(page.locator('.nav-item .nav-attention-badge')).toHaveText('1');
});

test('the blocked node shows a distinct attention badge and floats to the top of the tree', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=fleet');
  await expect(page.locator('.app-shell')).toBeVisible();

  const rows = page.locator('.fleet-row');
  await expect(rows.first()).toContainText(FLEET_BLOCKED_NODE.label);
  // The attention badge names the reason.
  const attention = page.locator('.fleet-row .badge.attention').first();
  await expect(attention).toHaveText('Needs input');
  await expect(attention).toHaveAttribute('data-attention-reason', 'input');
  // The other seeded nodes still render — nothing is dropped.
  await expect(page.locator('.fleet-row', { hasText: FLEET_AGENT_NODE.label })).toBeVisible();
  await expect(page.locator('.fleet-row', { hasText: FLEET_WATCHER_NODE.label })).toBeVisible();
});

test('a needs-input deep link opens the Fleet view focused on the blocked node', async ({ page }) => {
  await installMockDaemon(page);
  // The shape a push notification tap produces (notification-link.ts).
  await page.goto('/?view=fleet#fleet-node=agent-blocked-7&fleet-session=session-blocked');
  await expect(page.locator('.app-shell')).toBeVisible();
  // The node's detail pane is focused (not the default picker).
  const detail = page.locator('.fleet-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText(FLEET_BLOCKED_NODE.label);
  await expect(detail).toContainText('session-blocked');
  // The consumed fragment is scrubbed so a reload does not re-focus it.
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');
});

test('a fleet event over the subscription adds the announced node to the tree', async ({ page }) => {
  await installMockDaemon(page, {
    fleetEvents: [
      { type: 'FLEET_NODE_STARTED', nodeId: FLEET_EVENT_NODE.id, kind: 'agent', label: FLEET_EVENT_NODE.label, state: 'thinking' },
    ],
  });
  await page.goto('/?view=fleet');
  await expect(page.locator('.app-shell')).toBeVisible();
  // The baseline seeded node is there immediately.
  await expect(page.locator('.fleet-row', { hasText: FLEET_AGENT_NODE.label })).toBeVisible();
  // The event-announced node is NOT in the baseline snapshot — it appears only
  // because the fleet frame invalidated the snapshot and the refetch surfaced it.
  await expect(page.locator('.fleet-row', { hasText: FLEET_EVENT_NODE.label })).toBeVisible();
});

test('the tree still renders from the poll fallback when the subscription is dropped', async ({ page }) => {
  await installMockDaemon(page, { dropStreams: true });
  await page.goto('/?view=fleet');
  await expect(page.locator('.app-shell')).toBeVisible();
  // No live subscription (streams close immediately → paused), but the poll-backed
  // snapshot query still populates the tree honestly.
  await expect(page.locator('.fleet-row', { hasText: FLEET_AGENT_NODE.label })).toBeVisible();
  await expect(page.locator('.fleet-row', { hasText: FLEET_BLOCKED_NODE.label })).toBeVisible();
});
