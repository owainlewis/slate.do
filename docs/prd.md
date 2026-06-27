# Slate PRD

Status: Draft.

## Summary

Slate is a minimal visual task manager for humans and agents.

It helps people stay organised by showing the work that matters now and hiding everything else.

The core idea is simple:

> Lists should have limits.

Most task managers make it easy to collect too much.

Slate should make it easy to choose, focus, and finish.

## Problem

People and agents create too much work.

Tasks, notes, issues, ideas, and reminders spread across tools.

The result feels productive at first, then becomes confusing.

Agents make this worse because they can create hundreds of tasks, docs, and plans quickly.

Slate exists to protect attention.

## Audience

Slate is for builders, founders, operators, and agent-heavy teams who need a simple place to coordinate work.

The first user is Owain.

The product should support a solo builder working with Codex, Claude Code, Hermes, and other agents.

## Positioning

Slate is a task operating system for humans and agents.

It is visual, minimal, and opinionated.

It is not project management software for big teams.

It is not a second brain.

It is not a document database.

## Core Jobs

Slate should help a user:

- Capture work without losing focus.
- Decide what matters this week.
- Keep today small.
- Assign work to a human or agent.
- Link tasks to source material.
- Define what done means.
- Track blocked and waiting work.
- Kill low-value work.

## Task Model

Each task should have:

- Title.
- Outcome.
- Area.
- Priority.
- Status.
- Owner.
- Next action.
- Due date, optional.
- Source link.
- Definition of done.
- Blocker.

## Lists

The default lists are:

- Inbox.
- Today.
- This Week.
- Waiting.
- Blocked.
- Done.
- Not Now.

Each list can have a limit.

Useful defaults:

- Today: 3 tasks.
- This Week: 7 tasks.
- Active goals: 3 goals.
- Back-pocket videos: 3 ideas.

When a list is full, the user must move, finish, kill, or defer something before adding more.

## Agent Collaboration

Agents should not create clutter by default.

Agent permissions should be explicit:

- Suggest: propose tasks or changes.
- Draft: draft inside an existing task or linked doc.
- Execute: work on approved tasks.
- Maintain: update status, blockers, and links.
- Create: create new tasks or docs only when explicitly allowed.

Every agent action should attach to an existing task, goal, doc, issue, or source.

If it cannot attach to something, it becomes a suggestion.

## Visual Planning

Slate should make work easy to scan.

The first version can be a simple board.

Later versions can add:

- Goal lanes.
- Calendar blocks.
- Capacity indicators.
- Drag and drop.
- Linked GitHub issues.
- Linked Passage docs.
- Linked Airtable content records.

The interface should stay calm and sparse.

## Product Boundaries

Slate owns tasks and active work.

It does not own writing.

It does not own source code.

It does not own content metadata.

It should integrate with:

- Passage for writing.
- GitHub for code and issues.
- Airtable for content records.
- Business OS for strategy and offer context.

## Business Model

Slate should be paid software.

Working assumption:

- 7-day free trial.
- Paid plan after trial.

Pricing is not final.

The product should prove value through focus, limits, and agent collaboration rather than feature count.

## MVP

The MVP should include:

- User account.
- Board with default lists.
- List limits.
- Task create, edit, move, complete, and kill.
- Task fields for owner, next action, definition of done, blocker, and source link.
- Simple agent-friendly API or structured import path.
- Clean visual design.

## Success Criteria

Slate is working when:

- Owain knows what to work on today.
- Agents can pick up approved work without asking for missing context.
- The system prevents task sprawl.
- The user can maintain focus with less effort than GitHub Issues, Notion, or a generic task app.

## Non-Goals

- Full project management.
- Team chat.
- Long-form docs.
- CRM.
- Content calendar.
- Knowledge base.
- Enterprise permissions.
- Complex automation before the manual loop works.
