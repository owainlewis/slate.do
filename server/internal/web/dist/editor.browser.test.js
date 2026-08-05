const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const { chromium } = require("playwright");

const dist = __dirname;

function workspaceFixture() {
  const lists = [
    { id: "list-inbox", boardId: "board-one", boardName: "Workspace", name: "Inbox", goal: "Capture now", isInbox: true, openCount: 1 },
    { id: "list-youtube", boardId: "board-one", boardName: "Workspace", name: "YouTube", goal: "Plan useful videos", isInbox: false, openCount: 2 },
  ];
  const tasks = [
    {
      id: "task-parent", boardId: "board-one", bucketId: "list-youtube", listName: "YouTube",
      title: "Publish task-first agents video", description: "Explain one control plane for people and agents.",
      scheduledDate: "2026-08-12", kind: "action", done: false, status: "working", priority: "p0",
      assigneeAgentId: "agent-research", assigneeAgentName: "Research agent",
    },
    {
      id: "task-inbox", boardId: "board-one", bucketId: "list-inbox", listName: "Inbox",
      title: "Write the doc my boss asked for", description: "", scheduledDate: "", kind: "action",
      done: false, status: "queued", priority: "", assigneeAgentId: "",
    },
  ];
  const subtasks = [{
    id: "task-child", boardId: "board-one", bucketId: "list-youtube", listName: "YouTube",
    parentTaskId: "task-parent", title: "Research examples", description: "", scheduledDate: "", kind: "action",
    done: true, status: "done", priority: "p1", assigneeAgentId: "agent-research", assigneeAgentName: "Research agent",
  }];
  return { lists, tasks, subtasks, taskQueries: [], created: [], patches: [], requests: [] };
}

async function startWorkspace(t) {
  const state = workspaceFixture();
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    state.requests.push(`${request.method} ${url.pathname}${url.search}`);
    if (url.pathname === "/api/v1/me") return json(response, {
      authenticated: true,
      user: { id: "owner", email: "owner@example.com", displayName: "Owain", theme: "dark", entitlement: { plan: "pro", limits: { boards: 5, listsPerBoard: 9, activeItemsPerList: 20, agents: 5 } } },
    });
    if (url.pathname === "/api/v1/boards" && request.method === "GET") return json(response, { boards: [{ id: "board-one", name: "Workspace" }] });
    if (url.pathname === "/api/v1/boards/board-one" && request.method === "GET") return json(response, { id: "board-one", name: "Workspace", buckets: state.lists });
    if (url.pathname === "/api/v1/lists" && request.method === "GET") return json(response, { lists: state.lists });
    if (url.pathname === "/api/v1/agents" && request.method === "GET") return json(response, {
      agents: [{ id: "agent-research", displayName: "Research agent", purpose: "Research assigned work", credential: {}, workCounts: { ready: 1 } }],
      maxAgents: 5,
    });
    if (url.pathname === "/api/v1/tasks" && request.method === "GET") {
      state.taskQueries.push(url.search);
      if (url.searchParams.has("parentTaskId")) return json(response, { tasks: state.subtasks.filter(item => item.parentTaskId === url.searchParams.get("parentTaskId")) });
      let tasks = [...state.tasks];
      const listID = url.searchParams.get("bucketId");
      const query = url.searchParams.get("q")?.toLowerCase();
      const status = url.searchParams.get("status");
      if (listID) tasks = tasks.filter(item => item.bucketId === listID);
      if (query) tasks = tasks.filter(item => `${item.title} ${item.description}`.toLowerCase().includes(query));
      if (status) tasks = tasks.filter(item => item.status === status);
      return json(response, { tasks });
    }
    if (url.pathname === "/api/v1/tasks" && request.method === "POST") {
      const input = await requestJSON(request);
      const created = { id: `task-created-${state.created.length + 1}`, boardId: "board-one", bucketId: "list-inbox", listName: "Inbox", title: input.title, description: input.description || "", scheduledDate: "", kind: "action", done: false, status: "queued", priority: "", assigneeAgentId: "" };
      state.tasks.unshift(created);
      state.created.push(created);
      return json(response, created, 201);
    }
    const subtaskMatch = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/subtasks$/);
    if (subtaskMatch && request.method === "POST") {
      const input = await requestJSON(request);
      const parent = state.tasks.find(item => item.id === subtaskMatch[1]);
      const created = { ...parent, id: `task-child-${state.subtasks.length + 1}`, parentTaskId: parent.id, title: input.title, description: "", done: false, status: "queued", priority: "", assigneeAgentId: "", assigneeAgentName: "" };
      state.subtasks.push(created);
      return json(response, created, 201);
    }
    const statusMatch = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/status$/);
    if (statusMatch && request.method === "PATCH") {
      const input = await requestJSON(request);
      const task = [...state.tasks, ...state.subtasks].find(item => item.id === statusMatch[1]);
      Object.assign(task, input, { done: input.status === "done" });
      state.patches.push({ id: task.id, ...input });
      return json(response, task);
    }
    const taskMatch = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)$/);
    if (taskMatch && request.method === "GET") {
      const task = [...state.tasks, ...state.subtasks].find(item => item.id === taskMatch[1]);
      return task ? json(response, task) : json(response, { error: "not found" }, 404);
    }
    if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
    if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
    if (isAppShell(url.pathname)) return html(response);
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  t.after(async () => {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${origin}/app/tasks`);
  await page.getByRole("heading", { name: "All tasks", exact: true }).waitFor();
  return { page, state, origin, pageErrors };
}

test("the task workspace supports lists, flow, table, and filters", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  for (const label of ["Inbox", "Today", "Week", "Review", "All tasks", "YouTube", "All agents"]) {
    assert.equal(await page.getByText(label, { exact: true }).first().isVisible(), true, label);
  }
  for (const column of ["Task", "List", "Status", "Priority", "Owner", "Planned"]) {
    assert.equal(await page.locator(".workspace-table-head").getByText(column, { exact: true }).isVisible(), true, column);
  }
  assert.equal(await page.locator('[data-open-task="task-parent"]').count(), 1);

  await page.getByRole("button", { name: "Flow", exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".workspace-flow").count(), 1, `url=${page.url()} errors=${pageErrors.join(" | ")} queries=${state.taskQueries.join(" | ")}`);
  assert.match(page.url(), /view=flow/);
  for (const status of ["Ready", "Working", "Review", "Done"]) assert.equal(await page.locator(".workspace-flow-column").getByText(status, { exact: true }).count(), 1);

  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator("#workspace-filters").count(), 1, `url=${page.url()} errors=${pageErrors.join(" | ")}`);
  await page.getByLabel("Search", { exact: true }).fill("boss");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await waitFor(() => state.taskQueries.some(query => query.includes("q=boss")));
  await page.locator('[data-task="task-parent"]').waitFor({ state: "detached" });
  assert.match(page.url(), /q=boss/);
  assert.equal(await page.getByText("Write the doc my boss asked for", { exact: true }).count(), 1);
  assert.ok(state.taskQueries.some(query => query.includes("q=boss")), state.taskQueries.join("\n"));
  assert.equal(await page.locator('[data-task="task-parent"]').count(), 0, state.taskQueries.join("\n"));

  await page.getByRole("link", { name: /YouTube/ }).click();
  await page.getByRole("heading", { name: "YouTube", exact: true }).waitFor();
  assert.equal(await page.locator('[data-open-task="task-parent"]').count(), 1);
  assert.equal(await page.locator('[data-open-task="task-inbox"]').count(), 0);
});

test("New task captures directly into Inbox and opens a normal task editor", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.getByRole("button", { name: "New task", exact: true }).click();
  const title = page.getByLabel("Title", { exact: true });
  await title.waitFor();
  assert.equal(await title.inputValue(), "New task");
  assert.equal(state.created.length, 1);
  assert.equal(state.created[0].bucketId, "list-inbox");

  await title.fill("Prepare launch brief");
  await page.getByLabel("Priority", { exact: true }).selectOption("p0");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(state.patches.length, 1, `errors=${pageErrors.join(" | ")} requests=${state.requests.join(" | ")}`);
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.locator(`[data-open-task="${state.created[0].id}"]`).getByText("Prepare launch brief", { exact: true }).waitFor();
  assert.equal(state.patches.at(-1).title, "Prepare launch brief");
  assert.equal(state.patches.at(-1).priority, "p0");
});

test("task detail coordinates one level of human and agent subtasks through the CLI model", async t => {
  const { page, state } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByRole("dialog").waitFor();
  assert.equal(await page.getByText("Subtasks", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("1/1", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("Research examples", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("slate tasks pull", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText(/refine with|scout|autopilot/i).count(), 0);

  await page.getByLabel("Subtask title", { exact: true }).fill("Human final review");
  await page.locator("#add-subtask").getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("Human final review", { exact: true }).waitFor();
  assert.equal(state.subtasks.length, 2);
  assert.equal(state.subtasks[1].parentTaskId, "task-parent");

  await page.getByText("Human final review", { exact: true }).click();
  await page.getByText("Subtask of another task", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Subtask title", { exact: true }).count(), 0, "subtasks cannot contain subtasks");
});

function isAppShell(pathname) {
  if (["/", "/index.html", "/login", "/app", "/app/tasks", "/app/inbox", "/app/today", "/app/week", "/app/review", "/app/settings", "/early-access", "/reset-password"].includes(pathname)) return true;
  if (pathname.startsWith("/app/lists/") || pathname.startsWith("/app/settings/") || pathname.startsWith("/app/agents/")) return true;
  return pathname === "/app/agents";
}

function html(response) {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><main id="app"></main><script type="module" src="/app.js"></script></body></html>');
}

function json(response, body, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function requestJSON(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return JSON.parse(body || "{}");
}

function file(response, name, type) {
  response.writeHead(200, { "Content-Type": type });
  response.end(fs.readFileSync(path.join(dist, name)));
}

async function waitFor(predicate, timeout = 3000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error("Timed out waiting for fixture state");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
