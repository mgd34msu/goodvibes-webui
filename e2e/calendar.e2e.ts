/**
 * Calendar tab of Personal, events (list/get/create) + ICS import/export over the
 * daemon's calendar.* verbs, proven against a real HTTP round-trip through the mock
 * daemon (not just a unit-mocked module). Runs on both the phone and desktop
 * Playwright projects (playwright.config.ts) since no test here gates on project name.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { DESKTOP, expectBottomSheet, expectNoHorizontalScroll, only, PHONE } from './support/app';

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

test('the agenda asks the daemon for the selected range and shows only what falls inside it', async ({ page }) => {
  await installMockDaemon(page, { calendar: 'configured' });
  const listRequest = page.waitForRequest((req) => req.method() === 'GET' && new URL(req.url()).pathname === '/api/calendar/events');
  await page.goto(CALENDAR);
  const url = new URL((await listRequest).url());
  // The default window: today through 14 days out, as whole UTC days.
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  expect(from).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
  expect(to).toMatch(/^\d{4}-\d{2}-\d{2}T23:59:59\.999Z$/);
  expect(Date.parse(to) - Date.parse(from)).toBeGreaterThan(14 * 86_400_000 - 1000);
  // The seeded event two months back sits outside the window and never shows.
  await expect(page.getByTestId('calendar-agenda')).toBeVisible();
  await expect(page.getByText('Quarter kickoff')).toHaveCount(0);
});

test('configured: selecting an event shows its detail (uid, attendees) via a real fetch', async ({ page }) => {
  await installMockDaemon(page, { calendar: 'configured' });
  await page.goto(CALENDAR);
  await page.locator('.calendar-event-row .gv-row__main').first().click();
  const detail = page.getByTestId('calendar-event-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('ev-1@goodvibes');
  await expect(detail).toContainText('Operator');
  // The event is a peek: a glass drawer labelled "Event detail".
  await expect(page.getByRole('dialog', { name: 'Event detail' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Event detail' })).toHaveCount(0);
});

test.describe('desktop: the event peek is a 440 drawer that folds the sidebar to its rail', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => only(testInfo, DESKTOP));

  test('opening an event folds the rail; Escape closes the drawer and restores it', async ({ page }) => {
    await installMockDaemon(page, { calendar: 'configured' });
    await page.goto(CALENDAR);
    const sidebar = page.locator('.shell-sidebar');
    await expect(sidebar).toHaveAttribute('data-form', 'expanded');
    await page.locator('.calendar-event-row .gv-row__main').first().click();
    const drawer = page.getByRole('dialog', { name: 'Event detail' });
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveClass(/gv-drawer--right/);
    await expect.poll(() => drawer.evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(440);
    await expect(sidebar).toHaveAttribute('data-form', 'rail');
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(sidebar).toHaveAttribute('data-form', 'expanded');
  });
});

test.describe('phone: compact calendar controls and the event as a bottom sheet', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => only(testInfo, PHONE));

  test('one date-range button replaces the two date fields and the calendar field; the agenda starts high', async ({ page }) => {
    await installMockDaemon(page, { calendar: 'configured' });
    await page.goto(CALENDAR);
    await expect(page.getByTestId('calendar-agenda')).toBeVisible();
    // No inline date fields or calendar field on the page itself.
    await expect(page.getByRole('textbox', { name: 'Range start' })).toHaveCount(0);
    await expect(page.getByLabel('Logical calendar id')).toHaveCount(0);
    const range = page.locator('.calendar-range-button');
    await expect(range).toBeVisible();
    await expect(range).toContainText('–');
    await expect(page.getByRole('button', { name: 'More calendar actions' })).toBeVisible();
    // The controls are one row, and the agenda begins in the top half of the screen.
    const rowHeight = await page.locator('.calendar-phone-controls').evaluate((el) => el.getBoundingClientRect().height);
    // One row: 44-tall touch targets plus the toggle's padding, never a second line.
    expect(rowHeight).toBeLessThan(60);
    const agendaTop = await page.getByTestId('calendar-agenda').evaluate((el) => el.getBoundingClientRect().top);
    expect(agendaTop).toBeLessThan(844 / 2);
    await expectNoHorizontalScroll(page);

    // The button opens a sheet with both dates and the calendar choice.
    await range.click();
    const sheet = page.getByRole('dialog', { name: 'Date range' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('textbox', { name: 'Range start' })).toBeVisible();
    await expect(sheet.getByRole('textbox', { name: 'Range end' })).toBeVisible();
    await expect(sheet.getByLabel('Logical calendar id')).toBeVisible();
    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(sheet).toHaveCount(0);
  });

  test('an event opens as a bottom sheet with a grabber over the scrim', async ({ page }) => {
    await installMockDaemon(page, { calendar: 'configured' });
    await page.goto(CALENDAR);
    await page.locator('.calendar-event-row .gv-row__main').first().click();
    const sheet = page.getByRole('dialog', { name: 'Event detail' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveClass(/gv-drawer--sheet/);
    await expect(sheet.locator('.gv-sheet__grabber')).toBeVisible();
    await expectBottomSheet(page, sheet);
    await expect(page.getByTestId('calendar-event-detail')).toContainText('ev-1@goodvibes');
    await expectNoHorizontalScroll(page);
    await sheet.getByRole('button', { name: 'Close event' }).click();
    await expect(sheet).toHaveCount(0);
  });
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
