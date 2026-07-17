# slate.do

A minimal interactive operating plan for clear thinking and focused execution.

Slate helps you choose what to work on, keep active work visible, and hide everything else.

It is built around thinking buckets, simple list items, execution state, and weekly planning.

## Product

The product reference is a simple operating plan that protects attention instead of collecting infinite metadata.

Each list holds one simple item type. Every item can move through Ready, Working, Review, and Done.

Limits apply to open list items.

Agents can suggest, update, and execute work, but Slate should make it hard to create clutter.

## Docs

- [PRD](docs/prd.md)
- [Initial static prototype](list-app-mockup.html)

## App

Slate now has an owner-only MVP:

- Go server and static JS frontend.
- Postgres persistence.
- Owner sign in with a seeded owner.
- Boards, goal-led Lists, a four-state Flow view for list items, planned dates, Week and Today views, and theme.
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
go run ./cli/cmd/slate tasks create --list <list-id> --title "Draft launch note" --description "Write the first version" --date 2026-07-13
go run ./cli/cmd/slate tasks pull
go run ./cli/cmd/slate tasks claim <task-id>
go run ./cli/cmd/slate tasks done <task-id>
```

## Deploy

See [docs/deploy.md](docs/deploy.md).
