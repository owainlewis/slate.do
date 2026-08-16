# slate.do

A control plane for work done by people and coding agents.

You put work on a board. Agents pick it up, do it on machines you own, and message you when they need you. The control plane holds all the state and none of the execution.

## Product

Slate is two parts:

- **The control plane.** The hosted app. Tasks, agents, runs, the inbox. This is what you sign up for.
- **The runner.** The `slate` CLI, installed separately on your own machine. It polls for work, executes it, and reports back.

You never have to install anything. Slate is a working task manager on its own, and agents are an upgrade to a task rather than a precondition for the product.

Four primitives: **task**, **agent**, **runner**, **run**. A task is a unit of work. An agent is config: instructions, a backend, a workspace. A runner is a registered machine. A run is one execution attempt.

Because runners live on your machines, you bring your own agent runtime (Claude Code, Codex, anything that reads a prompt and exits) and pay for your own tokens on your own subscription. The control plane never holds a repo, a model key, or a deploy credential.

## Docs

- [Target architecture](docs/agentos-architecture.md)
- [Delivery plan](docs/agentos-plan.md)
- [Current implementation](ARCHITECTURE.md)
- [Install and use the Slate CLI](docs/cli.md)
- [Run a coding agent on your Slate tasks](docs/watcher.md)

`docs/prd.md` describes the card-first product that came before this and is kept for history only.

## App

- Go server and static JS frontend.
- Postgres persistence.
- One board with status columns, an inbox, lists as a scope filter, and task detail.
- One level of subtasks with independent owner and workflow state.
- Named agent identities, assignment, scoped tokens, and CLI execution.
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
