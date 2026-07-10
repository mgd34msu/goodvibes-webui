/**
 * sw.test.ts — proves the service worker's OWN `linkForNotification` copy (public/sw.js)
 * actually enforces the same in-app-only guard as the pure helper (notification-link.ts).
 *
 * public/sw.js is a plain script that runs in a ServiceWorkerGlobalScope, not a module —
 * it cannot be `import`-ed. This test instead reads the real file off disk and executes
 * it (via `new Function`, with the ambient happy-dom `self`/`caches` this project's
 * test-setup.ts already registers), then captures the top-level `linkForNotification`
 * declaration via a trailing `return`. That is the actual runtime code path a real
 * notification tap executes — not a hand-transcribed copy that could silently drift
 * from the file the browser loads (the cohesion review's exact finding: the two copies
 * "kept deliberately in sync" had drifted, and nothing loaded sw.js to catch it).
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SW_PATH = resolve(__dirname, '../../../public/sw.js');

function loadServiceWorkerLinkForNotification(): (data: unknown, action?: string) => string {
  const source = readFileSync(SW_PATH, 'utf8');
  // The top level only defines constants/functions and calls `self.addEventListener`
  // (a real happy-dom EventTarget method — a no-op registration here since none of
  // those events fire in this test). Nothing else executes at load time.
  const factory = new Function(`${source}\nreturn linkForNotification;`);
  return factory() as (data: unknown, action?: string) => string;
}

describe('sw.js linkForNotification (loaded and executed from the real file, not a hand copy)', () => {
  test('an approval push deep-links to the approvals view', () => {
    const linkForNotification = loadServiceWorkerLinkForNotification();
    expect(linkForNotification({ kind: 'approval', approvalId: 'apr-1' })).toBe('/?view=approvals-tasks');
  });

  test('an explicit in-app url is honored', () => {
    const linkForNotification = loadServiceWorkerLinkForNotification();
    expect(linkForNotification({ url: '/?view=sessions' })).toBe('/?view=sessions');
  });

  test('an off-site (non-relative) url is refused, falling back to the app root — the guard notification-link.ts documents as shared', () => {
    const linkForNotification = loadServiceWorkerLinkForNotification();
    expect(linkForNotification({ url: 'https://evil.example/phish' })).toBe('/');
  });

  test('unknown / empty data falls back to the app root, never a dead tap', () => {
    const linkForNotification = loadServiceWorkerLinkForNotification();
    expect(linkForNotification({})).toBe('/');
    expect(linkForNotification(undefined)).toBe('/');
    expect(linkForNotification(null)).toBe('/');
  });

  test('an Allow/Deny action tap carries the action + approval id in the fragment (real sw.js copy)', () => {
    const linkForNotification = loadServiceWorkerLinkForNotification();
    expect(linkForNotification({ kind: 'approval', approvalId: 'apr-1' }, 'approve')).toBe(
      '/?view=approvals-tasks#approval-action=approve&approval-id=apr-1',
    );
    expect(linkForNotification({ kind: 'approval', approvalId: 'apr-1' }, 'deny')).toBe(
      '/?view=approvals-tasks#approval-action=deny&approval-id=apr-1',
    );
    // A body tap (no action) and an unknown action fall back to the plain view.
    expect(linkForNotification({ kind: 'approval', approvalId: 'apr-1' })).toBe('/?view=approvals-tasks');
    expect(linkForNotification({ kind: 'approval', approvalId: 'apr-1' }, 'snooze')).toBe('/?view=approvals-tasks');
  });

  test('a needs-input push deep-links to the focused Fleet node (real sw.js copy, in sync with notification-link.ts)', () => {
    const linkForNotification = loadServiceWorkerLinkForNotification();
    expect(linkForNotification({ kind: 'needs-input', nodeId: 'agent-7', sessionId: 's-1' })).toBe(
      '/?view=fleet#fleet-node=agent-7&fleet-session=s-1',
    );
    expect(linkForNotification({ kind: 'needs-input', nodeId: 'agent-7' })).toBe('/?view=fleet#fleet-node=agent-7');
    // No node id → still opens the Fleet view rather than a dead tap.
    expect(linkForNotification({ kind: 'needs-input' })).toBe('/?view=fleet');
    // The ids are url-encoded, same as the pure helper.
    expect(linkForNotification({ kind: 'needs-input', nodeId: 'a/b', sessionId: 'x y' })).toBe(
      '/?view=fleet#fleet-node=a%2Fb&fleet-session=x%20y',
    );
  });
});
