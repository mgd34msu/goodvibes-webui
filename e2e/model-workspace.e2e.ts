/**
 * Model Workspace — the multi-target model picker (main/helper/tool/tts/
 * embeddings) launched from ProvidersView's "Browse Models" button. Runs on
 * BOTH phone and desktop (no `only()` gate): the modal must be usable at
 * either width, per the honest-bar (no horizontal scroll, no broken control).
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { expectNoHorizontalScroll, only, PHONE } from './support/app';

test.beforeEach(async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=providers');
  await expect(page.locator('.split-layout')).toBeVisible();
});

test.describe('phone: the modal is a near-fullscreen sheet (MOBILE-ADAPT)', () => {
  test.beforeEach(async ({ page }, testInfo) => only(testInfo, PHONE));

  test('the panel fills the viewport instead of floating as a centered card', async ({ page }) => {
    await page.getByRole('button', { name: 'Browse Models' }).click();
    const dialog = page.getByRole('dialog', { name: 'Model Workspace' });
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

test('opens from the "Browse Models" launcher and shows all five TUI-parity targets', async ({ page }) => {
  await page.getByRole('button', { name: 'Browse Models' }).click();
  const dialog = page.getByRole('dialog', { name: 'Model Workspace' });
  await expect(dialog).toBeVisible();
  for (const label of ['Main Chat', 'Helper Model', 'Tool LLM', 'TTS LLM', 'Embeddings']) {
    await expect(dialog.getByRole('tab', { name: label })).toBeVisible();
  }
  await expectNoHorizontalScroll(page);
});

test('Escape closes the dialog', async ({ page }) => {
  await page.getByRole('button', { name: 'Browse Models' }).click();
  const dialog = page.getByRole('dialog', { name: 'Model Workspace' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('the price filter is honestly enabled — real tier data exists in the fixture', async ({ page }) => {
  await page.getByRole('button', { name: 'Browse Models' }).click();
  const dialog = page.getByRole('dialog', { name: 'Model Workspace' });
  await expect(dialog.getByText('gpt-5', { exact: true })).toBeVisible();
  await expect(dialog.locator('.model-workspace-filter', { hasText: 'Price' }).locator('select')).toBeEnabled();
});

test('the capability filter is honestly disabled — no daemon serves that data today', async ({ page }) => {
  await page.getByRole('button', { name: 'Browse Models' }).click();
  const dialog = page.getByRole('dialog', { name: 'Model Workspace' });
  await expect(dialog.getByText('Not reported by this daemon').first()).toBeVisible();
  await expect(dialog.locator('.model-workspace-filter', { hasText: 'Capability' }).locator('select')).toBeDisabled();
});

test('main target: selecting GPT-5 calls models.select and the current-model panel updates honestly', async ({ page }) => {
  await page.getByRole('button', { name: 'Browse Models' }).click();
  const dialog = page.getByRole('dialog', { name: 'Model Workspace' });
  const gptRow = dialog.locator('.providers-model-row', { hasText: 'gpt-5' });
  await gptRow.getByRole('button', { name: 'Use' }).click();
  await expect(gptRow.getByRole('button', { name: 'Current' })).toBeVisible();
  await page.keyboard.press('Escape');
  // The Providers view's own "Current Model" panel reflects the same mutated state.
  await expect(page.locator('.providers-current-model')).toContainText('gpt-5');
});

test('helper target: selecting a model routes through config.set, not models.select — the main selection is untouched', async ({ page }) => {
  await page.getByRole('button', { name: 'Browse Models' }).click();
  const dialog = page.getByRole('dialog', { name: 'Model Workspace' });
  await dialog.getByRole('tab', { name: 'Helper Model' }).click();
  await expect(dialog.getByText('not configured')).toBeVisible();
  const gptRow = dialog.locator('.providers-model-row', { hasText: 'gpt-5' });
  await gptRow.getByRole('button', { name: 'Use' }).click();
  await expect(dialog.getByText(/Helper Model:/)).toContainText('openai:gpt-5');
  // Switching back to Main Chat shows the ORIGINAL current model, unaffected by the
  // helper write — proves the two targets are genuinely independent config keys.
  await dialog.getByRole('tab', { name: 'Main Chat' }).click();
  await expect(dialog.getByText(/Main Chat:/)).toContainText('claude-opus-4-8');
});

test('embeddings target has no model concept — lists providers only, "Use" writes the provider id alone', async ({ page }) => {
  await page.getByRole('button', { name: 'Browse Models' }).click();
  const dialog = page.getByRole('dialog', { name: 'Model Workspace' });
  await dialog.getByRole('tab', { name: 'Embeddings' }).click();
  await expect(dialog.getByText('no model selection')).toBeVisible();
  await expect(dialog.getByText('claude-opus-4-8')).toHaveCount(0);
  const openaiRow = dialog.locator('.providers-model-row', { hasText: 'openai' });
  await openaiRow.getByRole('button', { name: 'Use' }).click();
  await expect(openaiRow.getByRole('button', { name: 'Current' })).toBeVisible();
});
