# Live Agent Mode Resident Autonomy Kernel

Status: implemented on the shared My Virtual World runtime (2026-07-17)

Live Agent Mode is a reversible embodiment lease, not an Adam-specific behavior and not a replacement persona. When enabled for a resident, the existing configured framework agent remains the mind while My Virtual World supplies the Resident's active in-world life, body, memory context, tools, and consequences through a persistent closed loop:

`observe → retrieve Virtual World memory → reason as the full framework agent inhabiting the Resident Profile → call a native world tool → execute visibly → verify outcome → record experience → continue`

## Product mode boundary

My Virtual World has two intentional resident behavior modes. They must remain distinct:

- **Default Mode** is the existing scripted simulation. It owns ambient schedules, weighted scripted choices, status reactions, and scripted routing whenever Live Agent Mode is not active for that resident.
- **Live Agent Mode** is an activation-scoped AI control layer. It can be enabled or disabled per resident. While active, it suppresses new Default Mode decisions and gives the Resident autonomy loop control of that same world body.

Live Agent Mode does not replace or fork the renderer, routing, realtime snapshots, world actions, reservations, queues, object executors, or saved world. Those are shared world/body infrastructure. Default Mode and Live Agent Mode differ at the behavior-owner and cognition layers only.

There must never be two simultaneous behavior owners for one resident. The required authority order is:

```text
direct user/manual control (including Live conversation or directive)
  > active Live Agent autonomous controller
  > Default Mode scripted controller
  > idle
```

User conversation is not a new behavior-source kind or a third ambient mode, and it must not deactivate Live Agent Mode implicitly. It is a higher-priority controller state inside the current Live activation:

- a greeting, question, or ordinary conversation immediately suspends admission of new autonomous actions and acquires a renewable attention lease;
- a safe physical action already underway may finish only when the message does not ask to stop or redirect it;
- `stop`, `cancel`, or `pause` interrupts Live-owned physical work and preserves a resumable paused checkpoint;
- a redirect supersedes the prior Live objective, cancels incompatible Live-owned work, preserves unrelated verified progress, and replans from current world state;
- `resume`, `continue`, or an expired conversational lease returns ownership to the Live autonomous controller;
- Default Mode may resume only after Live Agent Mode is explicitly disabled, never merely because the Resident is talking or waiting.

When Live Agent Mode is enabled, activation must preserve the resident's current authoritative position, suppress new scripted decisions, and safely release interruptible scripted state. When it is disabled, it must stop new Live turns, fence delayed model replies, settle or pause Live-owned work, archive the activation, preserve the current position and Resident Profile, and then allow Default Mode to resume from that position.

## Authority and isolation

The configured framework agent and the Virtual World Resident Profile compose one embodied agent:

- OpenClaw's normal SOUL, IDENTITY, AGENTS instructions, skills, reasoning, voice, and framework capabilities remain loaded. My Virtual World must never replace them with a raw-model call or a planner-shaped imitation.
- The Virtual World `residentProfile` is additive, authoritative embodiment context: the agent's in-world role, body, location, needs, possessions, relationships, responsibilities, commitments, and current situation.
- My Virtual World is the authoritative store for short-term and long-term world memories. Its memory manager records grounded world experiences, retrieves the relevant subset, and injects those memories into each embodied framework turn.
- Each meaningful OpenClaw event or conversation uses a fresh fully bootstrapped transport session. The configured agent stays the same, but raw sensory frames and tool results are not replayed forever. Activation ids grant and revoke the body; durable continuity comes from the world-owned Resident memory, journal, checkpoint, goals, relationships, and current working set.
- Native allowlisted `virtual_world_*` tools call the existing Virtual World API. They do not implement another planner, movement engine, memory database, or action lifecycle.
- Every physical mutation still passes through server-side Live/Default ownership, user priority, action validation, target resolution, routing, reservation, visible execution, and authoritative verification.
- Provider transcripts are disposable transport diagnostics, not a second authoritative world-memory store. Grounded world facts and consolidation remain owned by My Virtual World.

Hermes and Codex retain compatibility adapters until their frameworks expose an equivalent trusted native-tool binding. Those adapters must preserve the same identity-plus-Resident composition and may never become a deterministic fallback for an OpenClaw resident.

Platform safety, direct user control, and world ownership/permission rules remain higher authority. A direct user conversation pauses or preempts autonomous action. Turning Live Mode off stops the loop without deleting the framework agent, Resident Profile, or Virtual World memory.

## Design lineage

The implementation deliberately combines the practical parts of two reference systems:

- Smallville / *Generative Agents* inspires a persistent resident record, relevance-recency-importance memory retrieval, reflection from consequential outcomes, plans that survive across turns, relationship memory, and reactive replanning.
- Emergence World inspires a model-owned long-horizon execution spine, a bounded observe/act loop, same-turn context-tool results, dynamic affordances derived from the current world, explicit outcomes, and resumable state instead of one-shot chat completion.

This is an implementation reference, not a claim that Virtual World duplicates either research environment.

## Runtime contract

Each Live Mode turn injects a bounded working set into the existing fully bootstrapped agent:

- an explicit identity-plus-Resident embodiment contract;
- compact authoritative body, route, held-item, controller, commitment, and latest-outcome state;
- one current goal, two progress items, one actionable feedback episode, and compact needs/preferences;
- at most three Resident memories ranked by relevance, recency, and importance;
- at most four high-value interactions backed by typed visible world executors, plus compact blocker summaries;
- native allowlisted Virtual World tools for observation, affordances, action, action inspection/cancellation, waiting, memory recall/recording, commitments, and voluntary speech.

This follows the useful Smallville pattern: keep the complete memory stream outside the model transcript and retrieve a small, ranked slice for the present decision. Rich observation, a longer affordance list, or more memories are loaded on demand through tools instead of being prepaid in every heartbeat.

The framework agent makes one present decision. It may preserve a multi-step commitment when the work really is multi-step, but it must not manufacture a meticulous plan instead of acting. OpenClaw invokes native tools directly; its final prose is never parsed into a second physical command. The server never silently substitutes its ranked deterministic candidate when the agent has not committed to an action. Provider failure, cooldown, or disabled inference therefore produces an inspectable wait state, not fake autonomy. Provider error prose is classified before turn completion; repeated transport failures open a bounded exponential circuit breaker, and unchanged recovery heartbeats do not start another large-model turn.

The executable candidate surface is also the permission boundary. Nearby-object coordinates, occupants, and unavailable interactions remain awareness facts. An interaction becomes executable only when it is perceived, backed by a typed Live Mode visible executor, and either immediately available or has a real available queue position. When the resident returns a typed action such as `life.restAtArmchair` instead of an opaque generated candidate id, the kernel may resolve it only to a matching candidate already present in that safe surface. Unknown categories, unsupported actions, and stale choices produce structured result evidence for the next Resident turn; they are never recorded as successfully applied discoveries and never trigger an unrelated ranked fallback.

All physical effects continue through the existing validated world-action and realtime movement contracts. New birth-world objects become available dynamically only when they expose a supported visible executor and their current interaction spot is perceived and available. Durable steps are revalidated against that surface every tick, including immediately after the model authors or repairs a step; an unavailable action is blocked even when the underlying world revision did not otherwise change.

## Persistence and observability

The world persists compact, bounded state for:

- durable goals/tasks/steps and verified progress;
- structured per-category target coverage and the next untested reachable target;
- physical and support outcomes;
- Resident short-term, long-term, relationship, and reflection memory;
- lived experience (novelty, enjoyment, mood, valence, arousal, boredom);
- causal decision trace phases (`observe`, `infer`, `act`, `observe-result`);
- the latest non-physical wait/error status separately from the latest physical outcome.

Enabling a resident atomically starts the scheduler, claims the world, and creates a provider-neutral durable **Live Agent Mode** activation. The UI renders the world-owned lived journal—not raw prompts, private reasoning, or planner JSON. It shows concise observation, reaction, decision, queue, route, arrival, use, result, social, and memory events. The user can speak into that same session: questions preserve the current route, while explicit stop, resume, and redirect messages update the resumable checkpoint.

Small carried items bridge verified actions. Getting coffee, water, a vending item, or heated food creates short-term carried-item state; the Resident then chooses a real available seating place, visibly routes there, and consumes/uses the item only after verified seating. Repeated occupancy/resource shortages become working memory, then evidence-backed Resident long-term memory when consequential or explicitly selected by the Resident. Meaningful social actions carry a topic and propagate that knowledge into the other Resident's memory.

## Required behavior

An implementation is acceptable only when it demonstrates all of the following end to end:

1. Resident Profile content reaches inference and explicitly overrides provider framework persona fallback.
2. The resident can inspect current world context, make its own safe choice, physically execute it, and observe the verified result.
3. Consequential experience changes later memory, mood/preference context, and decisions.
4. A multi-step goal resumes after ticks and process restart without repeating verified steps.
5. Provider errors and disabled inference never start deterministic actions in the resident's name.
6. Direct user control and feature deactivation preempt the loop safely.
7. The feature works through OpenClaw, Hermes, and Codex adapters without becoming hardcoded to one resident.
8. Stored state remains bounded under endurance and repeated-action stress.
9. The Live session exposes recurrent physical microsteps and accepts conversational interruption without destroying unrelated progress.
10. Queue contention, carried-item follow-ups, resource learning, and meaningful social topic propagation are verified generically for any Resident.
11. User redirects settle as neutral supersessions, and seating succeeds only with authored seated posture/use evidence rather than route arrival or a standing rest interaction.

## Consolidated improvement order

The following is the canonical improvement order for the current implementation. Every item extends an existing My Virtual World component; none authorizes a parallel planner, movement system, action lifecycle, memory store, or conversation agent.

| Order | Improvement | Existing My Virtual World work to reuse or modify | Mode invariant |
| --- | --- | --- | --- |
| 0 | Lock architecture and transcript regression baseline | Existing restart spec, behavior-source authorities, autonomy/lived-session/spatial/storage/chat tests, and the coffee-machine/whiteboard/printer field transcript | Tests must run both Default Mode and Live Agent Mode and prove that only one owns the body. |
| 1 | Consolidate behavior admission behind the existing authority gate | `BEHAVIOR_AUTHORITY_BY_SOURCE`, world-action admission, move intents, client scripted-suppression checks, per-agent Live setting, global feature switch, and world claim | Extend the current gate; do not introduce a second ownership service. |
| 2 | Harden activate/deactivate transitions | Per-agent Live toggle, atomic activation, activation-scoped session, shutdown path, generation fencing, durable-goal pause/resume, route leases, and current-position snapshots | Enable suppresses Default Mode without teleporting. Disable preserves position and explicitly hands control back to Default Mode. |
| 3 | Unify user-chat interruption semantics | Live Session message endpoint, chat user-attention endpoint, intent classification, attention holds, stop/resume/redirect handling, neutral supersession, and late-reply fencing | Every chat surface must enter the same higher-priority Live conversation state. Chat must not start Default Mode or a second planner. |
| 4 | Make renderer state continuously truthful | Colyseus sidecar, runtime snapshots, route leases, heartbeat broadcast, `agent-runtime-client.mjs` stale/resume support, and `main3d.js` observer rendering | Shared for both modes. Do not add another socket, renderer, position store, or movement engine. |
| 5 | Repair the existing ordered journal and catch-up path | World-action events, Live Session journal, activation filtering, event keys, operator timeline, and provider/public-history separation | Preserve original event time and deduplicate replay; do not add another public activity feed. |
| 6 | Make the active Live controller event-driven | Existing 30-second recovery scheduler, immediate wake hook, world-action transitions, route watchdog, async provider replies, Live checkpoint, and durable goal ledger | This controller exists only inside Live Agent Mode. Default Mode keeps its scripted decision loop and remains suppressed while Live owns the resident. |
| 7 | Add Action Awareness to existing world actions | Typed visible executors, authoritative perception, route/arrival/use lifecycle, carried items, completion evidence, failure learning, and target-specific verification | Compare expected with observed before Live chooses again; lifecycle narration must come from server evidence, not model claims. |
| 8 | Add declarative composable Live skills | Existing typed actions, affordance discovery, routes, queues, reservations, durable tasks/steps, and coffee-to-seating continuation | A skill is an ordered composition of allowlisted world actions, never arbitrary generated code and never a replacement executor. |
| 9 | Complete semantic goal contracts | Existing durable goal/task/step ledger, stable IDs, dependencies, retries, evidence binding, replanning, terminal tombstones, and cross-object protections | Goal evidence must match action family, target identity, time, and postconditions. Terminal Live goals cannot restart from delayed replies. |
| 10 | Make reflection operational | Resident Profile short/long-term memory, relationships, relevance retrieval, consolidation, mood, novelty, boredom, failure streaks, and repetition penalties | Structured reflection must update beliefs, cooldowns, skill confidence, goals, relationships, or wake conditions; prose alone cannot control behavior. |
| 11 | Add legitimate Live waiting and dwelling | Existing `skip`, seating/rest actions, needs, cooldowns, mood, boredom, and visible use animation | Waiting, observing, thinking, sitting, conversing, and dwelling are successful Live states. They do not hand control to Default Mode while Live remains active. |
| 12 | Extend Live social behavior and world-event wakes | Nearby-agent perception, social actions, relationship scores, conversation topics, memory propagation, communication history, and loop wakes | Social behavior enters the same Live controller and attention hierarchy; do not add a separate social planner. |
| 13 | Add bounded procedural learning | Existing action outcomes, target failure history, reliability scores, repetition saturation, route watchdog evidence, and Resident memory | Learning may adjust Live selection and cooldowns but cannot bypass validation or alter Default Mode scripts implicitly. |
| 14 | Optimize the existing inference pipeline | Disposable bounded OpenClaw event sessions, compatibility-scoped Hermes/Codex sessions, async inference, cooldowns, ranked working sets, on-demand native world tools, deterministic world execution, and memory retrieval | Continuous body simulation stays model-free; large-model calls occur only for meaningful Live decisions, conversation, replanning, or reflection. |
| 15 | Extend diagnostics and release gates | Existing operator timeline, decision traces, feedback, proposals, goals, action events, Live journal, and verification scripts | Diagnostics must show current mode, behavior owner, user-attention lease, active goal/step/action, snapshot age, expected/observed result, and rejected-owner reason. |

Release validation must explicitly cover all ownership transitions: Default-to-Live activation, Live-to-Default deactivation, user conversation during Live routing, stop, redirect, resume, delayed provider replies, renderer reconnection, and service restart. A passing autonomy soak is invalid if Default Mode and Live Agent Mode ever issue concurrent physical commands.

## Implemented consolidation

The order above is now implemented by extending the existing runtime:

- world-action admission and realtime scripted eligibility enforce the behavior-authority hierarchy;
- activate/deactivate use the existing setting, handoff, shutdown, activation session, and generation fence;
- Live Session and regular provider chat share conversation leases, with stop/redirect as explicit interrupting intents;
- the existing Colyseus room broadcasts health, the existing runtime client performs continuous stale detection/reconnect/hydration, and the UI exposes connection truth;
- the Live journal uses the existing monotonic world-action event cursor, original timestamps, catch-up condensation, and a reduced meaningful public lifecycle;
- the existing loop checkpoint is the Cognitive Controller projection and its timer is a recovery heartbeat around event wakes;
- typed world actions carry expected/observed Action Awareness contracts;
- allowlisted world actions compose into persisted skill execution, including carried-item follow-up;
- durable steps carry action-family, target-identity, evidence-domain, and postcondition contracts;
- reflection updates existing target cooldowns, procedural confidence, goals, memory, and wake state;
- bounded waiting/observing/dwelling are legitimate Live outcomes;
- existing social perception/actions/relationships and world-action transitions feed the same controller;
- operator status exposes controller, attention, waiting, skill, action-awareness, cooldown, and rejection diagnostics.

No second movement engine, planner scheduler, conversation agent, action lifecycle, goal store, memory store, or public activity feed was introduced.
