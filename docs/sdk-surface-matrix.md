# SDK Surface Matrix

This matrix records the public SDK/daemon surfaces WebUI is expected to use.
It is a maintenance aid: when a route moves into a public browser helper, remove
local shims and update this table.

## Rules

- Import browser code from `@pellux/goodvibes-sdk` npm package only.
- Prefer `@pellux/goodvibes-sdk/browser/knowledge` for WebUI.
- Do not deep-import SDK internals.
- Do not use Home Assistant Home Graph routes for regular Knowledge/Wiki.
- Do not pass provider/model on chat message sends; routing belongs to session
  creation/update or the daemon current model.

## Matrix

| Surface | Public SDK or route | WebUI owner | Canonical state | Notes |
| --- | --- | --- | --- | --- |
| Auth current user | `sdk.auth.current()` | Admin, app boot | Daemon/session auth | Used to detect authenticated state. |
| Login | daemon `/login` through SDK/fetch facade | Admin | Daemon local auth | Username/password auth remains daemon-owned. |
| Token store | `createBrowserTokenStore({ key: 'goodvibes.webui.token' })` | SDK client setup | Browser SDK storage | Do not read daemon auth files. |
| Control status | `sdk.operator.control.status()` | app boot, Admin | Daemon | Version/service posture. |
| Control snapshot | `sdk.operator.control.snapshot()` | Admin diagnostics | Daemon | Diagnostic JSON, not editable state. |
| Accounts snapshot | `sdk.operator.accounts.snapshot()` | Admin/Providers diagnostics | Daemon | Provider account posture. |
| Provider list | `sdk.operator.providers.list()` | Providers, Chat composer | Daemon | Runtime providers and model inventory. |
| Model current/list/set | SDK model helpers or narrow route shim | Providers, Chat composer | Daemon provider registry | Provider-first, model-second. |
| Chat sessions list | `sdk.chat.sessions.list()` | Chat sidebar | Daemon companion chat | Operator sessions are a different surface. |
| Chat session create | `sdk.chat.sessions.create(input?)` | Chat | Daemon companion chat | Optional provider/model route is session-level. |
| Chat session update | `sdk.chat.sessions.update(sessionId, input)` | Chat title/model route | Daemon companion chat | Used for rename and route changes. |
| Chat session delete | `sdk.chat.sessions.delete(sessionId)` | Chat sidebar | Daemon companion chat | Browser cache must prune deleted ids. |
| Chat messages list | `sdk.chat.messages.list(sessionId)` | Chat transcript | Daemon companion chat | Source of truth after optimistic state. |
| Chat message send | `sdk.chat.messages.create(sessionId, { body, attachments })` | Chat composer | Daemon companion chat | No provider/model in message payload. |
| Chat events | `sdk.chat.events.stream(sessionId, handlers)` | Chat transcript | Daemon SSE | Drives streaming and invalidation. |
| Artifacts create | `sdk.artifacts.create({ filename, mimeType, dataBase64, metadata })` | Chat attachments | Daemon artifact store | Upload first, then attach artifact id to message. |
| Knowledge ask/search | `sdk.knowledge.ask`, `sdk.knowledge.search` | Knowledge | Regular Knowledge store | No Home Graph scope flags by default. |
| Knowledge status | `sdk.knowledge.status()` | Knowledge/Admin | Regular Knowledge store | Readiness and counts. |
| Knowledge list surfaces | `knowledge.sources.list`, `knowledge.nodes.list`, `knowledge.issues.list` | Knowledge | Regular Knowledge store | Use scoped browser Knowledge SDK/operator invoke. |
| Knowledge item/map/packet | `knowledge.item.get`, `knowledge.map`, `knowledge.packet` | Knowledge | Regular Knowledge store | Report upstream if Home Graph records leak. |
| Knowledge projections | projection method ids via `sdk.operator.invoke` | Knowledge/Wiki | Regular Knowledge store | Use only regular projection contracts. |
| Knowledge ingest | regular `knowledge.ingest.*` methods | Knowledge/Wiki | Regular Knowledge store | Separate from companion chat attachments. |
| Tasks | `sdk.operator.tasks.*` | Admin/support views | Daemon | Background work diagnostics. |
| Approvals | `sdk.operator.approvals.*` | Admin/support views | Daemon | Human-in-the-loop review state. |
| Realtime | `sdk.realtime.viaSse()` and scoped chat events | app-wide invalidation | Daemon runtime bus | Snapshots/lists remain authoritative. |
| Sessions union | `sessions.list`, `sessions.search`, session detail/transcript methods via typed invoke | Sessions | Daemon session spine | Cross-surface union; `includeClosed` is an explicit, surfaced choice. |
| Session steer / follow-up | `sessions.steer`, `sessions.followUp` via typed invoke | Sessions, Fleet | Daemon session spine | Steer only while live; follow-up on closed sessions is offered AS a follow-up, never disguised as steering. |
| Fleet | `fleet.*` via typed invoke (`contract-bridge-types.ts`) | Fleet | Daemon process tree | Actions render only where the wire supports them. |
| Checkpoints | `checkpoints.*` via typed invoke | Checkpoints | Daemon checkpoint store | Includes checkpoint-to-checkpoint diff. |
| Memory | daemon memory wire (list/search/save/review/delete) | Memory | Shared cross-surface memory store | Recall-honesty metadata renders verbatim; deletes are verified. |
| Calendar | daemon calendar module methods | Calendar | Daemon calendar store | ICS import/export; unconfigured shows the bring-your-own-CalDAV note. |
| Voice | `voice.tts.stream`, `voice.stt`, `voice.providers.list`, `voice.voices.list`, `voice.status` | Chat composer, Voice settings | Daemon voice routes | One shared voice config tier across surfaces. |
| Web Push | `push.vapid.get`, `push.subscriptions.*` | Admin (Notifications & install) | Daemon push service | Requires a secure (HTTPS) context. |
| Presentation tokens | SDK shared presentation contract via `scripts/generate-presentation-tokens.ts` | build-time generation | SDK contract artifact | Generated `src/lib/generated/presentation-tokens.ts` + CSS custom properties; never hand-edited. |
| Local auth status | daemon local auth route via SDK/route shim | Admin | Daemon | Show user/session metadata only, never raw secrets. |
| Config | daemon config route via SDK/route shim | Admin | Daemon config | Do not create a separate WebUI config store. |

## Explicit Non-Surfaces

| Non-surface | Why it is excluded |
| --- | --- |
| `homeassistant.homeGraph.*` | Home Graph is an extension surface, not regular Knowledge/Wiki. |
| `sessions.followUp` as a companion-chat send path | It is a legitimate Sessions-view surface for continuing a closed operator session (see matrix above), but it can spawn/queue agent work — never use it to send plain companion chat. |
| `sessions.messages.create` fallback | Can persist a user message without a daemon-owned assistant turn. |
| `~/.goodvibes` browser reads | Private daemon/TUI implementation state. |
| local SDK checkout | Does not validate the installed npm contract. |
