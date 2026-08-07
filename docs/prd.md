# Slate PRD

Status: Task-first redesign.

## Summary

Slate is a task management and organising system for humans and command-line agents.

The task is the core unit. Lists help people think in buckets. Views show the same tasks in the shape needed for planning or execution. Agents are external collaborators that claim assigned work through the CLI.

## Product principles

- Capture work before organising it.
- Keep one source of truth for human and agent work.
- Make lists useful for clear thinking, not workflow enforcement.
- Keep task metadata small and visible.
- Let the CLI be the agent interface. Do not embed AI actions in the product.
- Prefer one level of subtasks over deep project trees.

## Core workflow

1. A human or integration creates a task in Inbox.
2. The task is refined and moved into a list when its bucket is clear.
3. The human sets priority, planned date, status, and owner when useful.
4. A human works directly, or an assigned agent pulls and claims the task through the CLI.
5. Work moves through Ready, Working, Review, and Done.
6. Complex work can be split into one level of real subtasks shared between humans and agents.

## Core model

### Task

A task is any captured unit of work, including an action, idea, thought, or planned content item.

Core fields:

- `id`
- `title`
- `description`
- `listId`
- `status`
- `priority`
- `scheduledDate`
- `assigneeAgentId`
- `parentTaskId`
- timestamps

### List

A list is a named bucket for organising tasks, such as Product, YouTube, Content, LinkedIn, Personal, or Waiting.

Lists can have a short goal. Lists do not reject tasks based on item count. Focus comes from filters, priorities, dates, and status. Account-level storage quotas remain the capacity boundary.

Boards remain an internal compatibility container for existing data and API clients. They are not the primary navigation model.

### Subtask

A subtask is a real task with its own status, priority, planned date, list, and owner. A task can contain subtasks, but a subtask cannot contain another subtask.

The parent detail view shows completed progress and a compact subtask list. Deleting a parent deletes its subtasks.

### Agent

An agent is a named external collaborator with a scoped credential. Tasks can be assigned to agents. An agent token can only read and change that agent's assigned work.

Agents use the CLI to pull, claim, update, request review, and complete tasks. Slate does not offer in-product actions such as “refine with agent”.

## Navigation

The signed-in app opens to All tasks and keeps these destinations visible:

- Inbox
- Today
- Week
- Review
- All tasks
- User-defined lists
- Agents

New Task creates one task in Inbox and opens it for editing. There is no separate quick-capture product surface.

## Views

Every view reads and edits the same task records:

- List: compact rows for scanning and thinking.
- Flow: Ready, Working, Review, and Done columns.
- Table: task, list, status, priority, owner, and planned date.
- Week: planned work grouped Monday through Sunday.

Filters cover text, status, priority, owner, and planned date range. A list route combines its list scope with the selected filters.

## Workflow status

- `queued`
- `working`
- `needs_review`
- `done`

The labels in the interface are Ready, Working, Review, and Done. Workflow states are fixed in this version.

## CLI workflow

Capture directly into Inbox:

```bash
slate tasks create --title "Draft launch note"
```

Create in a known list or under a parent:

```bash
slate tasks create --list <list-id> --title "Research examples"
slate tasks create --parent <task-id> --title "Human review"
```

An agent run:

```bash
slate tasks pull --limit 5
slate tasks claim <task-id>
slate tasks get <task-id>
slate tasks status <task-id> needs_review
```

## Scope

Included:

- Account-wide task workspace.
- Inbox capture.
- User-defined lists with no item-count limit.
- List, Flow, Table, Today, and Week views.
- Filters, priorities, planned dates, and fixed workflow status.
- One level of subtasks.
- Named agent identities, assignment, scoped tokens, and CLI execution.
- Compatibility for existing board, list, task, and CLI clients.

Not included:

- Embedded chat or AI refinement actions.
- Deeply nested task trees.
- Custom workflow builders.
- Team roles and permissions.
- Comments, notifications, calendar sync, or rich labels.

## Success criteria

Slate is working when:

- Any work can be captured as one task without deciding its structure first.
- A creator can replace a planning table such as an Airtable video pipeline with a filtered Slate list.
- A human can switch between list, flow, and table views without duplicating data.
- A complex task can be divided between a human and agents while progress stays visible on the parent.
- An agent can find only its assigned work, execute it through the CLI, and return it for review.
- The interface feels calm, direct, and consistent with Slate's existing visual identity.
