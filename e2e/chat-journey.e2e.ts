/**
 * Chat journey — the modern-chat-app core, proven end to end on BOTH the desktop and
 * phone projects against a stateful hermetic mock (no real daemon, no 3421/4444).
 *
 * Covers the honest-lineage centerpiece: send a message and get a reply, auto-title the
 * fresh chat, regenerate a response (the prior response is RETAINED and viewable, not
 * gone), and edit a message and branch (the original is RETAINED and viewable). The
 * lineage assertions are the point: superseded history must stay in the UI, never be
 * silently dropped.
 */
import { test, expect } from '@playwright/test';
import { installChatMockDaemon } from './support/chat-mock';
import { expectNoHorizontalScroll } from './support/app';

// A multi-line first message so the derived auto-title (first line) differs visibly from
// the crude create-time slice — makes the auto-title observable.
const FIRST_MESSAGE = 'Promises in JavaScript\nExplain how they work, including the microtask queue and async/await.';
const DERIVED_TITLE = 'Promises in JavaScript';

test('send, auto-title, regenerate-with-retained-history, and edit-and-branch', async ({ page }) => {
  const daemon = await installChatMockDaemon(page);

  await page.goto('/?view=chat');
  await expect(page.locator('.app-shell')).toBeVisible();

  const composer = page.locator('textarea[aria-label="Message GoodVibes"]');
  await expect(composer).toBeVisible();

  // ── Send the first message ────────────────────────────────────────────────
  await composer.fill(FIRST_MESSAGE);
  await page.locator('.send-button').click();

  // The user bubble and the streamed-then-persisted assistant reply both land.
  await expect(page.locator('.message.user').first()).toContainText('Promises in JavaScript');
  await expect(page.locator('.message.assistant').first()).toContainText('Assistant reply', { timeout: 15_000 });

  // ── Auto-title: the crude create-time title is replaced by the derived one ──
  await expect
    .poll(() => daemon.titleUpdates.map((u) => u.title), { timeout: 15_000 })
    .toContain(DERIVED_TITLE);
  await expect(page.locator('.chat-title-button')).toContainText(DERIVED_TITLE);

  // ── Regenerate: the prior response is superseded but RETAINED and viewable ──
  await page.locator('.message.assistant button[aria-label="Regenerate response"]').first().click();
  // The fresh (active) response arrives.
  await expect(page.locator('.message.assistant').first()).toContainText('Regenerated reply', { timeout: 15_000 });
  // Exactly one active assistant bubble — the old one is not a second live bubble.
  await expect(page.locator('.message.assistant')).toHaveCount(1);
  // The honest-lineage toggle appears; the prior response is retained behind it.
  const regenToggle = page.locator('.message-lineage__toggle', { hasText: 'Regenerated' });
  await expect(regenToggle).toBeVisible();
  await regenToggle.click();
  await expect(page.locator('.retained-message')).toContainText('Assistant reply');

  // ── Edit and branch: the original message is superseded but RETAINED ────────
  await page.locator('.message.user button[aria-label="Edit and resend message"]').first().click();
  const editArea = page.locator('textarea[aria-label="Edit message"]');
  await expect(editArea).toBeVisible();
  await editArea.fill('Explain JavaScript generators instead.');
  await page.locator('button[aria-label="Send edited message (Ctrl+Enter)"]').click();

  // The edited (active) user message shows, marked edited, and its fresh reply arrives.
  await expect(page.locator('.message.user').first()).toContainText('generators instead', { timeout: 15_000 });
  await expect(page.locator('.message-meta__edited').first()).toBeVisible();
  await expect(page.locator('.message.assistant').first()).toContainText('Answer to the edited question', { timeout: 15_000 });
  // The original question is retained and viewable behind the edited message's toggle.
  const editToggle = page.locator('.message-lineage__toggle', { hasText: 'Edited' }).first();
  await expect(editToggle).toBeVisible();
  await editToggle.click();
  await expect(page.locator('.message-lineage__retained')).toContainText('Promises in JavaScript');

  // The cardinal phone sin — no sideways scroll at any point.
  await expectNoHorizontalScroll(page);
});
