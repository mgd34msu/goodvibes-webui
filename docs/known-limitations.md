# Known Limitations

This document tracks intentional gaps and current constraints so they are not
mistaken for hidden contracts.

## Chat

- Chat sessions are daemon-owned. Browser local storage is only a cache for the
  active/recent session list while daemon state loads.
- Edit-with-branching keeps superseded turns viewable, but branches are linear
  alternatives on one conversation — there is no tree browser across branches.
- Attachments upload as daemon artifacts before send; large outputs open in the
  artifacts slide-over. There is no dedicated attachment-management panel.

## Voice

- Browser voice depends entirely on the daemon's configured speech providers.
  With no speech-to-text provider configured, the dictation control explains
  what to add rather than recording; there is no in-browser/offline fallback.
- Spoken replies are batched synthesis over the wire, not a realtime duplex
  voice conversation.

## Phone

- Every view is browsable at phone width, but some mutations defer to a wider
  screen with an honest pointer: checkpoint create/restore and task
  submit/cancel/retry are desktop-only today.

## Calendar

- The calendar reads the daemon calendar module: ICS file import and read-only
  feed subscriptions. Connecting an account (CalDAV/OAuth) is bring-your-own
  credentials via the advanced connect card; the bundled provider app
  registrations are placeholders that refuse honestly and point at
  bring-your-own until real registrations are configured.

## Install and Push

- Install (add to home screen) and Web Push require a secure (HTTPS) context —
  on a plain-HTTP LAN address the app says so and points at serving over HTTPS
  (for example `tailscale serve`). On iOS, push works only for the installed
  app, and the app says that too.

## Knowledge/Wiki

- The WebUI uses regular Knowledge/Wiki routes only. Home Assistant Home Graph
  remains a separate daemon extension surface and should not be mixed into this
  page.
- Projection and ingest affordances depend on the public SDK/daemon methods that
  are available in the installed npm package.
- If regular Knowledge results contain Home Graph records by default, that is an
  SDK/daemon scoping issue. WebUI should report exact endpoints and ids rather
  than adding client-side filters.

## Providers and Models

- Provider/model selection follows daemon runtime semantics. Runtime provider
  ids can differ from catalog prefixes, so UI labels should not be treated as
  route payloads without normalization.
- The model dropdown is scoped to the selected provider. Missing models usually
  mean provider discovery or daemon model catalog data needs inspection.

## Network and Deployment

- The development server is Vite on the TUI-resolved WebUI binding, normally
  port `3423`. The daemon/control-plane remains on `3421`. For production use
  the daemon serves the built bundle same-origin (see
  [deployment.md](deployment.md)).
- Network binding is intended for local-network/tailnet operator use. Public
  internet exposure needs an explicit deployment design with TLS, auth, and
  host policy.

## Route Shims

- Retired. Operator methods without a convenience helper ride the generic typed
  invoke path with contract-derived types (`src/lib/contract-bridge-types.ts`);
  a test pins that the old per-route shim table does not come back.

## Screenshots

- Documentation screenshots are captured against the end-to-end suite's seeded
  mock daemon. They prove layout, not authenticated daemon data, provider
  catalog content, or operator chat history.
