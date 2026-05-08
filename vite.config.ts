import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

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

export default defineConfig({
  plugins: [react()],
  server: {
    host: devHost,
    port: devPort,
    strictPort: true,
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
