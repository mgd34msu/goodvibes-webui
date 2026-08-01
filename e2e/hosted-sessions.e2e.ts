/**
 * Hosted sessions (sessions.hosted.*) — the daemon-hosted
 * session view: the list with its includeTerminated toggle and terminatedReason
 * honesty line, attach with history + a genuine live stream frame, and steer.
 * Hermetic against the mock daemon's real stateful sessions.hosted.* handlers
 * (e2e/support/mock-daemon.ts) — the real-daemon proof lives in the agent/TUI
 * e2e per this stage's brief.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { expectNoHorizontalScroll } from './support/app';

test('the hosted sessions list renders title, status, workspace, detach policy and counts', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=hosted-sessions');
  const row = page.locator('.hosted-session-row', { hasText: 'Refactor the parser' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('/home/operator/projects/example');
  await expect(row).toContainText('idle');
  await expect(row).toContainText('detach: survive');
  await expect(row).toContainText('2 turns');
  await expect(row).toContainText('4 messages');
  // The default seed's second session is terminated — hidden until asked for.
  await expect(page.locator('.hosted-session-row', { hasText: 'One-off cleanup' })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test('the includeTerminated toggle reveals terminated rows with their terminatedReason', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=hosted-sessions');
  await expect(page.locator('.hosted-session-row', { hasText: 'Refactor the parser' })).toBeVisible();

  await page.getByLabel('Include terminated').check();

  const terminatedRow = page.locator('.hosted-session-row', { hasText: 'One-off cleanup' });
  await expect(terminatedRow).toBeVisible();
  await expect(terminatedRow).toContainText('terminated — ended with sessions.hosted.kill');
});

test('a genuinely empty hosted-sessions daemon says so honestly, never a blank list', async ({ page }) => {
  await installMockDaemon(page, { hostedSessions: [] });
  await page.goto('/?view=hosted-sessions');
  await expect(page.getByText('No active hosted sessions')).toBeVisible();
});

test('attaching renders the returned history, then a LIVE stream frame arrives and renders as streaming text', async ({ page }) => {
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
  await page.goto('/?view=hosted-sessions');
  await page.locator('.hosted-session-row__button', { hasText: 'Refactor the parser' }).click();

  // The history sessions.hosted.attach returned renders first.
  await expect(page.locator('.hosted-session-transcript')).toContainText('Refactor the parser to use a visitor pattern.');

  // The mock emits the seeded frame ~1s after the first ?domains=session,turn,tools
  // subscription request — this is the LIVE stream, not the static history.
  await expect(page.locator('.hosted-session-message--streaming')).toContainText('Working on the visitor pattern now.', { timeout: 5000 });
  await expectNoHorizontalScroll(page);
});

test('steer submit dispatches sessions.steer for the attached hosted session', async ({ page }) => {
  const daemon = await installMockDaemon(page);
  await page.goto('/?view=hosted-sessions');
  await page.locator('.hosted-session-row__button', { hasText: 'Refactor the parser' }).click();

  const composer = page.locator('.steer-composer');
  await expect(composer).toBeVisible();
  await composer.locator('.steer-composer__input').fill('keep going with the visitor pattern');
  await composer.getByRole('button', { name: 'Steer' }).click();

  await expect(composer.locator('.steer-dispatch')).toContainText('steer');
  expect(daemon.steerRequests.some((r) => r.sessionId === 'hosted-e2e-1')).toBe(true);
});

test('leaving an attached session confirms the effective detach policy before detaching', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=hosted-sessions');
  await page.locator('.hosted-session-row__button', { hasText: 'Refactor the parser' }).click();
  await expect(page.locator('.hosted-session-detail')).toBeVisible();

  await page.getByRole('button', { name: 'Leave' }).click();
  const confirmSheet = page.getByRole('alertdialog');
  await expect(confirmSheet).toContainText('survive');
  await confirmSheet.getByRole('button', { name: 'Leave' }).click();

  await expect(page.locator('.hosted-session-detail')).toHaveCount(0);
});

test('creating a hosted session attaches it immediately and lists it with what was typed', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=hosted-sessions');

  await page.getByRole('button', { name: 'New session' }).click();
  await page.getByLabel('Workspace path').fill('/home/operator/projects/new-thing');
  await page.getByLabel('Title').fill('Untangle the build');
  await page.getByLabel('Detach policy').selectOption('survive');
  await page.locator('.hosted-sessions-create-form').getByRole('button', { name: 'Create' }).click();

  // Attaches immediately: the steer composer for the new session renders.
  await expect(page.locator('.hosted-session-detail')).toContainText('Untangle the build');
  await expect(page.locator('.steer-composer')).toBeVisible();
  await expect(page.locator('.hosted-sessions-create-form')).toHaveCount(0);

  // And it is now a real row in the list, workspace path preserved.
  const row = page.locator('.hosted-session-row', { hasText: 'Untangle the build' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('/home/operator/projects/new-thing');
});

test('ending a session calls kill directly — the one action that ends a survive-policy session', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/?view=hosted-sessions');
  // hosted-e2e-1 is seeded with effectiveDetachPolicy: 'survive' — Leave alone would
  // never end it; End session must.
  await page.locator('.hosted-session-row__button', { hasText: 'Refactor the parser' }).click();
  await expect(page.locator('.hosted-session-detail')).toBeVisible();

  await page.getByRole('button', { name: 'End session' }).click();
  const confirmSheet = page.getByRole('alertdialog');
  await expect(confirmSheet).toContainText('survive');
  await confirmSheet.getByRole('button', { name: 'End session' }).click();

  await expect(page.locator('.hosted-session-detail__terminated')).toContainText('sessions.hosted.kill');
  // Once ended there is nothing left to end again.
  await expect(page.getByRole('button', { name: 'End session' })).toHaveCount(0);
});

test('closing the tab detaches via the keepalive beacon, not the ordinary async call', async ({ page }) => {
  const daemon = await installMockDaemon(page, {
    hostedSessions: [{
      id: 'hosted-e2e-beacon', workspaceRoot: '/home/operator/projects/example', title: 'Beacon-detach proof',
      status: 'idle', detachPolicy: 'kill', effectiveDetachPolicy: 'kill', attachedClients: [],
      createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, turnCount: 0, messageCount: 0, restoredFromDisk: false,
    }],
  });
  await page.goto('/?view=hosted-sessions');
  await page.locator('.hosted-session-row__button', { hasText: 'Beacon-detach proof' }).click();
  await expect(page.locator('.hosted-session-detail')).toBeVisible();

  // This browser is now the session's only attached client — firing pagehide should
  // detach it via hostedSessionDetachBeacon (fetch keepalive), which for a kill-policy
  // session with no other client left flips it to terminated daemon-side (the real
  // mock handler's own last-client rule — see mock-daemon.ts).
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));

  await expect.poll(() => daemon.hostedSessions.find((s) => s.id === 'hosted-e2e-beacon')?.status).toBe('terminated');
});
