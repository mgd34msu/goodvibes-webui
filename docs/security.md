# Security Notes

GoodVibes WebUI is a local/operator surface over a daemon. It should keep
security ownership with the daemon and avoid creating duplicate secret or auth
stores in browser code.

## Trust Boundary

- The daemon/control-plane API is the authority for auth, config, providers,
  chat, artifacts, and Knowledge/Wiki.
- WebUI is a browser client. It may cache UI preferences and recent chat ids, but
  it should not become a durable source of truth for daemon state.
- Binding WebUI to `0.0.0.0` exposes the Vite/WebUI surface to the local network.
  Use local firewall policy to restrict traffic to trusted LAN clients.

## Auth

- Username/password login goes through the daemon login route.
- Operator tokens are accepted only when pasted by the user and validated
  against the daemon.
- Browser token storage uses the SDK token store key
  `goodvibes.webui.token`.
- Prefer daemon/session auth with an HttpOnly cookie when that deployment mode
  is available.

Browser code must not read or scrape:

- `~/.goodvibes/tui/auth-users.json`
- `~/.goodvibes/tui/auth-bootstrap.txt`
- `operator-tokens.json`
- other daemon/TUI private auth files

GoodVibes secret refs such as `goodvibes://secrets/...` are daemon-side
credential resolution for downstream services. They are not WebUI auth tokens.

## Network

Development topology:

- WebUI/Vite: `3423`
- Daemon/control-plane: `3421`
- HTTP listener/webhook surface: `3422`

The browser should normally use the WebUI origin and Vite proxy. The dev proxy
should connect to `127.0.0.1:3421` even when the daemon binds to `0.0.0.0`.
`0.0.0.0` is a bind address, not a client URL.

Do not expose the dev server directly to untrusted networks. A production
deployment should add explicit TLS, host allow-listing, and daemon auth policy.

## Attachments and Artifacts

Chat attachments are uploaded to daemon artifacts before being referenced from a
chat message. The browser sends file bytes to the daemon as base64 through the
published SDK helper. Operators should avoid attaching secrets unless they intend
the daemon and selected model route to process them.

## Logging and Screenshots

- Do not log raw tokens, passwords, or bootstrap credentials.
- Avoid committing screenshots that show private chat content, local secrets,
  provider keys, or sensitive Knowledge records.
- Documentation screenshots should use empty or non-sensitive states.

## Dependency and SDK Safety

- Use the npm-published `@pellux/goodvibes-sdk` package.
- Do not point WebUI to a local SDK checkout for validation.
- Verify the installed SDK version with:

```bash
node -p "require('./node_modules/@pellux/goodvibes-sdk/package.json').version"
```

## Security Issue Checklist

When investigating a security-relevant bug, capture:

- WebUI version
- installed SDK version
- daemon `/status` version
- route or SDK helper used
- request payload shape without secrets
- response status and error code
- whether the issue occurs through same-origin proxy, direct backend URL, or both
