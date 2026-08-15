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
  return { boards, lists, tasks, subtasks, agents, entries: {}, entryAttempts: {}, failNextEntryResponse: false, delayNextEntry: false, releaseEntry: null, deletedAgents: [], commitNextAgentDeleteThenFail: false, deletedBoards: [], reorderedLists: [], dynamicAgentCounts: false, taskQueries: [], created: [], createdBoards: [], createdLists: [], patches: [], requests: [], inboxIdempotency: new Map(), inboxRequestKeys: [], commitNextInboxThenFail: false, subtaskIdempotency: new Map(), subtaskRequestKeys: [], commitNextSubtaskThenFail: false, hideSubtasksFromAgentOverview: false, failNextAgentDetail: false, unauthorizeNextAgentDetail: false, delayNextAgentDetail: false, releaseAgentDetail: null, failNextLists: false, failNextListCreate: false, failNextListRename: false, failNextBoardCreate: false, delayNextBoardCreate: false, releaseBoardCreate: null, failNextBoardDelete: false, delayNextBoardDelete: false, releaseBoardDelete: null, failNextAgentWork: false, delayNextAgentWork: false, agentWorkRefreshCompleted: false, releaseAgentWork: null, failNextSubtask: false, delayNextSubtask: false, releaseSubtask: null, failNextStatus: false, delayNextStatus: false, releaseStatus: null, failNextTaskPatch: false, delayNextTaskPatch: false, releaseTaskPatch: null, failNextDelete: false, unauthorizeNextDelete: false, delayNextDelete: false, releaseDelete: null, failNextWorkspaceTasks: false, delayNextWorkspaceTasks: false, delayedWorkspaceTasksCompleted: false, releaseWorkspaceTasks: null, delayNextBoards: false, releaseBoards: null, delayNextBoardDetail: false, releaseBoardDetail: null, delayNextList: false, releaseList: null };
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
        return json(response, { code: "inbox_required", error: "Move or create another Inbox before deleting this board" }, 409);
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
          cardReviewReason: task.reviewReason || "",
        }, 201);
      }
      const entry = { id: `entry-${Object.values(state.entries).flat().length + 1}`, cardId: task.id, ...input, authorKind: "human", authorId: "owner", authorName: "Owain", createdAt: new Date().toISOString() };
      state.entries[task.id] = [...(state.entries[task.id] || []), entry];
      if (entry.kind === "output") Object.assign(task, { status: "needs_review", reviewReason: "output" });
      Object.assign(entry, { cardStatus: task.status, cardReviewReason: task.reviewReason || "" });
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
      if (typeof input.title === "string") input.title = input.title.trim();
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
      if (typeof input.title === "string") input.title = input.title.trim();
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
  await page.getByRole("heading", { name: "All cards", exact: true }).waitFor();
  return { page, state, origin, pageErrors };
}

test("the task workspace supports Board, Flow, Table, lists, and filters", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  for (const label of ["Focus", "All cards", "Boards", "Workspace", "Other", "All agents"]) {
    assert.equal(await page.getByText(label, { exact: true }).first().isVisible(), true, label);
  }
  for (const label of ["Inbox", "Today", "Week", "Review"]) assert.equal(await page.getByRole("link", { name: label, exact: true }).count(), 0, label);
  const boardsHeading = page.getByRole("heading", { name: "Boards", exact: true });
  const focusHeading = page.getByRole("heading", { name: "Focus", exact: true });
  assert.equal(await focusHeading.evaluate((focus, boards) => Boolean(focus.compareDocumentPosition(boards) & Node.DOCUMENT_POSITION_FOLLOWING), await boardsHeading.elementHandle()), true);
  assert.ok(parseFloat(await page.locator(".task-nav-pages .nav-link").first().evaluate(element => getComputedStyle(element).fontSize)) >= 13);
  const agentLinkStyle = await page.locator(".agent-nav-link").first().evaluate(element => {
    const style = getComputedStyle(element);
    const avatar = element.querySelector(".avatar").getBoundingClientRect();
    return { display: style.display, decoration: style.textDecorationLine, avatarWidth: avatar.width };
  });
  assert.deepEqual(agentLinkStyle, { display: "grid", decoration: "none", avatarWidth: 23 });
  assert.equal(await page.getByRole("tab", { name: "Board", selected: true }).count(), 1);
  for (const list of ["Inbox", "YouTube"]) assert.equal(await page.locator(".workspace-flow-column").getByText(list, { exact: true }).count(), 1);
  assert.equal(await page.locator('[data-open-task="task-parent"]').count(), 1);
  assert.equal(await page.locator('.workspace-flow-column .task .state-badge').count(), 0);

  await page.getByRole("tab", { name: "Flow", exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".workspace-flow").count(), 1, `url=${page.url()} errors=${pageErrors.join(" | ")} queries=${state.taskQueries.join(" | ")}`);
  assert.match(page.url(), /view=flow/);
  for (const status of ["New", "Ready", "In Progress", "Review", "Done"]) assert.equal(await page.locator(".workspace-flow-column").getByText(status, { exact: true }).count(), 1);

  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.getByRole("tab", { name: "Table", selected: true }).waitFor();
  for (const column of ["Card", "Location", "Status", "Priority", "Owner", "Planned"]) {
    assert.equal(await page.locator(".workspace-table-head").getByText(column, { exact: true }).isVisible(), true, column);
  }
  assert.ok(parseFloat(await page.locator(".workspace-table-head").evaluate(element => getComputedStyle(element).fontSize)) >= 11);
  assert.ok(parseFloat(await page.locator(".workspace-table-row strong").first().evaluate(element => getComputedStyle(element).fontSize)) >= 14);

  await page.locator("#workspace-filter-toggle").click();
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

  await page.goto(`${new URL(page.url()).origin}/app/lists/list-youtube`);
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

test("global filters can hide and restore child cards", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  assert.equal(await page.locator('[data-open-task="task-child"]').count(), 1);
  await page.locator("#workspace-filter-toggle").click();
  await page.getByLabel("Hide child cards", { exact: true }).check();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await waitFor(() => state.taskQueries.some(query => query.includes("topLevel=true")));
  await page.locator('[data-open-task="task-child"]').waitFor({ state: "detached" });
  assert.match(page.url(), /children=hide/);
  assert.equal(await page.locator('[data-open-task="task-parent"]').count(), 1);

  assert.equal(await page.getByLabel("Hide child cards", { exact: true }).isChecked(), true);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.locator('[data-open-task="task-child"]').waitFor();
  assert.doesNotMatch(page.url(), /children=hide/);
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

  await page.locator('[data-board="board-one"]').click();
  await page.getByRole("heading", { name: "Workspace", exact: true }).waitFor();
  const boardCard = page.locator(".task").first();
  const boardAppearance = await boardCard.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, shadow: style.boxShadow, radius: parseFloat(style.borderRadius) };
  });
  assert.equal(boardAppearance.background, workspaceAppearance.background);
  assert.notEqual(boardAppearance.shadow, "none");
  assert.ok(boardAppearance.radius >= 8);
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
  await page.getByRole("heading", { name: "All cards", exact: true }).click();
  await menu.waitFor({ state: "detached" });

  await card.click({ button: "right" });
  menu = page.getByRole("menu", { name: "Actions for Publish task-first agents video" });
  page.once("dialog", async dialog => {
    assert.equal(dialog.message(), "Delete “Publish task-first agents video” and its child cards?");
    await dialog.accept();
  });
  await menu.getByRole("menuitem", { name: "Delete card" }).click();
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
  await page.getByRole("menuitem", { name: "Delete card" }).click();
  await waitFor(() => typeof state.releaseDelete === "function");

  await page.locator('[data-board="board-one"]').click();
  await page.getByRole("heading", { name: "Workspace", exact: true }).waitFor();
  await page.locator('[data-task="task-child"]').waitFor();
  const listCount = page.locator('[data-bucket="list-youtube"] .count');
  assert.equal(await listCount.textContent(), "2");
  state.releaseDelete();
  await page.locator('[data-task="task-child"]').waitFor({ state: "detached" });

  assert.equal(await page.locator('[data-task="task-parent"]').count(), 0);
  assert.equal(await listCount.textContent(), "1");
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
  await page.getByRole("menuitem", { name: "Delete card" }).click();
  await waitFor(() => typeof state.releaseDelete === "function");

  state.delayNextWorkspaceTasks = true;
  await page.getByRole("link", { name: "All cards", exact: true }).click();
  await waitFor(() => typeof state.releaseWorkspaceTasks === "function");
  const taskRequestsBeforeDelete = state.requests.filter(request => request.startsWith("GET /api/v1/tasks?")).length;
  const boardRequestsBeforeDelete = state.requests.filter(request => request === "GET /api/v1/boards").length;
  state.releaseDelete();
  await waitFor(() => state.requests.filter(request => request === "GET /api/v1/boards").length > boardRequestsBeforeDelete);
  state.releaseWorkspaceTasks();
  await waitFor(() => state.delayedWorkspaceTasksCompleted);
  await waitFor(() => state.requests.filter(request => request.startsWith("GET /api/v1/tasks?")).length > taskRequestsBeforeDelete);
  await page.getByRole("heading", { name: "All cards", exact: true }).waitFor();
  await page.waitForTimeout(50);

  assert.equal(await page.locator('[data-task="task-parent"]').count(), 0);
  assert.equal(await page.locator('[data-task="task-child"]').count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("a navigation-first context-menu delete cannot restore a stale board", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);
  const parent = page.locator('[data-task="task-parent"]');
  await parent.waitFor();

  state.delayNextBoardDetail = true;
  await page.locator('[data-board="board-two"]').click();
  await waitFor(() => typeof state.releaseBoardDetail === "function");
  const boardListRequestsBeforeDelete = state.requests.filter(request => request === "GET /api/v1/boards").length;

  await parent.click({ button: "right" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete card" }).click();
  await waitFor(() => state.requests.filter(request => request === "GET /api/v1/boards").length > boardListRequestsBeforeDelete);
  state.releaseBoardDetail();
  await page.getByRole("heading", { name: "Other", exact: true }).waitFor();
  await page.waitForTimeout(50);

  assert.equal(await page.locator('[data-task="task-parent"]').count(), 0);
  assert.equal(state.tasks.some(task => task.id === "task-parent"), false);
  assert.equal(state.subtasks.some(task => task.parentTaskId === "task-parent"), false);
  assert.deepEqual(pageErrors, []);
});

test("agent work cards expose the same context-menu delete action", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);
  await page.goto(`${origin}/app/agents/agent-research/work`);
  await page.getByRole("heading", { name: "All work", exact: true }).waitFor();
  const parent = page.locator('.agent-work-item[data-task="task-parent"]');

  await parent.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Actions for Publish task-first agents video" });
  page.once("dialog", dialog => dialog.accept());
  await menu.getByRole("menuitem", { name: "Delete card" }).click();
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
  await page.getByRole("menuitem", { name: "Delete card" }).click();
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
  await page.getByRole("menuitem", { name: "Delete card" }).click();
  await waitFor(() => typeof state.releaseDelete === "function");

  await page.locator('[data-open-task="task-inbox"]').click();
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Newest unrelated draft");
  state.releaseDelete();
  await page.getByRole("region", { name: "Card detail" }).waitFor();
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
  await page.getByRole("menuitem", { name: "Delete card" }).click();
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
  await page.getByRole("menuitem", { name: "Delete card" }).click();
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
  await page.getByRole("menuitem", { name: "Delete card" }).click();
  await page.getByText("The card was deleted, but this view couldn’t be refreshed: Could not refresh tasks", { exact: true }).waitFor();

  assert.equal(await page.getByRole("heading", { name: "All cards", exact: true }).count(), 1);
  assert.equal(await page.locator('[data-task="task-parent"]').count(), 0);
  assert.equal(await page.locator('[data-task="task-inbox"]').count(), 1);
  assert.equal(state.tasks.some(task => task.id === "task-parent"), false);
  assert.deepEqual(pageErrors, []);
});

test("deleting a child from its context menu keeps the parent detail open", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);
  await page.locator('[data-open-task="task-parent"]').first().click();
  await page.getByRole("region", { name: "Card detail" }).waitFor();
  const child = page.locator('.workspace-subtask-row[data-task="task-child"]');

  await child.click({ button: "right" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete card" }).click();
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
  await page.getByRole("menuitem", { name: "Delete card" }).click();
  await page.getByText(error, { exact: true }).waitFor();

  assert.equal(await parent.count(), 1);
  assert.equal(state.tasks.some(task => task.id === "task-parent"), true);

  await parent.click({ button: "right" });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete card" }).click();
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
  await page.getByRole("menuitem", { name: "Delete card" }).click();
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
  await page.getByRole("menuitem", { name: "Delete card" }).click();
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
  await page.getByRole("menuitem", { name: "Delete card" }).click();
  await waitFor(() => typeof state.releaseDelete === "function");
  await page.getByRole("link", { name: "All agents", exact: true }).click();
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
  await page.getByRole("menuitem", { name: "Delete card" }).click();
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
  await page.getByRole("menuitem", { name: "Delete card" }).click();
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
  await page.getByRole("menuitem", { name: "Delete card" }).click();
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
  await page.getByRole("menuitem", { name: "Delete card" }).click();
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
  await page.getByRole("menuitem", { name: "Delete card" }).click();
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
  await page.getByRole("menuitem", { name: "Delete card" }).click();
  await waitFor(() => typeof state.releaseDelete === "function");
  await page.getByRole("link", { name: "All agents", exact: true }).click();

  const researchAgent = page.locator(".agent-directory-row").filter({ hasText: "Research agent" });
  await researchAgent.getByText("1 working card", { exact: true }).waitFor();
  state.releaseDelete();
  await researchAgent.getByText("No open work assigned", { exact: true }).waitFor();

  assert.equal(await researchAgent.getByText("1 working card", { exact: true }).count(), 0);
  assert.equal(state.tasks.some(task => task.id === "task-parent"), false);
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

test("boards own their lists and support create, rename, and delete", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/boards/board-one`);
  await page.getByRole("heading", { name: "Workspace", exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Boards", exact: true }).isVisible(), true);
  assert.deepEqual(await page.getByLabel("List name").evaluateAll(inputs => inputs.map(input => input.value)), ["Inbox", "YouTube"]);
  const youtubeName = page.getByLabel("List name").nth(1);
  state.failNextListRename = true;
  await youtubeName.fill("Failed rename");
  await youtubeName.press("Tab");
  await page.getByRole("alert").filter({ hasText: "Could not rename list" }).waitFor();
  assert.equal(await page.getByLabel("List name").nth(1).inputValue(), "YouTube");
  assert.equal(await page.getByLabel("List name").nth(1).evaluate(element => element === document.activeElement), true);
  await youtubeName.fill("Content");
  await page.getByLabel("List name").nth(1).press("Tab");
  await waitFor(() => state.lists.find(list => list.id === "list-youtube")?.name === "Content");
  assert.equal(new URL(page.url()).pathname, "/app/boards/board-one");

  await page.getByRole("button", { name: "Other", exact: true }).click();
  await page.getByRole("heading", { name: "Other", exact: true }).waitFor();

  await page.getByRole("button", { name: "New list", exact: true }).click();
  const createDialog = page.getByRole("dialog", { name: "New list", exact: true });
  await createDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "New list", exact: true }).evaluate(element => element === document.activeElement), true);
  await page.getByRole("button", { name: "New list", exact: true }).click();
  assert.equal(await createDialog.getByLabel("Name", { exact: true }).getAttribute("maxlength"), "100");
  await createDialog.getByLabel("Name", { exact: true }).fill("Planning");
  assert.equal(await createDialog.getByLabel("Board", { exact: true }).count(), 0);
  state.failNextListCreate = true;
  await createDialog.getByRole("button", { name: "Create list", exact: true }).click();
  await createDialog.getByRole("alert").filter({ hasText: "Could not create list" }).waitFor();
  assert.equal(await createDialog.getByLabel("Name", { exact: true }).inputValue(), "Planning");
  assert.equal(await createDialog.getByLabel("Name", { exact: true }).evaluate(element => element === document.activeElement), true);
  await createDialog.getByRole("button", { name: "Create list", exact: true }).click();
  await page.locator('input[data-bucket-name][value="Planning"]').waitFor();
  assert.equal(state.createdLists.length, 1);
  assert.equal(state.createdLists[0].boardId, "board-two");

  await page.getByRole("button", { name: "Delete Planning", exact: true }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete Planning?", exact: true });
  assert.equal(await deleteDialog.getByText("Cards in this list will also be permanently deleted. This cannot be undone.", { exact: true }).isVisible(), true);
  await deleteDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.locator('input[data-bucket-name][value="Planning"]').isVisible(), true);

  await page.getByRole("button", { name: "Delete Planning", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete Planning?", exact: true }).getByRole("button", { name: "Delete list", exact: true }).click();
  await page.locator('input[data-bucket-name][value="Planning"]').waitFor({ state: "detached" });
  assert.equal(state.lists.some(list => list.name === "Planning"), false);
  assert.equal(await page.locator('input[data-bucket-name][value="Planning"]').count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("board settings are removed and legacy links return to the board", async t => {
  const { page, origin, pageErrors } = await startWorkspace(t);

  assert.equal(await page.getByRole("button", { name: /Board settings for/ }).count(), 0);
  await page.goto(`${origin}/app/boards/board-one/settings`);
  await page.getByRole("heading", { name: "Workspace", exact: true }).waitFor();

  assert.equal(new URL(page.url()).pathname, "/app/boards/board-one");
  assert.equal(await page.getByText("Board settings", { exact: true }).count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("a board can be created from the primary navigation", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

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
  await page.getByRole("heading", { name: "Untitled board", exact: true }).waitFor();
  assert.equal(state.createdBoards.length, 1);
  assert.equal(new URL(page.url()).pathname, `/app/boards/${state.createdBoards[0].id}`);
  assert.deepEqual(await page.getByLabel("List name").evaluateAll(inputs => inputs.map(input => input.value)), ["Inbox", "Focus"]);
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
  const workspaceHeadingBounds = await page.getByRole("heading", { name: "All cards", exact: true }).boundingBox();
  assert.ok(collapsedToggleBounds.x + collapsedToggleBounds.width < workspaceHeadingBounds.x,
    `toggle=${JSON.stringify(collapsedToggleBounds)} heading=${JSON.stringify(workspaceHeadingBounds)}`);

  await navigateApp(page, "/app/boards/board-one");
  await page.getByRole("heading", { name: "Workspace", exact: true }).waitFor();
  const boardShowNavigation = page.getByRole("button", { name: "Show navigation" });
  assert.equal(await boardShowNavigation.getAttribute("aria-expanded"), "false");
  assert.ok((await sidebar.boundingBox()).width < 1);
  const boardToggleBounds = await boardShowNavigation.boundingBox();
  const boardHeadingBounds = await page.getByRole("heading", { name: "Workspace", exact: true }).boundingBox();
  assert.ok(boardToggleBounds.x + boardToggleBounds.width < boardHeadingBounds.x,
    `toggle=${JSON.stringify(boardToggleBounds)} heading=${JSON.stringify(boardHeadingBounds)}`);

  await navigateApp(page, "/app/agents");
  await page.getByRole("heading", { name: "Agents", exact: true, level: 1 }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Show navigation" }).getAttribute("aria-expanded"), "false");

  await navigateApp(page, "/app/settings/profile");
  await page.getByRole("heading", { name: "Profile", exact: true, level: 1 }).waitFor();
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
  const { page, state, pageErrors } = await startWorkspace(t);

  state.delayNextBoardCreate = true;
  await page.getByRole("button", { name: "New board", exact: true }).click();
  await waitFor(() => typeof state.releaseBoardCreate === "function");
  await navigateApp(page, "/app/today");
  await page.getByRole("heading", { name: "Today", exact: true }).waitFor();
  state.releaseBoardCreate();
  await waitFor(() => state.createdBoards.length === 1);
  await page.waitForTimeout(50);

  assert.equal(new URL(page.url()).pathname, "/app/today");
  assert.equal(await page.getByRole("heading", { name: "Untitled board", exact: true }).count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("board deletion uses a recoverable designed dialog", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  const protectedDelete = page.getByRole("button", { name: "Delete Workspace", exact: true });
  assert.equal(await protectedDelete.isDisabled(), true);
  assert.equal(await protectedDelete.getAttribute("title"), "Move or create another Inbox before deleting this board");
  state.lists.push({ id: "list-other-inbox", boardId: "board-two", boardName: "Other", name: "Other Inbox", goal: "", isInbox: true, openCount: 0 });
  await page.reload();
  await page.getByRole("heading", { name: "All cards", exact: true }).waitFor();
  assert.equal(await protectedDelete.isEnabled(), true);
  const deleteOther = page.getByRole("button", { name: "Delete Other", exact: true });
  await deleteOther.click();
  let dialog = page.getByRole("dialog", { name: "Delete Other?", exact: true });
  assert.equal(await dialog.getByText("Every list and card on this board will be permanently deleted. This cannot be undone.", { exact: true }).isVisible(), true);
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
  assert.equal(await page.getByRole("button", { name: "Other", exact: true }).count(), 0);
  assert.equal(await protectedDelete.isDisabled(), true);
  await page.getByRole("button", { name: "Open card: Write the doc my boss asked for", exact: true }).click();
  assert.equal(await page.getByLabel("List", { exact: true }).locator("option", { hasText: "Other Inbox" }).count(), 0);
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
  await researchAgent.getByText("2 working cards", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Delete Other", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete Other?", exact: true });
  await dialog.getByRole("button", { name: "Delete board", exact: true }).click();

  await researchAgent.getByText("1 working card", { exact: true }).waitFor();
  assert.equal(state.tasks.some(task => task.id === "task-other-agent"), false);
  assert.equal(await researchAgent.getByText("2 working cards", { exact: true }).count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("a delayed board deletion cannot clear a newer board route", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  state.lists.push({ id: "list-other-inbox", boardId: "board-two", boardName: "Other", name: "Other Inbox", goal: "", isInbox: true, openCount: 0 });
  await page.goto(`${origin}/app/boards/board-one`);
  await page.getByRole("heading", { name: "Workspace", exact: true }).waitFor();
  state.delayNextBoardDelete = true;
  await page.getByRole("button", { name: "Delete Workspace", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete Workspace?", exact: true }).getByRole("button", { name: "Delete board", exact: true }).click();
  await waitFor(() => typeof state.releaseBoardDelete === "function");

  await page.evaluate(() => {
    history.pushState({}, "", "/app/boards/board-two");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.getByRole("heading", { name: "Other", exact: true }).waitFor();
  state.releaseBoardDelete();
  await waitFor(() => state.deletedBoards.includes("board-one"));
  await page.getByRole("dialog", { name: "Delete Workspace?", exact: true }).waitFor({ state: "detached" });

  assert.equal(new URL(page.url()).pathname, "/app/boards/board-two");
  await page.getByRole("button", { name: "New list", exact: true }).click();
  await page.getByRole("dialog", { name: "New list", exact: true }).getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(pageErrors, []);
});

test("a delayed board deletion failure stays out of a newer route", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  state.delayNextBoardDelete = true;
  state.failNextBoardDelete = true;
  await page.getByRole("button", { name: "Delete Other", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete Other?", exact: true }).getByRole("button", { name: "Delete board", exact: true }).click();
  await waitFor(() => typeof state.releaseBoardDelete === "function");
  await page.evaluate(() => {
    history.pushState({}, "", "/app/settings/profile");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.getByRole("heading", { name: "Profile", exact: true }).waitFor();
  state.releaseBoardDelete();
  await page.getByRole("dialog", { name: "Delete Other?", exact: true }).waitFor({ state: "detached" });

  assert.equal(new URL(page.url()).pathname, "/app/settings/profile");
  assert.equal(await page.getByText("Could not delete board", { exact: true }).count(), 0);
  assert.deepEqual(pageErrors, []);
});

test("an agent surface reports refresh failure after a committed board deletion", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  state.lists.push({ id: "list-other-work", boardId: "board-two", boardName: "Other", name: "Other work", goal: "", isInbox: false, openCount: 1 });
  state.tasks.push({
    id: "task-other-agent", boardId: "board-two", bucketId: "list-other-work", listName: "Other work",
    title: "Research the other board", description: "", scheduledDate: "", kind: "action",
    status: "working", priority: "", assigneeAgentId: "agent-research", assigneeAgentName: "Research agent",
  });
  await page.goto(`${origin}/app/agents/agent-research`);
  await page.getByRole("heading", { name: "Research agent", exact: true }).waitFor();
  await page.getByRole("button", { name: "Delete Other", exact: true }).click();
  state.failNextAgentDetail = true;
  await page.getByRole("dialog", { name: "Delete Other?", exact: true }).getByRole("button", { name: "Delete board", exact: true }).click();

  await page.getByRole("alert").filter({ hasText: "The board was deleted, but Slate could not refresh all views" }).waitFor();
  assert.equal(state.tasks.some(task => task.id === "task-other-agent"), false);
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

  const detailAvatar = page.locator(".agent-detail-identity .agent-avatar");
  const navAvatar = page.locator(".agent-nav-link .agent-avatar");
  const [detailStyle, navStyle] = await Promise.all([
    detailAvatar.evaluate(element => {
      const style = getComputedStyle(element);
      return { color: style.color, backgroundImage: style.backgroundImage, borderRadius: style.borderRadius };
    }),
    navAvatar.evaluate(element => ({ color: getComputedStyle(element).color })),
  ]);
  assert.equal(detailStyle.color, navStyle.color);
  assert.notEqual(detailStyle.color, "rgb(255, 255, 255)");
  assert.match(detailStyle.backgroundImage, /linear-gradient/);
  assert.notEqual(detailStyle.borderRadius, "50%");

  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.getByRole("heading", { name: "No work assigned", exact: true }).isVisible(), true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${viewport.width}px page overflow`);
  }
  // The legacy app shell wraps route-owned main elements in #app; this test
  // scopes accessibility proof to the changed agent surface.
  const scan = await new AxeBuilder({ page })
    .include(".agents-main")
    .disableRules(["landmark-main-is-top-level", "landmark-no-duplicate-main"])
    .analyze();
  assert.deepEqual(scan.violations, []);
  assert.deepEqual(pageErrors, []);
});

test("board lists stay in one horizontal scroll lane", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t, { width: 720, height: 900 });

  state.lists.push({ id: "list-planning", boardId: "board-one", boardName: "Workspace", name: "Planning", goal: "", isInbox: false, openCount: 0 });
  await page.goto(`${origin}/app/boards/board-one`);
  await page.getByRole("heading", { name: "Workspace", exact: true }).waitFor();
  const grid = page.locator(".grid");
  const lists = grid.locator(".bucket");
  const [first, second] = await Promise.all([lists.nth(0).boundingBox(), lists.nth(1).boundingBox()]);
  const dimensions = await grid.evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));

  assert.ok(Math.abs(first.y - second.y) < 2, `lists should share a row: ${first.y} vs ${second.y}`);
  assert.ok(second.x > first.x, `second list should be to the right: ${first.x} vs ${second.x}`);
  assert.ok(dimensions.scrollWidth > dimensions.clientWidth, `board should scroll horizontally: ${JSON.stringify(dimensions)}`);

  await page.evaluate(() => {
    const source = document.querySelector('[data-bucket="list-planning"] .bucket-head');
    const target = document.querySelector(".grid");
    const dataTransfer = new DataTransfer();
    const rect = target.getBoundingClientRect();
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, clientX: rect.left + 5, clientY: rect.top + 120, dataTransfer }));
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, clientX: rect.left + 5, clientY: rect.top + 120, dataTransfer }));
    source.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
  });
  await waitFor(() => state.reorderedLists[0] === "list-planning");
  assert.deepEqual(state.reorderedLists, ["list-planning", "list-inbox", "list-youtube"]);
  assert.equal(await grid.locator(".bucket").first().getAttribute("data-bucket"), "list-planning");

  await page.getByRole("button", { name: "Publish task-first agents video", exact: true }).click();
  await page.getByRole("region", { name: "Card detail" }).waitFor();
  assert.equal(await page.locator(".board-main").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Back to board", exact: true }).isVisible(), true);
  await page.getByRole("button", { name: "Back to board", exact: true }).click();
  const opener = page.getByRole("button", { name: "Publish task-first agents video", exact: true });
  assert.equal(await opener.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(pageErrors, []);
});

test("board Flow stays in one horizontal scroll lane", async t => {
  const { page, origin, pageErrors } = await startWorkspace(t, { width: 720, height: 900 });

  await page.goto(`${origin}/app/boards/board-one`);
  await page.getByRole("heading", { name: "Workspace", exact: true }).waitFor();
  await page.locator('[data-board-mode="flow"]').click();
  const flow = page.locator(".flow");
  const columns = flow.locator(".flow-column");
  const [first, second, last] = await Promise.all([
    columns.nth(0).boundingBox(),
    columns.nth(1).boundingBox(),
    columns.nth(4).boundingBox(),
  ]);
  const dimensions = await flow.evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));

  assert.equal(await columns.count(), 5);
  assert.ok(Math.abs(first.y - second.y) < 2, `Flow columns should share a row: ${first.y} vs ${second.y}`);
  assert.ok(Math.abs(first.y - last.y) < 2, `the final Flow column should not wrap: ${first.y} vs ${last.y}`);
  assert.ok(second.x > first.x, `second Flow column should be to the right: ${first.x} vs ${second.x}`);
  assert.ok(dimensions.scrollWidth > dimensions.clientWidth, `Flow should scroll horizontally: ${JSON.stringify(dimensions)}`);
  assert.deepEqual(pageErrors, []);
});

test("boards offer table and calendar views without turning them into separate navigation", async t => {
  const { page, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/boards/board-one`);
  await page.getByRole("heading", { name: "Workspace", exact: true }).waitFor();
  for (const view of ["Board", "Flow", "Table", "Calendar"]) {
    assert.equal(await page.locator(`[data-board-mode="${view === "Board" ? "lists" : view.toLowerCase()}"]`).getByText(view, { exact: true }).isVisible(), true, view);
  }
  assert.equal(await page.getByRole("button", { name: "New list", exact: true }).isVisible(), true);

  await page.locator('[data-board-mode="flow"]').click();
  assert.equal(await page.getByRole("button", { name: "New list", exact: true }).count(), 0);

  await page.locator('[data-board-mode="table"]').click();
  await page.getByRole("table", { name: "Cards", exact: true }).waitFor();
  assert.equal(await page.getByRole("columnheader", { name: "Location", exact: true }).isVisible(), true);
  assert.ok(await page.getByText("Workspace / YouTube", { exact: true }).count() > 0);
  assert.equal(await page.getByRole("button", { name: "New list", exact: true }).count(), 0);

  await page.locator('[data-board-mode="calendar"]').click();
  const calendar = page.getByLabel("Board calendar", { exact: true });
  await calendar.waitFor();
  assert.equal(await calendar.locator(".calendar-day").count(), 7);
  assert.equal(await page.getByRole("button", { name: "New list", exact: true }).count(), 0);

  await page.locator('[data-board-mode="lists"]').click();
  assert.equal(await page.locator('[data-board-mode="lists"]').getAttribute("aria-pressed"), "true");
  assert.equal(await page.getByRole("button", { name: "New list", exact: true }).isVisible(), true);
  assert.equal(await page.getByLabel("List name").count(), 2);
  assert.deepEqual(pageErrors, []);
});

test("a delayed list creation cannot repaint while a newer history route loads", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/boards/board-two`);
  await page.getByRole("heading", { name: "Other", exact: true }).waitFor();
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

test("generic cards open from the table without a task completion control", async t => {
  const { page, pageErrors } = await startWorkspace(t);

  assert.equal(await page.locator(".workspace-completion-toggle").count(), 0);
  await page.getByRole("button", { name: "Open card: Publish task-first agents video", exact: true }).click();
  const detail = page.getByRole("region", { name: "Card detail" });
  await detail.waitFor();
  const detailMain = page.locator(".card-detail-main");
  const detailBounds = await detail.boundingBox();
  const mainBounds = await detailMain.boundingBox();
  assert.deepEqual(detailBounds, mainBounds);
  assert.equal(await page.locator(".workspace-topbar").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Back to cards", exact: true }).isVisible(), true);
  assert.equal(await page.getByLabel("Prompt and context", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("Act with an agent", { exact: true }).count(), 0);
  assert.equal(await page.getByLabel("Agent", { exact: true }).inputValue(), "agent-research");
  await page.getByRole("button", { name: "Back to cards", exact: true }).click();
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

  await navigateApp(page, "/app/review");
  const responseGroup = page.locator(".workspace-review-group").filter({ has: page.getByRole("heading", { name: "Other review", exact: true }) });
  const outputGroup = page.locator(".workspace-review-group").filter({ has: page.getByRole("heading", { name: "Outputs", exact: true }) });
  await responseGroup.getByText(unassigned.title, { exact: true }).waitFor();
  await outputGroup.getByText(assigned.title, { exact: true }).waitFor();
  assert.equal(await responseGroup.getByText(assigned.title, { exact: true }).count(), 0);
  assert.equal(await outputGroup.getByText(unassigned.title, { exact: true }).count(), 0);
  await outputGroup.getByRole("button", { name: `Open card: ${assigned.title}`, exact: true }).click();
  const conversation = page.locator(".card-conversation");
  await conversation.getByText("Draft ready", { exact: true }).waitFor();
  assert.equal(await page.getByText("Latest output", { exact: true }).count(), 0);
  assert.equal(await page.locator(".card-latest-output").count(), 0);
  assert.equal(await conversation.getByText("Draft ready", { exact: true }).count(), 1);
  assert.equal(await conversation.locator(".card-entry-kind").getByText("Output", { exact: true }).isVisible(), true);
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
  Object.assign(state.subtasks[0], { scheduledDate: today, status: "needs_review" });

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
  for (const heading of ["Card", "Location", "Status", "Priority", "Owner", "Planned"]) {
    assert.match(accessibility, new RegExp(`columnheader "${heading}"`));
  }
  const scan = await new AxeBuilder({ page }).include(".workspace-main").analyze();
  assert.deepEqual(scan.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.target) })), []);

  const row = page.getByRole("button", { name: "Open card: Publish task-first agents video", exact: true });
  await row.focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Publish task-first agents video");
  const back = page.getByRole("button", { name: /Back to (?:cards|board)/ });
  assert.equal(await back.evaluate(element => element === document.activeElement), true);
  await back.click();

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
  await page.getByRole("button", { name: /Back to (?:cards|board)/ }).click();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  assert.match(page.url(), /\/app\/week$/);

  await navigateApp(page, "/app/tasks");
  await page.getByRole("heading", { name: "All cards", exact: true }).waitFor();
  assert.equal(await page.locator(".workspace-flow.grouped-by-list").count(), 1);
  await navigateApp(page, "/app/week");
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
  state.delayNextTaskPatch = true;
  state.failNextTaskPatch = true;
  await page.locator('.workspace-week [data-task="task-parent"]').dragTo(page.locator(`.workspace-week [data-calendar-date="${wednesdayDate}"]`));
  await waitFor(() => typeof state.releaseTaskPatch === "function");
  await page.locator('[data-open-task="task-inbox"]').click();
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Unrelated live Week draft");

  const failedResponse = page.waitForResponse(response => response.url().endsWith("/api/v1/tasks/task-parent")
    && response.request().method() === "PATCH" && response.status() === 500);
  state.releaseTaskPatch();
  await failedResponse;
  await page.waitForTimeout(50);

  assert.equal(await page.locator(".detail-error").textContent(), "");
  assert.equal(await title.inputValue(), "Unrelated live Week draft");
  assert.equal(await title.evaluate(element => element === document.activeElement), true);
  await page.getByRole("button", { name: /Back to (?:cards|board)/ }).click();
  assert.equal(state.tasks.find(task => task.id === "task-parent").scheduledDate, mondayDate);
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

test("a malformed list route renders Not found without querying cards", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);
  const taskQueryCount = state.taskQueries.length;

  await page.goto(`${origin}/app/lists/not-a-uuid`);
  await page.getByRole("heading", { name: "Not found.", exact: true }).waitFor();

  assert.equal(new URL(page.url()).pathname, "/app/lists/not-a-uuid");
  assert.equal(state.taskQueries.length, taskQueryCount);
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

test("a list created on a board is immediately available for agent assignment", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/boards/board-two`);
  await page.getByRole("heading", { name: "Other", exact: true }).waitFor();
  await page.getByRole("button", { name: "New list", exact: true }).click();
  const newListDialog = page.getByRole("dialog", { name: "New list", exact: true });
  await newListDialog.getByLabel("Name", { exact: true }).fill("Launch plan");
  assert.equal(await newListDialog.getByLabel("Board", { exact: true }).count(), 0);
  await newListDialog.getByRole("button", { name: "Create list", exact: true }).click();
  await waitFor(() => state.createdLists.length === 1);
  assert.equal(state.createdLists[0].boardId, "board-two");
  assert.ok(state.requests.includes("POST /api/v1/boards/board-two/buckets"));
  await page.locator('input[data-bucket-name][value="Launch plan"]').waitFor();

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
  assert.equal(await parent.isVisible(), true);

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

  state.delayNextAgentWork = true;
  state.failNextAgentWork = true;
  state.releaseStatus();
  await waitFor(() => state.patches.length === 1);
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
  assert.equal(await parent.isVisible(), true);
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
  await navigateApp(page, "/app/review");
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
  await navigateApp(page, "/app/review");
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

test("post-delete refresh failures report that the task was already deleted", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.getByRole("button", { name: "Open card: Write the doc my boss asked for", exact: true }).click();
  state.failNextWorkspaceTasks = true;
  page.once("dialog", dialog => dialog.accept());
  await deleteTaskDetail(page);

  await page.getByRole("alert").filter({ hasText: "The task was deleted, but this view couldn’t be refreshed: Could not refresh tasks" }).waitFor();
  assert.equal(state.tasks.some(task => task.id === "task-inbox"), false);
  assert.equal(await page.getByText(/Couldn’t delete/).count(), 0);
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

  await navigateApp(page, "/app/today");
  await page.getByRole("heading", { name: "Today", level: 1, exact: true }).waitFor();
  state.releaseWorkspaceTasks();
  await waitFor(() => state.delayedWorkspaceTasksCompleted);
  await page.waitForTimeout(50);

  assert.equal(new URL(page.url()).pathname, "/app/today");
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
  await page.getByRole("button", { name: /Back to (?:cards|board)/ }).click();
  assert.equal(await page.getByText("Loading tasks…", { exact: true }).count(), 0);
  assert.equal(state.tasks.find(task => task.id === "task-parent").title, "Live title during failed refresh");
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

test("background agent subtask creation refreshes list metadata", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
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
  await page.getByLabel("Child card title", { exact: true }).fill("Directory count update");
  state.delayNextSubtask = true;
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await waitFor(() => typeof state.releaseSubtask === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("link", { name: "All agents", exact: true }).click();
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
  await page.getByLabel("Child card title", { exact: true }).fill("New-agent count update");
  state.delayNextSubtask = true;
  await page.getByRole("button", { name: "Add child", exact: true }).click();
  await waitFor(() => typeof state.releaseSubtask === "function");
  await page.getByRole("button", { name: "Back to agent work", exact: true }).click();
  await page.getByRole("link", { name: "All agents", exact: true }).click();
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

  await page.goto(`${origin}/app/week`);
  state.delayNextTaskPatch = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator(`.workspace-week [data-calendar-date="${formatDate(tuesday)}"]`));
  await waitFor(() => typeof state.releaseTaskPatch === "function");
  await page.getByRole("link", { name: "All agents", exact: true }).click();
  await page.getByRole("link", { name: "Research agent", exact: true }).click();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  const purpose = page.locator("#agent-settings-purpose");
  await purpose.fill("Unsaved purpose while parent moves");
  assert.equal(state.lists.find(list => list.id === "list-inbox").openCount, 1);

  Object.assign(state.tasks[0], { bucketId: "list-inbox", listName: "Inbox" });
  state.subtasks.filter(task => task.parentTaskId === "task-parent").forEach(task => Object.assign(task, { bucketId: "list-inbox", listName: "Inbox" }));
  state.lists.find(list => list.id === "list-youtube").openCount = 1;
  state.lists.find(list => list.id === "list-inbox").openCount = 2;
  state.releaseTaskPatch();

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

  await page.goto(`${origin}/app/week`);
  state.delayNextTaskPatch = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator(`.workspace-week [data-calendar-date="${formatDate(tuesday)}"]`));
  await waitFor(() => typeof state.releaseTaskPatch === "function");
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
  state.releaseTaskPatch();

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
  assert.deepEqual(pageErrors, []);
});

test("a delayed parent delete removes its assigned subtasks from agent work", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  state.delayNextDelete = true;
  page.once("dialog", dialog => dialog.accept());
  await deleteTaskDetail(page);
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
  await deleteTaskDetail(page);
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

test("direct settings keeps board navigation and can create a board", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/settings/profile`);
  await page.getByRole("heading", { name: "Profile", exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Boards", exact: true }).isVisible(), true);
  await page.getByRole("button", { name: "New board", exact: true }).click();
  await page.getByRole("heading", { name: "Untitled board", exact: true }).waitFor();
  assert.equal(state.createdBoards.length, 1);
  assert.deepEqual(pageErrors, []);
});

test("a lost Inbox capture response retries without creating a duplicate card", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  state.commitNextInboxThenFail = true;
  await page.getByRole("button", { name: "New card", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Connection lost after capture" }).waitFor();
  assert.equal(state.created.length, 1);

  await page.getByRole("button", { name: "New card", exact: true }).click();
  await page.getByRole("region", { name: "Card detail" }).waitFor();

  assert.equal(state.created.length, 1);
  assert.equal(state.inboxRequestKeys.length, 2);
  assert.ok(state.inboxRequestKeys[0]);
  assert.equal(state.inboxRequestKeys[1], state.inboxRequestKeys[0]);
  assert.deepEqual(pageErrors, []);
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

  await page.getByRole("button", { name: /Back to (?:cards|board)/ }).click();
  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Draft from the new surface");
  state.releaseSubtask();
  await waitFor(() => state.subtasks.some(item => item.title === "Delayed subtask"));
  await page.getByRole("region", { name: "Card detail" }).getByText("Delayed subtask", { exact: true }).waitFor();

  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Draft from the new surface");
  assert.equal(await page.getByRole("region", { name: "Card detail" }).getByText("Delayed subtask", { exact: true }).isVisible(), true);
  assert.equal(await page.getByRole("button", { name: "Add child", exact: true }).isEnabled(), true);
});

test("route navigation clears subtask state before another task opens", async t => {
  const { page } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Child card title", { exact: true }).fill("Must stay with the parent");
  await navigateApp(page, "/app/inbox");
  await page.getByRole("heading", { name: "Inbox", level: 1, exact: true }).waitFor();
  await page.locator('[data-open-task="task-inbox"]').click();

  assert.equal(await page.getByLabel("Child card title", { exact: true }).inputValue(), "");
  assert.equal(await page.getByText("Could not add subtask", { exact: true }).count(), 0);
});

test("a delayed delete cannot close a newer surface and disappears from the overview", async t => {
  const { page, state } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  state.delayNextDelete = true;
  page.once("dialog", dialog => dialog.accept());
  await deleteTaskDetail(page);
  await waitFor(() => typeof state.releaseDelete === "function");

  await page.getByRole("button", { name: /Back to (?:cards|board)/ }).click();
  await page.locator('[data-open-task="task-inbox"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Newer task stays open");
  state.releaseDelete();
  await waitFor(() => !state.tasks.some(item => item.id === "task-parent"));
  await page.waitForTimeout(50);

  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Newer task stays open");
  await page.getByRole("button", { name: /Back to (?:cards|board)/ }).click();
  assert.equal(await page.locator('[data-open-task="task-parent"]').count(), 0);
});

test("a delayed delete closes the same task when it has been reopened", async t => {
  const { page, state } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  state.delayNextDelete = true;
  page.once("dialog", dialog => dialog.accept());
  await deleteTaskDetail(page);
  await waitFor(() => typeof state.releaseDelete === "function");

  await page.getByRole("button", { name: /Back to (?:cards|board)/ }).click();
  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByRole("region", { name: "Card detail" }).waitFor();
  state.releaseDelete();
  await waitFor(() => !state.tasks.some(item => item.id === "task-parent"));
  await page.getByRole("heading", { name: "All cards", exact: true }).waitFor();

  assert.equal(await page.getByRole("region", { name: "Card detail" }).count(), 0);
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

test("task detail autosaves text without a bottom action bar", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  const detail = page.getByRole("region", { name: "Card detail" });
  await detail.waitFor();
  assert.equal(await detail.getByRole("button", { name: "Save changes", exact: true }).count(), 0);
  assert.equal(await detail.locator(".detail-actions").count(), 0);
  assert.equal(await detail.locator('[data-task-save-status][data-state="saved"]').count(), 1);

  const moreActions = page.getByLabel("More card actions", { exact: true });
  await moreActions.focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.getByRole("menuitem", { name: "Delete card", exact: true }).isVisible(), true);
  await page.keyboard.press("Escape");
  assert.equal(await moreActions.evaluate(element => element === document.activeElement), true);

  await page.getByLabel("Title", { exact: true }).fill("Autosaved task title");
  await page.getByLabel("Prompt and context", { exact: true }).fill("Autosaved task description");
  await waitFor(() => state.tasks.find(task => task.id === "task-parent").description === "Autosaved task description", 5000);
  await detail.locator('[data-task-save-status][data-state="saved"]').waitFor();

  assert.equal(state.tasks.find(task => task.id === "task-parent").title, "Autosaved task title");
  assert.equal(state.tasks.find(task => task.id === "task-parent").description, "Autosaved task description");
  assert.ok(state.patches.length <= 2, JSON.stringify(state.patches));
  assert.ok(state.requests.some(request => request === "PATCH /api/v1/tasks/task-parent"));
  assert.equal(state.requests.some(request => request === "PATCH /api/v1/tasks/task-parent/status"), false);
  assert.equal(await detail.isVisible(), true);
  await page.getByRole("button", { name: /Back to (?:cards|board)/ }).click();
  await page.getByText("Autosaved task title", { exact: true }).waitFor();
  assert.deepEqual(pageErrors, []);
});

test("task autosave adopts server-normalized text without resaving forever", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("  Trimmed once  ");
  await title.blur();
  await page.locator('[data-task-save-status][data-state="saved"]').waitFor();
  await page.waitForTimeout(1200);

  assert.equal(await title.inputValue(), "Trimmed once");
  assert.equal(state.tasks.find(task => task.id === "task-parent").title, "Trimmed once");
  assert.equal(state.requests.filter(request => request === "PATCH /api/v1/tasks/task-parent").length, 1);
  assert.deepEqual(pageErrors, []);
});

test("task detail keeps newer edits while an earlier autosave is pending", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  state.delayNextTaskPatch = true;
  await page.getByLabel("Priority", { exact: true }).selectOption("p1");
  await waitFor(() => typeof state.releaseTaskPatch === "function");
  await page.locator('[data-task-save-status][data-state="saving"]').waitFor();

  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Newest title wins");
  assert.equal(await title.isEnabled(), true);
  assert.equal(await page.getByLabel("Priority", { exact: true }).isEnabled(), true);
  state.releaseTaskPatch();

  await waitFor(() => state.patches.length === 2, 5000);
  await page.locator('[data-task-save-status][data-state="saved"]').waitFor();
  assert.equal(state.patches[0].priority, "p1");
  assert.equal(state.patches[1].title, "Newest title wins");
  assert.equal(await title.inputValue(), "Newest title wins");
  assert.equal(state.tasks.find(task => task.id === "task-parent").title, "Newest title wins");
  assert.deepEqual(pageErrors, []);
});

test("task properties save immediately through the correct partial endpoint", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Priority", { exact: true }).selectOption("p1");
  await waitFor(() => state.patches.length === 1);
  await page.getByLabel("Agent", { exact: true }).selectOption("");
  await waitFor(() => state.patches.length === 2);
  await page.getByLabel("Planned", { exact: true }).fill("2026-08-20");
  await waitFor(() => state.patches.length === 3);
  await page.getByLabel("List", { exact: true }).selectOption("list-inbox");
  await waitFor(() => state.patches.length === 4);
  await page.getByLabel("Status", { exact: true }).selectOption("needs_review");
  await waitFor(() => state.patches.length === 5);

  assert.deepEqual(state.patches.map(patch => Object.keys(patch).sort()), [
    ["id", "priority"],
    ["assigneeAgentId", "id"],
    ["id", "scheduledDate"],
    ["bucketId", "id"],
    ["id", "status"],
  ]);
  assert.equal(state.requests.filter(request => request === "PATCH /api/v1/tasks/task-parent").length, 4);
  assert.equal(state.requests.filter(request => request === "PATCH /api/v1/tasks/task-parent/status").length, 1);
  assert.deepEqual(pageErrors, []);
});

test("a queued text autosave preserves a newer Flow completion and count", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/tasks?view=flow`);
  state.delayNextStatus = true;
  await page.locator('[data-task="task-parent"]').dragTo(page.locator('[data-flow-status="done"]'));
  await waitFor(() => typeof state.releaseStatus === "function");

  await navigateApp(page, "/app/agents/agent-research/work?page=2");
  await page.getByRole("button", { name: /Publish task-first agents video/ }).click();
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Title saved after Flow status");
  await title.blur();
  assert.equal(state.patches.length, 0);

  state.releaseStatus();
  await waitFor(() => state.patches.length === 2, 5000);
  await page.locator('[data-task-save-status][data-state="saved"]').waitFor();
  const task = state.tasks.find(item => item.id === "task-parent");
  assert.equal(task.status, "done");
  assert.equal(task.title, "Title saved after Flow status");
  assert.deepEqual(state.patches.map(patch => patch.status || patch.title), ["done", "Title saved after Flow status"]);
  assert.equal(state.lists.find(list => list.id === "list-youtube").openCount, 1);
  assert.deepEqual(pageErrors, []);
});

test("a failed autosave preserves the draft and retries in place", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  state.failNextTaskPatch = true;
  const description = page.getByLabel("Prompt and context", { exact: true });
  await description.fill("Draft retained after failure");
  await description.blur();
  await page.locator('[data-task-save-status][data-state="error"]').waitFor();

  assert.equal(await description.inputValue(), "Draft retained after failure");
  assert.equal(await page.getByRole("button", { name: "Retry", exact: true }).isVisible(), true);
  assert.equal(await page.getByRole("alert").filter({ hasText: "Could not update task" }).count() > 0, true);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.locator('[data-task-save-status][data-state="saved"]').waitFor();

  assert.equal(state.tasks.find(task => task.id === "task-parent").description, "Draft retained after failure");
  assert.equal(await description.inputValue(), "Draft retained after failure");
  assert.deepEqual(pageErrors, []);
});

test("a failed delete keeps the draft tracked and autosaves it", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  await page.getByLabel("Title", { exact: true }).fill("Draft survives failed delete");
  state.failNextDelete = true;
  page.once("dialog", dialog => dialog.accept());
  await deleteTaskDetail(page);
  await page.locator(".detail-error").filter({ hasText: "Could not delete task" }).waitFor();
  await waitFor(() => state.tasks.find(task => task.id === "task-parent").title === "Draft survives failed delete", 5000);
  await page.locator('[data-task-save-status][data-state="saved"]').waitFor();

  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Draft survives failed delete");
  await page.getByRole("button", { name: /Back to (?:cards|board)/ }).click();
  await page.getByText("Draft survives failed delete", { exact: true }).waitFor();
  assert.deepEqual(pageErrors, []);
});

test("navigation waits for an in-flight autosave without prompting", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);
  let dialogs = 0;
  page.on("dialog", dialog => { dialogs += 1; void dialog.dismiss(); });

  await page.locator('[data-open-task="task-parent"]').click();
  state.delayNextTaskPatch = true;
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Saved before navigation");
  await title.blur();
  await waitFor(() => typeof state.releaseTaskPatch === "function");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  assert.equal(await page.getByRole("region", { name: "Card detail" }).isVisible(), true);
  state.releaseTaskPatch();
  await page.getByRole("heading", { name: "Profile", exact: true }).waitFor();

  assert.equal(state.tasks.find(task => task.id === "task-parent").title, "Saved before navigation");
  assert.equal(dialogs, 0);
  assert.deepEqual(pageErrors, []);
});

test("navigation keeps a repeatedly failing draft in the editor", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  state.failNextTaskPatch = true;
  const description = page.getByLabel("Prompt and context", { exact: true });
  await description.fill("Do not discard this draft");
  await description.blur();
  await page.locator('[data-task-save-status][data-state="error"]').waitFor();

  state.failNextTaskPatch = true;
  page.once("dialog", async dialog => {
    assert.equal(dialog.message(), "Changes could not be saved. Leave without saving?");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  assert.equal(await page.getByRole("region", { name: "Card detail" }).isVisible(), true);
  assert.equal(await description.inputValue(), "Do not discard this draft");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.locator('[data-task-save-status][data-state="saved"]').waitFor();
  assert.equal(state.tasks.find(task => task.id === "task-parent").description, "Do not discard this draft");
  assert.deepEqual(pageErrors, []);
});

test("invalid task text stays editable and saves after correction", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("");
  await title.blur();
  await page.getByText("Title is required.", { exact: true }).first().waitFor();
  assert.equal(state.patches.length, 0);
  assert.equal(await title.isEnabled(), true);

  await title.fill("Corrected title");
  await title.blur();
  await page.locator('[data-task-save-status][data-state="saved"]').waitFor();
  assert.equal(state.tasks.find(task => task.id === "task-parent").title, "Corrected title");
  assert.deepEqual(pageErrors, []);
});

test("the page unload guard is active only while task changes are unsaved", async t => {
  const { page, state, pageErrors } = await startWorkspace(t);

  await page.locator('[data-open-task="task-parent"]').click();
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Guard this pending edit");
  const guarded = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(guarded, true);

  await title.blur();
  await waitFor(() => state.tasks.find(task => task.id === "task-parent").title === "Guard this pending edit");
  await page.locator('[data-task-save-status][data-state="saved"]').waitFor();
  const guardedAfterSave = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(guardedAfterSave, false);
  assert.deepEqual(pageErrors, []);
});

test("child cards autosave from agent work and keep their list fixed", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/work?page=2`);
  await page.getByRole("button", { name: /Research examples/ }).click();
  assert.equal(await page.getByLabel("List", { exact: true }).isDisabled(), true);
  const description = page.getByLabel("Prompt and context", { exact: true });
  await description.fill("Autosaved from agent work");
  await description.blur();
  await page.locator('[data-task-save-status][data-state="saved"]').waitFor();

  assert.equal(state.subtasks.find(task => task.id === "task-child").description, "Autosaved from agent work");
  assert.equal(await page.getByRole("button", { name: "Back to parent card", exact: true }).isVisible(), true);
  assert.deepEqual(pageErrors, []);
});

test("agents can be deleted directly from settings", async t => {
  const { page, state, origin, pageErrors } = await startWorkspace(t);

  await page.goto(`${origin}/app/agents/agent-research/settings`);
  await page.getByRole("heading", { name: "Research agent", exact: true }).waitFor();
  await page.locator("#delete-agent").click();
  const dialog = page.getByRole("dialog", { name: "Delete Research agent?", exact: true });
  assert.equal(await dialog.getByText("This cannot be undone.", { exact: false }).isVisible(), true);
  assert.equal(await dialog.getByText("Assigned cards remain and become unassigned.", { exact: false }).isVisible(), true);
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
  if (["/", "/index.html", "/login", "/app", "/app/tasks", "/app/inbox", "/app/today", "/app/week", "/app/review", "/app/settings", "/early-access", "/reset-password"].includes(pathname)) return true;
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

async function deleteTaskDetail(page) {
  await page.getByLabel("More card actions", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete card", exact: true }).click();
}

async function navigateApp(page, target) {
  await page.evaluate(pathname => {
    history.pushState({}, "", pathname);
    dispatchEvent(new PopStateEvent("popstate"));
  }, target);
}
