# Slate PRD

> **Superseded.** This describes the card-first product that came before the agent control plane pivot.
> Kept for history. The current target is `docs/agentos-architecture.md`; the plan is `docs/agentos-plan.md`.

Status: Card-first control plane. Superseded by the agent control plane.

## Summary

Slate is an agent control plane that helps people clarify intent, focus attention, and run all of their work with human and AI collaborators.

The card is the core unit of intent. Lists give cards useful context without forcing every card to be a task, goal, or project. A list can itself represent a project, goal, area, or workflow. Agents receive cards as prompts and return comments or outputs to the same card.

## Product principles

- Capture intent before deciding its structure.
- Keep one source of truth for human and agent work.
- Let cards stay generic. Do not require a task, goal, or project type.
- Let lists carry context such as a project, goal, area, or category.
- Keep properties small and visible.
- Keep human judgment in Slate and agent execution available through the CLI.
- Prefer one level of child cards over deep project trees.
- Show agent contributions as comments and outputs, not runtime logs.

## Core workflow

1. A human, agent, or integration creates a card in Inbox.
2. The card is refined with enough prompt and context to act on.
3. The card can stay in Inbox or move to a list that gives it meaning.
4. A human owns the card directly, or assigns it to an agent.
5. Work moves through New, Ready, In Progress, Review, and Done.
6. The agent can comment or return an output on the card.
7. Complex intent can be split into one level of child cards.

## Core model

### Card

A card is a generic unit of intent. It can represent an action, goal, project, idea, decision, email to triage, planned content, or any other thing worth directing attention toward.

Core fields:

- `id`
- `title`
- `description` as prompt and context
- `listId`
- `status`
- `priority`
- `scheduledDate`
- `assigneeAgentId`
- `parentCardId`
- timestamps

The current database and legacy API retain task field names for compatibility. Card API aliases expose the product language to new integrations.

### List

A list is a named context for cards. Examples include Build AI Systems Course, YouTube, Growth, Personal, Waiting, or an August revenue goal.

Lists can have a short purpose. They do not impose a specific semantic type or reject cards based on item count. Focus comes from views, filters, priority, dates, and status.

### Board

A board is a spatial view of related lists and cards. Its columns are the real, user-defined lists. Moving a card across a board changes its list, not its workflow status.

The current database retains board ownership for compatibility. The primary UI treats lists as account-wide contexts and does not ask users to manage that storage detail.

### Child card

A card can contain one level of child cards. Each child has its own status, priority, planned date, and owner, but stays in the same list as its parent. A child cannot contain another child.

The parent card shows progress and a compact child-card list. Deleting a parent deletes its children.

### Conversation entry

A conversation entry belongs to a card and is one of:

- Comment: feedback, context, or a question.
- Output: a result, link, deliverable, or summary returned by a human or agent.

An output moves the card to Review and remains visible in the card conversation.

### Agent

An agent is a named external collaborator with a scoped credential. Cards can be assigned to agents. An agent token can only read and change that agent's assigned cards.

Agents use the CLI or card API to pull, claim, update, comment, add outputs, request review, and complete assigned work. Slate shows the result and conversation, not model selection, retries, or execution logs.

## Navigation

The signed-in app opens to Today and keeps three levels visible:

- Attention: Inbox, Today, Review.
- Plan: Week, All cards.
- Context: user-defined Lists and Agents.

New card creates one card in Inbox and opens it for editing.

## Views

Every view reads and edits the same card records:

- Board: show user-defined lists as columns and move cards between them.
- Flow: show New, Ready, In Progress, Review, and Done as columns without changing a card's list.
- Table: card, list, status, priority, owner, and planned date.
- Week: planned cards grouped Monday through Sunday.

Opening a card uses a right drawer so its list remains visible as context. Card detail contains Prompt and context, Conversation, Child cards, and Properties.

Review separates outputs waiting for judgment from cards manually placed in Review.

## Workflow status

- `new`, labelled New
- `queued`, labelled Ready
- `working`, labelled In Progress
- `needs_review`, labelled Review
- `done`, labelled Done

The existing status values stay stable for existing clients. `new` is added as the capture state.

## Compatibility

Existing board, list, task, agent, and CLI routes remain supported. New integrations can use `/api/v1/cards` aliases and `/api/v1/cards/{id}/entries`. The implementation can continue using task names internally until changing them has clear product value.

## Scope

Included:

- Account-wide card workspace with Today as the default.
- Inbox capture and generic cards.
- Lists as flexible context, with backend board ownership hidden from primary UI.
- Board, Flow, Table, Review, Today, and Week views.
- Filters, priorities, planned dates, and fixed workflow status.
- One level of child cards.
- Named agent identities, assignment, scoped tokens, and CLI execution.
- Human and agent comments and outputs.
- Compatibility for existing board, list, task, and CLI clients.

Not included:

- Required goal, project, or task types.
- Deeply nested card trees.
- Custom workflow builders.
- Team roles and permissions.
- Agent runtime logs, model controls, retries, or embedded chat.
- Notifications, calendar sync, or rich labels.

## Success criteria

Slate is working when:

- Any intent can be captured without deciding whether it is a task, goal, or project.
- A list can represent a project or goal without requiring a separate object type.
- A human can move between cards, flow, table, and time views without duplicating data.
- A card is useful as an agent prompt and keeps the agent's feedback and output attached.
- A complex card can be divided between a human and agents while progress stays visible.
- An agent can access only assigned cards and return work for review.
- The interface clarifies and focuses human attention instead of exposing agent machinery.
