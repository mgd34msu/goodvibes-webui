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
 * Assert the page does not scroll horizontally — the #1 phone smell. Allows a 1px slack.
 *
 * TWO measures, because a single one is fooled by mobile emulation:
 *
 * 1. DOCUMENT overflow: documentElement.scrollWidth against the viewport — but the
 *    reference is `min(clientWidth, visualViewport.width)`, NOT clientWidth alone. In
 *    mobile emulation an off-canvas element makes clientWidth inflate in lockstep with
 *    scrollWidth (both ~798 at a 390 viewport), so `scrollWidth <= clientWidth` is
 *    self-cancelling and stays green while the page pans sideways. visualViewport.width
 *    is the real device width (390) and does not inflate, so capping the reference at it
 *    restores a truthful signal for genuine content overflow.
 *
 * 2. OFF-CANVAS FIXED panels: no `position: fixed`, non-`display:none` element may sit
 *    ENTIRELY off the right edge — i.e. its LEFT edge is at or past the viewport width.
 *    This is the measure the scrollWidth check CANNOT provide: Chromium clamps a fixed
 *    off-canvas element out of the document's scrollWidth (it stays 390 even with a full
 *    panel parked at x=390..780), so measure 1 alone can never see a closed slide-over
 *    that was hidden with transform+visibility instead of being removed from layout. A
 *    fixed element is viewport-relative and can never be clipped by an ancestor's
 *    overflow, so a fixed box parked wholly outside the viewport is always a real
 *    horizontal-pan contributor on a device. The test keys on the LEFT edge (fully
 *    parked), NOT merely "extends past the right": an on-screen full-viewport sheet may
 *    legitimately render a hair wider than the viewport (safe-area / rounding) while
 *    still starting at x=0 — that is not a pan into empty space and must not trip here.
 */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    // Cap the document reference at the real viewport so emulation cannot inflate it.
    const reference = Math.min(doc.clientWidth, viewportWidth);

    // A fixed element whose LEFT edge is at/past the viewport's right edge is parked
    // wholly off-canvas — the off-canvas-drawer-left-in-layout bug.
    let parkedLeft = 0;
    let parkedOffender = '';
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' || cs.display === 'none') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.left >= viewportWidth - 1 && rect.left > parkedLeft) {
        parkedLeft = rect.left;
        parkedOffender = String((el as HTMLElement).className || el.tagName).slice(0, 40);
      }
    }
    return { scrollWidth: doc.scrollWidth, reference, viewportWidth, parkedLeft, parkedOffender };
  });

  expect(
    overflow.scrollWidth,
    `page scrolls horizontally: scrollWidth ${overflow.scrollWidth} > viewport ${overflow.reference}`,
  ).toBeLessThanOrEqual(overflow.reference + 1);

  expect(
    overflow.parkedLeft,
    `a fixed panel is parked off-canvas (${overflow.parkedOffender} left=${Math.round(overflow.parkedLeft)} >= viewport ${overflow.viewportWidth}) — an off-canvas panel left in the layout pans the page sideways on a device`,
  ).toBe(0);
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
