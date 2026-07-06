import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright harness (W5-M) — the phone-viewport (390x844) proof standard the whole
 * wave defers its visual proofs to, plus a desktop project to catch regressions.
 *
 * HERMETIC BY CONSTRUCTION: the webServer boots THIS repo's vite dev server on a
 * dedicated port (4318 — deliberately NOT 3421 or 4444) and points its /api proxy at a
 * dead localhost target that is never contacted, because every test installs
 * installMockDaemon (e2e/support/mock-daemon.ts), which intercepts /api in the browser
 * and answers from a seeded fixture. No real daemon, no real network beyond the local
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
  webServer: {
    command: 'bunx vite',
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      GOODVIBES_WEB_HOST: '127.0.0.1',
      GOODVIBES_WEB_PORT: String(WEB_PORT),
      // A dead target that is never actually reached (all /api is intercepted in-page).
      // Explicitly NOT the real control plane (3421) or web (4444/3423) ports.
      GOODVIBES_DAEMON_BASE_URL: 'http://127.0.0.1:59991',
      // Force the config's settings/CLI probes to no-op deterministically.
      GOODVIBES_TUI_SETTINGS_PATH: '/nonexistent/goodvibes-e2e-settings.json',
    },
  },
});
