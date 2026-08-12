# Run a coding agent on your Slate tasks

`slate watch` gives one agent its own queue. It picks up tasks you have assigned
to that agent and marked Ready, runs your coding agent on each one in a throwaway
copy of your repository, and puts the finished work into Review for you.

The agent does the work and reports the result itself. The watcher only decides
what to offer it and keeps each attempt isolated.

Everything below has been run end to end against a real Slate server.

## Before you start

You need:

- A Slate agent and its token. Create the agent in Settings, then copy the token
  it shows you once.
- A Git repository, on a named branch, with nothing uncommitted.
- A coding agent on your `PATH`. Codex and Claude Code are covered below.
- macOS or Linux. The watcher has to be able to stop a whole tree of processes,
  and it does that with process groups.

## Set up a profile

A profile is one agent identity plus the command that runs it. Put it in
`slate/config.json` under your user configuration directory, or point
`SLATE_CONFIG` at a file of your own.

```json
{
  "profiles": {
    "codex": {
      "agentId": "4fb10cce-f7c8-43bb-9d43-9bcb2bacaf08",
      "tokenEnv": "SLATE_CODEX_TOKEN",
      "command": ["codex", "exec", "-"]
    },
    "claude": {
      "agentId": "9a3c71e2-05b8-4d2f-8c14-6f2b0d3a7e55",
      "tokenEnv": "SLATE_CLAUDE_TOKEN",
      "command": ["claude", "-p", "--permission-mode", "acceptEdits"]
    }
  }
}
```

Give each profile its own Slate agent. Two profiles sharing one agent compete
for the same queue, and the second to start refuses because the first already
has a task in progress.

- `agentId` is the ID Slate shows for the agent. The watcher refuses to start if
  the token belongs to somebody else, so a copy-paste mistake stops immediately
  instead of running work as the wrong identity.
- `tokenEnv` is the **name of the environment variable** holding the token, never
  the token itself. Nothing in the profile or in the run records ever contains a
  credential.
- `command` is the executor as an argument list. It is never passed through a
  shell, so nothing in it is expanded or interpreted.

Export the token in the shell you start the watcher from:

```bash
export SLATE_CODEX_TOKEN='<the agent token from Slate>'
```

Both commands above have been tested. Both read their prompt from standard input
and exit when they are done, which is what the watcher requires. If you use a
different agent, check it does the same.

The watcher passes your environment through to the executor, so whatever your
coding agent uses to authenticate itself needs to be present too. If you run the
watcher from a service manager that strips the environment, that is the first
thing to check when the executor fails to start.

## Start it

```bash
cd ~/code/my-project
slate watch --profile codex
```

It prints who it is running as, which repository it is watching, and then waits.

```
Watching as Codex (4fb10cce-…) from /Users/you/code/my-project on main.
```

Options:

- `--board <board-id>` limits it to one board. This scopes both the search for
  work and the check for work already in progress.
- `--workdir <path>` selects the repository. It defaults to the current
  directory. Your checkout is never used as the working directory for an agent.

## What happens to a task

1. The watcher finds the highest-priority, oldest Ready task assigned to that
   agent.
2. It creates a branch, `slate/<task-id>-<run>`, and a fresh worktree from your
   current commit, under your user cache directory.
3. It starts your coding agent there and hands it the task on standard input.
4. The agent claims the task, which moves it to In Progress. Only one run can win
   a claim, so two machines watching the same agent cannot both work the task.
5. The agent implements it, runs whatever checks the repository defines, commits,
   and submits a completion report. It cannot set the status itself: while a run
   owns a task, Slate refuses direct status changes with
   `managed_run_status_locked`. Claim reaches In Progress and the report reaches
   Review.
6. Submitting that report moves the task to Review. The watcher confirms the
   report belongs to its own run, stops the agent, and looks for the next task.
7. The worktree and its branch are **kept**, so you can read the change while
   you review the card. Nothing is deleted for you.

Your own checkout is untouched throughout. It is only ever read to create the
worktree.

Because successful runs are kept, they accumulate. A profile holds at most ten,
and at the limit the watcher stops and asks you to release one. Clearing them as
you finish reviewing is the normal habit; see [Retained runs](#retained-runs).

## When something does not finish

The watcher keeps the worktree in all three cases below, so nothing the agent did
is lost.

- **Blocked.** The agent could not finish and said why. The task stays In
  Progress. Read its comment on the card. The watcher stops.
- **Interrupted.** The agent exited without reporting. The task stays In
  Progress. The watcher stops.
- **Unplaceable.** The watcher could not tell whether the run ever held the task,
  usually because the server was unreachable at the wrong moment. Nothing is
  deleted, and the watcher carries on with the next task. These count toward the
  ten-run limit, so an unattended watcher that keeps producing them will
  eventually stop and ask you to clear some.

There is no automatic resume in this version. To retry a task, look at what the
run left behind, keep anything useful, then move the task back to Ready. The next
run starts from a clean copy.

Two cases are deleted automatically, both of which the watcher can prove never
held the task:

- A run that **lost the claim** to another watcher.
- A run whose agent **exited without ever claiming**, which usually means the
  executor is misconfigured or could not authenticate itself.

Their copies are disposable, and are removed even if the agent changed files
before it stopped. If your executor writes something you need before it claims,
it will not survive.

## Retained runs

```bash
slate runs list                    # every retained run
slate runs list --profile codex    # just this profile's
slate runs clean <run-id>          # release one
```

`clean` removes the worktree and keeps the branch, so any commits stay reachable.
It refuses if anything from the run is still running, or if the worktree has
uncommitted changes — it will never throw work away for you. Commit it or discard
it yourself first.

Each profile keeps at most ten. At the limit the watcher stops and tells you to
clean one, rather than filling the disk.

## Stopping

Ctrl-C. The watcher stops the coding agent and everything it started, and does
not change the task. If the agent ignores the polite signal it is killed. Nothing
is left running in the background.

## What it does about a struggling server

You should not need to think about this, but it explains the messages.

A quiet queue is polled every five seconds, backing off to about a minute so an
idle watcher is cheap. Connection failures, timeouts and 429, 500, 502, 503 and
504 are waited out and retried. If a rate-limited response names a delay, it
waits at least that long, up to five minutes. Anything else — a bad token, a deleted task — stops the
watcher with a message naming what happened, because retrying cannot help.

It never repeats a write on its own. Only the agent decides to resubmit its own
report, and it does that with a key that makes a duplicate impossible.

## Security

The agent gets its own Slate token, which can only touch tasks assigned to that
agent. It never gets your session or a personal token.

It runs in a throwaway worktree, not your checkout. That stops one run from
disturbing another, or from touching your working copy. It is not a sandbox: the
agent runs as you, and can reach anything you can. Task text is untrusted input to
whatever agent you point at it, so only watch boards and repositories you trust.

Nothing written to disk contains a credential. The run records are yours alone to
read, and the prompt the agent receives contains no token and not even the path of
the repository it came from.

## Troubleshooting

**"is already in progress"** — a task assigned to this agent is In Progress.
Finish it or move it back to Ready. If a previous run left it there, that is the
manual recovery described above.

**"has uncommitted changes"** — your checkout is dirty. The watcher branches from
your current commit, and refuses rather than quietly leaving your changes out.

**"is not on a named branch"** — you are on a detached HEAD. Check out a branch.

**"belongs to agent … but profile expects …"** — the token and `agentId` do not
match. Nothing was created; fix the profile.

**"does not support managed runs yet"** — the server is older than the CLI. Deploy
the server first; see below.

**"is holding 10 retained worktrees"** — clean one with `slate runs clean`.

**The executor exits immediately** — usually its own credentials are missing from
the environment. Run the same command by hand in the same shell to confirm.

## Releasing this

Order matters, because the CLI refuses to run against a server that does not
support it:

1. Apply the migration and deploy the server.
2. Confirm it advertises the capability: `slate auth status` shows
   `"managedRuns": true`.
3. Release the CLI.
4. Publish profiles for your agents.

To roll back, turn the server capability off first. New watchers then refuse to
start, instead of running against a server that has lost the contract underneath
them. The database columns are nullable and harmless to older code; dropping them
is a separate step once you are sure.
