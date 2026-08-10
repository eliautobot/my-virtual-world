# v1.0.55 — SMS Inbox & Agent Control

Released: August 10, 2026

This release turns the basic SMS composer into a production-ready, synchronized Twilio Inbox with threaded history, explicit Agent/User ownership, agent assignment, and responsive window controls.

## Threaded SMS Inbox

- Adds a complete Inbox with synchronized inbound and outbound Twilio message history.
- Groups messages into contact threads with timestamps, previews, message counts, and new-reply indicators.
- Adds contact selection, new-conversation creation, manual refresh, and automatic background refresh while the Inbox is open.
- Keeps Twilio credentials on the server and never exposes them to the browser.
- Stores synchronized messages, contacts, and thread modes atomically in the persistent data volume.

## Agent and User control

- Adds an Agent/User control switch to each conversation.
- User-controlled threads allow manual replies from the SMS window.
- Agent-controlled threads reject manual sends and accept agent sends only from the assigned SMS agent.
- Enforces ownership rules on the server, not only in the interface.
- Adds **Assign SMS** to the Agent edit menu so one roster agent can own the SMS Inbox.
- Shows the assigned agent and current thread-control mode throughout the Inbox.

## Movable, resizable SMS window

- Makes the SMS window draggable from its title banner.
- Adds resizing from all four edges and all four corners.
- Adds maximize/restore while preserving the previous window geometry.
- Keeps the window constrained to the usable viewport.
- Makes the Inbox pane collapsible and expandable on desktop.
- Adds mobile Inbox/conversation navigation and touch-friendly controls for compact screens.

## Settings and API

- Adds a **Sync inbox history from Twilio** setting.
- Adds `/sms-sync`, `/sms-thread-mode`, and `/sms-owner` endpoints.
- Expands SMS status, threads, contacts, and send responses with owner and control-mode metadata.
- Preserves existing Twilio credentials when secret fields are left blank during Save Settings.
- Documents the SMS runtime contract and security boundary in the public API guide.

## Reliability and security

- Normalizes phone numbers consistently across synchronization, thread lookup, control changes, and sending.
- Deduplicates Twilio and local messages by provider SID.
- Uses atomic JSON writes for SMS runtime data.
- Redacts Twilio account credentials from browser-visible status responses.
- Adds clear errors for missing credentials, invalid phone numbers, wrong control mode, and unassigned or mismatched agents.

## Verification

- Passed the public smoke, packaging, Docker hygiene, secret scan, connection-guide, Provider SDK backend, endpoint-resolution, SMS backend, and eight-direction window-geometry suites.
- Verified synchronization against real Twilio history: 142 messages across 21 threads.
- Sent one authorized test SMS and confirmed it through a follow-up synchronization.
- Verified desktop and 390 x 844 mobile Inbox behavior, dragging, resizing, maximize/restore, collapse/expand, thread selection, Agent/User switching, manual sending, settings persistence, and Agent edit assignment.
- Verified zero browser page errors, zero application-container restarts, and no committed credentials or customer SMS data.

## Upgrade notes

No manual data migration is required. Existing SMS settings remain valid. Enter Twilio credentials in Settings, enable SMS, optionally enable history synchronization, and assign an SMS owner from an Agent edit menu. Runtime Inbox data is created in the persistent `/data` volume and is excluded from the repository.
