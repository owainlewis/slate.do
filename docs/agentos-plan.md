# Slate: the agent control plane delivery plan

> Status: plan, for build. Verified against the working tree on 2026-08-16 (`3bbad4e`).
> Target design: `docs/agentos-architecture.md`. Current state: `ARCHITECTURE.md`.

## 1. Decision

Slate keeps its code, its auth, its CLI, its tests, and its deploy pipeline. It changes direction.

Slate today is a task manager for humans with agent execution bolted on. It competes with Linear and Things and has a thin wedge. Slate after this plan is a control plane for agent work where the customer brings their own compute and their own model billing.

The product becomes two parts: a hosted control plane you sign up for, and a `slate` CLI runner you install separately. The control plane must stay fully useful to someone who never installs the runner.

## 2. What already exists

More than it feels like.

| Target concept | Where it lives today | State |
| --- | --- | --- |
| Task | `boards.Task`, `tasks` table | Has status, `assignee_agent_id`, `parent_task_id`, `execution_run_id`, priority, ordering. Close to right. |
| Message / inbox | `boards.CardEntry`, `card_entries` | Has kind, body, author, `run_id`, threading, idempotency, a 200-entry cap. **This is the inbox.** |
| Agent identity | `auth.AgentUser`, `agents` | Identity and credential only. No instructions or backend. |
| Agent authorization | `a.user(...)` guard, `/api/v1/agent/tasks/*` | Narrow-credential pattern already correct. |
| Claim | `boards.AgentClaim` | Transactional and race-safe. Permanent, which is the problem. |
| Run | `cli/cmd/slate/registry.go` | Client-side JSON on the watcher's disk. Server has only a uuid column. |
| Adapter | `cli/cmd/slate/watch.go`, 969 lines | Worktrees, process groups, backoff, profiles. Real and working. |
| Board UI | `server/internal/web/dist/app.js`, 6,611 lines | Keep the board. Delete four views. |
| Deploy | `cloudbuild.yaml`, `.github` | Keep. |

The two hard problems, isolated execution and the human-in-the-loop channel, are both half solved. That is why this is a pivot and not a rewrite.

## 3. The gaps

| Gap | Size | Why it matters |
| --- | --- | --- |
| Runs are not server rows | Large | Nothing else works without it. Resume, live view, retry, metrics all hang off it. |
| No runners table or protocol | Large | Register, lease, heartbeat, long-poll dispatch, matching. |
| Claim is permanent, not leased | Medium | A dead machine strands a task forever. Fatal for unattended work. |
| Agents have no config | Medium | `AgentUser` has display name and purpose. Needs instructions, backend, workspace, overrides. |
| No envelope assembly | Medium | Prompt wrapping is client-side in `cli/cmd/slate/prompt.go`. Must move server-side. |
| No question and answer semantics | Small | `card_entries` needs direction, options, answer, answered_at. |
| Per-agent credentials, not per-run | Small | Rotate the pattern, not the architecture. |
| Four views nobody needs | Small | Pure deletion. Do it first. |
| No schedules | Small | One field, one deep-copy function, one ticker. |

## 4. Migrations

Continuing from `043_managed_agent_runs`.

`044_inbox_index` was taken by the inbox, so agent config is `045`.

```
045_agent_config
    ALTER agents ADD instructions, backend, workspace,
                     limits_json, backend_overrides_json

045_runs
    CREATE runs (id, account_id, task_id, agent_id, agent_snapshot,
                 runner_id, status, session_id, resume_from_run_id,
                 lease_expires_at, attempt, turns, tokens_in, tokens_out,
                 exit_reason, branch, started_at, ended_at, created_at)
    Partial unique index on (task_id) where status is active

046_runners
    CREATE runners (id, account_id, name, backends_json, workspaces_json,
                    concurrency, os, arch, status, last_heartbeat_at, created_at)
    CREATE runner_registration_tokens (id, account_id, hash, expires_at, consumed_at)

047_run_events
    CREATE run_events (run_id, seq, ts, type, payload_json)
    PRIMARY KEY (run_id, seq)

048_task_execution_policy
    ALTER tasks ADD requires_approval, target_runner, attempts, workspace
    Status gains 'blocked'

049_card_entry_questions
    ALTER card_entries ADD direction, options_json, answer, answered_at
    Partial index on unanswered questions

050_run_tokens
    Token kind 'run' with scope_json and expires_at, scoped to one run and task

051_attachments
    CREATE attachments (id, account_id, task_id, run_id, name, content_type,
                        size, sha256, content, created_at)

052_task_schedules
    ALTER tasks ADD schedule_cron, schedule_tz, next_run_at,
                    spawned_from_task_id, last_spawned_at
```

`044`, `048`, `049`, `051`, `052` are additive and safe on live data. `045` is the one with migration risk: `execution_run_id` points at client-generated ids with no server row. Accept that pre-pivot runs have no record.

**Reuse `card_entries`, do not build a messages table.** The task timeline and the inbox are the same stream. The Inbox view is a filter. This inherits working idempotency and author-attribution code.

## 5. Packages

```
server/internal/runs/          NEW   run lifecycle, leases, event ingest
server/internal/runners/       NEW   registration, heartbeat, dispatch matching
server/internal/envelope/      NEW   prompt assembly from agent + task + context
server/internal/schedules/     NEW   cron ticker and task spawning
server/internal/attachments/   NEW   upload, download, quota accounting
server/internal/agents/        GROW  config fields
server/internal/boards/        TRIM  claim logic moves to runs; entries gain Q&A
server/internal/server/app.go  GROW  runner, run, attachment routes; run-token guard
cli/cmd/slate/adapters/        NEW   one file per backend
```

Two new authority levels beside the existing ones: `runner` and `run`.

## 6. Milestones and tasks

Each task is one branch and one pull request. Acceptance criteria are what the PR must demonstrate.

### M0 - Collapse the surface

Pure deletion and renaming. No schema. Do this first because everything after is easier to reason about on a smaller surface.

| # | Task | Done when |
| --- | --- | --- |
| 0.1 | Delete Week, Table, and Today views from `app.js` and their routes, tests, and nav links | The app builds, tests pass, and no route references them. `scheduled_date` and `priority` remain as fields |
| 0.2 | Make Flow the only board. Columns are Todo, Doing, Review, Done. Delete board-grouped-by-list | One board exists. Dragging a card changes its status |
| 0.3 | Lists become a sidebar scope filter carried in the URL | Selecting a list filters the board. The scope survives reload and is in the URL |
| 0.4 | Rename card to task across API, UI copy, and tests. Retire `/api/v1/cards` aliases | No `card` in user-facing copy. Entries stay `card_entries` in the database |
| 0.5 | Rebuild task detail as Details, Description, Attachments placeholder, Subtasks. Details holds Agent, Assignee, Workspace, Schedule, Requires approval | Description is full-width and inline-editable. Details shows five fields |
| 0.6 | Nav becomes Board, Inbox, Runs, Agents, Runners, Settings, with a runner status indicator in the sidebar footer | Six items. Runs and Runners can be empty states |

Two decisions taken while doing this work, recorded because they are not obvious from the task list:

- **Boards leave the primary sidebar.** Lists are what people navigate by, so they became direct links carrying the scope in the URL. Board rename, delete and create moved to the settings sidebar rather than being deleted, because a board is still the storage parent of a list until lists become account-wide.
- **Per-list completed history was removed, not ported.** Its only trigger lived inside the lists grid. The Done column needs real paging, which belongs with runs in M2 rather than as a control with nowhere to live.
- **`/app/boards/{id}` folds into the board.** Once the board became status columns, the board route rendered a second board identical to `/app/tasks`. It now redirects there, keeping any task permalink. Board rows survive in the settings sidebar as a label with rename and delete, because a board is still the storage parent of a list.

### M1 - Agents become config

| # | Task | Done when |
| --- | --- | --- |
| 1.1 | `044_agent_config` migration and `agents` store fields | Instructions, backend, workspace, limits, overrides persist |
| 1.2 | Agent editor UI with an instructions textarea and backend overrides | An agent can be created and edited in the browser |
| 1.3 | `slate agent list/show/create/update`, with `--instructions-file` | A long prompt can be edited in an editor and pushed |

### M2 - Runs as server rows

| # | Task | Done when |
| --- | --- | --- |
| 2.1 | `045_runs` migration, `runs` package, lifecycle transitions | A run row is created, transitions, and terminates |
| 2.2 | `047_run_events`, batched append-only ingest with monotonic seq | Events upload, resume after a network drop, and replay in order |
| 2.3 | Run detail view with event replay | Opening a run shows its event stream |
| 2.4 | `048_task_execution_policy`: `requires_approval`, `attempts`, `target_runner`, `workspace`, `blocked` status | The approval toggle gates the move to Done |
| 2.5 | Single `canTransitionToDone` guard covering approval and open children | Both guards live in one function with tests |

### M3 - Runners and leases

| # | Task | Done when |
| --- | --- | --- |
| 3.1 | `046_runners`, registration tokens, register and deregister endpoints | A runner registers and appears in the UI |
| 3.2 | Leases with 60s TTL, heartbeat renewal, and an expiry reaper | An expired lease requeues the task and increments attempts |
| 3.3 | Long-poll job dispatch with backend and workspace matching | A queued task reaches a matching runner and no other |
| 3.4 | Retire `boards.AgentClaim` in favour of leases | No permanent claims remain |
| 3.5 | Runners list UI with heartbeat health | A cold runner is visibly cold |

### M4 - The runner and the first adapter

| # | Task | Done when |
| --- | --- | --- |
| 4.1 | `server/internal/envelope`: five-layer assembly from agent, task, context | The envelope is built server-side and covered by tests |
| 4.2 | `slate watch` becomes `slate runner start`, reading `~/.config/slate/runner.json` | The daemon starts from any directory and re-reads config each poll |
| 4.3 | `Adapter` interface and the `claude-code` adapter, porting worktrees, process-group kill, backoff, dirty-checkout refusal | A task runs end to end on a real repo |
| 4.4 | Event upload from adapter stream to `/runs/{id}/events` | A run is watched live from the browser while it executes |
| 4.5 | `slate runs list/logs/cancel`, cancel killing the process group | Cancelling from the UI stops the process tree |

### M5 - Run tokens and the agent CLI

| # | Task | Done when |
| --- | --- | --- |
| 5.1 | `050_run_tokens`, run-token guard, token minted per job and expiring with the run | A run token reads and writes exactly one task |
| 5.2 | `slate task show/comment/done/block` under the run token, `--json` everywhere | The agent updates its own task from inside the run |
| 5.3 | `051_attachments`, upload and download API, quota accounting | A file attached in the browser is readable via the API |
| 5.4 | `slate file put/get/list`, attachments materialised to `<workspace>/.slate/attachments/` before the run, parent attachments included | The agent reads its inputs as files and pushes an output back |

### M6 - Ask, park, resume

The milestone that decides whether the system is any good.

| # | Task | Done when |
| --- | --- | --- |
| 6.1 | `049_card_entry_questions`: direction, options, answer, answered_at | A question is distinguishable from a comment |
| 6.2 | ~~Inbox view~~, plus unread count | **Shipped early.** The inbox is agent-authored entries account-wide, newest first, each linked to its task, with `044_inbox_index` behind it. Unread state still needs 6.1 |
| 6.3 | `slate inbox ask --wait`, returning the answer or printing `parked` and exiting 75 | A reply inside the budget continues the run |
| 6.4 | Park semantics: run parks, task blocks, process dies | Nothing burns overnight |
| 6.5 | Resume: replying creates a new run with `resume_from_run_id`, envelope prepends the exchange | Ask at 2pm, answer at 6pm, it picks up where it left off |

### M7 - The second backend

| # | Task | Done when |
| --- | --- | --- |
| 7.1 | `codex` adapter, including session resume | The same task runs on either backend by changing one field |
| 7.2 | Degrade path for a backend that cannot resume, using a transcript summary | Resume works or degrades explicitly, never silently |

### M8 - Schedules

| # | Task | Done when |
| --- | --- | --- |
| 8.1 | `052_task_schedules`: cron, timezone, next_run_at, spawned_from | A task carries a schedule defaulting to Run once |
| 8.2 | Deep-copy spawn of a task and its subtasks, shared by cron and Run now | Clicking Run now produces a new task tree in Todo |
| 8.3 | Schedule ticker, one query a minute | Monday's task appears on Monday with no runner online |
| 8.4 | Definition detail UI stating the repeat and listing recent occurrences | Setting a schedule is explicit, never a silent mode change |

### M9 - Dashboard

| # | Task | Done when |
| --- | --- | --- |
| 9.1 | Now view: per runner and per agent, current task, status, elapsed, last event | "Is anything stuck?" is answered on one page |
| 9.2 | Over time: run outcomes, success rate, median wall clock, retries | Per-agent stats over a window |
| 9.3 | Questions per run and time parked | The two metrics that decide which agents to trust unattended |

## 7. Order and rationale

M0 first, because deleting four views makes every later change smaller.

M0, M1, and M8 all work with **zero runners installed**, which keeps the free tier honest and means the control plane is shippable before the execution layer is finished.

M3.2 (leases) is the first thing built in the runner. Everything unattended depends on it and ephemeral runners are impossible without it.

M6 decides whether the system is any good. M7 decides whether the architecture is real, because one backend proves nothing.

## 8. Risks

1. **`045` on live data.** Existing `execution_run_id` values have no server row. Accept that pre-pivot runs have no record. Decide before writing the migration.
2. **Two audiences.** The hosted product and the future self-host build will conflict. Hosted wins ties.
3. **Onboarding, not architecture, is the product risk.** "Install a daemon and give it a token" is a high bar. Time to first successful run is the metric that decides whether this sells. The zero-runner constraint is the mitigation.
4. **Prompt boilerplate leaking into task descriptions.** If the same sentence appears in three descriptions, it belongs in the envelope. Watch for this from M4 onward.
5. **Licence.** The repo has no LICENSE file, so default copyright applies. Add an explicit source-available licence before any public self-host build.

## 9. Out of scope

Goals and checklists, task dependencies, webhook triggers, cost and dollar accounting, skills, knowledge bases, third-party connections, MCP inside the run, self-host mode, mobile push.

Every one is accommodated by this schema and none belongs in this pivot. The pivot is the loop working end to end.
