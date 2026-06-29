# Slate PRD

Status: Draft.

## Summary

Slate is a minimal list-first planning app.

The product is one slate: a visual grid of lists.

Each list has:

- A title.
- A hard item limit.
- A small set of item titles.

That is the core model.

Slate should help people choose what matters, see it clearly, and avoid task sprawl.

## Product Bet

Most task tools reward capture.

Slate should reward focus.

The default behavior should be:

- Keep lists short.
- Make limits visible.
- Show the whole plan at a glance.
- Hide lower-priority work in a bottom layer.
- Let agents maintain context without flooding the human with noise.

## Why Lists

Lists work because they reduce mental load and turn vague work into visible work.

Research and writing on list-making point to a few useful ideas:

- Written lists reduce the need to remember everything.
- Ordered tasks lower anxiety because the work has shape.
- Completion gives people visible proof of progress.
- Small, achievable tasks help people stay motivated.
- Checklists can help professionals in complex fields avoid missed steps.

Product implication: Slate should stay close to the psychology of simple lists, not drift into complex project management.

References:

- https://niche.org.uk/psychology-list-making-productivity
- https://www.theguardian.com/lifeandstyle/2017/may/10/the-psychology-of-the-to-do-list-why-your-brain-loves-ordered-tasks
- https://www.atlassian.com/blog/productivity/the-psychology-of-checklists-why-setting-small-goals-motivates-us-to-accomplish-bigger-things
- The Checklist Manifesto by Atul Gawande

## Audience

Slate is for people who think visually and get overwhelmed by large task systems.

The first user is a solo builder working with agents.

The product should also work for founders, creators, operators, and small teams who need a calmer planning surface.

## Positioning

Slate is not Trello.

Slate is not Notion.

Slate is not a second brain.

Slate is a small visual surface for deciding what gets attention.

## Core Model

There is one slate.

A slate contains lists.

A list contains items.

An item starts as a title.

Optional item detail can come later, but only if the title-only model is not enough.

Possible later item details:

- Label.
- Due date.
- Comment.
- Link.
- Owner.

These are not MVP requirements.

## List Limits

Every list has a limit.

The default limit is 3 items.

When a list is full, the user must finish, move, remove, or defer an item before adding more.

Limits are not a power-user setting.

Limits are the product.

## Default Layout

The app uses a grid layout inspired by TeuxDeux.

Top layer:

- Today.
- This Week.
- Content.
- Product.
- Waiting.

Bottom layer:

- Someday.
- Done.
- Archive.

The exact list names can change, but the layout should stay simple.

## Agent Collaboration

Agents should work underneath the slate.

The human sees a small set of lists.

Agents can:

- Suggest items.
- Update item status.
- Add context inside an item if detail exists.
- Maintain linked work elsewhere.
- Point out stale or overloaded lists.

Agents should not create lots of visible items by default.

If an agent finds ten possible tasks, Slate should help reduce them to one to three useful items.

## MVP

The MVP should include:

- One slate.
- Grid layout.
- Create, rename, reorder, and delete lists.
- Set a list limit.
- Create, edit, move, complete, and delete items.
- Show item count against limit, for example 2/3.
- Bottom layer for lower-priority lists.
- Local-first or simple account-based persistence.

Out of scope for MVP:

- Rich task fields.
- Complex statuses.
- Subtasks.
- Project templates.
- Team permissions.
- Automations.
- Calendar sync.
- AI features beyond a simple import or suggestion path.

## UX Principles

- The board is the interface.
- Avoid dashboards.
- Avoid explanatory UI.
- Avoid nested task structures.
- Prefer empty lines over empty panels.
- Make the limit visible.
- Make overload impossible or uncomfortable.
- Keep typography strong but not title-heavy.
- The user should understand the app in five seconds.

## Business Model

Working assumption:

- 7-day free trial.
- Paid plan after trial.

Pricing is not final.

The product should prove value through calm planning, hard limits, and agent-compatible simplicity.

## Success Criteria

Slate is working when:

- The user knows what deserves attention today.
- The user can see all active work without scrolling through a huge backlog.
- Lists stay small because limits are built into the product.
- Agents can help without making the human UI messy.
- The product feels easier than GitHub Issues, Notion, Trello, or a generic task app.

## Open Questions

- Should every list default to 3 items, or should some lists allow 5?
- Should item detail exist in v1, or should v1 be title-only?
- Should bottom-layer lists behave exactly like top-layer lists?
- Should agents create suggested items in a hidden queue before the user accepts them?
