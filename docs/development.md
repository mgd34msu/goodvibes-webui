# Development

## Prerequisites

- Bun `1.3.10`
- GoodVibes daemon running locally or on an explicitly configured backend URL
- Installed `goodvibes` CLI for standalone WebUI development

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

## Dev Server Binding

The WebUI should bind to the TUI-resolved web listener. The default port is
`3423`.

Precedence:

1. `GOODVIBES_WEB_HOST`, `GOODVIBES_WEB_PORT`, `GOODVIBES_DAEMON_BASE_URL`
2. `VITE_GOODVIBES_WEBUI_HOST`, `VITE_GOODVIBES_WEBUI_PORT`,
   `VITE_GOODVIBES_BACKEND_URL`
3. `goodvibes web --json`
4. TUI settings fallback for local development bootstrap

The development proxy target should connect to the daemon/control-plane API,
normally `127.0.0.1:3421`. If the daemon binds to `0.0.0.0`, use
`127.0.0.1` as the local proxy target. `0.0.0.0` is a bind address, not a
client connection URL.

Example one-off override:

```bash
VITE_GOODVIBES_BACKEND_URL=http://127.0.0.1:3421 bun run dev
```

## Environment Variables

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

## Local Code Organization

- `src/lib/goodvibes.ts`: SDK facade, auth, extra route shims, and typed invoke
  helpers.
- `src/lib/companion-chat.ts`: chat session/message normalization and local
  cache helpers.
- `src/lib/provider-models.ts`: provider/model extraction and catalog/runtime
  mapping.
- `src/lib/ui-preferences.ts`: browser UI preferences.
- `src/views/ChatView.tsx`: companion chat surface.
- `src/views/KnowledgeView.tsx`: regular Knowledge/Wiki surface.
- `src/views/ProvidersView.tsx`: provider/model surface.
- `src/views/AdminView.tsx`: auth/admin/diagnostic surface.
- `src/components/MarkdownMessage.tsx`: Markdown, code block copy, highlighting,
  and decorative line numbers.

## Coding Rules

- Use the published npm SDK package.
- Do not deep-import SDK internals.
- Keep canonical state in the daemon.
- Treat browser local storage as cache/preferences only.
- Prefer daemon snapshots/lists as source of truth and realtime as invalidation.
- Keep route shims narrow and remove them when SDK public helpers exist.
- Do not add Home Graph filtering to regular Knowledge.

## Versioning

The app uses semantic versioning and `vMAJOR.MINOR.PATCH` git tags.

For any shipped change:

1. Update `package.json`.
2. Update `CHANGELOG.md`.
3. Update `index.html` cache-bust values when the app version changes.
4. Run `bun run ci`.
5. Commit, tag, and push.
6. Confirm GitHub CI passes.
