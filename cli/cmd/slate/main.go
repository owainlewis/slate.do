package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const defaultBaseURL = "https://slate.do"

// cardEntryBytes matches the server limit so an oversized comment or output
// fails locally instead of spending a request.
const cardEntryBytes = 16 * 1024

// runIDHeader carries managed execution identity. It is not authority on its
// own; the server decides what the run may change.
const runIDHeader = "X-Slate-Run-ID"

var version = "dev"

type client struct {
	baseURL string
	token   string
	runID   string
	http    *http.Client
	// ctx cancels in-flight requests. A long-lived caller sets it so an
	// interrupt does not have to wait out the client timeout.
	ctx context.Context
}

// withContext returns a copy whose requests are cancelled with ctx.
func (c client) withContext(ctx context.Context) client {
	c.ctx = ctx
	return c
}

func main() {
	if err := run(os.Args); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) < 2 {
		return printHelp("")
	}
	// The environment is checked where a request is built, not here, so every
	// form of help still answers when a value is malformed.
	c := client{
		baseURL: env("SLATE_BASE_URL", defaultBaseURL),
		token:   os.Getenv("SLATE_API_TOKEN"),
		runID:   strings.TrimSpace(os.Getenv("SLATE_RUN_ID")),
		http:    &http.Client{Timeout: 30 * time.Second},
	}
	switch args[1] {
	case "help", "-h", "--help":
		topic := ""
		if len(args) > 2 {
			topic = args[2]
		}
		return printHelp(topic)
	case "version", "--version":
		return printVersion(args[2:], os.Stdout)
	case "auth":
		return authCmd(c, args[2:])
	case "boards":
		return boardsCmd(c, args[2:])
	case "lists", "buckets":
		return listsCmd(c, args[2:])
	case "tasks":
		return tasksCmd(c, args[2:])
	case "watch":
		return watchCmd(c, args[2:])
	case "runs":
		return runsCmd(args[2:])
	default:
		return fmt.Errorf("unknown command %q; run 'slate help'", args[1])
	}
}

func printVersion(args []string, w io.Writer) error {
	if len(args) != 0 {
		return errors.New("usage: slate version")
	}
	return json.NewEncoder(w).Encode(map[string]string{"version": version})
}

func printHelp(topic string) error {
	help, ok := helpText[topic]
	if !ok {
		return fmt.Errorf("unknown help topic %q; choose auth, boards, lists, or tasks", topic)
	}
	_, err := fmt.Fprint(os.Stdout, help)
	return err
}

var helpText = map[string]string{
	"": `Slate CLI controls boards, lists, tasks, and agent workflow.

Configuration:
  SLATE_API_TOKEN   Required API token created in Slate settings
  SLATE_BASE_URL    API URL (default: https://slate.do)
  SLATE_RUN_ID      Managed run identity set for an invoked coding agent

Usage:
  slate version
  slate help [auth|boards|lists|tasks|watch|runs]
  slate auth status
  slate boards <command>
  slate lists <command>
  slate tasks <command>
  slate watch --profile <name>
  slate runs <command>

All successful command output is JSON. IDs are returned by list/get commands.
Run "slate help <topic>" for every command and flag.
`,
	"watch": `Usage:
  slate watch --profile <name> [--board <board-id>] [--workdir <git-path>]

Runs one configured agent against its assigned Ready tasks. For each task the
watcher creates a disposable Git worktree from the current commit, starts the
profile's executor there with the task prompt on stdin, and watches that exact
run. The agent claims the task, does the work, and reports through the Slate
CLI. The watcher never claims or writes to the task itself.

The source checkout must be on a named branch with nothing uncommitted, and
--workdir defaults to the current directory. An executor never runs in it.

--board limits both the search for work and the check for a task already in
progress. A task already in progress stops startup: finish it or move it back
to Ready, because this version has no automatic resume.

Successful, blocked, and interrupted worktrees are kept for inspection. Only a
run that lost its claim is deleted. A profile keeps at most 10 of them; at the
limit no new run starts until one is released.

Profiles live in SLATE_CONFIG, or slate/config.json under the user
configuration directory:

  {
    "profiles": {
      "codex": {
        "agentId": "<the agent's Slate ID>",
        "tokenEnv": "SLATE_CODEX_TOKEN",
        "command": ["codex", "exec", "-"]
      }
    }
  }

The token itself is never stored, only the name of the variable holding it.
Profile changes take effect when the watcher restarts.
`,
	"runs": `Usage:
  slate runs list [--profile <name>]
  slate runs clean <run-id>

"list" shows retained runs and where their worktrees are. "clean" releases one
worktree once nothing from the run is running and the worktree is clean. It
never forces and it keeps the branch, so any commits stay reachable.
`,
	"auth": `Usage:
  slate auth status                 Verify the token and show its user
`,
	"boards": `Usage:
  slate boards list
  slate boards get <board-id>
  slate boards create --name <name> [--background-kind <kind>] [--background-value <value>] [--max-tasks-per-list <n>]
  slate boards update <board-id> [--name <name>] [--background-kind <kind>] [--background-value <value>] [--max-tasks-per-list <n>] [--sort-order <n>]
  slate boards delete <board-id>

"get" returns every active item and the 20 most recently updated completed
items per list. Use "tasks list --status done" to page older completed work.
`,
	"lists": `Usage:
  slate lists list --board <board-id>
  slate lists get <list-id>
  slate lists create --board <board-id> --name <name> [--goal <goal>] [--inbox]
  slate lists update <list-id> [--name <name>] [--goal <goal>] [--inbox=true|false] [--sort-order <n>]
  slate lists delete <list-id>
  slate lists reorder --board <board-id> <list-id>...

"buckets" is accepted as an alias for "lists".
`,
	"tasks": `Usage:
  slate tasks list [--board <board-id>] [--list <list-id>] [--status <status>] [--priority <p0|p1|p2>] [--limit <n>] [--cursor <cursor>]
  slate tasks get <task-id>
  slate tasks pull [--board <board-id>] [--list <list-id>] [--priority <p0|p1|p2>] [--limit <n>]
  slate tasks create --title <title> [--list <list-id> | --parent <task-id>] [--description <text>] [--date <YYYY-MM-DD>] [--idempotency-key <key>]
  slate tasks update <task-id> [--title <title>] [--description <text>] [--date <YYYY-MM-DD>] [--list <list-id>] [--priority <p0|p1|p2>]
  slate tasks delete <task-id>
  slate tasks reorder --list <list-id> <task-id>...
  slate tasks claim <task-id>
  slate tasks status <task-id> new|queued|working|needs_review|done
  slate tasks entries <task-id> [--run <run-id>]
  slate tasks comment <task-id> (--body <text> | --file <path>) --idempotency-key <key>
  slate tasks output <task-id> (--body <text> | --file <path>) --idempotency-key <key>

"pull" returns open queued tasks, highest priority and oldest first. Claim
before starting work. Use an empty --description or --date value to clear that
field, or an empty --priority to clear the priority. "working" uses the atomic
claim operation, so only one agent can successfully claim a queued task.
Reuse --idempotency-key when retrying task creation after an uncertain result.
Task collections omit descriptions. Use "tasks get" for complete task detail.
Completed pages default to 20 items and return nextCursor for --cursor.

"comment" records progress and leaves the card in place. "output" records the
completion report and moves the card to review in the same operation. Both take
exactly one of --body or --file; "--file -" reads stdin. Bodies are limited to
16 KiB. Both require --idempotency-key: reuse the same value to retry safely
after an uncertain result.

When SLATE_RUN_ID is set, claim, status, update, comment, and output identify
their managed run to the server. A managed run reaches working through claim
and review through output, so its direct status changes are refused with
managed_run_status_locked. A losing or stale run receives run_conflict, and so
does any command aimed at a task the run did not claim. "entries --run" returns
only the entries of that exact run.
`,
}

func authCmd(c client, args []string) error {
	if wantsHelp(args) {
		return printHelp("auth")
	}
	if len(args) != 1 || args[0] != "status" {
		return errors.New("usage: slate auth status; run 'slate help auth'")
	}
	return c.getJSON("/api/v1/me", nil)
}

func boardsCmd(c client, args []string) error {
	if wantsHelp(args) {
		return printHelp("boards")
	}
	if len(args) < 1 {
		return errors.New("usage: slate boards <command>; run 'slate help boards'")
	}
	switch args[0] {
	case "list":
		if len(args) != 1 {
			return errors.New("usage: slate boards list")
		}
		return c.getJSON("/api/v1/boards", nil)
	case "get":
		id, err := singleID("slate boards get <board-id>", args[1:])
		if err != nil {
			return err
		}
		return c.getJSON("/api/v1/boards/"+url.PathEscape(id), nil)
	case "create":
		fs := newFlagSet("boards create")
		name := fs.String("name", "", "board name")
		backgroundKind := fs.String("background-kind", "", "background kind")
		backgroundValue := fs.String("background-value", "", "background value")
		maxTasks := fs.Int("max-tasks-per-list", 0, "Max active items per list")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if fs.NArg() != 0 || strings.TrimSpace(*name) == "" {
			return errors.New("--name is required")
		}
		body := map[string]any{"name": *name, "backgroundKind": *backgroundKind, "backgroundValue": *backgroundValue, "maxTasksPerList": *maxTasks}
		return c.sendJSON(http.MethodPost, "/api/v1/boards", body)
	case "update":
		if len(args) < 2 {
			return errors.New("usage: slate boards update <board-id> [flags]")
		}
		id := args[1]
		fs := newFlagSet("boards update")
		name := fs.String("name", "", "board name")
		backgroundKind := fs.String("background-kind", "", "background kind")
		backgroundValue := fs.String("background-value", "", "background value")
		maxTasks := fs.Int("max-tasks-per-list", 0, "Max active items per list")
		sortOrder := fs.Int("sort-order", 0, "sort order")
		if err := fs.Parse(args[2:]); err != nil {
			return err
		}
		if fs.NArg() != 0 {
			return errors.New("unexpected arguments")
		}
		body := visitedValues(fs, map[string]any{
			"name": *name, "background-kind": *backgroundKind, "background-value": *backgroundValue,
			"max-tasks-per-list": *maxTasks, "sort-order": *sortOrder,
		}, map[string]string{
			"background-kind": "backgroundKind", "background-value": "backgroundValue",
			"max-tasks-per-list": "maxTasksPerList", "sort-order": "sortOrder",
		})
		if len(body) == 0 {
			return errors.New("at least one update flag is required")
		}
		return c.sendJSON(http.MethodPatch, "/api/v1/boards/"+url.PathEscape(id), body)
	case "delete":
		id, err := singleID("slate boards delete <board-id>", args[1:])
		if err != nil {
			return err
		}
		return c.sendJSON(http.MethodDelete, "/api/v1/boards/"+url.PathEscape(id), nil)
	default:
		return fmt.Errorf("unknown boards command %q; run 'slate help boards'", args[0])
	}
}

func listsCmd(c client, args []string) error {
	if wantsHelp(args) {
		return printHelp("lists")
	}
	if len(args) < 1 {
		return errors.New("usage: slate lists <command>; run 'slate help lists'")
	}
	switch args[0] {
	case "list":
		fs := newFlagSet("lists list")
		boardID := fs.String("board", "", "board id")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if fs.NArg() != 0 || *boardID == "" {
			return errors.New("--board is required")
		}
		var board struct {
			Buckets []json.RawMessage `json:"buckets"`
		}
		if err := c.do(http.MethodGet, "/api/v1/boards/"+url.PathEscape(*boardID), nil, &board); err != nil {
			return err
		}
		if board.Buckets == nil {
			board.Buckets = []json.RawMessage{}
		}
		return printJSON(map[string]any{"lists": board.Buckets})
	case "get":
		id, err := singleID("slate lists get <list-id>", args[1:])
		if err != nil {
			return err
		}
		return c.getJSON("/api/v1/buckets/"+url.PathEscape(id), nil)
	case "create":
		fs := newFlagSet("lists create")
		boardID := fs.String("board", "", "board id")
		name := fs.String("name", "", "list name")
		goal := fs.String("goal", "", "list goal")
		inbox := fs.Bool("inbox", false, "make this the inbox")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if fs.NArg() != 0 || *boardID == "" || strings.TrimSpace(*name) == "" {
			return errors.New("--board and --name are required")
		}
		body := map[string]any{"name": *name, "goal": *goal, "isInbox": *inbox}
		return c.sendJSON(http.MethodPost, "/api/v1/boards/"+url.PathEscape(*boardID)+"/buckets", body)
	case "update":
		if len(args) < 2 {
			return errors.New("usage: slate lists update <list-id> [flags]")
		}
		id := args[1]
		fs := newFlagSet("lists update")
		name := fs.String("name", "", "list name")
		goal := fs.String("goal", "", "list goal")
		inbox := fs.Bool("inbox", false, "set or clear inbox status")
		sortOrder := fs.Int("sort-order", 0, "sort order")
		if err := fs.Parse(args[2:]); err != nil {
			return err
		}
		if fs.NArg() != 0 {
			return errors.New("unexpected arguments")
		}
		body := visitedValues(fs, map[string]any{"name": *name, "goal": *goal, "inbox": *inbox, "sort-order": *sortOrder}, map[string]string{"inbox": "isInbox", "sort-order": "sortOrder"})
		if len(body) == 0 {
			return errors.New("at least one update flag is required")
		}
		return c.sendJSON(http.MethodPatch, "/api/v1/buckets/"+url.PathEscape(id), body)
	case "delete":
		id, err := singleID("slate lists delete <list-id>", args[1:])
		if err != nil {
			return err
		}
		return c.sendJSON(http.MethodDelete, "/api/v1/buckets/"+url.PathEscape(id), nil)
	case "reorder":
		fs := newFlagSet("lists reorder")
		boardID := fs.String("board", "", "board id")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if *boardID == "" || fs.NArg() == 0 {
			return errors.New("--board and at least one list id are required")
		}
		return c.sendJSON(http.MethodPost, "/api/v1/boards/"+url.PathEscape(*boardID)+"/reorder-buckets", map[string]any{"ids": fs.Args()})
	default:
		return fmt.Errorf("unknown lists command %q; run 'slate help lists'", args[0])
	}
}

func tasksCmd(c client, args []string) error {
	if wantsHelp(args) {
		return printHelp("tasks")
	}
	if len(args) < 1 {
		return errors.New("usage: slate tasks <command>; run 'slate help tasks'")
	}
	switch args[0] {
	case "list", "pull":
		command := args[0]
		fs := newFlagSet("tasks " + command)
		boardID := fs.String("board", "", "board id")
		listID := fs.String("list", "", "list id")
		limit := fs.Int("limit", 0, "maximum tasks")
		priority := fs.String("priority", "", "priority filter: p0, p1, or p2")
		var status, cursor *string
		if command == "list" {
			status = fs.String("status", "", "status filter")
			cursor = fs.String("cursor", "", "completed history cursor")
		}
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if fs.NArg() != 0 {
			return errors.New("unexpected arguments")
		}
		if !validPriority(*priority) {
			return fmt.Errorf("invalid priority %q; choose p0, p1, or p2", *priority)
		}
		q := url.Values{}
		setQuery(q, "boardId", *boardID)
		setQuery(q, "bucketId", *listID)
		setQuery(q, "priority", *priority)
		if *limit > 0 {
			q.Set("limit", strconv.Itoa(*limit))
		}
		if status != nil {
			setQuery(q, "status", *status)
			setQuery(q, "cursor", *cursor)
		}
		path := "/api/v1/tasks"
		if command == "pull" {
			path = "/api/v1/agent/tasks"
		}
		return c.getJSON(path, q)
	case "get":
		id, err := singleID("slate tasks get <task-id>", args[1:])
		if err != nil {
			return err
		}
		return c.getJSON("/api/v1/tasks/"+url.PathEscape(id), nil)
	case "create":
		fs := newFlagSet("tasks create")
		listID := fs.String("list", "", "list id")
		bucketID := fs.String("bucket", "", "deprecated alias for --list")
		parentID := fs.String("parent", "", "parent task id for a subtask")
		title := fs.String("title", "", "task title")
		description := fs.String("description", "", "task description")
		date := fs.String("date", "", "planned date")
		idempotencyKey := fs.String("idempotency-key", "", "stable key for safe retries")
		override := fs.Bool("override-limit", false, "deprecated compatibility flag; Lists no longer reject tasks by count")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		targetList := firstNonEmpty(*listID, *bucketID)
		if fs.NArg() != 0 || strings.TrimSpace(*title) == "" {
			return errors.New("--title is required")
		}
		if targetList != "" && strings.TrimSpace(*parentID) != "" {
			return errors.New("choose --list or --parent, not both")
		}
		body := map[string]any{"title": *title, "description": *description, "scheduledDate": *date, "kind": "action", "overrideLimit": *override}
		path := "/api/v1/tasks"
		if targetList != "" {
			path = "/api/v1/buckets/" + url.PathEscape(targetList) + "/tasks"
		} else if strings.TrimSpace(*parentID) != "" {
			path = "/api/v1/tasks/" + url.PathEscape(strings.TrimSpace(*parentID)) + "/subtasks"
		}
		return c.sendJSONWithHeaders(http.MethodPost, path, body, map[string]string{"Idempotency-Key": *idempotencyKey})
	case "update":
		if len(args) < 2 {
			return errors.New("usage: slate tasks update <task-id> [flags]")
		}
		id := args[1]
		fs := newFlagSet("tasks update")
		title := fs.String("title", "", "title")
		description := fs.String("description", "", "description")
		date := fs.String("date", "", "planned date")
		listID := fs.String("list", "", "list id")
		bucketID := fs.String("bucket", "", "deprecated alias for --list")
		priority := fs.String("priority", "", "priority: p0, p1, p2, or empty to clear")
		if err := fs.Parse(args[2:]); err != nil {
			return err
		}
		if fs.NArg() != 0 {
			return errors.New("unexpected arguments")
		}
		if !validPriority(*priority) {
			return fmt.Errorf("invalid priority %q; choose p0, p1, p2, or an empty value to clear", *priority)
		}
		body := map[string]any{}
		fs.Visit(func(item *flag.Flag) {
			switch item.Name {
			case "title":
				body["title"] = *title
			case "description":
				body["description"] = *description
			case "date":
				body["scheduledDate"] = *date
			case "priority":
				body["priority"] = *priority
			}
		})
		if targetList := firstNonEmpty(*listID, *bucketID); targetList != "" {
			body["bucketId"] = targetList
		}
		if len(body) == 0 {
			return errors.New("at least one update flag is required")
		}
		// The server fences this route too, so a managed run must identify
		// itself or it cannot edit the task it claimed.
		return c.sendJSONWithHeaders(http.MethodPatch, "/api/v1/tasks/"+url.PathEscape(id), body, c.runHeaders(nil))
	case "delete":
		id, err := singleID("slate tasks delete <task-id>", args[1:])
		if err != nil {
			return err
		}
		return c.sendJSON(http.MethodDelete, "/api/v1/tasks/"+url.PathEscape(id), nil)
	case "reorder":
		fs := newFlagSet("tasks reorder")
		listID := fs.String("list", "", "list id")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if *listID == "" || fs.NArg() == 0 {
			return errors.New("--list and at least one task id are required")
		}
		return c.sendJSON(http.MethodPost, "/api/v1/buckets/"+url.PathEscape(*listID)+"/reorder-tasks", map[string]any{"ids": fs.Args()})
	case "claim":
		id, err := singleID("slate tasks claim <task-id>", args[1:])
		if err != nil {
			return err
		}
		return c.sendJSONWithHeaders(http.MethodPost, "/api/v1/agent/tasks/"+url.PathEscape(id)+"/claim", map[string]any{}, c.runHeaders(nil))
	case "status":
		if len(args) != 3 {
			return errors.New("usage: slate tasks status <task-id> new|queued|working|needs_review|done")
		}
		if !validStatus(args[2]) {
			return fmt.Errorf("invalid status %q; choose new, queued, working, needs_review, or done", args[2])
		}
		if args[2] == "working" {
			return c.sendJSONWithHeaders(http.MethodPost, "/api/v1/agent/tasks/"+url.PathEscape(args[1])+"/claim", map[string]any{}, c.runHeaders(nil))
		}
		return c.sendJSONWithHeaders(http.MethodPatch, "/api/v1/agent/tasks/"+url.PathEscape(args[1])+"/status", map[string]any{"status": args[2]}, c.runHeaders(nil))
	case "entries":
		if len(args) < 2 {
			return errors.New("usage: slate tasks entries <task-id> [--run <run-id>]")
		}
		id := args[1]
		fs := newFlagSet("tasks entries")
		run := fs.String("run", "", "return only entries from this managed run")
		if err := fs.Parse(args[2:]); err != nil {
			return err
		}
		if fs.NArg() != 0 || strings.TrimSpace(id) == "" {
			return errors.New("usage: slate tasks entries <task-id> [--run <run-id>]")
		}
		q := url.Values{}
		if selected := strings.TrimSpace(*run); selected != "" {
			if !validUUID(selected) {
				return fmt.Errorf("invalid run ID %q", selected)
			}
			q.Set("runId", selected)
		}
		return c.getJSON("/api/v1/tasks/"+url.PathEscape(id)+"/entries", q)
	case "comment", "output":
		return c.entryCmd(args[0], args[1:])
	default:
		return fmt.Errorf("unknown tasks command %q; run 'slate help tasks'", args[0])
	}
}

// entryCmd posts a comment or an output. Both carry the managed run when one is
// set, and both require a stable key so an uncertain result can be repeated.
func (c client) entryCmd(kind string, args []string) error {
	if len(args) < 1 {
		return fmt.Errorf("usage: slate tasks %s <task-id> (--body <text> | --file <path>) --idempotency-key <key>", kind)
	}
	id := strings.TrimSpace(args[0])
	if id == "" {
		return fmt.Errorf("usage: slate tasks %s <task-id> (--body <text> | --file <path>) --idempotency-key <key>", kind)
	}
	fs := newFlagSet("tasks " + kind)
	body := fs.String("body", "", "entry text")
	file := fs.String("file", "", "read the entry from a file, or - for stdin")
	idempotencyKey := fs.String("idempotency-key", "", "stable key for safe retries")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("unexpected arguments")
	}
	// Everything that makes the command invalid is checked before the body is
	// read, because a stdin or FIFO source may never finish and reading first
	// would hang instead of reporting the mistake.
	key := strings.TrimSpace(*idempotencyKey)
	if key == "" {
		return fmt.Errorf("--idempotency-key is required; reuse the same value when retrying a %s", kind)
	}
	if err := c.ready(); err != nil {
		return err
	}
	text, err := entryText(fs, *body, *file, os.Stdin)
	if err != nil {
		return err
	}
	headers := c.runHeaders(map[string]string{"Idempotency-Key": key})
	return c.sendJSONWithHeaders(http.MethodPost, "/api/v1/tasks/"+url.PathEscape(id)+"/entries",
		map[string]any{"kind": kind, "body": text}, headers)
}

// entryText resolves exactly one body source and enforces the stored size limit
// before a request is spent.
func entryText(fs *flag.FlagSet, body string, file string, stdin io.Reader) (string, error) {
	usedBody := false
	usedFile := false
	fs.Visit(func(item *flag.Flag) {
		switch item.Name {
		case "body":
			usedBody = true
		case "file":
			usedFile = true
		}
	})
	if usedBody == usedFile {
		return "", errors.New("choose exactly one of --body or --file")
	}
	text := body
	if usedFile {
		source := stdin
		if file != "-" {
			opened, err := os.Open(file)
			if err != nil {
				return "", err
			}
			defer opened.Close()
			source = opened
		}
		raw, err := readTrimmedEntry(source, cardEntryBytes)
		if err != nil {
			return "", err
		}
		text = raw
	}
	// The server trims before it measures and stores, so measuring the trimmed
	// text here keeps a file that ends in a newline from failing locally when
	// the server would have accepted it.
	text = strings.TrimSpace(text)
	if text == "" {
		return "", errors.New("entry body is required")
	}
	if len([]byte(text)) > cardEntryBytes {
		return "", fmt.Errorf("entry body must be %d UTF-8 bytes or fewer", cardEntryBytes)
	}
	return text, nil
}

// entryStreamCap stops an endless source. Only whitespace can legitimately run
// past the stored limit, and no real report is followed by megabytes of it.
const entryStreamCap = 8 << 20

// readTrimmedEntry reads a body source, trimming as it goes, so an unbounded
// stdin or a mistakenly chosen artifact cannot exhaust memory. It holds no more
// than the stored limit of content plus the run of whitespace it has not yet
// decided about, and it accepts exactly what the server would: the body after
// trimming, however much removable whitespace surrounds it. Whitespace means
// what strings.TrimSpace means, so a non-breaking space trims here too.
func readTrimmedEntry(source io.Reader, limit int) (string, error) {
	tooLarge := fmt.Errorf("entry body must be %d UTF-8 bytes or fewer", limit)
	reader := bufio.NewReaderSize(source, 32*1024)
	var body []byte
	// Whitespace is held back until something follows it. Trailing whitespace
	// is dropped at the end; interior whitespace is part of the body.
	var pending []byte
	pendingOverflowed := false
	total := 0
	for {
		r, size, err := reader.ReadRune()
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return "", err
		}
		total += size
		if total > entryStreamCap {
			// Only whitespace can legitimately run this far, since content is
			// capped at the stored limit, so say that rather than blame a body
			// size the caller cannot see.
			return "", fmt.Errorf("entry body could not be read: more than %d MiB of surrounding whitespace", entryStreamCap>>20)
		}
		if unicode.IsSpace(r) {
			if len(body) == 0 {
				// Leading whitespace is dropped outright.
				continue
			}
			if pendingOverflowed {
				continue
			}
			pending = utf8.AppendRune(pending, r)
			if len(pending) > limit {
				// Whatever this run turns out to be, keeping it would put the
				// body over the limit, so stop storing it.
				pendingOverflowed = true
				pending = nil
			}
			continue
		}
		if pendingOverflowed || len(body)+len(pending)+size > limit {
			return "", tooLarge
		}
		body = append(body, pending...)
		pending = nil
		body = utf8.AppendRune(body, r)
	}
	return string(body), nil
}

// runHeaders adds managed execution identity to a mutation without disturbing
// the caller's own headers.
func (c client) runHeaders(headers map[string]string) map[string]string {
	if c.runID == "" {
		return headers
	}
	combined := make(map[string]string, len(headers)+1)
	for name, value := range headers {
		combined[name] = value
	}
	combined[runIDHeader] = c.runID
	return combined
}

func (c client) getJSON(path string, q url.Values) error {
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var out any
	if err := c.do(http.MethodGet, path, nil, &out); err != nil {
		return err
	}
	return printJSON(out)
}

func (c client) sendJSON(method string, path string, body any) error {
	return c.sendJSONWithHeaders(method, path, body, nil)
}

func (c client) sendJSONWithHeaders(method string, path string, body any, headers map[string]string) error {
	var out any
	if err := c.doWithHeaders(method, path, body, headers, &out); err != nil {
		return err
	}
	return printJSON(out)
}

func (c client) do(method string, path string, body any, target any) error {
	return c.doWithHeaders(method, path, body, nil, target)
}

// ready reports whether the environment can produce a request at all. It is
// checked before a body source is consumed as well as before a request is sent,
// so an already-invalid command never blocks on a source that may not end.
func (c client) ready() error {
	if c.token == "" {
		return errors.New("SLATE_API_TOKEN is required; create one in Slate settings")
	}
	if c.runID != "" && !validUUID(c.runID) {
		return errors.New("SLATE_RUN_ID must be a valid run ID")
	}
	return nil
}

func (c client) doWithHeaders(method string, path string, body any, headers map[string]string, target any) error {
	// Checked here too so a malformed value fails before anything is sent,
	// while help, version, and local argument errors still work.
	if err := c.ready(); err != nil {
		return err
	}
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	}
	requestCtx := c.ctx
	if requestCtx == nil {
		requestCtx = context.Background()
	}
	req, err := http.NewRequestWithContext(requestCtx, method, strings.TrimRight(c.baseURL, "/")+path, reader)
	if err != nil {
		return &requestBuildError{err: err}
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	for name, value := range headers {
		if strings.TrimSpace(value) != "" {
			req.Header.Set(name, value)
		}
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return newAPIError(res, raw)
	}
	if target != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, target); err != nil {
			return &responseFormatError{Status: res.StatusCode, err: err}
		}
	}
	return nil
}

// APIError keeps the parts of a failed response a caller can act on: the HTTP
// status, the server's error code, its message, and any Retry-After. It carries
// only the response, never the request, so no credential can reach a log.
type APIError struct {
	Status     int
	Code       string
	Message    string
	Body       string
	RetryAfter string
}

func (e *APIError) Error() string {
	message := e.Message
	if message == "" {
		message = e.Body
	}
	text := fmt.Sprintf("slate API %d", e.Status)
	if e.Code != "" {
		text += " " + e.Code
	}
	if message != "" {
		text += ": " + message
	}
	if e.RetryAfter != "" {
		// Retry-After is delta-seconds or an HTTP date. Only the numeric form
		// takes a unit, so a proxy sending a date still reads correctly.
		if _, err := strconv.Atoi(e.RetryAfter); err == nil {
			text += " (retry after " + e.RetryAfter + "s)"
		} else {
			text += " (retry after " + e.RetryAfter + ")"
		}
	}
	return text
}

func newAPIError(res *http.Response, raw []byte) *APIError {
	failure := &APIError{
		Status:     res.StatusCode,
		Body:       strings.TrimSpace(string(raw)),
		RetryAfter: strings.TrimSpace(res.Header.Get("Retry-After")),
	}
	var payload struct {
		Code  string `json:"code"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(raw, &payload); err == nil {
		failure.Code = strings.TrimSpace(payload.Code)
		failure.Message = strings.TrimSpace(payload.Error)
	}
	return failure
}

// requestBuildError marks a request that could not be formed at all, which in
// practice means SLATE_BASE_URL is not a usable address. It is permanent, so a
// caller that retries transient failures must not retry this.
type requestBuildError struct{ err error }

func (e *requestBuildError) Error() string {
	return fmt.Sprintf("SLATE_BASE_URL is not a usable address: %v", e.err)
}

func (e *requestBuildError) Unwrap() error { return e.err }

// responseFormatError marks a reply that was not the API's, such as an error
// page from a proxy served with a success status. Repeating the request will
// keep producing it, so callers treat it as final rather than transient.
type responseFormatError struct {
	Status int
	err    error
}

func (e *responseFormatError) Error() string {
	return fmt.Sprintf("slate API %d returned a reply that is not JSON: %v", e.Status, e.err)
}

func (e *responseFormatError) Unwrap() error { return e.err }

// validUUID accepts the canonical form the server issues for task, agent, and
// run identifiers.
func validUUID(value string) bool {
	if len(value) != 36 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' {
		return false
	}
	for index, char := range value {
		switch index {
		case 8, 13, 18, 23:
			continue
		}
		if !(char >= '0' && char <= '9') && !(char >= 'a' && char <= 'f') && !(char >= 'A' && char <= 'F') {
			return false
		}
	}
	return true
}

func printJSON(value any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(value)
}

func env(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func newFlagSet(name string) *flag.FlagSet {
	return flag.NewFlagSet(name, flag.ContinueOnError)
}

func wantsHelp(args []string) bool {
	return len(args) == 0 || (len(args) == 1 && (args[0] == "help" || args[0] == "-h" || args[0] == "--help"))
}

func singleID(usage string, args []string) (string, error) {
	if len(args) != 1 || strings.TrimSpace(args[0]) == "" {
		return "", errors.New("usage: " + usage)
	}
	return args[0], nil
}

func visitedValues(fs *flag.FlagSet, values map[string]any, names map[string]string) map[string]any {
	body := map[string]any{}
	fs.Visit(func(item *flag.Flag) {
		name := item.Name
		if renamed := names[name]; renamed != "" {
			name = renamed
		}
		body[name] = values[item.Name]
	})
	return body
}

func setQuery(q url.Values, key string, value string) {
	if strings.TrimSpace(value) != "" {
		q.Set(key, value)
	}
}

func validStatus(status string) bool {
	switch status {
	case "new", "queued", "working", "needs_review", "done":
		return true
	default:
		return false
	}
}

func validPriority(priority string) bool {
	switch priority {
	case "", "p0", "p1", "p2":
		return true
	default:
		return false
	}
}
