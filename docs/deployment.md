# Deployment: reaching the app from another machine, and installing it

The web UI is one app with two packagings: a normal browser tab, and an
installable app you add to your phone's Home Screen (a Progressive Web App).
Both talk to the same GoodVibes daemon. This page covers how to reach the app
from a machine that is **not** the one running the daemon, how to install it, and
how notifications work.

## The short version

- The daemon can serve the built web UI **from its own origin** (same-origin),
  so the browser and the API share one address and there is no cross-origin
  setup to do.
- To reach that origin from your phone or another computer over HTTPS, put
  `tailscale serve` in front of the daemon. HTTPS is what makes the installable
  app, offline shell, and push notifications possible at all.
- Notifications are delivered by the daemon, which must be running to send them.

## Where the bundle is served from

There are two supported topologies.

### 1. Same-origin (recommended)

The daemon serves the built web UI bundle at `/`, on the same origin as its API.
Enable the web-UI-serving capability on the daemon (it is off by default; the
daemon stays loopback-only until you turn it on):

```
controlPlane.webui.serve = true   # daemon config — opt-in, never automatic
```

With this on, the browser loads the app and calls the API from the **same
address**, so the browser's same-origin rules are a non-issue — nothing about
cross-origin requests applies. This is the path the PWA, the offline shell, and
Web Push are designed around.

### 2. Separate origin (dev, or a reverse proxy)

If the app is served from a different origin than the daemon — for example the
Vite dev server on `localhost:5173` talking to a daemon on another port, or a
reverse proxy in front of a separately-hosted bundle — the daemon must be told
which origins may call it (an explicit allowlist; it is empty by default). This
is the secondary path; prefer same-origin serving for anything but development.

## Moving the host: reaching the daemon over Tailscale

The daemon listens on loopback by default, which is correct — it should not be
open to your whole network. To reach it from your phone or a laptop **without**
exposing it broadly, front it with Tailscale:

```bash
# On the machine running the daemon:
tailscale serve --bg 3421     # or the daemon's control-plane port
```

`tailscale serve` gives you an HTTPS hostname on your tailnet (for example
`https://your-machine.tailnet.ts.net/`) that reaches the single daemon origin.
Because the bundle and the API arrive **same-origin over HTTPS**, everything
works with zero cross-origin configuration:

- Open the HTTPS hostname in your phone's browser.
- Sign in once with your operator token (stored only as the browser session
  token, `goodvibes.webui.token`).
- The app is now reachable from anywhere on your tailnet.

HTTPS here is not optional polish: service workers, the installable app, the
offline shell, and Web Push **all require a secure context**. Over plain HTTP to
a LAN IP the browser refuses them, and the app says so plainly (it points you at
opening the app over HTTPS) rather than showing a broken control.

## Installing the app (add to Home Screen)

There is no app store and no separate download — the app installs straight from
the browser once it is served over HTTPS.

- **Android / Chromium:** open the app, then use the **Install app** /
  **Add to Home Screen** button in the app's Notifications & install settings
  (or your browser's menu).
- **iOS / Safari:** tap the **Share** button, then **Add to Home Screen**. iOS
  has no automatic install prompt, so this is the only path — the app shows those
  instructions when it detects iOS.

Once installed, the app opens in its own window (no browser chrome) and starts
instantly, because its shell is cached.

## Honest offline

The installed app opens instantly even with no network, because the **app shell**
(the page and its code) is cached. But the daemon is the single source of truth
for every piece of live data, and **no API response is ever cached**. So when you
open the app offline, or while the daemon is unreachable, the shell loads and
then shows the ordinary "Can't reach the daemon" state — the same honest,
reconnecting state you would see in a normal browser tab.

The app never shows you cached data dressed up as live. Offline is a plainly
degraded state, not a stale snapshot pretending to be current.

## Notifications (Web Push)

The app can receive approvals and completions as notifications on your device,
even when it isn't open.

- Turn them on from **Admin → Notifications & install → Turn on notifications**.
  The browser asks for permission; if you block it, the app tells you how to
  re-enable it instead of leaving a dead toggle.
- Notifications are sent by **your daemon**. It must be running to deliver them,
  and it holds the subscription — nothing is stored with a third party beyond the
  browser's own push service, and your device's push address is never handed back
  out over the wire.
- Tapping an approval notification deep-links straight to the Approvals view.

### The one-machine Tailscale-node note

Web Push needs a secure context, which on a home setup means the HTTPS hostname
`tailscale serve` provides. For push to work end to end, reach the app through
that **same** Tailscale HTTPS origin you subscribed on — the subscription is tied
to the origin it was created on. In practice: serve the daemon over Tailscale on
the machine that runs it, open the app at that HTTPS hostname, and subscribe
there. Opening the app at a different address later (a raw LAN IP, a different
hostname) is a different origin and will not carry the subscription.

### iOS caveat

iOS delivers Web Push only to an **installed** app (Add to Home Screen), and only
on recent iOS versions. On iOS, install the app first, open it once, then turn on
notifications. The app surfaces this honestly if you try to subscribe from a
browser tab that can't receive push.
