/**
 * NotificationSettings — the settings-area surface for Web Push + install.
 *
 * Two capabilities, each with honest per-state copy (never a dead toggle):
 *
 *   Push notifications — subscribe/unsubscribe this device for the approval and
 *   completion pushes the daemon fans out. Every "can't" is named: an insecure
 *   context points at HTTPS (the Tailscale-serve pointer the dictation surface
 *   already uses); a blocked permission explains how to re-enable it; an
 *   unsupported browser says so plainly (iOS has real web-push caveats).
 *
 *   Install — add-to-home-screen. A button on Chromium (replaying the captured
 *   beforeinstallprompt); the Share-menu instructions on iOS; nothing when the
 *   app is already installed.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, BellOff, Send, ShieldAlert, Smartphone } from 'lucide-react';
import {
  currentSubscription,
  describePushSubscribeError,
  sendTestPush,
  subscribeToPush,
  unsubscribeFromPush,
} from '../../lib/push/push-client';
import { detectPushSupport, readNotificationPermission } from '../../lib/push/push-support';
import type { PushSupport, NotificationPermissionState } from '../../lib/push/push-support';
import { useInstallPrompt } from '../../lib/pwa/install-prompt';
import { useToast } from '../../lib/toast';
import '../../styles/components/notifications.css';

const pushErrorMessage = describePushSubscribeError;

export function NotificationSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // Support + permission read the DOM; both detectors are SSR/test-safe (they
  // fall back to 'unsupported' when window/Notification are absent), so a lazy
  // initializer reads them once at mount without a cascading effect.
  const [support] = useState<PushSupport>(() => detectPushSupport());
  const [permission, setPermission] = useState<NotificationPermissionState>(() => readNotificationPermission());
  const { affordance, promptInstall } = useInstallPrompt();

  const subscribed = useQuery({
    queryKey: ['push', 'subscribed'],
    queryFn: async () => (await currentSubscription()) !== null,
    enabled: support === 'ok',
  });

  const subscribe = useMutation({
    mutationFn: subscribeToPush,
    onSuccess: async () => {
      setPermission(readNotificationPermission());
      await queryClient.invalidateQueries({ queryKey: ['push', 'subscribed'] });
      toast({ title: 'Notifications on', description: 'This device will receive approval and completion pushes.', tone: 'success' });
    },
    onError: (error) => {
      setPermission(readNotificationPermission());
      toast({ title: 'Could not enable notifications', description: pushErrorMessage(error), tone: 'danger' });
    },
  });

  const unsubscribe = useMutation({
    mutationFn: unsubscribeFromPush,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['push', 'subscribed'] });
      toast({ title: 'Notifications off', description: 'This device will no longer receive pushes.', tone: 'success' });
    },
    onError: (error) => {
      toast({ title: 'Could not disable notifications', description: pushErrorMessage(error), tone: 'danger' });
    },
  });

  const test = useMutation({
    mutationFn: sendTestPush,
    onSuccess: () => toast({ title: 'Test push sent', description: 'Watch for a notification on this device.', tone: 'success' }),
    onError: (error) => toast({ title: 'Test push failed', description: pushErrorMessage(error), tone: 'danger' }),
  });

  const isSubscribed = subscribed.data === true;

  return (
    <section className="panel notifications-panel">
      <div className="panel-title">
        <h2>Notifications &amp; install</h2>
        <BellRing size={18} aria-hidden="true" />
      </div>

      {support === 'insecure-context' ? (
        <div className="banner warning" role="status">
          <ShieldAlert size={16} aria-hidden="true" />{' '}
          Web Push needs a secure (HTTPS) connection. Open this app over HTTPS — for a home
          machine, <code>tailscale serve</code> fronts the daemon with an HTTPS hostname, and
          push then works same-origin.
        </div>
      ) : support === 'unsupported' ? (
        <div className="banner warning" role="status">
          <ShieldAlert size={16} aria-hidden="true" />{' '}
          This browser does not support Web Push. On iOS, add the app to your Home Screen first —
          iOS delivers push only to an installed app (iOS 16.4+).
        </div>
      ) : (
        <div className="notifications-push">
          <p className="form-note">
            Get an approval or completion as a notification on this device, even when the app
            isn&rsquo;t open. Notifications come straight from your daemon — nothing is stored
            elsewhere.
          </p>
          {permission === 'denied' && (
            <div className="banner warning" role="status">
              <BellOff size={16} aria-hidden="true" />{' '}
              Notifications are blocked for this site. Re-enable them in your browser&rsquo;s
              site settings to subscribe.
            </div>
          )}
          <div className="notifications-actions">
            {isSubscribed ? (
              <>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={unsubscribe.isPending}
                  onClick={() => unsubscribe.mutate()}
                >
                  <BellOff size={15} aria-hidden="true" /> {unsubscribe.isPending ? 'Turning off…' : 'Turn off notifications'}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={test.isPending}
                  onClick={() => test.mutate()}
                >
                  <Send size={15} aria-hidden="true" /> {test.isPending ? 'Sending…' : 'Send a test push'}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="primary-button"
                disabled={subscribe.isPending || permission === 'denied'}
                onClick={() => subscribe.mutate()}
              >
                <BellRing size={15} aria-hidden="true" /> {subscribe.isPending ? 'Enabling…' : 'Turn on notifications'}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="notifications-install">
        <div className="notifications-install__head">
          <Smartphone size={16} aria-hidden="true" />
          <strong>Install this app</strong>
        </div>
        {affordance === 'installed' ? (
          <p className="form-note">This app is installed and running from your Home Screen.</p>
        ) : affordance === 'prompt' ? (
          <button type="button" className="secondary-button" onClick={() => void promptInstall()}>
            Add to Home Screen
          </button>
        ) : affordance === 'ios-instructions' ? (
          <p className="form-note">
            To install on iOS: tap the Share button, then <strong>Add to Home Screen</strong>.
            Open the installed app once to enable notifications.
          </p>
        ) : (
          <p className="form-note">
            Use your browser&rsquo;s menu to add this app to your Home Screen or apps.
          </p>
        )}
      </div>
    </section>
  );
}
