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
  const agents = [
    { id: "agent-research", displayName: "Research agent", purpose: "Research assigned work", credential: {}, workCounts: { ready: 1 } },
    { id: "agent-archived", displayName: "Archived agent", purpose: "Historical collaborator", archivedAt: "2026-08-01T10:00:00Z", credential: { revokedAt: "2026-08-01T10:00:00Z" }, workCounts: { completed: 2 } },
  ];
  return { lists, tasks, subtasks, agents, deletedAgents: [], taskQueries: [], created: [], createdLists: [], patches: [], requests: [], failNextSubtask: false, delayNextSubtask: false, releaseSubtask: null, failNextStatus: false, delayNextStatus: false, releaseStatus: null, delayNextDelete: false, releaseDelete: null, delayNextWorkspaceTasks: false, releaseWorkspaceTasks: null };
}

async function startWorkspace(t, viewport = { width: 1440, height: 960 }) {
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
    if (url.pathname === "/api/v1/boards/board-one/buckets" && request.method === "POST") {
      const input = await requestJSON(request);
      const created = { id: `list-created-${state.createdLists.length + 1}`, boardId: "board-one", boardName: "Workspace", name: input.name, goal: "", isInbox: false, openCount: 0 };
      state.lists.push(created);
      state.createdLists.push(created);
      return json(response, created, 201);
    }
    if (url.pathname === "/api/v1/lists" && request.method === "GET") return json(response, { lists: state.lists });
    if (url.pathname === "/api/v1/agents" && request.method === "GET") return json(response, { agents: state.agents, maxAgents: 5 });
    const permanentAgentMatch = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)\/permanent$/);
    if (permanentAgentMatch && request.method === "DELETE") {
      const index = state.agents.findIndex(agent => agent.id === permanentAgentMatch[1]);
      if (index < 0) return json(response, { error: "agent not found" }, 404);
      if (!state.agents[index].archivedAt) return json(response, { code: "agent_not_archived", error: "Archive this agent before permanently deleting it." }, 409);
      state.deletedAgents.push(state.agents[index].id);
      state.agents.splice(index, 1);
      return json(response, { ok: true });
    }
    const agentMatch = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)$/);
    if (agentMatch && request.method === "GET") {
      const agent = state.agents.find(item => item.id === agentMatch[1]);
      return agent ? json(response, { agent, work: { ready: [], working: [], review: [], recentlyCompleted: [], totals: agent.workCounts || {} } }) : json(response, { error: "agent not found" }, 404);
    }
    if (url.pathname === "/api/v1/tasks" && request.method === "GET") {
      state.taskQueries.push(url.search);
      if (url.searchParams.has("parentTaskId")) return json(response, { tasks: state.subtasks.filter(item => item.parentTaskId === url.searchParams.get("parentTaskId")) });
      if (state.delayNextWorkspaceTasks) {
        state.delayNextWorkspaceTasks = false;
        await new Promise(resolve => { state.releaseWorkspaceTasks = resolve; });
      }
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
      if (state.failNextSubtask) {
        state.failNextSubtask = false;
        return json(response, { error: "Could not add subtask" }, 500);
      }
      if (state.delayNextSubtask) {
        state.delayNextSubtask = false;
        await new Promise(resolve => { state.releaseSubtask = resolve; });
      }
      const parent = state.tasks.find(item => item.id === subtaskMatch[1]);
      const created = { ...parent, id: `task-child-${state.subtasks.length + 1}`, parentTaskId: parent.id, title: input.title, description: "", done: false, status: "queued", priority: "", assigneeAgentId: "", assigneeAgentName: "" };
      state.subtasks.push(created);
      return json(response, created, 201);
    }
    const statusMatch = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/status$/);
    if (statusMatch && request.method === "PATCH") {
      const input = await requestJSON(request);
      if (state.failNextStatus) {
        state.failNextStatus = false;
        return json(response, { error: "Could not save task" }, 500);
      }
      if (state.delayNextStatus) {
        state.delayNextStatus = false;
        await new Promise(resolve => { state.releaseStatus = resolve; });
      }
      const task = [...state.tasks, ...state.subtasks].find(item => item.id === statusMatch[1]);
      Object.assign(task, input, { done: input.status === "done" });
      state.patches.push({ id: task.id, ...input });
      return json(response, task);
    }
    const taskMatch = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)$/);
    if (taskMatch && request.method === "DELETE") {
      if (state.delayNextDelete) {
        state.delayNextDelete = false;
        await new Promise(resolve => { state.releaseDelete = resolve; });
      }
      const index = state.tasks.findIndex(item => item.id === taskMatch[1]);
      if (index >= 0) state.tasks.splice(index, 1);
      return json(response, {});
    }
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
  const page = await browser.newPage({ viewport });
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
  assert.ok(parseFloat(await page.locator(".task-nav-pages .nav-link").first().evaluate(element => getComputedStyle(element).fontSize)) >= 13);
  assert.ok(parseFloat(await page.locator(".workspace-table-head").evaluate(element => getComputedStyle(element).fontSize)) >= 11);
  assert.ok(parseFloat(await page.locator(".workspace-table-row strong").first().evaluate(element => getComputedStyle(element).fontSize)) >= 14);
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

test("an older workspace response cannot replace the latest route", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  state.delayNextWorkspaceTasks = true;
  await page.getByRole("button", { name: "Flow", exact: true }).click();
  await waitFor(() => typeof state.releaseWorkspaceTasks === "function");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByRole("heading", { name: "All tasks", exact: true }).waitFor();
  state.releaseWorkspaceTasks();
  await page.waitForTimeout(100);

  assert.match(page.url(), /\/app\/tasks\?view=list$/);
  assert.equal(await page.getByRole("heading", { name: "All tasks", exact: true }).isVisible(), true);
  assert.equal(await page.getByRole("heading", { name: "Not found.", exact: true }).count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("a new list is available for agent assignment without refreshing", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  page.once("dialog", dialog => dialog.accept("Launch plan"));
  await page.getByRole("button", { name: "New list", exact: true }).click();
  await waitFor(() => state.createdLists.length === 1);
  await page.getByText("Launch plan", { exact: true }).waitFor();

  await page.getByRole("link", { name: "All agents", exact: true }).click();
  await page.getByRole("heading", { name: "Agents", exact: true }).waitFor();
  await page.locator('[data-agent-link="agent-research"]').click();
  await page.getByRole("heading", { name: "Research agent", exact: true }).waitFor();
  await page.getByRole("button", { name: "Assign work", exact: true }).click();

  const list = page.getByLabel("List", { exact: true });
  await list.selectOption(state.createdLists[0].id);
  assert.equal(await list.inputValue(), state.createdLists[0].id);
  assert.equal(await list.locator("option", { hasText: "Launch plan" }).count(), 1);
  assert.deepEqual(pageErrors, []);
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
  await page.getByRole("region", { name: "Task detail" }).waitFor({ state: "detached" });
  await page.locator(`[data-open-task="${state.created[0].id}"]`).getByText("Prepare launch brief", { exact: true }).waitFor();
  assert.equal(state.patches.at(-1).title, "Prepare launch brief");
  assert.equal(state.patches.at(-1).priority, "p0");
});

test("task detail coordinates one level of human and agent subtasks through the CLI model", async t => {
  const { page, state } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  const dialog = page.getByRole("region", { name: "Task detail" });
  await dialog.waitFor();
  assert.equal(await page.getByText("Subtasks", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("1 of 1 complete", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("Research examples", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("slate tasks pull", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText(/refine with|scout|autopilot/i).count(), 0);
  const bounds = await dialog.boundingBox();
  assert.ok(bounds.width >= 1180, `detail width=${bounds.width}`);
  assert.ok(bounds.height >= 940, `detail height=${bounds.height}`);
  assert.ok(bounds.x >= 220, `detail x=${bounds.x}`);
  assert.equal(await page.getByRole("complementary").first().isVisible(), true, "sidebar stays visible");
  assert.equal(await page.locator(".workspace-table").count(), 0, "detail replaces the task table");
  assert.equal(await dialog.locator(".workspace-detail-main").count(), 1);
  assert.equal(await dialog.getByRole("complementary", { name: "Task properties" }).count(), 1);
  assert.equal(parseFloat(await page.locator("#workspace-detail-title").evaluate(element => getComputedStyle(element).fontSize)), 26);

  await page.getByLabel("Title", { exact: true }).fill("Unsaved parent title");
  await page.getByLabel("Task brief", { exact: true }).fill("Unsaved parent brief");
  await page.getByLabel("Priority", { exact: true }).selectOption("p2");

  await page.getByRole("button", { name: "Mark Research examples not complete", exact: true }).click();
  await page.getByText("0 of 1 complete", { exact: true }).waitFor();
  assert.equal(state.patches.at(-1).id, "task-child");
  assert.equal(state.patches.at(-1).status, "queued");
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved parent title");
  assert.equal(await page.getByLabel("Task brief", { exact: true }).inputValue(), "Unsaved parent brief");
  assert.equal(await page.getByLabel("Priority", { exact: true }).inputValue(), "p2");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-toggle-subtask")), "task-child");

  await page.getByLabel("Subtask title", { exact: true }).fill("Human final review");
  state.failNextSubtask = true;
  await page.locator("#add-subtask").getByRole("button", { name: "Add subtask", exact: true }).click();
  await page.getByText("Could not add subtask", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Subtask title", { exact: true }).inputValue(), "Human final review");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Subtask title");
  await page.locator("#add-subtask").getByRole("button", { name: "Add subtask", exact: true }).click();
  await page.getByText("Human final review", { exact: true }).waitFor();
  assert.equal(state.subtasks.length, 2);
  assert.equal(state.subtasks[1].parentTaskId, "task-parent");
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved parent title");
  assert.equal(await page.getByLabel("Task brief", { exact: true }).inputValue(), "Unsaved parent brief");
  assert.equal(await page.getByLabel("Priority", { exact: true }).inputValue(), "p2");

  await page.getByText("Human final review", { exact: true }).click();
  await page.getByRole("button", { name: "Back to parent task", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Subtask title", { exact: true }).count(), 0, "subtasks cannot contain subtasks");
  await page.getByLabel("Title", { exact: true }).fill("Unsaved child title");
  await page.getByRole("button", { name: "Back to parent task", exact: true }).click();
  await page.getByText("Subtasks", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved parent title");
  assert.equal(await page.getByText("Human final review", { exact: true }).isVisible(), true);
  await page.getByText("Human final review", { exact: true }).click();
  await page.getByRole("button", { name: "Back to parent task", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved child title");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Subtasks", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved parent title");
  assert.equal(await page.getByText("Unsaved child title", { exact: true }).isVisible(), true);
  await page.getByRole("button", { name: "Back to tasks", exact: true }).click();
  await page.getByRole("heading", { name: "All tasks", exact: true }).waitFor();
  assert.equal(await page.locator(".workspace-table").isVisible(), true);
});

test("task detail remains usable on a phone-sized viewport", async t => {
  const { page } = await startWorkspace(t, { width: 390, height: 844 });

  await page.locator('[data-open-task="task-parent"]').click();
  const dialog = page.getByRole("region", { name: "Task detail" });
  await dialog.waitFor();
  const bounds = await dialog.boundingBox();
  assert.ok(bounds.width >= 384, `dialog width=${bounds.width}`);
  assert.ok(bounds.height >= 780, `detail height=${bounds.height}`);
  assert.equal(await dialog.getByRole("complementary", { name: "Task properties" }).isVisible(), true);
  assert.equal(parseFloat(await page.locator("#workspace-detail-title").evaluate(element => getComputedStyle(element).fontSize)), 24);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test("task detail stacks its properties rail at tablet width", async t => {
  const { page } = await startWorkspace(t, { width: 720, height: 900 });

  await page.locator('[data-open-task="task-parent"]').click();
  const mainBounds = await page.locator(".workspace-detail-main").boundingBox();
  const propertyBounds = await page.locator(".workspace-detail-properties").boundingBox();
  assert.ok(mainBounds.width >= 650, `main width=${mainBounds.width}`);
  assert.ok(Math.abs(mainBounds.width - propertyBounds.width) <= 2, `main=${mainBounds.width} properties=${propertyBounds.width}`);
  assert.equal(parseFloat(await page.locator("#workspace-detail-title").evaluate(element => getComputedStyle(element).fontSize)), 25);
  assert.ok(propertyBounds.y > mainBounds.y);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test("a delayed subtask response cannot overwrite a reopened task surface", async t => {
  const { page, state } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Draft from the old surface");
  await page.getByLabel("Subtask title", { exact: true }).fill("Delayed subtask");
  state.delayNextSubtask = true;
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await waitFor(() => typeof state.releaseSubtask === "function");

  await page.getByRole("button", { name: "Back to tasks", exact: true }).click();
  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Draft from the new surface");
  state.releaseSubtask();
  await waitFor(() => state.subtasks.some(item => item.title === "Delayed subtask"));
  await page.getByText("Delayed subtask", { exact: true }).waitFor();

  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Draft from the new surface");
  assert.equal(await page.getByText("Delayed subtask", { exact: true }).isVisible(), true);
  assert.equal(await page.getByRole("button", { name: "Add subtask", exact: true }).isEnabled(), true);
});

test("sidebar navigation clears subtask state before another task opens", async t => {
  const { page } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Subtask title", { exact: true }).fill("Must stay with the parent");
  await page.getByRole("link", { name: /Inbox/ }).click();
  await page.getByRole("heading", { name: "Inbox", exact: true }).waitFor();
  await page.locator('[data-open-task="task-inbox"]').click();

  assert.equal(await page.getByLabel("Subtask title", { exact: true }).inputValue(), "");
  assert.equal(await page.getByText("Could not add subtask", { exact: true }).count(), 0);
});

test("a delayed save cannot close or overwrite a newer task surface", async t => {
  const { page, state } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Saved parent title");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");

  await page.getByRole("button", { name: "Back to tasks", exact: true }).click();
  await page.locator('[data-open-task="task-inbox"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Draft on the newer surface");
  state.releaseStatus();
  await waitFor(() => state.patches.some(item => item.id === "task-parent" && item.title === "Saved parent title"));
  await page.waitForTimeout(50);

  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Draft on the newer surface");
  assert.equal(await page.getByRole("region", { name: "Task detail" }).isVisible(), true);
  await page.getByRole("button", { name: "Back to tasks", exact: true }).click();
  assert.equal(await page.getByText("Saved parent title", { exact: true }).isVisible(), true);
});

test("a failed save preserves every unsaved task field", async t => {
  const { page, state } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Unsaved title after failure");
  await page.getByLabel("Task brief", { exact: true }).fill("Unsaved brief after failure");
  await page.getByLabel("Priority", { exact: true }).selectOption("p2");
  state.failNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Could not save task", { exact: true }).waitFor();

  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved title after failure");
  assert.equal(await page.getByLabel("Task brief", { exact: true }).inputValue(), "Unsaved brief after failure");
  assert.equal(await page.getByLabel("Priority", { exact: true }).inputValue(), "p2");
});

test("a delayed delete cannot close a newer surface and disappears from the overview", async t => {
  const { page, state } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  state.delayNextDelete = true;
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete task", exact: true }).click();
  await waitFor(() => typeof state.releaseDelete === "function");

  await page.getByRole("button", { name: "Back to tasks", exact: true }).click();
  await page.locator('[data-open-task="task-inbox"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Newer task stays open");
  state.releaseDelete();
  await waitFor(() => !state.tasks.some(item => item.id === "task-parent"));
  await page.waitForTimeout(50);

  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Newer task stays open");
  await page.getByRole("button", { name: "Back to tasks", exact: true }).click();
  assert.equal(await page.locator('[data-open-task="task-parent"]').count(), 0);
});

test("a delayed delete closes the same task when it has been reopened", async t => {
  const { page, state } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  state.delayNextDelete = true;
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete task", exact: true }).click();
  await waitFor(() => typeof state.releaseDelete === "function");

  await page.getByRole("button", { name: "Back to tasks", exact: true }).click();
  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByRole("region", { name: "Task detail" }).waitFor();
  state.releaseDelete();
  await waitFor(() => !state.tasks.some(item => item.id === "task-parent"));
  await page.getByRole("heading", { name: "All tasks", exact: true }).waitFor();

  assert.equal(await page.getByRole("region", { name: "Task detail" }).count(), 0);
  assert.equal(await page.locator('[data-open-task="task-parent"]').count(), 0);
});

test("only archived agents can be permanently deleted from settings", async t => {
  const { page, state, origin } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/settings`);
  await page.getByRole("heading", { name: "Research agent", exact: true }).waitFor();
  assert.equal(await page.locator("#delete-agent").count(), 0);

  await page.goto(`${origin}/app/agents/agent-archived/settings`);
  await page.getByRole("heading", { name: "Archived agent", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Restore agent", exact: true }).isVisible(), true);
  await page.locator("#delete-agent").click();
  const dialog = page.getByRole("dialog", { name: "Permanently delete this agent?", exact: true });
  assert.equal(await dialog.getByText("This cannot be undone.", { exact: false }).isVisible(), true);
  assert.equal(await dialog.getByText("Historical tasks will remain, but their agent assignment will be cleared.", { exact: false }).isVisible(), true);
  await dialog.getByRole("button", { name: "Delete permanently", exact: true }).click();

  await page.getByRole("heading", { name: "Agents", exact: true }).waitFor();
  await page.getByText("Agent permanently deleted.", { exact: true }).waitFor();
  assert.deepEqual(state.deletedAgents, ["agent-archived"]);
  assert.equal(await page.getByText("Archived agent", { exact: true }).count(), 0);
  assert.ok(state.requests.includes("DELETE /api/v1/agents/agent-archived/permanent"));
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
