# Slate architecture: the agent control plane

> Status: target design, for build. Supersedes `docs/prd.md` and the earlier AgentOS design sketch.
> Current-state documentation lives in `ARCHITECTURE.md`. This document describes where Slate is going.
> Delivery plan and task breakdown: `docs/agentos-plan.md`.

## 1. What Slate is

Slate is a control plane for work done by people and coding agents. You put work on a board. Agents pick it up, do it on machines you own, and message you when they need you.

One sentence carries the design:

**The control plane holds all the state and none of the execution.**

No workspace, no repo checkout, no model API keys, no shelling out. Those live on **runners**, which are `slate` CLI daemons on machines you control: your laptop, a VM, a container that exists for ninety seconds.

Three things follow.

1. **Bring your own agents.** Claude Code, Codex, or anything that reads a prompt and exits. Swapping runtimes never touches the control plane.
2. **No inference cost in the control plane.** You pay for your own tokens on your own subscription.
3. **Sandboxing is a deployment choice, not a feature.** Want isolation? Run the runner in a container. The control plane does not know and does not care.

### The product is two parts

| | |
| --- | --- |
| **Control plane** | The hosted SaaS at slate.do. You sign up, configure agents, see the board, assign work, answer questions, review output. |
| **Runner** | The `slate` CLI, installed separately on your own machine. It polls the control plane, executes work, reports back. |

You never install anything to start. The control plane is a working task manager on its own.

### Constraint: useful with zero runners

**Slate must be fully usable by a person who never installs the CLI.** No empty state demands a daemon. No core flow is gated behind execution. Agents are an upgrade to a task, not a precondition for the product.

This is a hard design constraint, not an aspiration. It sets the free tier, removes the activation cliff, and keeps the board honest.

## 2. Complexity budget

An explicit budget, because "keep it simple" is not actionable.

- **Six navigation items.** Board, Inbox, Runs, Agents, Runners, Settings. Adding a seventh requires deleting one.
- **Four primitives.** Task, Agent, Runner, Run. Everything else is a field on one of them.
- **No new object where a field will do.** Templates, automations, goals, and triggers are all tasks with different fields.
- **No interface with one implementation**, except `Adapter`, which exists precisely to have several.
- **Two background loops.** The lease reaper and the schedule ticker. Nothing else.

If a feature cannot fit the budget it goes in section 16 and stays there.

## 3. The model

Four primitives.

| | |
| --- | --- |
| **Task** | A unit of work. Title, description, status, assignee, agent. |
| **Agent** | Config. Instructions, a backend, a workspace. Stateless. *What* to do. |
| **Runner** | A registered `slate` daemon on a machine. *Where* it can happen. |
| **Run** | One execution attempt: task x agent x runner. Holds the session, event log, and result. |

Plus one channel:

| | |
| --- | --- |
| **Message** | The inbox. A run writes to it, you reply, the run resumes. Stored in the existing `card_entries` table. |

### Task, not card

The unit is a task. The generic-card framing from `docs/prd.md` ("a card can be a task, goal, project, idea, decision") is note-taking language and it works against a control plane where the unit is a thing that dispatches. The `/api/v1/cards` aliases are retired.

### Description, not prompt

The field is `description`. A task may be done by a person or by an agent, so the field name stays neutral. The UI labels it "Description" and notes that an assigned agent receives it as its instruction. Internally the envelope treats it as the task prompt.

### Assignee and agent are separate

A task can have a human assignee, an agent, or both. This is what keeps section 1's zero-runner constraint honest, and it is how a person hands work to an agent and takes it back.

### Parents and children, one level deep

A parent is never also a child, enforced by a check constraint. Arbitrary depth buys recursive queries, recursive rollup, and a tree UI, in exchange for very little.

Two rules:

- **A parent may have its own description.** That is how decomposition happens: a decomposer agent runs on the parent and creates children. Its run succeeding is not the same as the parent being done.
- **A parent cannot reach `done` while any child is open.** A guard, not a rollup. One `WHERE NOT EXISTS`.

### No goals

A goal is a parent task whose completion test is a checklist. That is a `completion` enum case and a side table on the day it matters, not an object. Not in scope.

### No dependencies

`task_deps` is cut. Nobody hand-builds a dependency graph in a picker. Ordered subtasks under a parent cover the real case, and a `sequential` flag on the parent covers ordering if it is ever needed. Dependencies, if they return, arrive with templates where ordered children are already expressed.

### Approvals

There is no approval subsystem. `requires_approval` on a task means a successful run terminates at `review` and only a person can move it to `done`. It is the trust dial and it is visible on the task detail, not buried.

### Why task and run are separate

A task is what you want. A run is one attempt at it. Splitting them is the most load-bearing decision here: retry, resume, backend swapping, park and resume, and per-agent metrics all fall out for free instead of each needing its own mechanism. Systems that conflate the two end up with a `retry_count` column and a lot of regret.

Today Slate has neither: a run is client-side JSON in `cli/cmd/slate/registry.go` and the server holds a bare `execution_run_id`. Fixing this is the first structural change.

## 4. Schedules and templates

Every task has a `schedule`, defaulting to **Run once**. That single field replaces three objects other tools ship separately: templates, automations, and triggers.

A task with a recurring schedule is a **definition**. It does not sit on the board and it never runs itself. When its cron fires, the control plane **spawns a copy**: the task and its subtasks are deep-copied into a new task tree in Todo, with `spawned_from_task_id` set.

**Spawn, do not re-run in place.** A card that resets from Done back to Todo every Monday breaks the board: Done stops being terminal and last week's outputs are overwritten. Each occurrence gets its own card, subtasks, run history, and review.

Three ways to spawn, one code path:

- The cron fires.
- You click Run now.
- Later, a webhook hits it. (Not in scope.)

The task detail states this plainly rather than silently moving the card: "Repeats every Monday. Each occurrence creates a new task." The definition lists its recent occurrences underneath, so it doubles as its own history.

**Worked example.** A definition titled "Weekly LinkedIn posts" with seven subtasks, assigned to a writer agent, scheduled every Monday. Monday morning a parent and seven children appear in Todo. The agent works through them. Seven outputs land in Review. The definition is untouched and ready for next week.

The looser variant is one task whose description says "write seven posts, create a subtask per post" and a decomposer agent creating the children. Both work on the same mechanism. The deterministic version ships first because it needs no new agent behaviour.

Two small decisions:

- **Overlap.** Default to spawning even if the previous occurrence is still open. A `skip_if_open` flag arrives the first time that hurts.
- **The scheduler is a second background loop.** One query a minute for `next_run_at <= now()`. Stated rather than hidden.

A cron on a laptop does not fire when the laptop is asleep. The control plane is always up, so it queues Monday's work whether or not any runner is online. This is a concrete reason the hosted product beats a local script, and it holds with zero runners installed.

## 5. Shape

```
+------------------------------------------+
|  Control plane          slate.do (SaaS)  |
|                                          |
|  tasks - runs - agents - messages        |
|  attachments - envelope - UI - API       |
|  PostgreSQL                              |
|                                          |
|  no code - no repos - no model keys      |
+---------------+--------------------------+
                |  HTTPS, runner polls outward
                |  no inbound ports, works behind NAT
+---------------+--------------------------+
|  Runner              slate runner start  |
|                                          |
|  adapters - git worktrees - secrets      |
|  model credentials - the actual work     |
+---------------+--------------------------+
                | spawns, with a scoped run token in env
         +------+---------+
         | claude / codex | --> calls back via the slate CLI
         +----------------+
```

The control plane is hosted. The runner is a download. They are separate installs on purpose: the SaaS is the product you sign up for, the CLI is the thing you install when you want execution.

## 6. Trust

Four credentials, four scopes. The first two exist today.

| Credential | Held by | Can do |
| --- | --- | --- |
| Session | A person in a browser | Everything in their account |
| API token | A person at a terminal | Everything in their account |
| Runner token | The runner daemon | Poll for jobs, lease, heartbeat, post events and results |
| Run token | The agent process | Read and update **one task**, post to its inbox, attach files. Dies with the run. |

The agent process never sees the runner token, so a compromised agent cannot pull other work. A leaked run token has a blast radius of one task and a lifetime of one run.

All tokens are stored as SHA-256 hashes. Plaintext is returned once, at creation. This pattern already exists in `auth` and is reused rather than rebuilt.

### Teams need no new schema

Runners and agents are account-scoped, exactly like tasks. There are no owner fields and no per-user runner pools. Whether a machine is one person's laptop or a shared VM is a deployment fact the control plane never learns, which is the whole point of section 1.

One consequence is documentation, not schema:

**The runner is the trust boundary.** Registering a machine to an account means anyone in that account can cause code to run on that machine with its credentials and its repo access. That sentence belongs in the runner setup docs. Nothing else about teams needs modelling.

Runner labels and match rules arrive if a customer ever needs one member's work kept off a specific machine. Not before.

## 7. Agents

An agent is a config row. It is stateless: no credentials, no workspace, no history.

A run snapshots the config that produced it into `runs.agent_snapshot`, so "which instructions made this?" survives editing the agent afterwards. One column, not a version table.

The schema is a portable core plus a quarantined escape hatch. **If a field cannot be honoured by every backend, it does not belong in the core.**

```
name              Spec Agent          unique per account; this is the identifier
description       Turns a fuzzy feature description into a written spec.

instructions      the system prompt

workspace         app                 a name, not a path; optional
limits            max_wall_clock      optional, unset by default

backend           claude-code         optional; else any runner that has one

backend_overrides
  claude-code:    model: claude-opus-5, permission_mode: acceptEdits
  codex:          model: gpt-5-codex,  sandbox: workspace-write
```

`backend_overrides` is the pressure valve. Without it, backend flags smuggle themselves into the core within a month.

Agents are the reusable asset. They are text, they diff, and one person sets them up once for a whole team. That makes them a much better shared object than a shared machine.

### Deliberately absent

- **No slug.** `name` is unique and is the identifier.
- **No model role.** `backend_overrides` already names the model per backend.
- **No tools policy.** A `net: limited` field promises enforcement nothing implements, and it contradicts section 1. Restrict an agent by running its runner in a container.
- **No skills.** A skill is text. Put it in `instructions` until reuse across agents is demonstrated.
- **No knowledge base.** That is a retrieval product, not this one.
- **No env allowlist on the agent.** See section 11: the job payload carries names, the runner resolves values.

## 8. The envelope

A task description is never sent to an agent raw. The control plane wraps it. That wrapper is the **envelope**, in five layers:

1. **Preamble.** What Slate is. The `slate` commands available. How to report progress, ask a question, attach output, finish, and signal blocked. Includes the exit-75 contract.
2. **Agent instructions.** The agent's system prompt.
3. **Context.** Task metadata, parent task, attachment paths, workspace path, and prior run summaries when this is a resume.
4. **Task description.** What the person actually wrote.
5. **Completion contract.** What done means here, and whether it needs approval.

**The control plane assembles the envelope. The runner does not.** The envelope is product behaviour and it will be tuned constantly. If runners built it, every tweak would mean redeploying every machine. Runners receive a finished string plus backend flags and stay dumb.

This also absorbs the boilerplate that otherwise rots inside user-written prompts. Instructions like "read the attachments on the parent task" and "remember to attach your output" belong in the preamble once, not copy-pasted into every task. **If the same sentence appears in three task descriptions, it belongs in the envelope.**

Today prompt assembly happens client-side in `cli/cmd/slate/prompt.go`. It moves server-side.

## 9. The agent's interface is the CLI

The runner injects three variables into the child process:

```
SLATE_URL=https://slate.do
SLATE_RUN_TOKEN=slate_run_...
SLATE_TASK_ID=...
```

The agent then has a surface scoped to one task:

```
slate task show                     # its own task, attachments, parent
slate task comment "..."            # progress note
slate task done                     # success
slate task block --reason "..."     # cannot continue

slate inbox send "..."              # fire and forget
slate inbox ask "..." [--option a --option b] [--wait 10m]

slate file put|list                 # attachments on its own task
```

`--json` everywhere, so agents parse rather than scrape.

**No MCP inside the run.** Every runtime that can run a shell can use a CLI, and the wiring does not differ per backend. You can run the same commands by hand while debugging, which matters more than it sounds.

A hosted MCP endpoint is a separate, later idea: a distribution channel that lets someone point an existing agent at the board with one line of config. It wraps the same API. It is not how a run talks to Slate.

## 10. Asking a question without burning six hours of tokens

The hardest problem in the system. An agent asks at 2pm; you reply after the gym at 6pm. Holding a process and a context window open for four hours is unacceptable.

`slate inbox ask` takes a wait budget:

- **Reply lands inside `--wait`.** The command prints the answer and the agent carries on.
- **Budget expires.** The command prints `parked` and exits **75**. The preamble tells the agent: exit 75 means stop cleanly and exit, you will be resumed.

The run parks. The process dies. Nothing burns overnight. Your reply in the UI creates a **new** run with `resume_from_run_id` set, and the envelope prepends the question and your answer.

This is why resume is in the runner contract from day one rather than bolted on later. `claude --resume` and the Codex equivalent both support session resume. A backend that cannot resume degrades to a fresh session with a transcript summary.

This is the single most differentiated behaviour in the product. Trello cannot do it. Linear cannot do it. Hosted agent platforms do it by keeping a session alive and billing for it.

## 11. Runner protocol

Runners poll outward over HTTPS. No inbound ports, works behind NAT, survives a flaky network without reconnect logic.

```
POST   /api/v1/runners/register            -> runner_id, runner_token
GET    /api/v1/runners/{id}/jobs?wait=30s    long-poll: 200 job | 204 nothing
POST   /api/v1/runners/{id}/heartbeat        renews every lease it holds
POST   /api/v1/runners/{id}/deregister

POST   /api/v1/runs/{id}/events              batched, monotonic seq
POST   /api/v1/runs/{id}/result              terminal status, branch
```

### Registration

```json
{
  "name": "hetzner-1",
  "backends": ["claude-code@2.1", "codex@0.4"],
  "workspaces": ["app", "slate"],
  "concurrency": 2,
  "os": "linux",
  "arch": "amd64"
}
```

### Leases, not claims

`boards.AgentClaim` today is permanent. If the machine dies mid-task, the task sits in `running` until a human notices. Survivable when you are watching, fatal when the point is unattended overnight work.

Instead the control plane grants a **lease** with a 60 second TTL. The runner heartbeats every 15 seconds and renews everything it holds. An expired lease requeues the task and increments `attempts`.

A sleeping laptop, a rebooted VM, and a preempted spot container all self-heal.

**Build leases before anything else in the runner.** Everything unattended depends on them, and ephemeral runners are impossible without them.

### Matching

A queued task goes to any idle runner in the account that has the required backend **and** the required workspace. Those are the two constraints that produce a broken run rather than a slow one.

`tasks.target_runner` optionally pins a task to one runner by name.

No labels and no fallback policy. Fallback needs a timer, a re-dispatch path, and a notice, which is a lot of machinery for a two-runner setup where naming one is enough.

### Job payload

```json
{
  "run_id": "...",
  "task_id": "...",
  "run_token": "slate_run_...",
  "envelope": "<the full assembled prompt>",
  "backend": "claude-code",
  "backend_args": { "model": "claude-opus-5", "permission_mode": "acceptEdits" },
  "workspace": "app",
  "attachments": [ { "id": "...", "name": "spec.md", "sha256": "..." } ],
  "env": ["GITHUB_PAT_APP"],
  "limits": { "max_wall_clock": null },
  "resume_from": { "session_id": "..." }
}
```

`env` carries **names, not values**. The runner resolves them from its own environment or keyring. The control plane never holds a model key or a deploy credential, which keeps section 1's promise honest and removes the largest category of secret-handling code from the server. On a shared runner this also stops every task receiving every credential the machine holds.

### Workspaces belong to the runner

The control plane never learns where a repository lives and never holds a credential to fetch one.

A runner declares its workspaces in `~/.config/slate/runner.json`:

```json
{
  "url": "https://slate.do",
  "name": "laptop",
  "workspaces": {
    "app":   "/Users/owain/code/app",
    "slate": "/Users/owain/code/slate.do"
  }
}
```

and advertises those names at registration. A task names a workspace; the runner resolves the name to a path.

The token comes from `SLATE_RUNNER_TOKEN` and never appears in the file. `--workspace name=path` is shorthand for a single-project setup.

**The runner's working directory is irrelevant.** Paths are absolute and come from config, so the daemon starts from anywhere. This is a deliberate difference from today's watcher, which defaults to the current directory and must be started inside the repository it works on.

**Adding a project needs no restart.** The runner re-reads the config each poll cycle and re-registers when the workspace list changes.

Workspaces are never discovered by scanning for git repositories. That would be convenient and would mean a task can land on a repository you forgot you had.

A path in the control plane would be wrong the moment there are two machines. A repo URL plus a credential would be worse, because the control plane would then hold a GitHub token.

| Runner | How the repo gets there |
| --- | --- |
| Laptop | It is already there |
| Long-lived VM | `git clone` once during setup |
| Ephemeral container | The image or entrypoint clones it, using its own credentials |

Workspace is optional. A research or writing agent gets a scratch directory.

### Adapters live in the runner

The runner binary owns every piece of per-tool knowledge: how to invoke each CLI, how each one resumes a session, how to parse its event stream, how to kill a whole process tree.

```go
type Adapter interface {
    Start(ctx context.Context, job Job, ws Workspace) (Handle, error)
    Events(h Handle) <-chan Event
    Cancel(h Handle) error
}
```

The adapter knows nothing about approval, scheduling, or definitions of done. Adding a backend never touches the control plane. This is the only interface in the codebase that exists before it has two implementations, and it earns that by having two at launch.

### Workspace isolation

Per run: a fresh git worktree cut from the named workspace at its current HEAD, pinned at dispatch, in the runner's cache directory. Never the checkout itself. Kill by process group so nothing survives a cancel. Retain worktrees after a run so the diff is readable, with a cap. Refuse to start when the source checkout is dirty.

This already exists and works in `cli/cmd/slate/watch.go`. It is ported, not rewritten.

### Ephemeral mode

```
slate runner start --once --ephemeral
```

Register, take exactly one job, deregister, exit. That is a Cloud Run job, a Fly machine, or a spot VM. A small flag on top of leases, and worthless without them.

## 12. State machines

**Task:** `draft` -> `queued` -> `running` -> `review` -> `done`, plus `blocked` and `cancelled`.

Board columns: Todo (`draft`, `queued`), Doing (`running`, `blocked`), Review, Done.

**Run:** `leased` -> `running` -> one of `succeeded`, `failed`, `parked`, `expired`, `cancelled`.

| Event | Run | Task |
| --- | --- | --- |
| Queued task matches a runner | created, `leased` | `running` |
| Runner spawns the process | `running` | `running` |
| `slate task done` | `succeeded` | `review`, or `done` when approval is not required |
| `slate task block` | `failed` | `blocked` |
| `inbox ask` exceeds its wait | `parked` | `blocked`, awaiting reply |
| A person replies | new run, `resume_from_run_id` set | `running` |
| Lease expires, machine died | `expired` | back to `queued`, `attempts` + 1 |
| `attempts` exceeds max | | `blocked` |

Two guards sit on the move into `done`, both in one function:

- `requires_approval` means only a person can make that move.
- A parent cannot make it while any child is open.

Keep that function single-purpose even though it has two branches today.

**One run per task at a time.** A partial unique index enforces it, not a convention.

## 13. Files

A run happens in a throwaway workspace. When the container exits, everything in it is gone. So the control plane has to be where files live.

Same requirement as the inbox, different shape: **anything worth keeping has to leave the runner before the runner dies.**

### One concept: attachments

An attachment is a file bound to a task. That covers both directions.

- **Inputs.** A person attaches a screenshot or a draft when creating the task.
- **Outputs.** The agent writes a spec, plan, or report and pushes it up.

No separate artifact type. The only difference is which `run_id` produced it, and that is a nullable column.

### Down: materialised before the run

The runner downloads the task's attachments into the workspace before starting the agent:

```
<workspace>/.slate/attachments/<name>
```

The envelope lists them by path, so the agent reads them as ordinary files and never needs a command to fetch its own inputs.

Child tasks also see their parent's attachments. That is what makes a pipeline work: the spec task writes `spec.md` and its sibling plan task can read it, without introducing a global filesystem.

### Up: explicit, never automatic

```
slate file put report.md
slate file put spec.md --name spec
slate file list
slate file get spec.md -o ./spec.md
```

**Never sync the workspace up automatically.** A checkout contains `.git` and `node_modules`. The agent says what is worth keeping, which is also the more useful signal.

### Storage

Content goes in Postgres on the attachment row, capped at 10 MB per file, counted against the existing account storage quota. Object storage is a later swap. Since the hosted product exists on day one, the write and read paths are concrete functions behind a narrow seam, so moving to GCS is a contained change.

`sha256` stays on the row for integrity, not for sharing storage. No content-addressed blob table and no dedupe: reference counting is where the bugs live.

## 14. Navigation and views

Six items. Adding a seventh means deleting one.

| | |
| --- | --- |
| **Board** | Columns are status: Todo, Doing, Review, Done. Lists are a scope filter in the sidebar. |
| **Inbox** | Unanswered questions and notices, account-wide, newest first. The unread count is the one number in the nav. |
| **Runs** | Run history and the live session view. |
| **Agents** | Config. Instructions, backend, workspace, overrides. |
| **Runners** | Registered machines, backends, workspaces, heartbeat health. |
| **Settings** | Account, tokens, members. |

A runner status indicator is pinned in the sidebar footer. A green dot and "Runner running" answers "is my execution layer alive" from every screen without a dashboard.

### Deleted

Week, Table, Today, and Board-grouped-by-list all go. Six views over one dataset is a task manager's surface area and it is what makes the product read as a Trello variant. Flow, grouped by status, becomes the only board.

`scheduled_date` and `priority` stay as fields and filters. Deleting the data would be the expensive mistake; Week returns as one view file if it earns it.

### Lists

A list is a human focus grouping with no operational meaning. It is a `WHERE` clause and a sidebar entry. It is not the same thing as a workspace, which is a name a runner resolves to a path, so the two stay separate fields.

Build the list filter as a scope parameter carried in the URL, not a checkbox. If lists earn their place, a top-level project switcher is then an upgrade rather than a rewrite.

### Task detail

Order: **Details, Description, Attachments, Subtasks.** Inputs, instruction, files, decomposition.

Details is five fields and no more: Agent, Assignee, Workspace, Schedule, Requires approval. Status and list live in the header. Description is the body of the page, inline-editable, full width.

## 15. Dashboard

A read model over `runs`, `messages`, and `runners`. No new tables, no counters, no aggregation jobs.

### There is no cost tracking

The control plane pays for no inference and runners are on flat-rate subscriptions, so there is no per-token bill to cap. A dollar figure would need a price table per model, and price tables rot.

`turns`, `tokens_in`, and `tokens_out` are recorded as observations when an adapter reports them, because parsing the event stream makes counting free. Nothing enforces them and an adapter that cannot report them leaves them null.

### Limits are a backstop, not a budget

There is no `max_turns`. A turn cap truncates work mid-flight and nobody can pick the right number for a task they have not seen.

`max_wall_clock` exists and is unset by default. That leaves cancellation and visibility as the real safety net:

- `slate runs cancel` kills the process group through the runner.
- Elapsed time is visible, so a six-hour run is obvious without anyone having predicted it.

### The two metrics that matter

Per agent, over a window:

| Metric | From |
| --- | --- |
| Runs started, succeeded, failed, parked, expired | `runs.status` |
| Success rate | ditto |
| Median wall clock | `runs.started_at`, `ended_at` |
| Retries per completed task | `runs` grouped by `task_id` |
| **Questions asked per run** | `messages` where kind is question |
| **Time parked waiting on a human** | `messages.created_at` to `answered_at` |

**The scarce resource is attention, not money.** An agent that finishes every task but interrupts you four times is worse than a slower one that never does. Questions per run tells you which agents you can trust unattended, which is the entire promise.

Time parked separates agent slowness from your slowness. A five-hour run that spent four hours waiting on an unanswered question is a fact about you.

## 16. Scope

**In:** board, inbox, agents, runners, runs, attachments, one level of subtasks, approval gates, schedules and spawned occurrences, two backends, the dashboard.

**Out, deliberately:** goals and checklists, task dependencies, webhook triggers, cost and dollar accounting, skills, knowledge bases, third-party connections, MCP inside the run, self-host mode, mobile push.

Every one is accommodated by this schema and none belongs in the first version.

### Self-host, later

The repo eventually ships a stripped single-binary build for the course audience, behind `SLATE_MODE=selfhost`: entitlements unlimited, rate limits no-op, invite gating off, secrets from environment. **Make these optional, never delete them.** The hosted product needs every one.

Postgres stays. `boards/store.go` alone is 2,638 lines of pgx, and retrofitting a second dialect buys a technical audience nothing they cannot get from a container.

## 17. Open questions

1. **Live view transport.** Polling `GET /runs/{id}/events?after={seq}` is simplest. Server-sent events are nicer to watch. Decide when the run view is built, not before.
2. **Attachment naming collisions.** Two runs on the same task both push `report.md`. Version, suffix, or overwrite. Overwrite is simplest and probably wrong.
3. **Existing run ids.** `tasks.execution_run_id` currently points at client-generated ids with no server row. Accepting that pre-pivot runs have no record is the cheap answer and probably the right one.
4. **Metric windows.** Computed on read until a query gets slow. Decide then.
