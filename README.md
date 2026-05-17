# GoodVibes WebUI

GoodVibes WebUI is the browser operator surface for the GoodVibes daemon. It is
built for day-to-day daemon interaction: companion chat, regular Knowledge/Wiki,
provider/model management, and admin/auth controls.

The application is intentionally thin over the published GoodVibes SDK. Browser
code uses the public scoped SDK seams from npm and talks to the daemon through
the configured WebUI origin and Vite proxy during development.

## Current Versions

- WebUI: `0.1.36`
- SDK: `@pellux/goodvibes-sdk@0.33.30`
- Runtime: Bun `1.3.10`

## Stack

- Bun
- Vite
- React
- TypeScript
- TanStack Query
- `@pellux/goodvibes-sdk`
- `react-markdown`, `remark-gfm`, `remark-breaks`, and `highlight.js` for
  assistant/knowledge Markdown rendering

## Documentation

- [Architecture](docs/architecture.md): runtime topology, SDK boundaries, state,
  and route ownership.
- [Operator Guide](docs/operator-guide.md): what each WebUI surface is for and
  the expected user workflows.
- [Development](docs/development.md): local setup, environment variables,
  network binding, validation, and repo conventions.
- [SDK Update Checklist](docs/sdk-update-checklist.md): exact steps for routine
  SDK bumps.
- [Troubleshooting](docs/troubleshooting.md): common auth, network, chat,
  provider/model, and Vite-cache failures.
- [Changelog](CHANGELOG.md): semver history and release notes.

## Quick Start

Prerequisites:

- Bun `1.3.10`
- A running GoodVibes daemon
- An installed `goodvibes` CLI when running standalone development, so Vite can
  resolve the configured WebUI binding with `goodvibes web --json`

Install and run:

```bash
bun install
bun run dev
```

The browser app runs on the GoodVibes web surface port. The default local URL is:

```bash
http://127.0.0.1:3423/
```

On this machine, the TUI/daemon web setting may resolve to a network listener
such as:

```bash
http://192.168.0.61:3423/
```

Use the URL printed by Vite after startup as the source of truth for the current
bind address.

## Runtime Topology

The daemon/control-plane API is canonical on port `3421`. The WebUI browser
surface is canonical on port `3423`.

In development, Vite:

- binds to the TUI-resolved WebUI host and port
- proxies same-origin `/api/*`, `/login`, `/status`, `/task`, and `/config`
  requests to the daemon/control-plane origin
- supports WebSocket upgrades for proxied control-plane routes
- uses `strictPort: true` so it fails loudly instead of silently moving ports

Binding precedence:

1. Explicit launch environment from TUI/daemon:
   `GOODVIBES_WEB_HOST`, `GOODVIBES_WEB_PORT`, and
   `GOODVIBES_DAEMON_BASE_URL`
2. One-off development overrides:
   `VITE_GOODVIBES_WEBUI_HOST`, `VITE_GOODVIBES_WEBUI_PORT`, and
   `VITE_GOODVIBES_BACKEND_URL`
3. `goodvibes web --json`
4. TUI settings file fallback for dev bootstrap only

Do not make browser code read `~/.goodvibes` files. Those files are daemon/TUI
implementation state.

## Auth

Browser auth is daemon-owned.

- Username/password login goes through the daemon login route.
- Explicit operator tokens may be pasted by the user and validated against the
  daemon.
- The browser token store key is `goodvibes.webui.token`.
- The WebUI does not scrape bootstrap credentials, operator token files, or any
  `~/.goodvibes` auth files.

## Main Surfaces

- Chat: daemon-owned companion chat via `sdk.chat`.
- Knowledge: regular/base Knowledge and Wiki only via the scoped browser
  Knowledge SDK.
- Providers: daemon provider/model discovery and current model selection.
- Admin: auth, local auth status, config, display preferences, and diagnostic
  snapshots.

Home Assistant Home Graph is not part of the general Knowledge/Wiki surface.
Do not call Home Graph routes or add WebUI-side Home Graph filtering to the
regular Knowledge page. Regular Knowledge scoping is owned upstream by the
daemon/SDK.

## Verification

Run the same sequence GitHub Actions runs:

```bash
bun run ci
```

Equivalent expanded steps:

```bash
bun run test
bun run typecheck
bun run build
```

GitHub Actions runs install, test, typecheck, and build on pushes and pull
requests to `main`.

## Release Notes

This repo uses semantic versioning with `vMAJOR.MINOR.PATCH` git tags. Every
shipped change should update:

- `package.json` version
- `CHANGELOG.md`
- `index.html` favicon/cache-bust query string when the app version changes

For SDK bumps, follow [docs/sdk-update-checklist.md](docs/sdk-update-checklist.md).
