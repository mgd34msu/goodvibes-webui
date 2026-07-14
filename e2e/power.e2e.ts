/**
 * Power — the host sleep-ownership surface (power.status.get/keepAwake.set,
 * SDK 1.8.0). Proves the always-visible "sleep disabled" chip (StatusStrip),
 * the admin Power panel's toggle (ruled shape: one toggle, no timers, no
 * AC-only sub-options), and the "held because X" line, all against the mock
 * daemon. Runs on both phone and desktop (default project set).
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';

test('the sleep-disabled chip is absent when keep-awake is off (honest baseline)', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=admin');
  await expect(page.locator('.stack')).toBeVisible();
  await expect(page.locator('.status-strip__segment--power')).toHaveCount(0);
});

test('toggling keep-awake on in the admin Power panel shows the danger-idiom chip in the status strip', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=admin');
  await expect(page.locator('.stack')).toBeVisible();

  const powerPanel = page.locator('.power-panel');
  await expect(powerPanel).toBeVisible();
  const toggle = powerPanel.getByLabel('Keep this machine awake');
  await expect(toggle).not.toBeChecked();

  await toggle.click();
  await expect(toggle).toBeChecked();

  // The always-visible chip appears in the footer status strip — same event/refetch
  // the real OPS_POWER_STATE_CHANGED wiring drives.
  const chip = page.locator('.status-strip__segment--power');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('Sleep disabled');

  // The panel itself also reflects the held state.
  await expect(powerPanel.locator('.power-panel__state--danger')).toBeVisible();

  // Toggling back off clears both.
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('.status-strip__segment--power')).toHaveCount(0);
});

test('the automatic work inhibitor states "held because X" verbatim when the daemon holds it', async ({ page }) => {
  await installMockDaemon(page, {
    power: { work: { held: true, reasons: ['active turn in session s-agent-live'], grantedClasses: ['idle'] } },
  });
  await page.goto('/?view=admin');
  await expect(page.locator('.stack')).toBeVisible();
  const powerPanel = page.locator('.power-panel');
  await expect(powerPanel).toContainText('Held because: active turn in session s-agent-live');
});

test('the honest lid-split note renders verbatim in both the chip tooltip and the admin panel', async ({ page }) => {
  const note = 'idle sleep blocked; lid-close suspend is controlled by your OS here';
  await installMockDaemon(page, {
    power: { keepAwake: { enabled: true, held: true, grantedClasses: ['idle'], deniedClasses: ['handle-lid-switch'], note } },
  });
  await page.goto('/?view=admin');
  await expect(page.locator('.stack')).toBeVisible();
  await expect(page.locator('.power-panel')).toContainText(note);
  await expect(page.locator('.status-strip__segment--power')).toHaveAttribute('title', note);
});
