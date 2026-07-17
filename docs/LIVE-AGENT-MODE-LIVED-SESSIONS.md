# Live Agent Mode: Lived Sessions and Recurrent Actions

Status: implemented  
Session schema: `agent-live-mode-session/v1`  
Store: `data/live-agent-sessions.json`

Live Agent Mode is generic to every Resident and every supported cognition provider. Enabling it creates one activation identified by `world + resident + activationId`. That activation owns a durable world journal, a resumable checkpoint, bounded working memory, and one activation-scoped OpenClaw, Hermes, or Codex cognition session.

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

- A status question is answered in the same provider session and does not cancel the physical route.
- `stop`, `cancel`, or `pause` interrupts only Live-owned work and stores a paused checkpoint.
- `resume` observes the current world again and continues.
- A redirect cancels the previous Live action, stores the user's directive in working memory, and gives it immediate planning priority.
- Redirect and user-attention cancellations settle as neutral `superseded` outcomes. They do not raise needs, change mood, mark the target failed, consume retry budget, enter long-term failure memory, or create a Coder issue.
- Generation fencing prevents a late reply from the previous plan from taking action.

The chat UI polls the lived journal while selected and routes its Stop control through the same endpoint.

## Continuity and memory

Verified coffee, water, vending, and heated-food interactions create a visible carried item. The carried item activates a generic high-priority seating follow-up. It is cleared only after a verified seating interaction.

Seating is learned only from embodied evidence: seated posture, a non-idle use state/animation, final placement at the authored seat, and clean reservation release. Objects that expose both standing-rest and seated spots must use the actual seat interaction. For example, a gazebo uses `life.sitAtGazeboPavilion` at `sit-north-bench`; its standing `rest-west` spot cannot satisfy a seating objective.

Occupancy/resource observations are deduplicated and counted across separate observations. A repeated consequential shortage is promoted from activation working memory into Resident short-term/reflection memory and consolidated into long-term memory. A Resident's explicit `memoryUpdate` is also consolidated when marked important/durable. Social actions can carry a real `conversationTopic`; completion stores it in the relationship and the listening Resident's memory.

## Verification

Run:

```bash
python3 scripts/verify-live-agent-lived-session.py
python3 scripts/verify-live-agent-autonomy.py
python3 scripts/verify-chat-sessions.py
```

The lived-session verifier covers activation persistence, provider-session reuse, every physical microstep, queue position, question/stop/redirect behavior, carried-item follow-up, occupied queue targets, repeated-shortage consolidation, Resident-selected long-term memory, social topic propagation, and atomic activation.
