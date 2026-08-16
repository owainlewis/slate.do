package main

import (
	"fmt"
	"strings"
)

// promptDetails is everything an executor is told. It deliberately excludes the
// credential, the task description, the conversation, and the source checkout
// path: the agent reads task content through its own authorized commands after
// it claims, and it must never learn where the source repository lives.
type promptDetails struct {
	AgentID      string
	AgentName    string
	AgentPurpose string
	TaskID       string
	TaskTitle    string
	TaskPriority string
	ListName     string
	RunID        string
	Worktree     string
	Branch       string
}

func (d promptDetails) commentKey() string {
	return "watch-run:" + d.TaskID + ":" + d.RunID + ":blocked"
}

func (d promptDetails) outputKey() string {
	return "watch-run:" + d.TaskID + ":" + d.RunID + ":output"
}

// buildPrompt writes the contract an executor works under. The claim rule comes
// first because everything else depends on winning it.
func buildPrompt(d promptDetails) string {
	var b strings.Builder
	write := func(format string, args ...any) {
		fmt.Fprintf(&b, format+"\n", args...)
	}

	write("You are the Slate agent %q (ID %s).", d.AgentName, d.AgentID)
	if strings.TrimSpace(d.AgentPurpose) != "" {
		write("Your purpose: %s", strings.TrimSpace(d.AgentPurpose))
	}
	write("")
	write("You have been offered one task. Its title is %q.", d.TaskTitle)
	write("Task ID: %s", d.TaskID)
	if d.TaskPriority != "" {
		write("Priority: %s", d.TaskPriority)
	}
	if d.ListName != "" {
		write("List: %s", d.ListName)
	}
	write("Run ID: %s", d.RunID)
	write("Working directory: %s", d.Worktree)
	write("Branch: %s", d.Branch)
	write("")
	write("This directory is a disposable Git worktree created for this run. Work")
	write("only inside it. Do not look for or modify the repository it came from.")
	write("")
	write("Claim the task before anything else:")
	write("")
	write("    \"$SLATE_BIN\" tasks claim %s", d.TaskID)
	write("")
	write("If the claim fails, another run won it. Stop immediately and exit without")
	write("changing anything further. Only the winning run may continue.")
	write("")
	write("After a successful claim, read the task and its conversation:")
	write("")
	write("    \"$SLATE_BIN\" tasks get %s", d.TaskID)
	write("    \"$SLATE_BIN\" tasks entries %s", d.TaskID)
	write("")
	write("Then read any repository instructions, such as AGENTS.md, CLAUDE.md, or")
	write("README.md, and follow them. Implement the task in this worktree and run")
	write("the checks the repository defines. Do not skip verification.")
	write("")
	write("Write any note or report to a file OUTSIDE this worktree, such as one")
	write("under ${TMPDIR:-/tmp}. A stray file left here counts as uncommitted work and")
	write("will block the worktree from being cleaned up later.")
	write("")
	write("If you cannot finish, report why and stop:")
	write("")
	write("    \"$SLATE_BIN\" tasks comment %s \\", d.TaskID)
	write("      --file \"${TMPDIR:-/tmp}/slate-note-$SLATE_RUN_ID.md\" \\")
	write("      --idempotency-key %s", d.commentKey())
	write("")
	write("The task stays in progress and a person will pick it up.")
	write("")
	write("When the work is done and verified, submit your completion report:")
	write("")
	write("    \"$SLATE_BIN\" tasks output %s \\", d.TaskID)
	write("      --file \"${TMPDIR:-/tmp}/slate-report-$SLATE_RUN_ID.md\" \\")
	write("      --idempotency-key %s", d.outputKey())
	write("")
	write("The report states what changed, which checks you ran and their results,")
	write("the branch and any commit or pull request, and anything a reviewer should")
	write("know. Submitting the output moves the task to review; do not try to set")
	write("its status directly, because that is refused for this run.")
	write("")
	write("If a command returns an uncertain result, repeat it with the same")
	write("idempotency key. That is safe and will not create a duplicate.")
	write("")
	write("Commit anything you want a reviewer to see, and leave nothing")
	write("uncommitted in this worktree. Exit as soon as you have posted your")
	write("comment or your output.")
	return b.String()
}
