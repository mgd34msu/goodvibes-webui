/**
 * push-client.ts — the browser half of Web Push.
 *
 * Ties the browser's PushManager to the daemon's push.* verbs (via the
 * src/lib/goodvibes.ts facade): read the public VAPID key, subscribe this
 * device with PushManager, register that subscription with the daemon, and the
 * reverse to unsubscribe. The capability URL + key material live in the browser
 * only long enough to hand to push.subscriptions.create; the daemon stores them
 * and never hands them back (it returns the redacted view).
 *
 * Every failure is a named PushSubscribeError.reason, never a silent false —
 * the settings UI renders each one honestly (insecure context → the HTTPS
 * pointer; denied → how to re-enable in browser settings; unsupported → plain).
 */

import { sdk } from '../goodvibes';
import type { PublicPushSubscription } from '../goodvibes';
import { detectPushSupport, urlBase64ToUint8Array } from './push-support';

export type PushSubscribeFailure =
  | 'insecure-context'
  | 'unsupported'
  | 'permission-denied'
  | 'no-registration'
  | 'subscribe-failed';

export class PushSubscribeError extends Error {
  readonly reason: PushSubscribeFailure;
  constructor(reason: PushSubscribeFailure, message: string) {
    super(message);
    this.name = 'PushSubscribeError';
    this.reason = reason;
  }
}

/** The endpoint + key material extracted from a browser PushSubscription. */
export interface PushSubscriptionPayload {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

// The redacted daemon-side subscription id this device registered, kept so
// unsubscribe removes exactly this device's record (never every device the
// operator has — push.subscriptions.list is scoped to all of their devices).
const STORE_KEY = 'goodvibes.webui.push.subscriptionId';

function rememberSubscriptionId(id: string): void {
  try {
    window.localStorage.setItem(STORE_KEY, id);
  } catch {
    /* storage may be unavailable (private mode); non-fatal */
  }
}
function recallSubscriptionId(): string | null {
  try {
    return window.localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}
function forgetSubscriptionId(): void {
  try {
    window.localStorage.removeItem(STORE_KEY);
  } catch {
    /* non-fatal */
  }
}

/**
 * Pull the wire payload out of a browser PushSubscription's JSON. Pure and
 * browser-free so it is unit-testable; throws a named error when the browser
 * handed back a subscription missing its key material (never send a half one).
 */
export function extractSubscriptionPayload(json: PushSubscriptionJSON): PushSubscriptionPayload {
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    throw new PushSubscribeError('subscribe-failed', 'The browser returned an incomplete push subscription.');
  }
  return { endpoint, keys: { p256dh, auth } };
}

async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    throw new PushSubscribeError('unsupported', 'This browser has no service worker support.');
  }
  // serviceWorker.ready resolves once the SW controlling this page is active.
  return navigator.serviceWorker.ready;
}

/** True when this browser already has an active push subscription. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (detectPushSupport() !== 'ok') return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    return (await registration.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Subscribe this device: prompt for notification permission if needed, create
 * (or reuse) a PushManager subscription against the daemon's VAPID key, and
 * register it with the daemon. Returns the redacted daemon-side view.
 */
export async function subscribeToPush(): Promise<PublicPushSubscription> {
  const support = detectPushSupport();
  if (support === 'insecure-context') {
    throw new PushSubscribeError('insecure-context', 'Web Push needs a secure (HTTPS) connection.');
  }
  if (support === 'unsupported') {
    throw new PushSubscribeError('unsupported', 'This browser does not support Web Push.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new PushSubscribeError('permission-denied', 'Notifications are blocked for this site.');
  }

  const registration = await ensureRegistration();

  // Reuse an existing browser subscription if one is already present; only mint
  // a new one against the daemon's VAPID key otherwise.
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const { publicKey } = await sdk.operator.push.vapidKey();
    if (!publicKey) {
      throw new PushSubscribeError('subscribe-failed', 'The daemon returned no VAPID key.');
    }
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    } catch {
      throw new PushSubscribeError('subscribe-failed', 'The browser refused to create a push subscription.');
    }
  }

  const payload = extractSubscriptionPayload(subscription.toJSON());
  const { subscription: stored } = await sdk.operator.push.subscribe(payload);
  rememberSubscriptionId(stored.id);
  return stored;
}

/**
 * Unsubscribe this device: drop the browser PushManager subscription and remove
 * exactly this device's daemon-side record (by the id remembered at subscribe
 * time). Idempotent — safe to call when already unsubscribed.
 */
export async function unsubscribeFromPush(): Promise<void> {
  const storedId = recallSubscriptionId();
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
  } catch {
    /* the browser side may already be gone; continue to the daemon side */
  }
  if (storedId) {
    try {
      await sdk.operator.push.unsubscribe(storedId);
    } finally {
      forgetSubscriptionId();
    }
  }
}

/** Send a live test push to this device's registered subscription. */
export async function sendTestPush(): Promise<void> {
  const storedId = recallSubscriptionId();
  if (!storedId) {
    throw new PushSubscribeError('no-registration', 'This device is not registered for push yet.');
  }
  await sdk.operator.push.verify(storedId);
}
