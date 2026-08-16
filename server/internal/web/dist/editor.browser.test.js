const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const AxeBuilder = require("@axe-core/playwright").default;
const { chromium } = require("playwright");

const dist = __dirname;

function workspaceFixture() {
  const boards = [{ id: "board-one", name: "Workspace" }, { id: "board-two", name: "Other" }];
  const lists = [
    { id: "list-inbox", boardId: "board-one", boardName: "Workspace", name: "Inbox", goal: "Capture now", isInbox: true, openCount: 1 },
    { id: "list-youtube", boardId: "board-one", boardName: "Workspace", name: "YouTube", goal: "Plan useful videos", isInbox: false, openCount: 2 },
  ];
  const tasks = [
    {
      id: "task-parent", boardId: "board-one", bucketId: "list-youtube", listName: "YouTube",
      title: "Publish task-first agents video", description: "Explain one control plane for people and agents.",
      scheduledDate: "2026-08-12", kind: "action", status: "working", priority: "p0",
      assigneeAgentId: "agent-research", assigneeAgentName: "Research agent",
    },
    {
      id: "task-inbox", boardId: "board-one", bucketId: "list-inbox", listName: "Inbox",
      title: "Write the doc my boss asked for", description: "", scheduledDate: "", kind: "action",
      status: "new", priority: "", assigneeAgentId: "",
    },
  ];
  const subtasks = [{
    id: "task-child", boardId: "board-one", bucketId: "list-youtube", listName: "YouTube",
    parentTaskId: "task-parent", parentTaskTitle: "Publish task-first agents video", title: "Research examples", description: "", scheduledDate: "", kind: "action",
    status: "done", priority: "p1", assigneeAgentId: "agent-research", assigneeAgentName: "Research agent",
  }];
  const agents = [
    { id: "agent-research", displayName: "Research agent", purpose: "Research assigned work", credential: {}, workCounts: { ready: 1 } },
  ];
  return { boards, lists, tasks, subtasks, agents, entries: {}, entryAttempts: {}, failNextEntryResponse: false, delayNextEntry: false, releaseEntry: null, deletedAgents: [], commitNextAgentDeleteThenFail: false, deletedBoards: [], reorderedLists: [], dynamicAgentCounts: false, taskQueries: [], created: [], createdBoards: [], createdLists: [], patches: [], requests: [], inboxIdempotency: new Map(), inboxRequestKeys: [], commitNextInboxThenFail: false, subtaskIdempotency: new Map(), subtaskRequestKeys: [], commitNextSubtaskThenFail: false, hideSubtasksFromAgentOverview: false, failNextAgentDetail: false, unauthorizeNextAgentDetail: false, delayNextAgentDetail: false, releaseAgentDetail: null, failNextLists: false, failNextListCreate: false, failNextListRename: false, failNextBoardCreate: false, delayNextBoardCreate: false, releaseBoardCreate: null, failNextBoardDelete: false, delayNextBoardDelete: false, releaseBoardDelete: null, failNextAgentWork: false, delayNextAgentWork: false, agentWorkRefreshCompleted: false, releaseAgentWork: null, failNextSubtask: false, delayNextSubtask: false, releaseSubtask: null, inboxMessages: [], failNextInbox: false, failNextStatus: false, delayNextStatus: false, releaseStatus: null, failNextTaskPatch: false, delayNextTaskPatch: false, releaseTaskPatch: null, failNextDelete: false, unauthorizeNextDelete: false, delayNextDelete: false, releaseDelete: null, failNextWorkspaceTasks: false, delayNextWorkspaceTasks: false, delayedWorkspaceTasksCompleted: false, releaseWorkspaceTasks: null, delayNextBoards: false, releaseBoards: null, delayNextBoardDetail: false, releaseBoardDetail: null, delayNextList: false, releaseList: null };
}

// The list view puts its name in an editable field rather than a heading.
const listTitle = (page, name) => page.locator(`#workspace-list-name[value="${name}"]`);

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
      return json(response, { boards: state.boards });
    }
    if (url.pathname === "/api/v1/boards" && request.method === "POST") {
      const input = await requestJSON(request);
      if (state.delayNextBoardCreate) {
        state.delayNextBoardCreate = false;
        await new Promise(resolve => { state.releaseBoardCreate = resolve; });
      }
      if (state.failNextBoardCreate) {
        state.failNextBoardCreate = false;
        return json(response, { error: "Could not create replacement board" }, 500);
      }
      const created = { id: `board-created-${state.createdBoards.length + 1}`, name: input.name };
      state.boards.push(created);
      state.createdBoards.push(created);
      return json(response, created, 201);
    }
    const boardMatch = url.pathname.match(/^\/api\/v1\/boards\/([^/]+)$/);
    if (boardMatch && request.method === "GET") {
      const boardID = boardMatch[1];
      const board = state.boards.find(item => item.id === boardID);
      if (!board) return json(response, { error: "board not found" }, 404);
      const buckets = state.lists.filter(list => list.boardId === boardID).map(list => ({
        ...list,
        tasks: [...state.tasks, ...state.subtasks].filter(task => task.bucketId === list.id).map(task => ({ ...task })),
      }));
      if (state.delayNextBoardDetail) {
        state.delayNextBoardDetail = false;
        await new Promise(resolve => { state.releaseBoardDetail = resolve; });
      }
      return json(response, { ...board, buckets });
    }
    if (boardMatch && request.method === "DELETE") {
      if (state.delayNextBoardDelete) {
        state.delayNextBoardDelete = false;
        await new Promise(resolve => { state.releaseBoardDelete = resolve; });
      }
      if (state.failNextBoardDelete) {
        state.failNextBoardDelete = false;
        return json(response, { error: "Could not delete board" }, 500);
      }
      const boardID = boardMatch[1];
      const index = state.boards.findIndex(item => item.id === boardID);
      if (index < 0) return json(response, { error: "board not found" }, 404);
      if (!state.lists.some(list => list.isInbox && list.boardId !== boardID)) {
        // Production maps ErrInvalidData to 400 with no code, so match it exactly.
        return json(response, { error: "invalid data: the account must keep an Inbox list" }, 400);
      }
      const deletedListIDs = new Set(state.lists.filter(list => list.boardId === boardID).map(list => list.id));
      state.boards.splice(index, 1);
      state.lists = state.lists.filter(list => list.boardId !== boardID);
      state.tasks = state.tasks.filter(task => !deletedListIDs.has(task.bucketId));
      state.subtasks = state.subtasks.filter(task => !deletedListIDs.has(task.bucketId));
      state.deletedBoards.push(boardID);
      return json(response, {});
    }
    const reorderListsMatch = url.pathname.match(/^\/api\/v1\/boards\/([^/]+)\/reorder-buckets$/);
    if (reorderListsMatch && request.method === "POST") {
      const input = await requestJSON(request);
      const positions = new Map(input.ids.map((id, index) => [id, index]));
      const boardLists = state.lists
        .filter(list => list.boardId === reorderListsMatch[1])
        .sort((a, b) => positions.get(a.id) - positions.get(b.id));
      let boardIndex = 0;
      state.lists = state.lists.map(list => list.boardId === reorderListsMatch[1] ? boardLists[boardIndex++] : list);
      state.reorderedLists = input.ids;
      return json(response, {});
    }
    const createListMatch = url.pathname.match(/^\/api\/v1\/boards\/([^/]+)\/buckets$/);
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
      const board = state.boards.find(item => item.id === boardID);
      if (!board) return json(response, { error: "board not found" }, 404);
      const created = { id: `list-created-${state.createdLists.length + 1}`, boardId: boardID, boardName: board.name, name: input.name, goal: "", isInbox: Boolean(input.isInbox), openCount: 0 };
      state.lists.push(created);
      state.createdLists.push(created);
      return json(response, created, 201);
    }
    if (url.pathname === "/api/v1/inbox" && request.method === "GET") {
      if (state.failNextInbox) {
        state.failNextInbox = false;
        return json(response, { error: "Could not load your inbox" }, 500);
      }
      const cursor = url.searchParams.get("cursor") || "";
      const start = cursor ? state.inboxMessages.findIndex(message => message.id === cursor) + 1 : 0;
      const page = state.inboxMessages.slice(start, start + 2);
      const nextCursor = start + 2 < state.inboxMessages.length ? page[page.length - 1].id : "";
      return json(response, { messages: page, nextCursor });
    }
    if (url.pathname === "/api/v1/lists" && request.method === "GET") {
      if (state.failNextLists) {
        state.failNextLists = false;
        return json(response, { error: "Could not refresh lists" }, 500);
      }
      return json(response, { lists: state.lists });
    }
    if (url.pathname === "/api/v1/agents" && request.method === "GET") {
      const agents = state.dynamicAgentCounts ? state.agents.map(agent => {
        const assigned = [...state.tasks, ...state.subtasks].filter(task => task.assigneeAgentId === agent.id);
        return { ...agent, workCounts: {
          ready: assigned.filter(task => task.status === "queued").length,
          working: assigned.filter(task => task.status === "working").length,
          review: assigned.filter(task => task.status === "needs_review").length,
          completed: assigned.filter(task => task.status === "done").length,
        } };
      }) : state.agents;
      return json(response, { agents, maxAgents: 5 });
    }
    if (url.pathname === "/api/v1/agents" && request.method === "POST") {
      const input = await requestJSON(request);
      const agent = {
        id: `agent-created-${state.agents.length + 1}`,
        displayName: input.displayName,
        purpose: input.purpose || "",
        credential: {},
        workCounts: {},
      };
      state.agents.push(agent);
      return json(response, { ...agent, token: "slate_agent_test_secret" }, 201);
    }
    const entryMatch = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/entries$/);
    if (entryMatch && request.method === "GET") return json(response, { entries: state.entries[entryMatch[1]] || [] });
    if (entryMatch && request.method === "POST") {
      const input = await requestJSON(request);
      const attemptKey = request.headers["idempotency-key"] || "";
      const task = [...state.tasks, ...state.subtasks].find(item => item.id === entryMatch[1]);
      if (attemptKey && state.entryAttempts[attemptKey]) {
        return json(response, {
          ...state.entryAttempts[attemptKey],
          taskStatus: task.status,
          taskReviewReason: task.reviewReason || "",
        }, 201);
      }
      const entry = { id: `entry-${Object.values(state.entries).flat().length + 1}`, taskId: task.id, ...input, authorKind: "human", authorId: "owner", authorName: "Owain", createdAt: new Date().toISOString() };
      state.entries[task.id] = [...(state.entries[task.id] || []), entry];
      if (entry.kind === "output") Object.assign(task, { status: "needs_review", reviewReason: "output" });
      Object.assign(entry, { taskStatus: task.status, taskReviewReason: task.reviewReason || "" });
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
    if (agentMatch && request.method === "DELETE") {
      const index = state.agents.findIndex(agent => agent.id === agentMatch[1]);
      if (index < 0) return json(response, { error: "agent not found" }, 404);
      const deletedID = state.agents[index].id;
      state.deletedAgents.push(deletedID);
      state.agents.splice(index, 1);
      for (const task of [...state.tasks, ...state.subtasks]) {
        if (task.assigneeAgentId === deletedID) {
          task.assigneeAgentId = "";
          task.assigneeAgentName = "";
        }
      }
      if (state.commitNextAgentDeleteThenFail) {
        state.commitNextAgentDeleteThenFail = false;
        return json(response, { error: "Response was lost" }, 500);
      }
      return json(response, { ok: true });
    }
    if (agentMatch && request.method === "GET") {
      if (state.delayNextAgentDetail) {
        state.delayNextAgentDetail = false;
        await new Promise(resolve => { state.releaseAgentDetail = resolve; });
      }
      if (state.unauthorizeNextAgentDetail) {
        state.unauthorizeNextAgentDetail = false;
        return json(response, { error: "Session expired" }, 401);
      }
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
        recentlyCompleted: visibleAssigned.filter(item => item.status === "done"),
        totals: {
          ready: assigned.filter(item => item.status === "queued").length,
          working: assigned.filter(item => item.status === "working").length,
          review: assigned.filter(item => item.status === "needs_review").length,
          completed: assigned.filter(item => item.status === "done").length,
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
      const idempotencyKey = request.headers["idempotency-key"] || "";
      state.inboxRequestKeys.push(idempotencyKey);
      const existing = state.inboxIdempotency.get(idempotencyKey);
      if (existing) return json(response, existing, 201);
      const created = { id: `task-created-${state.created.length + 1}`, boardId: "board-one", bucketId: "list-inbox", listName: "Inbox", title: input.title, description: input.description || "", scheduledDate: "", kind: "action", status: "new", priority: "", assigneeAgentId: "" };
      state.tasks.unshift(created);
      state.created.push(created);
      state.lists.find(list => list.id === "list-inbox").openCount += 1;
      if (idempotencyKey) state.inboxIdempotency.set(idempotencyKey, created);
      if (state.commitNextInboxThenFail) {
        state.commitNextInboxThenFail = false;
        return json(response, { error: "Connection lost after capture" }, 500);
      }
      return json(response, created, 201);
    }
    const bucketTaskMatch = url.pathname.match(/^\/api\/v1\/buckets\/([^/]+)\/tasks$/);
    if (bucketTaskMatch && request.method === "POST") {
      const input = await requestJSON(request);
      const list = state.lists.find(item => item.id === bucketTaskMatch[1]);
      if (!list) return json(response, { error: "list not found" }, 404);
      const created = { id: `task-created-${state.created.length + 1}`, boardId: list.boardId, bucketId: list.id, listName: list.name, title: input.title, description: input.description || "", scheduledDate: input.scheduledDate || "", kind: "action", status: input.assigneeAgentId ? "queued" : "new", priority: "", assigneeAgentId: input.assigneeAgentId || "" };
      state.tasks.unshift(created);
      state.created.push(created);
      list.openCount += 1;
      return json(response, created, 201);
    }
    const bucketMatch = url.pathname.match(/^\/api\/v1\/buckets\/([^/]+)$/);
    if (bucketMatch && request.method === "PATCH") {
      const input = await requestJSON(request);
      if (state.failNextListRename && "name" in input) {
        state.failNextListRename = false;
        return json(response, { error: "Could not rename list" }, 500);
      }
      const list = state.lists.find(item => item.id === bucketMatch[1]);
      if (!list) return json(response, { error: "list not found" }, 404);
      Object.assign(list, input);
      [...state.tasks, ...state.subtasks].filter(task => task.bucketId === list.id).forEach(task => { task.listName = list.name; });
      return json(response, list);
    }
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
      const created = { ...parent, id: `task-child-${state.subtasks.length + 1}`, parentTaskId: parent.id, title: input.title, description: "", status: "new", priority: "", assigneeAgentId: "", assigneeAgentName: "" };
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
      const previousStatus = task.status;
      Object.assign(task, input);
      if (input.assigneeAgentId && task.status === "new") task.status = "queued";
      if (!task.parentTaskId && input.bucketId) {
        const list = state.lists.find(item => item.id === input.bucketId);
        if (previousBucketID !== list.id && task.status !== "done") {
          state.lists.find(item => item.id === previousBucketID).openCount -= 1;
          list.openCount += 1;
        }
        Object.assign(task, { boardId: list.boardId, listName: list.name });
        state.subtasks.filter(item => item.parentTaskId === task.id).forEach(item => {
          Object.assign(item, { boardId: list.boardId, bucketId: list.id, listName: list.name });
        });
      }
      if (previousStatus !== task.status && (previousStatus === "done" || task.status === "done")) {
        state.lists.find(list => list.id === task.bucketId).openCount += task.status === "done" ? -1 : 1;
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
      if (state.unauthorizeNextDelete) {
        state.unauthorizeNextDelete = false;
        return json(response, { error: "Session expired" }, 401);
      }
      const index = state.tasks.findIndex(item => item.id === taskMatch[1]);
      if (index >= 0) {
        const deleted = [state.tasks[index], ...state.subtasks.filter(item => item.parentTaskId === taskMatch[1])];
        for (const item of deleted) {
          if (item.status === "done") continue;
          const list = state.lists.find(candidate => candidate.id === item.bucketId);
          if (list) list.openCount = Math.max(0, list.openCount - 1);
        }
        state.tasks.splice(index, 1);
        state.subtasks = state.subtasks.filter(item => item.parentTaskId !== taskMatch[1]);
      }
      const subtaskIndex = state.subtasks.findIndex(item => item.id === taskMatch[1]);
      if (subtaskIndex >= 0) {
        const [deleted] = state.subtasks.splice(subtaskIndex, 1);
        if (deleted.status !== "done") {
          const list = state.lists.find(candidate => candidate.id === deleted.bucketId);
          if (list) list.openCount = Math.max(0, list.openCount - 1);
        }
      }
      return json(response, {});
    }
    if (taskMatch && request.method === "GET") {
      const task = [...state.tasks, ...state.subtasks].find(item => item.id === taskMatch[1]);
      return task ? json(response, task) : json(response, { error: "not found" }, 404);
    }
    if (taskMatch && request.method === "PATCH") {
      const input = await requestJSON(request);
      if (state.delayNextTaskPatch) {
        state.delayNextTaskPatch = false;
        await new Promise(resolve => { state.releaseTaskPatch = resolve; });
      }
      if (state.failNextTaskPatch) {
        state.failNextTaskPatch = false;
        return json(response, { error: "Could not update task" }, 500);
      }
      const task = [...state.tasks, ...state.subtasks].find(item => item.id === taskMatch[1]);
      if (!task) return json(response, { error: "not found" }, 404);
      Object.assign(task, input);
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
  await page.getByRole("heading", { name: "Board", exact: true }).waitFor();
  return { page, state, origin, pageErrors };
}

test("the inbox is agent messages, not another board", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await navigateApp(page, "/app/inbox");
  await page.getByRole("heading", { name: "Inbox", exact: true, level: 1 }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "No messages yet", exact: true }).isVisible(), true);
  assert.equal(await page.getByText("Only agents write to your inbox. Your own comments stay on the task.", { exact: true }).isVisible(), true);
  assert.equal(await page.locator(".workspace-flow").count(), 0, "the inbox must not render the board");

  state.inboxMessages = [{
    id: "message-one",
    taskId: "task-parent",
    taskTitle: "Publish task-first agents video",
    kind: "comment",
    body: "I have drafted the spec. Can you take a look?",
    authorId: "agent-research",
    authorName: "Research agent",
    createdAt: "2026-08-16T09:00:00Z",
  }];
  await page.goto(`${origin}/app/inbox`);
  await page.getByRole("heading", { name: "Inbox", exact: true, level: 1 }).waitFor();
  assert.equal(await page.getByText("I have drafted the spec. Can you take a look?", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("Research agent", { exact: true }).first().isVisible(), true);
  assert.equal(await page.getByRole("heading", { name: "No messages yet", exact: true }).count(), 0);

  assert.equal(await page.getByRole("button", { name: "Load older messages", exact: true }).count(), 0, "one page needs no pagination");

  await page.locator('[data-inbox-task="task-parent"]').click();
  await page.getByRole("region", { name: "Task detail" }).waitFor();
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, "/app/tasks?task=task-parent");
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Publish task-first agents video");
  assert.deepEqual(pageErrors, []);
});

test("the inbox pages back through older messages", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  state.inboxMessages = ["one", "two", "three"].map((word, index) => ({
    id: `message-${word}`,
    taskId: "task-parent",
    taskTitle: "Publish task-first agents video",
    kind: "comment",
    body: `Message ${word}`,
    authorId: "agent-research",
    authorName: "Research agent",
    createdAt: `2026-08-1${index}T09:00:00Z`,
  }));

  await page.goto(`${origin}/app/inbox`);
  await page.getByText("Message one", { exact: true }).waitFor();
  assert.equal(await page.getByText("Message three", { exact: true }).count(), 0, "the third message is on the next page");

  await page.getByRole("button", { name: "Load older messages", exact: true }).click();
  await page.getByText("Message three", { exact: true }).waitFor();
  assert.equal(await page.getByText("Message one", { exact: true }).count(), 1, "older pages append rather than replace");
  assert.equal(await page.getByRole("button", { name: "Load older messages", exact: true }).count(), 0, "the last page offers no more");
  assert.deepEqual(pageErrors, []);
});

test("a failed inbox load reports itself without leaving a blank surface", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  state.failNextInbox = true;
  await navigateApp(page, "/app/inbox");
  await page.getByRole("alert").filter({ hasText: "Could not load your inbox" }).waitFor();
  assert.deepEqual(pageErrors, []);
});

test("the board is grouped by status and dragging changes status", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  for (const status of ["Todo", "In Progress", "Review", "Done"]) {
    await page.locator(".workspace-flow-column").getByText(status, { exact: true }).waitFor();
  }
  assert.equal(await page.locator(".workspace-flow.grouped-by-status").count(), 1);
  assert.equal(await page.locator("[data-kanban-list]").count(), 0);

  await page.locator('[data-task="task-child"]').dragTo(page.locator('[data-flow-status="working"]'));
  await page.locator('[data-flow-status="working"] [data-task="task-child"]').waitFor();
  assert.equal(state.subtasks.find(task => task.id === "task-child").status, "working");
  assert.deepEqual(pageErrors, []);
});

test("a board card exposes a copyable task ID and a reloadable permalink", async t => {
  const { page, origin, pageErrors } = await startWorkspace(t);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await page.goto(`${origin}/app/tasks`);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByRole("region", { name: "Task detail" }).waitFor();
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, "/app/tasks?task=task-parent");
  assert.equal(await page.locator("#workspace-task-id").textContent(), "task-parent");

  await page.goBack();
  await page.getByRole("heading", { name: "Board", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, "/app/tasks");
  await page.goForward();
  await page.getByRole("region", { name: "Task detail" }).waitFor();

  await page.getByRole("button", { name: "Copy task ID", exact: true }).focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "task-parent");
  await page.getByText("Task ID copied.", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${origin}/app/tasks?task=task-parent`);
  await page.reload();
  await page.getByRole("region", { name: "Task detail" }).waitFor();
  assert.equal(await page.locator("#workspace-task-id").textContent(), "task-parent");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } });
    document.execCommand = () => {
      window.__legacyCopiedTaskLink = window.getSelection().toString();
      return true;
    };
  });
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__legacyCopiedTaskLink), `${origin}/app/tasks?task=task-parent`);

  await page.getByRole("button", { name: "Back to board", exact: true }).click();
  await page.getByRole("region", { name: "Task detail" }).waitFor({ state: "detached" });
  await page.getByRole("heading", { name: "Board", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, "/app/tasks");
  assert.deepEqual(pageErrors, []);
});

test("closing a directly loaded task permalink replaces it with its list", async t => {
  const { page, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/tasks?task=task-parent`);
  await page.getByRole("region", { name: "Task detail" }).waitFor();
  await page.getByRole("button", { name: "Back to board", exact: true }).click();
  await page.getByRole("region", { name: "Task detail" }).waitFor({ state: "detached" });

  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, "/app/tasks");
  assert.deepEqual(pageErrors, []);
});

test("task references remain usable on a mobile card detail", async t => {
  const { page, pageErrors } = await startWorkspace(t, { width: 390, height: 844 });

  await page.locator('[data-open-task="task-parent"]').click();
  const taskID = page.locator("#workspace-task-id");
  await taskID.waitFor();
  const bounds = await taskID.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390, JSON.stringify(bounds));
  assert.equal(await page.getByRole("button", { name: "Copy task ID", exact: true }).isVisible(), true);
  assert.equal(await page.getByRole("button", { name: "Copy link", exact: true }).isVisible(), true);
  assert.deepEqual(pageErrors, []);
});

test("an unknown task permalink replaces an existing detail with a board error", async t => {
  const { page, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/tasks`);
  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByRole("region", { name: "Task detail" }).waitFor();
  await page.evaluate(() => {
    history.pushState({}, "", "/app/tasks?task=missing-task");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.getByRole("alert").getByText("not found", { exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Board", exact: true }).isVisible(), true);
  assert.equal(await page.getByRole("region", { name: "Task detail" }).count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("task history restores unsaved parent and child drafts", async t => {
  const { page, pageErrors } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Unsaved parent through history");
  await page.locator("#card-entry-body").fill("Unsaved parent comment");
  await page.getByLabel("Subtask title", { exact: true }).fill("Unsaved parent child card");
  await page.getByText("Research examples", { exact: true }).click();
  await page.getByRole("button", { name: "Back to parent task", exact: true }).waitFor();
  await page.getByLabel("Title", { exact: true }).fill("Unsaved child through history");
  await page.locator("#card-entry-body").fill("Unsaved child comment");

  await page.goBack();
  await page.getByText("Subtasks", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved parent through history");
  assert.equal(await page.locator("#card-entry-body").inputValue(), "Unsaved parent comment");
  assert.equal(await page.getByLabel("Subtask title", { exact: true }).inputValue(), "Unsaved parent child card");
  await page.goForward();
  await page.getByRole("button", { name: "Back to parent task", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved child through history");
  assert.equal(await page.locator("#card-entry-body").inputValue(), "Unsaved child comment");

  await page.goBack();
  await page.getByText("Subtasks", { exact: true }).waitFor();
  await page.goBack();
  await page.getByRole("heading", { name: "Board", exact: true }).waitFor();
  await page.goForward();
  await page.getByText("Subtasks", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved parent through history");
  assert.equal(await page.locator("#card-entry-body").inputValue(), "Unsaved parent comment");
  assert.equal(await page.getByLabel("Subtask title", { exact: true }).inputValue(), "Unsaved parent child card");
  await page.goForward();
  await page.getByRole("button", { name: "Back to parent task", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved child through history");
  assert.equal(await page.locator("#card-entry-body").inputValue(), "Unsaved child comment");
  assert.deepEqual(pageErrors, []);
});

test("the board filters as you type and clears back to everything", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  assert.equal(await page.locator('[data-open-task="task-child"]').count(), 1);
  assert.equal(await page.getByRole("button", { name: "Clear", exact: true }).count(), 0, "Clear only appears once something is filtered");

  await page.getByLabel("Search tasks", { exact: true }).fill("Publish");
  await waitFor(() => state.taskQueries.some(query => query.includes("q=Publish")));
  await page.locator('[data-open-task="task-child"]').waitFor({ state: "detached" });
  assert.match(page.url(), /q=Publish/);
  assert.equal(await page.locator('[data-open-task="task-parent"]').count(), 1);
  assert.equal(await page.getByLabel("Search tasks", { exact: true }).inputValue(), "Publish");
  assert.equal(await page.getByLabel("Search tasks", { exact: true }).evaluate(element => element === document.activeElement), true,
    "typing must not lose focus when the board refreshes");

  await page.getByLabel("Filter by priority", { exact: true }).selectOption("p1");
  await waitFor(() => state.taskQueries.some(query => query.includes("priority=p1")));
  assert.match(page.url(), /priority=p1/);

  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.locator('[data-open-task="task-child"]').waitFor();
  assert.doesNotMatch(page.url(), /q=|priority=/);
  assert.deepEqual(pageErrors, []);
});

test("kanban items render as distinct physical card surfaces", async t => {
  const { page, pageErrors } = await startWorkspace(t);

  const workspaceCard = page.locator(".workspace-flow-card").first();
  const workspaceAppearance = await workspaceCard.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, shadow: style.boxShadow, radius: parseFloat(style.borderRadius) };
  });
  assert.notEqual(workspaceAppearance.shadow, "none");
  assert.ok(workspaceAppearance.radius >= 8);

  assert.deepEqual(pageErrors, []);
});

test("right-clicking a card offers a fast confirmed delete action", async t => {
  const { page, state, pageErrors } = await startWorkspace(t, { width: 1024, height: 720 });
  const card = page.locator('[data-task="task-parent"]');

  await card.click({ button: "right" });
  let menu = page.getByRole("menu", { name: "Actions for Publish task-first agents video" });
  await menu.waitFor();
  const bounds = await menu.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.y >= 0);
  assert.ok(bounds.x + bounds.width <= 1024 && bounds.y + bounds.height <= 720);

  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  assert.equal(await card.locator("[data-open-task]").evaluate(element => element === document.activeElement), true);

  await card.click({ button: "right" });
  menu = page.getByRole("menu", { name: "Actions for Publish task-first agents video" });
  await page.getByRole("heading", { name: "Board", exact: true }).click();
  await menu.waitFor({ state: "detached" });

  await card.click({ button: "right" });
  menu = page.getByRole("menu", { name: "Actions for Publish task-first agents video" });
  page.once("dialog", async dialog => {
    assert.equal(dialog.message(), "Delete “Publish task-first agents video” and its subtasks?");
    await dialog.accept();
  });
  await menu.getByRole("menuitem", { name: "Delete task" }).click();
  await card.waitFor({ state: "detached" });

  assert.equal(state.tasks.some(task => task.id === "task-parent"), false);
  assert.equal(state.subtasks.some(task => task.parentTaskId === "task-parent"), false);
  assert.ok(state.requests.includes("DELETE /api/v1/tasks/task-parent"));
  assert.deepEqual(pageErrors, []);
});

test("a delayed context-menu delete removes children loaded by newer navigation", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);
  await page.goto(`${origin}/app/lists/list-youtube`);
  const parent = page.locator('[data-task="task-parent"]');
  await parent.waitFor();
  assert.equal(await page.locator('[data-task="task-child"]').count(), 0);

  state.delayNextDelete = true;
  await parent.click({ button: "right" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await waitFor(() => typeof state.releaseDelete === "function");

  await navigateApp(page, "/app/tasks");
  await page.getByRole("heading", { name: "Board", exact: true }).waitFor();
  await page.locator('[data-task="task-child"]').waitFor();
  state.releaseDelete();
  await page.locator('[data-task="task-child"]').waitFor({ state: "detached" });

  assert.equal(await page.locator('[data-task="task-parent"]').count(), 0);
  assert.equal(state.tasks.some(task => task.id === "task-parent"), false);
  assert.equal(state.subtasks.some(task => task.parentTaskId === "task-parent"), false);
  assert.deepEqual(pageErrors, []);
});

test("a context-menu delete invalidates a stale navigation response", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);
  await page.goto(`${origin}/app/lists/list-youtube`);
  const parent = page.locator('[data-task="task-parent"]');
  await parent.waitFor();

  state.delayNextDelete = true;
  await parent.click({ button: "right" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await waitFor(() => typeof state.releaseDelete === "function");

  state.delayNextWorkspaceTasks = true;
  await page.getByRole("link", { name: "Board", exact: true }).click();
  await waitFor(() => typeof state.releaseWorkspaceTasks === "function");
  const taskRequestsBeforeDelete = state.requests.filter(request => request.startsWith("GET /api/v1/tasks?")).length;
  const boardRequestsBeforeDelete = state.requests.filter(request => request === "GET /api/v1/boards").length;
  state.releaseDelete();
  await waitFor(() => state.requests.filter(request => request === "GET /api/v1/boards").length > boardRequestsBeforeDelete);
  state.releaseWorkspaceTasks();
  await waitFor(() => state.delayedWorkspaceTasksCompleted);
  await waitFor(() => state.requests.filter(request => request.startsWith("GET /api/v1/tasks?")).length > taskRequestsBeforeDelete);
  await page.getByRole("heading", { name: "Board", exact: true }).waitFor();
  await page.waitForTimeout(50);

  assert.equal(await page.locator('[data-task="task-parent"]').count(), 0);
  assert.equal(await page.locator('[data-task="task-child"]').count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("agent work tasks expose the same context-menu delete action", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);
  await page.goto(`${origin}/app/agents/agent-research/work`);
  await page.getByRole("heading", { name: "All work", exact: true }).waitFor();
  const parent = page.locator('.agent-work-item[data-task="task-parent"]');

  await parent.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Actions for Publish task-first agents video" });
  page.once("dialog", dialog => dialog.accept());
  await menu.getByRole("menuitem", { name: "Delete task" }).click();
  await page.getByText("No assigned work.", { exact: true }).waitFor();

  assert.equal(state.tasks.some(task => task.id === "task-parent"), false);
  assert.equal(state.subtasks.some(task => task.parentTaskId === "task-parent"), false);
  assert.ok(state.requests.includes("DELETE /api/v1/tasks/task-parent"));
  assert.deepEqual(pageErrors, []);
});

test("an agent context-menu delete refreshes totals for hidden descendants", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);
  state.hideSubtasksFromAgentOverview = true;
  await page.goto(`${origin}/app/agents/agent-research`);
  await page.getByRole("heading", { name: "Working now", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /Research examples/ }).count(), 0);
  assert.equal(await page.locator(".state-group-done header > span").textContent(), "1");
  assert.equal(await page.locator(".agent-view-all").count(), 1);
  const detailRequestsBeforeDelete = state.requests.filter(request => request === "GET /api/v1/agents/agent-research").length;

  const parent = page.locator('.agent-work-item[data-task="task-parent"]');
  await parent.click({ button: "right" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await waitFor(() => state.requests.filter(request => request === "GET /api/v1/agents/agent-research").length > detailRequestsBeforeDelete);
  await page.getByRole("heading", { name: "No work assigned", exact: true }).waitFor();

  assert.equal(await page.locator(".agent-work-item").count(), 0);
  assert.equal(await page.locator(".agent-view-all").count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("a delayed context-menu delete preserves a newer unrelated card detail", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);
  const parent = page.locator('[data-task="task-parent"]');
  state.delayNextDelete = true;
  await parent.click({ button: "right" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await waitFor(() => typeof state.releaseDelete === "function");

  await page.locator('[data-open-task="task-inbox"]').click();
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Newest unrelated draft");
  state.releaseDelete();
  await page.getByRole("region", { name: "Task detail" }).waitFor();
  await page.waitForTimeout(50);

  assert.equal(await title.inputValue(), "Newest unrelated draft");
  assert.equal(await title.evaluate(element => element === document.activeElement), true);
  assert.equal(state.tasks.some(task => task.id === "task-parent"), false);
  assert.deepEqual(pageErrors, []);
});

test("a failed post-delete refresh preserves a newer unrelated card draft", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);
  const parent = page.locator('[data-task="task-parent"]');
  state.delayNextDelete = true;
  await parent.click({ button: "right" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await waitFor(() => typeof state.releaseDelete === "function");

  await page.locator('[data-open-task="task-inbox"]').click();
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Draft survives failed refresh");
  state.failNextWorkspaceTasks = true;
  state.releaseDelete();
  await page.getByText("The card was deleted, but this view couldn’t be refreshed: Could not refresh tasks", { exact: true }).waitFor();

  assert.equal(await title.inputValue(), "Draft survives failed refresh");
  assert.equal(await title.evaluate(element => element === document.activeElement), true);
  assert.equal(state.tasks.some(task => task.id === "task-parent"), false);
  assert.deepEqual(pageErrors, []);
});

test("a context-delete refresh preserves a detail opened and edited while it loads", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);
  const parent = page.locator('[data-task="task-parent"]');
  state.delayNextDelete = true;
  await parent.click({ button: "right" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await waitFor(() => typeof state.releaseDelete === "function");

  state.delayNextWorkspaceTasks = true;
  state.releaseDelete();
  await waitFor(() => typeof state.releaseWorkspaceTasks === "function");
  await page.locator('[data-open-task="task-inbox"]').click();
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Edited while delete refresh loads");
  state.releaseWorkspaceTasks();
  await waitFor(() => state.delayedWorkspaceTasksCompleted);
  await page.waitForTimeout(50);

  assert.equal(await title.inputValue(), "Edited while delete refresh loads");
  assert.equal(await title.evaluate(element => element === document.activeElement), true);
  assert.equal(state.tasks.some(task => task.id === "task-parent"), false);
  assert.deepEqual(pageErrors, []);
});

test("a failed overview refresh keeps the locally deleted card removed", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);
  const parent = page.locator('[data-task="task-parent"]');
  await parent.click({ button: "right" });
  page.once("dialog", dialog => dialog.accept());
  state.failNextWorkspaceTasks = true;
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await page.getByText("The card was deleted, but this view couldn’t be refreshed: Could not refresh tasks", { exact: true }).waitFor();

  assert.equal(await page.getByRole("heading", { name: "Board", exact: true }).count(), 1);
  assert.equal(await page.locator('[data-task="task-parent"]').count(), 0);
  assert.equal(await page.locator('[data-task="task-inbox"]').count(), 1);
  assert.equal(state.tasks.some(task => task.id === "task-parent"), false);
  assert.deepEqual(pageErrors, []);
});

test("deleting a child from its context menu keeps the parent detail open", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);
  await page.locator('[data-open-task="task-parent"]').first().click();
  await page.getByRole("region", { name: "Task detail" }).waitFor();
  const child = page.locator('.workspace-subtask-row[data-task="task-child"]');

  await child.click({ button: "right" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await waitFor(() => !state.subtasks.some(task => task.id === "task-child"));
  await page.locator('.workspace-subtask-row[data-task="task-child"]').waitFor({ state: "detached" });

  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Publish task-first agents video");
  assert.equal(await page.locator('.workspace-subtask-row[data-task="task-child"]').count(), 0);
  assert.equal(state.subtasks.some(task => task.id === "task-child"), false);
  assert.deepEqual(pageErrors, []);
});

test("a failed agent context-menu delete reports the error in place", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);
  await page.goto(`${origin}/app/agents/agent-research/work`);
  const parent = page.locator('.agent-work-item[data-task="task-parent"]');
  const error = "Couldn’t delete “Publish task-first agents video”: Could not delete task";
  state.failNextDelete = true;

  await parent.click({ button: "right" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await page.getByText(error, { exact: true }).waitFor();

  assert.equal(await parent.count(), 1);
  assert.equal(state.tasks.some(task => task.id === "task-parent"), true);

  await parent.click({ button: "right" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await parent.waitFor({ state: "detached" });

  assert.equal(await page.getByText(error, { exact: true }).count(), 0);
  assert.equal(state.tasks.some(task => task.id === "task-parent"), false);
  assert.deepEqual(pageErrors, []);
});

test("a delayed context-menu delete failure preserves a newer card draft", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);
  state.delayNextDelete = true;
  state.failNextDelete = true;

  await page.locator('[data-task="task-parent"]').click({ button: "right" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await waitFor(() => typeof state.releaseDelete === "function");
  await page.locator('[data-open-task="task-inbox"]').click();
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Unsaved draft after rejected context delete");

  state.releaseDelete();
  await page.locator(".detail-error").filter({ hasText: "Couldn’t delete “Publish task-first agents video”: Could not delete task" }).waitFor();

  assert.equal(await title.inputValue(), "Unsaved draft after rejected context delete");
  assert.equal(await title.evaluate(element => element === document.activeElement), true);
  assert.equal(state.tasks.some(task => task.id === "task-parent"), true);
  assert.deepEqual(pageErrors, []);
});

test("a delayed agent context-menu delete failure preserves settings and reports in place", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);
  await page.goto(`${origin}/app/agents/agent-research/work`);
  state.delayNextDelete = true;
  state.failNextDelete = true;

  await page.locator('.agent-work-item[data-task="task-parent"]').click({ button: "right" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await waitFor(() => typeof state.releaseDelete === "function");
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  const purpose = page.locator("#agent-settings-purpose");
  await purpose.fill("Unsaved purpose after rejected context delete");

  state.releaseDelete();
  await page.getByRole("alert").filter({ hasText: "Couldn’t delete “Publish task-first agents video”: Could not delete task" }).waitFor();

  assert.equal(await purpose.inputValue(), "Unsaved purpose after rejected context delete");
  assert.equal(await purpose.evaluate(element => element === document.activeElement), true);
  assert.equal(state.tasks.some(task => task.id === "task-parent"), true);
  assert.deepEqual(pageErrors, []);
});

test("a delayed context-menu delete failure preserves a one-time agent credential", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);
  state.delayNextDelete = true;
  state.failNextDelete = true;

  await page.locator('[data-task="task-parent"]').click({ button: "right" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await waitFor(() => typeof state.releaseDelete === "function");
  await page.locator("#agents-nav").click();
  await page.getByRole("link", { name: "New agent", exact: true }).click();
  await page.locator("#agent-name").fill("New research agent");
  await page.locator("#agent-purpose").fill("Keep this one-time credential visible");
  await page.getByRole("button", { name: "Create agent", exact: true }).click();
  await page.getByRole("heading", { name: "Connect your agent", exact: true }).waitFor();

  const credential = page.locator("#agent-credential");
  const secret = await credential.textContent();
  await credential.focus();
  state.releaseDelete();
  await page.locator(".agents-context-error").filter({ hasText: "Couldn’t delete “Publish task-first agents video”: Could not delete task" }).waitFor();

  assert.equal(await credential.textContent(), secret);
  assert.equal(await credential.evaluate(element => element === document.activeElement), true);
  assert.equal(await page.getByRole("heading", { name: "Connect your agent", exact: true }).count(), 1);
  assert.equal(state.tasks.some(task => task.id === "task-parent"), true);
  assert.deepEqual(pageErrors, []);
});

test("an unauthorized agent context-menu delete clears assigned work", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);
  await page.goto(`${origin}/app/agents/agent-research/work`);
  state.unauthorizeNextDelete = true;

  await page.locator('.agent-work-item[data-task="task-parent"]').click({ button: "right" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await page.getByRole("heading", { name: "Your session has expired.", exact: true }).waitFor();

  assert.equal(await page.getByText("No agent or assigned-work data is being shown. Sign in again to continue.", { exact: true }).count(), 1);
  assert.equal(await page.getByText("Publish task-first agents video", { exact: true }).count(), 0);
  assert.equal(state.tasks.some(task => task.id === "task-parent"), true);
  assert.deepEqual(pageErrors, []);
});

test("an unauthorized post-delete agent refresh clears assigned work", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);
  await page.goto(`${origin}/app/agents/agent-research/work`);
  const parent = page.locator('.agent-work-item[data-task="task-parent"]');
  await parent.waitFor();
  state.unauthorizeNextAgentDetail = true;

  await parent.click({ button: "right" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await page.getByRole("heading", { name: "Your session has expired.", exact: true }).waitFor();

  assert.equal(await page.getByText("No agent or assigned-work data is being shown. Sign in again to continue.", { exact: true }).count(), 1);
  assert.equal(await page.getByText("Research examples", { exact: true }).count(), 0);
  assert.equal(state.tasks.some(task => task.id === "task-parent"), false);
  assert.deepEqual(pageErrors, []);
});

test("a delayed unauthorized agent refresh outranks a faster list failure", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);
  await page.goto(`${origin}/app/agents/agent-research/work`);
  const parent = page.locator('.agent-work-item[data-task="task-parent"]');
  await parent.waitFor();
  state.failNextLists = true;
  state.delayNextAgentDetail = true;
  state.unauthorizeNextAgentDetail = true;

  await parent.click({ button: "right" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await waitFor(() => typeof state.releaseAgentDetail === "function");
  assert.equal(await page.getByRole("heading", { name: "Your session has expired.", exact: true }).count(), 0);

  state.releaseAgentDetail();
  await page.getByRole("heading", { name: "Your session has expired.", exact: true }).waitFor();

  assert.equal(await page.getByText("No agent or assigned-work data is being shown. Sign in again to continue.", { exact: true }).count(), 1);
  assert.equal(await page.getByText("Could not refresh lists", { exact: true }).count(), 0);
  assert.equal(state.tasks.some(task => task.id === "task-parent"), false);
  assert.deepEqual(pageErrors, []);
});

test("a delayed context-menu delete preserves an unrelated settings draft", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);
  state.delayNextDelete = true;

  await page.locator('[data-task="task-parent"]').click({ button: "right" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await waitFor(() => typeof state.releaseDelete === "function");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("heading", { name: "Profile", exact: true }).waitFor();

  const displayName = page.locator("#profile-display-name");
  await displayName.fill("Unsaved settings draft during context delete");
  const listRequests = state.requests.filter(request => request === "GET /api/v1/lists").length;
  state.releaseDelete();
  await waitFor(() => state.requests.filter(request => request === "GET /api/v1/lists").length > listRequests);
  await waitFor(() => state.tasks.some(task => task.id === "task-parent") === false);

  assert.equal(await displayName.inputValue(), "Unsaved settings draft during context delete");
  assert.equal(await displayName.evaluate(element => element === document.activeElement), true);
  assert.equal(new URL(page.url()).pathname, "/app/settings/profile");
  assert.deepEqual(pageErrors, []);
});

test("a delayed context-menu delete failure preserves and reports beside a settings draft", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);
  state.delayNextDelete = true;
  state.failNextDelete = true;

  await page.locator('[data-task="task-parent"]').click({ button: "right" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await waitFor(() => typeof state.releaseDelete === "function");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("heading", { name: "Profile", exact: true }).waitFor();

  const displayName = page.locator("#profile-display-name");
  await displayName.fill("Unsaved settings draft after rejected delete");
  state.releaseDelete();
  await page.getByRole("alert").filter({ hasText: "Couldn’t delete “Publish task-first agents video”: Could not delete task" }).waitFor();

  assert.equal(await displayName.inputValue(), "Unsaved settings draft after rejected delete");
  assert.equal(await displayName.evaluate(element => element === document.activeElement), true);
  assert.equal(state.tasks.some(task => task.id === "task-parent"), true);
  assert.deepEqual(pageErrors, []);
});

test("a delayed context-menu delete refreshes the mounted agent directory", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);
  state.dynamicAgentCounts = true;
  state.delayNextDelete = true;

  await page.locator('[data-task="task-parent"]').click({ button: "right" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete task" }).click();
  await waitFor(() => typeof state.releaseDelete === "function");
  await page.locator("#agents-nav").click();

  const researchAgent = page.locator(".agent-directory-row").filter({ hasText: "Research agent" });
  await researchAgent.getByText("1 working task", { exact: true }).waitFor();
  state.releaseDelete();
  await researchAgent.getByText("No open work assigned", { exact: true }).waitFor();

  assert.equal(await researchAgent.getByText("1 working task", { exact: true }).count(), 0);
  assert.equal(state.tasks.some(task => task.id === "task-parent"), false);
  assert.deepEqual(pageErrors, []);
});

test("a list is renamed from its own view and created and deleted from navigation", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/lists/list-youtube`);
  const listName = page.getByLabel("List name", { exact: true });
  await listName.waitFor();
  assert.equal(await listName.inputValue(), "YouTube");

  state.failNextListRename = true;
  await listName.fill("Failed rename");
  await listName.press("Tab");
  await page.getByRole("alert").filter({ hasText: "Could not rename list" }).waitFor();
  assert.equal(await page.getByLabel("List name", { exact: true }).inputValue(), "YouTube");

  await page.getByLabel("List name", { exact: true }).fill("Content");
  await page.getByLabel("List name", { exact: true }).press("Tab");
  await waitFor(() => state.lists.find(list => list.id === "list-youtube")?.name === "Content");
  assert.equal(new URL(page.url()).pathname, "/app/lists/list-youtube");

  await page.getByRole("button", { name: "New list", exact: true }).click();
  const createDialog = page.getByRole("dialog", { name: "New list", exact: true });
  await createDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "New list", exact: true }).click();
  assert.equal(await createDialog.getByLabel("Name", { exact: true }).getAttribute("maxlength"), "100");
  await createDialog.getByLabel("Name", { exact: true }).fill("Planning");
  state.failNextListCreate = true;
  await createDialog.getByRole("button", { name: "Create list", exact: true }).click();
  await createDialog.getByRole("alert").filter({ hasText: "Could not create list" }).waitFor();
  assert.equal(await createDialog.getByLabel("Name", { exact: true }).inputValue(), "Planning");
  await createDialog.getByRole("button", { name: "Create list", exact: true }).click();
  await page.getByRole("link", { name: "Planning", exact: true }).waitFor();
  assert.equal(state.createdLists.length, 1);

  const planning = state.lists.find(list => list.name === "Planning");
  await page.goto(`${origin}/app/lists/${planning.id}`);
  await page.getByRole("button", { name: "Delete list", exact: true }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete Planning?", exact: true });
  assert.equal(await deleteDialog.getByText("Tasks in this list will also be permanently deleted. This cannot be undone.", { exact: true }).isVisible(), true);
  await deleteDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Delete list", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete Planning?", exact: true }).getByRole("button", { name: "Delete list", exact: true }).click();
  await page.getByRole("link", { name: "Planning", exact: true }).waitFor({ state: "detached" });
  assert.equal(state.lists.some(list => list.name === "Planning"), false);
  assert.deepEqual(pageErrors, []);
});

test("board settings are removed and legacy links return to the board", async t => {
  const { page, origin, pageErrors } = await startWorkspace(t);

  assert.equal(await page.getByRole("button", { name: /Board settings for/ }).count(), 0);
  await page.goto(`${origin}/app/tasks`);
  await page.getByRole("heading", { name: "Board", exact: true }).waitFor();

  assert.equal(new URL(page.url()).pathname, "/app/tasks");
  assert.equal(await page.getByText("Board settings", { exact: true }).count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("a board can be created from settings, where board storage now lives", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/settings/boards`);
  await page.getByRole("heading", { name: "Boards", exact: true }).waitFor();
  state.delayNextBoardCreate = true;
  await page.evaluate(() => {
    const button = document.querySelector("#new-board");
    button.click();
    button.click();
  });
  await waitFor(() => typeof state.releaseBoardCreate === "function");
  assert.equal(state.requests.filter(request => request === "POST /api/v1/boards").length, 1);
  assert.equal(await page.getByRole("button", { name: "New board", exact: true }).isDisabled(), true);
  state.releaseBoardCreate();
  await waitFor(() => state.createdBoards.length === 1);
  assert.deepEqual(pageErrors, []);
});

test("desktop navigation collapses with the keyboard and stays collapsed across routes", async t => {
  const { page, pageErrors } = await startWorkspace(t);
  const sidebar = page.locator("#primary-navigation");
  const main = page.locator(".workspace-main");
  const expandedSidebarWidth = (await sidebar.boundingBox()).width;
  const initialMainWidth = (await main.boundingBox()).width;
  const hideNavigation = page.getByRole("button", { name: "Hide navigation" });

  assert.equal(await hideNavigation.getAttribute("aria-expanded"), "true");
  await hideNavigation.focus();
  await page.keyboard.press("Enter");
  const showNavigation = page.getByRole("button", { name: "Show navigation" });
  await showNavigation.waitFor();
  await page.waitForTimeout(350);
  const collapsedMetrics = await sidebar.evaluate(element => ({
    classes: element.className,
    width: element.getBoundingClientRect().width,
    computedWidth: getComputedStyle(element).width,
    flexBasis: getComputedStyle(element).flexBasis,
    paddingLeft: getComputedStyle(element).paddingLeft,
    paddingRight: getComputedStyle(element).paddingRight,
  }));

  assert.ok(expandedSidebarWidth >= 220, `expanded sidebar width=${expandedSidebarWidth}`);
  assert.ok(collapsedMetrics.width < 1, JSON.stringify(collapsedMetrics));
  assert.ok((await main.boundingBox()).width >= initialMainWidth + 220);
  assert.equal(await showNavigation.getAttribute("aria-expanded"), "false");
  assert.equal(await sidebar.getAttribute("inert"), "");
  assert.equal(await sidebar.getAttribute("aria-hidden"), "true");
  const collapsedToggleBounds = await showNavigation.boundingBox();
  const workspaceHeadingBounds = await page.getByRole("heading", { name: "Board", exact: true }).boundingBox();
  assert.ok(collapsedToggleBounds.x + collapsedToggleBounds.width < workspaceHeadingBounds.x,
    `toggle=${JSON.stringify(collapsedToggleBounds)} heading=${JSON.stringify(workspaceHeadingBounds)}`);

  await navigateApp(page, "/app/inbox");
  await page.getByRole("heading", { name: "Inbox", exact: true, level: 1 }).waitFor();
  const inboxShowNavigation = page.getByRole("button", { name: "Show navigation" });
  assert.equal(await inboxShowNavigation.getAttribute("aria-expanded"), "false");
  // A fully collapsed sidebar has no box at all, which is stricter than zero width.
  assert.ok(((await sidebar.boundingBox())?.width ?? 0) < 1);
  const inboxToggleBounds = await inboxShowNavigation.boundingBox();
  const inboxHeadingBounds = await page.getByRole("heading", { name: "Inbox", exact: true, level: 1 }).boundingBox();
  assert.ok(inboxToggleBounds.x + inboxToggleBounds.width < inboxHeadingBounds.x,
    `toggle=${JSON.stringify(inboxToggleBounds)} heading=${JSON.stringify(inboxHeadingBounds)}`);

  await navigateApp(page, "/app/agents");
  await page.getByRole("heading", { name: "Agents", exact: true, level: 1 }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Show navigation" }).getAttribute("aria-expanded"), "false");

  await navigateApp(page, "/app/settings/profile");
  await page.getByRole("heading", { name: "Profile", exact: true, level: 2 }).waitFor();
  const settingsShowNavigation = page.getByRole("button", { name: "Show navigation" });
  assert.equal(await settingsShowNavigation.getAttribute("aria-expanded"), "false");
  const darkToggleStyle = await settingsShowNavigation.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  await page.locator(".settings-page").evaluate(element => element.classList.replace("theme-dark", "theme-light"));
  const lightToggleStyle = await settingsShowNavigation.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  assert.notDeepEqual(lightToggleStyle, darkToggleStyle);
  assert.notEqual(lightToggleStyle.color, "rgba(0, 0, 0, 0)");
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.deepEqual(await page.locator("#primary-navigation, #desktop-sidebar-toggle").evaluateAll(elements => elements.map(element => getComputedStyle(element).transitionDuration)), ["0s", "0s"]);
  await settingsShowNavigation.click();
  await page.getByRole("button", { name: "Hide navigation" }).waitFor();
  await page.waitForFunction(() => document.querySelector("#primary-navigation").getBoundingClientRect().width >= 220);
  assert.equal(await sidebar.getAttribute("inert"), null);
  assert.equal(await sidebar.getAttribute("aria-hidden"), "false");
  assert.deepEqual(pageErrors, []);
});

test("mobile navigation keeps its existing closed dropdown behaviour", async t => {
  const { page, pageErrors } = await startWorkspace(t, { width: 390, height: 844 });
  const sidebar = page.getByRole("complementary", { name: "Primary navigation" });
  const content = page.locator("#sidebar-content");
  const openNavigation = page.getByRole("button", { name: "Open navigation" });

  assert.equal(await page.getByRole("button", { name: "Hide navigation" }).count(), 0);
  assert.equal(await openNavigation.getAttribute("aria-expanded"), "false");
  assert.equal(await content.isVisible(), false);
  assert.equal(await sidebar.getAttribute("inert"), null);
  await openNavigation.focus();
  await page.keyboard.press("Enter");
  const closeNavigation = page.getByRole("button", { name: "Close navigation" });
  await closeNavigation.waitFor();
  assert.equal(await closeNavigation.getAttribute("aria-expanded"), "true");
  assert.equal(await content.isVisible(), true);
  await closeNavigation.click();
  assert.equal(await content.isVisible(), false);
  assert.deepEqual(pageErrors, []);
});

test("a delayed board creation cannot override newer navigation", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/settings/boards`);
  await page.getByRole("heading", { name: "Boards", exact: true }).waitFor();
  state.delayNextBoardCreate = true;
  await page.getByRole("button", { name: "New board", exact: true }).click();
  await waitFor(() => typeof state.releaseBoardCreate === "function");
  await navigateApp(page, "/app/lists/list-youtube");
  await listTitle(page, "YouTube").waitFor();
  state.releaseBoardCreate();
  await waitFor(() => state.createdBoards.length === 1);
  await page.waitForTimeout(50);

  assert.equal(new URL(page.url()).pathname, "/app/lists/list-youtube");
  assert.deepEqual(pageErrors, []);
});

test("board deletion uses a recoverable designed dialog in settings", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/settings/boards`);
  await page.getByRole("heading", { name: "Boards", exact: true }).waitFor();
  const protectedDelete = page.getByRole("button", { name: "Delete Workspace", exact: true });
  assert.equal(await protectedDelete.isDisabled(), true);
  assert.equal(await protectedDelete.getAttribute("title"), "This board holds your only Inbox, so it cannot be deleted");
  state.lists.push({ id: "list-other-inbox", boardId: "board-two", boardName: "Other", name: "Other Inbox", goal: "", isInbox: true, openCount: 0 });
  await page.reload();
  await page.getByRole("heading", { name: "Boards", exact: true }).waitFor();
  assert.equal(await protectedDelete.isEnabled(), true);

  const deleteOther = page.getByRole("button", { name: "Delete Other", exact: true });
  await deleteOther.click();
  let dialog = page.getByRole("dialog", { name: "Delete Other?", exact: true });
  assert.equal(await dialog.getByText("Every list and task on this board will be permanently deleted. This cannot be undone.", { exact: true }).isVisible(), true);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await deleteOther.evaluate(element => element === document.activeElement), true);

  await deleteOther.click();
  state.failNextBoardDelete = true;
  dialog = page.getByRole("dialog", { name: "Delete Other?", exact: true });
  await dialog.getByRole("button", { name: "Delete board", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "Could not delete board" }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "Delete board", exact: true }).evaluate(element => element === document.activeElement), true);

  await dialog.getByRole("button", { name: "Delete board", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(state.deletedBoards, ["board-two"]);
  assert.equal(await protectedDelete.isDisabled(), true);
  assert.deepEqual(pageErrors, []);
});
test("board deletion refreshes assigned work counts on the agent directory", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  state.dynamicAgentCounts = true;
  state.lists.push({ id: "list-other-work", boardId: "board-two", boardName: "Other", name: "Other work", goal: "", isInbox: false, openCount: 1 });
  state.tasks.push({
    id: "task-other-agent", boardId: "board-two", bucketId: "list-other-work", listName: "Other work",
    title: "Research the other board", description: "", scheduledDate: "", kind: "action",
    status: "working", priority: "", assigneeAgentId: "agent-research", assigneeAgentName: "Research agent",
  });
  await page.goto(`${origin}/app/agents`);
  await page.getByRole("heading", { name: "Agents", level: 1, exact: true }).waitFor();
  const researchAgent = page.locator(".agent-directory-row").filter({ hasText: "Research agent" });
  await researchAgent.getByText("2 working tasks", { exact: true }).waitFor();

  await page.goto(`${origin}/app/settings/boards`);
  await page.getByRole("heading", { name: "Boards", exact: true }).waitFor();
  await page.getByRole("button", { name: "Delete Other", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete Other?", exact: true });
  await dialog.getByRole("button", { name: "Delete board", exact: true }).click();
  await dialog.waitFor({ state: "detached" });

  await page.goto(`${origin}/app/agents`);
  await page.getByRole("heading", { name: "Agents", level: 1, exact: true }).waitFor();
  await researchAgent.getByText("1 working task", { exact: true }).waitFor();
  assert.equal(state.tasks.some(task => task.id === "task-other-agent"), false);
  assert.equal(await researchAgent.getByText("2 working tasks", { exact: true }).count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("an idle agent detail stays quiet and uses a consistent color identity", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  state.agents[0].purpose = "";
  for (const task of [...state.tasks, ...state.subtasks]) {
    if (task.assigneeAgentId === "agent-research") {
      task.assigneeAgentId = "";
      task.assigneeAgentName = "";
    }
  }

  await page.goto(`${origin}/app/agents/agent-research`);
  await page.getByRole("heading", { name: "No work assigned", exact: true }).waitFor();

  assert.equal(await page.locator(".agent-overview-empty").count(), 1);
  for (const heading of ["Working now", "Ready", "Review", "Recently completed"]) {
    assert.equal(await page.getByRole("heading", { name: heading, exact: true }).count(), 0, heading);
  }
  assert.equal(await page.getByText("No purpose added", { exact: true }).count(), 0);
  assert.equal(await page.getByText(/Last credential use/).count(), 0);

  const detailStyle = await page.locator(".agent-detail-identity .agent-avatar").evaluate(element => {
    const style = getComputedStyle(element);
    return { color: style.color, backgroundImage: style.backgroundImage, borderRadius: style.borderRadius };
  });
  assert.notEqual(detailStyle.color, "rgb(255, 255, 255)");
  assert.match(detailStyle.backgroundImage, /linear-gradient/);
  assert.notEqual(detailStyle.borderRadius, "50%");

  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.getByRole("heading", { name: "No work assigned", exact: true }).isVisible(), true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${viewport.width}px page overflow`);
  }
  // The sidebar no longer lists agents, so the directory is the other place
  // this identity has to match. The viewport loop above ends on a phone, where
  // the sidebar is collapsed, so restore a desktop width first.
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator("#agents-nav").click();
  await page.getByRole("heading", { name: "Agents", exact: true, level: 1 }).waitFor();
  const directoryStyle = await page.locator('[data-agent-link="agent-research"] .agent-avatar').evaluate(element => ({ color: getComputedStyle(element).color }));
  assert.equal(detailStyle.color, directoryStyle.color);
  await page.goBack();
  await page.getByRole("heading", { name: "No work assigned", exact: true }).waitFor();

  // The legacy app shell wraps route-owned main elements in #app; this test
  // scopes accessibility proof to the changed agent surface.
  const scan = await new AxeBuilder({ page })
    .include(".agents-main")
    .disableRules(["landmark-main-is-top-level", "landmark-no-duplicate-main"])
    .analyze();
  assert.deepEqual(scan.violations, []);
  assert.deepEqual(pageErrors, []);
});

test("the board keeps its status columns in one horizontal scroll lane", async t => {
  const { page, origin, pageErrors } = await startWorkspace(t, { width: 720, height: 900 });

  await page.goto(`${origin}/app/tasks`);
  await page.getByRole("heading", { name: "Board", exact: true }).waitFor();
  const scroller = page.locator("#workspace-task-panel");
  const flow = page.locator(".workspace-flow");
  const columns = flow.locator(".workspace-flow-column");
  assert.equal(await columns.count(), 4);
  const [first, second, last] = await Promise.all([
    columns.nth(0).boundingBox(),
    columns.nth(1).boundingBox(),
    columns.nth(3).boundingBox(),
  ]);
  const dimensions = await scroller.evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));

  assert.ok(Math.abs(first.y - second.y) < 2, `columns should share a row: ${first.y} vs ${second.y}`);
  assert.ok(Math.abs(first.y - last.y) < 2, `the final column should not wrap: ${first.y} vs ${last.y}`);
  assert.ok(second.x > first.x, `the second column should be to the right: ${first.x} vs ${second.x}`);
  assert.ok(dimensions.scrollWidth > dimensions.clientWidth, `the board should scroll horizontally: ${JSON.stringify(dimensions)}`);

  await page.getByRole("button", { name: "Open task: Publish task-first agents video", exact: true }).click();
  await page.getByRole("region", { name: "Task detail" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Back to board", exact: true }).isVisible(), true);
  await page.getByRole("button", { name: "Back to board", exact: true }).click();
  const opener = page.getByRole("button", { name: "Open task: Publish task-first agents video", exact: true });
  assert.equal(await opener.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("a delayed list creation cannot repaint while a newer history route loads", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/tasks`);
  await page.getByRole("heading", { name: "Board", exact: true }).waitFor();
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
  assert.equal(state.createdLists.some(list => list.name === "Later list"), true);
  assert.deepEqual(pageErrors, []);
});

test("assigning an existing New task makes it Ready for agent work", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.getByRole("button", { name: "Open task: Write the doc my boss asked for", exact: true }).click();
  await page.getByRole("region", { name: "Task detail" }).waitFor();
  await page.getByLabel("Agent", { exact: true }).selectOption("agent-research");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => state.tasks.find(task => task.id === "task-inbox")?.assigneeAgentId === "agent-research");
  await page.getByRole("region", { name: "Task detail" }).waitFor({ state: "detached" });

  const assigned = state.tasks.find(task => task.id === "task-inbox");
  assert.equal(assigned.status, "queued");
  const readyCard = page.locator('[data-flow-status="new"]').getByText("Write the doc my boss asked for", { exact: true });
  await readyCard.waitFor();
  assert.equal(await readyCard.isVisible(), true);
  assert.deepEqual(pageErrors, []);
});

test("a lost conversation response retries without duplicating the entry", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);
  await page.getByRole("button", { name: "Open task: Publish task-first agents video", exact: true }).click();
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

test("conversation attempts reconcile across task history", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);
  const entryResponse = () => page.waitForResponse(response => response.request().method() === "POST"
    && response.url().endsWith("/api/v1/tasks/task-parent/entries"));

  await page.getByRole("button", { name: "Open task: Publish task-first agents video", exact: true }).click();
  await page.locator("#card-entry-body").fill("Completed while viewing a child");
  state.delayNextEntry = true;
  let response = entryResponse();
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await waitFor(() => typeof state.releaseEntry === "function");
  await page.getByText("Research examples", { exact: true }).click();
  await page.getByRole("button", { name: "Back to parent task", exact: true }).waitFor();
  state.releaseEntry();
  await response;
  await page.goBack();
  await page.getByText("Subtasks", { exact: true }).waitFor();

  assert.equal(await page.locator("#card-entry-body").inputValue(), "");
  assert.equal(await page.locator(".card-entry").filter({ hasText: "Completed while viewing a child" }).count(), 1);

  await page.locator("#card-entry-body").fill("Retry after returning from a child");
  state.delayNextEntry = true;
  state.failNextEntryResponse = true;
  response = entryResponse();
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await waitFor(() => typeof state.releaseEntry === "function");
  await page.getByText("Research examples", { exact: true }).click();
  await page.getByRole("button", { name: "Back to parent task", exact: true }).waitFor();
  state.releaseEntry();
  await response;
  await page.goBack();
  await page.locator(".card-entry-error").filter({ hasText: "Response was lost" }).waitFor();

  assert.equal(await page.locator("#card-entry-body").inputValue(), "Retry after returning from a child");
  const attemptCount = Object.keys(state.entryAttempts).length;
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#card-entry-body")?.value === "");

  assert.equal(Object.keys(state.entryAttempts).length, attemptCount);
  assert.equal(state.entries["task-parent"].filter(entry => entry.body === "Retry after returning from a child").length, 1);
  assert.deepEqual(pageErrors, []);
});

test("an output replay keeps a newer card status", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);
  const task = state.tasks.find(item => item.id === "task-parent");
  await page.getByRole("button", { name: "Open task: Publish task-first agents video", exact: true }).click();
  await page.getByRole("button", { name: "Output", exact: true }).click();
  await page.locator("#card-entry-body").fill("One durable output");
  state.failNextEntryResponse = true;
  await page.getByRole("button", { name: "Add output", exact: true }).click();
  await page.locator(".card-entry-error").filter({ hasText: "Response was lost" }).waitFor();
  Object.assign(task, { status: "done", reviewReason: "" });

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

test("a pending list move updates account settings counts without resetting its draft", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.getByRole("button", { name: "Open task: Publish task-first agents video", exact: true }).click();
  await page.getByLabel("List", { exact: true }).selectOption("list-inbox");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("heading", { name: "Profile", exact: true }).waitFor();

  const displayName = page.locator("#profile-display-name");
  assert.equal(state.lists.find(list => list.id === "list-inbox").openCount, 1);
  await displayName.fill("Unsaved settings draft during list move");

  state.releaseStatus();
  await waitFor(() => state.lists.find(list => list.id === "list-inbox")?.openCount === 2);

  assert.equal(await displayName.inputValue(), "Unsaved settings draft during list move");
  assert.equal(await displayName.evaluate(element => element === document.activeElement), true);
  assert.equal(state.tasks.find(task => task.id === "task-parent").bucketId, "list-inbox");
  assert.equal(state.lists.find(list => list.id === "list-youtube").openCount, 1);
  assert.deepEqual(pageErrors, []);
});

test("a pending list move completes account settings while its first list load is delayed", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.getByRole("button", { name: "Open task: Publish task-first agents video", exact: true }).click();
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
  assert.equal(state.lists.find(list => list.id === "list-inbox").openCount, 2);
  assert.equal(state.lists.find(list => list.id === "list-youtube").openCount, 1);
  assert.equal(await displayName.inputValue(), "Draft after Settings route recovery");
  assert.equal(await displayName.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("global scopes surface matching subtasks with parent context", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  assert.equal(await page.getByRole("button", { name: "Open task: Research examples", exact: true }).count(), 1);
  assert.equal(await page.getByText(/Child of Publish task-first agents video/).count(), 1);
  await page.getByRole("button", { name: "Open task: Research examples", exact: true }).click();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Research examples");
  await page.getByRole("button", { name: "Back to parent task", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#workspace-detail-title")?.value === "Publish task-first agents video");
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Publish task-first agents video");

  const now = new Date();
  const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  Object.assign(state.subtasks[0], { scheduledDate: today, status: "needs_review" });

  await page.goto(`${origin}/app/lists/list-youtube`);
  await listTitle(page, "YouTube").waitFor();
  assert.equal(await page.getByRole("button", { name: "Open task: Research examples", exact: true }).count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("an older workspace response cannot replace the latest route", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  state.delayNextWorkspaceTasks = true;
  await navigateApp(page, "/app/lists/list-youtube");
  await waitFor(() => typeof state.releaseWorkspaceTasks === "function");
  await navigateApp(page, "/app/tasks");
  await page.getByRole("heading", { name: "Board", exact: true }).waitFor();
  state.releaseWorkspaceTasks();
  await page.waitForTimeout(100);

  assert.match(page.url(), /\/app\/tasks$/);
  assert.equal(await page.getByRole("heading", { name: "Board", exact: true }).isVisible(), true);
  assert.equal(await page.getByRole("heading", { name: "Not found.", exact: true }).count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("a list created on a board is immediately available for agent assignment", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.getByRole("button", { name: "New list", exact: true }).click();
  const newListDialog = page.getByRole("dialog", { name: "New list", exact: true });
  await newListDialog.getByLabel("Name", { exact: true }).fill("Launch plan");
  assert.equal(await newListDialog.getByLabel("Board", { exact: true }).count(), 0);
  await newListDialog.getByRole("button", { name: "Create list", exact: true }).click();
  await waitFor(() => state.createdLists.length === 1);
  await page.getByRole("link", { name: "Launch plan", exact: true }).waitFor();

  await page.goto(`${origin}/app/agents/agent-research`);
  await page.getByRole("heading", { name: "Research agent", exact: true }).waitFor();

  await page.getByRole("button", { name: "Assign work", exact: true }).click();

  await page.getByLabel("Board", { exact: true }).selectOption("board-two");
  const list = page.getByLabel("List", { exact: true });
  await list.selectOption(state.createdLists[0].id);
  assert.equal(await list.inputValue(), state.createdLists[0].id);
  assert.equal(await list.locator("option", { hasText: "Launch plan" }).count(), 1);
  await page.getByLabel("Title", { exact: true }).fill("Research launch examples");
  await page.getByRole("button", { name: "Create item", exact: true }).click();
  await page.getByText('"Research launch examples" was assigned to Research agent.', { exact: true }).waitFor();
  assert.equal(state.created.at(-1).bucketId, state.createdLists[0].id);
  assert.equal(state.created.at(-1).status, "queued");
  assert.equal(await page.getByText("Research launch examples", { exact: true }).isVisible(), true);
  assert.deepEqual(pageErrors, []);
});

test("agent work uses the shared inline task detail and returns to the exact work page", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t, { width: 720, height: 900 });

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("heading", { name: "All work", exact: true }).waitFor();
  const parent = page.getByRole("button", { name: /Publish task-first agents video/ });
  await parent.click();

  const detail = page.getByRole("region", { name: "Task detail" });
  await detail.waitFor();
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, "/app/agents/agent-research/work?page=2&task=task-parent");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.locator(".detail-overlay").count(), 0);
  assert.equal(await page.getByText("1 of 1 done", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("Research examples", { exact: true }).isVisible(), true);
  assert.ok((await page.locator(".workspace-detail-main").boundingBox()).width >= 300);

  await page.getByText("Research examples", { exact: true }).click();
  await page.getByRole("button", { name: "Back to parent task", exact: true }).waitFor();
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
  assert.equal(await page.getByRole("region", { name: "Task detail" }).count(), 0);
  state.releaseStatus();
  await page.getByText("Delayed agent task title", { exact: true }).waitFor();
  await waitFor(() => state.requests.filter(request => request === "GET /api/v1/agents/agent-research/work?page=2&pageSize=50").length >= 2);

  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, "/app/agents/agent-research/work?page=2");
  assert.equal(await page.getByRole("region", { name: "Task detail" }).count(), 0);
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

  for (const label of ["Title", "Description", "Status", "List", "Priority", "Agent", "Planned"]) {
    assert.equal(await page.getByLabel(label, { exact: true }).isDisabled(), true, `${label} should be disabled`);
  }
  for (const name of ["Delete task", "Saving…"]) {
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
  await page.getByLabel("Agent", { exact: true }).selectOption("agent-writing");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");

  await page.locator("#agents-nav").click();
  await page.locator('[data-agent-link="agent-writing"]').click();
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
  const description = page.getByLabel("Description", { exact: true });
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

  await navigateApp(page, "/app/tasks");
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

  await page.goto(`${origin}/app/tasks`);
  state.delayNextStatus = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="needs_review"]'));
  await waitFor(() => typeof state.releaseStatus === "function");

  await page.locator("#agents-nav").click();
  await page.locator('[data-agent-link="agent-research"]').click();
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  const brief = page.getByLabel("Description", { exact: true });
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

  await page.goto(`${origin}/app/tasks`);
  state.delayNextStatus = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="needs_review"]'));
  await waitFor(() => typeof state.releaseStatus === "function");

  await page.locator("#agents-nav").click();
  await page.locator('[data-agent-link="agent-research"]').click();
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

  await page.goto(`${origin}/app/tasks`);
  state.delayNextStatus = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="needs_review"]'));
  await waitFor(() => typeof state.releaseStatus === "function");

  await page.locator("#agents-nav").click();
  await page.locator('[data-agent-link="agent-research"]').click();
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await page.getByRole("button", { name: /Research examples/ }).click();
  const brief = page.getByLabel("Description", { exact: true });
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
  const parentBrief = page.getByLabel("Description", { exact: true });
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

  await page.goto(`${origin}/app/tasks`);
  state.delayNextStatus = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="needs_review"]'));
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.locator("#agents-nav").click();
  await page.locator('[data-agent-link="agent-research"]').click();
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await page.getByRole("button", { name: /Research examples/ }).click();

  state.delayNextAgentWork = true;
  state.failNextAgentWork = true;
  state.releaseStatus();
  await waitFor(() => state.patches.length === 1);
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await waitFor(() => typeof state.releaseAgentWork === "function", 10000);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  const brief = page.getByLabel("Description", { exact: true });
  await brief.fill("Live parent draft during failed deferred refresh");

  state.releaseAgentWork();
  await page.locator(".detail-error").filter({ hasText: "The task was updated, but assigned work couldn’t be refreshed: Could not refresh assigned work" }).waitFor();

  assert.equal(await page.getByRole("region", { name: "Task detail" }).count(), 1);
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

  await page.locator("#agents-nav").click();
  await page.locator('[data-agent-link="agent-research"]').click();
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
  await page.locator("#agents-nav").click();
  await page.locator('[data-agent-link="agent-research"]').click();
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await page.getByRole("heading", { name: "All work", exact: true }).waitFor();

  state.failNextAgentWork = true;
  state.delayNextAgentWork = true;
  state.releaseStatus();
  await waitFor(() => typeof state.releaseAgentWork === "function");
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  const brief = page.getByLabel("Description", { exact: true });
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

  await page.goto(`${origin}/app/tasks`);
  state.delayNextStatus = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="needs_review"]'));
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.locator("#agents-nav").click();
  await page.locator('[data-agent-link="agent-research"]').click();
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await page.getByRole("heading", { name: "All work", exact: true }).waitFor();

  state.delayNextAgentWork = true;
  state.releaseStatus();
  await waitFor(() => typeof state.releaseAgentWork === "function");
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  const brief = page.getByLabel("Description", { exact: true });
  await brief.fill("Live Agent Work draft during refresh");
  await brief.focus();

  state.releaseAgentWork();
  await page.waitForFunction(() => document.activeElement?.id === "workspace-detail-description");
  assert.equal(await brief.inputValue(), "Live Agent Work draft during refresh");
  assert.equal(await page.getByRole("region", { name: "Task detail" }).isVisible(), true);
  assert.deepEqual(pageErrors, []);
});

test("a failed Agent Work refresh preserves a task opened while it loads", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/tasks`);
  state.delayNextStatus = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="needs_review"]'));
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.locator("#agents-nav").click();
  await page.locator('[data-agent-link="agent-research"]').click();
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

  await page.goto(`${origin}/app/tasks`);
  state.delayNextStatus = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="needs_review"]'));
  await waitFor(() => typeof state.releaseStatus === "function");

  const reviewLoaded = page.waitForResponse(response => response.request().method() === "GET"
    && response.url().includes("status=needs_review"));
  await navigateApp(page, "/app/tasks?status=needs_review");
  await reviewLoaded;
  await page.getByRole("heading", { name: "Board", exact: true, level: 1 }).waitFor();
  assert.equal(await page.locator('[data-open-task="task-parent"]').count(), 0);

  const reviewRefreshed = page.waitForResponse(response => response.request().method() === "GET"
    && response.url().includes("status=needs_review"));
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

  await page.goto(`${origin}/app/tasks`);
  await page.locator('[data-open-task="task-parent"]').waitFor();
  state.failNextWorkspaceTasks = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="needs_review"]'));

  await page.locator(".status-error").filter({ hasText: "The task was updated, but this view couldn’t be refreshed: Could not refresh tasks" }).waitFor();

  assert.equal(state.tasks.find(task => task.id === "task-parent").status, "needs_review");
  assert.equal(await page.getByText(/Couldn’t save/).count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("an older post-drop refresh failure stays out of a newer workspace route", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/tasks`);
  state.delayNextStatus = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="needs_review"]'));
  await waitFor(() => typeof state.releaseStatus === "function");

  state.delayNextWorkspaceTasks = true;
  state.failNextWorkspaceTasks = true;
  state.releaseStatus();
  await waitFor(() => typeof state.releaseWorkspaceTasks === "function");

  const reviewLoaded = page.waitForResponse(response => response.request().method() === "GET"
    && response.url().includes("/api/v1/tasks?"));
  await navigateApp(page, "/app/tasks");
  await reviewLoaded;
  await page.locator('[data-open-task="task-parent"]').waitFor();

  state.releaseWorkspaceTasks();
  await waitFor(() => state.delayedWorkspaceTasksCompleted);
  await page.waitForTimeout(50);

  assert.equal(new URL(page.url()).pathname, "/app/tasks");
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

  await navigateApp(page, "/app/tasks");
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="needs_review"]'));
  await page.locator("#agents-nav").click();
  await page.locator('[data-agent-link="agent-research"]').click();
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
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, "/app/agents/agent-research/work?page=2&task=task-child");
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
  await page.getByRole("button", { name: "Delete task", exact: true }).click();
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

test("workspace mutations cannot cross into retained agent context", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research`);
  await page.getByRole("heading", { name: "Research agent", exact: true }).waitFor();
  await navigateApp(page, "/app/tasks");
  await page.getByRole("heading", { name: "Board", exact: true }).waitFor();
  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Workspace-origin failure");
  state.delayNextStatus = true;
  state.failNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Back to board" }).click();
  await page.locator("#agents-nav").click();
  await page.locator('[data-agent-link="agent-research"]').click();
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
  await page.getByRole("button", { name: "Delete task", exact: true }).click();
  await waitFor(() => typeof state.releaseDelete === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  state.releaseDelete();
  await page.getByRole("alert").filter({ hasText: "Couldn’t delete “Publish task-first agents video”: Could not delete task" }).waitFor();
  assert.equal(await page.getByText("Publish task-first agents video", { exact: true }).isVisible(), true);
  assert.deepEqual(pageErrors, []);
});

test("post-save refresh failures report that the task was already saved", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.getByRole("button", { name: "Open task: Publish task-first agents video", exact: true }).click();
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

  await page.getByRole("button", { name: "Open task: Write the doc my boss asked for", exact: true }).click();
  state.failNextWorkspaceTasks = true;
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete task", exact: true }).click();

  await page.getByRole("alert").filter({ hasText: "The task was deleted, but this view couldn’t be refreshed: Could not refresh tasks" }).waitFor();
  assert.equal(state.tasks.some(task => task.id === "task-inbox"), false);
  assert.equal(await page.getByText(/Couldn’t delete/).count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("a delayed post-save refresh failure cannot render into a newer route", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.getByRole("button", { name: "Open task: Publish task-first agents video", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Committed before navigation");
  state.delayNextWorkspaceTasks = true;
  state.failNextWorkspaceTasks = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseWorkspaceTasks === "function");

  await navigateApp(page, "/app/lists/list-youtube");
  await listTitle(page, "YouTube").waitFor();
  state.releaseWorkspaceTasks();
  await waitFor(() => state.delayedWorkspaceTasksCompleted);
  await page.waitForTimeout(50);

  assert.equal(new URL(page.url()).pathname, "/app/lists/list-youtube");
  assert.equal(await listTitle(page, "YouTube").isVisible(), true);
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.equal(state.patches.at(-1).title, "Committed before navigation");
  assert.deepEqual(pageErrors, []);
});

test("a delayed subtask refresh failure cannot render into a newer route", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.getByRole("button", { name: "Open task: Publish task-first agents video", exact: true }).click();
  await page.getByLabel("Subtask title", { exact: true }).fill("Committed subtask");
  state.delayNextWorkspaceTasks = true;
  state.failNextWorkspaceTasks = true;
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await waitFor(() => typeof state.releaseWorkspaceTasks === "function");

  await navigateApp(page, "/app/lists/list-youtube");
  await listTitle(page, "YouTube").waitFor();
  state.releaseWorkspaceTasks();
  await waitFor(() => state.delayedWorkspaceTasksCompleted);
  await page.waitForTimeout(50);

  assert.equal(new URL(page.url()).pathname, "/app/lists/list-youtube");
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.equal(state.subtasks.some(task => task.title === "Committed subtask"), true);
  assert.deepEqual(pageErrors, []);
});

test("a current subtask refresh failure releases workspace loading", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.getByRole("button", { name: "Open task: Publish task-first agents video", exact: true }).click();
  await page.getByLabel("Subtask title", { exact: true }).fill("Committed before refresh error");
  state.delayNextWorkspaceTasks = true;
  state.failNextWorkspaceTasks = true;
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await waitFor(() => typeof state.releaseWorkspaceTasks === "function");
  await page.getByLabel("Title", { exact: true }).fill("Live title during failed refresh");
  const brief = page.getByLabel("Description", { exact: true });
  await brief.fill("Live focused brief during failed refresh");
  state.releaseWorkspaceTasks();

  await page.locator(".detail-error").filter({ hasText: "The task was updated, but this view couldn’t be refreshed: Could not refresh tasks" }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Live title during failed refresh");
  assert.equal(await brief.inputValue(), "Live focused brief during failed refresh");
  assert.equal(await brief.evaluate(element => element === document.activeElement), true);
  await page.getByRole("button", { name: "Back to board" }).click();
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
  const childBrief = page.getByLabel("Description", { exact: true });
  await childBrief.fill("Newer child draft during refresh failure");
  state.failNextAgentDetail = true;

  state.releaseStatus();
  await page.locator(".detail-error").filter({ hasText: "The task was updated, but assigned work couldn’t be refreshed: Could not refresh assigned work" }).waitFor();

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

  const warning = page.locator(".detail-error").filter({ hasText: "The task was updated, but assigned work couldn’t be refreshed: Could not refresh assigned work" });
  await warning.waitFor();
  await page.getByLabel("Subtask title", { exact: true }).fill("Refresh recovery subtask");
  state.delayNextSubtask = true;
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await waitFor(() => typeof state.releaseSubtask === "function");
  const parentBrief = page.getByLabel("Description", { exact: true });
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
  const parentBrief = page.getByLabel("Description", { exact: true });
  await parentBrief.fill("Newer parent draft after failed save");

  state.releaseStatus();
  const failure = page.locator(".detail-error").filter({ hasText: "Couldn’t save “Parent save that will fail”: Could not save task" });
  await failure.waitFor();

  await page.getByLabel("Subtask title", { exact: true }).fill("Unrelated successful subtask");
  state.delayNextSubtask = true;
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
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
  await page.getByLabel("Subtask title", { exact: true }).fill("Committed agent subtask");
  state.failNextAgentDetail = true;
  state.delayNextAgentWork = true;
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await waitFor(() => typeof state.releaseAgentWork === "function");
  await page.getByLabel("Description", { exact: true }).fill("Unsaved focused brief");
  state.releaseAgentWork();

  await page.getByRole("alert").filter({ hasText: "The task was updated, but assigned work couldn’t be refreshed: Could not refresh assigned work" }).waitFor();
  assert.equal(await page.getByRole("region", { name: "Task detail" }).count(), 1);
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved parent draft");
  assert.equal(await page.getByLabel("Description", { exact: true }).inputValue(), "Unsaved focused brief");
  assert.equal(await page.getByLabel("Description", { exact: true }).evaluate(element => element === document.activeElement), true);
  assert.equal(state.subtasks.some(task => task.title === "Committed agent subtask"), true);
  assert.deepEqual(pageErrors, []);
});

test("an in-flight successful agent subtask refresh preserves live edits and focus", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Subtask title", { exact: true }).fill("Refresh while editing");
  state.delayNextAgentWork = true;
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await waitFor(() => typeof state.releaseAgentWork === "function");

  await page.getByLabel("Title", { exact: true }).fill("Typed during refresh");
  await page.getByLabel("Description", { exact: true }).fill("Focused draft typed during refresh");
  state.releaseAgentWork();
  await waitFor(() => state.agentWorkRefreshCompleted);
  await page.waitForTimeout(50);

  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Typed during refresh");
  assert.equal(await page.getByLabel("Description", { exact: true }).inputValue(), "Focused draft typed during refresh");
  assert.equal(await page.getByLabel("Description", { exact: true }).evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("background agent subtask creation refreshes list metadata", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Subtask title", { exact: true }).fill("Background count update");
  state.delayNextSubtask = true;
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await waitFor(() => typeof state.releaseSubtask === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("button", { name: /Research examples/ }).click();
  const childBrief = page.getByLabel("Description", { exact: true });
  await childBrief.fill("Live child edit while count refreshes");
  state.releaseSubtask();

  await waitFor(() => state.lists.find(list => list.id === "list-youtube")?.openCount === 3);
  await waitFor(() => state.requests.filter(request => request === "GET /api/v1/lists").length >= 2);
  assert.equal(await childBrief.inputValue(), "Live child edit while count refreshes");
  assert.equal(await childBrief.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("background agent mutations refresh list metadata on the agent directory", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Subtask title", { exact: true }).fill("Directory count update");
  state.delayNextSubtask = true;
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await waitFor(() => typeof state.releaseSubtask === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.locator("#agents-nav").click();
  await page.getByRole("heading", { name: "Agents", exact: true, level: 1 }).waitFor();
  const initialListRequests = state.requests.filter(request => request === "GET /api/v1/lists").length;

  state.releaseSubtask();
  await waitFor(() => state.requests.filter(request => request === "GET /api/v1/lists").length > initialListRequests);
  await waitFor(() => state.lists.find(list => list.id === "list-youtube")?.openCount === 3);

  assert.equal(state.subtasks.some(task => task.title === "Directory count update"), true);
  assert.deepEqual(pageErrors, []);
});

test("background agent mutations refresh list metadata on the new-agent route", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Subtask title", { exact: true }).fill("New-agent count update");
  state.delayNextSubtask = true;
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await waitFor(() => typeof state.releaseSubtask === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.locator("#agents-nav").click();
  await page.getByRole("link", { name: "New agent", exact: true }).click();
  await page.getByRole("heading", { name: "New agent", exact: true }).waitFor();
  const initialListRequests = state.requests.filter(request => request === "GET /api/v1/lists").length;

  state.releaseSubtask();
  await waitFor(() => state.requests.filter(request => request === "GET /api/v1/lists").length > initialListRequests);
  await waitFor(() => state.lists.find(list => list.id === "list-youtube")?.openCount === 3);

  assert.equal(state.subtasks.some(task => task.title === "New-agent count update"), true);
  assert.deepEqual(pageErrors, []);
});

test("background agent mutations refresh counts without resetting settings drafts", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Subtask title", { exact: true }).fill("Settings count update");
  state.delayNextSubtask = true;
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await waitFor(() => typeof state.releaseSubtask === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  const settingsName = page.locator("#agent-settings-name");
  const settingsPurpose = page.locator("#agent-settings-purpose");
  await settingsName.fill("Unsaved settings name");
  await settingsPurpose.fill("Unsaved focused purpose");

  state.releaseSubtask();
  await waitFor(() => state.lists.find(list => list.id === "list-youtube")?.openCount === 3);

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

  await page.goto(`${origin}/app/tasks`);
  state.delayNextStatus = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="new"]'));
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.locator("#agents-nav").click();
  await page.locator('[data-agent-link="agent-research"]').click();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  const purpose = page.locator("#agent-settings-purpose");
  await purpose.fill("Unsaved purpose while parent moves");
  assert.equal(state.lists.find(list => list.id === "list-inbox").openCount, 1);

  Object.assign(state.tasks[0], { bucketId: "list-inbox", listName: "Inbox" });
  state.subtasks.filter(task => task.parentTaskId === "task-parent").forEach(task => Object.assign(task, { bucketId: "list-inbox", listName: "Inbox" }));
  state.lists.find(list => list.id === "list-youtube").openCount = 1;
  state.lists.find(list => list.id === "list-inbox").openCount = 2;
  state.releaseStatus();

  await waitFor(() => state.requests.filter(request => request === "GET /api/v1/lists").length >= 2);
  assert.equal(state.lists.find(list => list.id === "list-youtube").openCount, 1);
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

  await page.goto(`${origin}/app/tasks`);
  state.delayNextStatus = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="new"]'));
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.locator("#agents-nav").click();
  await page.locator('[data-agent-link="agent-research"]').click();

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
  state.releaseStatus();

  await waitFor(() => listRequests >= 2);
  await page.locator("#agent-settings-purpose").waitFor();
  const purpose = page.locator("#agent-settings-purpose");
  await purpose.fill("Draft after agent settings recovery");
  releaseLists();
  await page.waitForTimeout(50);

  assert.equal(new URL(page.url()).pathname, "/app/agents/agent-research/settings");
  assert.equal(state.lists.find(list => list.id === "list-inbox").openCount, 2);
  assert.equal(state.lists.find(list => list.id === "list-youtube").openCount, 1);
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
  await page.locator("#agents-nav").click();
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

test("a background mutation completes the board whose list load it supersedes", async t => {
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
  await navigateApp(page, "/app/tasks");
  await waitFor(() => typeof releaseLists === "function");
  state.releaseStatus();

  await waitFor(() => listRequests >= 2);
  await page.getByRole("heading", { name: "Board", exact: true }).waitFor();
  await page.getByText("Saved while all tasks loads", { exact: true }).waitFor();
  releaseLists();
  await page.waitForTimeout(50);

  assert.equal(new URL(page.url()).pathname, "/app/tasks");
  assert.equal(await page.getByRole("heading", { name: "Board", exact: true }).isVisible(), true);
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
  await page.getByLabel("Subtask title", { exact: true }).fill("Later successful list refresh");
  state.delayNextSubtask = true;
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
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
  await page.getByLabel("Subtask title", { exact: true }).fill("Delayed research add");
  state.delayNextSubtask = true;
  state.failNextSubtask = true;
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await waitFor(() => typeof state.releaseSubtask === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await page.getByRole("heading", { name: "Working now", exact: true }).waitFor();
  state.releaseSubtask();
  await page.getByRole("alert").filter({ hasText: "Couldn’t add subtask “Delayed research add”: Could not add subtask" }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/app/agents/agent-research");
  assert.deepEqual(pageErrors, []);
});

test("a delayed parent delete removes its assigned subtasks from agent work", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  state.delayNextDelete = true;
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete task", exact: true }).click();
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
  await page.getByRole("button", { name: "Delete task", exact: true }).click();
  await waitFor(() => typeof state.releaseDelete === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("button", { name: /Research examples/ }).click();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Research examples");

  state.releaseDelete();
  await page.getByRole("region", { name: "Task detail" }).waitFor({ state: "detached" });
  await page.getByText("No assigned work.", { exact: true }).waitFor();

  assert.equal(state.tasks.some(item => item.id === "task-parent"), false);
  assert.equal(state.subtasks.some(item => item.parentTaskId === "task-parent"), false);
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, "/app/agents/agent-research/work?page=2");
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
  await page.getByRole("button", { name: "Delete task", exact: true }).click();

  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  await page.getByLabel("Subtask title", { exact: true }).fill("Created during parent deletion");
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await page.getByText("Created during parent deletion", { exact: true }).waitFor();
  await page.locator(".workspace-subtask-open").filter({ hasText: "Created during parent deletion" }).click();
  await page.waitForFunction(() => document.querySelector("#workspace-detail-title")?.value === "Created during parent deletion");
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Created during parent deletion");

  state.releaseStatus();
  await page.getByRole("region", { name: "Task detail" }).waitFor({ state: "detached" });
  await page.getByText("No assigned work.", { exact: true }).waitFor();

  assert.equal(state.tasks.some(item => item.id === "task-parent"), false);
  assert.equal(state.subtasks.some(item => item.parentTaskId === "task-parent"), false);
  assert.equal(await page.getByRole("button", { name: "Assign work", exact: true }).evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("direct settings keeps board navigation and can create a board", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/settings/profile`);
  await page.getByRole("heading", { name: "Profile", exact: true }).waitFor();
  await page.getByRole("tab", { name: "Boards", exact: true }).click();
  await page.getByRole("heading", { name: "Boards", exact: true }).waitFor();
  await page.getByRole("button", { name: "New board", exact: true }).click();
  await waitFor(() => state.createdBoards.length === 1);
  assert.deepEqual(pageErrors, []);
});

test("New task captures directly into Inbox and opens a normal task editor", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.getByRole("button", { name: "New task", exact: true }).click();
  const title = page.getByLabel("Title", { exact: true });
  await title.waitFor();
  assert.equal(await title.inputValue(), "Untitled task");
  assert.equal(state.created.length, 1);
  assert.equal(state.created[0].bucketId, "list-inbox");
  assert.equal(state.lists.find(list => list.id === "list-inbox").openCount, 2);

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

test("a lost Inbox capture response retries without creating a duplicate card", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  state.commitNextInboxThenFail = true;
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Connection lost after capture" }).waitFor();
  assert.equal(state.created.length, 1);

  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByRole("region", { name: "Task detail" }).waitFor();

  assert.equal(state.created.length, 1);
  assert.equal(state.inboxRequestKeys.length, 2);
  assert.ok(state.inboxRequestKeys[0]);
  assert.equal(state.inboxRequestKeys[1], state.inboxRequestKeys[0]);
  assert.deepEqual(pageErrors, []);
});

test("New task preserves a successful capture when the workspace refresh fails", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  state.failNextWorkspaceTasks = true;
  await page.getByRole("button", { name: "New task", exact: true }).click();
  const recovery = page.getByRole("alert", { name: "Created task recovery" });
  await recovery.waitFor();

  assert.equal(state.created.length, 1);
  assert.match(await recovery.textContent(), /Task created/);
  assert.equal(await page.getByRole("button", { name: "New task", exact: true }).isDisabled(), true);

  await page.getByRole("button", { name: "Open task", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Untitled task");
  assert.equal(state.created.length, 1);
  assert.deepEqual(pageErrors, []);
});

test("a lost child-card response retries with one idempotency key and no duplicate", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Subtask title", { exact: true }).fill("Verify final copy");
  state.commitNextSubtaskThenFail = true;
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await page.getByText("Response lost after commit", { exact: true }).waitFor();

  assert.equal(state.subtasks.filter(task => task.title === "Verify final copy").length, 1);
  assert.equal(await page.getByLabel("Subtask title", { exact: true }).inputValue(), "Verify final copy");
  assert.equal(state.subtaskRequestKeys.length, 1);
  assert.ok(state.subtaskRequestKeys[0]);

  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await page.locator(".workspace-subtask-list").getByText("Verify final copy", { exact: true }).waitFor();

  assert.equal(state.subtasks.filter(task => task.title === "Verify final copy").length, 1);
  assert.equal(state.subtaskRequestKeys.length, 2);
  assert.equal(state.subtaskRequestKeys[1], state.subtaskRequestKeys[0]);
  assert.deepEqual(pageErrors, []);
});

test("child-card attempts reconcile across task history", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);
  const subtaskResponse = () => page.waitForResponse(response => response.request().method() === "POST"
    && response.url().endsWith("/api/v1/tasks/task-parent/subtasks"));

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Subtask title", { exact: true }).fill("Completed while viewing a child");
  state.delayNextSubtask = true;
  let response = subtaskResponse();
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await waitFor(() => typeof state.releaseSubtask === "function");
  await page.getByText("Research examples", { exact: true }).click();
  await page.getByRole("button", { name: "Back to parent task", exact: true }).waitFor();
  state.releaseSubtask();
  await response;
  await page.goBack();
  await page.getByText("Subtasks", { exact: true }).waitFor();

  assert.equal(await page.getByLabel("Subtask title", { exact: true }).inputValue(), "");
  assert.equal(state.subtasks.filter(task => task.title === "Completed while viewing a child").length, 1);

  await page.getByLabel("Subtask title", { exact: true }).fill("Retry after returning from a child");
  state.delayNextSubtask = true;
  state.commitNextSubtaskThenFail = true;
  response = subtaskResponse();
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await waitFor(() => typeof state.releaseSubtask === "function");
  await page.getByText("Research examples", { exact: true }).click();
  await page.getByRole("button", { name: "Back to parent task", exact: true }).waitFor();
  state.releaseSubtask();
  await response;
  await page.goBack();
  await page.getByText("Response lost after commit", { exact: true }).waitFor();

  assert.equal(await page.getByLabel("Subtask title", { exact: true }).inputValue(), "Retry after returning from a child");
  const failedAttemptKey = state.subtaskRequestKeys.at(-1);
  await page.getByRole("button", { name: "Add subtask", exact: true }).click();
  await page.locator(".workspace-subtask-list").getByText("Retry after returning from a child", { exact: true }).waitFor();

  assert.equal(state.subtaskRequestKeys.at(-1), failedAttemptKey);
  assert.equal(state.subtasks.filter(task => task.title === "Retry after returning from a child").length, 1);
  assert.deepEqual(pageErrors, []);
});

test("task detail coordinates one level of human and agent subtasks through the CLI model", async t => {
  const { page, state } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  const dialog = page.getByRole("region", { name: "Task detail" });
  await dialog.waitFor();
  assert.equal(await page.getByText("Subtasks", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("1 of 1 done", { exact: true }).isVisible(), true);
  assert.equal(await dialog.getByText("Research examples", { exact: true }).isVisible(), true);
  assert.equal(await page.getByLabel("Agent", { exact: true }).inputValue(), "agent-research");
  assert.equal(await page.getByText(/refine with|scout|autopilot/i).count(), 0);
  const bounds = await dialog.boundingBox();
  assert.ok(bounds.width >= 700, `detail width=${bounds.width}`);
  assert.ok(bounds.height >= 940, `detail height=${bounds.height}`);
  assert.ok(bounds.x >= 220, `detail x=${bounds.x}`);
  assert.equal(await page.getByRole("complementary").first().isVisible(), true, "sidebar stays visible");
  assert.equal(await page.locator(".workspace-topbar").count(), 0, "card detail replaces the workspace surface");
  assert.equal(await dialog.locator(".workspace-detail-main").count(), 1);
  assert.equal(parseFloat(await page.locator("#workspace-detail-title").evaluate(element => getComputedStyle(element).fontSize)), 26);

  await page.getByLabel("Title", { exact: true }).fill("Unsaved parent title");
  await page.getByLabel("Description", { exact: true }).fill("Unsaved parent brief");
  await page.getByLabel("Priority", { exact: true }).selectOption("p2");

  assert.equal(await dialog.getByRole("button", { name: /Mark Research examples/ }).count(), 0);
  assert.equal(await dialog.locator('[data-open-task="task-child"] .state-done').getByText("Done", { exact: true }).count(), 1);
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved parent title");
  assert.equal(await page.getByLabel("Description", { exact: true }).inputValue(), "Unsaved parent brief");
  assert.equal(await page.getByLabel("Priority", { exact: true }).inputValue(), "p2");

  await page.getByLabel("Subtask title", { exact: true }).fill("Human final review");
  state.failNextSubtask = true;
  await page.locator("#add-subtask").getByRole("button", { name: "Add subtask", exact: true }).click();
  await page.locator(".workspace-subtask-error").getByText("Could not add subtask", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Subtask title", { exact: true }).inputValue(), "Human final review");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Subtask title");
  await page.locator("#add-subtask").getByRole("button", { name: "Add subtask", exact: true }).click();
  await dialog.getByText("Human final review", { exact: true }).waitFor();
  assert.equal(state.subtasks.length, 2);
  assert.equal(state.subtasks[1].parentTaskId, "task-parent");
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved parent title");
  assert.equal(await page.getByLabel("Description", { exact: true }).inputValue(), "Unsaved parent brief");
  assert.equal(await page.getByLabel("Priority", { exact: true }).inputValue(), "p2");

  await dialog.getByText("Human final review", { exact: true }).click();
  await page.getByRole("button", { name: "Back to parent task", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Subtask title", { exact: true }).count(), 0, "subtasks cannot contain subtasks");
  assert.equal(await page.getByLabel("List", { exact: true }).isDisabled(), true, "subtasks stay in their parent list");
  assert.equal(await page.getByText("Subtasks stay with their parent task.", { exact: true }).isVisible(), true);
  await page.getByLabel("Title", { exact: true }).fill("Unsaved child title");
  await page.getByRole("button", { name: "Back to parent task", exact: true }).click();
  await page.getByText("Subtasks", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved parent title");
  assert.equal(await dialog.getByText("Human final review", { exact: true }).isVisible(), true);
  await dialog.getByText("Human final review", { exact: true }).click();
  await page.getByRole("button", { name: "Back to parent task", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved child title");
  state.failNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.locator(".detail-error").getByText("Could not save task", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved child title");
  assert.equal(await page.getByLabel("List", { exact: true }).inputValue(), "list-youtube", "failed save keeps the parent's list");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Subtasks", { exact: true }).waitFor();
  assert.equal(Object.hasOwn(state.patches.at(-1), "bucketId"), false, "subtask saves omit their immutable list");
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved parent title");
  assert.equal(await dialog.getByText("Unsaved child title", { exact: true }).isVisible(), true);
  await page.getByRole("button", { name: "Back to board" }).click();
  await page.getByRole("heading", { name: "Board", exact: true }).waitFor();
  assert.equal(await page.locator(".workspace-flow.grouped-by-status").isVisible(), true);
});

test("task detail remains usable on a phone-sized viewport", async t => {
  const { page } = await startWorkspace(t, { width: 390, height: 844 });

  await page.locator('[data-open-task="task-parent"]').click();
  const dialog = page.getByRole("region", { name: "Task detail" });
  await dialog.waitFor();
  const bounds = await dialog.boundingBox();
  assert.ok(bounds.width >= 384, `dialog width=${bounds.width}`);
  assert.ok(bounds.height >= 780, `detail height=${bounds.height}`);
  assert.equal(parseFloat(await page.locator("#workspace-detail-title").evaluate(element => getComputedStyle(element).fontSize)), 24);
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

  await page.getByRole("button", { name: "Back to board" }).click();
  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Draft from the new surface");
  state.releaseSubtask();
  await waitFor(() => state.subtasks.some(item => item.title === "Delayed subtask"));
  await page.getByRole("region", { name: "Task detail" }).getByText("Delayed subtask", { exact: true }).waitFor();

  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Draft from the new surface");
  assert.equal(await page.getByRole("region", { name: "Task detail" }).getByText("Delayed subtask", { exact: true }).isVisible(), true);
  assert.equal(await page.getByRole("button", { name: "Add subtask", exact: true }).isEnabled(), true);
});

test("route navigation clears subtask state before another task opens", async t => {
  const { page } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Subtask title", { exact: true }).fill("Must stay with the parent");
  await navigateApp(page, "/app/lists/list-inbox");
  await page.getByRole("heading", { name: "Inbox", level: 1, exact: true }).waitFor();
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

  await page.getByRole("button", { name: "Back to board" }).click();
  await page.locator('[data-open-task="task-inbox"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Draft on the newer surface");
  state.releaseStatus();
  await waitFor(() => state.patches.some(item => item.id === "task-parent" && item.title === "Saved parent title"));
  await page.waitForTimeout(50);

  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Draft on the newer surface");
  assert.equal(await page.getByRole("region", { name: "Task detail" }).isVisible(), true);
  await page.getByRole("button", { name: "Back to board" }).click();
  await page.getByText("Saved parent title", { exact: true }).waitFor();
});

test("a delayed workspace save refreshes the overview after detail closes", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Saved after detail closed");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");

  await page.getByRole("button", { name: "Back to board" }).click();
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
  await page.getByRole("button", { name: "Back to board" }).click();

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
  assert.equal(await page.getByRole("region", { name: "Task detail" }).isVisible(), true);
  assert.deepEqual(pageErrors, []);
});

test("a failed post-save workspace refresh preserves a task opened while it loads", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Saved before failed refresh");
  state.delayNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await waitFor(() => typeof state.releaseStatus === "function");
  await page.getByRole("button", { name: "Back to board" }).click();

  state.delayNextWorkspaceTasks = true;
  state.failNextWorkspaceTasks = true;
  state.releaseStatus();
  await waitFor(() => typeof state.releaseWorkspaceTasks === "function");
  await page.locator('[data-open-task="task-inbox"]').click();
  const brief = page.getByLabel("Description", { exact: true });
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
  await page.getByLabel("Description", { exact: true }).fill("Unsaved brief after failure");
  await page.getByLabel("Priority", { exact: true }).selectOption("p2");
  state.failNextStatus = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.locator(".detail-error").getByText("Could not save task", { exact: true }).waitFor();

  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved title after failure");
  assert.equal(await page.getByLabel("Description", { exact: true }).inputValue(), "Unsaved brief after failure");
  assert.equal(await page.getByLabel("Priority", { exact: true }).inputValue(), "p2");
});

test("a delayed delete cannot close a newer surface and disappears from the overview", async t => {
  const { page, state } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  state.delayNextDelete = true;
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete task", exact: true }).click();
  await waitFor(() => typeof state.releaseDelete === "function");

  await page.getByRole("button", { name: "Back to board" }).click();
  await page.locator('[data-open-task="task-inbox"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Newer task stays open");
  state.releaseDelete();
  await waitFor(() => !state.tasks.some(item => item.id === "task-parent"));
  await page.waitForTimeout(50);

  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Newer task stays open");
  await page.getByRole("button", { name: "Back to board" }).click();
  assert.equal(await page.locator('[data-open-task="task-parent"]').count(), 0);
});

test("a delayed delete closes the same task when it has been reopened", async t => {
  const { page, state } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  state.delayNextDelete = true;
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete task", exact: true }).click();
  await waitFor(() => typeof state.releaseDelete === "function");

  await page.getByRole("button", { name: "Back to board" }).click();
  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByRole("region", { name: "Task detail" }).waitFor();
  state.releaseDelete();
  await waitFor(() => !state.tasks.some(item => item.id === "task-parent"));
  await page.getByRole("heading", { name: "Board", exact: true }).waitFor();

  assert.equal(await page.getByRole("region", { name: "Task detail" }).count(), 0);
  assert.equal(await page.locator('[data-open-task="task-parent"]').count(), 0);
});

test("agent directory uses quiet card surfaces on desktop and mobile", async t => {
  const { page, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents`);
  await page.getByRole("heading", { name: "Agents", exact: true, level: 1 }).waitFor();
  const row = page.locator(".agent-directory-row");
  const card = page.locator(".agent-directory-link");
  assert.equal(await row.count(), 1);
  assert.equal(await page.locator(".archived-agents").count(), 0);
  const styles = await page.evaluate(() => {
    const rowStyle = getComputedStyle(document.querySelector(".agent-directory-row"));
    const cardStyle = getComputedStyle(document.querySelector(".agent-directory-link"));
    return {
      rowDivider: rowStyle.borderBottomWidth,
      cardBorder: cardStyle.borderTopWidth,
      cardRadius: cardStyle.borderRadius,
      cardBackground: cardStyle.backgroundColor,
    };
  });
  assert.equal(styles.rowDivider, "0px");
  assert.notEqual(styles.cardBorder, "0px");
  assert.notEqual(styles.cardRadius, "0px");
  assert.notEqual(styles.cardBackground, "rgba(0, 0, 0, 0)");

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.equal(await card.isVisible(), true);
  assert.deepEqual(pageErrors, []);
});

test("agents can be deleted directly from settings", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/settings`);
  await page.getByRole("heading", { name: "Research agent", exact: true }).waitFor();
  await page.locator("#delete-agent").click();
  const dialog = page.getByRole("dialog", { name: "Delete Research agent?", exact: true });
  assert.equal(await dialog.getByText("This cannot be undone.", { exact: false }).isVisible(), true);
  assert.equal(await dialog.getByText("Assigned tasks remain and become unassigned.", { exact: false }).isVisible(), true);
  await page.keyboard.press("Escape");
  assert.equal(await dialog.count(), 0);
  await page.locator("#delete-agent").click();
  state.commitNextAgentDeleteThenFail = true;
  await page.keyboard.press("Enter");

  await dialog.getByText("Response was lost", { exact: true }).waitFor();
  assert.deepEqual(state.deletedAgents, ["agent-research"]);
  await dialog.getByRole("button", { name: "Delete agent", exact: true }).click();

  await page.getByRole("heading", { name: "Agents", exact: true }).waitFor();
  await page.getByText("Agent deleted.", { exact: true }).waitFor();
  assert.deepEqual(state.deletedAgents, ["agent-research"]);
  assert.equal(state.tasks.find(item => item.id === "task-parent").assigneeAgentId, "");
  assert.equal(state.subtasks.find(item => item.id === "task-child").assigneeAgentId, "");
  assert.ok(state.requests.includes("DELETE /api/v1/agents/agent-research"));
  assert.equal(state.requests.filter(item => item === "DELETE /api/v1/agents/agent-research").length, 2);
  assert.deepEqual(pageErrors, []);
});

function isAppShell(pathname) {
  if (["/", "/index.html", "/login", "/app", "/app/tasks", "/app/inbox", "/app/settings", "/early-access", "/reset-password"].includes(pathname)) return true;
  if (pathname.startsWith("/app/boards/") || pathname.startsWith("/app/lists/") || pathname.startsWith("/app/settings/") || pathname.startsWith("/app/agents/")) return true;
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

async function navigateApp(page, target) {
  await page.evaluate(pathname => {
    history.pushState({}, "", pathname);
    dispatchEvent(new PopStateEvent("popstate"));
  }, target);
}
