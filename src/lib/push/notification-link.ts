/**
 * notification-link.ts — where a push notification's tap deep-links to.
 *
 * The daemon fans an approval out as a PushMessage whose `data` is
 * `{ kind: 'approval', approvalId }` (SDK push/service.ts). A tap should land
 * the operator on the view where that action lives, not just the app root.
 *
 * This is the PURE, unit-tested source of truth for that mapping. The service
 * worker (public/sw.js) carries a hand-kept copy of the same logic in
 * `linkForNotification` — a SW cannot import app modules without a bundler
 * step, so the two are kept deliberately in sync and this file's tests pin the
 * behavior both must share.
 */

export interface NotificationData {
  readonly kind?: string;
  readonly approvalId?: string;
  readonly url?: string;
  readonly [key: string]: unknown;
}

/**
 * Map a notification's `data` onto an in-app URL (a `?view=…` deep link the
 * custom router reads). Falls back to the app root for anything unrecognized,
 * so a tap is never a dead end.
 */
export function linkForNotification(data: NotificationData | undefined | null): string {
  if (data?.kind === 'approval') return '/?view=approvals-tasks';
  if (typeof data?.url === 'string' && data.url.startsWith('/')) return data.url;
  return '/';
}
