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
      const idempotencyKey = request.headers["idempotency-key"];
      state.idempotencyRequests.push({ path: url.pathname, key: idempotencyKey });
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
  for (const heading of ["Task", "Status", "Agent", "List", "Priority", "Planned"]) await table.getByRole("columnheader", { name: heading }).waitFor();
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

test("new tasks persist a priority and start in the selected column", async t => {
  const { page, state } = await startApp(t);
  await page.getByRole("button", { name: "Add task to In Progress" }).click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByRole("textbox", { name: "Task title" }).fill("Prepare the launch review");
  await dialog.getByRole("textbox", { name: "Task brief" }).fill("Bring the decision and supporting evidence together.");
  await dialog.getByRole("button", { name: "Priority" }).click();
  await page.getByRole("menuitem", { name: "Normal" }).click();
  await dialog.getByRole("button", { name: "Create task" }).click();
  await page.getByRole("dialog", { name: "Task detail" }).waitFor();
  const created = state.tasks.find(task => task.title === "Prepare the launch review");
  assert.equal(created.priority, "p2");
  assert.equal(created.status, "working");
  assert.equal(state.requests.some(request => request.startsWith(`PATCH /api/v1/tasks/${created.id}`)), false);
});

test("the YouTube template creates one parent task with an ordered workflow", async t => {
  const { page, state, origin, pageErrors } = await startApp(t);
  await page.goto(`${origin}/app/templates`);
  await page.getByRole("heading", { name: "Templates", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Publish a YouTube video", exact: true }).first().waitFor();
  assert.equal(await page.getByRole("listitem").count(), 17);
  const accessibility = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(accessibility.violations, []);

  await page.getByRole("button", { name: "Use template" }).click();
  const dialog = page.getByRole("dialog", { name: "Start process" });
  assert.deepEqual((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations, []);
  await dialog.getByLabel("Task name").fill("How I build agent workflows");
  await dialog.getByLabel("Plan for").fill("2026-08-29");
  await dialog.getByLabel("List").selectOption("list-product");
  await dialog.getByLabel("Brief").fill("Join the agent course after watching the final video.");
  await dialog.getByRole("button", { name: "Create task" }).click();

  await page.getByRole("region", { name: "Task detail" }).waitFor();
  await page.getByText("0/17", { exact: true }).waitFor();
  const parent = state.tasks.find(task => task.title === "Publish: How I build agent workflows");
  assert.ok(parent);
  assert.equal(parent.bucketId, "list-product");
  assert.equal(parent.scheduledDate, "2026-08-29");
  assert.match(parent.description, /Join the agent course after watching the final video/);
  const generated = state.subtasks.filter(task => task.parentTaskId === parent.id);
  assert.equal(generated.length, 17);
  assert.deepEqual(generated.slice(0, 6).map(task => task.title), ["Capture the idea", "Generate title options", "Approve the title", "Write the outline", "Handwrite the introduction", "Write the script"]);
  assert.deepEqual((await page.locator(".subtask-title").allTextContents()).slice(0, 6), ["Capture the idea", "Generate title options", "Approve the title", "Write the outline", "Handwrite the introduction", "Write the script"]);
  assert.equal(generated.find(task => task.title === "Write the Kit promotional email").assigneeAgentId, "");
  assert.match(generated.find(task => task.title === "Write the Kit promotional email").description, /Suggested executor: Agent-ready/);
  assert.deepEqual(pageErrors, []);
});

test("the built-in template is read-only and can be duplicated", async t => {
  const { page, origin, pageErrors } = await startApp(t);
  await page.goto(`${origin}/app/templates`);
  const builtIn = page.locator(".template-list-row").filter({ hasText: "Publish a YouTube video" });
  await builtIn.getByText("Built-in", { exact: true }).waitFor();
  assert.equal(await builtIn.getByRole("button", { name: "Edit" }).count(), 0);
  assert.equal(await builtIn.getByRole("button", { name: "Delete" }).count(), 0);

  await builtIn.getByRole("button", { name: "Duplicate" }).click();
  const duplicate = page.getByRole("dialog", { name: "Duplicate template" });
  assert.equal(await duplicate.getByLabel("Template name").inputValue(), "Publish a YouTube video copy");
  await duplicate.getByRole("button", { name: "Save template" }).click();
  const copy = page.locator(".template-list-row").filter({ hasText: "Publish a YouTube video copy" });
  await copy.getByRole("button", { name: "Edit" }).waitFor();
  await copy.getByRole("button", { name: "Delete" }).waitFor();
  assert.deepEqual(pageErrors, []);
});

test("template deletion confirms, selects a neighbour, and leaves generated tasks unchanged", async t => {
  const { page, state, origin, pageErrors } = await startApp(t);
  await page.goto(`${origin}/app/templates`);
  await page.getByRole("button", { name: "New template" }).click();
  const editor = page.getByRole("dialog", { name: "New template" });
  await editor.getByLabel("Template name").fill("Temporary launch process");
  await editor.getByLabel("Phase 1 subtask 1").fill("Prepare the launch");
  await editor.getByRole("button", { name: "Save template" }).click();

  const row = page.locator(".template-list-row").filter({ hasText: "Temporary launch process" });
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
  assert.equal(await cancel.evaluate(element => document.activeElement === element), true);
  await cancel.click();
  await savedRow.waitFor();
  await deleteButton.evaluate(element => new Promise(resolve => {
    const check = () => document.activeElement === element ? resolve() : requestAnimationFrame(check);
    check();
  }));

  await deleteButton.click();
  await confirmation.getByRole("button", { name: "Delete template" }).click();
  await savedRow.waitFor({ state: "detached" });
  const builtInSelect = page.locator(".template-list-row").filter({ hasText: "Publish a YouTube video" }).locator(".template-list-select");
  assert.equal(await builtInSelect.getAttribute("aria-pressed"), "true");
  await builtInSelect.evaluate(element => new Promise(resolve => {
    const check = () => document.activeElement === element ? resolve() : requestAnimationFrame(check);
    check();
  }));
  assert.ok(state.tasks.some(task => task.id === generatedParent.id));
  assert.deepEqual(state.subtasks.filter(task => task.parentTaskId === generatedParent.id).map(task => task.id), generatedSubtasks);
  assert.deepEqual(pageErrors, []);
});

test("valid legacy templates survive malformed siblings and migrate stable step IDs", async t => {
  const { page, origin, pageErrors } = await startApp(t);
  await page.evaluate(() => localStorage.setItem("slate:process-templates:owner", JSON.stringify([
    { id: "youtube-weekly", name: "Overwritten built-in", summary: "Wrong", taskPrefix: "Wrong", phases: [{ id: "wrong", name: "Wrong" }], steps: [{ phaseId: "wrong", title: "Wrong", executor: "Human", instruction: "Wrong" }] },
    { id: "legacy-podcast", name: "Legacy podcast", summary: "A valid old template", taskPrefix: "Run", phases: ["Draft"], steps: [{ phase: "Draft", title: "Write the outline", executor: "Human", instruction: "Start with the promise." }] },
    { id: "broken", name: "Broken template" },
  ])));
  await page.goto(`${origin}/app/templates`);
  await page.getByRole("heading", { name: "Publish a YouTube video", exact: true }).first().waitFor();
  await page.getByRole("heading", { name: "Legacy podcast", exact: true }).first().waitFor();
  assert.equal(await page.getByText("Overwritten built-in", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Broken template", { exact: true }).count(), 0);
  const firstStored = await page.evaluate(() => JSON.parse(localStorage.getItem("slate:process-templates:owner")));
  assert.equal(firstStored.length, 1);
  assert.match(firstStored[0].steps[0].id, /^legacy-podcast-step-/);
  const migratedStepId = firstStored[0].steps[0].id;
  await page.reload();
  const reloaded = await page.evaluate(() => JSON.parse(localStorage.getItem("slate:process-templates:owner")));
  assert.equal(reloaded[0].steps[0].id, migratedStepId);
  assert.deepEqual(pageErrors, []);
});

test("uncertain parent and subtask responses are retry-safe", async t => {
  const { page, state, origin, pageErrors } = await startApp(t);
  await page.goto(`${origin}/app/templates`);

  state.loseParentResponse = true;
  await page.getByRole("button", { name: "Use template" }).click();
  let dialog = page.getByRole("dialog", { name: "Start process" });
  await dialog.getByLabel("Task name").fill("Lost parent response");
  await dialog.getByRole("button", { name: "Create task" }).click();
  await dialog.getByRole("alert").waitFor();
  assert.equal(state.tasks.filter(task => task.title === "Publish: Lost parent response").length, 1);
  const parentRequests = state.idempotencyRequests.filter(item => item.path === "/api/v1/lists/list-product/tasks");
  await dialog.getByRole("button", { name: "Retry creation" }).click();
  await page.getByRole("region", { name: "Task detail" }).waitFor();
  const parent = state.tasks.find(task => task.title === "Publish: Lost parent response");
  assert.equal(state.tasks.filter(task => task.title === parent.title).length, 1);
  assert.equal(state.subtasks.filter(task => task.parentTaskId === parent.id).length, 17);
  assert.equal(state.idempotencyRequests.filter(item => item.path === "/api/v1/lists/list-product/tasks")[1].key, parentRequests[0].key);

  await page.goto(`${origin}/app/templates`);
  state.loseSubtaskResponseFor = "Generate title options";
  await page.getByRole("button", { name: "Use template" }).click();
  dialog = page.getByRole("dialog", { name: "Start process" });
  await dialog.getByLabel("Task name").fill("Lost subtask response");
  await dialog.getByRole("button", { name: "Create task" }).click();
  await dialog.getByRole("alert").waitFor();
  const partialParent = state.tasks.find(task => task.title === "Publish: Lost subtask response");
  assert.equal(state.subtasks.filter(task => task.parentTaskId === partialParent.id).length, 2);
  const lostStepRequests = () => state.idempotencyRequests.filter(item => state.idempotency.get(item.key)?.title === "Generate title options" && state.idempotency.get(item.key)?.parentTaskId === partialParent.id);
  const lostStepKey = lostStepRequests()[0].key;
  await dialog.getByRole("button", { name: "Retry creation" }).click();
  await page.getByRole("region", { name: "Task detail" }).waitFor();
  assert.equal(state.tasks.filter(task => task.title === partialParent.title).length, 1);
  assert.equal(state.subtasks.filter(task => task.parentTaskId === partialParent.id).length, 17);
  assert.equal(lostStepRequests().length, 2);
  assert.equal(lostStepRequests()[1].key, lostStepKey);
  assert.deepEqual(pageErrors, []);
});

test("templates can be created and edited without leaking across accounts", async t => {
  const { page, state, origin, pageErrors } = await startApp(t);
  await page.goto(`${origin}/app/templates`);
  await page.getByRole("button", { name: "New template" }).click();
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
  await page.getByRole("heading", { name: "Publish a YouTube video", exact: true }).first().waitFor();
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
  const { page, pageErrors } = await startApp(t, { width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  assert.equal(await page.locator("#primary-navigation").evaluate(element => element.classList.contains("open")), true);
  await page.getByRole("button", { name: "Close navigation" }).first().click();
  await page.getByRole("button", { name: "Open task: Publish task-first agents video" }).click();
  const bounds = await page.getByRole("region", { name: "Task detail" }).boundingBox();
  assert.ok(bounds.width <= 390);
  assert.deepEqual(pageErrors, []);
});

function json(response, body, status = 200) { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); }
async function requestJSON(request) { let body = ""; for await (const chunk of request) body += chunk; return JSON.parse(body || "{}"); }
function file(response, name, type) { response.writeHead(200, { "Content-Type": type }); response.end(fs.readFileSync(path.join(dist, name))); }
