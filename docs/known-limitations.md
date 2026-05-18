# Known Limitations

This document tracks intentional gaps and current constraints so they are not
mistaken for hidden contracts.

## Chat

- Companion chat is text-first. File attachments are supported through daemon
  artifacts, but there is no rich in-chat file preview or attachment management
  panel yet.
- Voice mode is reserved in the composer UI but does not have a complete
  browser-to-daemon voice workflow wired in WebUI.
- Chat sessions are daemon-owned. Browser local storage is only a cache for the
  active/recent session list while daemon state loads.
- Message resend/regenerate repeats the relevant user message. It does not yet
  expose a separate branch/fork model.

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
  port `3423`. The daemon/control-plane remains on `3421`.
- Network binding is intended for local network operator use. Public internet
  exposure needs an explicit deployment design with TLS, auth, and host policy.
- Mobile browsers are not the primary target while the separate mobile companion
  app exists. The desktop WebUI should still avoid broken layouts, but phone UX
  is not the main acceptance path.

## Work Planning

- TUI-local work plans are not yet a shared WebUI surface. WebUI should wait for
  durable SDK/daemon contracts before building a first-class work-plan page.

## Route Shims

- `EXTRA_METHOD_ROUTES` exists only for narrow public route gaps. Prefer SDK
  helpers when they exist, keep shims documented, and remove them after the SDK
  exposes the needed browser seam.

## Screenshots

- Documentation screenshots are captured from a fresh browser profile. They do
  not prove authenticated daemon data, provider catalog content, or operator
  chat history.
