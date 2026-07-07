# Architecture

This document describes the current WebUI architecture and the boundaries that
should stay stable unless the daemon/SDK contract changes.

## Goals

GoodVibes WebUI is a full chat application and operator console over the
GoodVibes daemon. It should:

- make chat the primary surface, at parity with a modern chat application
- expose the operator surfaces (sessions union, fleet, checkpoints, memory,
  calendar, approvals/tasks/workstream, providers/models, admin) over the same
  typed wire the terminal UI uses
- expose regular Knowledge/Wiki without leaking extension-specific Home Graph UI
- serve desktop and phone from one app — the phone gets a drawer layout of the
  same views, never a different mental model
- install from the browser (app shell offline, Web Push), with daemon data
  never cached
- stay on public SDK/browser seams with contract-typed method I/O
- avoid creating a second local state store for canonical daemon data

## Runtime Topology

The WebUI has two important origins in development:

- Web/browser surface: `3423`
- Daemon/control-plane API: `3421`

Vite binds to the resolved WebUI host and port, then proxies API routes to the
daemon. The resolved WebUI binding comes from launch environment, `goodvibes web
--json`, or TUI settings fallback. See [Development](development.md) for exact
precedence.

The browser should usually talk to `window.location.origin`. Direct backend
origins are only for explicit development overrides.

## SDK Boundary

Application code imports the scoped browser Knowledge SDK:

```ts
import { createBrowserKnowledgeSdk, forSession } from '@pellux/goodvibes-sdk/browser/knowledge';
import { createBrowserTokenStore } from '@pellux/goodvibes-sdk/auth';
```

The WebUI does not deep-import SDK internals and does not point to a local SDK
checkout. The npm package in `node_modules` is the dependency under test.

`src/lib/goodvibes.ts` is the local client facade. It wraps:

- `sdk.auth`
- `sdk.operator.control`
- `sdk.operator.accounts`
- `sdk.operator.providers`
- `sdk.operator.models`
- `sdk.operator.tasks`
- `sdk.operator.approvals`
- `sdk.chat`
- `sdk.artifacts`
- `sdk.realtime`
- `sdk.knowledge`

Operator method families without a convenience helper (`fleet.*`,
`checkpoints.*`, `sessions.search`, ...) ride the generic typed invoke path.
Their input/output types derive from the SDK's generated
`OperatorMethodInputMap`/`OperatorMethodOutputMap` via
`src/lib/contract-bridge-types.ts` — no hand-typed wire shapes. A test pins the
bridge types against the installed SDK's `operator-contract.json`, and another
pins the retirement of the old `EXTRA_METHOD_ROUTES` shim so per-route
definitions do not creep back.

Presentation tokens are generated, not hand-maintained:
`scripts/generate-presentation-tokens.ts` renders the SDK's shared presentation
contract into `src/lib/generated/presentation-tokens.ts` and the CSS custom
properties consumed by `src/styles/tokens.css`, so terminal, agent, and browser
share one visual vocabulary.

## Auth Model

Auth belongs to the daemon.

- Session login posts through the daemon login route.
- Explicit tokens are accepted from the user and validated with the daemon.
- Tokens live in the browser SDK token store under `goodvibes.webui.token`.
- Browser code must not read `~/.goodvibes` files.
- GoodVibes secret refs are daemon-side downstream credential resolution, not
  WebUI auth.

## Chat Model

Standalone WebUI chat uses daemon-owned companion chat, not operator session
continuation.

Primary APIs:

- `sdk.chat.sessions.list`
- `sdk.chat.sessions.create`
- `sdk.chat.sessions.update`
- `sdk.chat.sessions.delete`
- `sdk.chat.messages.list`
- `sdk.chat.messages.create`
- `sdk.chat.events.stream`

Do not use `sessions.followUp` for plain companion chat. That path is for shared
operator session continuation and can spawn or queue agent work. Do not use
`sessions.messages.create` as a fallback send path for companion chat.

### Chat State

Daemon session/message data is canonical. Browser local storage is a cache for:

- recent companion chat sessions
- active companion chat session id

The cache exists so refreshes preserve a usable sidebar while the daemon list is
loading. Once `sdk.chat.sessions.list` succeeds, the daemon list is authoritative,
except for sessions created in the current browser run while the daemon list is
catching up.

The send path adds optimistic local user messages immediately and marks them
`local`, `sent`, or `failed` as daemon calls resolve. Assistant output streams
through companion chat events and is reconciled with daemon message history.

### Attachments

Companion chat attachments are real daemon artifacts:

1. Upload with `sdk.artifacts.create`.
2. Send `sdk.chat.messages.create(sessionId, { body, attachments })`.

Message sends must not carry provider/model routing. Routing belongs to the
chat session or daemon current model.

### Markdown and Code

Assistant, chat, and Knowledge text render as Markdown with GFM support.
Code blocks support:

- syntax highlighting
- per-block copy
- whole-message copy
- optional decorative line numbers

Line numbers are UI-only and must not be copied with code content.

## Session Union and Steering

The Sessions view is the cross-surface session union: sessions started from the
terminal, agent, or browser, listed and searched over `sessions.list` /
`sessions.search` (closed sessions included by explicit `includeClosed` choice,
surfaced in the UI). A live session can be steered; a closed session offers a
follow-up — a new linked session — and is labeled as such, never disguised as
steering. Steer sends stamp this browser as the originating surface. This is
the operator-session continuation surface; it is distinct from companion chat
and does not share its send path.

## Memory Model

The Memory view reads and mutates the shared cross-surface memory store over
the daemon memory wire. Recall-honesty metadata from the daemon (search mode,
vector-index availability or its `platformLimitReason`, exclusion counts,
recall floor) renders verbatim — a literal-match fallback is labeled as one.
Deletion is verified: after a delete the view proves the record is gone rather
than just dropping it from a local list.

## Voice Model

Voice rides the daemon's voice routes (`voice.tts.stream`, `voice.stt`,
provider/voice listing) so browser, terminal, and agent get identical provider
behavior. Spoken replies batch and cap concurrent synthesis with quiet retry;
dictation always shows the transcript for review before send. Voice
configuration lives in the shared config tier — one config for all surfaces.

## Installable App (PWA)

`public/manifest.webmanifest` + `public/sw.js` make the app installable. The
service worker caches the app shell only — never a daemon API response — so an
offline open loads the shell and shows the ordinary "can't reach the daemon"
state instead of stale data dressed as live. Web Push subscriptions go through
the daemon's `push.vapid.get` / `push.subscriptions.*` verbs
(`src/lib/push/`); registration is production-gated (`src/lib/pwa/`).

## Knowledge/Wiki Model

The Knowledge page uses regular/base Knowledge routes through the scoped browser
Knowledge SDK.

Expected regular operations include:

- `knowledge.ask`
- `knowledge.search`
- `knowledge.status`
- `knowledge.sources.list`
- `knowledge.nodes.list`
- `knowledge.issues.list`
- `knowledge.map`
- `knowledge.item.get`
- `knowledge.packet`
- projection list/render/materialize through `operator.invoke` if needed
- ingest routes for regular Knowledge/Wiki operations

Home Assistant Home Graph is separate. The general Knowledge/Wiki surface should
not call `homeassistant.homeGraph.*`, pass Home Graph-specific scope flags, or
filter Home Graph data client-side. If extension records appear in regular
Knowledge by default, report the exact endpoint, payload, and record identifiers
to SDK/daemon maintainers.

## Provider/Model Model

Provider and model selection must follow daemon/provider registry semantics.

- Provider rows may represent runtime provider ids such as `openai-subscriber`.
- Model rows may expose catalog/provider registry keys such as `openai:gpt-5.5`.
- The UI should present provider and model separately.
- The model dropdown should update based on selected provider.
- Current daemon model selection is updated through daemon model APIs, not by
  attaching provider/model to chat message sends.

Provider/model helper logic lives in `src/lib/provider-models.ts`.

## Admin Surface

Admin owns diagnostics and operational settings that are not part of the main
chat flow:

- auth login and token management
- local auth status
- runtime/config snapshots
- display preferences such as code block line numbers
- service/network posture where exposed by daemon APIs

## Realtime and Invalidation

Realtime events are used as invalidation and rendering signals, not as the only
source of truth. The app loads snapshots/lists first, then refreshes affected
queries on relevant events.

App-wide invalidation rides ONE multiplexed SSE stream (connected only after
sign-in, reconnected on every auth change) rather than per-view connections —
per-view streams starved the browser's per-origin connection pool. Domain
scoping is negotiated with the daemon; the default remains deliver-all so an
older daemon stays correct. Chat streams are session-scoped through companion
chat SSE helpers. Terminal events matter; intermediate stream iteration events
should not be treated as complete turns. Stream drops surface as honest
degraded states (reconnecting / paused / expired) with real retry, per-effect
stream epochs preventing stale handlers from acting.

## Non-Goals and Boundaries

- Do not read TUI or daemon private files from browser code.
- Do not point WebUI to a local SDK checkout.
- Do not add client-side Home Graph filtering as a fix for regular Knowledge
  scoping issues.
- Do not create a second durable config or knowledge store in WebUI.
- Do not silently move the dev server to another port.
- Do not use storage-only message APIs as chat send fallbacks.
