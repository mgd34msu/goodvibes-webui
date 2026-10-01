/**
 * Calendar tab of Personal, events (list/get/create) + ICS import/export over the
 * daemon's calendar.* verbs, proven against a real HTTP round-trip through the mock
 * daemon (not just a unit-mocked module). Runs on both the phone and desktop
 * Playwright projects (playwright.config.ts) since no test here gates on project name.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { expectNoHorizontalScroll, only, PHONE } from './support/app';

const CALENDAR = '/?view=personal&tab=calendar';

test('configured: the agenda lists events sorted by start time, grouped by day, no fabricated state', async ({ page }) => {
  await installMockDaemon(page, { calendar: 'configured' });
  await page.goto(CALENDAR);
  const agenda = page.getByTestId('calendar-agenda');
  await expect(agenda).toBeVisible();
  const rows = agenda.locator('.calendar-event-row');
  await expect(rows).toHaveCount(2);
  // Seed has ev-1 (Aug 1) before ev-2 (Aug 2), the view must sort by start, not
  // return-order (the seed lists ev-2 first).
  await expect(rows.nth(0)).toContainText('Team standup');
  await expect(rows.nth(1)).toContainText('Design review');
  // Two days, two groups.
  await expect(agenda.getByRole('heading', { level: 3 })).toHaveCount(2);
  await expectNoHorizontalScroll(page);
});

test('configured: selecting an event shows its detail (uid, attendees) via a real fetch', async ({ page }) => {
  await installMockDaemon(page, { calendar: 'configured' });
  await page.goto(CALENDAR);
  await page.locator('.calendar-event-row .gv-row__main').first().click();
  const detail = page.getByTestId('calendar-event-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('ev-1@goodvibes');
  await expect(detail).toContainText('Operator');
  await expectNoHorizontalScroll(page);
});

test('the Agenda / Month toggle shows a month grid without sideways scroll', async ({ page }) => {
  await installMockDaemon(page, { calendar: 'configured' });
  await page.goto(CALENDAR);
  await expect(page.getByTestId('calendar-agenda')).toBeVisible();
  await page.getByRole('radio', { name: 'Month' }).click();
  await expect(page.getByTestId('calendar-month')).toBeVisible();
  await expect(page.getByTestId('calendar-agenda')).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.getByTestId('calendar-month')).toBeVisible();
  await page.getByRole('radio', { name: 'Agenda' }).click();
  await expect(page.getByTestId('calendar-agenda')).toBeVisible();
});

test('unconfigured: the daemon\'s 412 CALENDAR_NOT_CONFIGURED renders the honest bring-your-own-CalDAV note with one action, never a scary error or a fake-empty calendar', async ({ page }) => {
  await installMockDaemon(page, { calendar: 'unconfigured' });
  await page.goto(CALENDAR);
  await expect(page.getByText('Calendar isn’t configured')).toBeVisible();
  await expect(page.getByText('caldavUrl', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible();
  // No create action while the surface cannot take one.
  await expect(page.getByRole('button', { name: 'New event' })).toHaveCount(0);
  await expect(page.locator('.feedback-error-state')).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test('creating an event posts confirm:true and the new event id renders honestly', async ({ page }) => {
  await installMockDaemon(page, { calendar: 'configured' });
  await page.goto(CALENDAR);
  await page.getByRole('button', { name: 'New event' }).click();
  const dialog = page.getByRole('dialog', { name: 'New event' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Title').fill('Planning sync');
  await dialog.getByLabel('Start', { exact: true }).fill('2026-08-05 09:00');
  await dialog.getByLabel('End', { exact: true }).fill('2026-08-05 09:30');
  await dialog.getByRole('button', { name: 'Create event' }).click();
  await expect(page.getByText('Event created (id ev-new).')).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test('exporting the range as .ics reports the honest event count', async ({ page }) => {
  await installMockDaemon(page, { calendar: 'configured' });
  await page.goto(CALENDAR);
  await expect(page.getByTestId('calendar-agenda')).toBeVisible();
  await page.getByRole('button', { name: 'More calendar actions' }).click();
  await page.getByRole('menuitem', { name: 'Export range as .ics' }).click();
  await expect(page.getByText('Exported 2 event(s).')).toBeVisible();
});

test('importing .ics content reports the honest imported count', async ({ page }) => {
  await installMockDaemon(page, { calendar: 'configured' });
  await page.goto(CALENDAR);
  await expect(page.getByTestId('calendar-agenda')).toBeVisible();
  await page.getByRole('button', { name: 'More calendar actions' }).click();
  await page.getByRole('menuitem', { name: 'Import .ics file content' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import .ics content' });
  await dialog.getByLabel('iCalendar content').fill('BEGIN:VCALENDAR\nEND:VCALENDAR');
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Imported 1 event(s).')).toBeVisible();
});

test.describe('phone: a long, unbroken event title never forces the page wider (MOBILE-ADAPT overflow sweep)', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => only(testInfo, PHONE));

  test('the title ellipsizes instead of stretching the row or a month cell past the viewport', async ({ page }) => {
    await installMockDaemon(page, { calendar: 'configured' });
    // A single unbreakable token (no spaces), the min-content overflow class this
    // suite sweeps for: white-space:nowrap text needs min-width:0 to actually shrink.
    const longTitle = 'Quarterly-Cross-Team-Infrastructure-Migration-And-Rollback-Readiness-Review-Session';
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    await page.route('**/api/calendar/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() !== 'GET' || path !== '/api/calendar/events') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ events: [{ id: 'ev-long', title: longTitle, start: today.toISOString(), end: today.toISOString() }] }),
      });
    });
    await page.goto(CALENDAR);
    await expect(page.locator('.calendar-event-row')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByRole('radio', { name: 'Month' }).click();
    await expect(page.locator('.cal-month__event')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
