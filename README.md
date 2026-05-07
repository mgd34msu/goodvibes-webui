# GoodVibes WebUI

Browser operator surface for the GoodVibes daemon.

## Stack

- Bun
- Vite
- React
- TypeScript
- `@pellux/goodvibes-sdk@0.33.5`

The app uses only the public browser/auth/contracts seams from the published SDK package.

## Development

```bash
bun install
bun run dev
```

The browser app runs on the GoodVibes web surface port:

```bash
http://127.0.0.1:3423/
```

The daemon/control-plane API remains canonical on `3421`. In development, Vite
proxies same-origin `/api/*`, `/login`, `/status`, `/task`, and `/config` calls
from `3423` to `http://127.0.0.1:3421`, including WebSocket upgrade support for
control-plane routes.

Set `VITE_GOODVIBES_BASE_URL` only when the SDK should bypass same-origin proxying
and talk to a backend origin directly. Set `VITE_GOODVIBES_BACKEND_URL` when the
development proxy target is not `http://127.0.0.1:3421`.

```bash
VITE_GOODVIBES_BACKEND_URL=http://127.0.0.1:3421 bun run dev
```

## Auth

The WebUI does not read `~/.goodvibes` files. Those files are daemon-private
implementation state. Browser auth is daemon-owned:

- username/password login goes through the daemon login route and SDK auth client
- explicit operator tokens can be pasted by the user and are validated with the daemon before being stored
- the browser token store key is `goodvibes.webui.token`

## Verification

```bash
bun run test
bun run typecheck
bun run build
```

GitHub Actions runs the same install, test, typecheck, and build sequence on
pushes and pull requests to `main`.
