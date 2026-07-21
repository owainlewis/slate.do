# Slate CLI

The Slate CLI lets you manage boards, lists, and tasks from a terminal. Its
data and workflow commands return JSON, so the same interface works for people,
scripts, and coding agents such as Claude Code and Codex.

## Install

The installer supports macOS and Linux on Intel and ARM. It requires `curl`,
`tar`, and either `sha256sum` or `shasum`.

Install the latest release with one command:

```bash
curl -fsSL https://raw.githubusercontent.com/owainlewis/slate.do/main/install.sh | sh
```

The installer detects your platform, downloads the matching archive from the
[latest GitHub release](https://github.com/owainlewis/slate.do/releases/latest),
verifies its SHA-256 checksum, and installs `slate` to `~/.local/bin`.

If that directory is not already on your `PATH`, add it for the current shell:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Add the same line to your shell profile, such as `~/.zshrc` or `~/.bashrc`, to
make it permanent. Then verify the installation:

```bash
slate version
slate help
```

If you prefer to inspect the installer before running it, download it first:

```bash
curl -fsSL https://raw.githubusercontent.com/owainlewis/slate.do/main/install.sh -o install-slate.sh
less install-slate.sh
sh install-slate.sh
```

### Choose a version or install directory

Pin a release by setting `SLATE_VERSION`:

```bash
curl -fsSL https://raw.githubusercontent.com/owainlewis/slate.do/v1.0.0/install.sh | SLATE_VERSION=v1.0.0 sh
```

Choose another install directory with `SLATE_INSTALL_DIR`:

```bash
curl -fsSL https://raw.githubusercontent.com/owainlewis/slate.do/main/install.sh | SLATE_INSTALL_DIR=/usr/local/bin sh
```

The second command may need suitable write permission for `/usr/local/bin`.
Windows users can run the Linux installer inside WSL.

## Authenticate

1. Sign in at [slate.do](https://slate.do).
2. Open **Settings**.
3. Under **API tokens**, create a token and copy it when it appears.
4. Export it in the terminal where you will run Slate or start your agent:

```bash
export SLATE_API_TOKEN=slate_...
slate auth status
```

Treat the token like a password. Do not put it in `CLAUDE.md`, `AGENTS.md`,
source code, or a committed `.env` file. An agent started from this terminal
inherits the environment variable.

The CLI connects to `https://slate.do` by default. For a self-hosted or local
instance, set `SLATE_BASE_URL`:

```bash
export SLATE_BASE_URL=http://localhost:8080
```

## Basic commands

Start by finding the IDs for your board and list:

```bash
slate boards list
slate lists list --board <board-id>
```

Create and inspect work:

```bash
slate tasks create \
  --list <list-id> \
  --title "Draft launch note" \
  --description "Write the first version" \
  --date 2026-07-21

slate tasks list --list <list-id> --done false
slate tasks get <task-id>
```

Run `slate help boards`, `slate help lists`, or `slate help tasks` for every
command and flag.

## Use Slate with coding agents

Slate is designed for agents that can run shell commands. Start the agent from
the terminal where `SLATE_API_TOKEN` is set:

```bash
export SLATE_API_TOKEN=slate_...
claude
```

For Codex, use `codex` in place of `claude`. The same setup works with any
agent that can run the `slate` executable and inherit environment variables.

Add the following instructions to your repository's `CLAUDE.md` for Claude
Code or `AGENTS.md` for Codex and other compatible agents. Keep the token out
of the file.

```md
## Slate workflow

- Run `slate tasks pull` to find queued work.
- Before starting a task, run `slate tasks claim <task-id>`.
- Only continue when the claim succeeds.
- Read full context with `slate tasks get <task-id>`.
- When work is ready for a person to review, run
  `slate tasks status <task-id> needs_review`.
- After the work is accepted, run `slate tasks done <task-id>`.
- Treat Slate command output as JSON. Preserve IDs exactly.
- Reuse one `--idempotency-key` when retrying a task creation after an
  uncertain result.
```

A typical agent run looks like this:

```bash
slate auth status
slate tasks pull --limit 5
slate tasks claim <task-id>
slate tasks get <task-id>
# The agent performs the work and its checks.
slate tasks status <task-id> needs_review
```

Claiming is atomic. If another agent already claimed the task, the command
fails and the agent should choose another queued task. This prevents two agents
from silently doing the same work.

## Upgrade or uninstall

Run the one-line installer again to replace the current binary with the latest
release. The existing binary is only replaced after the new download passes
checksum verification.

To uninstall the default installation:

```bash
rm "$HOME/.local/bin/slate"
```

If you used `SLATE_INSTALL_DIR`, remove `slate` from that directory instead.

## Troubleshooting

- **`slate: command not found`**: Add `~/.local/bin` to `PATH`, then open a new
  terminal.
- **`SLATE_API_TOKEN is required`**: Create a token in Slate Settings and
  export it before running the command or starting your agent.
- **`unauthorized`**: The token is missing, invalid, or revoked. Create a new
  token and try `slate auth status` again.

For release archives and checksums, see
[Slate CLI v1.0.0](https://github.com/owainlewis/slate.do/releases/tag/v1.0.0)
or the [latest release](https://github.com/owainlewis/slate.do/releases/latest).
