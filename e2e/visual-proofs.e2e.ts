/**
 * Visual proofs (W5-M) — retro-covers the deferred screenshots the wave pointed at
 * this harness: provider pills, the knowledge map, chat degraded states (mocked stream
 * drop), the delete affordance, and both themes for the white-band surfaces. Runs on
 * BOTH the phone and desktop projects; filenames carry the project name. Artifacts land
 * in e2e/.artifacts/screenshots/.
 */
import { test, expect } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { STEERABLE_SESSION } from './support/seed';

const DIR = 'e2e/.artifacts/screenshots';
const THEME_KEY = 'goodvibes.webui.theme';

async function seedTheme(page: import('@playwright/test').Page, theme: 'dark' | 'light') {
  await page.addInitScript(
    ([key, value]) => {
      try {
        window.localStorage.setItem(key, JSON.stringify({ theme: value, density: 'default' }));
      } catch {
        /* ignore */
      }
    },
    [THEME_KEY, theme] as const,
  );
}

function shot(testInfo: import('@playwright/test').TestInfo, name: string): string {
  return `${DIR}/${name}.${testInfo.project.name}.png`;
}

test('provider status pills', async ({ page }, testInfo) => {
  await installMockDaemon(page);
  await page.goto('/?view=providers');
  await expect(page.locator('.view-frame')).toBeVisible();
  await page.screenshot({ path: shot(testInfo, 'provider-pills'), fullPage: true });
});

test('knowledge map', async ({ page }, testInfo) => {
  await installMockDaemon(page);
  await page.goto('/?view=knowledge');
  await expect(page.locator('.view-frame')).toBeVisible();
  await page.screenshot({ path: shot(testInfo, 'knowledge-map'), fullPage: true });
});

test('chat degraded states (mocked stream drop)', async ({ page }, testInfo) => {
  await installMockDaemon(page, { dropStreams: true });
  await page.goto('/?view=chat');
  await expect(page.locator('.workspace-chat')).toBeVisible();
  // Give the dropped stream a beat to surface its reconnect/paused honesty.
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot(testInfo, 'chat-degraded'), fullPage: true });
});

test('steer composer reflects a paused stream', async ({ page }, testInfo) => {
  await installMockDaemon(page, { dropStreams: true });
  await page.goto('/?view=sessions');
  await page.getByRole('button', { name: new RegExp(STEERABLE_SESSION.title) }).click();
  await expect(page.locator('.session-detail__transcript')).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot(testInfo, 'steer-composer-paused'), fullPage: true });
});

test('delete-means-delete affordance', async ({ page }, testInfo) => {
  await installMockDaemon(page, { deleteAvailable: true });
  await page.goto('/?view=sessions');
  await page.getByRole('button', { name: new RegExp(STEERABLE_SESSION.title) }).click();
  await expect(page.locator('.session-detail__actions')).toBeVisible();
  await page.screenshot({ path: shot(testInfo, 'delete-affordance'), fullPage: true });
});

for (const theme of ['dark', 'light'] as const) {
  test(`white-band surfaces — ${theme} theme`, async ({ page }, testInfo) => {
    await seedTheme(page, theme);
    await installMockDaemon(page);
    await page.goto('/?view=sessions');
    await expect(page.locator('.topbar')).toBeVisible();
    // Prove the topbar surface is token-driven (no white band in dark theme).
    const topbarBg = await page.locator('.topbar').evaluate((el) => getComputedStyle(el).backgroundColor);
    if (theme === 'dark') {
      // A near-white band would be rgb(255,255,255)-ish; the dark token must NOT be that.
      expect(topbarBg).not.toBe('rgb(255, 255, 255)');
    }
    await page.screenshot({ path: shot(testInfo, `white-band-${theme}`), fullPage: true });
  });
}
