const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const AxeBuilder = require("@axe-core/playwright").default;
const { chromium } = require("playwright");

const dist = path.resolve(__dirname, "../../server/internal/web/dist");

function fixture() {
  return {
    user: { id: "owner", email: "owner@example.com", displayName: "Owain Lewis", theme: "dark", entitlement: { plan: "pro", limits: { lists: 45, agents: 5, apiTokens: 10 } } },
    lists: [
      { id: "list-inbox", name: "Inbox", goal: "Capture now", isInbox: true, openCount: 1 },
      { id: "list-product", name: "Product", goal: "Ship focused improvements", isInbox: false, openCount: 2 },
    ],
    agents: [{ id: "agent-research", displayName: "Research agent", purpose: "Find and synthesize useful evidence", workCounts: { ready: 1, working: 1, review: 0, completed: 0 } }],
    tasks: [
      { id: "task-parent", bucketId: "list-product", bucketName: "Product", listName: "Product", title: "Publish task-first agents video", description: "Explain one control plane for people and agents.", scheduledDate: "2026-08-20", status: "working", priority: "p0", assigneeAgentId: "agent-research", assigneeAgentName: "Research agent" },
      { id: "task-inbox", bucketId: "list-inbox", bucketName: "Inbox", listName: "Inbox", title: "Write the doc my boss asked for", description: "Turn the notes into a decision-ready brief.", scheduledDate: "", status: "new", priority: "p1", assigneeAgentId: "", assigneeAgentName: "" },
    ],
    subtasks: [{ id: "task-child", parentTaskId: "task-parent", parentTaskTitle: "Publish task-first agents video", bucketId: "list-product", bucketName: "Product", title: "Research examples", description: "", scheduledDate: "", status: "done", priority: "p2", sortOrder: 0, createdAt: "2026-08-18T09:00:00Z", assigneeAgentId: "agent-research", assigneeAgentName: "Research agent" }],
    entries: { "task-parent": [{ id: "entry-one", kind: "comment", body: "The first research pass is ready.", authorKind: "agent", authorName: "Research agent", createdAt: "2026-08-18T10:00:00Z" }] },
    inbox: [{ id: "message-one", taskId: "task-parent", taskTitle: "Publish task-first agents video", kind: "comment", body: "I have drafted the spec. Can you take a look?", authorName: "Research agent", createdAt: "2026-08-18T10:00:00Z" }],
    tokens: [],
    requests: [],
    paginate: false,
    idempotency: new Map(),
    idempotencyRequests: [],
    loseParentResponse: false,
    loseSubtaskResponseFor: "",
    deleteTaskError: "",
    taskCreateDelay: null,
    taskCreateFailure: "",
  };
}

async function startApp(t, viewport = { width: 1440, height: 960 }) {
  const state = fixture();
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    state.requests.push(`${request.method} ${url.pathname}${url.search}`);
    if (url.pathname === "/api/v1/me" && request.method === "GET") return json(response, { authenticated: true, user: state.user });
    if (url.pathname === "/api/v1/lists" && request.method === "GET") return json(response, { lists: state.lists });
    if (url.pathname === "/api/v1/lists" && request.method === "POST") {
      const input = await requestJSON(request);
      const list = { id: `list-${state.lists.length}`, name: input.name, goal: "", isInbox: false, openCount: 0 };
      state.lists.push(list);
      return json(response, list, 201);
    }
    const listMatch = url.pathname.match(/^\/api\/v1\/lists\/([^/]+)$/);
    if (listMatch && request.method === "PATCH") {
      const list = state.lists.find(item => item.id === listMatch[1]);
      Object.assign(list, await requestJSON(request));
      return json(response, list);
    }
    if (listMatch && request.method === "DELETE") {
      state.lists = state.lists.filter(item => item.id !== listMatch[1]);
      state.tasks = state.tasks.filter(item => item.bucketId !== listMatch[1]);
      return json(response, {});
    }
    const listTaskMatch = url.pathname.match(/^\/api\/v1\/lists\/([^/]+)\/tasks$/);
    if ((url.pathname === "/api/v1/tasks" || listTaskMatch) && request.method === "POST") {
      const input = await requestJSON(request);
      if (state.taskCreateDelay) {
        await state.taskCreateDelay;
        state.taskCreateDelay = null;
      }
      const idempotencyKey = request.headers["idempotency-key"];
      state.idempotencyRequests.push({ path: url.pathname, key: idempotencyKey });
      if (state.taskCreateFailure) {
        const error = state.taskCreateFailure;
        state.taskCreateFailure = "";
        return json(response, { error }, 503);
      }
      const replay = idempotencyKey && state.idempotency.get(idempotencyKey);
      if (replay) return json(response, replay, 200);
      const bucketId = listTaskMatch ? listTaskMatch[1] : "list-inbox";
      const list = state.lists.find(item => item.id === bucketId);
      const task = { id: `task-${state.tasks.length + 1}`, bucketId, bucketName: list.name, listName: list.name, status: "new", priority: "", scheduledDate: "", assigneeAgentId: "", ...input };
      state.tasks.push(task);
      if (idempotencyKey) state.idempotency.set(idempotencyKey, task);
      if (state.loseParentResponse) {
        state.loseParentResponse = false;
        response.writeHead(201, { "Content-Type": "application/json" });
        return response.end("{");
      }
      return json(response, task, 201);
    }
    if (url.pathname === "/api/v1/tasks" && request.method === "GET") {
      if (state.paginate) {
        if (url.searchParams.get("cursor") === "page-two") return json(response, { tasks: [state.tasks[1]] });
        return json(response, { tasks: [state.tasks[0]], nextCursor: "page-two" });
      }
      let tasks = [...state.tasks, ...state.subtasks];
      if (url.searchParams.get("parentTaskId")) tasks = state.subtasks.filter(item => item.parentTaskId === url.searchParams.get("parentTaskId")).sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
      if (url.searchParams.get("bucketId")) tasks = tasks.filter(item => item.bucketId === url.searchParams.get("bucketId"));
      if (url.searchParams.get("topLevel") === "true") tasks = tasks.filter(item => !item.parentTaskId);
      if (url.searchParams.get("status")) tasks = tasks.filter(item => item.status === url.searchParams.get("status"));
      if (url.searchParams.get("q")) tasks = tasks.filter(item => `${item.title} ${item.description}`.toLowerCase().includes(url.searchParams.get("q").toLowerCase()));
      if (url.searchParams.get("priority")) tasks = tasks.filter(item => item.priority === url.searchParams.get("priority"));
      if (url.searchParams.get("assigneeAgentId")) tasks = tasks.filter(item => url.searchParams.get("assigneeAgentId") === "unassigned" ? !item.assigneeAgentId : item.assigneeAgentId === url.searchParams.get("assigneeAgentId"));
      return json(response, { tasks });
    }
    const taskMatch = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)(?:\/status)?$/);
    if (taskMatch && request.method === "GET") {
      const task = [...state.tasks, ...state.subtasks].find(item => item.id === taskMatch[1]);
      return task ? json(response, task) : json(response, { error: "not found" }, 404);
    }
    if (taskMatch && request.method === "PATCH") {
      const task = [...state.tasks, ...state.subtasks].find(item => item.id === taskMatch[1]);
      Object.assign(task, await requestJSON(request));
      return json(response, task);
    }
    if (taskMatch && request.method === "DELETE") {
      if (state.deleteTaskError) return json(response, { error: state.deleteTaskError }, 500);
      state.tasks = state.tasks.filter(item => item.id !== taskMatch[1]);
      state.subtasks = state.subtasks.filter(item => item.id !== taskMatch[1] && item.parentTaskId !== taskMatch[1]);
      return json(response, {});
    }
    const subtaskMatch = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/subtasks$/);
    if (subtaskMatch && request.method === "POST") {
      const input = await requestJSON(request);
      const idempotencyKey = request.headers["idempotency-key"];
      state.idempotencyRequests.push({ path: url.pathname, key: idempotencyKey });
      const replay = idempotencyKey && state.idempotency.get(idempotencyKey);
      if (replay) return json(response, replay, 200);
      const parent = state.tasks.find(item => item.id === subtaskMatch[1]);
      const task = { id: `subtask-${state.subtasks.length + 1}`, parentTaskId: parent.id, parentTaskTitle: parent.title, bucketId: parent.bucketId, bucketName: parent.bucketName, status: "new", priority: "", scheduledDate: "", assigneeAgentId: "", sortOrder: state.subtasks.length, createdAt: new Date(Date.UTC(2026, 7, 23, 9, 0, state.subtasks.length)).toISOString(), ...input };
      state.subtasks.push(task);
      if (idempotencyKey) state.idempotency.set(idempotencyKey, task);
      if (state.loseSubtaskResponseFor === task.title) {
        state.loseSubtaskResponseFor = "";
        response.writeHead(201, { "Content-Type": "application/json" });
        return response.end("{");
      }
      return json(response, task, 201);
    }
    const entryMatch = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/entries$/);
    if (entryMatch && request.method === "GET") return json(response, { entries: state.entries[entryMatch[1]] || [] });
    if (entryMatch && request.method === "POST") {
      const input = await requestJSON(request);
      const entry = { id: `entry-${Object.values(state.entries).flat().length + 1}`, ...input, authorKind: "human", authorName: "Owain Lewis", createdAt: new Date().toISOString() };
      state.entries[entryMatch[1]] = [...(state.entries[entryMatch[1]] || []), entry];
      if (input.kind === "output") state.tasks.find(item => item.id === entryMatch[1]).status = "needs_review";
      return json(response, { ...entry, taskStatus: input.kind === "output" ? "needs_review" : undefined }, 201);
    }
    if (url.pathname === "/api/v1/inbox") return json(response, { messages: state.inbox });
    if (url.pathname === "/api/v1/agents" && request.method === "GET") return json(response, { agents: state.agents, maxAgents: 5 });
    if (url.pathname === "/api/v1/agents" && request.method === "POST") {
      const input = await requestJSON(request);
      const agent = { id: `agent-${state.agents.length + 1}`, displayName: input.displayName, purpose: input.purpose, workCounts: {} };
      state.agents.push(agent);
      return json(response, { ...agent, token: "slate_agent_one_time_secret" }, 201);
    }
    const agentWorkMatch = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)\/work$/);
    if (agentWorkMatch) {
      const items = [...state.tasks, ...state.subtasks].filter(item => item.assigneeAgentId === agentWorkMatch[1]);
      return json(response, { items, total: items.length, page: 1, pageSize: 50, hasPrevious: false, hasNext: false });
    }
    const agentMatch = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)$/);
    if (agentMatch && request.method === "GET") {
      const agent = state.agents.find(item => item.id === agentMatch[1]);
      const assigned = [...state.tasks, ...state.subtasks].filter(item => item.assigneeAgentId === agent.id);
      return json(response, { agent, work: { ready: assigned.filter(item => item.status === "queued"), working: assigned.filter(item => item.status === "working"), review: assigned.filter(item => item.status === "needs_review"), recentlyCompleted: assigned.filter(item => item.status === "done"), totals: agent.workCounts } });
    }
    if (agentMatch && request.method === "PATCH") { Object.assign(state.agents.find(item => item.id === agentMatch[1]), await requestJSON(request)); return json(response, state.agents.find(item => item.id === agentMatch[1])); }
    if (agentMatch && request.method === "DELETE") { state.agents = state.agents.filter(item => item.id !== agentMatch[1]); return json(response, {}); }
    if (url.pathname.endsWith("/credential/rotate")) return json(response, { token: "slate_agent_rotated_secret" });
    if (url.pathname === "/api/v1/api-tokens" && request.method === "GET") return json(response, { tokens: state.tokens });
    if (url.pathname === "/api/v1/api-tokens" && request.method === "POST") { const input = await requestJSON(request); state.tokens.push({ id: `token-${state.tokens.length + 1}`, name: input.name }); return json(response, { token: "slate_personal_one_time_secret" }, 201); }
    if (url.pathname.startsWith("/api/v1/api-tokens/") && request.method === "DELETE") { state.tokens = state.tokens.filter(item => item.id !== url.pathname.split("/").at(-1)); return json(response, {}); }
    if (url.pathname === "/api/v1/me" && request.method === "PATCH") { Object.assign(state.user, await requestJSON(request)); return json(response, state.user); }
    if (url.pathname.startsWith("/api/v1/auth/")) return json(response, { message: "Done" });
    if (url.pathname.startsWith("/assets/")) return file(response, url.pathname.slice(1), url.pathname.endsWith(".css") ? "text/css" : url.pathname.endsWith(".js") ? "text/javascript" : "font/woff2");
    const publicFile = url.pathname.slice(1);
    if (["favicon.svg", "landing-stones.jpg", "landing-slabs.jpg", "app-lists.jpg", "app-flow.jpg", "cli.html"].includes(publicFile)) return file(response, publicFile, publicFile.endsWith(".svg") ? "image/svg+xml" : publicFile.endsWith(".html") ? "text/html" : "image/jpeg");
    if (request.method === "GET") return file(response, "index.html", "text/html");
    return json(response, { error: "not found" }, 404);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${origin}/app/tasks`);
  await page.getByRole("heading", { name: "All tasks", exact: true }).waitFor();
  return { page, state, origin, pageErrors };
}

async function createTemplate(page, name, steps) {
  await page.locator(".template-page-header").getByRole("button", { name: "New template" }).click();
  const editor = page.getByRole("dialog", { name: "New template" });
  await editor.getByLabel("Template name").fill(name);
  await editor.getByLabel("Phase 1 subtask 1").fill(steps[0]);
  for (let index = 1; index < steps.length; index += 1) {
    await editor.getByRole("button", { name: "Add subtask" }).click();
    await editor.getByLabel(`Phase 1 subtask ${index + 1}`).fill(steps[index]);
  }
  await editor.getByRole("button", { name: "Save template" }).click();
  const row = page.locator(".template-list-row").filter({ hasText: name });
  await row.waitFor();
  return row;
}

test("React workspace renders the full task board accessibly", async t => {
  const { page, pageErrors } = await startApp(t);
  for (const heading of ["Todo", "In Progress", "Review", "Done"]) await page.getByText(heading, { exact: true }).waitFor();
  await page.getByRole("button", { name: "Open task: Publish task-first agents video" }).waitFor();
  assert.deepEqual(await page.getByLabel("Filter by agent").locator("option").allTextContents(), ["Any agent", "Research agent"]);
  const results = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(results.violations, []);
  assert.deepEqual(pageErrors, []);
});

test("public routes stay light and the app restores the saved dark theme", async t => {
  const { page } = await startApp(t);
  assert.equal(await page.locator("html").evaluate(element => element.classList.contains("dark")), true);
  await page.getByRole("button", { name: "Slate home" }).click();
  await page.getByRole("heading", { name: /Stay on top of everything/ }).waitFor();
  assert.equal(await page.locator("html").evaluate(element => element.classList.contains("dark")), false);
  assert.equal(await page.locator("html").evaluate(element => getComputedStyle(element).colorScheme), "light");
  assert.match(await page.locator(".landing-nav .brand-mark").evaluate(element => getComputedStyle(element, "::before").backgroundImage), /^radial-gradient/);
  await page.getByRole("link", { name: "Open Slate", exact: true }).click();
  await page.getByRole("heading", { name: "All tasks", exact: true }).waitFor();
  assert.equal(await page.locator("html").evaluate(element => element.classList.contains("dark")), true);
});

test("table layout filters tasks and survives layout changes", async t => {
  const { page } = await startApp(t);
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const table = page.getByRole("table");
  await table.waitFor();
  for (const heading of ["Task", "Status", "Agent", "List", "Priority", "Planned", "Actions"]) await table.getByRole("columnheader", { name: heading }).waitFor();
  await page.getByLabel("Search tasks").fill("boss");
  await page.waitForFunction(() => document.querySelectorAll(".workspace-table tbody tr").length === 1);
  await page.getByRole("button", { name: "Board", exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get("q"), "boss");
});

test("workspace pagination loads and retains subsequent task pages", async t => {
  const { page, state, origin } = await startApp(t);
  state.paginate = true;
  await page.goto(`${origin}/app/tasks?q=pagination`);
  await page.getByRole("button", { name: "Load more tasks" }).click();
  await page.getByRole("button", { name: "Open task: Write the doc my boss asked for" }).waitFor();
  assert.equal(await page.locator("[data-task]").count(), 2);
  assert.equal(state.requests.some(request => request.includes("cursor=page-two")), true);
});

test("task creation respects every column and queues every agent assignment", async t => {
  const { page, state, origin } = await startApp(t);
  const columns = [
    { label: "Todo", status: "new" },
    { label: "In Progress", status: "working" },
    { label: "Review", status: "needs_review" },
    { label: "Done", status: "done" },
  ];

  for (const assigned of [false, true]) {
    for (const column of columns) {
      await page.goto(`${origin}/app/tasks`);
      await page.getByRole("button", { name: `Add task to ${column.label}` }).click();
      const dialog = page.getByRole("dialog", { name: "New task" });
      const title = `${assigned ? "Assigned" : "Unassigned"} ${column.label}`;
      await dialog.getByRole("textbox", { name: "Task title" }).fill(title);
      await dialog.getByRole("textbox", { name: "Task brief" }).fill(`Created from ${column.label}.`);
      if (assigned) await dialog.getByLabel("Assigned agent").selectOption("agent-research");
      if (!assigned && column.status === "working") {
        await dialog.getByRole("button", { name: "Priority" }).click();
        await page.getByRole("menuitem", { name: "Normal" }).click();
      }
      await dialog.getByRole("button", { name: assigned ? "Create & queue" : "Create task" }).click();
      await page.getByRole("dialog", { name: "Task detail" }).waitFor();

      const created = state.tasks.find(task => task.title === title);
      assert.ok(created);
      assert.equal(created.status, assigned ? "queued" : column.status);
      assert.equal(created.assigneeAgentId, assigned ? "agent-research" : "");
      if (!assigned && column.status === "working") assert.equal(created.priority, "p2");
      assert.equal(state.requests.some(request => request.startsWith(`PATCH /api/v1/tasks/${created.id}`)), false);
    }
  }
});

test("task creation failure keeps the form and can be retried", async t => {
  const { page, state } = await startApp(t);
  state.taskCreateFailure = "Task creation is temporarily unavailable.";
  await page.getByRole("button", { name: "Add task to Review" }).click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByRole("textbox", { name: "Task title" }).fill("Keep this review task");
  await dialog.getByRole("textbox", { name: "Task brief" }).fill("Do not lose this brief.");
  await dialog.getByRole("button", { name: "Create task" }).click();

  await dialog.getByRole("alert").getByText("Task creation is temporarily unavailable.").waitFor();
  assert.equal(await dialog.isVisible(), true);
  assert.equal(await dialog.getByRole("textbox", { name: "Task title" }).inputValue(), "Keep this review task");
  assert.equal(await dialog.getByRole("textbox", { name: "Task brief" }).inputValue(), "Do not lose this brief.");
  assert.equal(await dialog.getByRole("button", { name: "Create task" }).isEnabled(), true);

  await dialog.getByRole("button", { name: "Create task" }).click();
  await page.getByRole("dialog", { name: "Task detail" }).waitFor();
  const created = state.tasks.find(task => task.title === "Keep this review task");
  assert.ok(created);
  assert.equal(created.status, "needs_review");
});

test("task creation keeps every exit and field disabled while pending", async t => {
  const { page, state } = await startApp(t);
  let releaseTaskCreate;
  state.taskCreateDelay = new Promise(resolve => { releaseTaskCreate = resolve; });
  await page.getByRole("button", { name: "Add task to Todo" }).click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByRole("textbox", { name: "Task title" }).fill("Wait for the server");
  await dialog.getByRole("button", { name: "Create task" }).click();
  await dialog.getByRole("button", { name: "Creating…" }).waitFor();
  for (const control of [
    dialog.getByRole("button", { name: "Use template" }),
    dialog.getByRole("button", { name: "Close" }),
    dialog.getByRole("button", { name: "Cancel" }),
    dialog.getByRole("textbox", { name: "Task title" }),
    dialog.getByRole("textbox", { name: "Task brief" }),
    dialog.getByLabel("Task list"),
    dialog.getByLabel("Assigned agent"),
    dialog.getByLabel("Plan for"),
    dialog.getByRole("button", { name: "Priority" }),
  ]) assert.equal(await control.isDisabled(), true);
  await page.keyboard.press("c");
  await page.keyboard.press("Control+k");
  assert.equal(await page.getByRole("dialog", { name: "Search tasks" }).count(), 0);
  await dialog.getByRole("button", { name: "Creating…" }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), true);
  releaseTaskCreate();
  await page.getByRole("dialog", { name: "Task detail" }).waitFor();
  assert.equal(state.requests.filter(request => request === "POST /api/v1/lists/list-inbox/tasks").length, 1);
});

test("a custom template creates one parent task with an ordered workflow", async t => {
  const { page, state, origin, pageErrors } = await startApp(t);
  await page.goto(`${origin}/app/templates`);
  await page.getByRole("heading", { name: "Templates", exact: true }).waitFor();
  const template = await createTemplate(page, "Product launch", ["Write the launch brief", "Publish the release"]);
  assert.equal(await page.getByRole("listitem").count(), 2);
  const accessibility = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(accessibility.violations, []);

  await template.getByRole("button", { name: "Use template" }).click();
  const dialog = page.getByRole("dialog", { name: "Start process" });
  assert.deepEqual((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations, []);
  await dialog.getByLabel("Task name").fill("Autumn release");
  await dialog.getByLabel("Plan for").fill("2026-08-29");
  await dialog.getByLabel("List").selectOption("list-product");
  await dialog.getByLabel("Brief").fill("Prepare the customer-facing release.");
  await dialog.getByRole("button", { name: "Create task" }).click();

  await page.getByRole("region", { name: "Task detail" }).waitFor();
  await page.getByText("0/2", { exact: true }).waitFor();
  const parent = state.tasks.find(task => task.title === "Run: Autumn release");
  assert.ok(parent);
  assert.equal(parent.bucketId, "list-product");
  assert.equal(parent.scheduledDate, "2026-08-29");
  assert.match(parent.description, /Prepare the customer-facing release/);
  const generated = state.subtasks.filter(task => task.parentTaskId === parent.id);
  assert.deepEqual(generated.map(task => task.title), ["Write the launch brief", "Publish the release"]);
  assert.deepEqual(await page.locator(".subtask-title").allTextContents(), ["Write the launch brief", "Publish the release"]);
  assert.deepEqual(pageErrors, []);
});

test("new accounts start without shared default templates", async t => {
  const { page, origin, pageErrors } = await startApp(t);
  await page.goto(`${origin}/app/templates`);
  await page.getByRole("heading", { name: "No templates yet" }).waitFor();
  assert.equal(await page.getByText(/YouTube/i).count(), 0);
  assert.equal(await page.locator(".template-list-row").count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("template limits prevent hidden or permanently partial workflow tasks", async t => {
  const { page, state, origin, pageErrors } = await startApp(t);
  const oversized = {
    id: "oversized-template",
    name: "Oversized process",
    summary: "Too many steps",
    taskPrefix: "Run",
    phases: [{ id: "phase", name: "Plan" }],
    steps: Array.from({ length: 51 }, (_, index) => ({ id: `step-${index}`, phaseId: "phase", title: `Step ${index}`, executor: "Human", instruction: "" })),
  };
  await page.goto(origin);
  await page.evaluate(template => localStorage.setItem("slate:process-templates:owner", JSON.stringify([template])), oversized);
  await page.goto(`${origin}/app/templates`);
  const oversizedRow = page.locator(".template-list-row").filter({ hasText: "Oversized process" });
  await oversizedRow.getByRole("button", { name: "Edit" }).click();
  const editor = page.getByRole("dialog", { name: "Edit template" });
  await editor.getByRole("alert").getByText("Templates can contain up to 50 subtasks.").waitFor();
  assert.equal(await editor.getByRole("button", { name: "Save template" }).isDisabled(), true);
  await editor.getByRole("button", { name: "Cancel" }).click();

  const longInstructions = { ...oversized, id: "long-instructions", name: "Long instructions", steps: [{ id: "step", phaseId: "phase", title: "Draft", executor: "Human", instruction: "x".repeat(17_000) }] };
  await page.evaluate(template => localStorage.setItem("slate:process-templates:owner", JSON.stringify([template])), longInstructions);
  await page.reload();
  const longRow = page.locator(".template-list-row").filter({ hasText: "Long instructions" });
  await longRow.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("dialog", { name: "Edit template" }).getByRole("alert").getByText("Subtask instructions are too long to create a task.").waitFor();
  await page.getByRole("dialog", { name: "Edit template" }).getByRole("button", { name: "Cancel" }).click();

  const limitsRow = await createTemplate(page, "Limits process", ["Draft the release"]);
  await limitsRow.getByRole("button", { name: "Use template" }).click();
  const create = page.getByRole("dialog", { name: "Start process" });
  await create.getByLabel("Task name").fill("x".repeat(296));
  await create.getByRole("alert").getByText("The generated task name can contain up to 300 characters.").waitFor();
  assert.equal(await create.getByRole("button", { name: "Create task" }).isDisabled(), true);
  await create.getByRole("button", { name: "Cancel" }).click();

  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (String(key).startsWith("slate:process-")) throw new DOMException("Quota exceeded", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "New template" }).click();
  const freshEditor = page.getByRole("dialog", { name: "New template" });
  await freshEditor.getByLabel("Template name").fill("In-memory process");
  await freshEditor.getByLabel("Phase 1 subtask 1").fill("Draft it");
  await freshEditor.getByRole("button", { name: "Save template" }).click();
  await page.getByRole("alert").getByText("Templates could not be saved in this browser.").waitFor();
  await page.locator(".template-list-row").filter({ hasText: "In-memory process" }).waitFor();
  await page.locator(".template-list-row").filter({ hasText: "In-memory process" }).getByRole("button", { name: "Use template" }).click();
  const blockedCreate = page.getByRole("dialog", { name: "Start process" });
  await blockedCreate.getByLabel("Task name").fill("Cannot persist retry key");
  await blockedCreate.getByRole("button", { name: "Create task" }).click();
  await blockedCreate.getByRole("alert").getByText("Slate could not save a safe retry key in this browser. No task was created.").waitFor();
  assert.equal(state.tasks.some(task => task.title === "Run: Cannot persist retry key"), false);
  assert.deepEqual(pageErrors, []);
});

test("task deletion uses one safe confirmation from board, table, and task detail", async t => {
  const { page, state, pageErrors } = await startApp(t);
  const title = "Publish task-first agents video";
  const confirmationText = `Delete “${title}”? All of its subtasks will also be deleted.`;
  const assertProcessUnchanged = (deleteRequests = 0) => {
    assert.ok(state.tasks.some(task => task.id === "task-parent"));
    assert.ok(state.subtasks.some(task => task.id === "task-child"));
    assert.equal(state.requests.filter(request => request === "DELETE /api/v1/tasks/task-parent").length, deleteRequests);
  };
  const openConfirmation = async () => {
    await page.getByRole("menuitem", { name: "Delete task" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete task?" });
    await dialog.waitFor();
    assert.equal(await dialog.getByText(confirmationText, { exact: true }).count(), 1);
    assert.deepEqual((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations, []);
    return dialog;
  };

  const boardActions = page.getByRole("button", { name: `Actions for ${title}` });
  await boardActions.click();
  let dialog = await openConfirmation();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await dialog.waitFor({ state: "detached" });
  await boardActions.evaluate(element => new Promise(resolve => {
    const check = () => document.activeElement === element ? resolve() : requestAnimationFrame(check);
    check();
  }));
  assertProcessUnchanged();

  await page.getByRole("button", { name: "Table", exact: true }).click();
  const tableActions = page.getByRole("button", { name: `Actions for ${title}` });
  await tableActions.click();
  dialog = await openConfirmation();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await dialog.waitFor({ state: "detached" });
  assertProcessUnchanged();

  await page.getByRole("button", { name: `Open task: ${title}` }).click();
  await page.getByRole("region", { name: "Task detail" }).waitFor();
  await page.getByLabel("Title", { exact: true }).fill("Unsaved replacement title");
  await page.getByRole("button", { name: "Task actions" }).click();
  dialog = await openConfirmation();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await dialog.waitFor({ state: "detached" });
  assertProcessUnchanged();

  await page.getByRole("button", { name: "Task actions" }).click();
  dialog = await openConfirmation();
  state.deleteTaskError = "Could not delete this process.";
  await dialog.getByRole("button", { name: "Delete task" }).click();
  await dialog.getByRole("alert").getByText(state.deleteTaskError).waitFor();
  assertProcessUnchanged(1);

  state.deleteTaskError = "";
  await dialog.getByRole("button", { name: "Delete task" }).click();
  await page.getByRole("region", { name: "Task detail" }).waitFor({ state: "detached" });
  assert.equal(state.tasks.some(task => task.id === "task-parent"), false);
  assert.equal(state.subtasks.some(task => task.id === "task-child"), false);
  assert.equal(state.requests.filter(request => request === "DELETE /api/v1/tasks/task-parent").length, 2);
  assert.deepEqual(pageErrors, []);
});

test("subtasks use persisted order before deterministic legacy fallbacks", async t => {
  const { page, state } = await startApp(t);
  const base = { parentTaskId: "task-parent", parentTaskTitle: "Publish task-first agents video", bucketId: "list-product", bucketName: "Product", description: "", scheduledDate: "", status: "new", priority: "p2", assigneeAgentId: "", assigneeAgentName: "" };
  state.subtasks = [
    { ...base, id: "ordered-2", title: "Ordered second", sortOrder: 2, createdAt: "2026-08-01T09:00:00Z" },
    { ...base, id: "legacy-b", title: "Legacy B", createdAt: "2026-08-03T09:00:00Z" },
    { ...base, id: "ordered-1", title: "Ordered first", sortOrder: 1, createdAt: "2026-08-04T09:00:00Z" },
    { ...base, id: "legacy-a", title: "Legacy A", createdAt: "2026-08-03T09:00:00Z" },
    { ...base, id: "legacy-missing", title: "Legacy missing" },
  ];
  await page.getByRole("button", { name: "Open task: Publish task-first agents video" }).click();
  await page.getByRole("region", { name: "Task detail" }).waitFor();
  assert.deepEqual(await page.locator(".subtask-title").allTextContents(), ["Ordered first", "Ordered second", "Legacy missing", "Legacy A", "Legacy B"]);
});

test("template deletion confirms, selects a neighbour, and leaves generated tasks unchanged", async t => {
  const { page, state, origin, pageErrors } = await startApp(t);
  await page.goto(`${origin}/app/templates`);
  const neighbourRow = await createTemplate(page, "Neighbour process", ["Keep this step"]);
  const row = await createTemplate(page, "Temporary launch process", ["Prepare the launch"]);
  await row.getByRole("button", { name: "Use template" }).click();
  const create = page.getByRole("dialog", { name: "Start process" });
  await create.getByLabel("Task name").fill("Autumn launch");
  await create.getByRole("button", { name: "Create task" }).click();
  await page.getByRole("region", { name: "Task detail" }).waitFor();
  const generatedParent = state.tasks.find(task => task.title === "Run: Autumn launch");
  const generatedSubtasks = state.subtasks.filter(task => task.parentTaskId === generatedParent.id).map(task => task.id);

  await page.goto(`${origin}/app/templates`);
  const savedRow = page.locator(".template-list-row").filter({ hasText: "Temporary launch process" });
  await savedRow.locator(".template-list-select").click();
  assert.equal(await savedRow.locator(".template-list-select").getAttribute("aria-pressed"), "true");
  const deleteButton = savedRow.getByRole("button", { name: "Delete" });
  await deleteButton.click();
  const confirmation = page.getByRole("dialog", { name: "Delete template?" });
  const cancel = confirmation.getByRole("button", { name: "Cancel" });
  await cancel.evaluate(element => new Promise(resolve => {
    const check = () => document.activeElement === element ? resolve() : requestAnimationFrame(check);
    check();
  }));
  await cancel.click();
  await savedRow.waitFor();
  await deleteButton.evaluate(element => new Promise(resolve => {
    const check = () => document.activeElement === element ? resolve() : requestAnimationFrame(check);
    check();
  }));

  await deleteButton.click();
  await confirmation.getByRole("button", { name: "Delete template" }).click();
  await savedRow.waitFor({ state: "detached" });
  const neighbourSelect = neighbourRow.locator(".template-list-select");
  assert.equal(await neighbourSelect.getAttribute("aria-pressed"), "true");
  await neighbourSelect.evaluate(element => new Promise(resolve => {
    const check = () => document.activeElement === element ? resolve() : requestAnimationFrame(check);
    check();
  }));
  assert.ok(state.tasks.some(task => task.id === generatedParent.id));
  assert.deepEqual(state.subtasks.filter(task => task.parentTaskId === generatedParent.id).map(task => task.id), generatedSubtasks);

  await neighbourRow.getByRole("button", { name: "Delete" }).click();
  await confirmation.getByRole("button", { name: "Delete template" }).click();
  await page.getByRole("heading", { name: "No templates yet" }).waitFor();
  const newTemplateButton = page.locator(".template-page-header").getByRole("button", { name: "New template" });
  await newTemplateButton.evaluate(element => new Promise(resolve => {
    const check = () => document.activeElement === element ? resolve() : requestAnimationFrame(check);
    check();
  }));
  assert.deepEqual(pageErrors, []);
});

test("valid legacy templates survive malformed siblings and migrate stable step IDs", async t => {
  const { page, origin, pageErrors } = await startApp(t);
  await page.evaluate(() => localStorage.setItem("slate:process-templates:owner", JSON.stringify([
    { id: "youtube-weekly", name: "Overwritten built-in", summary: "Wrong", taskPrefix: "Wrong", phases: [{ id: "wrong", name: "Wrong" }], steps: [{ phaseId: "wrong", title: "Wrong", executor: "Human", instruction: "Wrong" }] },
    { id: "legacy-podcast", name: "Legacy podcast", summary: "A valid old template", taskPrefix: "Run", phases: ["Draft"], steps: [{ phase: "Draft", title: "Write the outline", executor: "Human", instruction: "Start with the promise." }] },
    { id: "long-step-id", name: "Long step ID", summary: "A recoverable template", taskPrefix: "Run", phases: [{ id: "phase", name: "Draft" }], steps: [{ id: "x".repeat(300), phaseId: "phase", title: "Write the outline", executor: "Human", instruction: "Start with the promise." }] },
    { id: "blank-step", name: "Blank step", summary: "Invalid", taskPrefix: "Run", phases: [{ id: "phase", name: "Draft" }], steps: [{ id: "blank", phaseId: "phase", title: "   ", executor: "Human", instruction: "" }] },
    { id: "broken", name: "Broken template" },
  ])));
  await page.goto(`${origin}/app/templates`);
  await page.getByRole("heading", { name: "Legacy podcast", exact: true }).first().waitFor();
  assert.equal(await page.getByText(/YouTube/i).count(), 0);
  assert.equal(await page.getByText("Overwritten built-in", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Blank step", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Broken template", { exact: true }).count(), 0);
  const firstStored = await page.evaluate(() => JSON.parse(localStorage.getItem("slate:process-templates:owner")));
  assert.equal(firstStored.length, 2);
  const migratedStepId = firstStored.find(template => template.id === "legacy-podcast").steps[0].id;
  assert.match(migratedStepId, /^legacy-podcast-step-/);
  assert.equal(firstStored.find(template => template.id === "long-step-id").steps[0].id, "step-1");
  await page.reload();
  const reloaded = await page.evaluate(() => JSON.parse(localStorage.getItem("slate:process-templates:owner")));
  assert.equal(reloaded.find(template => template.id === "legacy-podcast").steps[0].id, migratedStepId);
  assert.equal(reloaded.find(template => template.id === "long-step-id").steps[0].id, "step-1");
  assert.deepEqual(pageErrors, []);
});

test("uncertain parent and subtask responses are retry-safe", async t => {
  const { page, state, origin, pageErrors } = await startApp(t);
  await page.goto(`${origin}/app/templates`);
  const retryRow = await createTemplate(page, "Retry process", ["Capture input", "Generate output"]);

  state.loseParentResponse = true;
  await retryRow.getByRole("button", { name: "Use template" }).click();
  let dialog = page.getByRole("dialog", { name: "Start process" });
  await dialog.getByLabel("Task name").fill("Lost parent response");
  await dialog.getByRole("button", { name: "Create task" }).click();
  await dialog.getByRole("alert").waitFor();
  assert.equal(state.tasks.filter(task => task.title === "Run: Lost parent response").length, 1);
  const lostParent = state.tasks.find(task => task.title === "Run: Lost parent response");
  const parentRequests = state.idempotencyRequests.filter(item => item.path === "/api/v1/lists/list-product/tasks");
  const [firstAttemptKey] = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("slate:process-attempt:owner:")));
  assert.ok(firstAttemptKey);
  const secondAttemptKey = "slate:process-attempt:owner:other-tab";
  const expiredAttemptKey = "slate:process-attempt:owner:expired";
  await page.evaluate(({ firstAttemptKey, secondAttemptKey, expiredAttemptKey, lostParentId }) => {
    const otherAttempt = JSON.parse(localStorage.getItem(firstAttemptKey));
    otherAttempt.id = "other-tab";
    otherAttempt.createdAt += 1;
    otherAttempt.taskTitle = "Other tab attempt";
    localStorage.setItem(secondAttemptKey, JSON.stringify(otherAttempt));
    const expiredAttempt = { ...otherAttempt, id: "expired", createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000, parentTaskId: lostParentId, taskTitle: "Expired attempt" };
    localStorage.setItem(expiredAttemptKey, JSON.stringify(expiredAttempt));
  }, { firstAttemptKey, secondAttemptKey, expiredAttemptKey, lostParentId: lostParent.id });
  await page.reload();
  dialog = page.getByRole("dialog", { name: "Start process" });
  await dialog.getByText("This saved process attempt is too old to retry safely.").waitFor();
  assert.equal(await dialog.getByLabel("Task name").inputValue(), "Expired attempt");
  assert.equal(await dialog.getByRole("button", { name: "Resume creation" }).count(), 0);
  await dialog.getByRole("button", { name: "Open partial task" }).waitFor();
  assert.ok(await page.evaluate(key => localStorage.getItem(key), expiredAttemptKey));
  page.once("dialog", confirmation => confirmation.accept());
  await dialog.getByRole("button", { name: "Discard attempt" }).click();
  await dialog.getByText("A previous process attempt may be incomplete.").waitFor();
  assert.equal(await dialog.getByLabel("Task name").inputValue(), "Lost parent response");
  assert.equal(await page.evaluate(key => localStorage.getItem(key), expiredAttemptKey), null);
  await dialog.getByRole("button", { name: "Resume creation" }).click();
  await page.getByRole("region", { name: "Task detail" }).waitFor();
  const parent = state.tasks.find(task => task.title === "Run: Lost parent response");
  assert.equal(state.tasks.filter(task => task.title === parent.title).length, 1);
  assert.equal(state.subtasks.filter(task => task.parentTaskId === parent.id).length, 2);
  assert.equal(state.idempotencyRequests.filter(item => item.path === "/api/v1/lists/list-product/tasks")[1].key, parentRequests[0].key);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("slate:process-attempt:owner:"))), [secondAttemptKey]);

  await page.goto(`${origin}/app/templates`);
  dialog = page.getByRole("dialog", { name: "Start process" });
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel("Task name").inputValue(), "Other tab attempt");
  page.once("dialog", confirmation => confirmation.accept());
  await dialog.getByRole("button", { name: "Discard attempt" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("slate:process-attempt:owner:"))), []);

  state.loseSubtaskResponseFor = "Generate output";
  await retryRow.getByRole("button", { name: "Use template" }).click();
  dialog = page.getByRole("dialog", { name: "Start process" });
  await dialog.getByLabel("Task name").fill("Lost subtask response");
  await dialog.getByRole("button", { name: "Create task" }).click();
  await dialog.getByRole("alert").waitFor();
  const partialParent = state.tasks.find(task => task.title === "Run: Lost subtask response");
  assert.equal(state.subtasks.filter(task => task.parentTaskId === partialParent.id).length, 2);
  const savedProgress = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(item => item.startsWith("slate:process-attempt:owner:"));
    return JSON.parse(localStorage.getItem(key));
  });
  assert.equal(savedProgress.parentTaskId, partialParent.id);
  assert.equal(savedProgress.nextStepIndex, 1);
  const parentWrites = () => state.idempotencyRequests.filter(item => state.idempotency.get(item.key)?.id === partialParent.id);
  const completedStepWrites = () => state.idempotencyRequests.filter(item => state.idempotency.get(item.key)?.title === "Capture input" && state.idempotency.get(item.key)?.parentTaskId === partialParent.id);
  const lostStepRequests = () => state.idempotencyRequests.filter(item => state.idempotency.get(item.key)?.title === "Generate output" && state.idempotency.get(item.key)?.parentTaskId === partialParent.id);
  const lostStepKey = lostStepRequests()[0].key;
  await dialog.getByRole("button", { name: "Retry creation" }).click();
  await page.getByRole("region", { name: "Task detail" }).waitFor();
  assert.equal(state.tasks.filter(task => task.title === partialParent.title).length, 1);
  assert.equal(state.subtasks.filter(task => task.parentTaskId === partialParent.id).length, 2);
  assert.equal(parentWrites().length, 1);
  assert.equal(completedStepWrites().length, 1);
  assert.equal(lostStepRequests().length, 2);
  assert.equal(lostStepRequests()[1].key, lostStepKey);
  assert.deepEqual(pageErrors, []);
});

test("templates can be created and edited without leaking across accounts", async t => {
  const { page, state, origin, pageErrors } = await startApp(t);
  await page.goto(`${origin}/app/templates`);
  await page.locator(".template-page-header").getByRole("button", { name: "New template" }).click();
  const editor = page.getByRole("dialog", { name: "New template" });
  assert.deepEqual((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations, []);
  await editor.getByLabel("Template name").fill("Publish a podcast");
  await editor.getByLabel("Description").fill("Turn one recording into a published episode.");
  await editor.getByLabel("Phase 1 subtask 1").fill("Record the episode");
  await editor.getByRole("button", { name: "Add subtask" }).click();
  await editor.getByLabel("Phase 1 subtask 2").fill("Edit the episode");
  await editor.getByRole("button", { name: "Add phase" }).click();
  await editor.getByLabel("Phase 2 name").fill("Publish");
  await editor.getByLabel("Publish subtask 1").fill("Write the show notes");
  const firstPhaseName = editor.getByLabel("Phase 1 name");
  await firstPhaseName.fill("");
  await firstPhaseName.pressSequentially("Publish prep");
  await editor.getByRole("button", { name: "Move Publish up" }).click();
  await editor.getByRole("button", { name: "Save template" }).click();

  await page.getByRole("heading", { name: "Publish a podcast", exact: true }).first().waitFor();
  const podcastRow = page.locator(".template-list-row").filter({ hasText: "Publish a podcast" });
  await podcastRow.getByRole("button", { name: "Use template" }).click();
  const runDialog = page.getByRole("dialog", { name: "Start process" });
  await runDialog.getByLabel("Task name").fill("Episode 12");
  await runDialog.getByLabel("List").selectOption("list-product");
  await runDialog.getByRole("button", { name: "Create task" }).click();
  await page.getByRole("region", { name: "Task detail" }).waitFor();
  const parent = state.tasks.find(task => task.title === "Run: Episode 12");
  assert.ok(parent);
  const generated = state.subtasks.filter(task => task.parentTaskId === parent.id);
  assert.deepEqual(generated.map(task => task.title), ["Write the show notes", "Record the episode", "Edit the episode"]);
  assert.deepEqual(await page.locator(".subtask-title").allTextContents(), ["Write the show notes", "Record the episode", "Edit the episode"]);

  await page.goto(`${origin}/app/templates`);
  await page.locator(".template-list-row").filter({ hasText: "Publish a podcast" }).getByRole("button", { name: "Edit" }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit template" });
  await editDialog.getByLabel("Template name").fill("Publish a podcast episode");
  await editDialog.getByRole("button", { name: "Save template" }).click();
  await page.reload();
  await page.getByRole("heading", { name: "Publish a podcast episode", exact: true }).first().waitFor();

  state.user = { ...state.user, id: "another-owner", email: "another@example.com" };
  await page.reload();
  await page.getByRole("heading", { name: "No templates yet" }).waitFor();
  assert.equal(await page.locator(".template-list-row").count(), 0);
  assert.equal(await page.getByRole("heading", { name: "Publish a podcast episode", exact: true }).count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("task detail edits, subtasks, and conversation entries use the existing API", async t => {
  const { page, state } = await startApp(t);
  await page.getByRole("button", { name: "Open task: Publish task-first agents video" }).click();
  await page.getByRole("region", { name: "Task detail" }).waitFor();
  assert.equal(await page.getByRole("menuitem", { name: "Delete task" }).count(), 0);
  await page.getByRole("button", { name: "Task actions" }).click();
  await page.getByRole("menuitem", { name: "Delete task" }).waitFor();
  await page.getByRole("menu").press("Escape");
  await page.getByLabel("Title", { exact: true }).fill("Publish the React migration story");
  await page.getByRole("button", { name: "Add subtask" }).click();
  await page.getByLabel("New subtask title").fill("Discard this draft");
  await page.keyboard.press("Escape");
  await page.getByLabel("New subtask title").waitFor({ state: "detached" });
  await page.getByRole("region", { name: "Task detail" }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Publish the React migration story");
  await page.getByRole("button", { name: "Add subtask" }).click();
  await page.getByLabel("New subtask title").fill("Record the final walkthrough");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.locator(".subtask-row").filter({ hasText: "Record the final walkthrough" }).waitFor();
  await page.getByRole("button", { name: "Complete Record the final walkthrough" }).click();
  await page.getByRole("button", { name: "Reopen Record the final walkthrough" }).waitFor();
  await page.getByLabel("Entry").fill("The interface is ready for review.");
  await page.getByRole("button", { name: "Add comment" }).click();
  await page.getByText("The interface is ready for review.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("region", { name: "Task detail" }).waitFor({ state: "detached" });
  assert.equal(state.tasks[0].title, "Publish the React migration story");
  assert.equal(state.subtasks.find(task => task.title === "Record the final walkthrough").status, "done");
});

test("dragging a task moves it through the workflow", async t => {
  const { page, state } = await startApp(t);
  const card = page.locator('[data-task="task-inbox"]');
  await card.dragTo(page.locator('[data-status="working"]'));
  await page.waitForFunction(() => document.querySelector('[data-status="working"] [data-task="task-inbox"]'));
  assert.equal(state.tasks.find(task => task.id === "task-inbox").status, "working");
});

test("lists, inbox, agents, and settings are complete React routes", async t => {
  const { page, origin } = await startApp(t);
  await page.getByRole("button", { name: "New list" }).click();
  await page.getByLabel("Name").fill("Launch");
  await page.getByRole("button", { name: "Create list" }).click();
  await page.getByLabel("List name").waitFor();
  assert.equal(await page.getByLabel("List name").inputValue(), "Launch");
  assert.equal(await page.getByRole("menuitem", { name: "Delete list" }).count(), 0);
  await page.getByRole("button", { name: "List actions" }).click();
  await page.getByRole("menuitem", { name: "Delete list" }).waitFor();
  await page.getByRole("menu").press("Escape");
  await page.goto(`${origin}/app/inbox`);
  await page.getByText("I have drafted the spec. Can you take a look?").waitFor();
  await page.goto(`${origin}/app/agents`);
  await page.getByText("Research agent", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  await page.getByRole("tab", { name: "API access" }).click();
  await page.getByPlaceholder("For example, laptop CLI").fill("Laptop CLI");
  await page.getByRole("button", { name: "Create token" }).click();
  await page.getByText("slate_personal_one_time_secret").waitFor();
});

test("hosted control plane exposes search, runs, runners, and human review", async t => {
  const { page, state, origin } = await startApp(t);
  await page.getByRole("button", { name: /Search/ }).click();
  await page.getByLabel("Search task titles").fill("Publish task");
  await page.getByRole("button", { name: /Publish task-first agents video/ }).waitFor();
  await page.getByLabel("Search task titles").press("Escape");

  await page.goto(`${origin}/app/runs`);
  await page.getByRole("heading", { name: "Runs", exact: true }).waitFor();
  await page.getByText("Publish task-first agents video", { exact: true }).waitFor();
  await page.getByText("Running", { exact: true }).first().waitFor();

  await page.goto(`${origin}/app/runners`);
  await page.getByText("Hosted coordination, local execution", { exact: true }).waitFor();
  await page.getByText("Research agent", { exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Connect agent" }).evaluate(element => getComputedStyle(element).color), "rgb(21, 22, 26)");

  state.tasks[0].status = "needs_review";
  state.tasks[0].reviewReason = "Check the final draft before it ships.";
  await page.goto(`${origin}/app/inbox`);
  await page.getByRole("heading", { name: "Needs your review" }).waitFor();
  await page.getByText("Check the final draft before it ships.").waitFor();
  await page.getByRole("button", { name: /Publish task-first agents video/ }).first().click();
  await page.getByRole("button", { name: "Approve" }).waitFor();
});

test("mobile navigation and task detail fit a narrow viewport", async t => {
  const { page, state, origin, pageErrors } = await startApp(t, { width: 390, height: 844 });
  const title = "Publish task-first agents video";
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const tableActions = page.getByRole("button", { name: `Actions for ${title}` });
  assert.equal(await tableActions.isVisible(), true);
  await tableActions.click();
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete task?" });
  await deleteDialog.getByText(`Delete “${title}”? All of its subtasks will also be deleted.`, { exact: true }).waitFor();
  await deleteDialog.getByRole("button", { name: "Cancel" }).click();
  assert.ok(state.tasks.some(task => task.id === "task-parent"));
  assert.ok(state.subtasks.some(task => task.id === "task-child"));
  await page.getByRole("button", { name: "Open navigation" }).click();
  assert.equal(await page.locator("#primary-navigation").evaluate(element => element.classList.contains("open")), true);
  await page.getByRole("button", { name: "Close navigation" }).first().click();
  await page.getByRole("button", { name: "Open task: Publish task-first agents video" }).click();
  const bounds = await page.getByRole("region", { name: "Task detail" }).boundingBox();
  assert.ok(bounds.width <= 390);

  await page.goto(`${origin}/app/templates`);
  const mobileRow = await createTemplate(page, "Mobile process", ["Capture input", "Generate output"]);
  state.loseSubtaskResponseFor = "Generate output";
  await mobileRow.getByRole("button", { name: "Use template" }).click();
  const processDialog = page.getByRole("dialog", { name: "Start process" });
  await processDialog.getByLabel("Task name").fill("Mobile partial process");
  await processDialog.getByRole("button", { name: "Create task" }).click();
  await processDialog.getByText("The parent task was created, but the workflow is incomplete.").waitFor();
  const dialogBounds = await processDialog.boundingBox();
  for (const name of ["Discard attempt", "Open partial task", "Keep for later", "Retry creation"]) {
    const buttonBounds = await processDialog.getByRole("button", { name }).boundingBox();
    assert.ok(buttonBounds.x >= dialogBounds.x && buttonBounds.x + buttonBounds.width <= dialogBounds.x + dialogBounds.width);
  }
  assert.deepEqual(pageErrors, []);
});

function json(response, body, status = 200) { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); }
async function requestJSON(request) { let body = ""; for await (const chunk of request) body += chunk; return JSON.parse(body || "{}"); }
function file(response, name, type) { response.writeHead(200, { "Content-Type": type }); response.end(fs.readFileSync(path.join(dist, name))); }
