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

Slate now has an admin-only MVP:

- Go server and static JS frontend.
- Postgres persistence.
- Admin sign in with a seeded admin.
- Boards, goal-led Lists, a four-state Flow view for list items, planned dates, Week and Today views, and theme.
- API tokens for CLI and agent workflows.
- In-repo CLI at `cli/cmd/slate`.
- Cloud Run and Cloud Build config.

## Local start

```bash
createdb slate_dev
export DATABASE_URL=postgres://localhost/slate_dev?sslmode=disable
export ADMIN_EMAIL=you@example.com
export ADMIN_PASSWORD='use-a-long-password'
just migrate
just seed-admin
just serve
```

Open `http://localhost:8080`.

## CLI

```bash
go install github.com/owainlewis/slate.do/cli/cmd/slate@latest
export SLATE_API_TOKEN=slate_...
slate auth status
slate boards list
slate lists list --board <board-id>
slate tasks create --list <list-id> --title "Draft launch note" --description "Write the first version" --date 2026-07-13
slate tasks pull
slate tasks claim <task-id>
slate tasks status <task-id> needs_review
```

The CLI uses `https://slate.do` by default. Set `SLATE_BASE_URL` only for a
different deployment, such as `http://localhost:8080` during development.

Run `slate help` for an overview or `slate help boards`, `slate help lists`,
and `slate help tasks` for every supported command and flag. Successful output
is always JSON so humans and agents can use the same interface.

## Deploy

See [docs/deploy.md](docs/deploy.md).
