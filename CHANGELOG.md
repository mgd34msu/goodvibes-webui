# Changelog

All notable changes to GoodVibes WebUI will be documented in this file.

This project uses semantic versioning with `vMAJOR.MINOR.PATCH` git tags.

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
