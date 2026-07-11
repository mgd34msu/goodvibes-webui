/**
 * live-daemon-smoke.ts — exercise the webui's own transport + stream code against a REAL
 * daemon process, not mocks.
 *
 * WHY A SEPARATE LANE: the default `bun test` unit lane is hermetic (happy-dom + in-page
 * mocks) and must stay that way. This lane boots a real daemon from the local SDK dev-link
 * (bootDaemon: isolated home, ephemeral loopback port, bearer-token auth), points the
 * webui's actual SDK client (src/lib/goodvibes.ts) at it, and drives a minimal session
 * round-trip end to end — proving the real request/response and Server-Sent-Event paths
 * work against a genuine daemon. It is wired as `bun run test:live`, NOT under the default
 * test glob, so the unit lane never spawns a process.
 *
 * It is deliberately model-free: it creates and lists a session and opens the live event
 * stream (all real daemon state), so it needs no provider credential and runs green offline.
 * Sending a message that requires an LLM turn is out of scope here precisely because that
 * WOULD need an external credential.
 *
 * Run: `bun run test:live`  (or `bun run scripts/live-daemon-smoke.ts`)
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootDaemon, type BootedDaemon } from '@pellux/goodvibes-sdk/daemon';

// The webui token store (createBrowserTokenStore) persists to localStorage. In this headless
// lane there is no browser, so provide a minimal in-memory localStorage BEFORE importing the
// webui client (which constructs the token store at module evaluation).
if (typeof (globalThis as { localStorage?: unknown }).localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

const TOKEN = 'live-smoke-bearer-token';
const SESSION_TITLE = `live-smoke-${Date.now()}`;

function log(step: string): void {
  process.stdout.write(`  • ${step}\n`);
}

function sessionId(value: unknown): string {
  const record = (value ?? {}) as Record<string, unknown>;
  const direct = record.sessionId ?? record.id;
  if (typeof direct === 'string' && direct) return direct;
  const nested = (record.session ?? {}) as Record<string, unknown>;
  const inner = nested.sessionId ?? nested.id;
  return typeof inner === 'string' ? inner : '';
}

function sessionsFrom(value: unknown): Record<string, unknown>[] {
  const record = (value ?? {}) as Record<string, unknown>;
  const list = Array.isArray(record.sessions) ? record.sessions : Array.isArray(value) ? value : [];
  return list.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
}

async function main(): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'gv-live-smoke-home-'));
  const work = mkdtempSync(join(tmpdir(), 'gv-live-smoke-work-'));
  let daemon: BootedDaemon | null = null;

  try {
    process.stdout.write('Live-daemon smoke\n');
    // The daemon eagerly constructs its builtin model providers at boot, and some provider
    // SDKs (e.g. OpenAI) refuse to even CONSTRUCT without an api key present. This lane never
    // makes a model call — it only exercises sessions + streaming — so a placeholder key that
    // satisfies construction is honest here: no request is ever sent to any provider.
    for (const key of ['OPENAI_API_KEY', 'OPENAI_ADMIN_KEY', 'ANTHROPIC_API_KEY']) {
      if (!process.env[key]) process.env[key] = 'live-smoke-placeholder-unused';
    }
    log('booting a real daemon (isolated home, ephemeral loopback port)…');
    daemon = await bootDaemon({ homeDirectory: home, workingDir: work, port: 0, token: TOKEN });
    log(`daemon up at ${daemon.url}`);

    // Point the webui's SDK client at the real daemon, THEN import it (it reads the base URL
    // at module evaluation). A loopback http origin is a secure context, so the SDK transport
    // guard does not fire.
    process.env.VITE_GOODVIBES_BASE_URL = daemon.url;
    const { sdk } = await import('../src/lib/goodvibes');
    const { SESSION_UPDATE_WIRE_EVENT } = await import('../src/lib/sessions-union');
    await sdk.auth.setToken(TOKEN);

    // 1) A real authenticated request/response round-trip through the webui client.
    log('control.status round-trip…');
    const status = await sdk.operator.control.status();
    assert.ok(status && typeof status === 'object', 'control.status returned a snapshot object');

    // 2) A real mutating round-trip: create a session, then read it back from the list.
    log('creating a session…');
    const created = await sdk.operator.invoke('sessions.create', { title: SESSION_TITLE });
    const createdId = sessionId(created);
    assert.ok(createdId, 'sessions.create returned a session id');

    log('listing sessions and asserting the new one is present…');
    const listed = await sdk.operator.invoke('sessions.list', {});
    const found = sessionsFrom(listed).some((entry) => sessionId(entry) === createdId);
    assert.ok(found, `the created session (${createdId}) appears in the real daemon's session list`);

    // 3) Real streamed state: open the live control-plane SSE against the daemon and assert
    //    the stream genuinely opens (onReady from a real process, over Bun's streaming fetch).
    //    Also observe a live session-update frame if one arrives within the window.
    log('opening the live event stream and driving a mutation…');
    const streamed = await new Promise<{ ready: boolean; sawFrame: boolean }>((resolve, reject) => {
      let ready = false;
      let sawFrame = false;
      let dispose: (() => void) | null = null;
      const settle = () => {
        dispose?.();
        resolve({ ready, sawFrame });
      };
      const timer = setTimeout(() => {
        if (ready) settle();
        else {
          dispose?.();
          reject(new Error('the live event stream did not open within 10s'));
        }
      }, 10_000);

      void sdk.streams
        .open(
          '/api/control-plane/events?domains=session',
          {
            onReady: () => {
              ready = true;
              // Trigger a lifecycle change so the spine broadcasts a session-update frame.
              void sdk.operator.invoke('sessions.close', { sessionId: createdId }).catch(() => undefined);
            },
            onEvent: (eventName: string) => {
              if (eventName === SESSION_UPDATE_WIRE_EVENT) {
                sawFrame = true;
                clearTimeout(timer);
                settle();
              }
            },
            // Transient stream errors are not fatal to this smoke: the timeout above is the
            // authority on whether the stream opened, and onReady is the success signal.
            onError: (error: unknown) => {
              void error;
            },
            onTerminate: (info: unknown) => {
              void info;
            },
          },
          { reconnect: { enabled: false, baseDelayMs: 0, maxDelayMs: 0, backoffFactor: 1, maxAttempts: 0 } },
        )
        .then((close: () => void) => {
          dispose = close;
        })
        .catch((error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });

    assert.ok(streamed.ready, 'the live event stream opened against the real daemon');
    log(streamed.sawFrame ? 'received a live session-update frame over the stream' : 'stream opened (no session-update frame observed in-window)');

    process.stdout.write('\nLive-daemon smoke: PASS\n');
  } finally {
    if (daemon) await daemon.stop();
    rmSync(home, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    process.stderr.write(`\nLive-daemon smoke: FAIL\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exit(1);
  },
);
