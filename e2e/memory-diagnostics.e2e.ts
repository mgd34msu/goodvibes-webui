/**
 * Memory diagnostics — the daemon's memory-governance observability surface
 * (ops.memory.get, SDK 1.9.0-dev). Proves the admin Memory panel's tier chip,
 * budget-vs-RSS bar, per-cache footprint table, paused-jobs list, and tripwire
 * line against the mock daemon, plus the honest "does not serve" state on an
 * older daemon build. Runs on both phone and desktop (default project set).
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';

test('the elevated-tier snapshot renders the chip, bar, caches, paused job, and tripwire line', async ({ page }) => {
  await installMockDaemon(page); // default seed: the representative 'elevated' snapshot
  await page.goto('/?view=admin');
  await expect(page.locator('.stack')).toBeVisible();

  const panel = page.locator('.memory-diagnostics');
  await expect(panel).toBeVisible();

  // Tier chip — the existing .badge idiom, info tone for 'elevated'.
  const chip = panel.locator('.badge');
  await expect(chip).toHaveText('Elevated');
  await expect(chip).toHaveClass(/info/);

  // Budget-vs-RSS bar, labeled with the real numbers (never placeholders).
  await expect(panel).toContainText('700 MB of 1024 MB budget');
  await expect(panel.locator('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '68');

  // Per-cache footprint table.
  await expect(panel.locator('.memory-diagnostics__caches')).toContainText('Knowledge embeddings');
  await expect(panel.locator('.memory-diagnostics__caches')).toContainText('4200');
  await expect(panel.locator('.memory-diagnostics__caches')).toContainText('15.0 MB');

  // Paused deferrable jobs.
  await expect(panel).toContainText('knowledge.reindex');

  // Tripwire line (not armed in the default seed).
  await expect(panel).toContainText('Leak tripwire: not armed.');
});

test('a critical-tier snapshot shows the danger chip, the refusing-work note, and the armed tripwire', async ({ page }) => {
  await installMockDaemon(page, {
    opsMemory: {
      tier: 'critical',
      usedPct: 97,
      rssMb: 993,
      refusingExpensiveWork: true,
      tripwire: { armed: true, sustainedSec: 45, rateMbPerSec: 3.2 },
    },
  });
  await page.goto('/?view=admin');
  await expect(page.locator('.stack')).toBeVisible();

  const panel = page.locator('.memory-diagnostics');
  const chip = panel.locator('.badge');
  await expect(chip).toHaveText('Critical');
  await expect(chip).toHaveClass(/bad/);
  await expect(panel).toContainText('Refusing expensive work while under pressure.');
  await expect(panel).toContainText('Leak tripwire: armed — sustained growth of 3.2 MB/s for 45s.');
});

test('an older daemon build (verb absent, 404) renders the honest "does not serve" state — and never sinks the sibling panels', async ({ page }) => {
  await installMockDaemon(page, { opsMemory: 'unavailable' });
  await page.goto('/?view=admin');
  await expect(page.locator('.stack')).toBeVisible();

  const panel = page.locator('.memory-diagnostics');
  await expect(panel).toContainText('This daemon does not serve memory diagnostics');
  // No placeholder numbers anywhere in the unavailable state.
  await expect(panel.locator('[role="progressbar"]')).toHaveCount(0);
  // The sibling Power panel is untouched — the unavailable state is contained.
  await expect(page.locator('.power-panel')).toBeVisible();
});
