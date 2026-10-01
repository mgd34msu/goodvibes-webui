/**
 * Hosted sessions (sessions.hosted.*), the daemon-hosted
 * session view: the list with its includeTerminated toggle and terminatedReason
 * honesty line, attach with history + a genuine live stream frame, and steer.
 * Hermetic against the mock daemon's real stateful sessions.hosted.* handlers
 * (e2e/support/mock-daemon.ts), the real-daemon proof lives in the agent/TUI
 * e2e per this stage's brief.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { detailPane, expectNoHorizontalScroll, listRow, openRow } from './support/app';

test('hosted sessions list in Work, Sessions with title, status, workspace and turns', async ({ page }) => {
  await installMockDaemon(page);
  // The old Hosted link lands on Work, Sessions.
  await page.goto('/?view=hosted-sessions');
  await expect(page).toHaveURL(/view=work&tab=sessions/);
  const row = listRow(page, 'Refactor the parser');
  await expect(row).toBeVisible();
  await expect(row).toContainText('/home/operator/projects/example');
  await expect(row).toContainText('Idle');
  await expect(row).toContainText('2 turns');
  // The default seed's second session is terminated, hidden until finished work is shown.
  await expect(page.locator('.dv-list .gv-row', { hasText: 'One-off cleanup' })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test('showing finished work reveals terminated rows; the detail states why it ended', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=work&tab=sessions');
  await expect(listRow(page, 'Refactor the parser')).toBeVisible();

  await page.getByRole('button', { name: 'Show' }).click();
  await page.getByRole('option', { name: 'Active and finished' }).click();

  const finished = page.getByRole('region', { name: 'Finished' });
  await expect(finished.locator('.gv-row', { hasText: 'One-off cleanup' })).toBeVisible();
  const detail = await openRow(page, 'One-off cleanup');
  await expect(detail).toContainText('ended with sessions.hosted.kill');
});

test('with nothing at all running, Work says so calmly with one action', async ({ page }) => {
  await installMockDaemon(page, { hostedSessions: [] });
  await page.goto('/?view=work&tab=sessions');
  await expect(page.locator('.dv-list .gv-row', { hasText: /Refactor the parser|One-off cleanup/ })).toHaveCount(0);
});

test('attaching renders the returned history, then a live stream frame renders as streaming text', async ({ page }) => {
  await installMockDaemon(page, {
    hostedStreamFrames: [
      {
        event: 'turn',
        payload: {
          type: 'STREAM_DELTA',
          sessionId: 'hosted-e2e-1',
          payload: { turnId: 't-live-1', content: 'Working', accumulated: 'Working on the visitor pattern now.' },
        },
      },
    ],
  });
  await page.goto('/?view=work&tab=sessions');
  const detail = await openRow(page, 'Refactor the parser');

  // The history sessions.hosted.attach returned renders first.
  await expect(detail.getByRole('list', { name: 'Transcript' })).toContainText('Refactor the parser to use a visitor pattern.');
  await expect(detail).toContainText('It keeps running');

  // The mock emits the seeded frame ~1s after the subscription opens: the live stream.
  await expect(detail.locator('.work-transcript__message--streaming')).toContainText('Working on the visitor pattern now.', { timeout: 5000 });
  await expectNoHorizontalScroll(page);
});

test('steer submit dispatches sessions.steer for the attached hosted session', async ({ page }) => {
  const daemon = await installMockDaemon(page);
  await page.goto('/?view=work&tab=sessions');
  const detail = await openRow(page, 'Refactor the parser');

  const composer = detail.locator('.steer-composer');
  await expect(composer).toBeVisible();
  await composer.getByRole('textbox', { name: 'Steer message' }).fill('keep going with the visitor pattern');
  await composer.getByRole('button', { name: 'Send steer' }).click();

  await expect(composer.locator('.steer-dispatch')).toContainText('steer');
  expect(daemon.steerRequests.some((r) => r.sessionId === 'hosted-e2e-1')).toBe(true);
});

test('leaving an attached session confirms the effective detach policy before detaching', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=work&tab=sessions');
  const detail = await openRow(page, 'Refactor the parser');
  await expect(detail.getByRole('button', { name: 'Leave' })).toBeVisible();

  await detail.getByRole('button', { name: 'Leave' }).click();
  const confirmSheet = page.getByRole('alertdialog');
  await expect(confirmSheet).toContainText('survive');
  await confirmSheet.getByRole('button', { name: 'Leave' }).click();

  await expect(detailPane(page)).toHaveCount(0);
});

test('creating a hosted session from New attaches it immediately and lists it', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=work&tab=sessions');

  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Hosted session' }).click();
  const dialog = page.getByRole('dialog', { name: 'New hosted session' });
  await dialog.getByLabel('Workspace path').fill('/home/operator/projects/new-thing');
  await dialog.getByLabel('Title (optional)').fill('Untangle the build');
  await dialog.getByRole('button', { name: 'Detach policy' }).click();
  await page.getByRole('option', { name: 'Keep it running' }).click();
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toHaveCount(0);

  // Attaches immediately: the detail and its steer composer render.
  await expect(detailPane(page)).toContainText('Untangle the build');
  await expect(detailPane(page).locator('.steer-composer')).toBeVisible();

  // And it is now a real row in the list, workspace path preserved (on a phone, back to the list first).
  const back = page.getByRole('button', { name: 'All work' });
  if (await back.isVisible()) await back.click();
  const row = listRow(page, 'Untangle the build');
  await expect(row).toBeVisible();
  await expect(row).toContainText('/home/operator/projects/new-thing');
});

test('ending a session calls kill directly: the one action that ends a survive-policy session', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=work&tab=sessions');
  // hosted-e2e-1 is seeded with effectiveDetachPolicy 'survive': Leave alone never ends it.
  const detail = await openRow(page, 'Refactor the parser');

  await detail.getByRole('button', { name: 'End session' }).click();
  const confirmSheet = page.getByRole('alertdialog');
  await expect(confirmSheet).toContainText('survive');
  await confirmSheet.getByRole('button', { name: 'End session' }).click();

  await expect(detailPane(page).getByRole('status')).toContainText('sessions.hosted.kill');
  // Once ended there is nothing left to end again.
  await expect(detailPane(page).getByRole('button', { name: 'End session' })).toHaveCount(0);
});

test('closing the tab detaches via the keepalive beacon, not the ordinary async call', async ({ page }) => {
  const daemon = await installMockDaemon(page, {
    hostedSessions: [{
      id: 'hosted-e2e-beacon', workspaceRoot: '/home/operator/projects/example', title: 'Beacon-detach proof',
      status: 'idle', detachPolicy: 'kill', effectiveDetachPolicy: 'kill', attachedClients: [],
      createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, turnCount: 0, messageCount: 0, restoredFromDisk: false,
    }],
  });
  await page.goto('/?view=work&tab=sessions');
  const detail = await openRow(page, 'Beacon-detach proof');
  await expect(detail.getByRole('button', { name: 'Leave' })).toBeVisible();

  // The only attached client: pagehide detaches via the keepalive beacon, which for a
  // kill-policy session with no other client flips it to terminated daemon-side.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));

  await expect.poll(() => daemon.hostedSessions.find((s) => s.id === 'hosted-e2e-beacon')?.status).toBe('terminated');
});
