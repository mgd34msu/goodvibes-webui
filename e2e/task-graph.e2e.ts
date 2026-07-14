/**
 * Task graph (fleet.graph.get, SDK 1.8.0's fix-phase workstream rework) —
 * the dependency-graph view of one workstream rendered in the
 * workstream/fleet detail pane. Proves the represented state tells
 * (ready/running/blocked/at-cap/stalled) render legibly against the mock
 * daemon's representative fixture (fleetGraphResponse). Runs on both phone
 * and desktop.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { FLEET_GRAPH_WORKSTREAM_NODE } from './support/seed';
import { expectNoHorizontalScroll } from './support/app';

test('the task graph renders every state tell for the selected workstream', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=workstream');
  await expect(page.locator('.app-shell')).toBeVisible();

  await page.locator('.workstream-row', { hasText: FLEET_GRAPH_WORKSTREAM_NODE.label }).click();
  const panel = page.locator('.task-graph-panel');
  await expect(panel).toBeVisible();

  // Pool summary — the brief's own vocabulary verbatim, plus the daemon's own
  // more specific spawn-refusal detail appended honestly.
  await expect(panel.locator('[data-testid="task-graph-pool"]')).toHaveText(
    '1 ready, 2 running, at cap (fleet.maxSize=2) — new spawns wait for a running agent to free a slot',
  );

  // Every state tell from the representative fixture. Filter by the row's
  // TITLE element specifically (not the whole row's text) — "waiting on: Fix
  // null-check in session close" (the blocked row's reason) would otherwise
  // ambiguously match the ready row's own title text too.
  const rows = panel.locator('[data-testid="task-graph-node"]');
  await expect(rows).toHaveCount(5);
  const rowByTitle = (title: string) => rows.filter({ has: page.locator('.task-graph-node__title', { hasText: title }) });
  await expect(rowByTitle('Fix null-check in session close')).toContainText('Ready');
  await expect(rowByTitle('Add regression test for the race')).toContainText('Running');
  const blockedRow = rowByTitle('Update the changelog entry');
  await expect(blockedRow).toContainText('Blocked');
  await expect(blockedRow).toContainText('waiting on: Fix null-check in session close');
  await expect(rowByTitle('Refactor the retry loop')).toContainText('Stalled');
  await expect(rowByTitle('Tighten the timeout constant')).toContainText('Done');

  await expectNoHorizontalScroll(page);
});

test('the task graph also renders from the Fleet view detail pane for the same workstream', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=fleet');
  await expect(page.locator('.app-shell')).toBeVisible();

  await page.locator('.fleet-row', { hasText: FLEET_GRAPH_WORKSTREAM_NODE.label }).click();
  await expect(page.locator('.task-graph-panel')).toBeVisible();
  await expect(page.locator('[data-testid="task-graph-node"]')).toHaveCount(5);
});
