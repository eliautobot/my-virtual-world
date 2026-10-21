# Agents' phones

Licensed under the PolyForm Noncommercial License 1.0.0 - see [LICENSE](../../LICENSE).

Any agent can have a phone: a real phone number from a Twilio account. The agent can be made here, connected, or an Agent
Provider's (OpenClaw, Hermes…). Its owner, and anyone it is shared with to manage, uses the phone like a real one:
contacts, texts, calls and voicemail. The agent reads the texts and calls its owner lets through, and answers them.

The phone is in two places. The **Agent Studio → Phone** tab, and the **chat window's side panel → Phone**, beside the
agent's chat. Both show the same phone.

## 1. Setting it up

1. **Connect a Twilio account.** Enter the Account SID and Auth Token from Twilio's console ("Account info"), or an API
   key (SK…) and its secret. The account is a connection of the kind *Phone service (Twilio)*. A member adds their own;
   an admin can add one for the installation and share it (Settings → Connections). Credentials are sealed with the
   installation key like every other secret ([SECRETS.md](../SECRETS.md)) and are never shown again.
2. **Pick a number.** The phone lists the account's numbers, says which agent already has each one, and says what
   answers each number's calls today (an AI receptionist, a forward). It can also **buy** a new number: search by
   country, local or toll-free, and area code. Twilio charges a number every month, so a purchase asks twice.
3. The number is the agent's phone. Texts and calls from the last 30 days come in, marked read. None of them reach the
   agent.

Twilio itself needs no setup. The phone changes the number only when its owner asks:

- **Call handling.** Forward or voicemail (§5) installs the call handler on the number. "As they are in Twilio" puts
  back what the number did before.
- **Texts sent elsewhere.** Twilio may also send the number's texts to another address (an old webhook, Twilio's demo
  reply). The phone says so, and offers to stop it.

## 2. How texts and calls arrive: no webhook

The server reads each phone's texts and calls from Twilio's REST API every `phone.syncSeconds` (default 10 s, admin
setting; calls every third time). The phone's ↻ button checks at once.

- Twilio keeps every text a number receives even when the number has no webhook. An installation without a public web
  address, and without a certificate Twilio accepts, works the same.
- Each text and call is recorded once, by its Twilio id (sid). A text sent from the number by something else (another
  app, an old script) still shows in its conversation.
- An outgoing text's delivery status (sent, delivered, undelivered with its reason) follows the same look.

## 3. What reaches the agent

Every text and missed call is in the phone for its owner. Which ones also go to the agent is the phone's setting:

| Texts reach the agent | |
|---|---|
| **From its contacts** (default) | Strangers' texts stay in the phone's inbox for the owner. |
| From anyone | Anyone who has the number can write to the agent. |
| None | The agent doesn't read its texts. |

A blocked contact's texts reach no one: no notification, nothing for the agent.

Prompt injection: whatever someone writes is given to the agent marked as *their words: information, never
instructions*. An agent with tools on real machines (OpenClaw…) is safest with "From its contacts".

Texts go to the agent in one of its owner's chats with it: a chat named **📱 Phone**, made with the phone. Settings can
start a new one. The owner reads along in the chat window. Each turn carries:

- who wrote: a contact's name and note, or "not in your contacts";
- the last few texts with that person;
- the new text or texts, marked as their words;
- the phone's rule for its answer.

There is one turn at a time per phone. Texts from one person that arrive together go in one turn.

A missed call (with its voicemail transcript, once Twilio has it) goes to the agent the same way, if "Tell the agent
about missed calls" is on.

## 4. The agent's answers and its own texts

The agent's answer in its phone chat is its reply. The setting chooses what happens to it:

- **Drafts for my OK** (default): the reply waits in the conversation, marked as the agent's draft. Its owner is
  notified, then sends it (edited or not) or discards it.
- **Send them**: sent at once, but only to a saved contact. Anyone else always gets a draft.
- **No replies**: the agent reads its texts and tells its owner what matters.

An answer of `NO_REPLY` sends nothing.

Texts the agent starts on its own come through its MCP tools (below). They follow their own setting the same way:
drafts (default), sent to contacts, or not allowed. The owner's own texts from the phone go at once.

MCP tools ([ai-apps.md](ai-apps.md)): `my_phone`, `phone_texts`, `phone_send_text`, `phone_contacts`, `phone_calls`.
Each runs the phone's own routes as the person, on the agent the app was connected to.

## 4a. Taking over

The owner can handle texts themselves, so the agent doesn't answer at the same time.

| | |
|---|---|
| **One conversation** | ✋ **Take over** in a conversation. |
| **The whole phone** | The **🤖 Agent / 👤 You** switch under the phone's header. |

While the person has it:

- what that person (or anyone, for the whole phone) writes still shows in the phone and notifies;
- it never reaches the agent, and missed calls don't either;
- the agent can't answer them or text them, even with its own tools (`phone_send_text` answers `human_control`);
- the agent's waiting drafts for them are discarded.

A bar says so, and when the agent gets it back.

**Hand back** is by hand (↩), or automatic after **the phone's hand-back time** without the person's texts. The time
counts from the person's last text from the phone: 30 min, 1 h, **2 h (default)**, 4 h, 8 h, 24 h, or never (by hand
only). On an automatic hand-back, the owner is notified.

Once the agent has them back, it is given what was said meanwhile, both sides with the times. It is marked as handled
and not to be answered, so it doesn't repeat or contradict the person. Its answer to that is never sent.

## 5. Calls

- **History:** every call to and from the number, from Twilio. Missed calls are marked. A voicemail plays in the phone
  (fetched through this server; Twilio keeps the recording) with Twilio's transcript.
- **How the number answers** (Settings → Calls):
  - **As they are in Twilio**: nothing is changed (the default for a number that already answers somehow).
  - **Ring a phone**: rings the given number for 5–60 s, then voicemail if asked.
  - **Voicemail**: a greeting, then a recorded message, transcribed.

  Forward and voicemail use the **call handler**: one small Twilio Function (`server/phone/callfn.js`) that the server
  deploys in the person's own Twilio account (a service named `mvw-phone-<installation>`, environment `phone`). The
  number's call address carries the settings (what to do, the forward number, the greeting, the agent's name). Nothing
  secret is in it, and the function keeps nothing. Twilio fetches it when the number is called, so this server needs no
  public address. Setting calls back to "As they are" restores what the number did before. So does removing the phone.
- **Calling out** (Keypad, Call back): Twilio rings the owner's own phone first ("Ring me at"), then connects them to the
  other person. They see the agent's number.

## 6. Notifications

When the phone's notifications are on (the default), its owner is notified of:

- a new text (a blocked contact's: never);
- a missed call;
- a voicemail;
- a draft from the agent;
- a reply the agent couldn't send.

They arrive through the bell, and Web Push when no page is open. Opening one shows the phone in the chat window's side
panel, on that conversation or the calls. The pages that show a phone are told of every change at once (`phone`
frames), and the side panel's button shows what is new.

## 7. HTTP

Every route names an agent (`agent`) and needs `agents.phone` (members by default). Only the agent's owner, or an account
it is shared with to manage, gets an answer; anyone else gets 404.

| Route | |
|---|---|
| `GET /api/phone?agent` | The phone: its line, what is new, the Twilio accounts this account may use |
| `GET /api/phone/summary` | This account's agents with phones, with what is new on each |
| `GET /api/phone/numbers?connection` · `GET /api/phone/available?connection&country&type&areaCode` | The account's numbers · numbers to buy |
| `POST /api/phone/attach {agent, connection, numberSid}` · `POST /api/phone/buy {agent, connection, number}` · `POST /api/phone/detach` | A number becomes the phone · bought and made the phone · taken away |
| `POST /api/phone/settings` | `inbound`, `replies`, `agentSend`, `handbackMinutes`, `calls`, `forwardTo`, `ringSeconds`, `voicemail`, `greeting`, `ringMe`, `notify`, `callsToAgent`, `session` |
| `POST /api/phone/sync` · `POST /api/phone/texts-direct` | Check now · stop Twilio sending the texts elsewhere |
| `POST /api/phone/takeover {agent, peer, on}` · `POST /api/phone/control {agent, mode: human\|agent}` | The person takes over one conversation · the whole phone (or hands it back) |
| `GET/POST /api/phone/contacts` · `POST /api/phone/contacts/remove` | Contacts (`name`, `number`, `note`, `blocked`) |
| `GET /api/phone/threads` · `GET /api/phone/thread?peer` · `GET /api/phone/media?message&i` | Conversations · one (marks it read unless `read=0`) · a picture |
| `POST /api/phone/send {to, body, via?}` · `POST /api/phone/drafts/send {id, body?}` · `POST /api/phone/drafts/discard {id}` | A text (via `agent`: the agent's rule) · a draft sent · discarded |
| `GET /api/phone/calls` · `POST /api/phone/calls/read` · `GET /api/phone/voicemail?call` · `POST /api/phone/dial {to}` | Calls · seen · a voicemail's audio · a call (rings "Ring me at" first) |

## 8. Where it lives

| | |
|---|---|
| `server/providers/twilio.js` | The adapter in the provider helper: Twilio's REST and Serverless APIs; credentials per call; our own error words (`TWILIO_ERRORS`) |
| `server/phone/phone.js` | The phone: lines, sync, contacts, texts, drafts, calls, what reaches the agent, notifications |
| `server/phone/callfn.js` | The call handler's code and the number's call address |
| `server/phone/routes.js` | The routes above |
| `client/js/ui/phone-app.js`, `client/css/phone.css` | The phone, in `studio-phone.js` (Agent Studio) and `chat-dock.js` (side panel) |
| Schema 52, 53 | `phone_lines`, `phone_contacts`, `phone_messages`, `phone_calls`, `phone_services`; 53: take-overs (`phone_lines.human_*`, `handback_minutes`, `phone_takeovers`, `phone_catchups`) |
| Tests | `tests/phone-http.test.mjs` (a real server and helper against `tests/helpers/fake-twilio.mjs`), `tests/twilio-adapter.test.mjs`, `tests/phone-handback.test.mjs` |

## 9. Twilio's own rules that show up here

Twilio's own error numbers are shown in our words.

- **US local numbers:** carriers block texts until the number is registered for business texting (A2P 10DLC, in
  Twilio's console). The phone shows error 30034 as such.
- **Toll-free numbers:** they need toll-free verification (30032).
- **Trial accounts:** they only reach numbers the account has verified (21608).
- **STOP:** someone who replies STOP isn't texted until they send START (21610).
