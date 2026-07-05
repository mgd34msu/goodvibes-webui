import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Directory this config file lives in (the repo root), resolved independent
// of process.cwd() — this config is the seam every `vite build` invocation
// loads (bun run build, a wrapper script, CI, or a bare `vite build` in this
// directory), so a guard planted here cannot be routed around the way a
// guard in a wrapper script could be by calling vite directly.
const CONFIG_DIR = fileURLToPath(new URL('.', import.meta.url));

/**
 * Refuses `vite build` while the local SDK overlay (scripts/sdk-dev.ts link)
 * is active. The production build bakes @pellux/goodvibes-sdk into the
 * static bundle — an overlay build (unreleased local SDK source, not the
 * pinned npm version) must never ship. `apply: 'build'` means this never
 * runs for `vite` (dev server) or `vite preview`, where the overlay is the
 * intended fast-iteration workflow.
 *
 * Escape hatch: GOODVIBES_ALLOW_OVERLAY_BUILD=1 permits the build to proceed
 * with a loud, repeated warning — for local-only smoke builds of in-progress
 * SDK changes. Never set this in CI or a release build.
 */
function sdkOverlayGuardPlugin(): Plugin {
  return {
    name: 'goodvibes-sdk-overlay-guard',
    apply: 'build',
    enforce: 'pre',
    buildStart() {
      const markerPath = join(CONFIG_DIR, 'node_modules/@pellux/goodvibes-sdk/.local-sdk-overlay.json');
      if (!existsSync(markerPath)) return;

      const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as { sdkGit?: string; sourcePath?: string };
      const allowOverlay = process.env.GOODVIBES_ALLOW_OVERLAY_BUILD === '1';

      if (!allowOverlay) {
        this.error(
          'production build refused: local SDK overlay is active ' +
          `(${marker.sdkGit ?? 'unknown'}).\n` +
          '  The build bakes @pellux/goodvibes-sdk into the bundle — an overlay build must never ship.\n' +
          '  Run `bun scripts/sdk-dev.ts restore` to return to the pinned npm version, then rebuild.\n' +
          '  (Local-only dev builds may bypass this with GOODVIBES_ALLOW_OVERLAY_BUILD=1 — NEVER for release.)',
        );
        return;
      }

      const banner = '!'.repeat(78);
      console.warn(`\n${banner}`);
      console.warn('!! GOODVIBES_ALLOW_OVERLAY_BUILD=1 — building with the LOCAL SDK OVERLAY active.');
      console.warn(`!! Source: ${marker.sdkGit ?? 'unknown'} (${marker.sourcePath ?? 'unknown'})`);
      console.warn('!! This bundle bakes in an unreleased SDK build. It must NEVER be published or deployed.');
      console.warn(`${banner}\n`);
    },
  };
}

interface GoodVibesListenerSettings {
  hostMode?: string;
  host?: string;
  port?: number;
}

interface GoodVibesTuiSettings {
  controlPlane?: GoodVibesListenerSettings;
  web?: GoodVibesListenerSettings;
}

interface GoodVibesWebBinding {
  enabled?: boolean;
  hostMode?: string;
  configuredHost?: string;
  host?: string;
  port?: number;
  url?: string;
}

function readTuiSettings(): GoodVibesTuiSettings {
  const settingsPath = process.env.GOODVIBES_TUI_SETTINGS_PATH
    ?? join(process.env.GOODVIBES_DAEMON_HOME ?? homedir(), '.goodvibes', 'tui', 'settings.json');
  if (!existsSync(settingsPath)) return {};
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf8')) as GoodVibesTuiSettings;
  } catch {
    return {};
  }
}

function readWebBindingFromCli(): GoodVibesWebBinding {
  try {
    const output = execFileSync('goodvibes', ['web', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    });
    return JSON.parse(output) as GoodVibesWebBinding;
  } catch {
    return {};
  }
}

function listenerHost(settings: GoodVibesListenerSettings | undefined, fallback: string): string {
  const configuredHost = settings?.host?.trim();
  if (settings?.hostMode === 'network') return '0.0.0.0';
  if (settings?.hostMode === 'custom') return configuredHost || fallback;
  if (settings?.hostMode === 'local') return '127.0.0.1';
  return configuredHost || fallback;
}

function localhostTarget(host: string): string {
  return host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
}

function hostnameFromUrl(value: string | undefined): string {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    return parsed.hostname;
  } catch {
    return '';
  }
}

function csv(value: string | undefined): string[] {
  return value?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
}

function uniqueHosts(values: string[]): string[] {
  const ignored = new Set(['', '0.0.0.0', '::', '127.0.0.1', 'localhost']);
  const hosts = new Set<string>();
  for (const value of values) {
    const host = value.trim();
    if (!host || ignored.has(host)) continue;
    hosts.add(host);
    hosts.add(host.toLowerCase());
  }
  return [...hosts];
}

const cliWebBinding = readWebBindingFromCli();
const tuiSettings = cliWebBinding.host || cliWebBinding.port ? {} : readTuiSettings();
const webHost = cliWebBinding.host ?? listenerHost(tuiSettings.web, '127.0.0.1');
const webPort = cliWebBinding.port ?? tuiSettings.web?.port ?? 3423;
const controlPlaneHost = listenerHost(tuiSettings.controlPlane, '127.0.0.1');
const controlPlanePort = tuiSettings.controlPlane?.port ?? 3421;
const daemonTarget = process.env.GOODVIBES_DAEMON_BASE_URL
  ?? process.env.VITE_GOODVIBES_BACKEND_URL
  ?? `http://${localhostTarget(controlPlaneHost)}:${controlPlanePort}`;
const devHost = process.env.GOODVIBES_WEB_HOST
  ?? process.env.VITE_GOODVIBES_WEBUI_HOST
  ?? webHost;
const devPort = Number(process.env.GOODVIBES_WEB_PORT
  ?? process.env.VITE_GOODVIBES_WEBUI_PORT
  ?? webPort);
const machineHostname = hostname();
const devAllowedHosts = uniqueHosts([
  ...csv(process.env.GOODVIBES_WEB_ALLOWED_HOSTS),
  ...csv(process.env.VITE_GOODVIBES_WEBUI_ALLOWED_HOSTS),
  hostnameFromUrl(process.env.GOODVIBES_WEB_PUBLIC_BASE_URL),
  hostnameFromUrl(cliWebBinding.url),
  machineHostname,
  `${machineHostname}.local`,
  'goodvibes.local',
]);

export default defineConfig({
  plugins: [react(), sdkOverlayGuardPlugin()],
  server: {
    host: devHost,
    port: devPort,
    strictPort: true,
    allowedHosts: devAllowedHosts,
    proxy: {
      '/api': {
        target: daemonTarget,
        changeOrigin: true,
        ws: true,
      },
      '/login': {
        target: daemonTarget,
        changeOrigin: true,
      },
      '/status': {
        target: daemonTarget,
        changeOrigin: true,
      },
      '/task': {
        target: daemonTarget,
        changeOrigin: true,
      },
      '/config': {
        target: daemonTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@pellux/goodvibes-sdk')) return 'goodvibes-sdk';
          if (id.includes('@pellux/')) return 'goodvibes-sdk';
          if (
            id.includes('react-markdown')
            || id.includes('remark-')
            || id.includes('micromark')
            || id.includes('unified')
            || id.includes('mdast')
            || id.includes('hast')
            || id.includes('unist')
            || id.includes('vfile')
          ) return 'markdown';
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (id.includes('@tanstack')) return 'query';
          if (id.includes('lucide-react')) return 'icons';
          return 'vendor';
        },
      },
    },
  },
});
