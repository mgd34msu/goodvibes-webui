# Changelog

All notable changes to GoodVibes WebUI will be documented in this file.

This project uses semantic versioning with `vMAJOR.MINOR.PATCH` git tags.

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
