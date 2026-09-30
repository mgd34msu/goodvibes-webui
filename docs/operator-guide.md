# Operator guide

This guide describes the WebUI from an operator point of view.

## Navigation

The sidebar is the primary navigation surface. In order:

- New chat, a fresh conversation
- Search (Ctrl K), the command palette
- Work, what is running for you: Sessions, Hosted, Processes (the fleet),
  Needs you (approvals and tasks), Workstream, CI and Checkpoints. Its count
  chip is the number of processes blocked on you.
- Library, what GoodVibes knows: Knowledge and Memory
- Personal, the life-admin surfaces: Calendar, Mail and Occasions
- Recent, your chats, newest first, each with a permanent delete

Work, Library and Personal open with a section switch across the top, so every
view inside them is one click away. Settings, Models and usage, Devices and
pairing, People and channels (principals) and Check-ins are in the account
menu at the foot of the sidebar, together with the theme (Light, Dark, Auto and
the opt-in GoodVibes Neon), the connection to your daemon in plain words with
its latency, and Sign out. The dot on your avatar is the connection at a
glance; when the connection drops, a toast and a thin banner say so.

The sidebar collapses to a 56-wide icon rail with its panel button or Ctrl B,
and folds to that rail on its own while something large is open on the right
(a peek or a detail), returning when it closes. A sidebar you collapsed
yourself stays collapsed. Pin it to keep it open (under 1280 wide a detail
still folds it). Hover the rail, or press Ctrl B while a detail holds it, to
see the full sidebar over the page. Drag its edge to resize it (220 to 360).

At phone width there is no rail: the sidebar is a drawer behind the header's
menu button (or a swipe from the left edge). Tapping the dimmed area beside it,
or picking anything in it, closes it. The drawer never traps.

## Signing in and pairing

The sign-in screen leads with scanning. Run `goodvibes pair` in the terminal
(or open the desktop app's pairing panel) and either open the QR's link on the
phone or scan it with the in-page camera scanner. A scanned token feeds the
same validation path as a pasted one, and the one-time secret is stripped from
the URL immediately so it never lingers in the address bar or history. Pasting
an operator token by hand is the fallback; username/password login is offered
as a de-emphasized tertiary path.

A pairing link can also carry a hand-off bundle with up to three offers, so
one scan can finish the whole device setup. Each offer is independently
declinable, and the outcome of each is reported per offer, never silently
half-applied.

| Offer | What accepting it does |
| --- | --- |
| Push notifications | Runs the real browser ceremony (permission prompt, VAPID key fetch, push subscribe) and registers this device with the daemon, so approval and completion alerts arrive even when the app is closed |
| Remote connectivity | Acknowledges the relay offer, so this device can reach the daemon through the rendezvous relay when it is off your LAN |
| Passkey | Runs the WebAuthn registration ceremony and registers the credential with the daemon, used later to step up state-changing calls over the relay |

An offer whose ceremony fails locally (permission denied, no authenticator)
is reported as failed with the real reason, never downgraded to "declined",
because that would misrepresent an attempt as a choice never made. Scanning
needs a secure (HTTPS) context; over plain HTTP the scanner says so and
points at serving the app over HTTPS instead of failing quietly.

## Chat

Chat is daemon-owned companion chat. It is intended for direct LLM conversation
through the daemon's configured provider/model route.

Supported chat behavior:

- create new chats
- list daemon companion chat sessions
- preserve current/recent sessions across refresh while daemon data loads
- rename chats from the title
- delete chats from the sidebar; the delete closes first, hard-deletes, then
  verifies against a fresh list rather than trusting the call's success
  response
- send plain text with Enter (the daemon queues it behind an active turn)
- steer with Ctrl+Enter or Cmd+Enter (press and hold Send on touch), which
  sends immediately and interrupts the in-flight turn
- insert a newline with Shift+Enter
- stop generation with a server-side cancel; the stopped partial reply stays
  in the transcript with an honest stopped marker
- attach files through daemon artifact upload
- copy whole messages and individual code blocks
- resend user messages
- regenerate assistant replies; the superseded reply is retained, not erased
- edit a user message and branch; the old branch stays viewable inline as
  retained history
- search chat history, both session titles across full history (a daemon-side
  search) and message text within recently loaded sessions
- see queued messages while a turn is active, and dictate or speak replies
  with the voice controls

Provider/model controls in the composer update daemon model selection. Message
sends themselves do not include provider/model routing.

## Attachments

Attachments are uploaded as daemon artifacts before the chat message is sent.

Expected flows:

- text only
- attachment only
- text plus attachments

If upload fails, the optimistic message is marked failed and the error remains
visible near the composer. Large outputs open in the artifacts slide-over.

## Markdown responses

Assistant and Knowledge responses support Markdown rendering. Code blocks are
syntax highlighted when a supported language is detected.

Code block line numbers are optional and controlled from Admin. They are
decorative and are not copied.

## Voice

Spoken replies and microphone dictation are available in Chat:

- spoken replies synthesize through the daemon's text-to-speech route,
  batched and concurrency-capped, with quiet retry
- dictation records in the browser, transcribes over the daemon's
  speech-to-text, and always shows the transcript for review before send,
  never auto-sending
- voice configuration (provider, voice, settings) is the shared tier used by
  the terminal and agent. Change it once, it applies everywhere
- a managed local-voice install is available from the voice settings when the
  daemon supports it, provisioning daemon-side local speech engines with live
  install progress

### Wake word

The browser tab can listen for the wake phrase continuously and drop the
transcribed follow-up into the Chat composer. Detection runs inside the tab
(the model is downloaded from the daemon and inference runs locally), so the
microphone never streams to the daemon while idle. It is off by default and
gated twice: the models must be provisioned on the daemon (an explicit act,
size shown on the button), and the tab's own surface opt-in
(`voice.wake.surfaces.webui`) must be turned on, because the microphone
permission is granted per origin. While the opt-in is off, the tab loads no
model and never asks for the microphone.

While listening, an indicator is always visible, either a persistent banner or
a chip in the header depending on the configured indicator style. Settings a
tab cannot honor (retaining audio clips, playing a local activation-sound
file) are reported verbatim as limitations rather than silently ignored.

## Sessions

Sessions is the cross-surface session union, every session the daemon knows
about, whether it was started from the terminal, the agent, or this browser.
The daemon caps the list at the 50 most recent sessions and the view says so
rather than implying completeness.

Use it to:

- find a session by filtering kind and project; closed sessions are included
  by an explicit toggle, and the view says so
- read a session's transcript
- steer a live session (on a phone, plain Enter sends); a steer sent while the
  live stream is paused says so
- follow up on a closed session, which is offered honestly as a follow-up (a
  new linked session), never disguised as steering
- distinguish reaped sessions by their badge: an idle-reaped session reopens
  automatically on the next activity, so it is labeled differently from a
  deliberate close
- read and set the session's permission mode from the toolbar chip. The mode
  is session-scoped, and a session the daemon cannot answer for shows an
  honest unavailable state; the read-only `custom` mode is shown but never
  offered as a choice
- read the context-usage chip, an estimator figure marked with `~`, and the
  per-session cost chip for the last 24 hours; a session with no recorded cost
  says so instead of showing a fabricated zero
- review a session's file changes hunk by hunk, with comment and revert
  sheets, and rewind the session where the wire supports it
- close, reopen, or delete a session. Close and reopen are reversible,
  history-preserving actions; delete is permanent, requires the session to be
  closed first, and is verified against a fresh list before it is reported
  done

Compaction receipts render as distinct cards appended to the transcript as
they arrive live. There is no history endpoint for past receipts, so only
receipts observed while the session detail is open appear.

## Hosted sessions

A hosted session's conversation loop runs inside the daemon, so it does not
end when the tab that started it goes away.

Use the Hosted view to:

- list hosted sessions, with a toggle to include terminated ones; terminated
  rows show the daemon's own termination reason
- create one from a workspace path, an optional title, and a detach policy
  that defaults to the daemon's configured default
- attach to one: the stored history renders first, then the live stream
- steer it with the ordinary steer composer
- leave it: a confirm sheet states what leaving does, read from the session's
  own effective detach policy (kill ends it, survive leaves it idle and
  reattachable)
- end it explicitly: End session terminates it for every attached client and
  is confirmed first

## Fleet

Fleet is the live process tree: sessions and their agents with per-node state.
It refreshes on live fleet events, with a background poll as the honest
fallback while the stream is down.

Use it to:

- watch what is running right now, with per-agent detail; a node the daemon
  flagged as blocked on a human gets a distinct badge, and the nav icon
  carries an attention count
- steer or detach a node where a live session backs it, and stop watcher
  nodes; a capability the wire cannot address gets an honest note instead of
  a fabricated button
- act on pending approvals inline; wide screens offer per-hunk decisions
- inspect observed foreign-agent nodes, whose liveness tell states what
  `quiet` does and does not mean

On a phone the tree stays fully browsable; the mutation actions are
desktop-only and an honest note says so.

## Checkpoints

Checkpoints lists daemon checkpoints for browsing, creating, and restoring.
Selecting one shows its diff against the live working tree. Restore is
destructive and always confirmed with exactly what gets overwritten. A create
that finds the tree unchanged reports that plainly instead of fabricating a
checkpoint.

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

## Memory

Memory is the shared cross-surface memory store (terminal, agent, and browser
see the same records).

Use it to:

- browse and search records; the recall-honesty details (which search mode
  actually ran, why the semantic index could not be consulted, exclusion
  counts) render verbatim from the daemon. A literal-match fallback says it
  is one
- add records and work the review queue
- delete records: deletion is real and verified (the view proves the record
  is gone rather than just dropping it from the list)
- read the read-only personas surface for constraint records

A daemon that does not serve memory at all gets an honest "this daemon does
not serve memory" state, never a blank panel that reads as empty.

## Calendar

Calendar renders events from the daemon's CalDAV-backed calendar module, with
ICS import and export. Three refusal shapes render distinctly: an unconfigured
daemon points at the bring-your-own-CalDAV config keys, a daemon build with no
calendar handler says the capability is missing, and a genuine error offers a
retry. None of the three is ever shown as a fake-empty calendar.

## Mail

Mail is the inbox, message reader, and composer over the daemon's `email.*`
verbs. The browser never holds a mail credential; every call goes through the
daemon. A daemon build with no mail handler renders an honest not-available
state, a handler with no account yet points at settings, and a genuinely empty
inbox says it is empty. When the surface is refusing, Send and Save draft are
disabled with the reason named beside them rather than left live to fail.

## Dates

Dates shows occasions and plans over the daemon's `occasions.*` verbs:
upcoming dates with real dates and day counts, pending questions to answer,
conflicts to resolve, interviews to continue, and gift history. Every
proximity word, lead time, and nudge rule is computed by the daemon; this
page only renders answers and calls the write verbs. It is a pull surface:
it never originates a nudge.

## Providers

Providers shows daemon provider and model state. Use it when:

- the current model is wrong
- the chat composer model list looks incomplete
- a provider appears unavailable
- account/provider posture needs inspection

Provider status pills derive from the daemon's own per-route freshness rather
than a generic status guess. Model selection is provider-first, so the model
dropdown is scoped to the selected provider.

## Admin

Admin is for supporting workflows:

- login with daemon-owned username/password auth
- paste/validate explicit operator tokens
- inspect local auth status
- inspect daemon/control-plane snapshots
- open the schema-driven settings surface: typed editors per config key,
  secrets masked and write-only, admin-scope refusals reported distinctly,
  and restart-gated changes marked as pending
- change display preferences
- manage notifications and install (Web Push subscribe lives here)
- manage pairing tokens, passkey step-up, Tailscale posture, power
  keep-awake, owner profile, model prices, mail account settings, and memory
  diagnostics
- view errors and diagnostics

Admin is also where clutter that does not belong in Chat should live.

## Approvals and Tasks

Approvals lists pending, claimed, and historical approvals with enough context
to decide:

- a pending edit approval renders its hunks individually; Approve selected
  sends only the chosen hunk indexes, and Approve all keeps whole-request
  behavior
- Claim locks a pending approval; an approval claimed by another surface
  renders as claimed and is not actionable here
- Cancel withdraws a pending approval without deciding it
- resolved approvals render as history, never with action buttons
- a category-by-risk matrix summarizes the loaded set at a glance

Approval changes arrive over a live subscription; while it is down, a poll
keeps the list fresh and the toolbar states which mode it is in. Tasks shows
the daemon task queue with create, cancel, and retry; cancel appears only when
a task reports itself cancellable, and retry only for failed or cancelled
tasks.

## Workstream

Workstream shows orchestration runs: workstreams, their phases, and their
work items, rendered from the same fleet snapshot the Fleet view uses. Phases
are grouping rows and carry no fabricated usage or cost. Capabilities the
browser has no control verb for are noted honestly rather than offered as
buttons.

## CI

CI lists standing watches: create one for a repo, ref, or PR, delete one
(which stops its notifications, so it is confirmed first), or select one to
poll it immediately and read the per-job report. An ad hoc lookup checks any
repo/ref/PR without creating a watch. The detail always lists every job with
its own conclusion, marks continue-on-error jobs distinctly, and lists the
daemon's own reasons a verdict is not a clean pass.

## Check-in

Check-in shows the proactive check-in configuration with an edit control,
a run-now trigger with its receipt inline, and the receipts list. Every save
is confirmed, because the configuration can enable proactive contact. Each
receipt states its outcome plainly, never collapsed to a bare status dot.

| Outcome | Meaning |
| --- | --- |
| Delivered | The check-in ran and something was sent |
| Ran quiet | The check-in ran and found nothing worth surfacing |
| Skipped: check-in is disabled | The scheduled run was skipped because the feature is off |
| Skipped: within quiet hours | The scheduled run was skipped by the quiet-hours window |
| Skipped | A run-now was skipped for a reason the daemon states generically |
| Error | The run failed; the error is shown |

## Principals

Principals is read-first admin over the named-identity registry and
per-channel profile bindings:

- principals list every identity with its channel identities; create, update,
  and delete each go through a confirm sheet, and delete is permanent
- channel profiles list every surface/channel binding, the model, provider,
  and permission defaults a channel's originated sessions inherit, with
  upsert and confirmed delete

## Phone

Phone turns this browser into a paired device node. Open it on a phone, pair
once, and the device's capabilities become things the agent can ask for.
Nothing is served silently. Every capture and effect is confirmed with the
person first, and the page keeps an honest log of everything it served. A
capability the browser cannot actually provide on this origin is not
announced at all, so the desktop side explains why it is unavailable instead
of offering a control that would fail.

The capabilities a phone can announce:

| Capability | What it serves |
| --- | --- |
| Rear camera picture | A photo from the back camera |
| Front camera picture | A photo from the front camera |
| Screen picture | A capture of the phone's screen |
| Approximate location | A coarse position fix |
| Precise location | An exact position fix |
| Read the clipboard | The phone clipboard's current text |
| Put text on the clipboard | Writes text to the phone clipboard |
| Show a notification | Displays a notification on the phone |
| Open a link | Opens a URL on the phone |
| Vibrate | Buzzes the phone |

## Installing the app

The WebUI installs from the browser as a standalone app (add to home screen on
iOS/Android, install prompt on desktop). The installed app caches only the app
shell, never daemon data, so opening it offline shows the honest "can't
reach the daemon" state. Web Push subscription for approvals/completions lives
in Admin under Notifications & install. Install and push require HTTPS; see
[deployment.md](deployment.md).

## Expected failure handling

The WebUI should keep failures visible and retryable:

- send failures keep the draft behavior clear and mark local messages failed
- stale chat session ids are pruned when the daemon returns `SESSION_NOT_FOUND`
- auth failures land on the signed-out gate rather than a half-rendered shell
- provider/model failures should show daemon error text rather than silently
  falling back to invalid routes
- a daemon build that does not serve a verb family (mail, dates, calendar,
  memory) gets a stated not-available reading, never a blank page dressed as
  empty
