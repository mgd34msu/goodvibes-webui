# Operator Guide

This guide describes the WebUI from an operator point of view.

## Navigation

The sidebar is the primary navigation surface:

- Chat
- Knowledge
- Providers
- Admin

Chat is the main workspace. Other pages are supporting surfaces for daemon
state, model selection, Knowledge/Wiki work, and auth/admin tasks.

The sidebar can collapse. In the collapsed state, primary nav icons remain
available and keep the sidebar collapsed when clicked.

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
