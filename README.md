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

- [Install and use the Slate CLI](docs/cli.md)
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

Install the latest release on macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/owainlewis/slate.do/main/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
export SLATE_API_TOKEN=slate_...
slate auth status
slate boards list
slate lists list --board <board-id>
slate tasks create --list <list-id> --title "Draft launch note" --description "Write the first version" --date 2026-07-13
slate tasks pull
slate tasks claim <task-id>
slate tasks status <task-id> needs_review
```

See the full [CLI guide](docs/cli.md) for installation options, upgrades,
authentication, and setup instructions for Claude Code, Codex, and other
shell-based agents. The same guide is published at [slate.do/cli](https://slate.do/cli).

## Deploy

See [docs/deploy.md](docs/deploy.md).
