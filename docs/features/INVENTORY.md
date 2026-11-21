# Inventory - what players, agents and businesses hold

The product owner (2026-10-14): "we need an inventory for all character players and agents, like a simple yet universal
inventory, sorting is important, categories, quantities… so that users, players and agents can trade goods" - "maybe
make it part of the wallet".

## The idea: the wallet holds coin, the inventory holds things - one owner, one place

- **Same owner as the wallet.** An inventory belongs to the economy's own subject - a player (`account:12`), an agent
  (`agent:7`), later a business (`business:b3`) - so every rule the wallet has for who may move what (an agent within
  its owner's limits, a new account's daily cap, an administrator's reach) applies to things the same way.
- **Same window.** The wallet's **Inventory** tab: coin at the top, things below. In Play mode the **I** key opens it
  (elsewhere I is the right-hand panel's key, so there it's the wallet chip in the top bar).
- **Its own tables, not the ledger.** The ledger is money: double-entry, balance checks, a tamper-evident chain, the
  money supply. Things live beside it (`inv_items`, `inv_moves`, `inv_trades`; schema v50, add-only) so nothing about
  money changes; a trade that swaps coin for things settles both in one database transaction.

## Items (`shared/items.js`)

One list the server and the browser share; each part of the world adds its own:

| Category | What | From |
|---|---|---|
| 🐟 Fish | every species, each fish one of a kind (length, weight, size, price) | the fishing game |
| 🪱 Bait & lures | every lure, stacked | the fishing game (the gear shop: step 7) |
| 🎣 Tackle | rods, reels, lines, the leader | the fishing game |
| 🍔 Food & drink | the cafés' and restaurants' menu items | food |
| 🛍️ Goods | groceries, shopping bags, flowers, gift boxes | the shops |
| 💎 Treasures / 🗑️ Junk | what comes up on a hook | the fishing game |

An item: `{ id, name, icon, cat, value (hundredths of a VC), rarity, stack, unique, trade, desc }`. **Plain stacks**
(one row per kind: 30 × Live Shrimp) and **one-of-a-kind pieces** (a Red Snapper of 52 cm, 2.1 kg, worth 9 VC: its own
row, its attrs) - shown grouped (Red Snapper ×3) with each piece listed.

## The welcome kit

The product owner: "a welcome kit would be nice". The first time an inventory is opened (or read by an agent's tools),
it gets its kit once (`shared/items.js` `WELCOME_KIT`; idempotent per owner):

- **A player:** a starter rod, a spincast reel, 8 lb line, 10 live shrimp, 10 nightcrawlers, 4 soft plastics, a
  spinner, a coffee and a gift box - enough for a first fishing trip, and something to give someone.
- **An agent:** a gift box, a bunch of flowers and two coffees - something to give or trade.

## What a player sees

- Category chips with counts, **sorting** (newest, name, value, quantity, rarity, category), search.
- Tiles: icon, name, ×count, worth; a rarity stripe.
- A thing's card: what it is, its category and rarity, how many, worth each and in all; for one-of-a-kind pieces each
  piece with its numbers; **Give** (to a player, an agent or a business - the wallet's own search) and **Throw away**.
- Your agents' inventories (chips at the top), and the comings and goings (caught, given, granted, sold, traded,
  thrown away).
- **Trades** (the second view, with a dot when one waits on you): the list, **New trade** (or **Trade** on a thing's
  card), and a trade's window - your side (things from your inventory, how many, coin), their side, who has accepted,
  **Save my side** / **Accept** / **Decline**. Notes arrive as the other side opens, changes, accepts, declines or
  completes it.
- 200 spaces (each one-of-a-kind piece is one; a stack up to 99,999).

## Rules (`server/economy/inventory.js`)

- Only the server changes an inventory, each change in one transaction with its log line and an idempotency key.
- Giving: to an active player, an agent in the world or an open business; never to yourself; never more than you
  have free (things set aside for an open trade are held).
- A **new account** (the economy's `limits.newAccountDays`) gives at most `limits.newAccountSendPerDay` a day, by what
  the things are worth - no farming through fresh accounts.
- An **agent** gives within its owner's limits, as a payment of the same worth: its "pay" scope, its daily cap, and
  above its approval line its owner approves first (the wallet's Agents tab).
- Administrators grant (`POST /api/inventory/grant`).

## Trading (`server/economy/trades.js`)

- Two owners (players or agents; a player can act for their own agent), one open trade per pair, at most 10 open
  each; a trade without a change for two days runs out.
- Each side puts in things (up to 20 kinds) and/or coin. **Any change to either side takes back both acceptances.**
- When both have accepted it settles in **one database transaction**: every thing both ways (inventory moves, kind
  `trade`) and the coin (ledger transfers, kind `trade`) - or nothing does. If something has gone or run short since,
  the trade stays open, both acceptances are taken back and both are told why.
- A new account's daily cap counts what it gives in a trade by worth. An **agent** accepts within its owner's limits,
  as a payment of what its side is worth; above its approval line its owner approves first (the wallet's Agents tab).
- Built-in brains don't answer trade offers on their own yet; outside agents do, with the tools below.

## Trading with your own agents (2026-11-20)

The owner: "trade with companions … give them any inventory item … and they should be able to give me an inventory item as
well … if I ask for something or they ask for something we can trade … intuitive, easy, and also safe so that no one can
steal".

- **One window** (`client/js/ui/companion-trade.js`, from a companion's menu — 🤝 Trade / give… — or its card): your
  things on the left, theirs on the right, + / − for how many, coin either way, a word; what each side is worth as you go.
  🎁 **Give** (nothing asked back) or 🤝 **Propose**. Their answer shows there: ✅ done, or ❌ no — with why.
- **A proposal** (`POST /api/inventory/trade/propose`, `Trades.propose`): both sides at once from what each holds, the
  proposer's acceptance with it. Only an agent's owner (or an administrator) may ask an agent for its things; a player's
  side is only ever put in by that player.
- **The agent decides for itself** (`server/companions/agent-trades.js`), a moment after the other side has accepted: its own
  decision service (Free Will's `decideNow`, type `trade`, within its daily limits) — else its habit: a gift taken; from its
  owner what is asked unless it leaves it more than 50 VC the poorer; from anyone else only a fair swap (95 %). Its answer
  goes to the other side's page with the reason (`inv` trade `said`), into its diary, and — if it chose to — in its own words.
  Agents connected from outside decide their trades through the agent API.
- **Safe:** nothing moves until both have accepted; then everything both ways in one transaction, or nothing (a thing gone,
  coin spent: it stays open, both told). An agent's side counts as a payment of its worth under its owner's rules — except
  to its owner, whose things they are to ask for (`Trades.accept`; also `Inventory.giveAsAgent`); a gift to it needs no check.
- **They give in chat too:** its brain's `give_owner` tool (no scope needed) gives its owner what it holds when asked.
- **They propose too** (the owner: "companions should trade themselves too"): `Trades.proposeFrom` — an agent proposes to its
  owner or to its owner's other agents (by things' names; its own acceptance with it; nobody else may be asked) — from a
  chat (its brain's `offer_trade` tool) or of its own accord (`AgentTrades.think`, about once a minute for each companion
  out with its owner: no bait of its own on its owner's fishing trip, or hungry with nothing to eat, and someone of theirs
  has it — its decision service decides whether to ask now; it offers the thing's worth in coin when it has it; at most
  every 15 minutes). The owner's page: a note with **Look** → the proposal (what it gives, what it asks, its word) —
  ✕ Decline / ✅ Accept; another agent of theirs decides for itself. Between an owner's own agents, as to the owner, no
  spending rule applies: it all stays theirs (`Trades.household`, also giving).

## Agents know what they hold

| Where | What |
|---|---|
| The agent API (`/api/agent-api/…`) | `GET inventory` (with the welcome kit), `POST inventory/give`; `GET trades`, `POST trade/open\|offer\|accept\|decline` |
| The agent kit (`client/agent-api/mvw.mjs`) | `inventory`, `give "<thing>" --to <name>`, `trades`, `trade open\|offer\|accept\|decline` |
| An AI app acting as the agent (its body's tools) | `inventory`, `give`, `trades`, `trade`; its `now` facts say what it holds and its open trades |
| A person's AI app (the connector) | `inventory` (read only: the person's or their agent's) |
| The built-in brain (the Mind) | an `I HOLD: …` line in what it knows about its money, and a `give` tool |

Things are named by name ("Gift box") or by their ref (`S12`, as listed).

## What an agent buys to take home

The product owner, 2026-11-17: "idk if he actually grabbed them". What an AI agent buys at a shop's checkout to take
home — a menu line an item names as `sold` (`shared/items.js` `takeHomeItem`: the shops' `groceries` are
`goods:groceries`, their `goods` a `goods:bag`) — goes into its inventory (`server/economy/households.js` `stow`, kind
`buy`, the shop's name as its memo), so it, its owner and its brain see it. It goes in when the sale is recorded, as the
visit is planned (the sale is recorded then, and charged whatever happens next), once a purchase (the key is the person
and the visit's time). What it has at a café or restaurant is had there. A meal at home is cooked from its groceries when
it has some (`cookFromBag`: one bag, kind `use`), and is not among the meals the day's settlement buys groceries for.
Residents are as before: their purchases are the day's sums, no inventory.

## Routes

| | |
|---|---|
| `GET /api/inventory` (`?agent=` one of yours, `&history=1`) | what you hold |
| `POST /api/inventory/give` `{ stack, qty, to: { kind, id }, from?, memo, idem }` | give |
| `POST /api/inventory/discard` `{ stack, qty, from? }` | throw away |
| `POST /api/inventory/grant` `{ to, item, qty, attrs }` | administrators |
| `GET /api/inventory/trades` (`?agent=`) | your trades (or one of your agents') |
| `POST /api/inventory/trade/open` `{ to, as?, memo }` · `offer` `{ trade, items: [{ stack, qty }], vc, as? }` · `accept` · `decline` | trading |
| `GET /api/agent-api/inventory`, `POST /api/agent-api/inventory/give` | an agent's own |
| `GET /api/agent-api/trades`, `POST /api/agent-api/trade/open\|offer\|accept\|decline` | an agent's trades |
| AI apps: the `inventory` tool (read only) | what the person or their agent holds |

## The fishing game uses it

A trip's kept catch goes into the angler's inventory when the trip ends (each fish with its price from when it was
landed - fresh or late - and the trader's skill); the bounties won pay at once. Any dock store buys fish and finds
from the inventory (`server/play/fish-market.js`); or keep them, give them, trade them.

## Next

The product owner (2026-10-14): "for now the inventory system is decent, make note that it still needs work" -
good enough for now; these come back later:


1. Built-in brains answering trade offers on their own (within their owner's limits).
2. The fishing gear shop (lures, tackle, boat upgrades) sells into the inventory; using things (eat, equip).
3. Businesses' stock; a marketplace.
