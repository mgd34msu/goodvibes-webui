/**
 * Turn control — server-side stop, steer, and queue-when-busy (SDK 1.4).
 *
 * Hermetic against the stateful chat mock in holdReplies mode: a send leaves
 * the turn visibly active so Stop / steer / queued markers are exercisable.
 * Runs on desktop (Ctrl+Enter steer) and phone (hold-to-steer) projects.
 */
import { test, expect } from '@playwright/test';
import { installChatMockDaemon } from './support/chat-mock';

const COMPOSER = 'textarea[aria-label="Message GoodVibes"]';

test('Stop requests the server-side cancel; the honest stopped partial lands in the transcript', async ({ page }) => {
  const daemon = await installChatMockDaemon(page, { holdReplies: true });
  await page.goto('/?view=chat');
  const composer = page.locator(COMPOSER);
  await composer.fill('long question');
  await composer.press('Enter');

  // The turn is held open — the Stop affordance appears.
  const stopButton = page.getByRole('button', { name: 'Stop generating' });
  await expect(stopButton).toBeVisible();
  await stopButton.click();

  // The wire cancel was issued (not just a local render stop)…
  await expect.poll(() => daemon.cancelCalls.length).toBe(1);
  // …and the persisted partial renders with its honest stopped badge.
  await expect(page.getByText('This partial reply was being generated when')).toBeVisible();
  await expect(page.locator('.delivery-indicator.cancelled').first()).toBeVisible();
});

test('a send during an active turn shows the honest queued marker', async ({ page }) => {
  await installChatMockDaemon(page, { holdReplies: true });
  await page.goto('/?view=chat');
  const composer = page.locator(COMPOSER);
  await composer.fill('first question');
  await composer.press('Enter');
  await expect(page.getByRole('button', { name: 'Stop generating' })).toBeVisible();

  await composer.fill('second question');
  await composer.press('Enter');

  await expect(page.getByText('second question')).toBeVisible();
  await expect(page.locator('.delivery-indicator.queued').first()).toBeVisible();
});

test('Ctrl+Enter steers: the wire steer lands, the interrupted partial is kept, the steered reply answers', async ({ page }) => {
  const daemon = await installChatMockDaemon(page, { holdReplies: true });
  await page.goto('/?view=chat');
  const composer = page.locator(COMPOSER);
  await composer.fill('doomed question');
  await composer.press('Enter');
  await expect(page.getByRole('button', { name: 'Stop generating' })).toBeVisible();

  await composer.fill('urgent correction');
  await composer.press('Control+Enter');

  await expect.poll(() => daemon.steerCalls.length).toBe(1);
  expect(daemon.steerCalls[0]!.body).toBe('urgent correction');
  // The interrupted turn's partial is retained and badged; the steer is answered.
  await expect(page.getByText('Steered reply')).toBeVisible();
  await expect(page.locator('.delivery-indicator.cancelled').first()).toBeVisible();
});

test('press-and-hold on the send button steers (the touch counterpart of Ctrl+Enter)', async ({ page }) => {
  const daemon = await installChatMockDaemon(page, { holdReplies: true });
  await page.goto('/?view=chat');
  const composer = page.locator(COMPOSER);
  await composer.fill('hands-free steer');

  const send = page.locator('.send-button');
  const box = await send.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(750); // past the 550ms hold threshold
  await page.mouse.up();

  await expect.poll(() => daemon.steerCalls.length).toBe(1);
  expect(daemon.steerCalls[0]!.body).toBe('hands-free steer');
});
