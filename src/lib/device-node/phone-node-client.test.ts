/**
 * phone-node-client.test.ts — the web app as a paired device node.
 *
 * The node announces only what this browser can really do, pairs through the
 * SDK peer contract, serves `device.capability` work, and discards a token the
 * daemon rejects instead of retrying against a dead credential.
 */
import { describe, expect, test } from 'bun:test';
import { announcedCapabilities, type BrowserBindings } from './capability-bindings';
import {
  PhoneNodeClient,
  type PhoneNodeIdentity,
  type PhoneNodeStorage,
} from './phone-node-client';

function bindings(overrides: Partial<BrowserBindings> = {}): BrowserBindings {
  return {
    isSecureContext: true,
    mediaDevices: {
      getUserMedia: (() => Promise.reject(new Error('unused'))) as MediaDevices['getUserMedia'],
      getDisplayMedia: (() => Promise.reject(new Error('unused'))) as MediaDevices['getDisplayMedia'],
    } as MediaDevices,
    geolocation: { getCurrentPosition: () => undefined } as unknown as Geolocation,
    clipboard: { readText: () => Promise.resolve(''), writeText: () => Promise.resolve() } as unknown as Clipboard,
    notificationPermission: 'granted',
    canNotify: true,
    canVibrate: true,
    canOpenWindow: true,
    ...overrides,
  };
}

function memoryStorage(initial: PhoneNodeIdentity | null = null): PhoneNodeStorage & { current: PhoneNodeIdentity | null } {
  const store = {
    current: initial,
    read: (): PhoneNodeIdentity | null => store.current,
    write: (identity: PhoneNodeIdentity): void => { store.current = identity; },
    clear: (): void => { store.current = null; },
  };
  return store;
}

interface StubCall {
  readonly url: string;
  readonly body: Record<string, unknown>;
  readonly authorization: string;
}

function stubFetch(responses: { status: number; json: unknown }[]): { impl: typeof fetch; calls: StubCall[] } {
  const calls: StubCall[] = [];
  let index = 0;
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      authorization: headers.authorization ?? '',
    });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return {
      status: next?.status ?? 200,
      json: async () => next?.json ?? {},
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('announced capabilities', () => {
  test('a secure context announces every capability this browser implements', () => {
    const ids = announcedCapabilities(bindings());
    expect(ids).toContain('device.camera.rear.capture');
    expect(ids).toContain('device.camera.front.capture');
    expect(ids).toContain('device.screen.capture');
    expect(ids).toContain('device.location.precise');
    expect(ids).toContain('device.clipboard.read');
    expect(ids).toContain('device.command.notify');
  });

  test('a non-secure origin announces only what a browser will actually serve there', () => {
    const ids = announcedCapabilities(bindings({ isSecureContext: false }));
    expect(ids).not.toContain('device.camera.rear.capture');
    expect(ids).not.toContain('device.screen.capture');
    expect(ids).not.toContain('device.clipboard.read');
    expect(ids).toContain('device.command.open_url');
    expect(ids).toContain('device.command.vibrate');
  });

  test('a browser without a clipboard API simply does not announce clipboard capabilities', () => {
    const ids = announcedCapabilities(bindings({ clipboard: undefined }));
    expect(ids).not.toContain('device.clipboard.read');
    expect(ids).not.toContain('device.clipboard.write');
  });
});

describe('pairing', () => {
  test('the pair request announces the node kind, contract version, and capabilities', async () => {
    const { impl, calls } = stubFetch([{ status: 200, json: { request: { id: 'req-1' }, challenge: 'chal' } }]);
    const client = new PhoneNodeClient({
      baseUrl: 'http://daemon.test',
      label: 'Pixel',
      storage: memoryStorage(),
      fetchImpl: impl,
      bindings: bindings(),
    });
    await client.requestPairing();

    expect(calls[0]?.url).toBe('http://daemon.test/api/remote/pair/request');
    expect(calls[0]?.body.peerKind).toBe('device');
    const metadata = calls[0]?.body.metadata as { deviceNode?: Record<string, unknown> } | undefined;
    expect(metadata?.deviceNode?.nodeKind).toBe('web-pwa');
    expect(metadata?.deviceNode?.contractVersion).toBe(1);
    expect(Array.isArray(metadata?.deviceNode?.capabilities)).toBe(true);
    expect(client.getState().status).toBe('awaiting-approval');
  });

  test('verifying before approval keeps the node waiting rather than erroring out', async () => {
    const { impl } = stubFetch([
      { status: 200, json: { request: { id: 'req-1' }, challenge: 'chal' } },
      { status: 403, json: { error: 'not approved' } },
    ]);
    const client = new PhoneNodeClient({
      baseUrl: 'http://daemon.test', label: 'Pixel', storage: memoryStorage(), fetchImpl: impl, bindings: bindings(),
    });
    await client.requestPairing();
    await client.verifyPairing();
    expect(client.getState().status).toBe('awaiting-approval');
    expect(client.getState().message).toContain('Approve this device');
  });

  test('a verified pairing persists the device token', async () => {
    const storage = memoryStorage();
    const { impl } = stubFetch([
      { status: 200, json: { request: { id: 'req-1' }, challenge: 'chal' } },
      { status: 200, json: { peer: { id: 'node-1' }, token: { value: 'secret' } } },
    ]);
    const client = new PhoneNodeClient({
      baseUrl: 'http://daemon.test', label: 'Pixel', storage, fetchImpl: impl, bindings: bindings(),
    });
    await client.requestPairing();
    await client.verifyPairing();
    expect(client.getState().status).toBe('connected');
    expect(storage.current?.nodeId).toBe('node-1');
    expect(storage.current?.token).toBe('secret');
  });

  test('a stored identity with a missing token is discarded rather than used', () => {
    const broken: PhoneNodeStorage = {
      read: () => null,
      write: () => undefined,
      clear: () => undefined,
    };
    const client = new PhoneNodeClient({
      baseUrl: 'http://daemon.test', label: 'Pixel', storage: broken, fetchImpl: stubFetch([]).impl, bindings: bindings(),
    });
    expect(client.getState().status).toBe('unpaired');
  });
});

describe('serving work', () => {
  test('device.capability work is run and completed with the contract result shape', async () => {
    const { impl, calls } = stubFetch([
      { status: 200, json: { work: [{ id: 'w1', type: 'device.capability', command: 'device.command.vibrate', payload: { capabilityId: 'device.command.vibrate', input: { durationMs: 100 } } }] } },
      { status: 200, json: { work: { id: 'w1', status: 'completed' } } },
    ]);
    const client = new PhoneNodeClient({
      baseUrl: 'http://daemon.test',
      label: 'Pixel',
      storage: memoryStorage({ nodeId: 'node-1', token: 'secret', label: 'Pixel' }),
      fetchImpl: impl,
      bindings: bindings(),
      runCapability: async (capabilityId) => ({ ok: true, data: { ran: capabilityId } }),
    });
    await client.pumpOnce();

    const completion = calls.find((call) => call.url.includes('/complete'));
    expect(completion).toBeDefined();
    expect(completion?.authorization).toBe('Bearer secret');
    expect(completion?.body.status).toBe('completed');
    const result = completion?.body.result as Record<string, unknown> | undefined;
    expect(result?.capabilityId).toBe('device.command.vibrate');
    expect(result?.ok).toBe(true);
    expect(client.getState().activity[0]?.capabilityId).toBe('device.command.vibrate');
  });

  test('work of another type is refused rather than guessed at', async () => {
    const { impl, calls } = stubFetch([
      { status: 200, json: { work: [{ id: 'w2', type: 'invoke', command: 'something-else' }] } },
      { status: 200, json: {} },
    ]);
    const client = new PhoneNodeClient({
      baseUrl: 'http://daemon.test',
      label: 'Pixel',
      storage: memoryStorage({ nodeId: 'node-1', token: 'secret', label: 'Pixel' }),
      fetchImpl: impl,
      bindings: bindings(),
    });
    await client.pumpOnce();
    const completion = calls.find((call) => call.url.includes('/complete'));
    expect(completion?.body.status).toBe('failed');
  });

  test('a failed capability completes as failed with the reason, not silently', async () => {
    const { impl, calls } = stubFetch([
      { status: 200, json: { work: [{ id: 'w3', type: 'device.capability', payload: { capabilityId: 'device.clipboard.read', input: {} } }] } },
      { status: 200, json: {} },
    ]);
    const client = new PhoneNodeClient({
      baseUrl: 'http://daemon.test',
      label: 'Pixel',
      storage: memoryStorage({ nodeId: 'node-1', token: 'secret', label: 'Pixel' }),
      fetchImpl: impl,
      bindings: bindings(),
      runCapability: async () => ({ ok: false, error: 'the person dismissed the browser prompt' }),
    });
    await client.pumpOnce();
    const completion = calls.find((call) => call.url.includes('/complete'));
    expect(completion?.body.status).toBe('failed');
    expect(completion?.body.error).toContain('dismissed');
    expect(client.getState().activity[0]?.ok).toBe(false);
  });

  test('a rejected token unpairs the node instead of retrying forever', async () => {
    const storage = memoryStorage({ nodeId: 'node-1', token: 'stale', label: 'Pixel' });
    const { impl } = stubFetch([{ status: 401, json: { error: 'revoked' } }]);
    const client = new PhoneNodeClient({
      baseUrl: 'http://daemon.test', label: 'Pixel', storage, fetchImpl: impl, bindings: bindings(),
    });
    await client.pumpOnce();
    expect(client.getState().status).toBe('unpaired');
    expect(storage.current).toBeNull();
    expect(client.getState().message).toContain('revoked or rotated');
  });

  test('the activity log is bounded rather than growing without limit', async () => {
    // Always answers a pull with one work item and a completion with an ack, so
    // repeated pumps genuinely append rows and the cap is what bounds them.
    const impl = (async (input: RequestInfo | URL) => {
      const isPull = String(input).endsWith('/work/pull');
      return {
        status: 200,
        json: async () => (isPull
          ? { work: [{ id: `w-${String(Math.random())}`, type: 'device.capability', payload: { capabilityId: 'device.command.vibrate', input: {} } }] }
          : {}),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const client = new PhoneNodeClient({
      baseUrl: 'http://daemon.test',
      label: 'Pixel',
      storage: memoryStorage({ nodeId: 'node-1', token: 'secret', label: 'Pixel' }),
      fetchImpl: impl,
      bindings: bindings(),
      maxActivityRows: 3,
      runCapability: async () => ({ ok: true }),
    });
    for (let index = 0; index < 6; index += 1) await client.pumpOnce();
    expect(client.getState().activity.length).toBe(3);
  });
});
