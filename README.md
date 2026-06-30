# slate.do

A minimal visual task manager for humans and agents.

Slate helps you choose what to work on, keep active work visible, and hide everything else.

It is built around lists, limits, and human plus agent collaboration.

## Product

The product reference is a simple task board that protects attention instead of collecting infinite tasks.

Each list has a limit.

That limit is a feature.

Agents can suggest, update, and execute work, but Slate should make it hard to create clutter.

## Docs

- [PRD](docs/prd.md)
- [Initial static prototype](list-app-mockup.html)

## App

Slate now has an owner-only MVP:

- Go server and static JS frontend.
- Postgres persistence.
- Owner sign in with a seeded owner.
- Boards, lists, limits, tasks, details, focus, assignee, due date, notes, agent brief, agent status, layout, and theme.
- API tokens for CLI and agent workflows.
- In-repo CLI at `cli/cmd/slate`.
- Cloud Run and Cloud Build config.

## Local start

```bash
createdb slate_dev
export DATABASE_URL=postgres://localhost/slate_dev?sslmode=disable
export OWNER_EMAIL=you@example.com
export OWNER_PASSWORD='use-a-long-password'
just migrate
just seed-owner
just serve
```

Open `http://localhost:8080`.

## CLI

```bash
export SLATE_BASE_URL=http://localhost:8080
export SLATE_API_TOKEN=slate_...
go run ./cli/cmd/slate boards list
go run ./cli/cmd/slate tasks create --list <list-id> --title "Draft launch note" --assignee coder
go run ./cli/cmd/slate tasks pull --assignee coder
go run ./cli/cmd/slate tasks status <task-id> working
go run ./cli/cmd/slate tasks done <task-id>
```

## Deploy

See [docs/deploy.md](docs/deploy.md).
