# Changelog

All notable changes to GoodVibes WebUI will be documented in this file.

This project uses semantic versioning with `vMAJOR.MINOR.PATCH` git tags.

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
