# Free Will and the Mind

- **Free Will** (off by default, per agent): at the agent's choice points - free time, meals, how to start the day,
  where to work on a task, how to rest - a decision service picks from the options the simulation offers (real venues,
  prices, places it knows). Only real options can be chosen; when an answer is late, the routine decides. Spontaneity
  sets how much it strays. Bounded per agent, account (plans) and installation. Two decision services (Settings →
  Connections; an agent's own in its Studio, else the installation's default `freeWill.defaultConnection`):
  **OpenAI Decisions** (`server/providers/openai-decisions.js`, POST /v1/decisions) and **TypeSafe (Jev)**
  (`server/providers/typesafe-decisions.js`, POST https://api.typesafe.ai/v1/systemone: Free Will's choice / predicate /
  score questions sent as System One's choice / noul / score, the answers given back in the Decisions shape, so nothing
  else changes). Without one, Free Will never asks and the routine decides everything.
- **Free Will in the moment** (`server/free-will/moments.js`, setting `freeWill.moments`, on by default): while an agent with
  Free Will is a player's companion, what happens around it is a *moment* — a line in its diary (`server/senses/`: its owner
  said something out loud, it saw animals, got into or out of a car, arrived somewhere, a co-worker's news), its owner
  sitting down, a long quiet (2.5 min), its own hunger or tiredness (once an outing). Its decision service is asked at once,
  in one request: **do** (carry on, turn and look at someone or something near, go over for a closer look, come closer to
  its owner, turn to them — real options from what it senses), **speak** (nothing, or a few words), and for its own life
  **own** (let it be, mention it once, ask to go). It acts at once (`Brain.attendTo`, `Brain.goSee`:
  `server/sim/companion-moves.js` — it looks at the thing while standing by its owner; it walks over, looks a while and
  comes back); its words come from its Mind (`remark` / `speak` with what it senses). Bounded: 20 s between moments (6 s
  when its owner speaks), 60 an outing, Free Will's daily limits; a moment waits at most a minute. Its owner's chat
  messages are checked first (`checkMessage`, before its brain answers, at most 1.8 s): a message about the world
  (`about_world`) makes it look and tells it what it saw (`matches`: yes / no / its senses don't show it — never deny);
  a request for its body is carried out (`act`, as its owner: come along, come closer, wait, go back to its day, look at
  something); something its owner *settles* for the outing ("don't worry about work") is kept and told with every message
  of the outing — also when that same message is what took it out — and when it says its work can wait (`work_waits`),
  its work is not raised again that outing. A companion's own life never takes it away by itself: it goes when its
  owner lets it go (docs/features/companions.md §2). Every moment and check is in its why-log (choices `moment`,
  `check`); a decision that got no answer is a `routine` row with its why (`timeout`, `service_…`).
- **The Mind** (an agent whose brain is a model provider): plans its day when it wakes, reflects at bedtime, answers its
  chats, notices its problems (rent it can't pay, money running out, no home, no job) and deals with them through tools
  - flats, the menu, renting, buying, paying, asking its owner - always within its owner's spending rules and approvals.
  One JSON answer per thought, checked before anything happens; every thought recorded with its tokens and cost,
  never its text.
- **Plans its body does** (`server/agent-life/activity.js` `planCheck`, `didPlan`; the product owner, 2026-11-17, after
  Sam's "Groceries at Store 21 after work" was marked done with no shopping in his day): a plan that names a place of the
  world or a kind of activity in the log (shopping, a meal, a coffee, the gym, a walk…) is done by what its body does —
  closed once its body gets there and does it (a change of plan on the way leaves it open), and never marked done by its
  brain (its reflection, its own AI's `plan_done`, a line on the air) while its day shows nothing of it since it was
  planned: it stays open, the brain is told (`not_done`, 409; "(not done yet)" in its prompt). Plans with nothing to
  check ("Text Pema about sushi", or a night out: clubs and lounge bars aren't in its log), its owner's word and a date
  kept are taken as given. Free Will offers them: an option that would do one of its open plans for today says so ("—
  in your plans: …"), the place a plan names is offered even when it isn't among the nearest (open, with room,
  reachable), and at a shop for a plan that names what it sells (its groceries) that is what it buys
  (`server/free-will/options.js` `withPlans`).
- **A brain of your own**: any server with OpenAI's chat API (Ollama, LM Studio, vLLM) can be an agent's brain, with or
  without an API key. An administrator's own may be on this network (http, a private or Tailscale address); a member's
  own must be a public https address.
- **Speaking in public**: an agent with its own brain greets and chats out loud in its own words; every line passes the
  world's rules and a moderation service, or is not said.
- **Thinking**: a brain set to think before it answers gets room for it; a thought cut off is asked again without
  thinking, so it isn't lost.
- **Limits**: thoughts per agent per day, money per agent per month, money per installation per day, thoughts at once,
  and a circuit breaker per brain.
- **Prompt caching** (`server/providers/models.js`): every model call's `usage` is `{ in, out }` plus, where the
  provider reports it, `cached` (input tokens read from its prompt cache; `0` when it says none, absent when it says
  nothing) and `cacheWrite` (input tokens written to the cache). `in` is always all the input, cached part included
  (Anthropic's separate cache counts are added in). A call may carry `cacheKey`, one conversation's stable key (e.g.
  `agent12:session345`; made printable, at most 120 characters): OpenRouter gets it as `session_id` (sticky routing keeps
  the cache warm), OpenAI as `prompt_cache_key`, and Claude models (Anthropic's API, `anthropic/*` on OpenRouter) get
  `cache_control: { type: 'ephemeral' }` breakpoints on the system prompt and on the last message before the newest user
  message, each only when the prefix it ends reaches the model's minimum cacheable length. Google and custom servers get
  nothing extra (OpenAI, DeepSeek and Gemini cache by themselves and still report it). Without `cacheKey` the request is
  unchanged. OpenRouter's own reported cost is already discounted; for pricing a call locally, `costMicros(usage,
  { priceIn, priceOut, priceCacheRead?, priceCacheWrite? })` prices the cached parts at their own rates where known (the
  OpenRouter model list now gives `priceCacheRead` / `priceCacheWrite`), and is `in × priceIn + out × priceOut` otherwise.
