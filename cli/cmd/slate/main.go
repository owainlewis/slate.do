package main

import (
	"bytes"
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
)

const defaultBaseURL = "https://slate.do"

var version = "dev"

type client struct {
	baseURL string
	token   string
	http    *http.Client
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
	c := client{
		baseURL: env("SLATE_BASE_URL", defaultBaseURL),
		token:   os.Getenv("SLATE_API_TOKEN"),
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

Usage:
  slate version
  slate help [auth|boards|lists|tasks]
  slate auth status
  slate boards <command>
  slate lists <command>
  slate tasks <command>

All successful command output is JSON. IDs are returned by list/get commands.
Run "slate help <topic>" for every command and flag.
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

"get" returns the board with all of its lists and tasks.
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
  slate tasks list [--board <board-id>] [--list <list-id>] [--status <status>] [--done <true|false>] [--limit <n>]
  slate tasks get <task-id>
  slate tasks pull [--board <board-id>] [--list <list-id>] [--limit <n>]
  slate tasks create --list <list-id> --title <title> [--description <text>] [--date <YYYY-MM-DD>] [--idempotency-key <key>] [--override-limit]
  slate tasks update <task-id> [--title <title>] [--description <text>] [--date <YYYY-MM-DD>] [--list <list-id>]
  slate tasks delete <task-id>
  slate tasks reorder --list <list-id> <task-id>...
  slate tasks claim <task-id>
  slate tasks status <task-id> queued|working|needs_review|done
  slate tasks done <task-id>

"pull" returns open queued tasks. Claim before starting work. Use an empty
--description or --date value to clear that field. "working" uses the atomic
claim operation, so only one agent can successfully claim a queued task.
Reuse --idempotency-key when retrying task creation after an uncertain result.
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
		maxTasks := fs.Int("max-tasks-per-list", 0, "default list limit")
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
		maxTasks := fs.Int("max-tasks-per-list", 0, "default list limit")
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
		var status, done *string
		if command == "list" {
			status = fs.String("status", "", "status filter")
			done = fs.String("done", "", "done filter")
		}
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if fs.NArg() != 0 {
			return errors.New("unexpected arguments")
		}
		q := url.Values{}
		setQuery(q, "boardId", *boardID)
		setQuery(q, "bucketId", *listID)
		if *limit > 0 {
			q.Set("limit", strconv.Itoa(*limit))
		}
		if status != nil {
			setQuery(q, "status", *status)
			setQuery(q, "done", *done)
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
		title := fs.String("title", "", "task title")
		description := fs.String("description", "", "task description")
		date := fs.String("date", "", "planned date")
		idempotencyKey := fs.String("idempotency-key", "", "stable key for safe retries")
		override := fs.Bool("override-limit", false, "override list limit")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		targetList := firstNonEmpty(*listID, *bucketID)
		if fs.NArg() != 0 || targetList == "" || strings.TrimSpace(*title) == "" {
			return errors.New("--list and --title are required")
		}
		body := map[string]any{"title": *title, "description": *description, "scheduledDate": *date, "kind": "action", "overrideLimit": *override}
		return c.sendJSONWithHeaders(http.MethodPost, "/api/v1/buckets/"+url.PathEscape(targetList)+"/tasks", body, map[string]string{"Idempotency-Key": *idempotencyKey})
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
		if err := fs.Parse(args[2:]); err != nil {
			return err
		}
		if fs.NArg() != 0 {
			return errors.New("unexpected arguments")
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
			}
		})
		if targetList := firstNonEmpty(*listID, *bucketID); targetList != "" {
			body["bucketId"] = targetList
		}
		if len(body) == 0 {
			return errors.New("at least one update flag is required")
		}
		return c.sendJSON(http.MethodPatch, "/api/v1/tasks/"+url.PathEscape(id), body)
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
		return c.sendJSON(http.MethodPost, "/api/v1/agent/tasks/"+url.PathEscape(id)+"/claim", map[string]any{})
	case "status":
		if len(args) != 3 {
			return errors.New("usage: slate tasks status <task-id> queued|working|needs_review|done")
		}
		if !validStatus(args[2]) {
			return fmt.Errorf("invalid status %q; choose queued, working, needs_review, or done", args[2])
		}
		if args[2] == "working" {
			return c.sendJSON(http.MethodPost, "/api/v1/agent/tasks/"+url.PathEscape(args[1])+"/claim", map[string]any{})
		}
		return c.sendJSON(http.MethodPatch, "/api/v1/agent/tasks/"+url.PathEscape(args[1])+"/status", map[string]any{"status": args[2]})
	case "done":
		id, err := singleID("slate tasks done <task-id>", args[1:])
		if err != nil {
			return err
		}
		return c.sendJSON(http.MethodPost, "/api/v1/agent/tasks/"+url.PathEscape(id)+"/done", map[string]any{})
	default:
		return fmt.Errorf("unknown tasks command %q; run 'slate help tasks'", args[0])
	}
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

func (c client) doWithHeaders(method string, path string, body any, headers map[string]string, target any) error {
	if c.token == "" {
		return errors.New("SLATE_API_TOKEN is required; create one in Slate settings")
	}
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, strings.TrimRight(c.baseURL, "/")+path, reader)
	if err != nil {
		return err
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
		return fmt.Errorf("slate API %d: %s", res.StatusCode, strings.TrimSpace(string(raw)))
	}
	if target != nil && len(raw) > 0 {
		return json.Unmarshal(raw, target)
	}
	return nil
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
	case "queued", "working", "needs_review", "done":
		return true
	default:
		return false
	}
}
