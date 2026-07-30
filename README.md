# GoodVibes WebUI

[![CI](https://github.com/mgd34msu/goodvibes-webui/actions/workflows/ci.yml/badge.svg)](https://github.com/mgd34msu/goodvibes-webui/actions/workflows/ci.yml)
![WebUI 1.12.0](https://img.shields.io/badge/WebUI-1.12.0-00d7ff)
![SDK 1.20.0](https://img.shields.io/badge/SDK-1.20.0-8b5cf6)
![Bun 1.3.14](https://img.shields.io/badge/Bun-1.3.14-f7a8ff)

GoodVibes WebUI is the browser surface for a GoodVibes daemon: a full chat
application and operator console with feature parity across most of the
terminal UI's surface. One app serves desktop and phone — the phone gets a
drawer-based layout of the same views, never a different mental model — and it
installs from the browser as a standalone app (add to home screen, offline
shell, push notifications).

It does not need to run on the same machine as the daemon. Point it at a
daemon reachable over Tailscale — an HTTPS hostname on your tailnet, the path
the installable app, offline shell, and Web Push are built around — or at a
daemon on the same local network with firewall policy allowing the connection;
both are covered in [docs/deployment.md](docs/deployment.md). In production the
daemon can also serve the built WebUI bundle itself, same-origin, so the
browser and the API share one address and there is no cross-origin setup at all.

The application is intentionally thin over the published GoodVibes SDK. Browser
code uses the public scoped SDK seams from npm (typed contracts, no hand-typed
wire shapes) and talks to the daemon through the configured WebUI origin and
Vite proxy during development, or same-origin when the daemon serves the built
bundle itself.

Stack: Bun, Vite, React, TypeScript, TanStack Query, `@pellux/goodvibes-sdk`,
`react-markdown`/`remark-gfm`/`remark-breaks`/`highlight.js` for chat and
Knowledge Markdown rendering, and Playwright for the phone + desktop end-to-end
suites against a hermetic mock daemon.

---

## Quick Start

Prerequisites:

- Bun `1.3.14`
- A running GoodVibes daemon, reachable locally or over the network
- An installed `goodvibes` CLI for standalone development, so Vite can resolve
  the configured WebUI binding via `goodvibes web --json`

```bash
bun install
bun run dev
```

Use the URL Vite prints after startup as the source of truth for the bind
address — the default local URL is `http://127.0.0.1:3423/`. The daemon/
control-plane API is canonical on port `3421`; in development, Vite proxies
`/api/*`, `/login`, `/status`, `/task`, and `/config` (including WebSocket
upgrades) to it, with `strictPort: true` so a port conflict fails loudly
instead of silently moving ports. For running the daemon and reaching it from
another machine, see [docs/deployment.md](docs/deployment.md) and
[docs/development.md](docs/development.md).

---

## A tour of the surfaces

Screenshots are captured from the dev server against the end-to-end suite's
seeded mock daemon at 1440×1000, dark theme — they prove layout, not live
daemon data, auth state, or provider inventory. The full walkthrough, one
surface at a time (including a collapsed-sidebar layout), is
[docs/screenshot-tour.md](docs/screenshot-tour.md).

| Chat | Sessions |
| --- | --- |
| ![Chat view: a streaming assistant reply with syntax-highlighted markdown, a searchable session sidebar, and a rich composer.](docs/assets/screenshots/chat.png) | ![Sessions view: the cross-surface session list with search, and a transcript open for one session.](docs/assets/screenshots/sessions.png) |

| Fleet | Memory |
| --- | --- |
| ![Fleet view: the live process tree showing per-agent state and inline approvals.](docs/assets/screenshots/fleet.png) | ![Memory view: the shared memory store with recall-honesty details rendered next to each record.](docs/assets/screenshots/memory.png) |

| Knowledge | Calendar |
| --- | --- |
| ![Knowledge view: the regular Knowledge/Wiki surface with sources, nodes, and search.](docs/assets/screenshots/knowledge.png) | ![Calendar view: an agenda rendered from the daemon's calendar module.](docs/assets/screenshots/calendar.png) |

| Providers | Admin |
| --- | --- |
| ![Providers view: provider status pills and a model workspace scoped to the selected provider.](docs/assets/screenshots/providers.png) | ![Admin view: auth, daemon diagnostics, config with secret redaction, and display preferences.](docs/assets/screenshots/admin.png) |

Chat is the primary workspace; the rest are operator surfaces over the same
daemon state the terminal UI uses.

---

## What's in the box

Each row links to the page that documents it in depth. `?`-style in-app help
does not exist here yet — these docs and the Admin diagnostics view are the
current authority.

| Surface | What you get | Docs |
| --- | --- | --- |
| Chat | Daemon-owned companion chat: streaming markdown, searchable history, attachments, regenerate and edit-with-branching, automatic titles, stop-generation, an artifacts slide-over | [operator-guide.md](docs/operator-guide.md) |
| Sessions | The cross-surface session union — find, read, steer, or follow up on any session started from the terminal, agent, or browser | [operator-guide.md](docs/operator-guide.md) |
| Fleet | The live process tree with per-agent state, steer/detach/stop where the wire supports them, and inline approvals (per-hunk on wide screens) | [operator-guide.md](docs/operator-guide.md) |
| Checkpoints | Browse, create, restore, and diff checkpoint-to-checkpoint | [operator-guide.md](docs/operator-guide.md) |
| Knowledge/Wiki | The regular Knowledge surface — ask, search, sources/nodes/issues/maps, projections and ingest where the SDK exposes them. Home Assistant Home Graph is deliberately not part of this page | [operator-guide.md](docs/operator-guide.md) |
| Memory | Browse and search the shared cross-surface memory store, recall-honesty details rendered verbatim, review-state edits, and true (verified) deletion | [operator-guide.md](docs/operator-guide.md) |
| Calendar | Agenda from the daemon's calendar module with ICS import/export; an unconfigured daemon shows a bring-your-own-CalDAV note, never a fake-empty calendar | [operator-guide.md](docs/operator-guide.md), [known-limitations.md](docs/known-limitations.md) |
| Voice | Batched spoken replies and microphone dictation over the daemon's speech-to-text, with review-before-send; one voice configuration shared across terminal, desktop, and agent | [operator-guide.md](docs/operator-guide.md) |
| Providers / Models | Provider status pills driven by the daemon's own route freshness, and a provider-first model workspace | [operator-guide.md](docs/operator-guide.md) |
| Approvals / Tasks / Workstream | Decision queues and orchestration state, plus push-notification action buttons that hand off to an authenticated in-app decision | [operator-guide.md](docs/operator-guide.md), [push-approval-actions.md](docs/push-approval-actions.md) |
| Admin | Auth, daemon diagnostics, config with secret redaction, display preferences, notifications-and-install (Web Push subscribe lives here) | [operator-guide.md](docs/operator-guide.md) |
| Console UX | ⌘K command palette with global hotkeys, a persistent daemon pulse strip, URL deep-linking, honest degraded states, dark-first theming with density modes, and full keyboard/`aria-live`/focus-trap accessibility | [architecture.md](docs/architecture.md) |
| Install and push | Add-to-home-screen install, a cached app shell with honest offline (no API response is ever cached), and Web Push for approvals/completions | [deployment.md](docs/deployment.md) |
| Architecture | Runtime topology, the SDK boundary, state ownership, and route ownership | [architecture.md](docs/architecture.md) |
| Auth and network | The daemon-owned trust boundary, token storage, and network binding rules | [security.md](docs/security.md) |
| Known limitations | Intentional gaps and current constraints, so they aren't mistaken for hidden contracts | [known-limitations.md](docs/known-limitations.md) |
| SDK surface matrix | The exact public SDK/daemon methods each surface uses, plus explicit non-surfaces | [sdk-surface-matrix.md](docs/sdk-surface-matrix.md) |
| Troubleshooting | Common auth, network, chat, provider/model, and Vite-cache failures with recovery steps | [troubleshooting.md](docs/troubleshooting.md) |

---

## Configuration

There is no user-facing WebUI settings file — the daemon owns configuration
and auth, and the browser only caches UI preferences and recent-session ids,
never as a durable source of truth. What you can set:

| Setting | Where | What it does |
| --- | --- | --- |
| `GOODVIBES_WEB_HOST` / `GOODVIBES_WEB_PORT` | Launch environment (TUI/daemon) | Resolved Vite bind host/port |
| `GOODVIBES_DAEMON_BASE_URL` | Launch environment | Daemon/control-plane backend URL |
| `VITE_GOODVIBES_WEBUI_HOST` / `VITE_GOODVIBES_WEBUI_PORT` | One-off dev override | Vite bind host/port for a single run |
| `VITE_GOODVIBES_BACKEND_URL` | One-off dev override | Development proxy target |
| `VITE_GOODVIBES_BASE_URL` | One-off dev override | Bypass same-origin proxying entirely |
| Theme, density | Admin → display preferences, browser `localStorage` | Dark-first token system; compact/default/comfortable density |
| Operator token | Pasted in Admin, `localStorage` key `goodvibes.webui.token` | Browser-held auth token, validated against the daemon |

The full binding precedence order and remaining one-off variables are in
[docs/development.md](docs/development.md). Auth, token custody, and the files
the browser must never read are in [docs/security.md](docs/security.md).

---

## Development

```bash
git clone https://github.com/mgd34msu/goodvibes-webui.git
cd goodvibes-webui
bun install
bun run dev
```

| Command | Does |
| --- | --- |
| `bun run dev` | Run the WebUI against a configured/resolved daemon |
| `bun run test` | Bun's isolated test runner (1,916 tests across 140 files, verified passing while writing this) |
| `bun run typecheck` | `tsc --noEmit` (verified clean while writing this) |
| `bun run build` | Presentation-token, config-schema, and internal-identifier checks, typecheck, then `vite build` |
| `bun run lint` | ESLint over the whole tree |
| `bun run e2e` | Playwright, phone + desktop projects, against the hermetic mock daemon (`e2e/support/mock-daemon.ts`) |
| `bun run ci` | `test` + `typecheck` + `build` — the same sequence CI runs |
| `bun run gate` | `ci` plus the release gate (SDK pin/lock/import agreement) |

GitHub Actions runs three jobs on every push and pull request to `main`, all
three blocking: `test` (typecheck, test, build, coverage, the release gate),
`lint`, and `e2e` (Playwright, phone + desktop, hermetic mock daemon). No job
runs with `continue-on-error` — a red job reds the run
(ruling: [docs/decisions/2026-07-07-e2e-ci-in-ci.md](docs/decisions/2026-07-07-e2e-ci-in-ci.md)).
A green push-CI run on `main` is the only release gate: the workflow tags the
commit and opens a GitHub Release with notes cut from `CHANGELOG.md`. This
repo ships no build artifacts — the tag and the release notes are the entire
release.

Coding rules worth knowing before you read the source:

- Import browser code from the published `@pellux/goodvibes-sdk` npm package
  only — never a local SDK checkout, never deep SDK internals.
- Keep canonical state in the daemon; browser storage is cache/preferences
  only, and it must never read `~/.goodvibes/**` files.
- Presentation tokens (`src/styles/tokens.css`) are generated from the SDK's
  shared presentation contract by `scripts/generate-presentation-tokens.ts`,
  never hand-edited.
- Operator methods without a dedicated SDK helper ride the generic typed
  invoke path, typed from the SDK's generated contract maps
  (`src/lib/contract-bridge-types.ts`) — no hand-typed wire shapes.
- Do not add Home Assistant Home Graph filtering to the regular
  Knowledge/Wiki surface.

Source layout, in brief:

```text
src/
├── App.tsx, main.tsx        app shell, routing, top-level composition
├── lib/                      SDK facade, chat/session helpers, theme, push, pairing, generated tokens
├── views/                    one directory per operator surface (chat, sessions, fleet, memory, calendar, ...)
├── components/                command palette, modals, toasts, diff, fleet widgets, motion, settings
├── hooks/                     shared React hooks
└── styles/                    token CSS and per-component stylesheets
```

For routine SDK version bumps, follow
[docs/sdk-update-checklist.md](docs/sdk-update-checklist.md).

---

## Stability

This repo is not published to npm by design. It is versioned with semantic
`vMAJOR.MINOR.PATCH` git tags and distributed as source: a green CI run on
`main` tags the commit and opens a GitHub Release whose notes are cut from
`CHANGELOG.md`, with no built binary attached — run it from `bun install` +
`bun run build`, or let a daemon serve the built bundle same-origin. Every
shipped change updates `package.json`, `CHANGELOG.md`, the version badges
above, and `index.html`'s cache-bust query string. Documentation always
describes the **current** behavior, not historical behavior — see
[CHANGELOG.md](CHANGELOG.md) for history.

## License

No `LICENSE` file is present in this repository, and `package.json` declares
no `license` field. Licensing terms are unresolved until one is added.
