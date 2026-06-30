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
	"strings"
)

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
		return usage()
	}
	c := client{
		baseURL: env("SLATE_BASE_URL", "http://localhost:8080"),
		token:   os.Getenv("SLATE_API_TOKEN"),
		http:    http.DefaultClient,
	}
	switch args[1] {
	case "auth":
		return authCmd(c, args[2:])
	case "boards":
		return boardsCmd(c, args[2:])
	case "tasks":
		return tasksCmd(c, args[2:])
	default:
		return usage()
	}
}

func usage() error {
	return errors.New("usage: slate auth status|boards list|tasks list|pull|create|update|claim|status|done|note")
}

func authCmd(c client, args []string) error {
	if len(args) != 1 || args[0] != "status" {
		return usage()
	}
	var out any
	if err := c.do(http.MethodGet, "/api/v1/me", nil, &out); err != nil {
		return err
	}
	return printJSON(out)
}

func boardsCmd(c client, args []string) error {
	if len(args) != 1 || args[0] != "list" {
		return usage()
	}
	var out any
	if err := c.do(http.MethodGet, "/api/v1/boards", nil, &out); err != nil {
		return err
	}
	return printJSON(out)
}

func tasksCmd(c client, args []string) error {
	if len(args) < 1 {
		return usage()
	}
	switch args[0] {
	case "list":
		fs := flag.NewFlagSet("tasks list", flag.ContinueOnError)
		assignee := fs.String("assignee", "", "assignee filter")
		status := fs.String("status", "", "status filter")
		done := fs.String("done", "", "done filter")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		q := url.Values{}
		if *assignee != "" {
			q.Set("assignee", *assignee)
		}
		if *status != "" {
			q.Set("status", *status)
		}
		if *done != "" {
			q.Set("done", *done)
		}
		return c.getJSON("/api/v1/tasks", q)
	case "pull":
		fs := flag.NewFlagSet("tasks pull", flag.ContinueOnError)
		assignee := fs.String("assignee", "", "assignee")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if *assignee == "" {
			return errors.New("--assignee is required")
		}
		q := url.Values{"assignee": {*assignee}}
		return c.getJSON("/api/v1/agent/tasks", q)
	case "create":
		fs := flag.NewFlagSet("tasks create", flag.ContinueOnError)
		bucket := fs.String("bucket", "", "bucket id")
		list := fs.String("list", "", "list id")
		title := fs.String("title", "", "task title")
		assignee := fs.String("assignee", "", "assignee")
		due := fs.String("due", "", "due date YYYY-MM-DD")
		brief := fs.String("brief", "", "agent brief")
		override := fs.Bool("override-limit", false, "override list limit")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		targetList := firstNonEmpty(*list, *bucket)
		if targetList == "" || *title == "" {
			return errors.New("--list and --title are required")
		}
		body := map[string]any{"title": *title, "assignee": *assignee, "dueDate": *due, "agentBrief": *brief, "overrideLimit": *override}
		var out any
		if err := c.do(http.MethodPost, "/api/v1/buckets/"+url.PathEscape(targetList)+"/tasks", body, &out); err != nil {
			return err
		}
		return printJSON(out)
	case "update":
		if len(args) < 2 {
			return errors.New("task id is required")
		}
		id := args[1]
		fs := flag.NewFlagSet("tasks update", flag.ContinueOnError)
		title := fs.String("title", "", "title")
		bucket := fs.String("bucket", "", "bucket id")
		list := fs.String("list", "", "list id")
		assignee := fs.String("assignee", "", "assignee")
		due := fs.String("due", "", "due date")
		notes := fs.String("notes", "", "notes")
		brief := fs.String("brief", "", "agent brief")
		focus := fs.Bool("focus", false, "set focus")
		if err := fs.Parse(args[2:]); err != nil {
			return err
		}
		body := map[string]any{}
		if *title != "" {
			body["title"] = *title
		}
		if targetList := firstNonEmpty(*list, *bucket); targetList != "" {
			body["bucketId"] = targetList
		}
		if *assignee != "" {
			body["assignee"] = *assignee
		}
		if *due != "" {
			body["dueDate"] = *due
		}
		if *notes != "" {
			body["notes"] = *notes
		}
		if *brief != "" {
			body["agentBrief"] = *brief
		}
		if *focus {
			body["focus"] = true
		}
		return c.patchTask(id, body)
	case "claim":
		if len(args) != 2 {
			return errors.New("task id is required")
		}
		var out any
		if err := c.do(http.MethodPost, "/api/v1/agent/tasks/"+url.PathEscape(args[1])+"/claim", map[string]any{}, &out); err != nil {
			return err
		}
		return printJSON(out)
	case "status":
		if len(args) != 3 {
			return errors.New("usage: slate tasks status <task-id> queued|working|needs_review|done")
		}
		return c.patchTask(args[1], map[string]any{"status": args[2]})
	case "done":
		if len(args) != 2 {
			return errors.New("task id is required")
		}
		var out any
		if err := c.do(http.MethodPost, "/api/v1/agent/tasks/"+url.PathEscape(args[1])+"/done", map[string]any{}, &out); err != nil {
			return err
		}
		return printJSON(out)
	case "note":
		if len(args) < 2 {
			return errors.New("task id is required")
		}
		id := args[1]
		fs := flag.NewFlagSet("tasks note", flag.ContinueOnError)
		file := fs.String("file", "", "file containing note")
		text := fs.String("text", "", "note text")
		if err := fs.Parse(args[2:]); err != nil {
			return err
		}
		note := *text
		if *file != "" {
			body, err := os.ReadFile(*file)
			if err != nil {
				return err
			}
			note = string(body)
		}
		if strings.TrimSpace(note) == "" {
			return errors.New("--text or --file is required")
		}
		var out any
		if err := c.do(http.MethodPost, "/api/v1/agent/tasks/"+url.PathEscape(id)+"/notes", map[string]any{"notes": note}, &out); err != nil {
			return err
		}
		return printJSON(out)
	default:
		return usage()
	}
}

func (c client) patchTask(id string, body map[string]any) error {
	var out any
	if err := c.do(http.MethodPatch, "/api/v1/tasks/"+url.PathEscape(id), body, &out); err != nil {
		return err
	}
	return printJSON(out)
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

func (c client) do(method string, path string, body any, target any) error {
	if c.token == "" {
		return errors.New("SLATE_API_TOKEN is required")
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
