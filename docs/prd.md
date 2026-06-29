# Slate PRD

Status: Draft v1.

## Summary

Slate is a minimal list app for managing work with humans and agents.

It is based on buckets.

A bucket is a simple list with a name, a limit, and a small set of tasks.

Slate helps the user think clearly by grouping work into visible buckets and keeping each bucket small.

## Product Principle

Simplicity is the product.

Slate should use the simplest thing that works. Every feature must protect clarity. If a feature makes the board feel heavier, it should be removed, delayed, or hidden.

The app should feel calm enough to use every day.

## Product Bet

Most task tools collect work.

Slate should help the user choose work.

The main behavior should be:

- Capture tasks quickly.
- Put tasks into clear buckets.
- Limit each bucket.
- Mark a few tasks as focus.
- Assign some tasks to humans or agents.
- Review agent work without making the board noisy.

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

A bucket has tasks.

A task has a title.

Optional task detail can exist, but the list item should stay simple.

Core fields:

- `id`
- `title`
- `boardId`
- `bucketId`
- `done`
- `focus`
- `assignee`
- `status`
- `dueDate`
- `notes`

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
- Agent work

The app should not force one bucket style. Users should be able to bucket by priority, project, energy, time, person, or status.

## Bucket Limits

Every bucket should have a visible limit.

Example:

```text
Product 3/5
```

The limit is not decoration. It is part of the product.

When a bucket is full, adding more work should feel constrained. The user should finish, move, delete, or defer something before adding more.

Default limit:

- 5 for normal buckets.
- 3 for focus buckets.

This can change after testing.

## Tasks

A task should look like one clean line in the bucket.

List item display should include:

- Checkbox.
- Title.
- Small due date if present.
- Small assignee label if present.
- Small status only when useful.

The full task detail view should include:

- Title.
- Done.
- Focus.
- Assignee.
- Due date.
- Notes.
- Agent brief when assigned to an agent.
- Status.

## Agents

Agents are first-class assignees.

An agent does not need a login.

An agent is just a name string.

Examples:

- `claude-code-123`
- `scribe`
- `analyst`
- `coder`

The app should not treat agent names as secure identity. They are routing keys.

Authentication and identity are separate:

- Authentication: a valid workspace API token can access the workspace.
- Identity: the caller asks for tasks assigned to an assignee string.

Example CLI flow:

```bash
SLATE_API_TOKEN=...
slate pull --assignee "claude-code-123"
```

The API returns open tasks assigned to that string.

Example query:

```text
workspace token is valid
assignee = "claude-code-123"
done = false
status = "queued"
```

This keeps agent collaboration simple.

## Agent Status

Use a small status set:

- `queued`
- `working`
- `needs_review`
- `done`

Do not add complex workflow states in v1.

## API Principle

The API should be boring and clear.

Core agent operations:

- Pull assigned tasks.
- Claim or mark a task as working.
- Add notes or result text.
- Mark a task as needs review.
- Mark a task as done.

The API should not require an agent account.

## MVP

The first app version should include:

- Boards.
- Buckets.
- Bucket limits.
- Create, rename, reorder, and delete buckets.
- Create, edit, move, complete, and delete tasks.
- Task detail panel.
- Focus flag.
- Assignee string.
- Agent status.
- Local persistence or simple database persistence.
- Global workspace API token.
- CLI pull by assignee.

Out of scope:

- User roles.
- Agent accounts.
- Per-agent tokens.
- Team permissions.
- Subtasks.
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
- Avoid nested task structures.
- Avoid heavy metadata.
- Prefer text over configuration.
- Make limits visible.
- Make overload obvious.
- Keep agent detail in the panel, not on the board.
- Make capture fast.
- Make review calm.

## Initial Prototype

The first static prototype is:

- `list-app-mockup.html`

It shows:

- Sidebar boards.
- List grid.
- Three or six list layout.
- Task add flow.
- Task drag flow.
- Detail panel.
- Human or agent assignee.
- Agent brief.
- Agent status.
- Due date.
- Focus flag.

## Success Criteria

Slate is working when:

- The user can see active work at a glance.
- Buckets stay small.
- The user knows what matters this week.
- Agents can find assigned work by name.
- Agent work can be reviewed without clutter.
- The product feels lighter than Trello, Notion, GitHub Issues, or a normal task app.

## Open Questions

- Should the default bucket limit be 3 or 5?
- Should focus be a flag, a view, or both?
- Should Inbox have a limit?
- Should agent results live in notes or a separate result field?
- Should the CLI be part of v1 or come right after the web app?
- Should tasks assigned to agents appear differently from human tasks?
