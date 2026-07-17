# Slate PRD

Status: Draft v1.

## Summary

Slate is a minimal interactive operating plan for thinking clearly and executing deliberately.

It is based on buckets.

A bucket is a simple list with a name, a goal, and a small set of items.

Slate helps the user think clearly by grouping work into visible buckets and keeping each bucket small.

## Product Principle

Simplicity is the product.

Slate should use the simplest thing that works. Every feature must protect clarity. If a feature makes the board feel heavier, it should be removed, delayed, or hidden.

The app should feel calm enough to use every day.

## Product Bet

Most productivity tools collect information and turn it into noise.

Slate should help the user choose work.

The main behavior should be:

- Capture items quickly without declaring that everything is a task.
- Put items into clear buckets.
- Limit each bucket.
- Turn an item into an action only when it represents executable work.
- Add dates to surface selected items in Week and Today.
- Let a human or agent pick up any action.
- Review agent work without adding ownership complexity.

## Audience

The first user is a solo builder or manager working with agents.

Slate should also work for creators, founders, operators, and small teams who want a clear planning surface without a full project management system.

## Positioning

Slate is not a traditional kanban app.

Slate is not a second brain.

Slate is not a project management suite.

Slate is a small visual surface for deciding what gets attention.

It is inspired by:

- TeuxDeux for simple lists.
- Trello for visual buckets.
- Plain to-do lists for speed and clarity.

## Core Model

Slate has boards.

A board has buckets.

A bucket has items.

An item has a title and can optionally become an action. Items stay flat inside a bucket. Separate buckets provide structure without nested lists.

Core fields:

- `id`
- `title`
- `description`
- `scheduledDate`
- `kind`
- `boardId`
- `bucketId`
- `done`
- `status`

## Buckets

Buckets are the main thinking tool.

Examples:

- High priority
- Medium priority
- Low priority
- Inbox
- Waiting
- Writing
- Product
- Personal

The app should not force one bucket style. Users should be able to bucket by priority, project, energy, time, person, or status.

Each bucket can state its goal in one sentence.

## Action Limits

Every bucket should have a visible limit for open actions.

Example:

```text
Product 3/5
```

The limit is not decoration. It is part of the product.

Neutral items never consume the action limit. When the action limit is full, the user should finish, move, or defer an action before creating another.

Default limit:

- 5 for normal buckets.
- 3 for focus buckets.

This can change after testing.

## Items and Actions

An item should look like one clean line in the bucket. Neutral items use a bullet. Actions use a checkbox.

List item display should include:

- Title.
- Planned date when set.

The full task detail view should include:

- Title.
- Description.
- Type: Item or Action.
- Date.
- Done when it is an Action.
- Workflow state when it is an Action.
- List.

## Agents

Actions do not have owners or assignees.

Any open action can be picked up by the human or by an agent. Neutral items are never returned as agent work.

A valid workspace API token can pull any queued task. Claiming a task changes its internal workflow status to `working`.

Example CLI flow:

```bash
SLATE_API_TOKEN=...
slate tasks pull
```

The API returns open queued tasks.

Example query:

```text
workspace token is valid
done = false
status = "queued"
```

This keeps agent collaboration simple.

## Workflow Status

Use a small status set:

- `queued`
- `working`
- `needs_review`
- `done`

Do not add complex workflow states in v1.

## API Principle

The API should be boring and clear.

Core agent operations:

- Pull queued tasks.
- Claim or mark a task as working.
- Update the task description with useful context or results.
- Mark a task as needs review.
- Mark a task as done.

The API should not require an agent account.

## MVP

The first app version should include:

- Boards.
- Buckets.
- Bucket limits.
- Create, rename, reorder, and delete buckets.
- Create, edit, move, and delete items.
- Convert items into completable actions.
- Item detail panel.
- Title and description.
- Optional planned date and Monday-to-Sunday calendar view.
- Today view with actions first and dated notes shown quietly.
- Flow view with Ready, Working, Review, and Done columns for Actions.
- Workflow status controls for human and agent coordination.
- Local persistence or simple database persistence.
- Global workspace API token.
- CLI pull for queued tasks.

Out of scope:

- User roles.
- Agent accounts.
- Per-agent tokens.
- Team permissions.
- Nested items.
- Comments.
- Rich labels.
- Calendar sync.
- Automation builder.
- Reports.
- Notifications.

## UX Principles

- The board is the interface.
- Keep list items compact.
- Avoid dashboards.
- Keep items flat and use buckets for structure.
- Avoid heavy metadata.
- Prefer text over configuration.
- Make limits visible.
- Make overload obvious.
- Show the fixed Action state in the detail panel without adding ownership or workflow configuration.
- Make capture fast.
- Make review calm.

## Initial Prototype

The first static prototype is:

- `list-app-mockup.html`

It shows:

- Sidebar boards.
- List grid.
- Responsive list grid.
- Item add flow.
- Item drag flow.
- Detail panel.
- Title and description.
- Planned date.
- Weekly calendar view.

## Success Criteria

Slate is working when:

- The user can see active work at a glance.
- Buckets stay small.
- The user knows what matters this week.
- Agents can find queued work.
- Agent work can be reviewed without clutter.
- The product feels lighter than Trello, Notion, GitHub Issues, or a normal task app.

## Open Questions

- Should the default bucket limit be 3 or 5?
- Should Inbox have a limit?
- Should the CLI be part of v1 or come right after the web app?
