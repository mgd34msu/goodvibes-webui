/**
 * PWA packaging — installability signals, the service worker, honest offline,
 * and the Web Push subscribe/unsubscribe client.
 *
 * Hermetic by construction: the manifest + SW are static assets; the push flow
 * uses a MOCKED PushManager (Playwright cannot reach a real push service), and
 * every push.* call is answered by the in-page mock daemon. No real push is
 * ever sent — the STATES are asserted, not deliveries.
 */
import { test, expect, type Page } from '@playwright/test';
import { installMockDaemon } from './support/mock-daemon';
import { expectNoHorizontalScroll } from './support/app';

// ── Manifest + installability ─────────────────────────────────────────────

test('the web app manifest is served and declares an installable standalone app', async ({ page }) => {
  const response = await page.request.get('/manifest.webmanifest');
  expect(response.ok()).toBeTruthy();
  const manifest = (await response.json()) as {
    display: string;
    scope: string;
    icons: { sizes: string; purpose?: string }[];
  };
  expect(manifest.display).toBe('standalone');
  expect(manifest.scope).toBe('/');
  const sizes = manifest.icons.map((i) => i.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBeTruthy();
});

test('index.html links the manifest and a theme-color', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#08080f');
});

// ── Service worker: served, honest never-cache rule, and registers ─────────

test('the service worker is served and keeps daemon data off the cache (the honesty line)', async ({ page }) => {
  const response = await page.request.get('/sw.js');
  expect(response.ok()).toBeTruthy();
  const body = await response.text();
  // The shipped SW must never cache API responses — proven by the guard's
  // presence in the served file, not just in source.
  expect(body).toContain('/api/');
  expect(body).toContain('NEVER_CACHE_PREFIXES');
  expect(body).toContain('isNeverCache');
});

test('the service worker registers in the browser', async ({ page }) => {
  await installMockDaemon(page);
  await page.goto('/');
  const registered = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    return Boolean(reg && reg.active);
  });
  expect(registered).toBe(true);
});

// ── Web Push: mocked PushManager, states asserted (no real pushes) ──────────

/**
 * Install a fake serviceWorker + PushManager + Notification before the app
 * loads, so the push client runs its real logic (VAPID fetch → subscribe →
 * register with the daemon) against controllable fakes. `permission` seeds
 * Notification.permission and what requestPermission() resolves to.
 */
async function mockPushApis(page: Page, permission: 'granted' | 'denied' | 'default'): Promise<void> {
  await page.addInitScript((perm) => {
    let current: unknown = null;
    const fakeSubscription = {
      endpoint: 'https://push.example.test/endpoint-abc',
      toJSON() {
        return {
          endpoint: 'https://push.example.test/endpoint-abc',
          keys: { p256dh: 'fake-p256dh-key', auth: 'fake-auth-key' },
        };
      },
      async unsubscribe() {
        current = null;
        return true;
      },
    };
    const fakeRegistration = {
      active: {},
      pushManager: {
        async getSubscription() {
          return current;
        },
        async subscribe() {
          current = fakeSubscription;
          return fakeSubscription;
        },
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve(fakeRegistration),
        controller: {},
        async register() {
          return fakeRegistration;
        },
        addEventListener() {
          /* the stand-in service worker never emits events */
        },
      },
    });
    // A stand-in PushManager + Notification so detectPushSupport() reports 'ok'.
    (window as unknown as { PushManager: unknown }).PushManager = function () {
      /* presence-only stand-in — detectPushSupport checks the constructor exists */
    };
    (window as unknown as { Notification: unknown }).Notification = Object.assign(
      function () {
        /* presence-only stand-in — never constructed by the shell */
      },
      {
        permission: perm,
        async requestPermission() {
          return perm;
        },
      },
    );
  }, permission);
}

async function openNotificationSettings(page: Page): Promise<void> {
  await page.goto('/?view=admin');
  await expect(page.getByRole('heading', { name: 'Notifications & install' })).toBeVisible();
}

test('subscribe → the client fetches the VAPID key and registers the subscription with the daemon', async ({ page }) => {
  await mockPushApis(page, 'granted');
  await installMockDaemon(page);

  const invokeCalls: string[] = [];
  page.on('request', (req) => {
    const m = req.url().match(/\/api\/control-plane\/methods\/(push\.[^/]+)\/invoke$/);
    if (m) invokeCalls.push(m[1]);
  });

  await openNotificationSettings(page);
  await page.getByRole('button', { name: /Turn on notifications/ }).click();

  // The UI flips to the subscribed state (turn-off + test-push controls appear).
  await expect(page.getByRole('button', { name: /Turn off notifications/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Send a test push/ })).toBeVisible();

  // The honest wire sequence: read the VAPID key, then register the subscription.
  expect(invokeCalls).toContain('push.vapid.get');
  expect(invokeCalls).toContain('push.subscriptions.create');

  // Unsubscribe removes the daemon-side record and returns to the off state.
  await page.getByRole('button', { name: /Turn off notifications/ }).click();
  await expect(page.getByRole('button', { name: /Turn on notifications/ })).toBeVisible();
  expect(invokeCalls).toContain('push.subscriptions.delete');
});

test('blocked notifications render an honest state, not a dead toggle', async ({ page }) => {
  await mockPushApis(page, 'denied');
  await installMockDaemon(page);
  await openNotificationSettings(page);
  await expect(page.getByText('Notifications are blocked for this site.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Turn on notifications/ })).toBeDisabled();
});

test('an insecure (plain-HTTP) context points at HTTPS / Tailscale, not a broken control', async ({ page }) => {
  // Force the insecure-context branch even though 127.0.0.1 is really secure.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
  });
  await installMockDaemon(page);
  await openNotificationSettings(page);
  await expect(page.getByText(/needs a secure \(HTTPS\) connection/)).toBeVisible();
  await expect(page.getByText(/tailscale serve/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Turn on notifications/ })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});
