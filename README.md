# slate.do

A task control plane for clear thinking and focused human and agent execution.

Slate captures work as tasks, organises it into lists, and shows the same work as a compact list, workflow board, table, or weekly plan.

## Product

The task is the core unit. New tasks enter Inbox, lists provide thinking buckets, and every task can move through Ready, Working, Review, and Done. Lists do not impose hard item limits.

Tasks can have one level of real subtasks for shared human and agent work. Agents execute assigned tasks through the CLI rather than embedded AI actions.

## Docs

- [Install and use the Slate CLI](docs/cli.md)
- [PRD](docs/prd.md)
- [Initial static prototype](list-app-mockup.html)

## App

Slate now has an admin-only MVP:

- Go server and static JS frontend.
- Postgres persistence.
- Admin sign in with a seeded admin.
- Inbox, account-wide tasks, goal-led Lists, List, Flow and Table views, filters, planned dates, Week and Today views, and theme.
- One level of subtasks with independent owner and workflow state.
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

## Tests

`just test-unit` runs the fast suite without external services. The required
release gate uses PostgreSQL and Chromium:

```bash
createdb slate_test
export SLATE_TEST_DATABASE_URL=postgres://localhost/slate_test?sslmode=disable
npm ci
npx playwright install chromium
just test-ci
```

The CI suite fails if a database-backed Go test is skipped. Keep
`SLATE_TEST_DATABASE_URL` pointed at a disposable test database because tests
apply migrations and create temporary records.

## CLI

Install the latest release on macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/owainlewis/slate.do/main/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
export SLATE_API_TOKEN=slate_...
slate auth status
slate tasks create --title "Draft launch note"
slate tasks create --list <list-id> --title "Research examples"
slate tasks create --parent <task-id> --title "Human review"
slate tasks pull
slate tasks claim <task-id>
slate tasks status <task-id> needs_review
```

See the full [CLI guide](docs/cli.md) for installation options, upgrades,
authentication, and setup instructions for Claude Code, Codex, and other
shell-based agents. The same guide is published at [slate.do/cli](https://slate.do/cli).

## Deploy

See [docs/deploy.md](docs/deploy.md).
