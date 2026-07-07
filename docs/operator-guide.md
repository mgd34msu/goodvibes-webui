# Operator Guide

This guide describes the WebUI from an operator point of view.

## Navigation

The sidebar is the primary navigation surface:

- Chat
- Sessions
- Fleet
- Checkpoints
- Knowledge
- Memory
- Calendar
- Providers
- Admin
- Approvals
- Workstream

Chat is the main workspace. The other pages are operator surfaces over daemon
state: sessions, processes, checkpoints, knowledge, memory, calendar,
provider/model selection, decision queues, and auth/admin tasks.

The sidebar can collapse. In the collapsed state, primary nav icons remain
available and keep the sidebar collapsed when clicked. At phone width the
sidebar is a drawer: the collapsed icon rail is the default, the brand mark
opens the full drawer, and tapping the dimmed area beside it (or navigating)
closes it — the drawer never traps.

## Chat

Chat is daemon-owned companion chat. It is intended for direct LLM conversation
through the daemon's configured provider/model route.

Supported chat behavior:

- create new chats
- list daemon companion chat sessions
- preserve current/recent sessions across refresh while daemon data loads
- rename chats from the title
- delete chats from the sidebar
- send plain text with Enter
- insert a newline with Shift+Enter
- attach files through daemon artifact upload
- copy whole messages
- copy individual code blocks
- resend user messages
- regenerate assistant replies by resending the previous user message
- stream assistant replies when companion chat events arrive

Provider/model controls in the composer update daemon model selection. Message
sends themselves do not include provider/model routing.

## Attachments

Attachments are uploaded as daemon artifacts before the chat message is sent.

Expected flows:

- text only
- attachment only
- text plus attachments

If upload fails, the optimistic message is marked failed and the error remains
visible near the composer.

## Markdown Responses

Assistant and Knowledge responses support Markdown rendering. Code blocks are
syntax highlighted when a supported language is detected.

Code block line numbers are optional and controlled from Admin. They are
decorative and are not copied.

## Knowledge/Wiki

Knowledge/Wiki is the regular GoodVibes Knowledge surface.

The page is for:

- asking the regular knowledge base
- searching regular knowledge
- viewing sources, nodes, issues, and maps
- rendering/materializing regular projections when exposed by the SDK/daemon
- ingesting regular URLs/artifacts where supported

Home Assistant Home Graph is not part of this page. If Home Graph data appears
in regular Knowledge results by default, that is an upstream scoping issue and
should be fixed in SDK/daemon, not filtered in WebUI.

## Sessions

Sessions is the cross-surface session union: every session the daemon knows
about, whether it was started from the terminal, the agent, or this browser.

Use it to:

- find a session by searching titles and content (closed sessions are included
  by explicit choice, and the view says so)
- read a session's transcript
- steer a live session — on a phone, plain Enter sends
- follow up on a closed session, which is offered honestly as a follow-up (a
  new linked session), never disguised as steering
- distinguish reaped sessions by their badge

## Fleet

Fleet is the live process tree: sessions and their agents with per-node state.

Use it to:

- watch what is running right now, with per-agent detail
- steer, detach, or stop a node — each action appears only where the wire
  genuinely supports it, with an honest note where it does not
- act on pending approvals inline; wide screens offer per-hunk decisions

## Checkpoints

Checkpoints lists daemon checkpoints for browsing, creating, and restoring.
Two checkpoints can be diffed against each other. On a phone the list is
browsable; mutations defer to a wider screen with an honest pointer.

## Memory

Memory is the shared cross-surface memory store (terminal, agent, and browser
see the same records).

Use it to:

- browse and search records; the recall-honesty details (search mode, index
  availability, exclusion counts, recall floor) render verbatim from the
  daemon — a literal-match fallback says it is one
- edit review state
- delete records — deletion is real and verified (the view proves the record
  is gone rather than just dropping it from the list)

## Calendar

Calendar renders the daemon calendar module's agenda with ICS import/export.
An unconfigured daemon shows the bring-your-own-CalDAV note instead of a
scary error or a fake-empty calendar.

## Voice

Spoken replies and microphone dictation are available in Chat:

- spoken replies synthesize through the daemon's text-to-speech route,
  batched and concurrency-capped, with quiet retry
- dictation records in the browser, transcribes over the daemon's
  speech-to-text, and always shows the transcript for review before send
- voice configuration (provider, voice, settings) is the shared tier used by
  the terminal and agent — change it once, it applies everywhere

## Approvals, Tasks, and Workstream

Decision queues and orchestration state:

- Approvals lists pending decisions with enough context to decide
- Tasks shows the daemon task queue with submit/cancel/retry on desktop
- Workstream shows orchestration runs

## Installing the app

The WebUI installs from the browser as a standalone app (add to home screen on
iOS/Android, install prompt on desktop). The installed app caches only the app
shell — never daemon data — so opening it offline shows the honest "can't
reach the daemon" state. Web Push subscription for approvals/completions lives
in Admin under Notifications & install. Install and push require HTTPS; see
[deployment.md](deployment.md).

## Providers

Providers shows daemon provider and model state. Use it when:

- the current model is wrong
- the chat composer model list looks incomplete
- a provider appears unavailable
- account/provider posture needs inspection

Model selection is provider-first. The model dropdown should be scoped to the
selected provider.

## Admin

Admin is for supporting workflows:

- login with daemon-owned username/password auth
- paste/validate explicit operator tokens
- inspect local auth status
- inspect daemon/control-plane snapshots
- change display preferences
- view errors and diagnostics

Admin is also where clutter that does not belong in Chat should live.

## Expected Failure Handling

The WebUI should keep failures visible and retryable:

- send failures keep the draft behavior clear and mark local messages failed
- stale chat session ids are pruned when the daemon returns `SESSION_NOT_FOUND`
- auth failures route the user to Admin
- provider/model failures should show daemon error text rather than silently
  falling back to invalid routes
