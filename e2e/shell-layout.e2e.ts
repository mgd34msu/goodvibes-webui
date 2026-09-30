/**
 * Viewport-locked shell invariants, proven in a real browser: the PAGE never
 * scrolls and each pane owns its own overflow; there is no bottom status strip
 * (the connection lives on the account avatar and in the account menu); the
 * brand wordmark renders complete; and on desktop the sidebar folds to its
 * 56-wide rail while a right-side detail is open, then restores.
 */
import { test, expect } from '@playwright/test';
import { installChatMockDaemon } from './support/chat-mock';
import { installMockDaemon } from './support/mock-daemon';
import { DESKTOP, nextFrames, only, openNavigation } from './support/app';

test('the page never scrolls: every pane owns its own overflow', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=sessions');
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.view-frame')).not.toBeEmpty();

  const m = await page.evaluate(() => ({
    docScrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    frameOverflow: getComputedStyle(document.querySelector('.shell-main > .view-frame')!).overflowY,
    mainOverflow: getComputedStyle(document.querySelector('.shell-main')!).overflowY,
  }));
  // The document is exactly one viewport tall; body scroll is impossible.
  expect(m.docScrollHeight).toBe(m.innerHeight);
  // The content frame scrolls itself; the main column never grows past the viewport.
  expect(m.frameOverflow).toBe('auto');
  expect(m.mainOverflow).toBe('hidden');

  await page.mouse.wheel(0, 2000);
  await nextFrames(page);
  expect(await page.evaluate(() => document.documentElement.scrollTop)).toBe(0);
});

test('there is no status strip: the connection is on the avatar and in the account menu', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=sessions');
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.status-strip')).toHaveCount(0);

  await openNavigation(page);
  const account = page.getByRole('button', { name: /^Account: / });
  await expect(account).toBeVisible();
  // The avatar's dot carries the connection state (green once the probe answers).
  await expect(page.locator('.shell-avatar').first()).toHaveAttribute('data-tone', 'ok');
  await account.click();
  const menu = page.getByRole('menu', { name: 'Account' });
  await expect(menu).toBeVisible();
  // Plain words, not transport jargon.
  await expect(menu.getByRole('menuitem', { name: /Connected to your daemon/ })).toBeVisible();
  await expect(menu.getByRole('menuitemradio', { name: 'Dark' })).toBeVisible();
  await expect(menu.getByRole('menuitemcheckbox', { name: /GoodVibes Neon/ })).toBeVisible();
  // Escape closes the menu and returns focus to the account button.
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(account).toBeFocused();
});

test('in chat only the transcript scrolls and the composer stays pinned', async ({ page }) => {
  const daemon = await installChatMockDaemon(page);
  await page.goto('/?view=chat');
  const composer = page.locator('textarea[aria-label="Message GoodVibes"]');
  await expect(composer).toBeVisible();
  void daemon;

  const before = await composer.evaluate((el) => el.getBoundingClientRect().top);
  // Whatever the transcript holds, scrolling the document must be a no-op and
  // the composer must not move.
  await page.mouse.wheel(0, 2000);
  await nextFrames(page);
  const after = await page.evaluate(() => ({
    docScrollTop: document.documentElement.scrollTop,
    composerTop: document.querySelector('textarea[aria-label="Message GoodVibes"]')!.getBoundingClientRect().top,
  }));
  expect(after.docScrollTop).toBe(0);
  expect(Math.round(after.composerTop)).toBe(Math.round(before));
});

test('the brand wordmark renders complete, never abbreviated', async ({ page }) => {
  await installChatMockDaemon(page);
  await page.goto('/?view=chat');
  await expect(page.locator('.app-shell')).toBeVisible();
  await openNavigation(page);
  const brand = page.locator('.shell-brand__word').first();
  await expect(brand).toHaveText('GoodVibes');
  const m = await brand.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  // No overflow means no visual truncation is even possible.
  expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
});

test.describe('sidebar auto-collapse (desktop)', () => {
  test.beforeEach(({ page: _page }, testInfo) => {
    only(testInfo, DESKTOP);
  });

  test('a right-side detail folds the sidebar to the 56 rail; closing it restores the sidebar', async ({ page }) => {
    await installMockDaemon(page);
    await page.goto('/?view=providers');
    const sidebar = page.locator('.shell-sidebar');
    await expect(sidebar).toHaveAttribute('data-form', 'expanded');

    await page.locator('button[aria-label^="Open details for"]').click();
    await expect(sidebar).toHaveAttribute('data-form', 'rail');
    // The rail is 56 wide once the 200 ms width change has settled.
    await expect.poll(() => sidebar.evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(56);
    // The rail keeps every destination one click away, each named for a screen reader.
    // (Work's name carries its needs-you count, "Work, 3 need you", hence the prefix match.)
    for (const name of ['New chat', 'Search', 'Work', 'Library', 'Personal']) {
      await expect(sidebar.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();
    }

    await page.keyboard.press('Escape');
    await expect(sidebar).toHaveAttribute('data-form', 'expanded');
    await expect.poll(() => sidebar.evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(260);
  });

  test('a sidebar the person collapsed stays collapsed after the detail closes', async ({ page }) => {
    await installMockDaemon(page);
    await page.goto('/?view=providers');
    const sidebar = page.locator('.shell-sidebar');
    await sidebar.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect(sidebar).toHaveAttribute('data-form', 'rail');

    await page.locator('button[aria-label^="Open details for"]').click();
    await expect(sidebar).toHaveAttribute('data-form', 'rail');
    await page.keyboard.press('Escape');
    await expect(page.locator('.peek-panel--open')).toHaveCount(0);
    await expect(sidebar).toHaveAttribute('data-form', 'rail');
  });

  test('a pinned sidebar does not auto-collapse at 1280 wide', async ({ page }) => {
    await installMockDaemon(page);
    await page.goto('/?view=providers');
    const sidebar = page.locator('.shell-sidebar');
    await sidebar.getByRole('button', { name: 'Pin sidebar open' }).click();
    await page.locator('button[aria-label^="Open details for"]').click();
    await expect(page.locator('.peek-panel--open')).toBeVisible();
    await expect(sidebar).toHaveAttribute('data-form', 'expanded');
  });

  test('Ctrl B shows the full sidebar over the content while a detail holds the rail', async ({ page }) => {
    await installMockDaemon(page);
    await page.goto('/?view=providers');
    const sidebar = page.locator('.shell-sidebar');
    await page.locator('button[aria-label^="Open details for"]').click();
    await expect(sidebar).toHaveAttribute('data-form', 'rail');
    const slotBefore = await page.locator('.shell-sidebar-slot').evaluate((el) => el.getBoundingClientRect().width);

    await page.keyboard.press('Control+b');
    await expect(sidebar).toHaveAttribute('data-form', 'peek');
    // Peek overlays: the layout column keeps the rail's width, nothing is pushed.
    expect(await page.locator('.shell-sidebar-slot').evaluate((el) => el.getBoundingClientRect().width)).toBe(slotBefore);
  });
});
