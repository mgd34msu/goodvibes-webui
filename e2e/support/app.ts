/**
 * Shared e2e helpers.
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';

export const PHONE = 'phone';
export const DESKTOP = 'desktop';

/** Skip the current test unless it is running under the named project. */
export function only(testInfo: TestInfo, project: string): void {
  test.skip(testInfo.project.name !== project, `${project}-only proof`);
}

/**
 * Assert the page body does not scroll horizontally — the #1 phone smell. Allows a
 * 1px rounding slack. Returns the measured overflow for diagnostics.
 */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  expect(
    overflow.scrollWidth,
    `page scrolls horizontally: scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

/** Assert a located element's rendered box clears the 44px touch-target floor. */
export async function expectTappable(page: Page, selector: string, label = selector): Promise<void> {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, `${label} has no rendered box`).not.toBeNull();
  if (!box) return;
  expect(box.width, `${label} width ${box.width} < 44`).toBeGreaterThanOrEqual(43.5);
  expect(box.height, `${label} height ${box.height} < 44`).toBeGreaterThanOrEqual(43.5);
}

/** Navigate to a view and wait for the shell to be present. */
export async function gotoView(page: Page, view: string): Promise<void> {
  await page.goto(`/?view=${view}`);
  await expect(page.locator('.app-shell')).toBeVisible();
}
