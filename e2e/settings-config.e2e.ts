/**
 * Settings modal — the config/settings surface (config.get/config.set),
 * per the platform's surface doctrine: configuration lives in a modal, not
 * an always-visible page section. Runs on BOTH phone and desktop.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { expectNoHorizontalScroll, only, PHONE } from './support/app';
import { FEATURE_SETTINGS } from '../src/lib/generated/config-schema';

test.beforeEach(async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=admin');
  await expect(page.locator('.stack')).toBeVisible();
});

test.describe('phone: the modal is a near-fullscreen sheet (MOBILE-ADAPT)', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => only(testInfo, PHONE));

  test('the panel fills the viewport instead of floating as a centered card', async ({ page }) => {
    await page.getByRole('button', { name: 'Open Settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (box && viewport) {
      expect(box.width).toBeGreaterThanOrEqual(viewport.width - 2);
      expect(box.height).toBeGreaterThanOrEqual(viewport.height - 2);
    }
    await expectNoHorizontalScroll(page);
  });
});

test('opens from the "Open Settings" launcher and shows domain categories — no enablement bucket', async ({ page }) => {
  await page.getByRole('button', { name: 'Open Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Display' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Helper' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Surfaces' })).toBeVisible();
  // Capability domains are first-class categories now.
  await expect(dialog.getByRole('button', { name: 'Permissions' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Behavior' })).toBeVisible();
  // The dissolved enablement bucket never renders as a category or anywhere else.
  await expect(dialog.getByRole('button', { name: 'Feature Flags' })).toHaveCount(0);
  await expect(dialog.getByText('Feature Flags')).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test('changing an enum feature mode writes the domain key and survives reopen', async ({ page }) => {
  await page.getByRole('button', { name: 'Open Settings' }).click();
  let dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Behavior' }).click();
  const unit = dialog.locator('[data-feature-id="hitl-ux-modes"]');
  await expect(unit).toBeVisible();
  const mode = unit.getByLabel('HITL UX Modes mode');
  await expect(mode).toHaveValue('balanced'); // live seeded value
  // The full schema mode set is a real choice list — the inactive mode included.
  await expect(mode.locator('option')).toHaveText(['off', 'quiet', 'balanced', 'operator']);
  await mode.selectOption('quiet');
  await expect(page.getByText('Config saved')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Reopen: the mock daemon's mutable config tree round-trips the domain key.
  await page.getByRole('button', { name: 'Open Settings' }).click();
  dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Behavior' }).click();
  await expect(dialog.locator('[data-feature-id="hitl-ux-modes"]').getByLabel('HITL UX Modes mode')).toHaveValue('quiet');
});

test('toggling a boolean feature writes true/false to its domain key; a runtime-toggleable one shows no restart marker', async ({ page }) => {
  await page.getByRole('button', { name: 'Open Settings' }).click();
  let dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Permissions' }).click();
  const unit = dialog.locator('[data-feature-id="permission-divergence-dashboard"]');
  await expect(unit).toBeVisible();
  const toggle = unit.getByLabel('Enable Divergence Dashboard and Enforce Gate');
  await expect(toggle).toBeChecked(); // ruled default: on
  await toggle.click();
  await expect(page.getByText('Config saved')).toBeVisible();
  // Immediate-apply feature: no pending-restart marker, honestly.
  await expect(unit.locator('[data-pending-restart]')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Reopen: the write persisted onto the domain key (permissions.divergenceDashboard=false).
  await page.getByRole('button', { name: 'Open Settings' }).click();
  dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Permissions' }).click();
  await expect(
    dialog.locator('[data-feature-id="permission-divergence-dashboard"]').getByLabel('Enable Divergence Dashboard and Enforce Gate'),
  ).not.toBeChecked();
});

test('a restart-gated feature states it up front and marks pending-restart at the point of change', async ({ page }) => {
  await page.getByRole('button', { name: 'Open Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Permissions' }).click();
  const unit = dialog.locator('[data-feature-id="permissions-simulation"]');
  await expect(unit).toBeVisible();
  await expect(unit.getByText('Enablement changes apply after a daemon restart.')).toBeVisible();
  await expect(unit.locator('[data-pending-restart]')).toHaveCount(0);
  await unit.getByLabel('Enable Permissions Simulation Mode').click();
  await expect(page.getByText('Config saved')).toBeVisible();
  const marker = unit.locator('[data-pending-restart="permissions-simulation"]');
  await expect(marker).toBeVisible();
  await expect(marker).toContainText('takes effect when the daemon restarts');
});

test('a feature description renders complete and un-clipped at phone width', async ({ page }, testInfo) => {
  only(testInfo, PHONE);
  await page.getByRole('button', { name: 'Open Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Behavior' }).click();
  const desc = dialog.locator('[data-feature-id="hitl-ux-modes"] .feature-unit-desc');
  await expect(desc).toBeVisible();
  // Character-exact parity with the SDK's full description — no truncation.
  const meta = FEATURE_SETTINGS.find((f) => f.id === 'hitl-ux-modes');
  if (!meta) throw new Error('hitl-ux-modes missing from the generated feature snapshot');
  await expect(desc).toHaveText(meta.description);
  // And the rendered box holds the whole text: wrap, never clip.
  const clipped = await desc.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(clipped.scrollWidth, 'description overflows horizontally').toBeLessThanOrEqual(clipped.clientWidth + 1);
  expect(clipped.scrollHeight, 'description is vertically clipped').toBeLessThanOrEqual(clipped.clientHeight + 1);
  await expectNoHorizontalScroll(page);
});

test('a secret-shaped surfaces.* key never renders its raw value', async ({ page }) => {
  await page.getByRole('button', { name: 'Open Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Surfaces' }).click();
  await expect(dialog.getByText('surfaces.slack.botToken')).toBeVisible();
  await expect(dialog.getByText('xoxb-e2e-hermetic-secret-9999')).toHaveCount(0);
  // Last 4 chars only, per the mask contract. Every secret-typed key renders a
  // masked cell (the unset ones read "(unset)"), so scope to the one key that
  // actually holds a value rather than matching all masked cells at once.
  await expect(
    dialog.locator('[data-config-key="surfaces.slack.botToken"] .settings-value--secret'),
  ).toContainText('9999');
});

test('an admin-scope refusal renders honestly, distinct from a generic failure', async ({ page }) => {
  await installMockDaemon(page, { config: 'admin-required' });
  await page.goto('/?view=admin');
  await page.getByRole('button', { name: 'Open Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByText('Admin access required')).toBeVisible();
});

test('the Advanced editor writes through config.set and the change is honestly reflected on reopen', async ({ page }) => {
  await page.getByRole('button', { name: 'Open Settings' }).click();
  let dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByPlaceholder('settings.path').fill('display.theme');
  await dialog.getByPlaceholder('JSON or text').fill('"cyberpunk"');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Config saved')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Reopen: the Display category's typed editor for display.theme shows the value
  // just written, proving this is a real config.get/config.set round-trip, not a
  // client-side-only form. display.theme is a schema-known string key, so it
  // renders as a labelled text input — the written value lives in that field's
  // value, not as free-standing page text.
  await page.getByRole('button', { name: 'Open Settings' }).click();
  dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByLabel('display.theme')).toHaveValue('cyberpunk');
});
