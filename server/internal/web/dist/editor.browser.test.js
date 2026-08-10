const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const AxeBuilder = require("@axe-core/playwright").default;
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
      done: false, status: "new", priority: "", assigneeAgentId: "",
    },
  ];
  const subtasks = [{
    id: "task-child", boardId: "board-one", bucketId: "list-youtube", listName: "YouTube",
    parentTaskId: "task-parent", parentTaskTitle: "Publish task-first agents video", title: "Research examples", description: "", scheduledDate: "", kind: "action",
    done: true, status: "done", priority: "p1", assigneeAgentId: "agent-research", assigneeAgentName: "Research agent",
  }];
  const agents = [
    { id: "agent-research", displayName: "Research agent", purpose: "Research assigned work", credential: {}, workCounts: { ready: 1 } },
    { id: "agent-archived", displayName: "Archived agent", purpose: "Historical collaborator", archivedAt: "2026-08-01T10:00:00Z", credential: { revokedAt: "2026-08-01T10:00:00Z" }, workCounts: { completed: 2 } },
  ];
  return { lists, tasks, subtasks, agents, entries: {}, entryAttempts: {}, failNextEntryResponse: false, delayNextEntry: false, releaseEntry: null, deletedAgents: [], taskQueries: [], created: [], createdLists: [], patches: [], requests: [], subtaskIdempotency: new Map(), subtaskRequestKeys: [], commitNextSubtaskThenFail: false, hideSubtasksFromAgentOverview: false, failNextAgentDetail: false, failNextLists: false, failNextListCreate: false, failNextAgentWork: false, delayNextAgentWork: false, agentWorkRefreshCompleted: false, releaseAgentWork: null, failNextSubtask: false, delayNextSubtask: false, releaseSubtask: null, failNextStatus: false, delayNextStatus: false, releaseStatus: null, failNextCompletion: false, delayNextCompletion: false, releaseCompletion: null, failNextDelete: false, delayNextDelete: false, releaseDelete: null, failNextWorkspaceTasks: false, delayNextWorkspaceTasks: false, delayedWorkspaceTasksCompleted: false, releaseWorkspaceTasks: null, delayNextBoards: false, releaseBoards: null, delayNextList: false, releaseList: null };
}

async function startWorkspace(t, viewport = { width: 1440, height: 960 }) {
  const state = workspaceFixture();
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    state.requests.push(`${request.method} ${url.pathname}${url.search}`);
    if (url.pathname === "/api/v1/me") return json(response, {
      authenticated: true,
      user: { id: "owner", email: "owner@example.com", displayName: "Owain", theme: "dark", entitlement: { plan: "pro", limits: { boards: 5, listsPerBoard: 2, activeItemsPerList: 20, agents: 5 } } },
    });
    if (url.pathname === "/api/v1/boards" && request.method === "GET") {
      if (state.delayNextBoards) {
        state.delayNextBoards = false;
        await new Promise(resolve => { state.releaseBoards = resolve; });
      }
      return json(response, { boards: [{ id: "board-one", name: "Workspace" }, { id: "board-two", name: "Other" }] });
    }
    const boardMatch = url.pathname.match(/^\/api\/v1\/boards\/(board-one|board-two)$/);
    if (boardMatch && request.method === "GET") {
      const boardID = boardMatch[1];
      const name = boardID === "board-one" ? "Workspace" : "Other";
      return json(response, { id: boardID, name, buckets: state.lists.filter(list => list.boardId === boardID) });
    }
    const createListMatch = url.pathname.match(/^\/api\/v1\/boards\/(board-one|board-two)\/buckets$/);
    if (createListMatch && request.method === "POST") {
      const input = await requestJSON(request);
      if (state.delayNextList) {
        state.delayNextList = false;
        await new Promise(resolve => { state.releaseList = resolve; });
      }
      if (state.failNextListCreate) {
        state.failNextListCreate = false;
        return json(response, { error: "Could not create list" }, 500);
      }
      const boardID = createListMatch[1];
      const created = { id: `list-created-${state.createdLists.length + 1}`, boardId: boardID, boardName: boardID === "board-one" ? "Workspace" : "Other", name: input.name, goal: "", isInbox: false, openCount: 0 };
      state.lists.push(created);
      state.createdLists.push(created);
      return json(response, created, 201);
    }
    if (url.pathname === "/api/v1/lists" && request.method === "GET") {
      if (state.failNextLists) {
        state.failNextLists = false;
        return json(response, { error: "Could not refresh lists" }, 500);
      }
      return json(response, { lists: state.lists });
    }
    if (url.pathname === "/api/v1/agents" && request.method === "GET") return json(response, { agents: state.agents, maxAgents: 5 });
    if (url.pathname === "/api/v1/card-review-kinds" && request.method === "GET") {
      const kinds = Object.fromEntries([...state.tasks, ...state.subtasks]
        .filter(task => task.status === "needs_review")
        .map(task => [task.id, task.reviewReason || "other"]));
      return json(response, { kinds });
    }
    const entryMatch = url.pathname.match(/^\/api\/v1\/cards\/([^/]+)\/entries$/);
    if (entryMatch && request.method === "GET") return json(response, { entries: state.entries[entryMatch[1]] || [] });
    if (entryMatch && request.method === "POST") {
      const input = await requestJSON(request);
      const attemptKey = request.headers["idempotency-key"] || "";
      const task = [...state.tasks, ...state.subtasks].find(item => item.id === entryMatch[1]);
      if (attemptKey && state.entryAttempts[attemptKey]) {
        return json(response, {
          ...state.entryAttempts[attemptKey],
          cardStatus: task.status,
          cardDone: task.done,
          cardReviewReason: task.reviewReason || "",
        }, 201);
      }
      const entry = { id: `entry-${Object.values(state.entries).flat().length + 1}`, cardId: task.id, ...input, authorKind: "human", authorId: "owner", authorName: "Owain", createdAt: new Date().toISOString() };
      state.entries[task.id] = [...(state.entries[task.id] || []), entry];
      if (entry.kind === "output") Object.assign(task, { status: "needs_review", done: false, reviewReason: "output" });
      Object.assign(entry, { cardStatus: task.status, cardDone: task.done, cardReviewReason: task.reviewReason || "" });
      if (attemptKey) state.entryAttempts[attemptKey] = entry;
      if (state.delayNextEntry) {
        state.delayNextEntry = false;
        await new Promise(resolve => { state.releaseEntry = resolve; });
      }
      if (state.failNextEntryResponse) {
        state.failNextEntryResponse = false;
        return json(response, { error: "Response was lost" }, 500);
      }
      return json(response, entry, 201);
    }
    const permanentAgentMatch = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)\/permanent$/);
    if (permanentAgentMatch && request.method === "DELETE") {
      const index = state.agents.findIndex(agent => agent.id === permanentAgentMatch[1]);
      if (index < 0) return json(response, { error: "agent not found" }, 404);
      if (!state.agents[index].archivedAt) return json(response, { code: "agent_not_archived", error: "Archive this agent before permanently deleting it." }, 409);
      state.deletedAgents.push(state.agents[index].id);
      state.agents.splice(index, 1);
      return json(response, { ok: true });
    }
    const agentWorkMatch = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)\/work$/);
    if (agentWorkMatch && request.method === "GET") {
      if (state.delayNextAgentWork) {
        state.delayNextAgentWork = false;
        await new Promise(resolve => { state.releaseAgentWork = resolve; });
        state.agentWorkRefreshCompleted = true;
      }
      if (state.failNextAgentWork) {
        state.failNextAgentWork = false;
        return json(response, { error: "Could not refresh assigned work" }, 500);
      }
      const items = [...state.tasks, ...state.subtasks]
        .filter(item => item.assigneeAgentId === agentWorkMatch[1])
        .map(item => ({ ...item, boardName: "Workspace", bucketName: item.listName, updatedAt: "2026-08-05T12:00:00Z" }));
      const page = Number(url.searchParams.get("page") || 1);
      return json(response, { items, total: items.length, page, pageSize: 50, hasPrevious: page > 1, hasNext: false });
    }
    const agentMatch = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)$/);
    if (agentMatch && request.method === "GET") {
      if (state.failNextAgentDetail) {
        state.failNextAgentDetail = false;
        return json(response, { error: "Could not refresh assigned work" }, 500);
      }
      const agent = state.agents.find(item => item.id === agentMatch[1]);
      if (!agent) return json(response, { error: "agent not found" }, 404);
      const assigned = [...state.tasks, ...state.subtasks]
        .filter(item => item.assigneeAgentId === agent.id)
        .map(item => ({ ...item, boardName: "Workspace", bucketName: item.listName, updatedAt: "2026-08-05T12:00:00Z" }));
      const visibleAssigned = state.hideSubtasksFromAgentOverview ? assigned.filter(item => !item.parentTaskId) : assigned;
      return json(response, { agent, work: {
        ready: visibleAssigned.filter(item => item.status === "queued"),
        working: visibleAssigned.filter(item => item.status === "working"),
        review: visibleAssigned.filter(item => item.status === "needs_review"),
        recentlyCompleted: visibleAssigned.filter(item => item.done || item.status === "done"),
        totals: {
          ready: assigned.filter(item => item.status === "queued").length,
          working: assigned.filter(item => item.status === "working").length,
          review: assigned.filter(item => item.status === "needs_review").length,
          completed: assigned.filter(item => item.done || item.status === "done").length,
        },
      } });
    }
    if (url.pathname === "/api/v1/tasks" && request.method === "GET") {
      state.taskQueries.push(url.search);
      if (url.searchParams.has("parentTaskId")) return json(response, { tasks: state.subtasks.filter(item => item.parentTaskId === url.searchParams.get("parentTaskId")) });
      let tasks = url.searchParams.get("topLevel") === "true" ? [...state.tasks] : [...state.tasks, ...state.subtasks];
      const listID = url.searchParams.get("bucketId");
      const query = url.searchParams.get("q")?.toLowerCase();
      const status = url.searchParams.get("status");
      const plannedFrom = url.searchParams.get("plannedFrom");
      const plannedTo = url.searchParams.get("plannedTo");
      if (listID) tasks = tasks.filter(item => item.bucketId === listID);
      if (url.searchParams.get("inbox") === "true") tasks = tasks.filter(item => state.lists.find(list => list.id === item.bucketId)?.isInbox);
      if (query) tasks = tasks.filter(item => `${item.title} ${item.description}`.toLowerCase().includes(query));
      if (status) tasks = tasks.filter(item => item.status === status);
      if (plannedFrom) tasks = tasks.filter(item => item.scheduledDate >= plannedFrom);
      if (plannedTo) tasks = tasks.filter(item => item.scheduledDate <= plannedTo);
      tasks = tasks.map(item => ({ ...item }));
      if (state.delayNextWorkspaceTasks) {
        state.delayNextWorkspaceTasks = false;
        const failAfterDelay = state.failNextWorkspaceTasks;
        state.failNextWorkspaceTasks = false;
        await new Promise(resolve => { state.releaseWorkspaceTasks = resolve; });
        state.delayedWorkspaceTasksCompleted = true;
        if (failAfterDelay) return json(response, { error: "Could not refresh tasks" }, 500);
      } else if (state.failNextWorkspaceTasks) {
        state.failNextWorkspaceTasks = false;
        return json(response, { error: "Could not refresh tasks" }, 500);
      }
      return json(response, { tasks });
    }
    if (url.pathname === "/api/v1/tasks" && request.method === "POST") {
      const input = await requestJSON(request);
      const created = { id: `task-created-${state.created.length + 1}`, boardId: "board-one", bucketId: "list-inbox", listName: "Inbox", title: input.title, description: input.description || "", scheduledDate: "", kind: "action", done: false, status: "new", priority: "", assigneeAgentId: "" };
      state.tasks.unshift(created);
      state.created.push(created);
      state.lists.find(list => list.id === "list-inbox").openCount += 1;
      return json(response, created, 201);
    }
    const bucketTaskMatch = url.pathname.match(/^\/api\/v1\/buckets\/([^/]+)\/tasks$/);
    if (bucketTaskMatch && request.method === "POST") {
      const input = await requestJSON(request);
      const list = state.lists.find(item => item.id === bucketTaskMatch[1]);
      if (!list) return json(response, { error: "list not found" }, 404);
      const created = { id: `task-created-${state.created.length + 1}`, boardId: list.boardId, bucketId: list.id, listName: list.name, title: input.title, description: input.description || "", scheduledDate: input.scheduledDate || "", kind: "action", done: false, status: "new", priority: "", assigneeAgentId: input.assigneeAgentId || "" };
      state.tasks.unshift(created);
      state.created.push(created);
      list.openCount += 1;
      return json(response, created, 201);
    }
    const bucketMatch = url.pathname.match(/^\/api\/v1\/buckets\/([^/]+)$/);
    if (bucketMatch && request.method === "DELETE") {
      const listID = bucketMatch[1];
      const index = state.lists.findIndex(item => item.id === listID && !item.isInbox);
      if (index < 0) return json(response, { error: "list not found" }, 404);
      state.lists.splice(index, 1);
      state.tasks = state.tasks.filter(item => item.bucketId !== listID);
      state.subtasks = state.subtasks.filter(item => item.bucketId !== listID);
      return json(response, {});
    }
    const subtaskMatch = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/subtasks$/);
    if (subtaskMatch && request.method === "POST") {
      const input = await requestJSON(request);
      const idempotencyKey = request.headers["idempotency-key"] || "";
      state.subtaskRequestKeys.push(idempotencyKey);
      if (state.delayNextSubtask) {
        state.delayNextSubtask = false;
        await new Promise(resolve => { state.releaseSubtask = resolve; });
      }
      if (state.failNextSubtask) {
        state.failNextSubtask = false;
        return json(response, { error: "Could not add subtask" }, 500);
      }
      const existing = idempotencyKey && state.subtaskIdempotency.get(idempotencyKey);
      if (existing) return json(response, existing, 201);
      const parent = state.tasks.find(item => item.id === subtaskMatch[1]);
      const created = { ...parent, id: `task-child-${state.subtasks.length + 1}`, parentTaskId: parent.id, title: input.title, description: "", done: false, status: "new", priority: "", assigneeAgentId: "", assigneeAgentName: "" };
      state.subtasks.push(created);
      if (idempotencyKey) state.subtaskIdempotency.set(idempotencyKey, created);
      state.lists.find(list => list.id === created.bucketId).openCount += 1;
      if (state.commitNextSubtaskThenFail) {
        state.commitNextSubtaskThenFail = false;
        return json(response, { error: "Response lost after commit" }, 500);
      }
      return json(response, created, 201);
    }
    const statusMatch = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/status$/);
    if (statusMatch && request.method === "PATCH") {
      const input = await requestJSON(request);
      if (state.delayNextStatus) {
        state.delayNextStatus = false;
        await new Promise(resolve => { state.releaseStatus = resolve; });
      }
      if (state.failNextStatus) {
        state.failNextStatus = false;
        return json(response, { error: "Could not save task" }, 500);
      }
      const task = [...state.tasks, ...state.subtasks].find(item => item.id === statusMatch[1]);
      const previousBucketID = task.bucketId;
      if (input.status && input.status !== task.status) task.reviewReason = "";
      Object.assign(task, input, { done: input.status === "done" });
      if (!task.parentTaskId && input.bucketId) {
        const list = state.lists.find(item => item.id === input.bucketId);
        if (previousBucketID !== list.id && !task.done) {
          state.lists.find(item => item.id === previousBucketID).openCount -= 1;
          list.openCount += 1;
        }
        Object.assign(task, { boardId: list.boardId, listName: list.name });
        state.subtasks.filter(item => item.parentTaskId === task.id).forEach(item => {
          Object.assign(item, { boardId: list.boardId, bucketId: list.id, listName: list.name });
        });
      }
      state.patches.push({ id: task.id, ...input });
      return json(response, task);
    }
    const taskMatch = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)$/);
    const moveMatch = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/move$/);
    if (moveMatch && request.method === "POST") {
      const input = await requestJSON(request);
      const task = state.tasks.find(item => item.id === moveMatch[1]);
      const list = state.lists.find(item => item.id === input.bucketId);
      if (!task || !list) return json(response, { error: "not found" }, 404);
      Object.assign(task, { boardId: list.boardId, bucketId: list.id, listName: list.name });
      state.subtasks.filter(item => item.parentTaskId === task.id).forEach(item => Object.assign(item, { boardId: list.boardId, bucketId: list.id, listName: list.name }));
      return json(response, task);
    }
    if (taskMatch && request.method === "DELETE") {
      if (state.delayNextDelete) {
        state.delayNextDelete = false;
        await new Promise(resolve => { state.releaseDelete = resolve; });
      }
      if (state.failNextDelete) {
        state.failNextDelete = false;
        return json(response, { error: "Could not delete task" }, 500);
      }
      const index = state.tasks.findIndex(item => item.id === taskMatch[1]);
      if (index >= 0) {
        state.tasks.splice(index, 1);
        state.subtasks = state.subtasks.filter(item => item.parentTaskId !== taskMatch[1]);
      }
      const subtaskIndex = state.subtasks.findIndex(item => item.id === taskMatch[1]);
      if (subtaskIndex >= 0) state.subtasks.splice(subtaskIndex, 1);
      return json(response, {});
    }
    if (taskMatch && request.method === "GET") {
      const task = [...state.tasks, ...state.subtasks].find(item => item.id === taskMatch[1]);
      return task ? json(response, task) : json(response, { error: "not found" }, 404);
    }
    if (taskMatch && request.method === "PATCH") {
      const input = await requestJSON(request);
      if (state.delayNextCompletion) {
        state.delayNextCompletion = false;
        await new Promise(resolve => { state.releaseCompletion = resolve; });
      }
      if (state.failNextCompletion) {
        state.failNextCompletion = false;
        return json(response, { error: "Could not complete task" }, 500);
      }
      const task = [...state.tasks, ...state.subtasks].find(item => item.id === taskMatch[1]);
      if (!task) return json(response, { error: "not found" }, 404);
      const wasDone = task.done;
      Object.assign(task, input);
      if ("done" in input) task.status = input.done ? "done" : "queued";
      if (wasDone !== task.done) state.lists.find(list => list.id === task.bucketId).openCount += task.done ? -1 : 1;
      state.patches.push({ id: task.id, ...input });
      return json(response, task);
    }
    if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
    if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
    if (isAppShell(url.pathname)) return html(response);
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  t.after(async () => {
    server.closeAllConnections?.();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${origin}/app/tasks`);
  await page.getByRole("heading", { name: "All cards", exact: true }).waitFor();
  return { page, state, origin, pageErrors };
}

test("the task workspace supports Board, Flow, Table, lists, and filters", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  for (const label of ["Inbox", "Today", "Week", "Review", "All cards", "YouTube", "All agents"]) {
    assert.equal(await page.getByText(label, { exact: true }).first().isVisible(), true, label);
  }
  assert.ok(parseFloat(await page.locator(".task-nav-pages .nav-link").first().evaluate(element => getComputedStyle(element).fontSize)) >= 13);
  assert.equal(await page.getByRole("tab", { name: "Board", selected: true }).count(), 1);
  for (const list of ["Inbox", "YouTube"]) assert.equal(await page.locator(".workspace-flow-column").getByText(list, { exact: true }).count(), 1);
  assert.equal(await page.locator('[data-open-task="task-parent"]').count(), 1);

  await page.getByRole("tab", { name: "Flow", exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".workspace-flow").count(), 1, `url=${page.url()} errors=${pageErrors.join(" | ")} queries=${state.taskQueries.join(" | ")}`);
  assert.match(page.url(), /view=flow/);
  for (const status of ["New", "Ready", "In Progress", "Review", "Done"]) assert.equal(await page.locator(".workspace-flow-column").getByText(status, { exact: true }).count(), 1);

  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.getByRole("tab", { name: "Table", selected: true }).waitFor();
  for (const column of ["Card", "List", "Status", "Priority", "Owner", "Planned"]) {
    assert.equal(await page.locator(".workspace-table-head").getByText(column, { exact: true }).isVisible(), true, column);
  }
  assert.ok(parseFloat(await page.locator(".workspace-table-head").evaluate(element => getComputedStyle(element).fontSize)) >= 11);
  assert.ok(parseFloat(await page.locator(".workspace-table-row strong").first().evaluate(element => getComputedStyle(element).fontSize)) >= 14);

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
  await page.getByRole("heading", { name: "YouTube", level: 1, exact: true }).waitFor();
  assert.equal(await page.locator('[data-open-task="task-parent"]').count(), 1);
  assert.equal(await page.locator('[data-open-task="task-inbox"]').count(), 0);
});

test("Board changes list membership and Flow changes status", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  const inbox = page.locator('[data-kanban-list="list-inbox"]');
  const youtube = page.locator('[data-kanban-list="list-youtube"]');
  await inbox.getByRole("heading", { name: "Inbox", exact: true }).waitFor();
  await youtube.getByRole("heading", { name: "YouTube", exact: true }).waitFor();

  await youtube.locator('[data-task="task-parent"]').dragTo(inbox);
  await inbox.locator('[data-task="task-parent"]').waitFor();
  assert.equal(state.tasks.find(task => task.id === "task-parent").bucketId, "list-inbox");
  assert.ok(state.requests.includes("POST /api/v1/tasks/task-parent/move"));

  await page.getByRole("tab", { name: "Flow", exact: true }).click();
  await page.locator('[data-task="task-child"]').dragTo(page.locator('[data-flow-status="working"]'));
  await page.locator('[data-flow-status="working"] [data-task="task-child"]').waitFor();
  assert.equal(state.subtasks.find(task => task.id === "task-child").status, "working");
  assert.deepEqual(pageErrors, []);
});

test("legacy list-grouped Kanban links map to Board and can switch to Flow", async t => {
  const { page, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/tasks?view=flow&group=list`);
  await page.getByRole("tab", { name: "Board", selected: true }).waitFor();
  await page.getByRole("tab", { name: "Flow", exact: true }).click();
  await page.getByRole("tab", { name: "Flow", selected: true }).waitFor();

  const current = new URL(page.url());
  assert.equal(current.searchParams.get("view"), "flow");
  assert.equal(current.searchParams.has("group"), false);
  assert.equal(await page.locator('[data-flow-status="new"]').count(), 1);
  assert.deepEqual(pageErrors, []);
});

test("lists use designed create and delete dialogs", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.getByRole("button", { name: "New list", exact: true }).click();
  const createDialog = page.getByRole("dialog", { name: "New list", exact: true });
  assert.equal(await createDialog.getByLabel("Name", { exact: true }).getAttribute("maxlength"), "100");
  await createDialog.getByLabel("Name", { exact: true }).fill("Planning");
  assert.equal(await createDialog.getByLabel("Board", { exact: true }).count(), 0);
  state.failNextListCreate = true;
  await createDialog.getByRole("button", { name: "Create list", exact: true }).click();
  await createDialog.getByRole("alert").filter({ hasText: "Could not create list" }).waitFor();
  assert.equal(await createDialog.getByLabel("Name", { exact: true }).inputValue(), "Planning");
  assert.equal(await createDialog.getByLabel("Name", { exact: true }).evaluate(element => element === document.activeElement), true);
  await createDialog.getByRole("button", { name: "Create list", exact: true }).click();
  await page.getByRole("heading", { name: "Planning", level: 1, exact: true }).waitFor();
  assert.equal(state.createdLists.length, 1);

  await page.getByRole("button", { name: "Delete list", exact: true }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete Planning?", exact: true });
  assert.equal(await deleteDialog.getByText("Cards in this list will also be permanently deleted. This cannot be undone.", { exact: true }).isVisible(), true);
  await deleteDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.getByRole("heading", { name: "Planning", level: 1, exact: true }).isVisible(), true);

  await page.getByRole("button", { name: "Delete list", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete Planning?", exact: true }).getByRole("button", { name: "Delete list", exact: true }).click();
  await page.getByRole("heading", { name: "All cards", exact: true }).waitFor();
  assert.equal(state.lists.some(list => list.name === "Planning"), false);
  assert.equal(await page.getByRole("link", { name: /Planning/ }).count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("a delayed list creation cannot repaint while a newer history route loads", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  state.delayNextList = true;
  await page.getByRole("button", { name: "New list", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New list", exact: true });
  await dialog.getByLabel("Name", { exact: true }).fill("Later list");
  await dialog.getByRole("button", { name: "Create list", exact: true }).click();
  await waitFor(() => typeof state.releaseList === "function");
  assert.equal(await dialog.evaluate(element => element === document.activeElement), true);
  await page.keyboard.press("Tab");
  assert.equal(await dialog.evaluate(element => element === document.activeElement), true);

  state.delayNextBoards = true;
  await page.evaluate(() => {
    history.pushState({}, "", "/app/settings/profile");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await waitFor(() => typeof state.releaseBoards === "function");
  const listResponse = page.waitForResponse(response => response.request().method() === "POST" && response.url().includes("/buckets"));
  state.releaseList();
  await listResponse;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(new URL(page.url()).pathname, "/app/settings/profile");
  state.releaseBoards();
  await page.getByRole("heading", { name: "Profile", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/app/settings/profile");
  assert.equal(await page.getByRole("link", { name: /Later list/ }).count(), 1);
  assert.deepEqual(pageErrors, []);
});

test("generic cards open from the table without a task completion control", async t => {
  const { page, pageErrors } = await startWorkspace(t);

  assert.equal(await page.locator(".workspace-completion-toggle").count(), 0);
  await page.getByRole("button", { name: "Open card: Publish task-first agents video", exact: true }).click();
  await page.getByRole("region", { name: "Card detail" }).waitFor();
  assert.equal(await page.getByLabel("Prompt and context", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("Act with an agent", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Assigned to Research agent", { exact: true }).isVisible(), true);
  await page.getByRole("button", { name: "Close card", exact: true }).click();
  const opener = page.getByRole("button", { name: "Open card: Publish task-first agents video", exact: true });
  assert.equal(await opener.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("Review separates agent outputs from cards manually placed in review", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);
  const [assigned, unassigned] = state.tasks;
  assigned.status = "needs_review";
  assigned.reviewReason = "output";
  unassigned.status = "needs_review";
  state.entries[assigned.id] = [{ id: "output-1", cardId: assigned.id, kind: "output", body: "Draft ready", authorKind: "agent", authorId: "agent-research", authorName: "Research agent", createdAt: "2026-08-10T12:00:00Z" }];
  state.entries[unassigned.id] = [{ id: "comment-1", cardId: unassigned.id, kind: "comment", body: "Which audience?", authorKind: "human", authorId: "owner", authorName: "Owain", createdAt: "2026-08-10T12:01:00Z" }];

  await page.getByRole("link", { name: "Review", exact: true }).click();
  const responseGroup = page.locator(".workspace-review-group").filter({ has: page.getByRole("heading", { name: "Other review", exact: true }) });
  const outputGroup = page.locator(".workspace-review-group").filter({ has: page.getByRole("heading", { name: "Outputs", exact: true }) });
  await responseGroup.getByText(unassigned.title, { exact: true }).waitFor();
  await outputGroup.getByText(assigned.title, { exact: true }).waitFor();
  assert.equal(await responseGroup.getByText(assigned.title, { exact: true }).count(), 0);
  assert.equal(await outputGroup.getByText(unassigned.title, { exact: true }).count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("a lost conversation response retries without duplicating the entry", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);
  await page.getByRole("button", { name: "Open card: Publish task-first agents video", exact: true }).click();
  await page.locator("#card-entry-body").fill("One durable comment");
  state.failNextEntryResponse = true;
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await page.locator(".card-entry-error").filter({ hasText: "Response was lost" }).waitFor();
  assert.equal(state.entries["task-parent"].length, 1);

  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await page.locator(".card-entry").filter({ hasText: "One durable comment" }).waitFor();
  assert.equal(state.entries["task-parent"].length, 1);
  assert.equal(Object.keys(state.entryAttempts).length, 1);
  assert.deepEqual(pageErrors, []);
});

test("an output replay keeps a newer card status", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);
  const task = state.tasks.find(item => item.id === "task-parent");
  await page.getByRole("button", { name: "Open card: Publish task-first agents video", exact: true }).click();
  await page.getByRole("button", { name: "Output", exact: true }).click();
  await page.locator("#card-entry-body").fill("One durable output");
  state.failNextEntryResponse = true;
  await page.getByRole("button", { name: "Add output", exact: true }).click();
  await page.locator(".card-entry-error").filter({ hasText: "Response was lost" }).waitFor();
  Object.assign(task, { status: "done", done: true, reviewReason: "" });

  await page.getByRole("button", { name: "Add output", exact: true }).click();
  await page.locator(".card-entry").filter({ hasText: "One durable output" }).waitFor();

  assert.equal(await page.locator("#workspace-detail-status").inputValue(), "done");
  assert.equal(state.entries[task.id].length, 1);
  assert.deepEqual(pageErrors, []);
});

test("an output committed while Agent Work detail closes still refreshes the card into Review", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByRole("button", { name: "Output", exact: true }).click();
  await page.locator("#card-entry-body").fill("Draft ready for review");
  state.delayNextEntry = true;
  await page.getByRole("button", { name: "Add output", exact: true }).click();
  await waitFor(() => typeof state.releaseEntry === "function");

  const workRequestsBeforeClose = state.requests.filter(request => request === "GET /api/v1/agents/agent-research/work?page=2&pageSize=50").length;
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  state.releaseEntry();
  await waitFor(() => state.requests.filter(request => request === "GET /api/v1/agents/agent-research/work?page=2&pageSize=50").length > workRequestsBeforeClose);
  await page.getByRole("button", { name: /Publish task-first agents video.*Review/ }).waitFor();

  assert.equal(state.tasks.find(task => task.id === "task-parent").reviewReason, "output");
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, "/app/agents/agent-research/work?page=2");
  assert.deepEqual(pageErrors, []);
});

test.skip("legacy table completion preserves a reopened task draft and next-save baseline", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  state.delayNextCompletion = true;
  await page.getByRole("button", { name: "Mark Publish task-first agents video complete", exact: true }).click();
  await waitFor(() => typeof state.releaseCompletion === "function");
  await page.getByRole("button", { name: "Open card: Publish task-first agents video", exact: true }).click();

  const title = page.getByLabel("Title", { exact: true });
  const brief = page.getByLabel("Prompt and context", { exact: true });
  await title.fill("Live title during completion");
  await brief.fill("Live brief during completion");
  await page.getByLabel("List", { exact: true }).selectOption("list-inbox");
  await page.getByLabel("Priority", { exact: true }).selectOption("p2");
  await page.getByLabel("Owner", { exact: true }).selectOption("");
  await page.getByLabel("Planned", { exact: true }).fill("2026-08-20");
  await brief.focus();

  state.releaseCompletion();
  await page.waitForFunction(() => document.querySelector('#workspace-detail-form [name="status"]')?.value === "done");

  assert.equal(await title.inputValue(), "Live title during completion");
  assert.equal(await brief.inputValue(), "Live brief during completion");
  assert.equal(await page.getByLabel("List", { exact: true }).inputValue(), "list-inbox");
  assert.equal(await page.getByLabel("Priority", { exact: true }).inputValue(), "p2");
  assert.equal(await page.getByLabel("Owner", { exact: true }).inputValue(), "");
  assert.equal(await page.getByLabel("Planned", { exact: true }).inputValue(), "2026-08-20");
  assert.equal(await brief.evaluate(element => element === document.activeElement), true);
  assert.equal(state.tasks.find(task => task.id === "task-parent").done, true);

  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => state.patches.length === 2);
  assert.deepEqual(state.patches[1], {
    id: "task-parent",
    title: "Live title during completion",
    description: "Live brief during completion",
    status: "done",
    priority: "p2",
    assigneeAgentId: "",
    scheduledDate: "2026-08-20",
    bucketId: "list-inbox",
  });
  assert.deepEqual(pageErrors, []);
});

test.skip("legacy failed table completion preserves a reopened task draft and focus", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  state.delayNextCompletion = true;
  state.failNextCompletion = true;
  await page.getByRole("button", { name: "Mark Publish task-first agents video complete", exact: true }).click();
  await waitFor(() => typeof state.releaseCompletion === "function");
  await page.getByRole("button", { name: "Open card: Publish task-first agents video", exact: true }).click();

  const title = page.getByLabel("Title", { exact: true });
  const brief = page.getByLabel("Prompt and context", { exact: true });
  await title.fill("Live title during failed completion");
  await brief.fill("Live brief during failed completion");
  await page.getByLabel("List", { exact: true }).selectOption("list-inbox");
  await page.getByLabel("Priority", { exact: true }).selectOption("p2");
  await page.getByLabel("Owner", { exact: true }).selectOption("");
  await page.getByLabel("Planned", { exact: true }).fill("2026-08-21");
  await brief.focus();

  state.releaseCompletion();
  await page.locator(".detail-error").filter({ hasText: "Could not complete task" }).waitFor();

  assert.equal(await title.inputValue(), "Live title during failed completion");
  assert.equal(await brief.inputValue(), "Live brief during failed completion");
  assert.equal(await page.getByLabel("Status", { exact: true }).inputValue(), "working");
  assert.equal(await page.getByLabel("List", { exact: true }).inputValue(), "list-inbox");
  assert.equal(await page.getByLabel("Priority", { exact: true }).inputValue(), "p2");
  assert.equal(await page.getByLabel("Owner", { exact: true }).inputValue(), "");
  assert.equal(await page.getByLabel("Planned", { exact: true }).inputValue(), "2026-08-21");
  assert.equal(await brief.evaluate(element => element === document.activeElement), true);
  assert.equal(state.tasks.find(task => task.id === "task-parent").done, false);
  assert.deepEqual(pageErrors, []);
});

test.skip("legacy failed completion stays out of an unrelated open card detail", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  state.delayNextCompletion = true;
  state.failNextCompletion = true;
  await page.getByRole("button", { name: "Mark Publish task-first agents video complete", exact: true }).click();
  await waitFor(() => typeof state.releaseCompletion === "function");
  await page.getByRole("button", { name: "Open card: Write the doc my boss asked for", exact: true }).click();
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Unrelated live task draft");

  const failedResponse = page.waitForResponse(response => response.url().endsWith("/api/v1/tasks/task-parent")
    && response.request().method() === "PATCH" && response.status() === 500);
  state.releaseCompletion();
  await failedResponse;
  await page.waitForTimeout(50);

  assert.equal(await page.locator(".detail-error").textContent(), "");
  assert.equal(await title.inputValue(), "Unrelated live task draft");
  assert.equal(await title.evaluate(element => element === document.activeElement), true);
  await page.getByRole("button", { name: "Close card", exact: true }).click();
  assert.equal(await page.getByRole("alert").filter({ hasText: "Could not complete task" }).isVisible(), true);
  assert.deepEqual(pageErrors, []);
});

test.skip("legacy pending completion updates account settings counts without resetting its draft", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  state.delayNextCompletion = true;
  await page.getByRole("button", { name: "Mark Publish task-first agents video complete", exact: true }).click();
  await waitFor(() => typeof state.releaseCompletion === "function");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("heading", { name: "Profile", exact: true }).waitFor();
  const youtubeCount = page.locator('[data-workspace-count="list-youtube"]');
  const displayName = page.locator("#profile-display-name");
  assert.equal(await youtubeCount.textContent(), "2");
  await displayName.fill("Unsaved settings draft during completion");

  state.releaseCompletion();
  await page.waitForFunction(() => document.querySelector('[data-workspace-count="list-youtube"]')?.textContent === "1");

  assert.equal(await displayName.inputValue(), "Unsaved settings draft during completion");
  assert.equal(await displayName.evaluate(element => element === document.activeElement), true);
  assert.equal(state.tasks.find(task => task.id === "task-parent").done, true);
  assert.deepEqual(pageErrors, []);
});

test("a pending list move updates account settings counts without resetting its draft", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.getByRole("button", { name: "Open card: Publish task-first agents video", exact: true }).click();
  await page.getByLabel("List", { exact: true }).selectOption("list-inbox");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("heading", { name: "Profile", exact: true }).waitFor();

  const youtubeCount = page.locator('[data-workspace-count="list-youtube"]');
  const inboxCount = page.locator('[data-workspace-count="inbox"]');
  const displayName = page.locator("#profile-display-name");
  assert.equal(await youtubeCount.textContent(), "2");
  assert.equal(await inboxCount.textContent(), "1");
  await displayName.fill("Unsaved settings draft during list move");

  state.releaseStatus();
  await page.waitForFunction(() => document.querySelector('[data-workspace-count="list-youtube"]')?.textContent === "1"
    && document.querySelector('[data-workspace-count="inbox"]')?.textContent === "2");

  assert.equal(await displayName.inputValue(), "Unsaved settings draft during list move");
  assert.equal(await displayName.evaluate(element => element === document.activeElement), true);
  assert.equal(state.tasks.find(task => task.id === "task-parent").bucketId, "list-inbox");
  assert.deepEqual(pageErrors, []);
});

test("a pending list move completes account settings while its first list load is delayed", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.getByRole("button", { name: "Open card: Publish task-first agents video", exact: true }).click();
  await page.getByLabel("List", { exact: true }).selectOption("list-inbox");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");

  let releaseLists;
  let listRequests = 0;
  await page.route("**/api/v1/lists", async route => {
    listRequests += 1;
    if (listRequests === 1) await new Promise(resolve => { releaseLists = resolve; });
    await route.continue();
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await waitFor(() => typeof releaseLists === "function");
  state.releaseStatus();

  await waitFor(() => listRequests >= 2);
  await page.getByRole("heading", { name: "Profile", exact: true }).waitFor();
  const displayName = page.locator("#profile-display-name");
  await displayName.fill("Draft after Settings route recovery");
  releaseLists();
  await page.waitForTimeout(50);

  assert.equal(new URL(page.url()).pathname, "/app/settings/profile");
  assert.equal(await page.locator('[data-workspace-count="list-youtube"]').textContent(), "1");
  assert.equal(await page.locator('[data-workspace-count="inbox"]').textContent(), "2");
  assert.equal(await displayName.inputValue(), "Draft after Settings route recovery");
  assert.equal(await displayName.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test.skip("legacy completion refreshes Review membership", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  state.tasks.forEach(task => Object.assign(task, { status: "needs_review", done: false }));
  await page.getByRole("link", { name: "Review", exact: true }).click();
  await page.getByRole("heading", { name: "Review", exact: true, level: 1 }).waitFor();
  state.delayNextCompletion = true;
  await page.getByRole("button", { name: "Mark Publish task-first agents video complete", exact: true }).click();
  await waitFor(() => typeof state.releaseCompletion === "function");
  await page.getByRole("button", { name: "Open card: Write the doc my boss asked for", exact: true }).click();

  state.releaseCompletion();
  await waitFor(() => state.tasks.find(task => task.id === "task-parent").done);
  await page.getByRole("button", { name: "Close card", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-open-task="task-parent"]'));

  assert.equal(await page.getByRole("button", { name: "Open card: Publish task-first agents video", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Open card: Write the doc my boss asked for", exact: true }).count(), 1);
  assert.deepEqual(pageErrors, []);
});

test.skip("legacy completion ordering preserves a newer failure from another card", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);
  let releaseCompletion;
  await page.route("**/api/v1/tasks/task-parent", async route => {
    if (route.request().method() === "PATCH") await new Promise(resolve => { releaseCompletion = resolve; });
    await route.continue();
  });

  await page.getByRole("button", { name: "Mark Publish task-first agents video complete", exact: true }).click();
  await waitFor(() => typeof releaseCompletion === "function");
  await page.getByRole("button", { name: "Open card: Write the doc my boss asked for", exact: true }).click();
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Newer task failure remains owned");
  state.failNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const failure = page.locator(".detail-error").filter({ hasText: "Could not save task" });
  await failure.waitFor();

  releaseCompletion();
  await waitFor(() => state.tasks.find(task => task.id === "task-parent").done);
  assert.equal(await failure.isVisible(), true);
  assert.equal(await title.inputValue(), "Newer task failure remains owned");
  await page.getByRole("button", { name: "Close card", exact: true }).click();
  assert.equal(await page.getByRole("alert").filter({ hasText: "Could not save task" }).isVisible(), true);
  assert.deepEqual(pageErrors, []);
});

test("global scopes surface matching subtasks with parent context", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  assert.equal(await page.getByRole("button", { name: "Open card: Research examples", exact: true }).count(), 1);
  assert.equal(await page.getByText(/Child of Publish task-first agents video/).count(), 1);
  await page.getByRole("button", { name: "Open card: Research examples", exact: true }).click();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Research examples");
  await page.getByRole("button", { name: "Back to parent card", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#workspace-detail-title")?.value === "Publish task-first agents video");
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Publish task-first agents video");

  const now = new Date();
  const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  Object.assign(state.subtasks[0], { scheduledDate: today, status: "needs_review", done: false });

  await page.goto(`${origin}/app/review`);
  await page.getByRole("heading", { name: "Review", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Open card: Research examples", exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Open card: Publish task-first agents video", exact: true }).count(), 0);

  await page.goto(`${origin}/app/today`);
  await page.getByRole("heading", { name: "Today", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Open card: Research examples", exact: true }).count(), 1);

  await page.goto(`${origin}/app/week`);
  await page.getByRole("heading", { name: "Week", exact: true }).waitFor();
  assert.equal(await page.getByText("Research examples", { exact: true }).count(), 1);
  assert.equal(await page.getByText("Child of Publish task-first agents video · YouTube", { exact: true }).count(), 1);

  await page.goto(`${origin}/app/lists/list-youtube`);
  await page.getByRole("heading", { name: "YouTube", level: 1, exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Open card: Research examples", exact: true }).count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("task view tabs and table rows work from the keyboard and accessibility tree", async t => {
  const { page, pageErrors } = await startWorkspace(t);

  const boardTab = page.getByRole("tab", { name: "Board", exact: true });
  const tableTab = page.getByRole("tab", { name: "Table", exact: true });
  assert.equal(await boardTab.getAttribute("aria-selected"), "true");
  assert.equal(await boardTab.getAttribute("tabindex"), "0");
  await boardTab.focus();
  await page.keyboard.press("ArrowRight");
  const flowTab = page.getByRole("tab", { name: "Flow", exact: true });
  await page.getByRole("tab", { name: "Flow", selected: true }).waitFor();
  assert.equal(await flowTab.getAttribute("aria-selected"), "true");
  assert.equal(await flowTab.evaluate(element => element === document.activeElement), true);

  await page.keyboard.press("End");
  const table = page.getByRole("table", { name: "Cards", exact: true });
  await table.waitFor();
  assert.equal(await tableTab.getAttribute("aria-selected"), "true");
  const accessibility = await table.ariaSnapshot();
  assert.match(accessibility, /table "Cards"/);
  for (const heading of ["Card", "List", "Status", "Priority", "Owner", "Planned"]) {
    assert.match(accessibility, new RegExp(`columnheader "${heading}"`));
  }
  const scan = await new AxeBuilder({ page }).include(".workspace-main").analyze();
  assert.deepEqual(scan.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.target) })), []);

  const row = page.getByRole("button", { name: "Open card: Publish task-first agents video", exact: true });
  await row.focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Publish task-first agents video");
  await page.getByRole("button", { name: "Close card", exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.getByRole("table", { name: "Cards", exact: true }).isVisible(), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  assert.deepEqual(pageErrors, []);
});

test("Week shows only calendar controls while filters and task opening keep working", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);
  const now = new Date();
  const offset = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
  state.tasks[0].scheduledDate = [monday.getFullYear(), String(monday.getMonth() + 1).padStart(2, "0"), String(monday.getDate()).padStart(2, "0")].join("-");

  await page.goto(`${origin}/app/week?view=flow`);
  await page.getByRole("heading", { name: "Week", exact: true }).waitFor();
  assert.equal(await page.locator('[data-workspace-view]').count(), 0);
  assert.equal(await page.getByRole("button", { name: "Filter", exact: true }).isVisible(), true);
  assert.equal(await page.getByLabel("Week calendar", { exact: true }).isVisible(), true);

  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByLabel("Search", { exact: true }).fill("Publish");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await waitFor(() => state.taskQueries.some(query => query.includes("q=Publish")));
  assert.match(page.url(), /\/app\/week\?q=Publish$/);
  await page.getByText("Publish task-first agents video", { exact: true }).click();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Publish task-first agents video");
  await page.getByRole("button", { name: "Close card", exact: true }).click();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  assert.match(page.url(), /\/app\/week$/);

  await page.getByRole("link", { name: "All cards", exact: true }).click();
  await page.getByRole("heading", { name: "All cards", exact: true }).waitFor();
  assert.equal(await page.locator(".workspace-flow.grouped-by-list").count(), 1);
  await page.getByRole("link", { name: "Week", exact: true }).click();
  await page.getByRole("heading", { name: "Week", exact: true }).waitFor();

  for (const viewport of [{ width: 1440, height: 960 }, { width: 820, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.locator("#workspace-filter-toggle").isVisible(), true, `${viewport.width}px filter`);
    assert.equal(await page.getByLabel("Week calendar", { exact: true }).isVisible(), true, `${viewport.width}px calendar`);
    assert.equal(await page.locator('[data-workspace-view]').count(), 0, `${viewport.width}px tabs`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${viewport.width}px page overflow`);
  }
  assert.deepEqual(pageErrors, []);
});

test("a delayed Week move reconciles an open agent task before its next save", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);
  const now = new Date();
  const offset = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
  const tuesday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 1);
  const formatDate = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  const mondayDate = formatDate(monday);
  const tuesdayDate = formatDate(tuesday);
  state.tasks[0].scheduledDate = mondayDate;

  await page.goto(`${origin}/app/week`);
  await page.getByRole("heading", { name: "Week", exact: true }).waitFor();
  const weekTask = page.locator('.workspace-week [data-task="task-parent"]');
  assert.equal(await weekTask.count(), 1,
    `date=${mondayDate} queries=${state.taskQueries.join(" | ")} body=${await page.locator(".workspace-week").innerText()}`);
  state.delayNextCompletion = true;
  await weekTask.dragTo(page.locator(`.workspace-week [data-calendar-date="${tuesdayDate}"]`));
  await waitFor(() => typeof state.releaseCompletion === "function");

  await page.getByRole("link", { name: "All agents", exact: true }).click();
  await page.getByRole("link", { name: "Research agent", exact: true }).click();
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  const planned = page.getByLabel("Planned", { exact: true });
  const brief = page.getByLabel("Prompt and context", { exact: true });
  assert.equal(await planned.inputValue(), mondayDate);
  await brief.fill("Live brief while the Week move commits");

  state.releaseCompletion();
  await page.waitForFunction(expected => document.querySelector('#workspace-detail-form [name="scheduledDate"]')?.value === expected, tuesdayDate);

  assert.equal(await brief.inputValue(), "Live brief while the Week move commits");
  assert.equal(await brief.evaluate(element => element === document.activeElement), true);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => state.patches.length === 2);

  assert.equal(state.patches[0].scheduledDate, tuesdayDate);
  assert.equal(state.patches[1].scheduledDate, tuesdayDate);
  assert.equal(state.tasks.find(task => task.id === "task-parent").scheduledDate, tuesdayDate);
  assert.deepEqual(pageErrors, []);
});

test("a failed delayed Week move stays out of an unrelated task detail", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);
  const now = new Date();
  const offset = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
  const formatDate = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  const mondayDate = formatDate(monday);
  const tuesdayDate = formatDate(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 1));
  const wednesdayDate = formatDate(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 2));
  state.tasks[0].scheduledDate = mondayDate;
  state.tasks[1].scheduledDate = tuesdayDate;

  await page.goto(`${origin}/app/week`);
  await page.getByRole("heading", { name: "Week", exact: true }).waitFor();
  state.delayNextCompletion = true;
  state.failNextCompletion = true;
  await page.locator('.workspace-week [data-task="task-parent"]').dragTo(page.locator(`.workspace-week [data-calendar-date="${wednesdayDate}"]`));
  await waitFor(() => typeof state.releaseCompletion === "function");
  await page.locator('[data-open-task="task-inbox"]').click();
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Unrelated live Week draft");

  const failedResponse = page.waitForResponse(response => response.url().endsWith("/api/v1/tasks/task-parent")
    && response.request().method() === "PATCH" && response.status() === 500);
  state.releaseCompletion();
  await failedResponse;
  await page.waitForTimeout(50);

  assert.equal(await page.locator(".detail-error").textContent(), "");
  assert.equal(await title.inputValue(), "Unrelated live Week draft");
  assert.equal(await title.evaluate(element => element === document.activeElement), true);
  await page.getByRole("button", { name: "Close card", exact: true }).click();
  assert.equal(await page.getByRole("alert").filter({ hasText: "Could not complete task" }).isVisible(), true);
  assert.deepEqual(pageErrors, []);
});

test("an older workspace response cannot replace the latest route", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  state.delayNextWorkspaceTasks = true;
  await page.getByRole("tab", { name: "Flow", exact: true }).click();
  await waitFor(() => typeof state.releaseWorkspaceTasks === "function");
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.getByRole("heading", { name: "All cards", exact: true }).waitFor();
  state.releaseWorkspaceTasks();
  await page.waitForTimeout(100);

  assert.match(page.url(), /\/app\/tasks\?view=table$/);
  assert.equal(await page.getByRole("heading", { name: "All cards", exact: true }).isVisible(), true);
  assert.equal(await page.getByRole("heading", { name: "Not found.", exact: true }).count(), 0);
  const selectedTab = page.getByRole("tab", { selected: true });
  assert.equal(await selectedTab.getAttribute("data-workspace-view"), "table");
  assert.equal(await selectedTab.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("an older same-view response cannot steal focus from the latest panel", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.evaluate(() => history.replaceState({}, "", "/app/tasks?priority=p0"));
  state.delayNextWorkspaceTasks = true;
  await page.getByRole("tab", { name: "Flow", exact: true }).click();
  await waitFor(() => typeof state.releaseWorkspaceTasks === "function");
  await page.evaluate(() => history.replaceState({}, "", "/app/tasks?priority=p1"));
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.locator(".workspace-table").waitFor();
  await page.evaluate(() => history.replaceState({}, "", "/app/tasks?priority=p2"));
  await page.getByRole("tab", { name: "Flow", exact: true }).click();
  await page.locator(".workspace-flow").waitFor();

  const panel = page.getByRole("tabpanel");
  await panel.focus();
  state.releaseWorkspaceTasks();
  await waitFor(() => state.delayedWorkspaceTasksCompleted);
  await page.waitForTimeout(100);

  const current = new URL(page.url());
  assert.equal(current.searchParams.get("view"), "flow");
  assert.equal(current.searchParams.get("priority"), "p2");
  assert.equal(await page.getByRole("tab", { name: "Flow", selected: true }).count(), 1);
  assert.equal(await panel.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("a direct agent route can create a list on a board with capacity and assign it without refreshing", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research`);
  await page.getByRole("heading", { name: "Research agent", exact: true }).waitFor();
  await page.getByRole("link", { name: /YouTube/ }).waitFor();

  await page.getByRole("button", { name: "New list", exact: true }).click();
  const newListDialog = page.getByRole("dialog", { name: "New list", exact: true });
  await newListDialog.getByLabel("Name", { exact: true }).fill("Launch plan");
  assert.equal(await newListDialog.getByLabel("Board", { exact: true }).count(), 0);
  await newListDialog.getByRole("button", { name: "Create list", exact: true }).click();
  await waitFor(() => state.createdLists.length === 1);
  assert.equal(state.createdLists[0].boardId, "board-two");
  assert.ok(state.requests.includes("POST /api/v1/boards/board-two/buckets"));
  await page.getByText("Launch plan", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Assign work", exact: true }).click();

  await page.getByLabel("Board", { exact: true }).selectOption("board-two");
  const list = page.getByLabel("List", { exact: true });
  await list.selectOption(state.createdLists[0].id);
  assert.equal(await list.inputValue(), state.createdLists[0].id);
  assert.equal(await list.locator("option", { hasText: "Launch plan" }).count(), 1);
  await page.getByLabel("Title", { exact: true }).fill("Research launch examples");
  await page.getByRole("button", { name: "Create item", exact: true }).click();
  await page.getByText('"Research launch examples" was assigned to Research agent.', { exact: true }).waitFor();
  assert.equal(await page.locator('a[href="/app/lists/list-created-1"] b').textContent(), "1");
  assert.deepEqual(pageErrors, []);
});

test("agent work uses the shared inline task detail and returns to the exact work page", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t, { width: 720, height: 900 });

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("heading", { name: "All work", exact: true }).waitFor();
  const parent = page.getByRole("button", { name: /Publish task-first agents video/ });
  await parent.click();

  const detail = page.getByRole("region", { name: "Card detail" });
  await detail.waitFor();
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, "/app/agents/agent-research/work?page=2");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.locator(".detail-overlay").count(), 0);
  assert.equal(await page.getByText("1 of 1 done", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("Research examples", { exact: true }).isVisible(), true);
  assert.ok((await page.locator(".workspace-detail-main").boundingBox()).width >= 300);

  await page.getByText("Research examples", { exact: true }).click();
  await page.getByRole("button", { name: "Back to parent card", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Research examples");
  assert.equal(await page.getByLabel("List", { exact: true }).isDisabled(), true);
  await page.getByLabel("Title", { exact: true }).fill("Updated research examples");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("1 of 1 done", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("heading", { name: "All work", exact: true }).waitFor();
  assert.equal(await page.getByText("Updated research examples", { exact: true }).isVisible(), true);
  assert.equal(state.patches.at(-1).id, "task-child");
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, "/app/agents/agent-research/work?page=2");

  await parent.click();
  await page.getByLabel("Priority", { exact: true }).selectOption("p2");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("heading", { name: "All work", exact: true }).waitFor();
  assert.equal(state.patches.at(-1).id, "task-parent");
  assert.equal(state.patches.at(-1).priority, "p2");
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, "/app/agents/agent-research/work?page=2");
  assert.equal(await parent.evaluate(element => element === document.activeElement), true);

  await parent.click();
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("heading", { name: "All work", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, "/app/agents/agent-research/work?page=2");
  assert.equal(await parent.evaluate(element => element === document.activeElement), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(pageErrors, []);
});

test("a delayed agent task save refreshes the work page without reopening detail", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  const parent = page.getByRole("button", { name: /Publish task-first agents video/ });
  await parent.click();
  await page.getByLabel("Title", { exact: true }).fill("Delayed agent task title");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");

  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("heading", { name: "All work", exact: true }).waitFor();
  assert.equal(await page.getByRole("region", { name: "Card detail" }).count(), 0);
  state.releaseStatus();
  await page.getByText("Delayed agent task title", { exact: true }).waitFor();
  await waitFor(() => state.requests.filter(request => request === "GET /api/v1/agents/agent-research/work?page=2&pageSize=50").length >= 2);

  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, "/app/agents/agent-research/work?page=2");
  assert.equal(await page.getByRole("region", { name: "Card detail" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: /Delayed agent task title/ }).evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("agent task properties stay locked while a save is pending", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Locked while saving");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");

  for (const label of ["Title", "Prompt and context", "Status", "List", "Priority", "Owner", "Planned"]) {
    assert.equal(await page.getByLabel(label, { exact: true }).isDisabled(), true, `${label} should be disabled`);
  }
  for (const name of ["Delete card", "Saving…"]) {
    assert.equal(await page.getByRole("button", { name, exact: true }).isDisabled(), true, `${name} should be disabled`);
  }

  state.releaseStatus();
  await page.getByRole("heading", { name: "All work", exact: true }).waitFor();
  assert.equal(state.tasks.find(task => task.id === "task-parent").title, "Locked while saving");
  assert.deepEqual(pageErrors, []);
});

test("a delayed reassignment refreshes the newly assigned agent work page", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);
  state.agents.push({ id: "agent-writing", displayName: "Writing agent", purpose: "Write assigned work", credential: {}, workCounts: {} });

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Owner", { exact: true }).selectOption("agent-writing");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");

  await page.getByRole("link", { name: "All agents", exact: true }).click();
  await page.getByRole("link", { name: "Writing agent", exact: true }).click();
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await page.getByRole("heading", { name: "All work", exact: true }).waitFor();
  assert.equal(await page.getByText("Publish task-first agents video", { exact: true }).count(), 0);

  state.releaseStatus();
  await page.getByText("Publish task-first agents video", { exact: true }).waitFor();

  assert.equal(state.tasks.find(task => task.id === "task-parent").assigneeAgentId, "agent-writing");
  assert.deepEqual(pageErrors, []);
});

test("concurrent saves of the same agent task commit in user order", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Older pending title");
  await page.getByLabel("Status", { exact: true }).selectOption("needs_review");
  await page.getByLabel("Priority", { exact: true }).selectOption("p1");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");

  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Newest queued title");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  assert.equal(state.patches.length, 0);

  state.releaseStatus();
  await page.getByRole("button", { name: /Newest queued title/ }).waitFor();
  await waitFor(() => state.patches.length === 2);

  assert.equal(state.patches[0].title, "Older pending title");
  assert.equal(state.patches[0].status, "needs_review");
  assert.equal(state.patches[0].priority, "p1");
  assert.equal(state.patches[1].title, "Newest queued title");
  assert.equal(state.patches[1].status, "needs_review");
  assert.equal("priority" in state.patches[1], false);
  assert.equal(state.tasks.find(task => task.id === "task-parent").title, "Newest queued title");
  assert.equal(state.tasks.find(task => task.id === "task-parent").status, "needs_review");
  assert.equal(state.tasks.find(task => task.id === "task-parent").priority, "p1");
  assert.deepEqual(pageErrors, []);
});

test("a completed save reconciles untouched fields in a reopened task detail", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Committed title from first save");
  await page.getByLabel("Priority", { exact: true }).selectOption("p1");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");

  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  const description = page.getByLabel("Prompt and context", { exact: true });
  await description.fill("Live edit on reopened detail");
  state.releaseStatus();
  await waitFor(() => state.patches.length === 1);
  await page.waitForTimeout(50);

  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Committed title from first save", JSON.stringify({ patches: state.patches }));
  assert.equal(await page.getByLabel("Priority", { exact: true }).inputValue(), "p1");
  assert.equal(await description.inputValue(), "Live edit on reopened detail");
  assert.equal(await description.evaluate(element => element === document.activeElement), true);

  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => state.patches.length === 2);
  await page.getByRole("heading", { name: "All work", exact: true }).waitFor();

  assert.equal(state.patches[1].title, "Committed title from first save");
  assert.equal(state.patches[1].priority, "p1");
  assert.equal(state.patches[1].description, "Live edit on reopened detail");
  assert.equal(state.tasks.find(task => task.id === "task-parent").title, "Committed title from first save");
  assert.equal(state.tasks.find(task => task.id === "task-parent").priority, "p1");
  assert.equal(state.tasks.find(task => task.id === "task-parent").description, "Live edit on reopened detail");
  assert.deepEqual(pageErrors, []);
});

test("a Flow drop commits after a pending agent detail save", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Saved before Flow drop");
  await page.getByLabel("Priority", { exact: true }).selectOption("p1");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");

  await page.getByRole("link", { name: "All cards", exact: true }).click();
  await page.getByRole("tab", { name: "Flow", exact: true }).click();
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="needs_review"]'));
  assert.equal(state.patches.length, 0, JSON.stringify({ patches: state.patches, requests: state.requests.slice(-12) }));

  state.releaseStatus();
  await waitFor(() => state.patches.length === 2);
  await page.locator('[data-flow-status="needs_review"] [data-task="task-parent"]').waitFor();

  assert.equal(state.patches[0].title, "Saved before Flow drop");
  assert.equal(state.patches[0].priority, "p1");
  assert.equal(state.patches[1].status, "needs_review");
  assert.equal(state.tasks.find(task => task.id === "task-parent").title, "Saved before Flow drop");
  assert.equal(state.tasks.find(task => task.id === "task-parent").priority, "p1");
  assert.equal(state.tasks.find(task => task.id === "task-parent").status, "needs_review");
  assert.deepEqual(pageErrors, []);
});

test("a delayed Flow drop reconciles the same task opened after agent navigation", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/tasks?view=flow`);
  state.delayNextStatus = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="needs_review"]'));
  await waitFor(() => typeof state.releaseStatus === "function");

  await page.getByRole("link", { name: "All agents", exact: true }).click();
  await page.getByRole("link", { name: "Research agent", exact: true }).click();
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  const brief = page.getByLabel("Prompt and context", { exact: true });
  await brief.fill("Live detail edit while Flow commits");

  state.releaseStatus();
  await page.waitForFunction(() => document.querySelector('#workspace-detail-form [name="status"]')?.value === "needs_review");
  assert.equal(await brief.inputValue(), "Live detail edit while Flow commits");
  assert.equal(await brief.evaluate(element => element === document.activeElement), true);

  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => state.patches.length === 2);
  assert.equal(state.patches[0].status, "needs_review");
  assert.equal(state.patches[1].status, "needs_review");
  assert.equal(state.patches[1].description, "Live detail edit while Flow commits");
  assert.equal(state.tasks.find(task => task.id === "task-parent").status, "needs_review");
  assert.deepEqual(pageErrors, []);
});

test("a delayed Flow drop refreshes Agent Work after cross-route navigation", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/tasks?view=flow`);
  state.delayNextStatus = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="needs_review"]'));
  await waitFor(() => typeof state.releaseStatus === "function");

  await page.getByRole("link", { name: "All agents", exact: true }).click();
  await page.getByRole("link", { name: "Research agent", exact: true }).click();
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await page.getByRole("heading", { name: "All work", exact: true }).waitFor();
  const parent = page.getByRole("button", { name: /Publish task-first agents video/ });
  assert.equal(await parent.locator(".state-badge").textContent(), "In Progress");

  state.releaseStatus();
  await waitFor(() => state.patches.length === 1);
  await waitFor(() => state.requests.filter(request => request.startsWith("GET /api/v1/agents/agent-research/work?")).length >= 2);
  await parent.locator(".state-badge").filter({ hasText: "Review" }).waitFor();

  assert.equal(state.tasks.find(task => task.id === "task-parent").status, "needs_review");
  assert.deepEqual(pageErrors, []);
});

test("a delayed Flow drop refreshes Agent Work after another detail closes", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/tasks?view=flow`);
  state.delayNextStatus = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="needs_review"]'));
  await waitFor(() => typeof state.releaseStatus === "function");

  await page.getByRole("link", { name: "All agents", exact: true }).click();
  await page.getByRole("link", { name: "Research agent", exact: true }).click();
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await page.getByRole("button", { name: /Research examples/ }).click();
  const brief = page.getByLabel("Prompt and context", { exact: true });
  await brief.fill("Live child draft while parent Flow commits");
  const workRequests = () => state.requests.filter(request => request.startsWith("GET /api/v1/agents/agent-research/work?")).length;
  const requestsBeforeRelease = workRequests();

  state.releaseStatus();
  await waitFor(() => state.patches.length === 1);
  await page.waitForTimeout(50);
  assert.equal(workRequests(), requestsBeforeRelease);
  assert.equal(await brief.inputValue(), "Live child draft while parent Flow commits");
  assert.equal(await brief.evaluate(element => element === document.activeElement), true);

  state.delayNextAgentWork = true;
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await waitFor(() => typeof state.releaseAgentWork === "function", 10000);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  const parentBrief = page.getByLabel("Prompt and context", { exact: true });
  await parentBrief.fill("New parent draft during deferred work refresh");
  state.releaseAgentWork();
  await waitFor(() => workRequests() > requestsBeforeRelease);
  await waitFor(() => state.agentWorkRefreshCompleted);
  await page.waitForTimeout(50);

  assert.equal(await parentBrief.inputValue(), "New parent draft during deferred work refresh");
  assert.equal(await parentBrief.evaluate(element => element === document.activeElement), true);
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  const parent = page.getByRole("button", { name: /Publish task-first agents video.*Review/ });
  await parent.waitFor();
  assert.equal(await parent.evaluate(element => element === document.activeElement), true);

  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, "/app/agents/agent-research/work");
  assert.deepEqual(pageErrors, []);
});

test("a failed deferred Agent Work refresh preserves a newly opened detail", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/tasks?view=flow`);
  state.delayNextStatus = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="needs_review"]'));
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("link", { name: "All agents", exact: true }).click();
  await page.getByRole("link", { name: "Research agent", exact: true }).click();
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await page.getByRole("button", { name: /Research examples/ }).click();

  state.releaseStatus();
  await waitFor(() => state.patches.length === 1);
  state.delayNextAgentWork = true;
  state.failNextAgentWork = true;
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await waitFor(() => typeof state.releaseAgentWork === "function", 10000);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  const brief = page.getByLabel("Prompt and context", { exact: true });
  await brief.fill("Live parent draft during failed deferred refresh");

  state.releaseAgentWork();
  await page.locator(".detail-error").filter({ hasText: "The card was updated, but assigned work couldn’t be refreshed: Could not refresh assigned work" }).waitFor();

  assert.equal(await page.getByRole("region", { name: "Card detail" }).count(), 1);
  assert.equal(await brief.inputValue(), "Live parent draft during failed deferred refresh");
  assert.equal(await brief.evaluate(element => element === document.activeElement), true);
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  const parent = page.getByRole("button", { name: /Publish task-first agents video/ });
  assert.equal(await parent.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("a delayed workspace detail save refreshes Agent Work after navigation", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Saved from the workspace");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");

  await page.getByRole("link", { name: "All agents", exact: true }).click();
  await page.getByRole("link", { name: "Research agent", exact: true }).click();
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await page.getByRole("heading", { name: "All work", exact: true }).waitFor();
  assert.equal(await page.getByText("Saved from the workspace", { exact: true }).count(), 0);

  state.releaseStatus();
  await page.getByText("Saved from the workspace", { exact: true }).waitFor();

  assert.equal(state.tasks.find(task => task.id === "task-parent").title, "Saved from the workspace");
  assert.deepEqual(pageErrors, []);
});

test("a failed workspace-save Agent Work refresh preserves a task opened while it loads", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Saved before Agent Work refresh");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("link", { name: "All agents", exact: true }).click();
  await page.getByRole("link", { name: "Research agent", exact: true }).click();
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await page.getByRole("heading", { name: "All work", exact: true }).waitFor();

  state.failNextAgentWork = true;
  state.delayNextAgentWork = true;
  state.releaseStatus();
  await waitFor(() => typeof state.releaseAgentWork === "function");
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  const brief = page.getByLabel("Prompt and context", { exact: true });
  await brief.fill("Live draft during failed workspace-save refresh");
  await brief.focus();

  state.releaseAgentWork();
  await page.getByText(/assigned work couldn’t be refreshed/i).waitFor();
  assert.equal(await brief.inputValue(), "Live draft during failed workspace-save refresh");
  assert.equal(await brief.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("an Agent Work refresh preserves a task opened while it loads", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/tasks?view=flow`);
  state.delayNextStatus = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="needs_review"]'));
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("link", { name: "All agents", exact: true }).click();
  await page.getByRole("link", { name: "Research agent", exact: true }).click();
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await page.getByRole("heading", { name: "All work", exact: true }).waitFor();

  state.delayNextAgentWork = true;
  state.releaseStatus();
  await waitFor(() => typeof state.releaseAgentWork === "function");
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  const brief = page.getByLabel("Prompt and context", { exact: true });
  await brief.fill("Live Agent Work draft during refresh");
  await brief.focus();

  state.releaseAgentWork();
  await page.waitForFunction(() => document.activeElement?.id === "workspace-detail-description");
  assert.equal(await brief.inputValue(), "Live Agent Work draft during refresh");
  assert.equal(await page.getByRole("region", { name: "Card detail" }).isVisible(), true);
  assert.deepEqual(pageErrors, []);
});

test("a failed Agent Work refresh preserves a task opened while it loads", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/tasks?view=flow`);
  state.delayNextStatus = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="needs_review"]'));
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("link", { name: "All agents", exact: true }).click();
  await page.getByRole("link", { name: "Research agent", exact: true }).click();
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await page.getByRole("heading", { name: "All work", exact: true }).waitFor();

  state.failNextAgentWork = true;
  state.delayNextAgentWork = true;
  state.releaseStatus();
  await waitFor(() => typeof state.releaseAgentWork === "function");
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Live draft during failed Agent Work refresh");
  await title.focus();

  state.releaseAgentWork();
  await page.getByText(/assigned work couldn’t be refreshed/i).waitFor();
  assert.equal(await title.inputValue(), "Live draft during failed Agent Work refresh");
  assert.equal(await title.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("a delayed Flow drop refreshes a newly selected Review overview", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/tasks?view=flow`);
  state.delayNextStatus = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="needs_review"]'));
  await waitFor(() => typeof state.releaseStatus === "function");

  const reviewLoaded = page.waitForResponse(response => response.request().method() === "GET"
    && response.url().includes("/api/v1/tasks?") && response.url().includes("status=needs_review"));
  await page.getByRole("link", { name: "Review", exact: true }).click();
  await reviewLoaded;
  await page.getByRole("heading", { name: "Review", exact: true, level: 1 }).waitFor();
  assert.equal(await page.locator('[data-open-task="task-parent"]').count(), 0);

  const reviewRefreshed = page.waitForResponse(response => response.request().method() === "GET"
    && response.url().includes("/api/v1/tasks?") && response.url().includes("status=needs_review"));
  state.releaseStatus();
  await reviewRefreshed;
  await waitFor(() => state.patches.length === 1);
  await page.locator('[data-open-task="task-parent"]').waitFor();

  assert.equal(await page.locator('[data-open-task="task-parent"]').count(), 1, JSON.stringify({ requests: state.requests.slice(-12), taskQueries: state.taskQueries }));
  assert.equal(state.tasks.find(task => task.id === "task-parent").status, "needs_review");
  assert.deepEqual(pageErrors, []);
});

test("a committed Flow drop reports a current workspace refresh failure", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/tasks?view=flow`);
  await page.locator('[data-open-task="task-parent"]').waitFor();
  state.failNextWorkspaceTasks = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="needs_review"]'));

  await page.locator(".status-error").filter({ hasText: "The card was updated, but this view couldn’t be refreshed: Could not refresh tasks" }).waitFor();

  assert.equal(state.tasks.find(task => task.id === "task-parent").status, "needs_review");
  assert.equal(await page.getByText(/Couldn’t save/).count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("an older post-drop refresh failure stays out of a newer workspace route", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/tasks?view=flow`);
  state.delayNextStatus = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="needs_review"]'));
  await waitFor(() => typeof state.releaseStatus === "function");

  state.delayNextWorkspaceTasks = true;
  state.failNextWorkspaceTasks = true;
  state.releaseStatus();
  await waitFor(() => typeof state.releaseWorkspaceTasks === "function");

  const reviewLoaded = page.waitForResponse(response => response.request().method() === "GET"
    && response.url().includes("/api/v1/tasks?") && response.url().includes("status=needs_review"));
  await page.getByRole("link", { name: "Review", exact: true }).click();
  await reviewLoaded;
  await page.locator('[data-open-task="task-parent"]').waitFor();

  state.releaseWorkspaceTasks();
  await waitFor(() => state.delayedWorkspaceTasksCompleted);
  await page.waitForTimeout(50);

  assert.equal(new URL(page.url()).pathname, "/app/review");
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.equal(await page.locator('[data-open-task="task-parent"]').count(), 1);
  assert.deepEqual(pageErrors, []);
});

test("a queued Flow drop cannot refresh over a newer agent settings draft", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Saved before settings navigation");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");

  await page.getByRole("link", { name: "All cards", exact: true }).click();
  await page.getByRole("tab", { name: "Flow", exact: true }).click();
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="needs_review"]'));
  await page.getByRole("link", { name: "All agents", exact: true }).click();
  await page.getByRole("link", { name: "Research agent", exact: true }).click();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  const purpose = page.locator("#agent-settings-purpose");
  await purpose.fill("Unsaved settings draft while task commits");

  state.releaseStatus();
  await waitFor(() => state.patches.length === 2);
  await page.waitForTimeout(50);

  assert.equal(state.patches[0].title, "Saved before settings navigation", JSON.stringify(state.patches));
  assert.equal(state.patches[1].status, "needs_review");
  assert.equal(new URL(page.url()).pathname, "/app/agents/agent-research/settings");
  assert.equal(await purpose.inputValue(), "Unsaved settings draft while task commits");
  assert.equal(await purpose.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("a queued subtask toggle commits after its pending child save", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Research examples/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Saved child before toggle");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");

  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByRole("button", { name: "Mark Research examples not complete", exact: true }).click();
  assert.equal(state.patches.length, 0);

  state.releaseStatus();
  await page.getByRole("button", { name: "Mark Saved child before toggle complete", exact: true }).waitFor();
  await waitFor(() => state.patches.length === 2);

  assert.equal(state.patches[0].title, "Saved child before toggle");
  assert.equal(state.patches[0].status, "done");
  assert.equal(state.patches[1].status, "queued");
  assert.equal(state.subtasks[0].title, "Saved child before toggle");
  assert.equal(state.subtasks[0].done, false);
  assert.deepEqual(pageErrors, []);
});

test("an in-flight work refresh preserves edits in a newer task detail", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Background parent save");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();

  state.delayNextAgentWork = true;
  state.releaseStatus();
  await waitFor(() => typeof state.releaseAgentWork === "function");
  await page.getByRole("button", { name: /Research examples/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Newest child draft");
  state.releaseAgentWork();
  await waitFor(() => state.agentWorkRefreshCompleted);
  await page.waitForTimeout(50);

  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Newest child draft");
  assert.equal(await page.getByLabel("Title", { exact: true }).evaluate(element => element === document.activeElement), true);
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, "/app/agents/agent-research/work?page=2");
  assert.deepEqual(pageErrors, []);
});

test("successful agent mutations reconcile after same-agent navigation", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Reconciled across agent tabs");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await page.getByRole("heading", { name: "Working now", exact: true }).waitFor();
  state.releaseStatus();
  await page.getByRole("button", { name: /Reconciled across agent tabs/ }).waitFor();

  await page.getByRole("button", { name: /Reconciled across agent tabs/ }).click();
  state.delayNextDelete = true;
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete card", exact: true }).click();
  await waitFor(() => typeof state.releaseDelete === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await page.getByRole("heading", { name: "All work", exact: true }).waitFor();
  state.releaseDelete();
  await page.getByText("No assigned work.", { exact: true }).waitFor();

  assert.equal(new URL(page.url()).pathname, "/app/agents/agent-research/work");
  assert.equal(state.tasks.some(item => item.id === "task-parent"), false);
  assert.equal(state.subtasks.some(item => item.parentTaskId === "task-parent"), false);
  assert.deepEqual(pageErrors, []);
});

test("a delayed parent move reconciles descendant locations across agent tabs", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("List", { exact: true }).selectOption("list-inbox");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await page.getByRole("heading", { name: "Working now", exact: true }).waitFor();
  const detailRequestsBeforeRelease = state.requests.filter(request => request === "GET /api/v1/agents/agent-research").length;

  state.releaseStatus();
  await waitFor(() => state.subtasks.find(item => item.id === "task-child")?.bucketId === "list-inbox");
  await waitFor(() => state.requests.filter(request => request === "GET /api/v1/agents/agent-research").length > detailRequestsBeforeRelease);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).getByText("Workspace / Inbox", { exact: true }).waitFor();
  await page.getByRole("button", { name: /Research examples/ }).getByText("Workspace / Inbox", { exact: true }).waitFor();

  assert.deepEqual(pageErrors, []);
});

test("a parent list move preserves and keeps locked a saving child detail", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  const now = new Date();
  const offset = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
  const tuesday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 1);
  const formatDate = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  state.tasks[0].scheduledDate = formatDate(monday);
  await page.goto(`${origin}/app/week`);
  await page.getByRole("heading", { name: "Week", exact: true }).waitFor();
  state.delayNextCompletion = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator(`.workspace-week [data-calendar-date="${formatDate(tuesday)}"]`));
  await waitFor(() => typeof state.releaseCompletion === "function");

  await page.getByRole("link", { name: "All agents", exact: true }).click();
  await page.getByRole("link", { name: "Research agent", exact: true }).click();
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await page.getByRole("button", { name: /Research examples/ }).click();
  const title = page.getByLabel("Title", { exact: true });
  const brief = page.getByLabel("Prompt and context", { exact: true });
  await title.fill("Saving child title");
  await brief.fill("Saving child brief");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  const back = page.getByRole("button", { name: "Back to agent work", exact: true });
  await back.focus();

  Object.assign(state.tasks[0], { bucketId: "list-inbox", listName: "Inbox" });
  state.subtasks.filter(task => task.parentTaskId === "task-parent").forEach(task => Object.assign(task, { bucketId: "list-inbox", listName: "Inbox" }));
  state.releaseCompletion();
  await page.waitForFunction(() => document.querySelector("#workspace-detail-list")?.value === "list-inbox");

  assert.equal(await page.locator(".detail-context span").first().textContent(), "Inbox");
  assert.equal(await title.inputValue(), "Saving child title");
  assert.equal(await brief.inputValue(), "Saving child brief");
  assert.equal(await back.evaluate(element => element === document.activeElement), true);
  for (const label of ["Title", "Prompt and context", "Status", "List", "Priority", "Owner", "Planned"]) {
    assert.equal(await page.getByLabel(label, { exact: true }).isDisabled(), true, `${label} should stay disabled`);
  }

  state.releaseStatus();
  await page.getByLabel("Title", { exact: true }).waitFor();
  assert.equal(state.subtasks.find(task => task.id === "task-child").bucketId, "list-inbox");
  assert.deepEqual(pageErrors, []);
});

test("a delayed off-page subtask toggle reconciles overview totals", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);
  state.hideSubtasksFromAgentOverview = true;

  await page.goto(`${origin}/app/agents/agent-research`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Mark Research examples not complete", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("heading", { name: "Working now", exact: true }).waitFor();

  state.releaseStatus();
  await waitFor(() => state.subtasks.find(item => item.id === "task-child")?.status === "queued");
  await page.locator(".state-group-queued header > span").getByText("1", { exact: true }).waitFor();
  await page.locator(".state-group-done header > span").getByText("0", { exact: true }).waitFor();

  assert.deepEqual(pageErrors, []);
});

test("a delayed subtask toggle refreshes the current agent work page", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Mark Research examples not complete", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("heading", { name: "All work", exact: true }).waitFor();

  state.releaseStatus();
  await waitFor(() => state.subtasks.find(item => item.id === "task-child")?.status === "queued");
  await waitFor(() => state.requests.filter(request => request === "GET /api/v1/agents/agent-research/work?page=2&pageSize=50").length >= 2);
  await page.getByRole("button", { name: /Research examples.*Ready/ }).waitFor();

  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, "/app/agents/agent-research/work?page=2");
  assert.deepEqual(pageErrors, []);
});

test("workspace mutations cannot cross into retained agent context", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research`);
  await page.getByRole("heading", { name: "Research agent", exact: true }).waitFor();
  await page.getByRole("link", { name: "All cards", exact: true }).click();
  await page.getByRole("heading", { name: "All cards", exact: true }).waitFor();
  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Workspace-origin failure");
  state.delayNextStatus = true;
  state.failNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Close card", exact: true }).click();
  await page.getByRole("link", { name: "Research agent", exact: true }).click();
  await page.getByRole("heading", { name: "Research agent", exact: true }).waitFor();
  state.releaseStatus();
  await waitFor(() => state.failNextStatus === false);

  assert.equal(await page.getByRole("alert").count(), 0);
  assert.equal(await page.getByText("Workspace-origin failure", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Publish task-first agents video", { exact: true }).isVisible(), true);
  assert.deepEqual(pageErrors, []);
});

test("failed agent mutations report errors after detail has been closed", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Unsaved agent title");
  state.delayNextStatus = true;
  state.failNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("button", { name: /Research examples/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Newer child draft");
  state.releaseStatus();
  await page.getByRole("alert").filter({ hasText: "Couldn’t save “Unsaved agent title”: Could not save task" }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Newer child draft");
  assert.equal(await page.getByLabel("Title", { exact: true }).evaluate(element => element === document.activeElement), true);
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();

  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  state.delayNextDelete = true;
  state.failNextDelete = true;
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete card", exact: true }).click();
  await waitFor(() => typeof state.releaseDelete === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  state.releaseDelete();
  await page.getByRole("alert").filter({ hasText: "Couldn’t delete “Publish task-first agents video”: Could not delete task" }).waitFor();
  assert.equal(await page.getByText("Publish task-first agents video", { exact: true }).isVisible(), true);
  assert.deepEqual(pageErrors, []);
});

test("post-save refresh failures report that the task was already saved", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.getByRole("button", { name: "Open card: Publish task-first agents video", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Committed before refresh failed");
  state.failNextWorkspaceTasks = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();

  await page.getByRole("alert").filter({ hasText: "The task was saved, but this view couldn’t be refreshed: Could not refresh tasks" }).waitFor();
  assert.equal(state.patches.at(-1).title, "Committed before refresh failed");
  assert.equal(await page.getByText(/Couldn’t save/).count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("post-delete refresh failures report that the task was already deleted", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.getByRole("button", { name: "Open card: Write the doc my boss asked for", exact: true }).click();
  state.failNextWorkspaceTasks = true;
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete card", exact: true }).click();

  await page.getByRole("alert").filter({ hasText: "The task was deleted, but this view couldn’t be refreshed: Could not refresh tasks" }).waitFor();
  assert.equal(state.tasks.some(task => task.id === "task-inbox"), false);
  assert.equal(await page.getByText(/Couldn’t delete/).count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("a delayed post-save refresh failure cannot render into a newer route", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.getByRole("button", { name: "Open card: Publish task-first agents video", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Committed before navigation");
  state.delayNextWorkspaceTasks = true;
  state.failNextWorkspaceTasks = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseWorkspaceTasks === "function");

  await page.getByRole("link", { name: /Inbox/ }).click();
  await page.getByRole("heading", { name: "Inbox", level: 1, exact: true }).waitFor();
  state.releaseWorkspaceTasks();
  await waitFor(() => state.delayedWorkspaceTasksCompleted);
  await page.waitForTimeout(50);

  assert.equal(new URL(page.url()).pathname, "/app/inbox");
  assert.equal(await page.getByRole("heading", { name: "Inbox", level: 1, exact: true }).isVisible(), true);
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.equal(state.patches.at(-1).title, "Committed before navigation");
  assert.deepEqual(pageErrors, []);
});

test("a delayed subtask refresh failure cannot render into a newer route", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.getByRole("button", { name: "Open card: Publish task-first agents video", exact: true }).click();
  await page.getByLabel("Child card title", { exact: true }).fill("Committed subtask");
  state.delayNextWorkspaceTasks = true;
  state.failNextWorkspaceTasks = true;
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await waitFor(() => typeof state.releaseWorkspaceTasks === "function");

  await page.getByRole("link", { name: /Inbox/ }).click();
  await page.getByRole("heading", { name: "Inbox", level: 1, exact: true }).waitFor();
  state.releaseWorkspaceTasks();
  await waitFor(() => state.delayedWorkspaceTasksCompleted);
  await page.waitForTimeout(50);

  assert.equal(new URL(page.url()).pathname, "/app/inbox");
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.equal(state.subtasks.some(task => task.title === "Committed subtask"), true);
  assert.deepEqual(pageErrors, []);
});

test("a current subtask refresh failure releases workspace loading", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.getByRole("button", { name: "Open card: Publish task-first agents video", exact: true }).click();
  await page.getByLabel("Child card title", { exact: true }).fill("Committed before refresh error");
  state.delayNextWorkspaceTasks = true;
  state.failNextWorkspaceTasks = true;
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await waitFor(() => typeof state.releaseWorkspaceTasks === "function");
  await page.getByLabel("Title", { exact: true }).fill("Live title during failed refresh");
  const brief = page.getByLabel("Prompt and context", { exact: true });
  await brief.fill("Live focused brief during failed refresh");
  state.releaseWorkspaceTasks();

  await page.locator(".detail-error").filter({ hasText: "The card was updated, but this view couldn’t be refreshed: Could not refresh tasks" }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Live title during failed refresh");
  assert.equal(await brief.inputValue(), "Live focused brief during failed refresh");
  assert.equal(await brief.evaluate(element => element === document.activeElement), true);
  await page.getByRole("button", { name: "Close card", exact: true }).click();
  assert.equal(await page.getByText("Loading tasks…", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Publish task-first agents video", { exact: true }).isVisible(), true);
  assert.deepEqual(pageErrors, []);
});

test("a background agent refresh failure is visible in a newer task detail", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Parent committed before refresh failure");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("button", { name: /Research examples/ }).click();
  const childBrief = page.getByLabel("Prompt and context", { exact: true });
  await childBrief.fill("Newer child draft during refresh failure");
  state.failNextAgentDetail = true;

  state.releaseStatus();
  await page.locator(".detail-error").filter({ hasText: "The card was updated, but assigned work couldn’t be refreshed: Could not refresh assigned work" }).waitFor();

  assert.equal(state.tasks.find(task => task.id === "task-parent").title, "Parent committed before refresh failure");
  assert.equal(await childBrief.inputValue(), "Newer child draft during refresh failure");
  assert.equal(await childBrief.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("a recovered agent refresh clears only its refresh warning", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Research examples/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Child committed before recovery");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  state.failNextAgentDetail = true;
  state.releaseStatus();

  const warning = page.locator(".detail-error").filter({ hasText: "The card was updated, but assigned work couldn’t be refreshed: Could not refresh assigned work" });
  await warning.waitFor();
  await page.getByLabel("Child card title", { exact: true }).fill("Refresh recovery subtask");
  state.delayNextSubtask = true;
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await waitFor(() => typeof state.releaseSubtask === "function");
  const parentBrief = page.getByLabel("Prompt and context", { exact: true });
  await parentBrief.fill("Focused parent draft during recovery");
  state.releaseSubtask();

  await page.getByText("Refresh recovery subtask", { exact: true }).waitFor();
  await warning.waitFor({ state: "hidden" });
  assert.equal(await parentBrief.inputValue(), "Focused parent draft during recovery");
  assert.equal(await parentBrief.evaluate(element => element === document.activeElement), true);
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  assert.equal(await page.locator("[data-agent-task-mutation-error]").isHidden(), true);
  assert.deepEqual(pageErrors, []);
});

test("an unresolved background mutation failure survives an unrelated successful refresh", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Parent save that will fail");
  state.delayNextStatus = true;
  state.failNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  const parentBrief = page.getByLabel("Prompt and context", { exact: true });
  await parentBrief.fill("Newer parent draft after failed save");

  state.releaseStatus();
  const failure = page.locator(".detail-error").filter({ hasText: "Couldn’t save “Parent save that will fail”: Could not save task" });
  await failure.waitFor();

  await page.getByLabel("Child card title", { exact: true }).fill("Unrelated successful subtask");
  state.delayNextSubtask = true;
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await waitFor(() => typeof state.releaseSubtask === "function");
  await parentBrief.fill("Focused newer draft during unrelated success");
  state.releaseSubtask();

  await page.getByText("Unrelated successful subtask", { exact: true }).waitFor();
  assert.equal(await failure.isVisible(), true);
  assert.equal(await parentBrief.inputValue(), "Focused newer draft during unrelated success");
  assert.equal(await parentBrief.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("an agent subtask refresh failure preserves unrelated task drafts", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Unsaved parent draft");
  await page.getByLabel("Child card title", { exact: true }).fill("Committed agent subtask");
  state.failNextAgentDetail = true;
  state.delayNextAgentWork = true;
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await waitFor(() => typeof state.releaseAgentWork === "function");
  await page.getByLabel("Prompt and context", { exact: true }).fill("Unsaved focused brief");
  state.releaseAgentWork();

  await page.getByRole("alert").filter({ hasText: "The card was updated, but assigned work couldn’t be refreshed: Could not refresh assigned work" }).waitFor();
  assert.equal(await page.getByRole("region", { name: "Card detail" }).count(), 1);
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved parent draft");
  assert.equal(await page.getByLabel("Prompt and context", { exact: true }).inputValue(), "Unsaved focused brief");
  assert.equal(await page.getByLabel("Prompt and context", { exact: true }).evaluate(element => element === document.activeElement), true);
  assert.equal(state.subtasks.some(task => task.title === "Committed agent subtask"), true);
  assert.deepEqual(pageErrors, []);
});

test("an in-flight successful agent subtask refresh preserves live edits and focus", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Child card title", { exact: true }).fill("Refresh while editing");
  state.delayNextAgentWork = true;
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await waitFor(() => typeof state.releaseAgentWork === "function");

  await page.getByLabel("Title", { exact: true }).fill("Typed during refresh");
  await page.getByLabel("Prompt and context", { exact: true }).fill("Focused draft typed during refresh");
  state.releaseAgentWork();
  await waitFor(() => state.agentWorkRefreshCompleted);
  await page.waitForTimeout(50);

  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Typed during refresh");
  assert.equal(await page.getByLabel("Prompt and context", { exact: true }).inputValue(), "Focused draft typed during refresh");
  assert.equal(await page.getByLabel("Prompt and context", { exact: true }).evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("background agent subtask creation refreshes sidebar list counts", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  const youtube = page.getByRole("link", { name: /YouTube/ });
  assert.equal(await youtube.locator("b").textContent(), "2");
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Child card title", { exact: true }).fill("Background count update");
  state.delayNextSubtask = true;
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await waitFor(() => typeof state.releaseSubtask === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("button", { name: /Research examples/ }).click();
  const childBrief = page.getByLabel("Prompt and context", { exact: true });
  await childBrief.fill("Live child edit while count refreshes");
  state.releaseSubtask();

  await page.getByRole("link", { name: /YouTube.*3/ }).waitFor();
  assert.equal(await youtube.locator("b").textContent(), "3");
  assert.equal(await childBrief.inputValue(), "Live child edit while count refreshes");
  assert.equal(await childBrief.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("background agent mutations refresh list counts on the agent directory", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Child card title", { exact: true }).fill("Directory count update");
  state.delayNextSubtask = true;
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await waitFor(() => typeof state.releaseSubtask === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("link", { name: "All agents", exact: true }).click();
  await page.getByRole("heading", { name: "Agents", exact: true, level: 1 }).waitFor();
  assert.equal(await page.locator('[data-workspace-count="list-youtube"]').textContent(), "2");

  state.releaseSubtask();
  await page.waitForFunction(() => document.querySelector('[data-workspace-count="list-youtube"]')?.textContent === "3");

  assert.equal(state.subtasks.some(task => task.title === "Directory count update"), true);
  assert.deepEqual(pageErrors, []);
});

test("background agent mutations refresh list counts on the new-agent route", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Child card title", { exact: true }).fill("New-agent count update");
  state.delayNextSubtask = true;
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await waitFor(() => typeof state.releaseSubtask === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("link", { name: "All agents", exact: true }).click();
  await page.getByRole("link", { name: "New agent", exact: true }).click();
  await page.getByRole("heading", { name: "New agent", exact: true }).waitFor();
  assert.equal(await page.locator('[data-workspace-count="list-youtube"]').textContent(), "2");

  state.releaseSubtask();
  await page.waitForFunction(() => document.querySelector('[data-workspace-count="list-youtube"]')?.textContent === "3");

  assert.equal(state.subtasks.some(task => task.title === "New-agent count update"), true);
  assert.deepEqual(pageErrors, []);
});

test("background agent mutations refresh counts without resetting settings drafts", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Child card title", { exact: true }).fill("Settings count update");
  state.delayNextSubtask = true;
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await waitFor(() => typeof state.releaseSubtask === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  const settingsName = page.locator("#agent-settings-name");
  const settingsPurpose = page.locator("#agent-settings-purpose");
  await settingsName.fill("Unsaved settings name");
  await settingsPurpose.fill("Unsaved focused purpose");

  state.releaseSubtask();
  await page.getByRole("link", { name: /YouTube.*3/ }).waitFor();

  assert.equal(await settingsName.inputValue(), "Unsaved settings name");
  assert.equal(await settingsPurpose.inputValue(), "Unsaved focused purpose");
  assert.equal(await settingsPurpose.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("a background parent move refreshes counts without resetting agent settings", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);
  const now = new Date();
  const offset = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
  const tuesday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 1);
  const formatDate = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  state.tasks[0].scheduledDate = formatDate(monday);

  await page.goto(`${origin}/app/week`);
  state.delayNextCompletion = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator(`.workspace-week [data-calendar-date="${formatDate(tuesday)}"]`));
  await waitFor(() => typeof state.releaseCompletion === "function");
  await page.getByRole("link", { name: "All agents", exact: true }).click();
  await page.getByRole("link", { name: "Research agent", exact: true }).click();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  const purpose = page.locator("#agent-settings-purpose");
  await purpose.fill("Unsaved purpose while parent moves");
  assert.equal(await page.locator('[data-workspace-count="list-youtube"]').textContent(), "2");
  assert.equal(await page.locator('[data-workspace-count="inbox"]').textContent(), "1");

  Object.assign(state.tasks[0], { bucketId: "list-inbox", listName: "Inbox" });
  state.subtasks.filter(task => task.parentTaskId === "task-parent").forEach(task => Object.assign(task, { bucketId: "list-inbox", listName: "Inbox" }));
  state.lists.find(list => list.id === "list-youtube").openCount = 1;
  state.lists.find(list => list.id === "list-inbox").openCount = 2;
  state.releaseCompletion();

  await page.waitForFunction(() => document.querySelector('[data-workspace-count="list-youtube"]')?.textContent === "1"
    && document.querySelector('[data-workspace-count="inbox"]')?.textContent === "2");
  assert.equal(await purpose.inputValue(), "Unsaved purpose while parent moves");
  assert.equal(await purpose.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("a background parent move completes agent settings whose list load it supersedes", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);
  const now = new Date();
  const offset = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
  const tuesday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 1);
  const formatDate = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  state.tasks[0].scheduledDate = formatDate(monday);

  await page.goto(`${origin}/app/week`);
  state.delayNextCompletion = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator(`.workspace-week [data-calendar-date="${formatDate(tuesday)}"]`));
  await waitFor(() => typeof state.releaseCompletion === "function");
  await page.getByRole("link", { name: "All agents", exact: true }).click();
  await page.getByRole("link", { name: "Research agent", exact: true }).click();

  let releaseLists;
  let listRequests = 0;
  await page.route("**/api/v1/lists", async route => {
    listRequests += 1;
    if (listRequests === 1) await new Promise(resolve => { releaseLists = resolve; });
    await route.continue();
  });
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await waitFor(() => typeof releaseLists === "function");

  Object.assign(state.tasks[0], { bucketId: "list-inbox", listName: "Inbox" });
  state.subtasks.filter(task => task.parentTaskId === "task-parent").forEach(task => Object.assign(task, { bucketId: "list-inbox", listName: "Inbox" }));
  state.lists.find(list => list.id === "list-youtube").openCount = 1;
  state.lists.find(list => list.id === "list-inbox").openCount = 2;
  state.releaseCompletion();

  await waitFor(() => listRequests >= 2);
  await page.locator("#agent-settings-purpose").waitFor();
  const purpose = page.locator("#agent-settings-purpose");
  await purpose.fill("Draft after agent settings recovery");
  releaseLists();
  await page.waitForTimeout(50);

  assert.equal(new URL(page.url()).pathname, "/app/agents/agent-research/settings");
  assert.equal(await page.locator('[data-workspace-count="list-youtube"]').textContent(), "1");
  assert.equal(await page.locator('[data-workspace-count="inbox"]').textContent(), "2");
  assert.equal(await purpose.inputValue(), "Draft after agent settings recovery");
  assert.deepEqual(pageErrors, []);
});

test("a background mutation completes an agent settings route whose list load it supersedes", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Saved while settings loads");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();

  let releaseLists;
  let listRequests = 0;
  await page.route("**/api/v1/lists", async route => {
    listRequests += 1;
    if (listRequests === 1) await new Promise(resolve => { releaseLists = resolve; });
    await route.continue();
  });
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await waitFor(() => typeof releaseLists === "function");
  state.releaseStatus();

  await waitFor(() => listRequests >= 2);
  await page.locator("#agent-settings-purpose").waitFor();
  const purpose = page.locator("#agent-settings-purpose");
  await purpose.fill("Draft after background route recovery");
  releaseLists();
  await page.waitForTimeout(50);

  assert.equal(new URL(page.url()).pathname, "/app/agents/agent-research/settings");
  assert.equal(await page.getByRole("heading", { name: "Research agent", exact: true }).isVisible(), true);
  assert.equal(await purpose.inputValue(), "Draft after background route recovery");
  assert.deepEqual(pageErrors, []);
});

test("a background mutation completes the agent directory whose list load it supersedes", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Saved while agents load");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();

  let releaseLists;
  let listRequests = 0;
  await page.route("**/api/v1/lists", async route => {
    listRequests += 1;
    if (listRequests === 1) await new Promise(resolve => { releaseLists = resolve; });
    await route.continue();
  });
  await page.getByRole("link", { name: "All agents", exact: true }).click();
  await waitFor(() => typeof releaseLists === "function");
  state.releaseStatus();

  await waitFor(() => listRequests >= 2);
  await page.getByRole("heading", { name: "Agents", exact: true, level: 1 }).waitFor();
  releaseLists();
  await page.waitForTimeout(50);

  assert.equal(new URL(page.url()).pathname, "/app/agents");
  assert.equal(await page.getByText("Loading agents…", { exact: true }).count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("a background mutation completes All cards whose list load it supersedes", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Saved while all tasks loads");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();

  let releaseLists;
  let listRequests = 0;
  await page.route("**/api/v1/lists", async route => {
    listRequests += 1;
    if (listRequests === 1) await new Promise(resolve => { releaseLists = resolve; });
    await route.continue();
  });
  await page.getByRole("link", { name: "All cards", exact: true }).click();
  await waitFor(() => typeof releaseLists === "function");
  state.releaseStatus();

  await waitFor(() => listRequests >= 2);
  await page.getByRole("heading", { name: "All cards", exact: true }).waitFor();
  await page.getByText("Saved while all tasks loads", { exact: true }).waitFor();
  releaseLists();
  await page.waitForTimeout(50);

  assert.equal(new URL(page.url()).pathname, "/app/tasks");
  assert.equal(await page.getByRole("heading", { name: "All cards", exact: true }).isVisible(), true);
  assert.deepEqual(pageErrors, []);
});

test("a failed background refresh completes an agent overview route whose list load it supersedes", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Saved while overview loads");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();

  let releaseLists;
  let listRequests = 0;
  await page.route("**/api/v1/lists", async route => {
    listRequests += 1;
    if (listRequests === 1) await new Promise(resolve => { releaseLists = resolve; });
    await route.continue();
  });
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await waitFor(() => typeof releaseLists === "function");
  state.failNextAgentDetail = true;
  state.releaseStatus();

  await waitFor(() => listRequests >= 2);
  await page.getByRole("heading", { name: "Agent couldn’t be loaded.", exact: true }).waitFor();
  releaseLists();
  await page.waitForTimeout(50);

  assert.equal(new URL(page.url()).pathname, "/app/agents/agent-research");
  assert.equal(await page.getByText("Loading agent…", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Could not refresh assigned work", { exact: true }).isVisible(), true);
  assert.deepEqual(pageErrors, []);
});

test("a background task failure does not reset an agent settings draft", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Task save that will fail");
  state.delayNextStatus = true;
  state.failNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  const settingsName = page.locator("#agent-settings-name");
  const settingsPurpose = page.locator("#agent-settings-purpose");
  await settingsName.fill("Unsaved agent name");
  await settingsPurpose.fill("Unsaved purpose during task failure");

  state.releaseStatus();
  await page.getByRole("alert").filter({ hasText: "Couldn’t save “Task save that will fail”: Could not save task" }).waitFor();

  assert.equal(await settingsName.inputValue(), "Unsaved agent name");
  assert.equal(await settingsPurpose.inputValue(), "Unsaved purpose during task failure");
  assert.equal(await settingsPurpose.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("a background list-refresh failure is visible without resetting agent settings", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Title", { exact: true }).fill("Task saved before list refresh fails");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Child card title", { exact: true }).fill("Later successful list refresh");
  state.delayNextSubtask = true;
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await waitFor(() => typeof state.releaseSubtask === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  const settingsPurpose = page.locator("#agent-settings-purpose");
  await settingsPurpose.fill("Unsaved purpose during list refresh");
  state.failNextLists = true;

  state.releaseStatus();
  await page.getByRole("alert").filter({ hasText: "Could not refresh lists" }).waitFor();

  assert.equal(state.tasks.find(task => task.id === "task-parent").title, "Task saved before list refresh fails");
  assert.equal(await settingsPurpose.inputValue(), "Unsaved purpose during list refresh");
  assert.equal(await settingsPurpose.evaluate(element => element === document.activeElement), true);

  state.releaseSubtask();
  await page.locator("[data-workspace-list-error]").waitFor({ state: "hidden" });

  assert.equal(state.subtasks.some(task => task.title === "Later successful list refresh"), true);
  assert.equal(await settingsPurpose.inputValue(), "Unsaved purpose during list refresh");
  assert.equal(await settingsPurpose.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("failed subtask mutations remain visible across same-agent navigation", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Child card title", { exact: true }).fill("Delayed research add");
  state.delayNextSubtask = true;
  state.failNextSubtask = true;
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await waitFor(() => typeof state.releaseSubtask === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await page.getByRole("heading", { name: "Working now", exact: true }).waitFor();
  state.releaseSubtask();
  await page.getByRole("alert").filter({ hasText: "Couldn’t add child card “Delayed research add”: Could not add subtask" }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/app/agents/agent-research");

  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  state.delayNextStatus = true;
  state.failNextStatus = true;
  await page.getByRole("button", { name: "Mark Research examples not complete", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await page.getByRole("heading", { name: "Working now", exact: true }).waitFor();
  state.releaseStatus();
  await page.getByRole("alert").filter({ hasText: "Couldn’t update child card “Research examples”: Could not save task" }).waitFor();
  assert.equal(state.subtasks.find(item => item.id === "task-child").done, true);
  assert.deepEqual(pageErrors, []);
});

test("a delayed parent delete removes its assigned subtasks from agent work", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  state.delayNextDelete = true;
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete card", exact: true }).click();
  await waitFor(() => typeof state.releaseDelete === "function");

  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("heading", { name: "All work", exact: true }).waitFor();
  state.releaseDelete();
  await page.getByText("No assigned work.", { exact: true }).waitFor();

  assert.equal(state.tasks.some(item => item.id === "task-parent"), false);
  assert.equal(state.subtasks.some(item => item.parentTaskId === "task-parent"), false);
  assert.equal(await page.getByText("Publish task-first agents video", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Research examples", { exact: true }).count(), 0);
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, "/app/agents/agent-research/work?page=2");
  assert.equal(await page.getByRole("button", { name: "Assign work", exact: true }).evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("a parent cascade closes a child detail opened during deletion", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  state.delayNextDelete = true;
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete card", exact: true }).click();
  await waitFor(() => typeof state.releaseDelete === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("button", { name: /Research examples/ }).click();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Research examples");

  state.releaseDelete();
  await page.getByRole("region", { name: "Card detail" }).waitFor({ state: "detached" });
  await page.getByText("No assigned work.", { exact: true }).waitFor();

  assert.equal(state.tasks.some(item => item.id === "task-parent"), false);
  assert.equal(state.subtasks.some(item => item.parentTaskId === "task-parent"), false);
  assert.equal(await page.getByRole("button", { name: "Assign work", exact: true }).evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("a parent cascade closes a descendant created while deletion is pending", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete card", exact: true }).click();

  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Child card title", { exact: true }).fill("Created during parent deletion");
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await page.getByText("Created during parent deletion", { exact: true }).waitFor();
  await page.locator(".workspace-subtask-open").filter({ hasText: "Created during parent deletion" }).click();
  await page.waitForFunction(() => document.querySelector("#workspace-detail-title")?.value === "Created during parent deletion");
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Created during parent deletion");

  state.releaseStatus();
  await page.getByRole("region", { name: "Card detail" }).waitFor({ state: "detached" });
  await page.getByText("No assigned work.", { exact: true }).waitFor();

  assert.equal(state.tasks.some(item => item.id === "task-parent"), false);
  assert.equal(state.subtasks.some(item => item.parentTaskId === "task-parent"), false);
  assert.equal(await page.getByRole("button", { name: "Assign work", exact: true }).evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("direct settings keeps account-wide lists and a delayed creation through navigation", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/settings/profile`);
  await page.getByRole("heading", { name: "Profile", exact: true }).waitFor();
  await page.getByRole("link", { name: /YouTube/ }).waitFor();

  state.delayNextList = true;
  await page.getByRole("button", { name: "New list", exact: true }).click();
  const newListDialog = page.getByRole("dialog", { name: "New list", exact: true });
  await newListDialog.getByLabel("Name", { exact: true }).fill("Settings plan");
  assert.equal(await newListDialog.getByLabel("Board", { exact: true }).count(), 0);
  await newListDialog.getByRole("button", { name: "Create list", exact: true }).click();
  await waitFor(() => typeof state.releaseList === "function");
  assert.equal(await newListDialog.getByRole("button", { name: "Cancel", exact: true }).isDisabled(), true);
  assert.equal(await newListDialog.getByRole("button", { name: "Creating…", exact: true }).isDisabled(), true);

  state.releaseList();
  await waitFor(() => state.createdLists.length === 1);
  const createdLink = page.getByRole("link", { name: /Settings plan/ });
  await createdLink.waitFor();
  assert.equal(await page.getByRole("button", { name: "New list", exact: true }).isEnabled(), true);
  await page.getByRole("link", { name: "Preferences", exact: true }).click();
  await page.getByRole("heading", { name: "Preferences", exact: true }).waitFor();
  await createdLink.waitFor();
  await createdLink.click();
  await page.getByRole("heading", { name: "Settings plan", level: 1, exact: true }).waitFor();
  assert.deepEqual(pageErrors, []);
});

test("New card captures directly into Inbox and opens a normal card editor", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.getByRole("button", { name: "New card", exact: true }).click();
  const title = page.getByLabel("Title", { exact: true });
  await title.waitFor();
  assert.equal(await title.inputValue(), "Untitled card");
  assert.equal(state.created.length, 1);
  assert.equal(state.created[0].bucketId, "list-inbox");
  assert.equal(await page.locator('a[href="/app/inbox"] b').textContent(), "2");

  await title.fill("Prepare launch brief");
  await page.getByLabel("Priority", { exact: true }).selectOption("p0");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(state.patches.length, 1, `errors=${pageErrors.join(" | ")} requests=${state.requests.join(" | ")}`);
  await page.getByRole("region", { name: "Card detail" }).waitFor({ state: "detached" });
  await page.locator(`[data-open-task="${state.created[0].id}"]`).getByText("Prepare launch brief", { exact: true }).waitFor();
  assert.equal(state.patches.at(-1).title, "Prepare launch brief");
  assert.equal(state.patches.at(-1).priority, "p0");
});

test("New card preserves a successful capture when the workspace refresh fails", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  state.failNextWorkspaceTasks = true;
  await page.getByRole("button", { name: "New card", exact: true }).click();
  const recovery = page.getByRole("alert", { name: "Created card recovery" });
  await recovery.waitFor();

  assert.equal(state.created.length, 1);
  assert.match(await recovery.textContent(), /Card created/);
  assert.equal(await page.getByRole("button", { name: "New card", exact: true }).isDisabled(), true);

  await page.getByRole("button", { name: "Open card", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Untitled card");
  assert.equal(state.created.length, 1);
  assert.deepEqual(pageErrors, []);
});

test("a lost child-card response retries with one idempotency key and no duplicate", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Child card title", { exact: true }).fill("Verify final copy");
  state.commitNextSubtaskThenFail = true;
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await page.getByText("Response lost after commit", { exact: true }).waitFor();

  assert.equal(state.subtasks.filter(task => task.title === "Verify final copy").length, 1);
  assert.equal(await page.getByLabel("Child card title", { exact: true }).inputValue(), "Verify final copy");
  assert.equal(state.subtaskRequestKeys.length, 1);
  assert.ok(state.subtaskRequestKeys[0]);

  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await page.locator(".workspace-subtask-list").getByText("Verify final copy", { exact: true }).waitFor();

  assert.equal(state.subtasks.filter(task => task.title === "Verify final copy").length, 1);
  assert.equal(state.subtaskRequestKeys.length, 2);
  assert.equal(state.subtaskRequestKeys[1], state.subtaskRequestKeys[0]);
  assert.deepEqual(pageErrors, []);
});

test("task detail coordinates one level of human and agent subtasks through the CLI model", async t => {
  const { page, state } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  const dialog = page.getByRole("region", { name: "Card detail" });
  await dialog.waitFor();
  assert.equal(await page.getByText("Child cards", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("1 of 1 done", { exact: true }).isVisible(), true);
  assert.equal(await dialog.getByText("Research examples", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("Assigned to Research agent", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText(/refine with|scout|autopilot/i).count(), 0);
  const bounds = await dialog.boundingBox();
  assert.ok(bounds.width >= 700, `detail width=${bounds.width}`);
  assert.ok(bounds.height >= 940, `detail height=${bounds.height}`);
  assert.ok(bounds.x >= 220, `detail x=${bounds.x}`);
  assert.equal(await page.getByRole("complementary").first().isVisible(), true, "sidebar stays visible");
  assert.equal(await page.locator(".workspace-flow.grouped-by-list").isVisible(), true, "the card drawer preserves board context");
  assert.equal(await dialog.locator(".workspace-detail-main").count(), 1);
  assert.equal(await dialog.getByRole("complementary", { name: "Card properties" }).count(), 1);
  assert.equal(parseFloat(await page.locator("#workspace-detail-title").evaluate(element => getComputedStyle(element).fontSize)), 26);

  await page.getByLabel("Title", { exact: true }).fill("Unsaved parent title");
  await page.getByLabel("Prompt and context", { exact: true }).fill("Unsaved parent brief");
  await page.getByLabel("Priority", { exact: true }).selectOption("p2");

  await page.getByRole("button", { name: "Mark Research examples not complete", exact: true }).click();
  await page.getByText("0 of 1 done", { exact: true }).waitFor();
  assert.equal(state.patches.at(-1).id, "task-child");
  assert.equal(state.patches.at(-1).status, "queued");
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved parent title");
  assert.equal(await page.getByLabel("Prompt and context", { exact: true }).inputValue(), "Unsaved parent brief");
  assert.equal(await page.getByLabel("Priority", { exact: true }).inputValue(), "p2");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-toggle-subtask")), "task-child");

  await page.getByLabel("Child card title", { exact: true }).fill("Human final review");
  state.failNextSubtask = true;
  await page.locator("#add-subtask").getByRole("button", { name: "Add child", exact: true }).click();
  await page.locator(".workspace-subtask-error").getByText("Could not add subtask", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Child card title", { exact: true }).inputValue(), "Human final review");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Child card title");
  await page.locator("#add-subtask").getByRole("button", { name: "Add child", exact: true }).click();
  await dialog.getByText("Human final review", { exact: true }).waitFor();
  assert.equal(state.subtasks.length, 2);
  assert.equal(state.subtasks[1].parentTaskId, "task-parent");
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved parent title");
  assert.equal(await page.getByLabel("Prompt and context", { exact: true }).inputValue(), "Unsaved parent brief");
  assert.equal(await page.getByLabel("Priority", { exact: true }).inputValue(), "p2");

  await dialog.getByText("Human final review", { exact: true }).click();
  await page.getByRole("button", { name: "Back to parent card", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Child card title", { exact: true }).count(), 0, "subtasks cannot contain subtasks");
  assert.equal(await page.getByLabel("List", { exact: true }).isDisabled(), true, "subtasks stay in their parent list");
  assert.equal(await page.getByText("Child cards stay with their parent card.", { exact: true }).isVisible(), true);
  await page.getByLabel("Title", { exact: true }).fill("Unsaved child title");
  await page.getByRole("button", { name: "Back to parent card", exact: true }).click();
  await page.getByText("Child cards", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved parent title");
  assert.equal(await dialog.getByText("Human final review", { exact: true }).isVisible(), true);
  await dialog.getByText("Human final review", { exact: true }).click();
  await page.getByRole("button", { name: "Back to parent card", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved child title");
  state.failNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.locator(".detail-error").getByText("Could not save task", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved child title");
  assert.equal(await page.getByLabel("List", { exact: true }).inputValue(), "list-youtube", "failed save keeps the parent's list");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Child cards", { exact: true }).waitFor();
  assert.equal(Object.hasOwn(state.patches.at(-1), "bucketId"), false, "subtask saves omit their immutable list");
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved parent title");
  assert.equal(await dialog.getByText("Unsaved child title", { exact: true }).isVisible(), true);
  await page.getByRole("button", { name: "Close card", exact: true }).click();
  await page.getByRole("heading", { name: "All cards", exact: true }).waitFor();
  assert.equal(await page.locator(".workspace-flow.grouped-by-list").isVisible(), true);
});

test("task detail remains usable on a phone-sized viewport", async t => {
  const { page } = await startWorkspace(t, { width: 390, height: 844 });

  await page.locator('[data-open-task="task-parent"]').click();
  const dialog = page.getByRole("region", { name: "Card detail" });
  await dialog.waitFor();
  const bounds = await dialog.boundingBox();
  assert.ok(bounds.width >= 384, `dialog width=${bounds.width}`);
  assert.ok(bounds.height >= 780, `detail height=${bounds.height}`);
  assert.equal(await dialog.getByRole("complementary", { name: "Card properties" }).isVisible(), true);
  assert.equal(parseFloat(await page.locator("#workspace-detail-title").evaluate(element => getComputedStyle(element).fontSize)), 24);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test("task detail stacks its properties rail at tablet width", async t => {
  const { page } = await startWorkspace(t, { width: 720, height: 900 });

  await page.locator('[data-open-task="task-parent"]').click();
  const mainBounds = await page.locator(".workspace-detail-main").boundingBox();
  const propertyBounds = await page.locator(".workspace-detail-properties").boundingBox();
  assert.ok(mainBounds.width >= 400, `main width=${mainBounds.width}`);
  assert.ok(Math.abs(mainBounds.width - propertyBounds.width) <= 2, `main=${mainBounds.width} properties=${propertyBounds.width}`);
  assert.equal(parseFloat(await page.locator("#workspace-detail-title").evaluate(element => getComputedStyle(element).fontSize)), 25);
  assert.ok(propertyBounds.y > mainBounds.y);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test("a delayed subtask response cannot overwrite a reopened task surface", async t => {
  const { page, state } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Draft from the old surface");
  await page.getByLabel("Child card title", { exact: true }).fill("Delayed subtask");
  state.delayNextSubtask = true;
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await waitFor(() => typeof state.releaseSubtask === "function");

  await page.getByRole("button", { name: "Close card", exact: true }).click();
  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Draft from the new surface");
  state.releaseSubtask();
  await waitFor(() => state.subtasks.some(item => item.title === "Delayed subtask"));
  await page.getByRole("region", { name: "Card detail" }).getByText("Delayed subtask", { exact: true }).waitFor();

  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Draft from the new surface");
  assert.equal(await page.getByRole("region", { name: "Card detail" }).getByText("Delayed subtask", { exact: true }).isVisible(), true);
  assert.equal(await page.getByRole("button", { name: "Add child", exact: true }).isEnabled(), true);
});

test("sidebar navigation clears subtask state before another task opens", async t => {
  const { page } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Child card title", { exact: true }).fill("Must stay with the parent");
  await page.getByRole("link", { name: /Inbox/ }).click();
  await page.getByRole("heading", { name: "Inbox", level: 1, exact: true }).waitFor();
  await page.locator('[data-open-task="task-inbox"]').click();

  assert.equal(await page.getByLabel("Child card title", { exact: true }).inputValue(), "");
  assert.equal(await page.getByText("Could not add subtask", { exact: true }).count(), 0);
});

test("a delayed save cannot close or overwrite a newer task surface", async t => {
  const { page, state } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Saved parent title");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");

  await page.getByRole("button", { name: "Close card", exact: true }).click();
  await page.locator('[data-open-task="task-inbox"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Draft on the newer surface");
  state.releaseStatus();
  await waitFor(() => state.patches.some(item => item.id === "task-parent" && item.title === "Saved parent title"));
  await page.waitForTimeout(50);

  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Draft on the newer surface");
  assert.equal(await page.getByRole("region", { name: "Card detail" }).isVisible(), true);
  await page.getByRole("button", { name: "Close card", exact: true }).click();
  await page.getByText("Saved parent title", { exact: true }).waitFor();
});

test("a delayed workspace save refreshes the overview after detail closes", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Saved after detail closed");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");

  await page.getByRole("button", { name: "Close card", exact: true }).click();
  assert.equal(await page.getByText("Saved after detail closed", { exact: true }).count(), 0);
  state.releaseStatus();
  await page.getByText("Saved after detail closed", { exact: true }).waitFor();

  assert.equal(state.tasks.find(task => task.id === "task-parent").title, "Saved after detail closed");
  assert.deepEqual(pageErrors, []);
});

test("a post-save workspace refresh preserves a task opened while it loads", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Saved before background refresh");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Close card", exact: true }).click();

  state.delayNextWorkspaceTasks = true;
  state.releaseStatus();
  await waitFor(() => typeof state.releaseWorkspaceTasks === "function");
  await page.locator('[data-open-task="task-inbox"]').click();
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Live draft during background refresh");
  await title.focus();

  state.releaseWorkspaceTasks();
  await page.waitForFunction(() => document.activeElement?.id === "workspace-detail-title");
  assert.equal(await title.inputValue(), "Live draft during background refresh");
  assert.equal(await page.getByRole("region", { name: "Card detail" }).isVisible(), true);
  assert.deepEqual(pageErrors, []);
});

test("a failed post-save workspace refresh preserves a task opened while it loads", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Saved before failed refresh");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Close card", exact: true }).click();

  state.delayNextWorkspaceTasks = true;
  state.failNextWorkspaceTasks = true;
  state.releaseStatus();
  await waitFor(() => typeof state.releaseWorkspaceTasks === "function");
  await page.locator('[data-open-task="task-inbox"]').click();
  const brief = page.getByLabel("Prompt and context", { exact: true });
  await brief.fill("Live draft during failed workspace refresh");
  await brief.focus();

  state.releaseWorkspaceTasks();
  await page.locator(".detail-error").filter({ hasText: /view couldn’t be refreshed/i }).waitFor();
  assert.equal(await brief.inputValue(), "Live draft during failed workspace refresh");
  assert.equal(await brief.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("a failed save preserves every unsaved task field", async t => {
  const { page, state } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Unsaved title after failure");
  await page.getByLabel("Prompt and context", { exact: true }).fill("Unsaved brief after failure");
  await page.getByLabel("Priority", { exact: true }).selectOption("p2");
  state.failNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.locator(".detail-error").getByText("Could not save task", { exact: true }).waitFor();

  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved title after failure");
  assert.equal(await page.getByLabel("Prompt and context", { exact: true }).inputValue(), "Unsaved brief after failure");
  assert.equal(await page.getByLabel("Priority", { exact: true }).inputValue(), "p2");
});

test("a delayed delete cannot close a newer surface and disappears from the overview", async t => {
  const { page, state } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  state.delayNextDelete = true;
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete card", exact: true }).click();
  await waitFor(() => typeof state.releaseDelete === "function");

  await page.getByRole("button", { name: "Close card", exact: true }).click();
  await page.locator('[data-open-task="task-inbox"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Newer task stays open");
  state.releaseDelete();
  await waitFor(() => !state.tasks.some(item => item.id === "task-parent"));
  await page.waitForTimeout(50);

  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Newer task stays open");
  await page.getByRole("button", { name: "Close card", exact: true }).click();
  assert.equal(await page.locator('[data-open-task="task-parent"]').count(), 0);
});

test("a delayed delete closes the same task when it has been reopened", async t => {
  const { page, state } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  state.delayNextDelete = true;
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete card", exact: true }).click();
  await waitFor(() => typeof state.releaseDelete === "function");

  await page.getByRole("button", { name: "Close card", exact: true }).click();
  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByRole("region", { name: "Card detail" }).waitFor();
  state.releaseDelete();
  await waitFor(() => !state.tasks.some(item => item.id === "task-parent"));
  await page.getByRole("heading", { name: "All cards", exact: true }).waitFor();

  assert.equal(await page.getByRole("region", { name: "Card detail" }).count(), 0);
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
