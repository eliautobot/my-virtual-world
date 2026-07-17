# Live Agent Mode Durable Goals

Status: product reference  
Scope: persistent autonomy goals, ordered tasks, executable steps, retries, verification, and replanning

## Purpose

The durable goal ledger turns a planner response into restart-safe work. A resident owns one active goal and a bounded history of prior goals. Each goal contains ordered tasks; each task contains ordered steps. Tasks and steps may name explicit dependencies by stable id.

The ledger is orchestration state only. It does not bypass world-action validation, object reservations, visible executors, feature gates, or operator controls.

## Storage

The ledger is stored in `world-meta.json`:

```text
agentLife.liveModeLoop.agents.<agent-id>
  goalLedgerSchemaVersion
  activeGoal
  durableGoals[]
```

Schemas:

- `agent-live-mode-goal-ledger/v1`
- `agent-live-mode-durable-goal/v1`
- `agent-live-mode-durable-task/v1`
- `agent-live-mode-durable-step/v1`

Stable goal, task, and step ids let a later planner revision preserve verified work. The server merges terminal outcomes ahead of stale active copies when concurrent saves overlap.

## Lifecycle

Goal statuses:

- `pending`, `active`, `paused`, `blocked`
- `completed`, `failed`, `cancelled`, `superseded`

Task and step statuses:

- `pending`, `ready`, `active`, `retry_wait`, `blocked`
- `completed`, `failed`, `cancelled`, `skipped`

A step becomes ready only after its dependencies are verified complete or explicitly skipped. A task completes only when its steps settle successfully. A goal completes only when all completed tasks have verified outcomes.

## Execution and Verification

The current goal/task/step ids are copied into the validated world action parameters and its short execution plan. When the action settles, server-side verification records evidence against that exact step.

- Verified success completes the step and unlocks dependents.
- Failed verification increments the attempt count and enters `retry_wait` while retries remain.
- Exhausted retries block the goal and set `replanRequired`.
- Action-request failures use the same bounded retry path.

Retries default to two and can be set per step with `maxRetries` and `retryDelaySec`. A retry never changes an already verified step.

## Replanning

The loop fingerprints its current action affordances. If the current action disappears or its selected target changes, the unfinished step is blocked and the goal requests an immediate planner turn. A replacement action increments the goal revision, clears the blocked state, and preserves verified steps and task outcomes.

Planner-facing object action types are normalized to the durable affordance
vocabulary before they enter the ledger. For example,
`life.restAtArmchair` is stored as `use-seating-object`, and the unfinished
goal step keeps the seating category active after a server restart. A repair
turn may attach a replacement action to the blocked step only when that turn
explicitly selected the action or its supported object category. An unrelated
support tool cannot inherit an embodied step's goal ids or verify its physical
success criteria.

Critical body needs can interrupt execution without overwriting the current durable step. The selected action is linked to the goal only when it matches the assigned step or an authorized replan.

## Restart and Operator Behavior

- Normal server/container restarts reload the ledger from the persistent world volume.
- Disabling Live Mode pauses the active durable goal and cancels transient execution.
- Re-enabling Live Mode resumes the goal that was paused by the disable operation.
- The selected-agent reset intentionally clears that resident's durable goal ledger while preserving its Resident Profile, assignments, buildings, objects, and provider workspace.

API:

```text
GET  /api/agent/<agent-id>/goals
POST /api/agent/<agent-id>/goals
```

POST operations are `create`, `upsert`, `activate`, `resume`, `pause`, `cancel`, `replan`, and `retry`. Terminal goals cannot be reactivated; create a new goal instead.

Example:

```json
{
  "operation": "create",
  "goal": {
    "id": "goal-prepare-for-work",
    "title": "Prepare for work with verified outcomes",
    "successCriteria": ["hydration and arrival are verified"],
    "tasks": [
      {
        "id": "task-hydrate",
        "title": "Hydrate",
        "steps": [
          {
            "id": "step-water",
            "title": "Use a reachable water source",
            "loopActionId": "hydrate-water-cooler",
            "successCriteria": ["world action completes with embodied evidence"],
            "maxRetries": 2
          }
        ]
      },
      {
        "id": "task-go-to-work",
        "title": "Go to the assigned workplace",
        "dependsOn": ["task-hydrate"],
        "steps": [
          {
            "id": "step-arrive-work",
            "title": "Travel to work",
            "dependsOn": []
          }
        ]
      }
    ]
  }
}
```
