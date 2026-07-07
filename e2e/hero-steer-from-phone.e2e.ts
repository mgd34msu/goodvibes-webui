/**
 * THE HERO — steer from your phone.
 *
 * The flagship journey at 390x844: boot signed-in with the workspace visible (drawer
 * collapsed), find a session, read its transcript, STEER it from the soft keyboard
 * (plain Enter), and see the steer land over the wire. Every step is an assertion.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon, type MockDaemon } from './support/mock-daemon';
import { STEERABLE_SESSION, FOLLOWUP_SESSION } from './support/seed';
import { only, PHONE, expectNoHorizontalScroll } from './support/app';

let daemon: MockDaemon;

test.beforeEach(async ({ page }, testInfo) => {
  only(testInfo, PHONE);
  daemon = await installMockDaemon(page);
});

test('the workspace loads signed-in with the drawer collapsed; open + scrim close it', async ({ page }) => {
  await page.goto('/?view=sessions');

  // Signed in: the shell, not the sign-in gate.
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.signed-out-gate, .auth-gate')).toHaveCount(0);

  // Drawer COLLAPSED on load — the workspace is visible first, not covered.
  await expect(page.locator('.app-shell.sidebar-collapsed')).toBeVisible();
  await expect(page.locator('.sidebar.collapsed')).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Open the drawer via the brand mark (the collapsed-rail expand affordance).
  await page.locator('.brand-mark-button').click();
  await expect(page.locator('.sidebar:not(.collapsed)')).toBeVisible();

  // Tap the scrim → collapses again (tap-away). Tap the dimmed strip RIGHT of
  // the open 264px drawer: the scrim spans the viewport, so a default
  // center-click (x=195) lands on the drawer itself and only "passes" when it
  // races the open animation. x=340 is always exposed on a 390px phone.
  await page.locator('.sidebar-scrim').click({ position: { x: 340, y: 422 } });
  await expect(page.locator('.app-shell.sidebar-collapsed')).toBeVisible();
});

test('find → read → STEER via plain Enter → the steer lands over the wire', async ({ page }) => {
  await page.goto('/?view=sessions');
  await expect(page.locator('.app-shell')).toBeVisible();

  // ── FIND: the union list is usable on a phone — the session is right there. ──
  const row = page.getByRole('button', { name: new RegExp(STEERABLE_SESSION.title) });
  await expect(row).toBeVisible();
  await expectNoHorizontalScroll(page);

  // ── READ: open the transcript. Master-detail flips list → detail. ──
  await row.click();
  await expect(page.locator('.session-detail__transcript')).toBeVisible();
  await expect(page.locator('.session-message__body').first()).toBeVisible();
  // The wrapped transcript does not push the page sideways.
  await expectNoHorizontalScroll(page);
  // A back affordance exists (not a dead-end stack).
  await expect(page.locator('.session-detail__back')).toBeVisible();

  // ── STEER: type into the composer and send with PLAIN ENTER (soft-keyboard path). ──
  const steerText = 'Prioritize the failing spine test before anything else';
  const input = page.locator('.steer-composer__input');
  await input.click();
  await input.fill(steerText);
  await input.press('Enter');

  // ── LAND (over the wire): the steer POST fired to /api/sessions/{id}/steer with the
  //     canonical { body } shape, and the composer reflects delivery. ──
  await expect.poll(() => daemon.steerRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);
  const sent = daemon.steerRequests[0];
  expect(sent.sessionId).toBe(STEERABLE_SESSION.id);
  expect(sent.body).toMatchObject({ body: steerText });

  // The dispatch row shows the steer as delivered.
  const dispatch = page.locator('.steer-composer__dispatches .steer-dispatch').first();
  await expect(dispatch).toContainText(steerText);
  await expect(dispatch).toContainText(/steer · delivered/i);

  // The textarea cleared after send.
  await expect(input).toHaveValue('');
});

test('back affordance returns from a session detail to the list', async ({ page }) => {
  await page.goto('/?view=sessions');
  const row = page.getByRole('button', { name: new RegExp(STEERABLE_SESSION.title) });
  await row.click();
  await expect(page.locator('.session-detail__transcript')).toBeVisible();
  // List pane is swapped out on the phone while a session is open.
  await expect(page.locator('.sessions-list-pane')).toBeHidden();

  await page.locator('.session-detail__back').click();
  await expect(page.locator('.sessions-list-pane')).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(STEERABLE_SESSION.title) })).toBeVisible();
});

test('a non-steerable session offers a follow-up, labeled honestly', async ({ page }) => {
  await page.goto('/?view=sessions');
  const row = page.getByRole('button', { name: new RegExp(FOLLOWUP_SESSION.title) });
  await row.click();
  await expect(page.locator('.session-detail__transcript')).toBeVisible();

  // No agent bound → the composer is a follow-up, not a steer.
  await expect(page.locator('.steer-composer__mode .badge')).toContainText(/Follow-up/i);

  const input = page.locator('.steer-composer__input');
  await input.fill('Queue a cleanup pass for later');
  await input.press('Enter');

  await expect.poll(() => daemon.followUpRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(daemon.followUpRequests[0].sessionId).toBe(FOLLOWUP_SESSION.id);
  await expect(page.locator('.steer-dispatch').first()).toContainText(/follow-up · delivered/i);
});
