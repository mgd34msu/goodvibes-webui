/**
 * Viewport-locked shell invariants, proven in a real browser: the PAGE never
 * scrolls, each pane owns its own overflow, the StatusStrip is glued to the
 * viewport bottom above the sidebar, and the brand wordmark renders complete.
 *
 * These pin the layout model the operator relies on: the sidebar's overflow
 * once stretched the whole document, which put the status bar mid-page (riding
 * along with scroll), the composer wherever the document ended, and the last
 * nav item underneath the bar.
 */
import { test, expect } from '@playwright/test';
import { installChatMockDaemon } from './support/chat-mock';
import { nextFrames } from './support/app';

test('the page never scrolls: every pane owns its own overflow', async ({ page }) => {
  await installChatMockDaemon(page);
  await page.goto('/?view=chat');
  await expect(page.locator('.app-shell')).toBeVisible();

  const m = await page.evaluate(() => ({
    docScrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    sidebar: (() => {
      const el = document.querySelector('.sidebar')!;
      return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
    })(),
  }));
  // The document is exactly one viewport tall; body scroll is impossible.
  expect(m.docScrollHeight).toBe(m.innerHeight);
  // The sidebar carries its own overflow instead of stretching the document.
  expect(m.sidebar.scrollHeight).toBeGreaterThan(m.sidebar.clientHeight);

  // Scrolling the sidebar to its end must not move the strip or the document.
  await page.locator('.sidebar').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const after = await page.evaluate(() => ({
    docScrollTop: document.documentElement.scrollTop,
    stripBottom: document.querySelector('.status-strip')!.getBoundingClientRect().bottom,
    innerHeight: window.innerHeight,
  }));
  expect(after.docScrollTop).toBe(0);
  expect(Math.round(after.stripBottom)).toBe(after.innerHeight);
});

test('the StatusStrip is pinned to the viewport bottom, above the sidebar', async ({ page }) => {
  await installChatMockDaemon(page);
  await page.goto('/?view=chat');
  await expect(page.locator('.status-strip')).toBeVisible();

  const m = await page.evaluate(() => {
    const strip = document.querySelector('.status-strip')!;
    const rect = strip.getBoundingClientRect();
    const sidebarZ = Number(getComputedStyle(document.querySelector('.sidebar')!).zIndex) || 0;
    const stripZ = Number(getComputedStyle(strip).zIndex) || 0;
    return {
      position: getComputedStyle(strip).position,
      bottom: Math.round(rect.bottom),
      innerHeight: window.innerHeight,
      stripAboveSidebar: stripZ > sidebarZ,
      // Nothing in the sidebar's scrolled-to-end content may sit under the strip:
      // the sidebar box itself must end at or above the strip's top edge.
      sidebarBottom: Math.round(document.querySelector('.sidebar')!.getBoundingClientRect().bottom),
      stripTop: Math.round(rect.top),
    };
  });
  expect(m.position).toBe('fixed');
  expect(m.bottom).toBe(m.innerHeight);
  expect(m.stripAboveSidebar).toBe(true);
  expect(m.sidebarBottom).toBeLessThanOrEqual(m.stripTop);
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
  const brand = page.locator('.brand-copy strong');
  await expect(brand).toHaveText('GOODVIBES');
  const m = await brand.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    textOverflow: getComputedStyle(el).textOverflow,
  }));
  // No overflow means no visual truncation is even possible.
  expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
  expect(m.textOverflow).not.toBe('ellipsis');
});
