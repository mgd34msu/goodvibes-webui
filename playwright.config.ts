import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright harness — the phone-viewport (390x844) proof standard this repo's
 * visual proofs defer to, plus a desktop project to catch regressions.
 *
 * HERMETIC BY CONSTRUCTION: the webServer boots THIS repo's vite dev server on a
 * dedicated port (4318 — deliberately NOT 3421 or 4444) and points its /api proxy at a
 * local STUB (scripts/e2e-daemon-stub.ts, port 59991) that answers every request with
 * a deliberate 503 { code: 'E2E_STUB' } — never a real daemon. In practice the stub is
 * almost never reached: every test installs an in-page mock (installMockDaemon /
 * installChatMockDaemon) that intercepts the wire in the browser and answers from a
 * seeded fixture. The stub exists for the one structural exception — requests made
 * while a REAL service worker controls the page (the PWA specs), which Playwright
 * page routing cannot see — so nothing ever dies as a refused connection and a clean
 * run's webServer log is silent. No real daemon, no real network beyond the local
 * dev server, no port coordination.
 */

const WEB_PORT = Number(process.env.GOODVIBES_E2E_PORT ?? 4318);
const BASE_URL = `http://127.0.0.1:${WEB_PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Files are named *.e2e.ts (NOT *.spec.ts) so `bun test` — which globs *.spec.ts /
  // *.test.ts across the repo — never tries to run these Playwright suites.
  testMatch: '**/*.e2e.ts',
  outputDir: './e2e/.artifacts/test-output',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'e2e/.artifacts/report', open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'phone',
      use: {
        ...devices['Pixel 7'],
        // Pin the exact hero viewport the brief specifies, overriding the device default.
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: [
    {
      // The deliberate answer for requests the in-page mocks cannot intercept
      // (see the header comment). Must start before vite so the proxy target
      // is never a dead port.
      command: 'bun scripts/e2e-daemon-stub.ts',
      url: 'http://127.0.0.1:59991/__stub-alive',
      timeout: 30_000,
      reuseExistingServer: true,
    },
    {
      command: 'bunx vite',
      url: BASE_URL,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        GOODVIBES_WEB_HOST: '127.0.0.1',
        GOODVIBES_WEB_PORT: String(WEB_PORT),
        // The e2e stub (first webServer entry). Explicitly NOT the real control
        // plane (3421) or web (4444/3423) ports.
        GOODVIBES_DAEMON_BASE_URL: 'http://127.0.0.1:59991',
        // Force the config's settings/CLI probes to no-op deterministically.
        GOODVIBES_TUI_SETTINGS_PATH: '/nonexistent/goodvibes-e2e-settings.json',
        // Register the service worker against the dev server so the PWA shell +
        // registration are exercisable headlessly (it is PROD-gated otherwise, to
        // keep normal dev sessions HMR-friendly). 127.0.0.1 is a secure context.
        VITE_ENABLE_SW: '1',
      },
    },
  ],
});
