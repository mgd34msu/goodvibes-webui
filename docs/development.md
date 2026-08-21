# Development

## Prerequisites

- Bun `1.3.14`
- GoodVibes daemon running locally or on an explicitly configured backend URL
- For standalone WebUI development, an installed `goodvibes-daemon` binary
  that answers `webui status --json` (the binding authority), or the older
  `goodvibes` terminal CLI as the fallback binding source

Install dependencies:

```bash
bun install
```

Run the dev server:

```bash
bun run dev
```

Run full validation:

```bash
bun run ci
```

## Dev server binding

The WebUI binds to the daemon-resolved web listener. The default port is
`3423`, with `strictPort` on so a conflict fails loudly instead of silently
moving ports.

Precedence:

1. `GOODVIBES_WEB_HOST`, `GOODVIBES_WEB_PORT`, `GOODVIBES_DAEMON_BASE_URL`
2. `VITE_GOODVIBES_WEBUI_HOST`, `VITE_GOODVIBES_WEBUI_PORT`,
   `VITE_GOODVIBES_BACKEND_URL`
3. `goodvibes-daemon webui status --json` (checked against the binary's own
   `--help` first, so a daemon that does not know the subcommand is never
   accidentally started by the dev server)
4. `goodvibes web --json`, the deprecated terminal-owned fallback
5. `~/.goodvibes/tui/settings.json` for local development bootstrap

The development proxy target should connect to the daemon/control-plane API,
normally `127.0.0.1:3421`. If the daemon binds to `0.0.0.0`, use
`127.0.0.1` as the local proxy target. `0.0.0.0` is a bind address, not a
client connection URL.

Example one-off override:

```bash
VITE_GOODVIBES_BACKEND_URL=http://127.0.0.1:3421 bun run dev
```

## Environment variables

Use these only when the default resolver is wrong for the current run:

- `GOODVIBES_WEB_HOST`: resolved host for Vite to bind
- `GOODVIBES_WEB_PORT`: resolved port for Vite to bind
- `GOODVIBES_DAEMON_BASE_URL`: daemon/control-plane backend URL
- `GOODVIBES_WEB_ALLOWED_HOSTS`: comma-separated additional Vite allowed hosts
- `GOODVIBES_WEB_PUBLIC_BASE_URL`: user-facing WebUI URL
- `VITE_GOODVIBES_BASE_URL`: bypass same-origin proxying and talk directly to a
  backend origin from browser SDK calls
- `VITE_GOODVIBES_BACKEND_URL`: development proxy target override
- `VITE_GOODVIBES_WEBUI_HOST`: one-off Vite bind host override
- `VITE_GOODVIBES_WEBUI_PORT`: one-off Vite bind port override
- `VITE_GOODVIBES_WEBUI_ALLOWED_HOSTS`: comma-separated additional Vite allowed
  hosts

Do not use browser code to read `~/.goodvibes`.

## Validation

Fast test loop:

```bash
bun run test
```

Typecheck:

```bash
bun run typecheck
```

Production build:

```bash
bun run build
```

Full CI-equivalent:

```bash
bun run ci
```

## Local code organization

- `src/lib/goodvibes.ts`: the SDK facade, auth, the generated route table,
  and typed invoke helpers.
- `src/lib/companion-chat.ts` and `src/lib/companion-sessions-state.ts`: chat
  session/message normalization, the local cache, and the one client-side
  session-list reducer.
- `src/lib/provider-models.ts`: provider/model extraction and catalog/runtime
  mapping.
- `src/lib/relay-connection.ts`, `src/lib/relay-pairing.ts`: the direct/relay
  transport route and the stored relay pairing.
- `src/lib/pairing*.ts`: the `#pair=` hand-off, the QR payload parser, and the
  camera scanner plumbing.
- `src/lib/voice/`: capture, dictation, synthesis, and the wake-word host.
- `src/lib/push/`, `src/lib/pwa/`: Web Push client and service-worker
  registration.
- `src/lib/ui-preferences.ts`: browser UI preferences.
- `src/views/`: one directory (or file) per operator surface; `src/views/chat/`
  holds the composer, stream, search, and lineage modules behind
  `ChatView.tsx`.
- `src/components/MarkdownMessage.tsx`: Markdown, code block copy, highlighting,
  and decorative line numbers.

## Coding rules

- Use the published npm `@pellux/*` packages.
- Do not deep-import package internals (`dist/` reaches fail a pinned test).
- Keep canonical state in the daemon.
- Treat browser local storage as cache/preferences only.
- Prefer daemon snapshots/lists as source of truth and realtime as invalidation.
- Never hand-write a method route: the route table derives from the generated
  `webui-facade` artifact, and a drift test pins the derivation.
- Do not add Home Graph filtering to regular Knowledge.

## Versioning

The app uses semantic versioning and `vMAJOR.MINOR.PATCH` git tags.

For any shipped change:

1. Update `package.json`.
2. Update `CHANGELOG.md`.
3. Update `index.html` cache-bust values when the app version changes.
4. Run `bun run ci`.
5. Commit and push. Do not tag by hand: the auto-release job tags a green
   `main` run and attaches the built bundle to the GitHub Release.
6. Confirm GitHub CI passes and the release appears.
