/**
 * phone-node-client.ts — this web app acting as a paired device node.
 *
 * The loop is the SDK peer contract verbatim: request pairing, wait for the
 * operator to approve, verify with the challenge to receive a peer token, then
 * heartbeat and pull `device.capability` work, run it against the browser
 * bindings, and complete it. Nothing in this file is web-specific except the
 * capability bindings it calls, which is the seam a native node replaces.
 *
 * Authority stays on the host. This node never decides whether a capability may
 * run — by the time work reaches the queue the host has already confirmed it
 * with the person or matched a durable grant. What the node owns is the
 * platform action and an honest activity log of everything it did, so the
 * person holding the phone can see what happened on it.
 *
 * The peer token is persisted so a reload does not re-pair. It is the only
 * persisted state here, and it is validated by USE, not by presence: a token
 * the daemon rejects (revoked, rotated, or from a daemon that has forgotten
 * this node) is discarded on the spot and the node returns to unpaired rather
 * than retrying forever against a credential that will never work again.
 */
import {
  announcedCapabilities,
  readBrowserBindings,
  runWebNodeCapability,
  WEB_NODE_CONTRACT_VERSION,
  WEB_NODE_KIND,
  type BrowserBindings,
  type CapabilityRunResult,
} from './capability-bindings';

/** Where the peer token is kept between reloads. */
export const PHONE_NODE_TOKEN_KEY = 'goodvibes.webui.phoneNode';

export type PhoneNodeStatus = 'unpaired' | 'pairing' | 'awaiting-approval' | 'connected' | 'error';

export interface PhoneNodeIdentity {
  readonly nodeId: string;
  readonly token: string;
  readonly label: string;
}

export interface PhoneNodeActivity {
  readonly at: number;
  readonly capabilityId: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface PhoneNodeState {
  readonly status: PhoneNodeStatus;
  readonly nodeId: string;
  readonly label: string;
  readonly announced: readonly string[];
  readonly pendingRequestId: string;
  readonly message: string;
  readonly activity: readonly PhoneNodeActivity[];
}

/** Storage the node keeps its identity in; injected so tests do not need a browser. */
export interface PhoneNodeStorage {
  read(): PhoneNodeIdentity | null;
  write(identity: PhoneNodeIdentity): void;
  clear(): void;
}

export function browserPhoneNodeStorage(): PhoneNodeStorage {
  return {
    read(): PhoneNodeIdentity | null {
      try {
        const raw = window.localStorage.getItem(PHONE_NODE_TOKEN_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<PhoneNodeIdentity>;
        // Validated by shape, not by presence — a half-written entry is
        // discarded rather than used to build a request that cannot succeed.
        if (typeof parsed.nodeId !== 'string' || !parsed.nodeId) return null;
        if (typeof parsed.token !== 'string' || !parsed.token) return null;
        return { nodeId: parsed.nodeId, token: parsed.token, label: typeof parsed.label === 'string' ? parsed.label : 'Phone' };
      } catch {
        return null;
      }
    },
    write(identity: PhoneNodeIdentity): void {
      try {
        window.localStorage.setItem(PHONE_NODE_TOKEN_KEY, JSON.stringify(identity));
      } catch {
        // A browser refusing storage means re-pairing after a reload, not a crash.
      }
    },
    clear(): void {
      try {
        window.localStorage.removeItem(PHONE_NODE_TOKEN_KEY);
      } catch {
        // Nothing to do; the identity is dropped in memory regardless.
      }
    },
  };
}

export interface PhoneNodeClientOptions {
  readonly baseUrl: string;
  readonly label: string;
  readonly storage: PhoneNodeStorage;
  /**
   * HTTP transport. Typed as the call signature rather than `typeof fetch` so a
   * test can supply a plain function without also implementing the browser's
   * non-standard extras (`preconnect`).
   */
  readonly fetchImpl?: ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | undefined;
  readonly bindings?: BrowserBindings | undefined;
  readonly runCapability?: ((capabilityId: string, input: Record<string, unknown>) => Promise<CapabilityRunResult>) | undefined;
  readonly onState?: ((state: PhoneNodeState) => void) | undefined;
  readonly pullIntervalMs?: number | undefined;
  readonly heartbeatIntervalMs?: number | undefined;
  readonly maxActivityRows?: number | undefined;
}

interface PairRequestResponse {
  readonly request?: { readonly id?: string };
  readonly challenge?: string;
}

interface PairVerifyResponse {
  readonly peer?: { readonly id?: string };
  readonly token?: { readonly value?: string };
}

interface WorkItem {
  readonly id: string;
  readonly type?: string;
  readonly command?: string;
  readonly payload?: unknown;
}

/** Activity rows are bounded — an append-only log in a long-lived tab is a leak. */
const DEFAULT_MAX_ACTIVITY = 50;

export class PhoneNodeClient {
  private readonly options: PhoneNodeClientOptions;
  private readonly fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  private readonly bindings: BrowserBindings;
  private identity: PhoneNodeIdentity | null;
  private state: PhoneNodeState;
  private pullTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pendingChallenge = '';
  private busy = false;

  constructor(options: PhoneNodeClientOptions) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    this.bindings = options.bindings ?? readBrowserBindings();
    this.identity = options.storage.read();
    this.state = {
      status: this.identity ? 'connected' : 'unpaired',
      nodeId: this.identity?.nodeId ?? '',
      label: this.identity?.label ?? options.label,
      announced: announcedCapabilities(this.bindings),
      pendingRequestId: '',
      message: this.identity
        ? 'Paired. Waiting for requests.'
        : 'Not paired yet. Ask to pair, then approve it from the desktop.',
      activity: [],
    };
  }

  getState(): PhoneNodeState {
    return this.state;
  }

  private setState(patch: Partial<PhoneNodeState>): void {
    this.state = { ...this.state, ...patch };
    this.options.onState?.(this.state);
  }

  private note(capabilityId: string, ok: boolean, detail: string): void {
    const max = this.options.maxActivityRows ?? DEFAULT_MAX_ACTIVITY;
    const activity = [{ at: Date.now(), capabilityId, ok, detail }, ...this.state.activity].slice(0, max);
    this.setState({ activity });
  }

  private url(path: string): string {
    return `${this.options.baseUrl.replace(/\/$/, '')}${path}`;
  }

  private async post(path: string, body: unknown, token?: string): Promise<{ status: number; json: unknown }> {
    const response = await this.fetchImpl(this.url(path), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body ?? {}),
    });
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    return { status: response.status, json };
  }

  /** Ask the daemon to pair this browser as a device node. */
  async requestPairing(): Promise<void> {
    this.setState({ status: 'pairing', message: 'Asking the daemon to pair…' });
    const announced = announcedCapabilities(this.bindings);
    const { status, json } = await this.post('/api/remote/pair/request', {
      peerKind: 'device',
      label: this.options.label,
      platform: typeof navigator === 'undefined' ? 'web' : navigator.platform || 'web',
      deviceFamily: 'phone',
      clientMode: 'device-node',
      capabilities: announced,
      commands: announced,
      metadata: {
        deviceNode: {
          nodeKind: WEB_NODE_KIND,
          contractVersion: WEB_NODE_CONTRACT_VERSION,
          capabilities: announced,
          secureContext: this.bindings.isSecureContext,
        },
      },
    });
    if (status >= 400) {
      this.setState({ status: 'error', message: `The daemon refused the pairing request (HTTP ${status}).` });
      return;
    }
    const parsed = json as PairRequestResponse;
    const requestId = parsed.request?.id ?? '';
    this.pendingChallenge = parsed.challenge ?? '';
    if (!requestId || !this.pendingChallenge) {
      this.setState({ status: 'error', message: 'The daemon answered without a pairing challenge.' });
      return;
    }
    this.setState({
      status: 'awaiting-approval',
      pendingRequestId: requestId,
      announced,
      message: 'Waiting for approval on the desktop. Approve this device there, then press Finish pairing.',
    });
  }

  /** Complete pairing once the operator has approved the request. */
  async verifyPairing(): Promise<void> {
    if (!this.state.pendingRequestId || !this.pendingChallenge) {
      this.setState({ status: 'error', message: 'There is no pairing request to finish. Ask to pair again.' });
      return;
    }
    const { status, json } = await this.post('/api/remote/pair/verify', {
      requestId: this.state.pendingRequestId,
      challenge: this.pendingChallenge,
    });
    if (status >= 400) {
      this.setState({
        status: 'awaiting-approval',
        message: status === 409 || status === 403
          ? 'Not approved yet. Approve this device on the desktop, then press Finish pairing again.'
          : `Pairing could not be finished (HTTP ${status}).`,
      });
      return;
    }
    const parsed = json as PairVerifyResponse;
    const nodeId = parsed.peer?.id ?? '';
    const token = parsed.token?.value ?? '';
    if (!nodeId || !token) {
      this.setState({ status: 'error', message: 'The daemon approved pairing but returned no device token.' });
      return;
    }
    this.identity = { nodeId, token, label: this.options.label };
    this.options.storage.write(this.identity);
    this.pendingChallenge = '';
    this.setState({
      status: 'connected',
      nodeId,
      pendingRequestId: '',
      message: 'Paired. Waiting for requests.',
    });
  }

  /** Forget this device's pairing locally. */
  unpair(): void {
    this.stop();
    this.identity = null;
    this.options.storage.clear();
    this.setState({ status: 'unpaired', nodeId: '', pendingRequestId: '', message: 'This device is no longer paired here.' });
  }

  /**
   * A rejected token is discarded rather than retried: it means the operator
   * revoked or rotated it, and no amount of retrying will make it work again.
   */
  private handleAuthFailure(): void {
    this.stop();
    this.identity = null;
    this.options.storage.clear();
    this.setState({
      status: 'unpaired',
      nodeId: '',
      message: 'The daemon no longer accepts this device\'s token — it was revoked or rotated. Pair again to reconnect.',
    });
  }

  private async heartbeat(): Promise<void> {
    if (!this.identity) return;
    const announced = announcedCapabilities(this.bindings);
    const { status } = await this.post('/api/remote/heartbeat', {
      capabilities: announced,
      commands: announced,
      clientMode: 'device-node',
      metadata: {
        deviceNode: {
          nodeKind: WEB_NODE_KIND,
          contractVersion: WEB_NODE_CONTRACT_VERSION,
          capabilities: announced,
          secureContext: this.bindings.isSecureContext,
        },
      },
    }, this.identity.token);
    if (status === 401 || status === 403) {
      this.handleAuthFailure();
      return;
    }
    if (this.state.announced.join(',') !== announced.join(',')) this.setState({ announced });
  }

  /** Pull one batch of work and run it. */
  async pumpOnce(): Promise<void> {
    if (!this.identity || this.busy) return;
    this.busy = true;
    try {
      const { status, json } = await this.post('/api/remote/work/pull', { maxItems: 3 }, this.identity.token);
      if (status === 401 || status === 403) {
        this.handleAuthFailure();
        return;
      }
      if (status >= 400) return;
      const items = Array.isArray((json as { work?: unknown }).work) ? (json as { work: WorkItem[] }).work : [];
      for (const item of items) await this.runWork(item);
    } finally {
      this.busy = false;
    }
  }

  private async runWork(item: WorkItem): Promise<void> {
    if (!this.identity) return;
    const payload = (item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)
      ? item.payload
      : {}) as Record<string, unknown>;
    const capabilityId = typeof payload.capabilityId === 'string' ? payload.capabilityId : (item.command ?? '');
    if (item.type !== 'device.capability' || !capabilityId) {
      await this.completeWork(item.id, 'failed', undefined, 'This node only serves device.capability work.');
      return;
    }
    const input = (payload.input && typeof payload.input === 'object' && !Array.isArray(payload.input)
      ? payload.input
      : {}) as Record<string, unknown>;
    const runner = this.options.runCapability
      ?? ((id: string, capabilityInput: Record<string, unknown>) => runWebNodeCapability(id, capabilityInput, this.bindings));
    const result = await runner(capabilityId, input);
    this.note(capabilityId, result.ok, result.ok ? 'Served' : (result.error ?? 'Failed'));
    await this.completeWork(item.id, result.ok ? 'completed' : 'failed', {
      contractVersion: WEB_NODE_CONTRACT_VERSION,
      capabilityId,
      ok: result.ok,
      ...(result.error ? { error: result.error } : {}),
      ...(result.data === undefined ? {} : { data: result.data }),
      ...(result.mediaBase64 ? { mediaBase64: result.mediaBase64, mediaType: result.mediaType } : {}),
    }, result.ok ? undefined : result.error);
  }

  private async completeWork(workId: string, status: 'completed' | 'failed', result: unknown, error?: string): Promise<void> {
    if (!this.identity) return;
    await this.post(`/api/remote/work/${encodeURIComponent(workId)}/complete`, {
      workId,
      status,
      ...(result === undefined ? {} : { result }),
      ...(error ? { error } : {}),
    }, this.identity.token);
  }

  /** Start heartbeating and pulling work. */
  start(): void {
    if (!this.identity) return;
    this.stop();
    void this.heartbeat();
    void this.pumpOnce();
    this.heartbeatTimer = setInterval(() => { void this.heartbeat(); }, this.options.heartbeatIntervalMs ?? 30_000);
    this.pullTimer = setInterval(() => { void this.pumpOnce(); }, this.options.pullIntervalMs ?? 2_000);
  }

  stop(): void {
    if (this.pullTimer) { clearInterval(this.pullTimer); this.pullTimer = null; }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }
}
