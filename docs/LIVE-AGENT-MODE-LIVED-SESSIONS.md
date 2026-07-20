# Live Agent Mode: Lived Sessions and Recurrent Actions

Status: implemented; all chat surfaces use the shared Live attention hierarchy
Session schema: `agent-live-mode-session/v1`
Store: `data/live-agent-sessions.json`

Live Agent Mode is generic to every Resident and every supported cognition provider. Enabling it creates one activation identified by `world + resident + activationId`. That activation owns a durable world journal, a resumable checkpoint, and bounded working memory. OpenClaw uses a fresh fully bootstrapped transport session for each meaningful event or conversation, then deletes it; the activation only grants or revokes the resident body. Hermes and Codex currently retain provider-compatible activation sessions until equivalent native-tool bindings are available.

## Recurrent loop

The world publishes this observable sequence:

```text
observe → decide → reserve-or-queue → route → arrive/revalidate
→ begin use → verify → react/learn → choose follow-up
```

Movement remains server-authoritative. Arrival includes a short visible revalidation boundary before use begins. Every world-action transition, queue promotion, and reservation release is converted into a concise Live session event. Raw provider prompts, planner JSON, and private reasoning are never displayed.

Busy objects remain perceptible. A queueable busy machine stays executable with its real queue position; a full or non-queueable object remains an observed blocker so the Resident can choose another target. Seating selection searches real chair, couch, stool, bench, and work-seat affordances rather than assuming an armchair is free.

## Conversation and control

`POST /api/agent-live-sessions/message` is the write surface for the Live session.

- Direct user speech has higher authority than Live autonomy. Every Live chat surface must enter the same conversation/attention state and prevent admission of a new autonomous physical action while the attention lease is active.
- A greeting, status question, or ordinary conversation is answered by the same configured agent using the current bounded Resident working set. A safe physical route already underway may continue, but the Resident cannot chain another autonomous action until the conversation ends, the lease expires, or the user says to continue.
- `stop`, `cancel`, or `pause` interrupts only Live-owned work and stores a paused checkpoint.
- `resume` observes the current world again and continues.
- A redirect cancels the previous Live action, stores the user's directive in working memory, and gives it immediate planning priority.
- Redirect and user-attention cancellations settle as neutral `superseded` outcomes. They do not raise needs, change mood, mark the target failed, consume retry budget, enter long-term failure memory, or create a Coder issue.
- Generation fencing prevents a late reply from the previous plan from taking action.
- Conversation does not disable Live Agent Mode and does not hand the resident to Default Mode. Default scripted behavior resumes only when the per-resident Live activation is explicitly disabled.

The chat UI polls the lived journal while selected and routes its Stop control through the same endpoint.

## Continuity and memory

Verified coffee, water, vending, and heated-food interactions create a visible carried item. The carried item activates a generic high-priority seating follow-up. It is cleared only after a verified seating interaction.

Seating is learned only from embodied evidence: seated posture, a non-idle use state/animation, final placement at the authored seat, and clean reservation release. Objects that expose both standing-rest and seated spots must use the actual seat interaction. For example, a gazebo uses `life.sitAtGazeboPavilion` at `sit-north-bench`; its standing `rest-west` spot cannot satisfy a seating objective.

Occupancy/resource observations are deduplicated and counted across separate observations. They remain in bounded working memory and diagnostics; they are never appended to the conversation journal, presented as Resident speech, or allowed to auto-open the avatar's chat bubble. A repeated consequential shortage is promoted from activation working memory into Resident short-term/reflection memory and consolidated into long-term memory. A Resident's explicit `memoryUpdate` is also consolidated when marked important/durable. Social actions can carry a real `conversationTopic`; completion stores it in the relationship and the listening Resident's memory.

Like Smallville's memory-stream design, a turn does not replay the Resident's entire history. The world ranks stored experiences by relevance, recency, and importance, then injects only the top three memories alongside one current goal, the latest outcome, a structured object-coverage ledger with the next untested target, two progress items, and the four most useful current actions. Deeper observation, affordance, and memory detail is available through native tools only when the agent asks for it. The default embodied prompt is capped at 6,000 characters. Every meaningful event gets a fresh scoped OpenClaw transport session, which is deleted with retry and startup cleanup after the bounded reply is captured. This uses the Gateway's public operator contract; context remains bounded because no transport session is reused.

The 30-second scheduler is a recovery heartbeat, not permission to call the model every time it fires. Cognition starts only for activation, a completed provider choice, direct user wake, explicit wait expiry, meaningful semantic perception change, or a bounded provider half-open retry. Repeated provider failures—including context overflow written as assistant text—open an exponential circuit breaker instead of masquerading as completed turns. Verified coverage targets receive strong saturation penalties, and dynamic category goals cannot rediscover the same completed object through a generic `world-use-*` alias.

## Verification

Run:

```bash
python3 scripts/verify-live-agent-lived-session.py
python3 scripts/verify-live-agent-autonomy.py
python3 scripts/verify-chat-sessions.py
```

The lived-session verifier covers activation persistence without provider-transcript retention, disposable turn isolation/cleanup, context-overflow classification, provider circuit breaking, meaningful-event cognition gating, every physical microstep, queue position, question/stop/redirect behavior, novelty-ranked carried-item seating, occupied queue targets, resource telemetry journal isolation, repeated-shortage consolidation, structured target coverage, Resident-selected long-term memory, social topic propagation, and atomic activation.
