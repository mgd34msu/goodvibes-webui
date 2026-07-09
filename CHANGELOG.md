# Changelog

All notable changes to GoodVibes WebUI will be documented in this file.

This project uses semantic versioning with `vMAJOR.MINOR.PATCH` git tags.

## [Unreleased]

## [1.3.0] - 2026-07-09

Ships against `@pellux/goodvibes-sdk` 1.6.1.

### Added

- **Fleet archive view.** The Fleet view can now toggle between the live
  fleet and the session archive of finished agents/swarms (`fleet.archived.list`).
  Finished processes can be archived one subtree at a time from the detail
  pane, or all at once from the toolbar (`fleet.archive` /
  `fleet.archiveFinished`); archived processes stay browsable with full
  usage/cost detail and can be restored to the live view (`fleet.unarchive`).
  The daemon refuses to archive subtrees with running members — the refusal
  reason surfaces as a toast, never a silent no-op.

### Changed

- Sessions benefit from SDK 1.6.1 daemon behavior: immediate compact-and-retry
  when a provider rejects a request as exceeding the context window, learned
  per-model context ceilings, and agent-completion notices that deliver
  exactly once instead of repeating with escalating urgency tags.

## [1.2.2] - 2026-07-08

Maintenance release on `@pellux/goodvibes-sdk` 1.5.0.

### Changed

- Validated against SDK 1.5.0: the daemon now compacts a session immediately
  when the model itself reports its context window filled up, and honors
  persistent per-model context-window overrides. No WebUI code change —
  session behavior improves through the daemon; model context windows shown
  in the picker reflect any configured override automatically.

## [1.2.1] - 2026-07-07

Maintenance release on `@pellux/goodvibes-sdk` 1.4.1.

### Changed

- Validated against SDK 1.4.1, which makes permission settings the sole
  authority for command-class risk in the daemon's exec tool. No WebUI
  behavior change — the WebUI has no exec surface — this release keeps the
  ecosystem pinned to one SDK version.

## [1.2.0] - 2026-07-07

The turn-control release, on `@pellux/goodvibes-sdk` 1.4.0.

### Added

- **Stop actually stops.** The Stop button now issues the daemon's new
  server-side cancel (`companion.chat.turns.cancel`) and keeps the live
  stream open — the terminal `turn.cancelled` event settles this client and
  every other one watching the session. The partial reply is kept in the
  transcript with an explicit "stopped" badge, never disguised as a complete
  answer. On an older daemon the button falls back to the previous
  local-render stop and says exactly that.
- **Steer: interrupt and send now.** Ctrl+Enter (Cmd+Enter on Mac) — or press
  and hold the send button on a phone — interrupts the current reply and runs
  your message immediately. Plain Enter still sends normally.
- **Queue-when-busy.** A message sent while a reply is streaming queues
  behind it (the daemon no longer races concurrent turns against one
  conversation) and shows an honest "queued" badge until its turn starts.

### Fixed

- The Stop control is now reachable for the whole active turn — it previously
  required streamed text, so a turn could not be stopped while the model was
  still thinking or inside a long tool call.
- The badges above close two honesty gaps: a queued message used to render as
  "Sent ✓" and a stopped partial rendered unmarked.

## [1.1.1] - 2026-07-07

Test-harness and CI honesty release — no product code changed.

### Fixed

- Two phone end-to-end tests closed the navigation drawer by clicking the
  center of the backdrop, a point the open drawer itself covers; they only
  passed by racing the drawer's opening animation and failed deterministically
  on CI. They now tap the always-visible dimmed area beside the drawer.
- All lint errors: unused test fixture arguments, empty mock function bodies,
  useless variable initializers, and the service worker being excluded from
  linting entirely (it is now linted with service-worker globals).

### Changed

- The end-to-end harness no longer produces refused-connection noise: the two
  direct routes the chat-spec mock missed (`/status`, `/config`) are now
  answered in-page, and the vite proxy's former dead target is a deliberate
  stub that answers anything the in-page mocks structurally cannot intercept
  (requests made under a real service worker in the PWA specs) with an
  unmistakable 503 `E2E_STUB` — a clean run's server log is now silent, so a
  refused connection can never again be mistaken for the suite's normal state.
- The lint and end-to-end CI jobs are now blocking. They previously ran with
  `continue-on-error`, which let the workflow report success while those jobs
  failed — a green checkmark must mean everything is green. Ruling recorded in
  [docs/decisions/2026-07-07-e2e-ci-in-ci.md](docs/decisions/2026-07-07-e2e-ci-in-ci.md).
- Removed a stale duplicate of the 1.1.0 installable-app notes that had been
  left under Unreleased.
- Documentation refreshed to the shipped 1.1.x surface: the README (badges,
  feature surface, verification, release checklist), the operator guide (all
  eleven views plus voice and install), the architecture doc (typed contract
  client, session union, memory/voice/PWA models, multiplexed invalidation),
  the SDK surface matrix (new method families; the `sessions.followUp`
  exclusion narrowed to what it means), known limitations (no longer claims
  gaps that were fixed), security notes (Web Push key custody), the screenshot
  tour, and the pinned Bun version in the development guide. All screenshots
  recaptured from the current UI against the end-to-end suite's seeded mock
  daemon.

## [1.1.0] - 2026-07-07

The desktop release: the web UI becomes a full chat application and operator
console with feature parity across most of the terminal UI's surface, on the
typed `@pellux/goodvibes-sdk` 1.3.1 contracts.

### Added

- **A modern chat app**: streaming markdown with highlighted code blocks and
  copy buttons, a searchable history sidebar, a rich composer with attachments,
  regenerate and edit-with-branching where superseded turns stay viewable
  (never silently gone), automatic conversation titles, and stop-generation.
- **Voice in the browser**: spoken replies (batched, concurrency-capped
  synthesis with quiet retry), microphone dictation over the daemon's
  speech-to-text with review-before-send, and one voice configuration shared
  across terminal, desktop, and agent.
- **Memory view**: browse and search the shared cross-surface memory store
  with the recall-honesty details rendered verbatim (search mode, index
  availability, exclusion counts, the store's recall floor), review-state
  edits, and true deletion.
- **Deeper operator surfaces**: fleet process tree with steer/detach/stop
  where the wire genuinely supports them (honest notes where it doesn't),
  inline approvals from the tree, knowledge consolidation candidates and
  prompt-packet builder with truncation disclosure, a calendar view with ICS
  import/export, a multi-target model workspace, and a settings modal with
  the terminal UI's category naming and secret redaction.
- **Installable app (PWA)**: add-to-home-screen install on iOS/Android, an
  offline shell that opens instantly and says plainly when the daemon is
  unreachable, and push notifications for approvals delivered through the
  daemon's own encrypted push service.
- **Cross-machine serving**: the daemon can serve this app same-origin
  (opt-in), so a browser on another machine reaches it with zero
  cross-origin configuration — designed for `tailscale serve`.

### Fixed

- Live updates now connect only after sign-in and reconnect on every auth
  change; transport errors show friendly wording, never raw server JSON.
- Every view fits a phone viewport with no horizontal scrolling.
- A plain-HTTP address shows an honest "this page needs HTTPS" message
  instead of a blank screen.

## [1.0.1] - 2026-07-06

### Added

- **Cross-surface credential status** — the typed `sdk.operator.credentials.get`
  facade over the daemon's admin-scoped, secret-free credential-status read, plus
  `deriveCredentialAvailability`: a `503 CREDENTIAL_STORE_UNAVAILABLE`, a
  `METHOD_NOT_FOUND` from an older daemon, or any transport failure degrades to an
  honest unavailable state with a plain reason — never a fabricated "configured",
  and never a credential byte in the browser. Completes the cross-surface credential
  status adoption the 1.0.0 notes wrongly listed as deferred.

## [1.0.0] - 2026-07-06

First stable release of the GoodVibes WebUI — the browser surface of the
one-platform ecosystem, running on the typed `@pellux/goodvibes-sdk` 1.0.0
operator contracts. It reaches the same daemon as the TUI and the agent, so a
session, provider, or checkpoint is visible across every surface.

### Milestone arc

- **Sessions union view** — every surface's sessions in one list, with the
  honest `idle-reaped` badge + tooltip and reopen-on-heartbeat semantics.
- **Fleet, checkpoints, per-hunk approvals, tasks, and workstream views** — the
  operator process tree, checkpoint list/diff/restore, per-hunk approve/reject,
  task lifecycle, and workstream/phase composition rendered from the wire.
- **Chat resilience** — steer/follow-up over the daemon, capability probes that
  degrade honestly by machine code (not prose) when a method is unavailable, and
  a search surface that says "unavailable" rather than lying.
- **Delete-means-delete** — companion chat hard-delete wired to the spine
  `sessions.delete` verb; a deleted session never resurrects.
- **Provider pills, knowledge map, browser-history search**, and the
  **mobile steer-from-phone hero** at 390×844 with the hermetic Playwright e2e
  harness (mock daemon; never touches a real port).
- **Typed operator client** — `src/lib/contract-bridge-types.ts` is now sourced
  directly from the 1.0.0 `OperatorMethodInput`/`OperatorMethodOutput` maps
  (the `// SWAP:` seam), so a contract rename fails the `bridge-matches-schema`
  test loudly instead of drifting.

### Changed

- Updated `@pellux/goodvibes-sdk` to `1.0.0` (from `0.38.0`) — the 1.0.0
  release-train pin. The operator-method contract families the webui facade
  calls (`fleet.*`, `checkpoints.*`, `sessions.search`) now carry real
  `OperatorMethodInputMap`/`OperatorMethodOutputMap` entries, so
  `src/lib/contract-bridge-types.ts` applies its long-planned `// SWAP:` seam:
  the hand-authored 0.38 bridge interfaces are replaced one-for-one by
  `OperatorMethodInput<M>`/`OperatorMethodOutput<M>`, with `FleetProcessNode`,
  `WorkspaceCheckpoint`, and `SessionsSearchSessionSummary` kept as item-level
  aliases so every consumer import compiles unchanged. The
  `bridge-matches-schema` test now pins the bridge shapes against 1.0.0's real
  `operator-contract.json`; its sample fixtures were updated to the real
  literal-union members (`state: 'executing-tool'`, `costState: 'priced'`,
  `retentionClass: 'standard'`).

### Deferred

- The C1 webui credentials-facade block and provider-status honest-degrade
  rewire is deferred to a follow-up: the SDK C1 credential-status method ships
  in 1.0.0, but the security-sensitive webui adoption is not gate-blocking and
  its verbatim design notes were not persisted, so it is not improvised here.

## [0.2.1] - 2026-06-19

### Fixed

- **CI**: pin `setup-bun` to 1.3.14 to match the locally-verified toolchain —
  1.3.10 produced `window is not defined` in the happy-dom +
  `bun test --isolate` test harness. Coverage step now runs with `--isolate`
  and the coverage annotation guards a missing summary file.
- **Lint**: resolved all ESLint errors across the chat workspace modules
  (dot-notation, array-type, optional-chain, redundant type conversions,
  unused vars, invalid void type, prefer-const, unsafe return) so the lint job
  passes (0 errors / 53 warnings). Intentional render-time derived-state guards
  carry targeted `react-hooks/refs` disables with justification.
- Removed `.github/dependabot.yml` (re-introduced in error during the 0.2.0
  tooling work).

## [0.2.0] - 2026-06-19

### Added

- **Design token system + dark-mode-default foundation** — full semantic token
  system (`src/styles/tokens.css`) covering color (light/dark via `[data-theme]`),
  spacing, radius, typography, elevation, motion, and z-index. App ships
  dark-first with `prefers-color-scheme` bootstrap and `prefers-reduced-motion`
  support throughout.
- **Density modes** — compact, default, and comfortable density presets
  persisted in the existing UI-preferences store and applied globally.
- **⌘K command palette + global hotkeys** — fuzzy-search and invoke any
  registered action from the keyboard. Pre-bound shortcuts for navigation,
  new chat, search, and palette open. Shortcut cheatsheet overlay lists all
  registered bindings.
- **Daemon pulse status strip** — persistent shell strip showing connection
  state (connected / reconnecting / down), round-trip latency, SSE health, and
  active-work count at all times.
- **Chat workspace overhaul** — token streaming with stop control; edit /
  regenerate / branch on any message; artifacts slide-over panel for structured
  data blocks and large outputs; cross-session message search; upgraded composer
  with inline model menu, slash-command trigger, drag-and-drop / paste
  attachments, and optimistic send.
- **URL deep-linking + slide-over peek** — chat sessions, views, and peek
  targets are addressable by URL and survive page refresh; non-blocking
  slide-over overlay for sessions, artifacts, and records.
- **Toast / undo notifications** — non-blocking toasts with optional undo
  actions and auto-dismiss; purposeful entrance/exit animations.
- **Feedback primitives** — consistent skeleton loaders, empty-state
  illustrations, and error-state messages with retry actions across all views.
  Top-level `ErrorBoundary` prevents a single component failure from blanking
  the app.
- **Full keyboard accessibility** — roving focus, visible focus rings,
  `aria-live` announcer, focus-trap for modals/palette/slide-over.
- **Responsive + mobile layout** — responsive breakpoints from mobile to
  wide-desktop; density and motion preferences stored and applied globally.
- **ESLint + Prettier + jsx-a11y tooling** — project-wide lint/format
  enforcement with `eslint-plugin-jsx-a11y` for accessibility linting.
- **happy-dom test harness** — DOM-capable unit tests via `happy-dom`.
- **CI caching + coverage** — GitHub Actions workflow gains dependency caching
  and test-coverage reporting.
- **Dependabot** — automated dependency update PRs for npm and GitHub Actions.
- **537 tests** — component, unit, and integration tests covering command
  palette, status strip, chat stream, theme/preferences, a11y helpers, and
  per-view logic.

### Changed

- `ChatView` decomposed into focused modules under `src/views/chat/` (Composer,
  MessageList, MessageItem, SessionHeader, and stream/turn hooks) for
  maintainability.
- Shell (`App.tsx` / `main.tsx`) updated to mount `ThemeProvider`,
  `ToastProvider`, `CommandPalette`, `StatusStrip`, top-level `ErrorBoundary`,
  and URL-driven view router.
- KnowledgeView, ProvidersView, and AdminView updated with loading/empty/error
  states, peek integration, and full keyboard/roving-focus accessibility.

## [0.1.39] - 2026-05-20

### Changed

- Updated `@types/react` to `19.2.15`.

## [0.1.38] - 2026-05-19

### Changed

- Updated frontend dependencies to current releases, including Vite 8,
  `@vitejs/plugin-react` 6, `lucide-react` 1, React 19.2.6,
  React Query 5.100.11, and `@types/bun` 1.3.14.

## [0.1.37] - 2026-05-17

### Added

- Added a screenshot tour with real captures from the running WebUI.
- Added known limitations, security notes, and SDK surface matrix docs.
- Added README CI/status badges and embedded screenshot previews.

## [0.1.36] - 2026-05-16

### Added

- Reworked the README into a complete project entrypoint with runtime topology,
  auth, surfaces, verification, and release notes.
- Added architecture, operator guide, development, SDK update checklist, and
  troubleshooting documentation under `docs/`.

## [0.1.35] - 2026-05-11

### Changed

- Updated `@pellux/goodvibes-sdk` to `0.33.30`.

## [0.1.34] - 2026-05-10

### Changed

- Updated `@pellux/goodvibes-sdk` to `0.33.26`.

## [0.1.33] - 2026-05-10

### Changed

- Updated `@pellux/goodvibes-sdk` to `0.33.24`.

## [0.1.32] - 2026-05-10

### Changed

- Updated `@pellux/goodvibes-sdk` to `0.33.23` for WRFC authoritative request-scope fixes.

## [0.1.31] - 2026-05-09

### Changed

- Updated `@pellux/goodvibes-sdk` to `0.33.22` for the WRFC owner-chain orchestration contract update.

## [0.1.30] - 2026-05-09

### Changed

- Updated `@pellux/goodvibes-sdk` to `0.33.21` for shared work-plan APIs and WRFC lifecycle metadata fixes.

## [0.1.29] - 2026-05-09

### Changed

- Updated `@pellux/goodvibes-sdk` to `0.33.19`.

## [0.1.28] - 2026-05-08

### Fixed

- Render newly sent chat messages immediately with optimistic local state instead of waiting for the next composer update.
- Kept freshly-created chat sessions visible while the daemon session list catches up after session creation.
- Normalized nested companion chat message-list responses so daemon-returned messages render consistently.

## [0.1.27] - 2026-05-08

### Fixed

- Avoided cycling through additional browser-cached chat ids while waiting for the daemon companion session list after a stale session is detected.

## [0.1.26] - 2026-05-08

### Fixed

- Pruned stale browser-cached companion chat sessions after the daemon session list loads, including selected sessions that now return `SESSION_NOT_FOUND`.

## [0.1.25] - 2026-05-08

### Changed

- Updated `@pellux/goodvibes-sdk` to `0.33.18` for the WRFC owner orchestration additions.

## [0.1.24] - 2026-05-08

### Fixed

- Cleared captured chat composer attachments immediately on submit so slow or stuck attachment sends cannot leave the selected file pinned in the input or wipe newer text typed while the upload is pending.

## [0.1.23] - 2026-05-08

### Added

- Added a sidebar delete action for companion chat sessions, including local cache cleanup and active-session fallback.

## [0.1.22] - 2026-05-08

### Fixed

- Persisted companion chat sessions and the active chat session across page refreshes while still merging daemon-returned session lists when available.

## [0.1.21] - 2026-05-08

### Changed

- Updated `@pellux/goodvibes-sdk` to `0.33.17` for the physically separated regular Knowledge/Wiki and Home Assistant Home Graph runtime stores.

## [0.1.20] - 2026-05-08

### Added

- Added syntax highlighting for rendered Markdown code blocks with common LLM/code languages.

## [0.1.19] - 2026-05-08

### Added

- Added per-code-block copy buttons to Markdown responses while preserving whole-message copy actions.
- Added an Admin display preference for decorative code-block line numbers.

## [0.1.18] - 2026-05-08

### Removed

- Removed the Dashboard page and its primary navigation item so Chat remains the main surface and secondary controls stay in Knowledge, Providers, and Admin.

## [0.1.17] - 2026-05-08

### Changed

- Made the Vite dev server derive its host and port from the TUI web listener settings, with environment overrides reserved for one-off dev runs.

## [0.1.16] - 2026-05-08

### Changed

- Replaced the Dashboard with a focused operator overview that carries model route, auth, provider, knowledge, task, approval, and session posture.
- Removed the separate Work page from primary navigation and moved its task/approval/session actions into Dashboard.
- Removed the non-clickable runtime badge strip from non-chat page headers.

## [0.1.15] - 2026-05-08

### Changed

- Updated `@pellux/goodvibes-sdk` to `0.33.16` for the upstream default Knowledge/Wiki scoping fix while keeping WebUI on regular browser knowledge routes with no Home Assistant filters or explicit scope flags.

## [0.1.14] - 2026-05-07

### Changed

- Updated `@pellux/goodvibes-sdk` to `0.33.11` so regular Knowledge/Wiki routes use the upstream default knowledge-space scoping fix without WebUI-side HomeGraph filtering.

## [0.1.13] - 2026-05-07

### Changed

- Extended the GoodVibes dark/neon visual system across Dashboard, Knowledge, Providers, Work, and Admin instead of leaving those pages on the old light dashboard theme.

## [0.1.12] - 2026-05-07

### Added

- Rendered Markdown/GFM for chat messages, knowledge answers, wiki projection output, and string-valued data blocks.

### Changed

- Switched the app body, chat, navigation, controls, and content areas back to a normal legible sans-serif stack while keeping the GoodVibes sidebar brand treatment.

## [0.1.11] - 2026-05-07

### Fixed

- Added real `/favicon.ico` plus 16px and 32px PNG icon variants so browser tab/favicon UIs can resolve the GoodVibes icon reliably.

## [0.1.10] - 2026-05-07

### Added

- Updated `@pellux/goodvibes-sdk` to `0.33.10` and enabled real companion-chat file attachments through `sdk.artifacts.create` plus `sdk.chat.messages.create` attachment references.

### Fixed

- Resolved subscription-backed provider model lists so runtime providers such as `openai-subscriber` source selectable models from the catalog provider (`openai`) while still using daemon-valid registry keys.
- Applied the same provider/model source resolution on the Providers page and chat composer.

## [0.1.9] - 2026-05-07

### Fixed

- Changed the chat composer provider dropdown to include the daemon provider registry from `/api/providers`, merged with `/api/models` for model filtering.

## [0.1.8] - 2026-05-07

### Fixed

- Centered the GoodVibes brand icon in the collapsed sidebar state.

## [0.1.7] - 2026-05-07

### Changed

- Removed the separate collapse control from the collapsed sidebar state.
- Made the collapsed sidebar rail and GoodVibes icon expand the sidebar, while nav icons continue to navigate without expanding.
- Simplified collapsed active-nav styling so the underline is the only active indicator.

## [0.1.6] - 2026-05-07

### Changed

- Added the `goodvibes.sh` favicon as the browser icon and sidebar brand mark.
- Shortened the sidebar wordmark to `GOODVIBES`.
- Made the sidebar collapse control visible and easier to target in the brand header.
- Removed the grid-line texture from the sidebar background.

## [0.1.5] - 2026-05-07

### Changed

- Restored attachment and voice affordance icons in the chat composer as disabled controls until companion-chat file and voice contracts exist.

## [0.1.4] - 2026-05-07

### Changed

- Reworked the chat theme toward the `goodvibes.sh` terminal/vaporwave direction with neon accents, grid texture, and mono typography.
- Added a collapsible app sidebar and moved browser/control-plane/realtime status from the sidebar into Admin.
- Replaced the duplicate chat-session dropdown with an editable chat title backed by `sdk.chat.sessions.update`.
- Split daemon model selection into provider and model dropdowns, with model choices filtered by the selected provider.
- Kept chat file attachment controls out of the composer because companion chat still has no public attachment contract in SDK `0.33.9`.

### Fixed

- Kept user message bubbles sized to the message text while hover actions render below the bubble.
- Fixed retry actions so user messages resend and assistant responses regenerate from the preceding user message.

## [0.1.3] - 2026-05-07

### Changed

- Updated `@pellux/goodvibes-sdk` to `0.33.9` and switched the chat sidebar to the public `sdk.chat.sessions.list` API.
- Removed the temporary local recent-session workaround used before SDK chat session listing existed.
- Reworked Chat into the primary workspace with chat recents in the app sidebar, a centered conversation canvas, and an integrated composer.
- Added subtle per-message hover actions for copy and resend plus delivery status indicators.
- Kept attachment and voice controls disabled because companion chat has no public attachment or voice contract yet.

## [0.1.2] - 2026-05-07

### Fixed

- Kept companion chat on the daemon's current provider/model instead of sending chat-local route overrides.
- Prevented chat turns from showing `completed` unless assistant content has rendered or synced.
- Removed duplicated session ids, daemon receipts, and provider/model controls from the chat composer.
- Added daemon current-model viewing and selection to the Providers page through `/api/models/current`.
- Showed newly created chat sessions immediately while the SDK lacks companion chat session listing.

## [0.1.1] - 2026-05-07

### Fixed

- Fixed companion chat explicit provider/model routing to use the selected runtime provider row and raw model id.
- Replaced the operator-session chat sidebar with a local recent companion-chat session list backed by `sdk.chat.sessions.get`.
- Rendered submitted chat messages immediately and surfaced companion turn errors as errors instead of misleading accepted receipts.

## [0.1.0] - 2026-05-07

### Added

- Initial Bun, Vite, React, and TypeScript WebUI for the GoodVibes daemon.
- Browser SDK auth flow using daemon login/session auth and token storage.
- Dashboard, provider, work, admin, and base knowledge/wiki operator views.
- Standalone daemon-owned companion chat via `@pellux/goodvibes-sdk@0.33.8` `sdk.chat`.
- Provider-qualified model routing for new companion chat sessions.
- Local and GitHub CI for tests, typecheck, and production build.

### Changed

- Updated GoodVibes SDK dependencies to `0.33.8`.
- Switched WebUI chat away from shared-session follow-up/task semantics.

### Removed

- Removed the shared-session follow-up helper used by the previous chat path.
