# v1.0.32 — Live Agent Resident Autonomy and Unified Controls

Released: July 19, 2026

This release completes the resident autonomy foundation for Live Agent Mode, adds native OpenClaw embodiment tools, and replaces the confusing duplicate Live Mode controls with one global activation switch and synchronized per-agent controls.

## Highlights

- Added recurrent lived sessions that continuously observe, decide, act, verify, learn, and choose a follow-up while Live Agent Mode owns a resident.
- Added disposable, fully bootstrapped OpenClaw turns so residents retain their configured agent identity, instructions, skills, and Resident Profile while My Virtual World remains authoritative for body state and world memory.
- Added the `@my-virtual-world/openclaw-virtual-world` plugin with activation-bound tools for observation, affordances, actions, inspection, cancellation, waiting, memory, commitments, and speech.
- Added durable goals, resumable checkpoints, bounded working memory, relationship memory, lived-experience tracking, reflection, action awareness, and verified carried-item follow-ups.
- Added user-attention handling for conversation, stop, redirect, and resume without silently returning the resident to Default Mode.

## Live Agent Mode controls

- Removed the duplicate Live Agent Mode option from the general Features settings and setup wizard.
- Made the Live Agent Mode page toggle the single global availability switch.
- Replaced the global checkbox with an On/Off toggle and added an experimental inference-usage warning with Apply and Cancel actions.
- Kept per-agent eligibility controls in both Live Agent settings and the agent editor.
- Made both per-agent controls write the same authoritative server setting immediately and synchronize across both locations.
- Enabling a resident starts its autonomous controller immediately when global Live Agent Mode is active; disabling it stops the controller.
- Corrected inconsistent “Agent Live Mode” labels to “Live Agent Mode.”

## Reliability and safety

- Enforced one behavior owner per resident across direct user control, Live autonomy, Default Mode, and idle states.
- Added activation and world-claim fencing, signed host/container bridge requests, replay protection, delayed-reply fencing, and safe handoff between Live and Default modes.
- Added bounded prompt construction, transport-failure classification, exponential inference circuit breaking, and explicit wait states instead of deterministic fallback behavior.
- Improved restart recovery, route and action verification, journal catch-up, realtime hydration, stale connection reporting, storage compaction, and atomic state persistence.
- Added configurable prompt and circuit-breaker limits to `.env.example`, Docker Compose, and the configuration guide.

## Verification

- Root public smoke suite passed, including product files, syntax, packaging, Docker hygiene, and secret scanning.
- OpenClaw plugin TypeScript build and plugin validation passed.
- Supplemental syntax checks passed for eight Python files and five JavaScript modules.
- Live Agent autonomy passed 227/227 isolated checks.
- Recurrent lived sessions passed 48/48 isolated checks.
- Bounded storage and atomic persistence passed 35/35 isolated checks.
- Endurance, realtime, chat-session, collision-guard, and layer-separation coverage was expanded for the new runtime behavior.

Live Agent Mode remains highly experimental. Autonomous decisions and interactions consume inference from the model configured for each resident, including subscription or API-billed resources.
