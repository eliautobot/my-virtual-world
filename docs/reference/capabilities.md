# Capabilities

Generated from the code by `tools/gen-reference-docs.mjs` — do not edit by hand. Proprietary — see [LICENSE](../../LICENSE).

Roles, low to high: guest, member, admin, owner. *Fixed*: the owner cannot change its lowest role. *Identity*: needs a signed-in account.

| Capability | Lowest role | Fixed | Identity | What it allows |
|---|---|---|---|---|
| `public` | guest | yes |  | Server health and the current sign-in |
| `auth.signin` | guest | yes |  | Sign in |
| `auth.register` | guest | yes |  | Create an account from an invite, or when open self-registration is on |
| `world.view` | guest |  |  | Watch the world: residents, buildings, and which agents are working |
| `world.interact` | member |  | yes | Talk to residents |
| `world.edit` | admin |  | yes | Edit buildings, interiors and residents, and direct residents |
| `world.clock` | admin |  | yes | Change the world clock and its speed |
| `world.backup` | admin |  | yes | Download a backup of the world: buildings, roads, the land, residents |
| `world.manage` | admin |  | yes | Restore a world backup or reset the residents (the server restarts to load it) |
| `promo.manage` | admin |  | yes | Set up the promotional aircraft: banners, blimps and balloons, their pictures and hours |
| `property.hold` | member |  | yes | Act on your own lots: merge up to 4, split back, who may enter, share rights |
| `property.admin` | admin |  | yes | Administer property: transfer lots, zoning, custodial holds, property checks |
| `economy.use` | member |  | yes | Use a Virtual Coin wallet: pay and ask to be paid, buy at venues, run your businesses, set your agents' spending limits |
| `economy.admin` | admin |  | yes | Run the economy: switch it on, its policy (wages, prices, taxes, benefits), grants and corrections, freezing wallets, bonds |
| `world.revert` | admin |  | yes | Revert anyone's world edit from the activity log |
| `activity.read` | member |  |  | Read the activity log: world edits, residents arriving, agents starting and stopping work, players joining and leaving |
| `agents.view_tasks` | owner |  | yes | See what agents are working on (task text) |
| `agents.manage` | admin |  | yes | Add agents (the owner may let members add their own: the permissions table); each agent is changed and removed by its owner or an account it is shared with to manage |
| `chat.use` | member |  | yes | Chat with agents |
| `players.move` | member |  | yes | Have a player in the shared world and walk it |
| `players.chat` | member |  | yes | Chat with players nearby (proximity chat) |
| `players.online` | member |  | yes | See who is online, their status and where they are |
| `players.friends` | member |  | yes | Add friends and answer friend requests |
| `players.warp` | admin |  | yes | Put the own player anywhere in the world (testing, helping someone in person) |
| `players.see_invisible` | admin |  | yes | See the real status of players who appear offline |
| `players.spawn` | admin |  | yes | Set where new players appear (the spawn point) |
| `play.use` | member |  | yes | Play the modules (minigames such as the airport's ring courses), earn levels and badges, see players' profiles |
| `connections.use` | member |  | yes | Use connected agent providers |
| `agents.connect` | member |  | yes | Connect your own agents: keys, who sees them, who may chat with them |
| `agents.freewill` | member |  | yes | Give your own agents Free Will: a decision service chooses what they do with their free time |
| `agents.profile` | member |  | yes | Your own agents' character, goals, plans and memories, the people they know and what they did |
| `agents.mind` | member |  | yes | Your own agents' Mind: whether they plan and reflect each day, and what their thoughts cost |
| `agents.phone` | member |  | yes | Your own agents' phones: give one a Twilio number, its texts, calls, voicemail and contacts (docs/features/phone.md) |
| `agents.pc` | member |  | yes | Your own agents' PC: their files, teams, task boards, calendars, browser and what they do on it (docs/features/agent-pc.md). Never another account's |
| `freewill.admin` | admin |  | yes | Run Free Will and the Mind: switch them on or off, choose the installation's decision service and brain, set limits, see their costs |
| `connections.manage` | admin |  | yes | Add installation-wide and host-process connections, and share them (members add their own remote ones with connections.use) |
| `account.session` | member | yes | yes | Sign out, and confirm the password |
| `account.password` | member | yes | yes | Change the own password |
| `account.self` | member | yes | yes | Account settings: display name and devices |
| `account.twofa` | member | yes | yes | Set up and manage the own two-factor sign-in |
| `account.data` | member | yes | yes | Download the own data and delete the own account |
| `users.manage` | admin |  | yes | List and manage accounts (always below the own role) |
| `invites.manage` | admin |  | yes | Create, list and revoke invites (always below the own role) |
| `owner.transfer` | owner | yes | yes | Hand ownership to an admin |
| `roles.assign` | admin |  | yes | Change roles (always below the own role) |
| `audit.read` | admin |  | yes | Read the audit log |
| `settings.world` | admin |  | yes | World settings: require sign-in to watch, open self-registration |
| `licence.manage` | owner | yes | yes | Activate, import or deactivate the licence key |
| `settings.security` | admin |  | yes | Require two-factor sign-in for admins and the owner |
| `settings.view` | admin |  | yes | See the installation settings; each setting names who may change it (DECISIONS C90) |
| `settings.secrets` | admin |  | yes | Installation-wide secrets, such as shared connection tokens and speech keys (A17) |
| `audit.retention` | owner | yes | yes | Set how long the audit log keeps events |
| `activity.retention` | owner | yes | yes | Set how long the activity log keeps world edits, and so how far back they can be reverted |
| `settings.infrastructure` | owner |  | yes | Server and infrastructure settings |
| `server.diagnostics` | admin |  | yes | Server diagnostics: connected clients, performance counters, error messages, account status |
| `permissions.manage` | owner | yes | yes | Change the minimum role of capabilities |
| `moderation.mute` | admin |  | yes | Mute other users |
| `moderation.kick` | admin |  | yes | Remove other users from the world |
