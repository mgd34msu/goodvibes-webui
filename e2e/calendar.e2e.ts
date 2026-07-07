/**
 * Calendar view — events (list/get/create) + ICS import/export over the daemon's
 * calendar.* verbs, proven against a real HTTP round-trip through the mock daemon
 * (not just a unit-mocked module). Runs on both the phone and desktop Playwright
 * projects (playwright.config.ts) since no test here gates on project name.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { expectNoHorizontalScroll, only, PHONE } from './support/app';

test('configured: events render sorted by start time, no fabricated state', async ({ page }) => {
  await installMockDaemon(page, { calendar: 'configured' });
  await page.goto('/?view=calendar');
  const view = page.locator('.calendar-event-list');
  await expect(view).toBeVisible();
  const rows = view.locator('.calendar-event-row');
  await expect(rows).toHaveCount(2);
  // Seed has ev-1 (Aug 1) before ev-2 (Aug 2) — the view must sort by start, not
  // return-order (the seed lists ev-2 first).
  await expect(rows.nth(0)).toContainText('Team standup');
  await expect(rows.nth(1)).toContainText('Design review');
  await expectNoHorizontalScroll(page);
});

test('configured: opening an event shows its detail (uid, attendees) via a real fetch', async ({ page }) => {
  await installMockDaemon(page, { calendar: 'configured' });
  await page.goto('/?view=calendar');
  await page.locator('.calendar-event-row').first().click();
  const peek = page.locator('.calendar-peek-body');
  await expect(peek).toBeVisible();
  await expect(peek).toContainText('ev-1@goodvibes');
  await expect(peek).toContainText('Operator');
});

test('unconfigured: the daemon\'s 412 CALENDAR_NOT_CONFIGURED renders the honest bring-your-own-CalDAV note, never a scary error or a fake-empty calendar', async ({ page }) => {
  await installMockDaemon(page, { calendar: 'unconfigured' });
  await page.goto('/?view=calendar');
  await expect(page.getByText('Calendar isn’t configured')).toBeVisible();
  await expect(page.getByText('caldavUrl', { exact: false })).toBeVisible();
  await expect(page.locator('.feedback-error-state')).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test('creating an event posts confirm:true and the new event id renders honestly', async ({ page }) => {
  await installMockDaemon(page, { calendar: 'configured' });
  await page.goto('/?view=calendar');
  await page.getByLabel('Event title').fill('Planning sync');
  await page.getByLabel('Event start').fill('2026-08-05T09:00');
  await page.getByLabel('Event end').fill('2026-08-05T09:30');
  await page.getByRole('button', { name: 'Create Event' }).click();
  await expect(page.getByText('Created — event id ev-new')).toBeVisible();
});

test('exporting the range as .ics reports the honest event count', async ({ page }) => {
  await installMockDaemon(page, { calendar: 'configured' });
  await page.goto('/?view=calendar');
  await page.getByRole('button', { name: 'Export range as .ics' }).click();
  await expect(page.getByText('Exported 2 event(s).')).toBeVisible();
});

test('importing .ics content reports the honest imported count', async ({ page }) => {
  await installMockDaemon(page, { calendar: 'configured' });
  await page.goto('/?view=calendar');
  await page.getByLabel('ICS content to import').fill('BEGIN:VCALENDAR\nEND:VCALENDAR');
  await page.getByRole('button', { name: 'Import .ics' }).click();
  await expect(page.getByText('Imported 1 event(s).')).toBeVisible();
});

test.describe('phone: a long, unbroken event title never forces the page wider (MOBILE-ADAPT overflow sweep)', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => only(testInfo, PHONE));

  test('the title ellipsizes instead of stretching the row past the viewport', async ({ page }) => {
    await installMockDaemon(page, { calendar: 'configured' });
    // A single unbreakable token (no spaces) — the min-content overflow class this
    // suite sweeps for: white-space:nowrap text needs min-width:0 to actually shrink.
    const longTitle = 'Quarterly-Cross-Team-Infrastructure-Migration-And-Rollback-Readiness-Review-Session';
    await page.route('**/api/calendar/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() !== 'GET' || path !== '/api/calendar/events') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ events: [{ id: 'ev-long', title: longTitle, start: '2026-08-01T09:00:00.000Z', end: '2026-08-01T09:15:00.000Z' }] }),
      });
    });
    await page.goto('/?view=calendar');
    await expect(page.locator('.calendar-event-row')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
