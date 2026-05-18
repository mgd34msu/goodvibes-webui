# Screenshot Tour

These screenshots are captured from the running WebUI dev server with a fresh
browser profile at `1440x1000`. Local auth, chat history, providers, and daemon
state vary by operator environment, so treat these as layout references rather
than fixed data fixtures.

## Chat

Chat is the primary workspace. The composer owns message input, attachment
upload, voice-mode affordances, provider selection, model selection, and send.
The sidebar owns navigation and chat session selection.

![Chat view](assets/screenshots/chat.png)

## Knowledge/Wiki

Knowledge/Wiki uses the regular GoodVibes Knowledge routes through the scoped
browser Knowledge SDK. Home Assistant Home Graph is intentionally not part of
this general surface.

![Knowledge view](assets/screenshots/knowledge.png)

## Providers

Providers is the supporting surface for daemon provider/model state. Provider
selection is provider-first, with model options scoped to the selected provider.

![Providers view](assets/screenshots/providers.png)

## Admin

Admin contains auth, daemon diagnostics, local auth status, display preferences,
and operational controls that should not clutter Chat.

![Admin view](assets/screenshots/admin.png)

## Collapsed Sidebar

The collapsed sidebar keeps primary navigation available while giving Chat most
of the horizontal space.

![Collapsed sidebar](assets/screenshots/collapsed-sidebar.png)
