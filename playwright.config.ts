import { networkInterfaces } from 'node:os';
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

/**
 * The one real, GENUINE private-network address this host itself owns (an RFC 1918
 * interface — 10/8, 172.16/12, 192.168/16), for lan-origin-posture.e2e.ts. This is
 * deliberately a REAL bind + a REAL browser navigation, not a mocked window.location:
 * Chromium's own secure-context determination is a fact about the literal address the
 * page was actually served from, and no in-page mock can fake that. Undefined when the
 * host has no such interface (a loopback-only sandbox) — the spec itself skips in that
 * case rather than failing on an environment it cannot exist in.
 */
function firstPrivateNetworkAddress(): string | undefined {
  const isPrivate = (a: string): boolean => {
    const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(a);
    if (!m) return false;
    const first = Number(m[1]);
    const second = Number(m[2]);
    if (first === 10) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    return false;
  };
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal && isPrivate(addr.address)) return addr.address;
    }
  }
  return undefined;
}

const LAN_ORIGIN_PORT = Number(process.env.GOODVIBES_E2E_LAN_PORT ?? 4319);
const LAN_ORIGIN_HOST = firstPrivateNetworkAddress();
const LAN_ORIGIN_SPEC = '**/lan-origin-posture.e2e.ts';

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
      testIgnore: LAN_ORIGIN_SPEC,
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
      testIgnore: LAN_ORIGIN_SPEC,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
    // lan-origin: the ONE project that actually serves the app from a real
    // private-network address (see firstPrivateNetworkAddress above), so the LAN-http
    // posture proof (lan-origin-posture.e2e.ts) exercises the REAL browser secure-context
    // boundary rather than a mocked window.location. Every other spec is ignored here.
    {
      name: 'lan-origin',
      testMatch: LAN_ORIGIN_SPEC,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        baseURL: LAN_ORIGIN_HOST ? `http://${LAN_ORIGIN_HOST}:${LAN_ORIGIN_PORT}` : BASE_URL,
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
    // A second vite instance, bound to the host's own real private-network address
    // (never started at all when none exists — LAN_ORIGIN_HOST is undefined and this
    // entry harmlessly points at the SAME dead loopback URL the "phone"/"desktop"
    // instance already serves, which playwright's reuseExistingServer treats as already
    // up). Feeds ONLY the "lan-origin" project.
    ...(LAN_ORIGIN_HOST
      ? [{
        command: 'bunx vite',
        url: `http://${LAN_ORIGIN_HOST}:${LAN_ORIGIN_PORT}`,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
        env: {
          GOODVIBES_WEB_HOST: LAN_ORIGIN_HOST,
          GOODVIBES_WEB_PORT: String(LAN_ORIGIN_PORT),
          GOODVIBES_DAEMON_BASE_URL: 'http://127.0.0.1:59991',
          GOODVIBES_TUI_SETTINGS_PATH: '/nonexistent/goodvibes-e2e-settings.json',
          // No VITE_ENABLE_SW here — the whole point of this origin is to prove the
          // labeled-degradation story for the capabilities that need HTTPS, service
          // worker registration among them (register-sw.ts already skips it here for
          // exactly that reason: no secure context).
        },
      }]
      : []),
  ],
});
