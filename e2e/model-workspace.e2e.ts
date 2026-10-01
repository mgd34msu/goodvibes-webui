/**
 * Model Workspace, the multi-target model picker (main/helper/tool/tts/
 * embeddings) launched from the "Change" button beside the current model in
 * Settings, Models and providers. Runs on
 * BOTH phone and desktop (no `only()` gate): the modal must be usable at
 * either width, per the honest-bar (no horizontal scroll, no broken control).
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { expectNoHorizontalScroll, only, openSettings, PHONE, expectBottomSheet } from './support/app';

test.beforeEach(async ({ page }) => {
  await installMockDaemon(page);
  const settings = await openSettings(page, 'models');
  await expect(settings.getByTestId('current-model')).toBeVisible();
});

test.describe('phone: the dialog is a full-width bottom sheet (MOBILE-ADAPT)', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => only(testInfo, PHONE));

  test('the panel is a tall bottom sheet instead of floating as a centered card', async ({ page }) => {
    await page.getByRole('button', { name: 'Change model' }).click();
    const dialog = page.getByRole('dialog', { name: 'Model Workspace' });
    await expect(dialog).toBeVisible();
    // A phone dialog is a bottom sheet: full width on the bottom edge, and this
    // one's content makes it as tall as a sheet gets (32 short of the top).
    await expectBottomSheet(page, dialog, { minHeight: 844 - 32 - 1 });
    await expectNoHorizontalScroll(page);
  });
});

test('opens from the "Change model" launcher and shows all five TUI-parity targets', async ({ page }) => {
  await page.getByRole('button', { name: 'Change model' }).click();
  const dialog = page.getByRole('dialog', { name: 'Model Workspace' });
  await expect(dialog).toBeVisible();
  for (const label of ['Main Chat', 'Helper Model', 'Tool LLM', 'TTS LLM', 'Embeddings']) {
    await expect(dialog.getByRole('tab', { name: label })).toBeVisible();
  }
  await expectNoHorizontalScroll(page);
});

test('Escape closes the workspace and leaves the settings dialog open underneath', async ({ page }) => {
  await page.getByRole('button', { name: 'Change model' }).click();
  const dialog = page.getByRole('dialog', { name: 'Model Workspace' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
});

test('the price filter is honestly enabled, real tier data exists in the fixture', async ({ page }) => {
  await page.getByRole('button', { name: 'Change model' }).click();
  const dialog = page.getByRole('dialog', { name: 'Model Workspace' });
  await expect(dialog.getByText('gpt-5', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Price' })).toBeEnabled();
});

test('the capability filter is honestly disabled, no daemon serves that data today', async ({ page }) => {
  await page.getByRole('button', { name: 'Change model' }).click();
  const dialog = page.getByRole('dialog', { name: 'Model Workspace' });
  await expect(dialog.getByText('Not reported by this daemon').first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Capability' })).toBeDisabled();
});

test('main target: selecting GPT-5 calls models.select and the current-model panel updates honestly', async ({ page }) => {
  await page.getByRole('button', { name: 'Change model' }).click();
  const dialog = page.getByRole('dialog', { name: 'Model Workspace' });
  const gptRow = dialog.locator('.providers-model-row', { hasText: 'gpt-5' });
  await gptRow.getByRole('button', { name: 'Use' }).click();
  await expect(gptRow.getByRole('button', { name: 'Current' })).toBeVisible();
  await page.keyboard.press('Escape');
  // The settings section's own "Current model" block reflects the same mutated state.
  await expect(page.getByTestId('current-model')).toContainText('gpt-5');
});

test('helper target: selecting a model routes through config.set, not models.select; the main selection is untouched', async ({ page }) => {
  await page.getByRole('button', { name: 'Change model' }).click();
  const dialog = page.getByRole('dialog', { name: 'Model Workspace' });
  await dialog.getByRole('tab', { name: 'Helper Model' }).click();
  await expect(dialog.getByText('not configured')).toBeVisible();
  const gptRow = dialog.locator('.providers-model-row', { hasText: 'gpt-5' });
  await gptRow.getByRole('button', { name: 'Use' }).click();
  await expect(dialog.getByText(/Helper Model:/)).toContainText('openai:gpt-5');
  // Switching back to Main Chat shows the ORIGINAL current model, unaffected by the
  // helper write, proves the two targets are genuinely independent config keys.
  await dialog.getByRole('tab', { name: 'Main Chat' }).click();
  await expect(dialog.getByText(/Main Chat:/)).toContainText('claude-opus-4-8');
});

test('embeddings target has no model concept; lists providers only, "Use" writes the provider id alone', async ({ page }) => {
  await page.getByRole('button', { name: 'Change model' }).click();
  const dialog = page.getByRole('dialog', { name: 'Model Workspace' });
  await dialog.getByRole('tab', { name: 'Embeddings' }).click();
  await expect(dialog.getByText('no model selection')).toBeVisible();
  await expect(dialog.getByText('claude-opus-4-8')).toHaveCount(0);
  const openaiRow = dialog.locator('.providers-model-row', { hasText: 'openai' });
  await openaiRow.getByRole('button', { name: 'Use' }).click();
  await expect(openaiRow.getByRole('button', { name: 'Current' })).toBeVisible();
});
