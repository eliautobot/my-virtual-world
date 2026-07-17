# Live Agent Mode Resident Autonomy Kernel

Live Agent Mode is a reversible Virtual World role, not an Adam-specific behavior and not an extension of a provider's chat persona. When enabled for a resident, the world owns a persistent closed loop:

`observe → retrieve experience → infer as Resident Profile → act through a visible world executor → verify outcome → experience/learn → continue`

## Authority and isolation

The Virtual World `residentProfile` is authoritative for in-world identity, role, archetype, life purpose, backstory, personality, preferences, goals, relationships, and world-life memory. OpenClaw, Hermes, and Codex provide inference transport only. Their framework SOUL, IDENTITY, routine, and goals do not become Resident Profile fallbacks.

This is enforced at the provider boundary, not only stated in an ordinary chat message:

- OpenClaw uses one activation-scoped raw-model session with `promptMode: none`, so workspace bootstrap, SOUL, IDENTITY, AGENTS, memories, skills, and framework routines are not loaded.
- Hermes uses one activation-scoped configured profile session with `--ignore-rules` and no YOLO authorization; the profile still supplies model/auth transport while AGENTS/SOUL/memory/preloaded-skill injection is omitted.
- Codex uses one activation-scoped thread in a dedicated world-data working directory with Resident authority as the thread developer instruction and a read-only sandbox; the framework workspace and its AGENTS files are not the thread's working directory.

Platform safety, direct user control, and world ownership/permission rules remain higher authority. A direct user conversation pauses or preempts autonomous action. Turning Live Mode off stops the loop without deleting the Resident Profile or its world memory.

## Design lineage

The implementation deliberately combines the practical parts of two reference systems:

- Smallville / *Generative Agents* inspires a persistent resident record, relevance-recency-importance memory retrieval, reflection from consequential outcomes, plans that survive across turns, relationship memory, and reactive replanning.
- Emergence World inspires a model-owned long-horizon execution spine, a bounded observe/act loop, same-turn context-tool results, dynamic affordances derived from the current world, explicit outcomes, and resumable state instead of one-shot chat completion.

This is an implementation reference, not a claim that Virtual World duplicates either research environment.

## Runtime contract

Each Live Mode turn receives:

- an explicit Resident Profile authority contract;
- authoritative body position, visibility, occupancy, routes, nearby residents, and nearby object interactions;
- current needs, mood, boredom, enjoyment, preferences, goals, relationships, and recent verified outcomes;
- Resident memories ranked by relevance, recency, and importance;
- only interactions backed by typed visible world executors;
- four bounded read-only context tools: `world.observe`, `world.listAffordances`, `world.recall`, and `world.inspectLastOutcome`.

The model makes one present decision. It may preserve a multi-step commitment when the work really is multi-step, but it must not manufacture a meticulous plan instead of acting. The server never silently substitutes its ranked deterministic candidate when the model has not committed to an action. Provider failure, cooldown, or disabled inference therefore produces an inspectable wait state, not fake autonomy.

The executable candidate surface is also the permission boundary. Nearby-object coordinates, occupants, and unavailable interactions remain awareness facts. An interaction becomes executable only when it is perceived, backed by a typed Live Mode visible executor, and either immediately available or has a real available queue position. When the resident returns a typed action such as `life.restAtArmchair` instead of an opaque generated candidate id, the kernel may resolve it only to a matching candidate already present in that safe surface. Unknown categories, unsupported actions, and stale choices produce structured result evidence for the next Resident turn; they are never recorded as successfully applied discoveries and never trigger an unrelated ranked fallback.

All physical effects continue through the existing validated world-action and realtime movement contracts. New birth-world objects become available dynamically only when they expose a supported visible executor and their current interaction spot is perceived and available. Durable steps are revalidated against that surface every tick, including immediately after the model authors or repairs a step; an unavailable action is blocked even when the underlying world revision did not otherwise change.

## Persistence and observability

The world persists compact, bounded state for:

- durable goals/tasks/steps and verified progress;
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
