const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const filename = path.join(__dirname, "app.js");
const source = fs.readFileSync(filename, "utf8").replace(/\nboot\(\);\s*$/, "");
const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
const index = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const cliGuide = fs.readFileSync(path.join(__dirname, "cli.html"), "utf8");
const favicon = fs.readFileSync(path.join(__dirname, "favicon.svg"), "utf8");
const app = { console, Date, URLSearchParams, window: { addEventListener() {} } };
vm.createContext(app);
vm.runInContext(source, app, { filename });

test("the app provides its branded favicon", () => {
  assert.match(index, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/);
  assert.match(favicon, /<rect[^>]*fill="#4f5bc2"/);
});

test("landing and docs pages use Castoro for serif text", () => {
  const castoroImport = /family=Castoro:ital@0;1/;

  assert.match(index, castoroImport);
  assert.match(cliGuide, castoroImport);
  assert.match(styles, /--serif: "Castoro", "Iowan Old Style", Georgia, "Times New Roman", serif;/);
  assert.doesNotMatch(`${index}\n${cliGuide}\n${styles}`, /Newsreader/);
});

test("theme palettes use neutral surfaces and an indigo accent", () => {
  const light = themeTokens(":root");
  const dark = themeTokens(".theme-dark");

  assert.match(styles, /--bg: #f7f7f8;/);
  assert.match(styles, /--panel: #f1f1f3;/);
  assert.match(styles, /--bg: #0f1011;/);
  assert.match(styles, /--panel: #151617;/);
  assert.match(styles, /--card: #1b1c1e;/);
  assert.match(styles, /--accent: #8791f0;/);
  assert.doesNotMatch(styles, /#111411|#151815|#191d19|#2d332e|#68bc8a/);
  for (const theme of [light, dark]) {
    for (const surface of ["bg", "panel", "card"]) {
      assert.ok(contrastRatio(theme.faint, theme[surface]) >= 4.5, `muted text must remain readable on ${surface}`);
    }
    const badgeBackground = mixColors(theme.accent, theme.card, 0.13);
    assert.ok(contrastRatio(theme.accent, badgeBackground) >= 4.5, "accent badges must remain readable");
  }
});

test("brand wordmark has no gap before the domain", () => {
  assert.match(styles, /\.brand \{[^}]*gap: 0;/);
  assert.match(styles, /\.brand::before \{[^}]*margin-right: 8px;/);
});

test("the landing page links to the CLI guide", () => {
  const html = app.landingHTML();
  assert.match(html, /href="\/cli">CLI guide<\/a>/);
});

test("the landing page leads with the dream outcome", () => {
  const html = app.landingHTML();

  assert.match(html, /Stay on top of everything\. <em>Operate at agent speed\.<\/em>/);
  assert.match(html, /emails, projects, commitments, and loose ends/);
  assert.match(html, /surface what needs your attention, and execute the work/);
});

test("the CLI guide covers installation, authentication, and agent workflows", () => {
  assert.match(cliGuide, /curl -fsSL https:\/\/raw\.githubusercontent\.com\/owainlewis\/slate\.do\/main\/install\.sh \| sh/);
  assert.match(cliGuide, /export SLATE_API_TOKEN=slate_\.\.\./);
  assert.match(cliGuide, /slate tasks claim &lt;task-id&gt;/);
  assert.match(cliGuide, /CLAUDE\.md/);
  assert.match(cliGuide, /AGENTS\.md/);
  assert.match(cliGuide, /Poll no faster than once every five seconds/);
  assert.match(cliGuide, /Retry-After/);
});

test("early access form shows every required field and password requirements", () => {
  const html = app.earlyAccessHTML();
  assert.match(html, /id="early-access-form" method="post" action="\/api\/v1\/auth\/register"/);
  assert.match(html, /name="email" type="email"/);
  assert.match(html, /name="password" type="password"[^>]*minlength="8"[^>]*maxlength="72"/);
  assert.match(html, /Use at least 8 characters, up to 72 bytes/);
  assert.match(html, /name="inviteCode" type="password"/);
  assert.match(source, /establishAuthenticatedSession\("\/api\/v1\/auth\/register"/);
  assert.doesNotMatch(source, /early-access\?[^"'`]*/);
});

test("password reset forms collect email and a secure replacement password", () => {
  const login = app.loginHTML();
  const forgot = app.forgotPasswordHTML();
  vm.runInContext(`state.resetToken = "reset_secret"`, app);
  const reset = app.resetPasswordHTML();

  assert.match(login, /id="forgot-password"/);
  assert.match(forgot, /id="forgot-password-form"/);
  assert.match(forgot, /name="email" type="email"/);
  assert.match(forgot, /class="notice reset-notice" role="status"><\/p>\s*<button class="auth-link" id="back-to-login"/);
  assert.match(styles, /\.login \.reset-notice:empty \{ display: none; \}/);
  assert.match(reset, /id="reset-password-form"/);
  assert.match(reset, /name="password" type="password"[^>]*minlength="8"[^>]*maxlength="72"/);
  assert.match(reset, /Use at least 8 characters, up to 72 bytes/);
  assert.match(source, /api\.post\("\/api\/v1\/auth\/password-reset\/request"/);
  assert.match(source, /api\.post\("\/api\/v1\/auth\/password-reset\/confirm"/);
  assert.match(source, /history\.replaceState\(\{\}, "", RESET_PASSWORD_PATH\)/);
  vm.runInContext(`state.resetToken = ""`, app);
});

test("sidebar makes cards, boards, and agents the primary control plane", () => {
  vm.runInContext(`
    state.boards = [{ id: "content", name: "Content" }];
    state.workspaceScope = "all";
  `, app);

  const html = app.appHTML();
  for (const label of ["Attention", "Inbox", "Today", "Review", "Plan", "Week", "All cards", "Boards", "Content", "Agents"]) assert.match(html, new RegExp(`>${label}<`));
  assert.match(html, /data-board="content"><span>Content<\/span>/);
  assert.match(html, /id="new-board"/);
  assert.doesNotMatch(html, /board limit reached|active item limit reached/i);
  vm.runInContext(`state.boards = [];`, app);
});

test("shared-shell routes load one account-wide list index and discard stale responses", async () => {
  let resolveListIndex;
  app.pendingListIndex = new Promise(resolve => { resolveListIndex = resolve; });
  vm.runInContext(`
    savedListIndexGet = api.get;
    authVersion = 7;
    routeVersion = 41;
    state.me = { id: "owner" };
    state.workspaceLists = [{ id: "current", boardId: "board-one", name: "Current" }];
    api.get = async path => {
      if (path !== "/api/v1/lists") throw new Error("unexpected path " + path);
      return pendingListIndex;
    };
  `, app);

  const loading = app.loadWorkspaceListIndex(41);
  vm.runInContext(`routeVersion = 42;`, app);
  resolveListIndex({ lists: [{ id: "stale", boardId: "board-one", name: "Stale" }] });

  assert.equal(await loading, false);
  assert.equal(vm.runInContext(`state.workspaceLists[0].id`, app), "current");
  vm.runInContext(`api.get = savedListIndexGet; state.me = null; state.workspaceLists = [];`, app);
  delete app.pendingListIndex;
});

test("workspace reloads refresh list metadata and tasks under one route guard", async () => {
  app.location = { pathname: "/app/tasks", search: "" };
  vm.runInContext(`
    savedReloadListIndex = loadWorkspaceListIndex;
    savedReloadWorkspace = loadWorkspace;
    savedReloadRender = render;
    routeVersion = 45;
    reloadCalls = [];
    loadWorkspaceListIndex = async version => {
      reloadCalls.push({ kind: "lists", version });
      state.workspaceLists = [{ id: "inbox", openCount: 2 }];
      return true;
    };
    loadWorkspace = async (route, version) => {
      reloadCalls.push({ kind: "tasks", version, scope: route.scope });
      state.workspaceTasks = [{ id: "task" }];
      return true;
    };
    render = () => { reloadCalls.push({ kind: "render" }); };
  `, app);

  assert.equal(await app.reload(), true);
  assert.deepEqual(JSON.parse(vm.runInContext(`JSON.stringify(reloadCalls)`, app)), [
    { kind: "lists", version: 45 },
    { kind: "tasks", version: 45, scope: "all" },
    { kind: "render" },
  ]);
  assert.equal(vm.runInContext(`state.workspaceLists[0].openCount`, app), 2);

  vm.runInContext(`
    loadWorkspaceListIndex = savedReloadListIndex;
    loadWorkspace = savedReloadWorkspace;
    render = savedReloadRender;
    state.workspaceLists = [];
    state.workspaceTasks = [];
  `, app);
  delete app.location;
});

test("New list is bound centrally for shared-shell and settings routes", () => {
  const shellStart = source.indexOf("function bindAppShell()");
  const shellEnd = source.indexOf("async function captureInboxTask", shellStart);
  const controlStart = source.indexOf("function bindWorkspaceListControl()");
  const controlEnd = source.indexOf("async function captureInboxTask", controlStart);
  const settingsStart = source.indexOf("async function bindSettings()");
  const settingsEnd = source.indexOf("function bindAgents()", settingsStart);
  const workspaceStart = source.indexOf("function bindWorkspace()");
  const workspaceEnd = source.indexOf("function bindWorkspaceDetail(options = {})", workspaceStart);

  assert.match(source.slice(shellStart, shellEnd), /bindWorkspaceListControl\(\)/);
  assert.match(source.slice(controlStart, controlEnd), /#new-workspace-list/);
  assert.match(source.slice(controlStart, controlEnd), /workspaceListDialog = "create"/);
  assert.match(source.slice(settingsStart, settingsEnd), /bindWorkspaceListControl\(\)/);
  assert.doesNotMatch(source.slice(workspaceStart, workspaceEnd), /#new-workspace-list/);
});

test("New list chooses a board with capacity and updates account-wide state immediately", async () => {
  vm.runInContext(`
    savedWorkspaceListRender = render;
    savedWorkspaceListPost = api.post;
    render = () => {};
    workspaceListPosts = [];
    api.post = async (path, input) => {
      workspaceListPosts.push({ path, input });
      return { id: "list-created", name: input.name };
    };
    authVersion = 8;
    routeVersion = 51;
    state.me = { id: "owner" };
    state.maxListsPerBoard = 2;
    state.boards = [{ id: "board-full", name: "Full" }, { id: "board-open", name: "Open" }];
    state.board = { id: "board-full", name: "Full", buckets: [] };
    state.workspaceLists = [
      { id: "full-one", boardId: "board-full", name: "One" },
      { id: "full-two", boardId: "board-full", name: "Two" },
      { id: "open-one", boardId: "board-open", name: "Existing" },
    ];
    state.workspaceListError = "";
    state.workspaceListPending = false;
  `, app);

  assert.equal(await app.createWorkspaceList(" Launch plan "), true);
  const posts = JSON.parse(vm.runInContext(`JSON.stringify(workspaceListPosts)`, app));
  assert.deepEqual(posts, [{ path: "/api/v1/boards/board-open/buckets", input: { name: "Launch plan" } }]);
  assert.equal(vm.runInContext(`state.workspaceLists.find(list => list.id === "list-created").boardId`, app), "board-open");
  assert.equal(vm.runInContext(`assignmentListsForBoard("board-open").some(list => list.id === "list-created")`, app), true);
  assert.equal(vm.runInContext(`state.workspaceListPending`, app), false);

  vm.runInContext(`
    render = savedWorkspaceListRender;
    api.post = savedWorkspaceListPost;
    state.me = null;
    state.boards = [];
    state.board = null;
    state.workspaceLists = [];
  `, app);
});

test("New list reports exhausted capacity without sending a request", async () => {
  vm.runInContext(`
    savedNoCapacityRender = render;
    savedNoCapacityPost = api.post;
    render = () => {};
    noCapacityPosts = 0;
    api.post = async () => { noCapacityPosts += 1; throw new Error("must not post"); };
    authVersion = 9;
    routeVersion = 61;
    state.me = { id: "owner" };
    state.maxListsPerBoard = 1;
    state.boards = [{ id: "board-full", name: "Full" }];
    state.workspaceLists = [{ id: "only-list", boardId: "board-full", name: "Only" }];
    state.workspaceListError = "";
    state.workspaceListPending = false;
  `, app);

  assert.equal(await app.createWorkspaceList("Blocked"), false);
  assert.equal(vm.runInContext(`noCapacityPosts`, app), 0);
  assert.equal(vm.runInContext(`state.workspaceListDialogError`, app), "No room for another list.");

  vm.runInContext(`
    render = savedNoCapacityRender;
    api.post = savedNoCapacityPost;
    state.me = null;
    state.boards = [];
    state.workspaceLists = [];
  `, app);
});

test("the product no longer promises hard item limits", () => {
	const landing = app.landingHTML();
	assert.match(landing, /Lists for clear thinking/);
	assert.doesNotMatch(landing, /Every list caps|list is full/i);
});

test("Today and Week keep their planned-date scope when other filters are applied", () => {
	app.location = { search: "?q=brief&plannedFrom=2030-01-01&plannedTo=2030-01-31" };
	const today = app.workspaceQuery({ scope: "today" }).toString();
	const week = app.workspaceQuery({ scope: "week" }).toString();
	assert.match(today, /q=brief/);
	assert.doesNotMatch(today, /2030-01/);
	assert.match(week, /q=brief/);
	assert.doesNotMatch(week, /2030-01/);
	delete app.location;
});

test("Week exposes its calendar and filters without unrelated view tabs", () => {
  vm.runInContext(`
    state.me = { id: "owner", displayName: "Owain", theme: "dark" };
    state.workspaceScope = "week";
    state.workspaceTasks = [];
    state.workspaceLoading = false;
    state.workspaceFiltersOpen = false;
  `, app);

  const html = app.appHTML();
  assert.match(html, /class="workspace-viewbar week-only"/);
  assert.match(html, /id="workspace-filter-toggle"/);
  assert.match(html, /class="workspace-week" aria-label="Week calendar"/);
  assert.match(html, /data-calendar-date=/);
  assert.doesNotMatch(html, /aria-label="Task view"/);
  assert.doesNotMatch(html, /data-workspace-view=/);
  assert.match(styles, /\.workspace-week \[data-calendar-date\]\.drop-into/);

  vm.runInContext(`
    state.me = null;
    state.workspaceScope = "all";
    state.workspaceTasks = [];
    state.workspaceLoading = false;
  `, app);
});

test("Review owns its status scope without showing a conflicting status filter", () => {
  app.location = { search: "?status=working&q=brief" };
  vm.runInContext(`state.workspaceScope = "review";`, app);
  assert.equal(app.workspaceFilterCount(), 1);
  assert.doesNotMatch(app.workspaceFilterHTML(), /name="status"/);
  const query = app.workspaceQuery({ scope: "review" }).toString();
  assert.match(query, /status=needs_review/);
  assert.doesNotMatch(query, /status=working/);
  vm.runInContext(`state.workspaceScope = "all";`, app);
  delete app.location;
});

test("global scopes include subtasks while Inbox and individual lists remain parent rollups", () => {
  app.location = { search: "" };
  for (const scope of ["all", "today", "week", "review"]) {
    assert.equal(app.workspaceQuery({ scope }).has("topLevel"), false, `${scope} should include subtasks`);
  }
  assert.equal(app.workspaceQuery({ scope: "inbox" }).get("topLevel"), "true");
  assert.equal(app.workspaceQuery({ scope: "list", listId: "youtube" }).get("topLevel"), "true");
  const paged = app.workspaceQuery({ scope: "all" }, "next-page");
  assert.equal(paged.get("cursor"), "next-page");
  assert.equal(paged.has("topLevel"), false);
  delete app.location;
});

test("default board creation stays incomplete when either default list fails", async () => {
  vm.runInContext(`
    state.me = { id: "owner", theme: "light" };
    state.boards = [{ id: "existing", name: "Existing" }];
    state.error = "";
    defaultBoardPostCalls = [];
    defaultBoardRefreshes = [];
    defaultBoardListRefreshes = 0;
    savedLoadBoards = loadBoards;
    savedLoadBoardList = loadBoardList;
    loadBoards = async id => { defaultBoardRefreshes.push(id); return true; };
    loadBoardList = async () => { defaultBoardListRefreshes += 1; return true; };
    defaultBoardFailureAt = 2;
    api.post = async (path, input) => {
      defaultBoardPostCalls.push({ path, input });
      if (defaultBoardPostCalls.length === 1) return { id: "partial-board" };
      if (defaultBoardPostCalls.length === defaultBoardFailureAt) throw new Error("Default list failed");
      return { id: "list" };
    };
  `, app);

  const firstFailure = await app.createDefaultBoard();
  assert.equal(firstFailure.complete, false);
  assert.equal(vm.runInContext("defaultBoardPostCalls.length", app), 2);
  assert.equal(vm.runInContext("defaultBoardListRefreshes", app), 1);
  assert.deepEqual(JSON.parse(vm.runInContext("JSON.stringify(defaultBoardRefreshes)", app)), []);
  assert.equal(vm.runInContext("state.error", app), "Default list failed");

  vm.runInContext(`
    defaultBoardPostCalls = [];
    defaultBoardListRefreshes = 0;
    defaultBoardFailureAt = 3;
    state.error = "";
  `, app);
  const secondFailure = await app.createDefaultBoard();
  assert.equal(secondFailure.complete, false);
  assert.equal(vm.runInContext("defaultBoardPostCalls.length", app), 3);
  assert.equal(vm.runInContext("defaultBoardListRefreshes", app), 1);
  assert.deepEqual(JSON.parse(vm.runInContext("JSON.stringify(defaultBoardRefreshes)", app)), []);
  assert.equal(vm.runInContext("state.error", app), "Default list failed");

  vm.runInContext(`
    state.view = "agents";
    state.agentsLoadState = "ready";
    state.agents = [{ id: "agent", displayName: "Builder", credential: {}, workCounts: {} }];
  `, app);
  assert.match(app.agentsHTML(), /class="status-error" role="alert">Default list failed/);
  vm.runInContext(`
    loadBoards = savedLoadBoards;
    loadBoardList = savedLoadBoardList;
    state.me = null;
    state.boards = [];
    state.agents = [];
    state.error = "";
    state.view = "home";
  `, app);
});

test("board rows expose an inline rename form with save and cancel controls", () => {
  vm.runInContext(`
    state.boards = [{ id: "board-one", name: "Business" }];
    state.board = { id: "board-one", name: "Business", buckets: [] };
    state.renamingBoardId = "";
  `, app);

  const row = app.boardRowHTML({ id: "board-one", name: "Business" });
  assert.match(row, /data-start-rename-board="board-one"[^>]*aria-label="Rename Business"/);
  assert.match(row, /data-delete-board="board-one"[^>]*aria-label="Delete Business"/);

  vm.runInContext(`state.renamingBoardId = "board-one";`, app);
  const editing = app.boardRowHTML({ id: "board-one", name: "Business" });
  assert.match(editing, /data-rename-board="board-one"/);
  assert.match(editing, /name="name" aria-label="Board name"/);
  assert.match(editing, /aria-label="Save board name"/);
  assert.match(editing, /aria-label="Cancel board rename"/);
  assert.match(editing, /class="error board-rename-error"[^>]*role="alert"/);
  assert.match(styles, /\.board-rename-controls input\[aria-invalid="true"\] \{ border-color: var\(--danger\); \}/);

  vm.runInContext(`state.boards = []; state.board = null; state.renamingBoardId = "";`, app);
});

test("renaming trims and updates board names without replacing selected board content", async () => {
  const calls = [];
  app.renameCalls = calls;
  vm.runInContext(`
    authVersion = 7;
    state.me = { id: "owner" };
    state.boards = [{ id: "board-one", name: "Business", sortOrder: 0 }];
    state.board = {
      id: "board-one", name: "Business", sortOrder: 0,
      buckets: [{ id: "list-one", name: "Ideas", tasks: [{ id: "task-one" }] }],
    };
    state.selectedTask = state.board.buckets[0].tasks[0];
    state.boardMode = "flow";
    state.renamingBoardId = "board-one";
    api.patch = async (path, input) => {
      renameCalls.push({ path, input });
      return { id: "board-one", name: input.name, sortOrder: 0 };
    };
  `, app);

  assert.equal(await app.renameBoard("board-one", "  Growth plan  "), true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ path: "/api/v1/boards/board-one", input: { name: "Growth plan" } }]);
  assert.equal(vm.runInContext("state.boards[0].name", app), "Growth plan");
  assert.equal(vm.runInContext("state.board.name", app), "Growth plan");
  assert.equal(vm.runInContext("state.board.buckets[0].name", app), "Ideas");
  assert.equal(vm.runInContext("state.selectedTask.id", app), "task-one");
  assert.equal(vm.runInContext("state.boardMode", app), "flow");
  assert.equal(vm.runInContext("state.renamingBoardId", app), "");

  await assert.rejects(app.renameBoard("board-one", "   "), /Board name is required/);
  assert.equal(calls.length, 1);
  vm.runInContext(`state.me = null; state.boards = []; state.board = null; state.selectedTask = null;`, app);
});

test("a rejected board rename leaves local state unchanged", async () => {
  vm.runInContext(`
    authVersion = 8;
    state.me = { id: "owner" };
    state.boards = [{ id: "board-one", name: "Business" }];
    state.board = { id: "board-one", name: "Business", buckets: [{ id: "list-one" }] };
    state.renamingBoardId = "board-one";
    api.patch = async () => { throw new Error("not found"); };
  `, app);

  await assert.rejects(app.renameBoard("board-one", "Growth"), /not found/);
  assert.equal(vm.runInContext("state.boards[0].name", app), "Business");
  assert.equal(vm.runInContext("state.board.name", app), "Business");
  assert.equal(vm.runInContext("state.board.buckets[0].id", app), "list-one");
  assert.equal(vm.runInContext("state.renamingBoardId", app), "board-one");
  vm.runInContext(`state.me = null; state.boards = []; state.board = null; state.renamingBoardId = "";`, app);
});

test("primary navigation uses distinct icons and keeps readable labels", () => {
  vm.runInContext(`
    state.boards = [{ id: "board", name: "Board" }];
    state.board = { id: "board", name: "Board", maxTasksPerList: 12, buckets: [] };
    state.boardMode = "lists";
    state.workspaceScope = "all";
    state.workspaceView = "board";
  `, app);

  const html = app.appHTML();
  for (const [view, label] of [["board", "Board"], ["flow", "Flow"], ["table", "Table"]]) {
    assert.match(html, new RegExp(`id="workspace-tab-${view}"[^>]*data-workspace-view="${view}"[^>]*role="tab"[^>]*aria-controls="workspace-task-panel"[^>]*>[\\s\\S]*?<span>${label}</span>`));
  }
  assert.match(html, /id="workspace-tab-board"[^>]*tabindex="0"[^>]*aria-selected="true"/);
  assert.match(html, /id="workspace-task-panel" role="tabpanel" tabindex="0" aria-labelledby="workspace-tab-board"/);
  assert.match(html, /id="new-task"/);
  assert.match(html, /id="workspace-filter-toggle"/);
  assert.match(html, /data-set-theme="light"[\s\S]*?<span>Light<\/span>/);
  assert.match(html, /data-set-theme="dark"[\s\S]*?<span>Dark<\/span>/);
  assert.match(html, /class="theme-switch light"[\s\S]*?id="settings"/);
  assert.match(html, /id="settings"[\s\S]*?<span>Settings<\/span>/);
  assert.match(html, /id="logout"[\s\S]*?<span>Sign out<\/span>/);
  assert.doesNotMatch(html, /data-board-settings|Board settings/);
  vm.runInContext(`state.boards = []; state.board = null;`, app);
});

test("the card table exposes native headers, cells, and keyboard-operable rows", () => {
  vm.runInContext(`
    state.me = { id: "owner", displayName: "Owain" };
    state.agents = [];
  `, app);
  const html = app.workspaceTableHTML([{
    id: "task-one", title: "Accessible task", listName: "Inbox", status: "queued",
    priority: "p1", scheduledDate: "2026-08-05", done: false, assigneeAgentId: "",
  }]);

  assert.match(html, /^<table class="workspace-table" aria-label="Cards">/);
  for (const heading of ["Card", "List", "Status", "Priority", "Owner", "Planned"]) {
    assert.match(html, new RegExp(`<th scope="col">${heading}<\\/th>`));
  }
  assert.match(html, /<tr class="workspace-table-row" data-task-row>/);
  assert.doesNotMatch(html, /workspace-completion-toggle|data-toggle-done/);
  assert.match(html, /<button type="button" class="workspace-table-open" data-open-task="task-one" aria-label="Open card: Accessible task"><strong>Accessible task<\/strong><\/button>/);
  assert.doesNotMatch(html, /<section class="workspace-table"|<tr[^>]*tabindex=/);
  vm.runInContext(`state.me = null; state.agents = [];`, app);
});

test("every global card view identifies child cards with parent context", () => {
  vm.runInContext(`state.me = { id: "owner", displayName: "Owain" }; state.agents = []; state.workspaceLists = [{ id: "product", name: "Product", boardId: "board" }];`, app);
  const planned = app.dateKey(app.startOfWeek(new Date()));
  const subtask = {
    id: "child", parentTaskId: "parent", parentTaskTitle: "Parent & plan", bucketId: "product", title: "Research", listName: "Product",
    status: "needs_review", priority: "", scheduledDate: planned, done: false, assigneeAgentId: "",
  };
  for (const html of [
    app.workspaceListHTML([subtask]),
    app.workspaceTableHTML([subtask]),
    app.workspaceBoardHTML([subtask]),
    app.workspaceFlowHTML([subtask]),
    app.workspaceWeekHTML([subtask]),
  ]) {
    assert.match(html, /Child of Parent &amp; plan/);
  }
  vm.runInContext(`state.me = null; state.workspaceLists = [];`, app);
});

test("Board keeps empty selected and Inbox lists visible", () => {
  vm.runInContext(`
    state.workspaceLists = [
      { id: "inbox", boardId: "board", name: "Inbox", isInbox: true },
      { id: "planning", boardId: "board", name: "Planning", isInbox: false },
    ];
    state.workspaceScope = "list";
    state.workspaceListID = "planning";
  `, app);
  assert.match(app.workspaceBoardHTML([]), /data-kanban-list="planning"/);
  assert.match(app.workspaceBoardHTML([]), /<h2>Planning<\/h2>/);

  vm.runInContext(`state.workspaceScope = "inbox"; state.workspaceListID = "";`, app);
  const inbox = app.workspaceBoardHTML([]);
  assert.match(inbox, /data-kanban-list="inbox"/);
  assert.doesNotMatch(inbox, /data-kanban-list="planning"/);
  vm.runInContext(`state.workspaceScope = "all"; state.workspaceLists = [];`, app);
});

test("subtask detail keeps its list fixed to the parent", () => {
  vm.runInContext(`
    state.workspaceLists = [{ id: "list-one", name: "Product", isInbox: false }];
    state.selectedTask = { id: "child", parentTaskId: "parent", bucketId: "list-one", title: "Review", description: "", status: "queued", priority: "", assigneeAgentId: "", scheduledDate: "" };
    state.selectedSubtasks = [];
  `, app);
  const html = vm.runInContext(`workspaceDetailHTML(state.selectedTask)`, app);
  assert.match(html, /id="workspace-detail-list" disabled aria-describedby="workspace-detail-list-help"/);
  assert.doesNotMatch(html, /name="bucketId"/);
  assert.match(html, /Child cards stay with their parent card\./);
});

test("agent work renders the shared inline task detail with parent context", () => {
  vm.runInContext(`
    state.view = "agent-work";
    state.workspaceLists = [{ id: "list-one", boardId: "board-one", name: "Product" }];
    state.selectedTask = { id: "parent", bucketId: "list-one", title: "Prepare launch", description: "", status: "working", priority: "p1", assigneeAgentId: "agent-one", scheduledDate: "" };
    state.selectedSubtasks = [{ id: "child", parentTaskId: "parent", bucketId: "list-one", title: "Review", status: "done", done: true }];
  `, app);
  const html = app.agentDetailHTML();
  assert.match(html, /class="main workspace-main card-detail-main agent-task-main"/);
  assert.match(html, /class="workspace-detail" aria-label="Card detail"/);
  assert.match(html, />Back to agent work<\/span>/);
  assert.match(html, /1 of 1 done/);
  assert.match(html, /Review/);
  assert.doesNotMatch(html, /data-detail-overlay|aria-modal="true"|id="detail-form"/);
  vm.runInContext(`state.view = "home"; state.selectedTask = null; state.selectedSubtasks = []; state.workspaceLists = [];`, app);
});

test("completed history pages append to a list and preserve the next cursor", async () => {
  vm.runInContext(`
    savedHistoryRender = render;
    savedHistoryGet = api.get;
    render = () => {};
    document = { querySelector() { return null; } };
    CSS = { escape(value) { return value; } };
    authVersion = 4;
    routeVersion = 7;
    state.me = { id: "owner" };
    state.board = {
      id: "board-one",
      buckets: [{ id: "list-one", completedNextCursor: "cursor-one", tasks: [{ id: "active", done: false }] }],
    };
    historyRequests = [];
    api.get = async path => {
      historyRequests.push(path);
      return { tasks: [{ id: "older", bucketId: "list-one", done: true }], nextCursor: "cursor-two" };
    };
  `, app);

  await app.loadCompletedHistory("list-one");
  assert.deepEqual(JSON.parse(vm.runInContext("JSON.stringify(historyRequests)", app)), [
    "/api/v1/tasks?bucketId=list-one&done=true&limit=20&cursor=cursor-one",
  ]);
  assert.deepEqual(JSON.parse(vm.runInContext("JSON.stringify(state.board.buckets[0].tasks.map(task => task.id))", app)), ["active", "older"]);
  assert.equal(vm.runInContext("state.board.buckets[0].completedNextCursor", app), "cursor-two");
  const html = app.listHTML(vm.runInContext("state.board.buckets[0]", app));
  assert.match(html, /data-load-completed="list-one">Load older completed/);

  vm.runInContext(`
    render = savedHistoryRender;
    api.get = savedHistoryGet;
    state.me = null;
    state.board = null;
  `, app);
});

test("opening a task loads its full description and subtasks", async () => {
  vm.runInContext(`
    savedDetailRender = render;
    savedDetailGet = api.get;
    render = () => {};
    authVersion = 9;
    routeVersion = 11;
    state.me = { id: "owner" };
    state.board = { id: "board-one", buckets: [{ id: "list-one", tasks: [{ id: "task-one", bucketId: "list-one", title: "Summary" }] }] };
    detailRequests = [];
    api.get = async path => {
      detailRequests.push(path);
      if (path.includes("parentTaskId=") && path.includes("cursor=children-two")) {
        return { tasks: [{ id: "subtask-two", parentTaskId: "task-one", title: "Review" }] };
      }
      if (path.includes("parentTaskId=")) {
        return { tasks: [{ id: "subtask-one", parentTaskId: "task-one", title: "Research" }], nextCursor: "children-two" };
      }
      if (path === "/api/v1/cards/task-one/entries") return { entries: [] };
      return { id: "task-one", bucketId: "list-one", title: "Summary", description: "Full private detail" };
    };
  `, app);

  assert.equal(await app.openTaskDetail("task-one"), true);
  assert.deepEqual(JSON.parse(vm.runInContext("JSON.stringify(detailRequests)", app)), [
    "/api/v1/tasks/task-one",
    "/api/v1/tasks?parentTaskId=task-one&limit=200",
    "/api/v1/cards/task-one/entries",
    "/api/v1/tasks?parentTaskId=task-one&limit=200&cursor=children-two",
  ]);
  assert.equal(vm.runInContext("state.selectedTask.description", app), "Full private detail");
  assert.equal(vm.runInContext("state.selectedSubtasks[0].parentTaskId", app), "task-one");
  assert.equal(vm.runInContext("state.selectedSubtasks.length", app), 2);

  vm.runInContext(`
    state.board.buckets[0].tasks = [];
    state.selectedTask = null;
  `, app);
  assert.equal(await app.openTaskDetail("task-one"), true);
  assert.deepEqual(JSON.parse(vm.runInContext("JSON.stringify(detailRequests)", app)), [
    "/api/v1/tasks/task-one",
    "/api/v1/tasks?parentTaskId=task-one&limit=200",
    "/api/v1/cards/task-one/entries",
    "/api/v1/tasks?parentTaskId=task-one&limit=200&cursor=children-two",
    "/api/v1/tasks/task-one",
    "/api/v1/tasks?parentTaskId=task-one&limit=200",
    "/api/v1/cards/task-one/entries",
    "/api/v1/tasks?parentTaskId=task-one&limit=200&cursor=children-two",
  ]);
  assert.equal(vm.runInContext("state.selectedTask.description", app), "Full private detail");

  vm.runInContext(`
    render = savedDetailRender;
    api.get = savedDetailGet;
    state.me = null;
    state.board = null;
    state.selectedTask = null;
  `, app);
});

test("loading more tasks cannot append an old list response after navigation", async () => {
  app.location = { pathname: "/app/lists/list-a", search: "" };
  vm.runInContext(`
    savedWorkspaceRender = render;
    savedWorkspaceGet = api.get;
    render = () => {};
    authVersion = 12;
    routeVersion = 20;
    state.me = { id: "owner" };
    state.workspaceTasks = [{ id: "list-a-task" }];
    state.workspaceNextCursor = "next-page";
    state.workspaceLoading = false;
    api.get = () => new Promise(resolve => { resolveOldWorkspacePage = resolve; });
  `, app);

  const pending = app.loadMoreWorkspaceTasks();
  vm.runInContext(`
    routeVersion = 21;
    state.workspaceTasks = [{ id: "list-b-task" }];
    state.workspaceNextCursor = "";
    state.workspaceLoading = false;
    resolveOldWorkspacePage({ tasks: [{ id: "stale-list-a-task" }], nextCursor: "" });
  `, app);
  await pending;
  assert.deepEqual(JSON.parse(vm.runInContext("JSON.stringify(state.workspaceTasks.map(task => task.id))", app)), ["list-b-task"]);

  vm.runInContext(`
    render = savedWorkspaceRender;
    api.get = savedWorkspaceGet;
    state.me = null;
    state.workspaceTasks = [];
  `, app);
  delete app.location;
});

test("lists never block task creation when their legacy count is reached", () => {
	vm.runInContext(`
		state.me = { entitlement: { plan: "pro", source: "manual", limits: { boards: 5, listsPerBoard: 9, activeItemsPerList: 20 } } };
		state.maxListsPerBoard = 9;
		state.boards = [{ id: "board", name: "Board" }];
		state.board = {
			id: "board", name: "Board", maxTasksPerList: 20,
			buckets: Array.from({ length: 9 }, (_, index) => ({
				id: "list-" + index, name: "List " + index, openCount: index === 0 ? 20 : 0,
				limitCount: 20, tasks: [],
			})),
		};
		state.boardMode = "lists";
	`, app);

	const html = app.appHTML();
	const legacyList = app.listHTML(vm.runInContext("state.board.buckets[0]", app));
	assert.match(legacyList, /data-add-task="list-0"/);
	assert.match(legacyList, /placeholder="Add item"/);
	assert.doesNotMatch(legacyList, /disabled|active item limit reached/i);
	assert.equal(app.accountLimits().boards, 5);
	vm.runInContext(`state.me = null; state.boards = []; state.board = null;`, app);
});

test("account limits still govern credentials without leaking list item limits", () => {
	vm.runInContext(`
		state.me = { id: "free-user", entitlement: { plan: "free", source: "free", limits: { boards: 1, listsPerBoard: 5, activeItemsPerList: 20, agents: 1, storedTasks: 500, storedContentBytes: 10485760, apiTokens: 3 } } };
		state.maxBoards = 1;
		state.maxListsPerBoard = 5;
		state.maxAgents = 1;
		state.activeAgents = 1;
		state.boards = [{ id: "board", name: "Board" }];
		state.board = { id: "board", name: "Board", maxTasksPerList: 20, buckets: Array.from({ length: 5 }, (_, index) => ({ id: "list-" + index, name: "List " + index, openCount: 0, limitCount: 20, tasks: [] })) };
		state.boardMode = "lists";
	`, app);

	const boardHTML = app.appHTML();
	assert.doesNotMatch(boardHTML, /active item limit reached/i);
	assert.equal(app.accountLimits().boards, 1);
	assert.equal(app.planLabel(), "Free");
	assert.match(app.newAgentHTML(true), /Free includes 1 active agent/);

	vm.runInContext(`state.settingsPage = "api"; state.tokens = [{id:"1",name:"one"},{id:"2",name:"two"},{id:"3",name:"three"}];`, app);
	const apiHTML = app.settingsHTML();
	assert.match(apiHTML, /Free includes 3 active API tokens/);
	assert.match(apiHTML, /id="token-name"[^>]*disabled/);
	vm.runInContext(`state.me = null; state.tokens = []; state.boards = []; state.board = null;`, app);
});

function themeTokens(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = styles.match(new RegExp(`${escaped} \\{([\\s\\S]*?)\\n\\}`))[1];
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6});/gi)].map(match => [match[1], match[2]]));
}

function contrastRatio(first, second) {
  const values = [first, second].map(relativeLuminance);
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

function mixColors(first, second, amount) {
  const firstChannels = first.slice(1).match(/../g).map(value => parseInt(value, 16));
  const secondChannels = second.slice(1).match(/../g).map(value => parseInt(value, 16));
  return `#${firstChannels.map((value, index) => Math.round(value * amount + secondChannels[index] * (1 - amount)).toString(16).padStart(2, "0")).join("")}`;
}

function relativeLuminance(hex) {
  const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255);
  const [red, green, blue] = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

test("weeks start on Monday, including Sunday", () => {
  assert.equal(app.dateKey(app.startOfWeek(new Date(2026, 6, 12, 9))), "2026-07-06");
  assert.equal(app.dateKey(app.startOfWeek(new Date(2026, 6, 13, 9))), "2026-07-13");
});

test("week labels handle month and year boundaries", () => {
  const start = new Date(2026, 11, 29, 12);
  const days = Array.from({ length: 7 }, (_, index) => app.addDays(start, index));
  assert.equal(app.formatWeekLabel(days), "Dec 29 – Jan 4, 2027");
});

test("board headers use ISO week numbers and full date ranges", () => {
  const july = app.daysInWeek(new Date(2026, 6, 21, 12));
  assert.equal(app.formatWeekHeading(july), "Week 30 (July 20th – July 26th 2026)");

  const newYear = app.daysInWeek(new Date(2025, 11, 31, 12));
  assert.equal(app.formatWeekHeading(newYear), "Week 1 (December 29th 2025 – January 4th 2026)");
});

test("week view offers direct current and next week jumps", () => {
  const html = app.calendarHTML({ buckets: [] });

  assert.match(html, /id="current-week">This week<\/button>/);
  assert.match(html, /id="next-week-jump" aria-label="Jump to next week">Next week<\/button>/);
  assert.match(html, /id="next-week" aria-label="Show following week"/);
});

test("local date keys survive the spring DST boundary", () => {
  const before = new Date(2026, 2, 28, 12);
  assert.equal(app.dateKey(app.addDays(before, 1)), "2026-03-29");
  assert.equal(app.dateKey(app.addDays(before, 2)), "2026-03-30");
});

test("every list item is completable", () => {
  const html = app.taskHTML({ id: "record", title: "Record comparison", kind: "action", status: "queued", scheduledDate: "", done: false });

  assert.match(html, /class="task action/);
  assert.match(html, /data-toggle-done="record"/);
  assert.doesNotMatch(html, /item-dot/);
});

test("subtasks cannot be dragged independently between lists", () => {
  assert.match(app.taskHTML({ id: "parent", title: "Parent", done: false }), /draggable="true"/);
  assert.match(app.taskHTML({ id: "child", parentTaskId: "parent", title: "Child", done: false }), /draggable="false"/);
});

test("list items show compact state treatment", () => {
  const ready = app.taskHTML({ id: "ready", title: "Ready action", kind: "action", status: "queued", scheduledDate: "", done: false });
  const working = app.taskHTML({ id: "working", title: "Working action", kind: "action", status: "working", scheduledDate: "", done: false });
  const review = app.taskHTML({ id: "review", title: "Review action", kind: "action", status: "needs_review", scheduledDate: "", done: false });
  const done = app.taskHTML({ id: "done", title: "Done action", kind: "action", status: "done", scheduledDate: "", done: true });

  assert.doesNotMatch(ready, /state-badge/);
  assert.match(working, /state-working[^>]*>In Progress/);
  assert.match(review, /state-needs_review[^>]*>Review/);
  assert.match(done, /class="task action done"/);
});

test("agent assignments use safe deterministic bot avatars across directory, task, and detail views", () => {
  vm.runInContext(`
    state.agents = [
      { id: "agent-one", displayName: "<Research Bot>" },
      { id: "agent-old", displayName: "Old Bot", deletedAt: "2026-07-27T00:00:00Z" },
    ];
    state.boards = [{ id: "board", name: "Board" }];
    state.board = {
      id: "board", name: "Board",
      buckets: [{ id: "list", name: "List", tasks: [] }],
    };
    state.workspaceLists = [{ id: "list", boardId: "board", name: "List" }];
    state.selectedSubtasks = [];
  `, app);
  const assigned = { id: "assigned", bucketId: "list", title: "Research", kind: "action", status: "queued", done: false, scheduledDate: "", assigneeAgentId: "agent-one" };
  const taskHTML = app.taskHTML(assigned);
  assert.match(taskHTML, /class="avatar agent-avatar tone-\d avatar-small/);
  assert.match(taskHTML, /<rect x="5" y="7" width="14" height="11" rx="3"/);
  assert.doesNotMatch(taskHTML, />&lt;B<\/span>/);
  assert.doesNotMatch(taskHTML, /<Research Bot>/);

  const detail = app.workspaceDetailHTML({ ...assigned, assigneeAgentId: "agent-old", description: "", priority: "", scheduledDate: "" });
  assert.match(detail, /id="workspace-detail-owner" name="assigneeAgentId"/);
  assert.match(detail, /value="agent-one"/);
  assert.match(detail, /value="agent-old" selected disabled>Old Bot \(inactive\)/);

  vm.runInContext(`state.agents = [];`, app);
  const unavailable = app.workspaceDetailHTML({ ...assigned, assigneeAgentId: "agent-one", description: "", priority: "", scheduledDate: "" });
  assert.match(unavailable, /value="agent-one" selected>Assigned agent unavailable/);
  assert.doesNotMatch(unavailable, /value="" selected>Unassigned/);

  const first = app.avatarHTML({ id: "stable", displayName: "Research Bot" });
  const second = app.avatarHTML({ id: "stable", displayName: "Research Bot" });
  assert.equal(first, second);
  assert.match(app.avatarHTML({ id: "stable", displayName: "Research Bot" }, { large: true }), /avatar-large/);
  vm.runInContext(`state.agents = []; state.boards = []; state.board = null; state.workspaceLists = []; state.selectedSubtasks = [];`, app);
});

test("account settings contain profile, preferences, and personal API access only", () => {
  vm.runInContext(`
    state.me = { id: "owner", email: "owner@example.com", displayName: "Owain Lewis", theme: "light" };
    state.board = { id: "board", name: "Business", maxTasksPerList: 12, buckets: [] };
    state.tokens = [{ id: "token", name: "CLI" }];
    state.newToken = "slate_personal_secret";
    state.newTokenOwnerID = "owner";
    state.settingsPage = "profile";
  `, app);
  const profile = app.settingsHTML();
  assert.match(profile, /<h1>Profile<\/h1>/);
  assert.match(profile, /Generated locally from your account ID/);
  assert.match(profile, /id="profile-form"/);
  assert.match(profile, /id="profile-display-name" name="displayName" value="Owain Lewis"/);
  assert.match(profile, /class="avatar user-avatar tone-\d[^"]*avatar-large/);
  assert.match(profile, /<span class="read-only-value">owner@example.com<\/span>/);
  assert.match(profile, /id="request-password-reset"[^>]*>Send reset link<\/button>/);
  assert.match(profile, /Send a secure reset link to your account email/);
  assert.doesNotMatch(profile, />OL<\/span>/);
  assert.doesNotMatch(profile, /settings-list-limit|agent-limit|token-form|slate_personal_secret/);

  vm.runInContext(`state.settingsPage = "preferences";`, app);
  const preferences = app.settingsHTML();
  assert.match(preferences, /<h1>Preferences<\/h1>/);
  assert.match(preferences, /aria-label="Theme preference"/);
  assert.match(preferences, /data-set-theme="light"[^>]*aria-pressed="true"/);
  assert.doesNotMatch(preferences, /profile-form|settings-list-limit|token-form|slate_personal_secret/);

  vm.runInContext(`state.settingsPage = "api";`, app);
  const apiSettings = app.settingsHTML();
  assert.match(apiSettings, /<h1>API access<\/h1>/);
  assert.match(apiSettings, /id="token-form"/);
  assert.match(apiSettings, /slate_personal_secret/);
  assert.match(apiSettings, /Personal API tokens/);
  assert.match(apiSettings, /Agent credentials/);
  assert.match(apiSettings, /href="\/app\/agents" id="manage-agent-credentials"/);
  assert.doesNotMatch(apiSettings, /profile-form|settings-list-limit|agent-limit/);

  for (const html of [profile, preferences, apiSettings]) {
    assert.match(html, /<nav class="settings-nav" aria-label="Settings">/);
    assert.doesNotMatch(html, /href="\/app\/settings\/agents"/);
    assert.doesNotMatch(html, /href="\/app\/settings\/board"/);
    assert.match(html, />Back to board<\/span>/);
    assert.match(html, /aria-label="Account actions"/);
    assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
    assert.doesNotMatch(html, /<h1>Settings<\/h1>/);
  }
  vm.runInContext(`state.me = null; state.board = null; state.agents = []; state.tokens = []; state.newToken = ""; state.newTokenOwnerID = ""; state.settingsPage = "profile";`, app);
});

test("settings use readable text sizes", () => {
  assert.match(styles, /\.settings-nav-link \{[^}]*font-size: 14px;/);
  assert.match(styles, /\.settings-head \.settings-description \{[^}]*font-size: 14px;/);
  assert.match(styles, /\.settings-section-head p \{[^}]*font-size: 14px;/);
  assert.match(styles, /\.settings-row-copy strong \{[^}]*font-size: 14px;/);
  assert.match(styles, /\.settings-row-copy span \{[^}]*font-size: 14px;/);
  assert.match(styles, /\.read-only-value \{[^}]*font-size: 14px;/);
  assert.match(styles, /\.settings-status \{[^}]*font-size: 13px;/);
  assert.match(styles, /\.field-error \{[^}]*font-size: 13px;/);
  assert.match(styles, /\.settings-page \.settings-nav-link \{[^}]*font-size: 14px;/);
});

test("agent directory shows credential facts, work counts, archived identities, and limits", () => {
  vm.runInContext(`
    state.me = { id: "owner", email: "owner@example.com", theme: "dark" };
    state.view = "agents";
    state.agentsLoadState = "ready";
    state.maxAgents = 5;
    state.activeAgents = 5;
    state.agents = [
      {
        id: "agent-connected", displayName: "<Builder>", purpose: "Ships product",
        credential: { lastUsedAt: "2026-07-27T14:30:00Z" },
        workCounts: { ready: 2, working: 1, review: 1 },
      },
      {
        id: "agent-disconnected", displayName: "Research", purpose: "",
        credential: { revokedAt: "2026-07-27T12:00:00Z" },
        workCounts: {},
      },
      {
        id: "agent-archived", displayName: "Old bot", archivedAt: "2026-07-26T12:00:00Z",
        credential: { revokedAt: "2026-07-26T12:00:00Z" },
        workCounts: { review: 2 },
      },
    ];
  `, app);

  const html = app.agentsHTML();
  assert.match(html, /id="agents-nav"[^>]*aria-current="page"/);
  assert.match(html, /&lt;Builder&gt;/);
  assert.match(html, />Connected</);
  assert.match(html, />Needs connection</);
  assert.match(html, />Archived</);
  assert.match(html, /2 open cards · 1 working card · 1 review card/);
  assert.match(html, /href="\/app\/agents\/agent-connected" data-agent-link="agent-connected"/);
  assert.match(html, /No open work assigned/);
  assert.match(html, /<details class="archived-agents">/);
  assert.match(html, /5 of 5 active agents/);
  assert.match(html, /id="new-agent-link"[^>]*aria-disabled="true"/);
  assert.doesNotMatch(html, /online|offline|runtime|model|concurrency/i);

  vm.runInContext(`state.activeAgents = 0; state.agents = [];`, app);
  const empty = app.agentsHTML();
  assert.match(empty, /Bring an agent into the plan/);
  assert.equal((empty.match(/id="empty-new-agent"/g) || []).length, 1);
  assert.equal((empty.match(/>New agent<\/span>/g) || []).length, 1);
  vm.runInContext(`state.me = null; state.view = "home"; state.agents = []; state.agentsLoadState = "idle";`, app);
});

test("agent detail presents real grouped task data, bounded history, and distinct states", () => {
  const workItem = (id, title, status, done = false) => ({
    id, title, status, done, boardId: "board", boardName: "Business",
    bucketId: "list", bucketName: "Product", updatedAt: "2026-07-28T09:00:00Z",
  });
  vm.runInContext(`
    state.me = { id: "owner", theme: "dark" };
    state.view = "agent-detail";
    state.agentDetailLoadState = "ready";
    state.agentDetail = ${JSON.stringify({
      agent: {
        id: "agent-one", displayName: "<Builder>", purpose: "Ships product",
        credential: { lastUsedAt: "2026-07-28T08:00:00Z" },
      },
      work: {
        ready: [workItem("ready", "Ready item", "queued")],
        working: [workItem("working", "Working item", "working")],
        review: [workItem("review", "Review item", "needs_review")],
        recentlyCompleted: [workItem("done", "Done item", "done", true)],
        totals: { ready: 51, working: 1, review: 1, completed: 21 },
        openLimit: 50,
        completedLimit: 20,
      },
    })};
    state.agentAssignOpen = false;
    state.selectedTask = null;
  `, app);
  const overview = app.agentDetailHTML();
  assert.match(overview, /<h1>&lt;Builder&gt;<\/h1>/);
  assert.match(overview, /Ships product/);
  assert.match(overview, />Connected</);
  assert.match(overview, /role="tablist"/);
  assert.match(overview, /id="agent-tab-overview"[^>]*role="tab"[^>]*aria-selected="true"[^>]*aria-controls="agent-panel-overview"[^>]*aria-current="page"[^>]*>Overview/);
  assert.match(overview, /id="agent-tab-work"[^>]*role="tab"[^>]*aria-selected="false"[^>]*aria-controls="agent-panel-work"/);
  assert.match(overview, /id="agent-panel-overview"[^>]*role="tabpanel"[^>]*aria-labelledby="agent-tab-overview"[^>]*tabindex="0"/);
  assert.match(overview, /id="agent-panel-work"[^>]*role="tabpanel"[^>]*aria-labelledby="agent-tab-work"[^>]*tabindex="0" hidden/);
  assert.match(overview, /Ready item/);
  assert.match(overview, /Working item/);
  assert.equal((overview.match(/Working item/g) || []).length, 1, "working tasks must not be duplicated");
  assert.match(overview, /Review item/);
  assert.match(overview, /Done item/);
  assert.match(overview, /This is not run history/);
  assert.match(overview, /Showing 1 of 51/);
  assert.match(overview, /href="\/app\/agents\/agent-one\/work"/);
  assert.doesNotMatch(overview, /runtime|model|concurrency|online|offline/i);

  vm.runInContext(`
    state.view = "agent-work";
    state.agentWorkPage = {
      items: ${JSON.stringify([workItem("ready", "Ready item", "queued"), workItem("done", "Done item", "done", true)])},
      page: 2, pageSize: 50, total: 102, hasPrevious: true, hasNext: true,
    };
  `, app);
  const history = app.agentDetailHTML();
  assert.match(history, /id="agent-tab-work"[^>]*aria-selected="true"[^>]*aria-controls="agent-panel-work"[^>]*aria-current="page"[^>]*>Work/);
  assert.match(history, /id="agent-panel-overview"[^>]*role="tabpanel"[^>]*aria-labelledby="agent-tab-overview"[^>]*tabindex="0" hidden/);
  assert.match(history, /id="agent-panel-work"[^>]*role="tabpanel"[^>]*aria-labelledby="agent-tab-work"[^>]*tabindex="0"/);
  assert.match(history, /Page 2 · 2 of 102/);
  assert.match(history, /data-work-page="1"/);
  assert.match(history, /data-work-page="3"/);

  vm.runInContext(`state.agentDetail.agent.archivedAt = "2026-07-27T00:00:00Z"; state.view = "agent-detail";`, app);
  const archived = app.agentDetailHTML();
  assert.match(archived, /Archived identity/);
  assert.doesNotMatch(archived, /id="assign-work"/);

  for (const [loadState, text] of [["loading", "Loading agent"], ["not-found", "Agent not found"], ["unauthorized", "session has expired"], ["error", "couldn’t be loaded"]]) {
    vm.runInContext(`state.agentDetailLoadState = ${JSON.stringify(loadState)}; state.agentDetailError = "Network failed";`, app);
    assert.match(app.agentDetailHTML(), new RegExp(text, "i"));
  }
  vm.runInContext(`state.me = null; state.view = "home"; state.agentDetail = null; state.agentWorkPage = null; state.agentDetailLoadState = "idle";`, app);
});

test("deleting an off-page assigned subtask reconciles agent pagination and status totals", () => {
  vm.runInContext(`
    state.agentDetail = {
      agent: { id: "agent-one" },
      work: {
        ready: [], working: [], review: [], recentlyCompleted: [],
        totals: { ready: 12, working: 3, review: 2, completed: 5 },
      },
    };
    state.agentWorkPage = {
      items: [{ id: "visible-task", assigneeAgentId: "agent-one", status: "queued" }],
      page: 1, pageSize: 50, total: 51, hasPrevious: false, hasNext: true,
    };
  `, app);

  assert.equal(app.reconcileAgentTaskCaches({
    id: "off-page-child", parentTaskId: "parent", assigneeAgentId: "agent-one", status: "queued", done: false,
  }, { deleted: true }), true);
  assert.equal(vm.runInContext("state.agentWorkPage.total", app), 50);
  assert.equal(vm.runInContext("state.agentWorkPage.hasNext", app), false);
  assert.equal(vm.runInContext("state.agentDetail.work.totals.ready", app), 11);
  assert.equal(vm.runInContext("state.agentWorkPage.items.length", app), 1);
  assert.equal(vm.runInContext("state.agentDetail.work.ready.length", app), 0);

  vm.runInContext(`state.agentDetail = null; state.agentWorkPage = null;`, app);
});

test("agent cache reconciliation resolves location labels after a cross-list save", () => {
  vm.runInContext(`
    state.boards = [{ id: "board-one", name: "Workspace" }, { id: "board-two", name: "Campaigns" }];
    state.workspaceLists = [{ id: "list-new", boardId: "board-two", name: "Launch" }];
    state.agentDetail = {
      agent: { id: "agent-one" },
      work: {
        ready: [{ id: "task-one", boardId: "board-one", boardName: "Workspace", bucketId: "list-old", bucketName: "Inbox", assigneeAgentId: "agent-one", status: "queued" }],
        working: [], review: [], recentlyCompleted: [], totals: { ready: 1 },
      },
    };
    state.agentWorkPage = {
      items: [{ id: "task-one", boardId: "board-one", boardName: "Workspace", bucketId: "list-old", bucketName: "Inbox", assigneeAgentId: "agent-one", status: "queued" }],
      page: 1, pageSize: 50, total: 1, hasPrevious: false, hasNext: false,
    };
  `, app);

  app.reconcileAgentTaskCaches({ id: "task-one", bucketId: "list-new", assigneeAgentId: "agent-one", status: "queued" });
  assert.equal(vm.runInContext("state.agentWorkPage.items[0].bucketName", app), "Launch");
  assert.equal(vm.runInContext("state.agentWorkPage.items[0].boardName", app), "Campaigns");
  assert.equal(vm.runInContext("state.agentDetail.work.ready[0].bucketName", app), "Launch");

  vm.runInContext(`state.boards = []; state.workspaceLists = []; state.agentDetail = null; state.agentWorkPage = null;`, app);
});

test("moving a parent reconciles cached descendant locations", () => {
  vm.runInContext(`
    state.boards = [{ id: "board-one", name: "Workspace" }, { id: "board-two", name: "Campaigns" }];
    state.workspaceLists = [{ id: "list-new", boardId: "board-two", name: "Launch" }];
    state.agentDetail = {
      agent: { id: "agent-one" },
      work: {
        ready: [{ id: "child", parentTaskId: "parent", boardId: "board-one", boardName: "Workspace", bucketId: "list-old", bucketName: "Inbox", assigneeAgentId: "agent-one", status: "queued" }],
        working: [], review: [], recentlyCompleted: [], totals: { ready: 1 },
      },
    };
    state.agentWorkPage = {
      items: [{ id: "child", parentTaskId: "parent", boardId: "board-one", boardName: "Workspace", bucketId: "list-old", bucketName: "Inbox", assigneeAgentId: "agent-one", status: "queued" }],
      page: 1, pageSize: 50, total: 1, hasPrevious: false, hasNext: false,
    };
  `, app);

  app.reconcileAgentTaskCaches(
    { id: "parent", bucketId: "list-new", assigneeAgentId: "agent-one", status: "working" },
    { previousTask: { id: "parent", bucketId: "list-old", assigneeAgentId: "agent-one", status: "working" } },
  );
  assert.equal(vm.runInContext("state.agentWorkPage.items[0].bucketName", app), "Launch");
  assert.equal(vm.runInContext("state.agentWorkPage.items[0].boardName", app), "Campaigns");
  assert.equal(vm.runInContext("state.agentDetail.work.ready[0].bucketId", app), "list-new");
  assert.equal(vm.runInContext("state.agentDetail.work.ready[0].listName", app), "Launch");

  vm.runInContext(`state.boards = []; state.workspaceLists = []; state.agentDetail = null; state.agentWorkPage = null;`, app);
});

test("moving a parent reconciles an open child detail without losing its draft", () => {
  vm.runInContext(`
    savedParentMoveRender = render;
    parentMoveRenderCount = 0;
    render = () => { parentMoveRenderCount += 1; };
    parentMoveListControl = { value: "list-old" };
    parentMoveContext = { textContent: "YouTube" };
    globalThis.document = { querySelector: selector => selector === "#workspace-detail-list" ? parentMoveListControl : selector === ".detail-context span" ? parentMoveContext : null };
    state.boards = [{ id: "board-one", name: "Workspace" }];
    state.workspaceLists = [
      { id: "list-old", boardId: "board-one", name: "YouTube" },
      { id: "list-new", boardId: "board-one", name: "Inbox" },
    ];
    state.board = { id: "board-one", buckets: [
      { id: "list-old", tasks: [{ id: "parent", bucketId: "list-old", status: "working" }] },
      { id: "list-new", tasks: [] },
    ] };
    state.workspaceTasks = [{ id: "child", parentTaskId: "parent", bucketId: "list-old", listName: "YouTube", title: "Child" }];
    state.selectedSubtasks = [];
    state.selectedTask = { id: "child", parentTaskId: "parent", bucketId: "list-old", listName: "YouTube", title: "Live child title", description: "Live child brief", status: "queued" };
    state.taskDetailDrafts = { child: { title: "Live child title", description: "Live child brief", status: "queued", bucketId: "list-old", priority: "p1", assigneeAgentId: "", scheduledDate: "" } };
    state.agentDetail = null;
    state.agentWorkPage = null;
  `, app);

  app.reconcileTaskCompletion(
    { id: "parent", bucketId: "list-new", status: "working", done: false },
    { id: "parent", bucketId: "list-old", status: "working", done: false },
  );

  assert.equal(vm.runInContext("state.workspaceTasks[0].bucketId", app), "list-new");
  assert.equal(vm.runInContext("state.workspaceTasks[0].listName", app), "Inbox");
  assert.equal(vm.runInContext("state.selectedTask.bucketId", app), "list-new");
  assert.equal(vm.runInContext("state.selectedTask.listName", app), "Inbox");
  assert.equal(vm.runInContext("state.selectedTask.title", app), "Live child title");
  assert.equal(vm.runInContext("state.taskDetailDrafts.child.bucketId", app), "list-new");
  assert.equal(vm.runInContext("state.taskDetailDrafts.child.description", app), "Live child brief");
  assert.equal(vm.runInContext("parentMoveListControl.value", app), "list-new");
  assert.equal(vm.runInContext("parentMoveContext.textContent", app), "Inbox");
  assert.equal(vm.runInContext("parentMoveRenderCount", app), 0);

  vm.runInContext(`
    render = savedParentMoveRender;
    state.boards = [];
    state.workspaceLists = [];
    state.board = null;
    state.workspaceTasks = [];
    state.selectedSubtasks = [];
    state.selectedTask = null;
    state.taskDetailDrafts = {};
    delete globalThis.document;
  `, app);
});

test("off-page agent mutations reconcile bounded overview totals", () => {
  vm.runInContext(`
    state.agentDetail = {
      agent: { id: "agent-one" },
      work: {
        ready: [], working: [], review: [], recentlyCompleted: [],
        totals: { ready: 51, working: 2, review: 0, completed: 0 },
      },
    };
    state.agentWorkPage = {
      items: [], page: 1, pageSize: 50, total: 53, hasPrevious: false, hasNext: true,
    };
  `, app);

  app.reconcileAgentTaskCaches(
    { id: "off-page", assigneeAgentId: "agent-one", status: "working", done: false },
    { previousTask: { id: "off-page", assigneeAgentId: "agent-one", status: "queued", done: false } },
  );
  assert.equal(vm.runInContext("state.agentDetail.work.totals.ready", app), 50);
  assert.equal(vm.runInContext("state.agentDetail.work.totals.working", app), 3);
  assert.equal(vm.runInContext("state.agentDetail.work.working.length", app), 0, "bounded groups do not grow with off-page tasks");
  assert.equal(vm.runInContext("state.agentWorkPage.total", app), 53);

  app.reconcileAgentTaskCaches(
    { id: "off-page", assigneeAgentId: "", status: "working", done: false },
    { previousTask: { id: "off-page", assigneeAgentId: "agent-one", status: "working", done: false } },
  );
  assert.equal(vm.runInContext("state.agentDetail.work.totals.working", app), 2);
  assert.equal(vm.runInContext("state.agentWorkPage.total", app), 52);
  assert.equal(vm.runInContext("state.agentWorkPage.hasNext", app), true);

  vm.runInContext(`state.agentDetail = null; state.agentWorkPage = null;`, app);
});

test("account-wide lists are immediately available for agent assignment", () => {
  vm.runInContext(`
    state.boards = [{ id: "board-one", name: "Workspace" }, { id: "board-two", name: "Other" }];
    state.board = { id: "board-one", name: "Workspace", buckets: [{ id: "list-old", boardId: "board-one", name: "Old" }] };
    state.workspaceLists = [
      { id: "list-old", boardId: "board-one", name: "Old" },
      { id: "list-new", boardId: "board-one", name: "Launch plan" },
      { id: "list-stale", boardId: "board-two", name: "Stale other-board list" },
    ];
    state.agentDetail = { agent: { id: "agent-one", displayName: "Builder" } };
    state.agentAssignBoardID = "board-one";
    state.agentAssignDraft = null;
  `, app);

  const refreshed = app.assignWorkHTML();
  assert.match(refreshed, /value="list-new"[^>]*>Launch plan<\/option>/);

  vm.runInContext(`state.agentAssignBoardID = "board-two";`, app);
  const switched = app.assignWorkHTML();
  assert.match(switched, /value="list-stale"[^>]*>Stale other-board list<\/option>/);

  vm.runInContext(`
    state.boards = [];
    state.board = null;
    state.workspaceLists = [];
    state.agentDetail = null;
    state.agentAssignBoardID = "";
    state.agentAssignDraft = null;
  `, app);
});

test("task list options disambiguate duplicate board and list names", () => {
  vm.runInContext(`
    state.boards = [
      { id: "board-one", name: "Content" },
      { id: "board-two", name: "Content" },
    ];
    state.workspaceLists = [
      { id: "list-one", boardId: "board-one", name: "YouTube" },
      { id: "list-two", boardId: "board-two", name: "YouTube" },
      { id: "list-three", boardId: "board-two", name: "LinkedIn" },
    ];
  `, app);

  assert.equal(app.workspaceListLabel(vm.runInContext("state.workspaceLists[0]", app)), "Content / YouTube (list-one)");
  assert.equal(app.workspaceListLabel(vm.runInContext("state.workspaceLists[1]", app)), "Content / YouTube (list-two)");
  assert.equal(app.workspaceListLabel(vm.runInContext("state.workspaceLists[2]", app)), "LinkedIn");

  vm.runInContext(`
    state.boards = [{ id: "board-one", name: "Content" }];
    state.workspaceLists = [
      { id: "list-one", boardId: "board-one", name: "YouTube" },
      { id: "list-two", boardId: "board-one", name: "YouTube" },
    ];
  `, app);
  assert.equal(app.workspaceListLabel(vm.runInContext("state.workspaceLists[0]", app)), "YouTube (list-one)");
  assert.equal(app.workspaceListLabel(vm.runInContext("state.workspaceLists[1]", app)), "YouTube (list-two)");

  vm.runInContext(`state.boards = []; state.workspaceLists = [];`, app);
});

test("new-agent route has inline limits and one-time CLI connection instructions", () => {
  vm.runInContext(`
    state.me = { id: "owner", theme: "light" };
    state.view = "agent-new";
    state.agentsLoadState = "ready";
    state.activeAgents = 1;
    state.maxAgents = 5;
    state.agentCreationResult = null;
  `, app);
  const form = app.agentsHTML();
  assert.match(form, /id="agent-name"/);
  assert.match(form, /up to 100 Unicode characters/);
  assert.match(form, /id="agent-purpose"/);
  assert.match(form, /Up to 4 KiB in UTF-8/);
  assert.equal(app.utf8Length("é🙂"), 6);
  assert.match(form, /id="agent-name-error" role="alert"/);
  assert.match(form, /id="agent-purpose-error" role="alert"/);

  vm.runInContext(`
    state.agentCreationResult = {
      ownerID: "owner",
      agent: { id: "agent-one", displayName: "Builder Bot" },
      token: "slate_agent_once_only",
    };
  `, app);
  const result = app.agentsHTML();
  assert.match(result, /Copy this token now/);
  assert.match(result, /export SLATE_API_TOKEN=slate_agent_once_only/);
  assert.match(result, /slate auth status/);
  assert.match(result, /cannot show it again after you leave this page or refresh/);
  assert.doesNotMatch(result, /href="[^"]*slate_agent_once_only/);
  vm.runInContext(`state.me = null; state.view = "home"; state.agentCreationResult = null; state.agentsLoadState = "idle";`, app);
});

test("agent settings separate identity, credential, and archive lifecycle without persistent secrets", () => {
  vm.runInContext(`
    state.me = { id: "owner", theme: "light" };
    state.view = "agent-settings";
    state.agentDetailLoadState = "ready";
    state.agentDetail = {
      agent: { id: "agent-one", displayName: "Builder", purpose: "Ships work", credential: { id: "credential-one" } },
      work: { ready: [], working: [], review: [], recentlyCompleted: [], totals: {} },
    };
    state.agentCredentialResult = null;
    state.agentLifecycleConfirm = "";
    state.agentLifecycleError = "";
    state.agentLifecycleNotice = "";
  `, app);
  const settings = app.agentDetailHTML();
  assert.match(settings, /id="agent-tab-settings"[^>]*aria-selected="true"[^>]*aria-current="page"/);
  assert.match(settings, /id="agent-identity-form"/);
  assert.match(settings, /id="agent-settings-name" name="displayName" value="Builder"/);
  assert.match(settings, /id="rotate-agent-credential"/);
  assert.match(settings, /id="revoke-agent-credential"/);
  assert.match(settings, /id="archive-agent"/);
  assert.doesNotMatch(settings, />Delete</);

  vm.runInContext(`
    state.agentLifecycleConfirm = "archive";
    state.agentArchiveConflict = { new: 1, ready: 2, working: 1 };
  `, app);
  const archiveConflict = app.agentLifecycleConfirmHTML();
  assert.match(archiveConflict, /Active work is still assigned/);
  assert.match(archiveConflict, /1 New card, 2 Ready cards, 1 In Progress card must be unassigned/);
  vm.runInContext(`state.agentLifecycleConfirm = ""; state.agentArchiveConflict = null;`, app);

  vm.runInContext(`
    state.agentCredentialResult = { ownerID: "owner", agentID: "agent-one", token: "slate_agent_once_only" };
  `, app);
  const result = app.agentDetailHTML();
  assert.match(result, /class="agent-connection-result agent-lifecycle-secret"/);
  assert.match(result, /slate_agent_once_only/);
  assert.match(result, /Slate stores only its hash/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
  assert.match(source, /alreadyApplied/);
  assert.match(source, /old credential may have been revoked/i);
  vm.runInContext(`
    clearAgentCredentialLeaving({ name: "agent-settings", agentId: "agent-one" });
  `, app);
  assert.equal(vm.runInContext("state.agentCredentialResult?.token", app), "slate_agent_once_only");
  vm.runInContext(`
    clearAgentCredentialLeaving({ name: "agent-detail", agentId: "agent-one" });
  `, app);
  assert.equal(vm.runInContext("state.agentCredentialResult", app), null);

  vm.runInContext(`
    state.agentDetail.agent.archivedAt = "2026-07-28T00:00:00Z";
  `, app);
  const archived = app.agentDetailHTML();
  assert.match(archived, /id="restore-agent"/);
  assert.match(archived, /id="delete-agent"/);
  assert.match(archived, /Delete permanently/);
  assert.match(archived, /Historical tasks remain, but their agent assignment is cleared/);
  assert.doesNotMatch(archived, /id="rotate-agent-credential"/);

  vm.runInContext(`state.agentLifecycleConfirm = "delete";`, app);
  const deletion = app.agentLifecycleConfirmHTML();
  assert.match(deletion, /Permanently delete this agent/);
  assert.match(deletion, /This cannot be undone/);
  assert.match(deletion, /id="confirm-agent-lifecycle"[^>]*>Delete permanently/);
  assert.match(source, /\/api\/v1\/agents\/\$\{encodeURIComponent\(context\.agentID\)\}\/permanent/);

  assert.deepEqual(JSON.parse(JSON.stringify(app.parseRoute("/app/agents/agent-one/settings"))), { name: "agent-settings", agentId: "agent-one" });
  vm.runInContext(`state.me = null; state.view = "home"; state.agentDetail = null; state.agentCredentialResult = null;`, app);
});

test("credential copy failure leaves the token selected for manual copy", async () => {
  const events = [];
  const range = {
    selectNodeContents(element) { events.push(["selected", element.id]); },
  };
  const selection = {
    ranges: [],
    removeAllRanges() { this.ranges = []; events.push(["cleared"]); },
    addRange(value) { this.ranges.push(value); events.push(["added"]); },
  };
  const tokenElement = {
    id: "agent-credential",
    focus() { events.push(["focused"]); },
  };
  const copied = await app.copyAgentCredential("slate_agent_manual", tokenElement, {
    clipboard: { async writeText() { throw new Error("denied"); } },
    document: {
      createRange() { return range; },
      execCommand(command) {
        events.push(["fallback", command]);
        return false;
      },
    },
    selection,
  });

  assert.equal(copied, false);
  assert.equal(selection.ranges.length, 1, "failed fallback must preserve the manual selection");
  assert.deepEqual(events, [
    ["selected", "agent-credential"],
    ["cleared"],
    ["added"],
    ["focused"],
    ["fallback", "copy"],
  ]);

  vm.runInContext(`
    state.credentialCopied = false;
    state.credentialCopyError = "Copy failed. The token is selected. Press Command+C or Ctrl+C to copy it manually.";
  `, app);
  const html = app.agentConnectionResultHTML({
    ownerID: "owner",
    agent: { id: "agent", displayName: "Builder Bot" },
    token: "slate_agent_manual",
  });
  assert.match(html, /id="agent-credential" tabindex="0" aria-describedby="credential-copy-error"/);
  assert.match(html, /id="credential-copy-error" role="alert">Copy failed/);
  assert.match(html, />Copy<\/span>/);
  assert.doesNotMatch(html, />Copied<\/span>/);
  vm.runInContext(`state.credentialCopyError = "";`, app);
});

test("the card header stays focused on the workspace and new-card action", () => {
  vm.runInContext(`
    state.me = { id: "owner", email: "owner@example.com", displayName: "Owain Lewis" };
    state.board = { id: "board", name: "Business", maxTasksPerList: 20, buckets: [] };
    state.boards = [{ id: "board", name: "Business" }];
  `, app);
  const html = app.appHTML();
  assert.match(html, /class="workspace-title"><h1>All cards<\/h1>/);
  assert.match(html, /id="new-task"/);
  assert.doesNotMatch(html, /class="current-user"|>OL<\/span>/);
  vm.runInContext(`state.me = null; state.board = null; state.boards = [];`, app);
});

test("New card remains available from agent and account settings pages", () => {
  assert.match(app.agentsHTML(), /id="global-new-task"[^>]*>.*New card/s);
  assert.match(app.settingsHTML(), /id="global-new-task"[^>]*>.*New card/s);
});

test("successful agent creation keeps the one-time token when metadata refresh fails", async () => {
  vm.runInContext(`
    authVersion = 12;
    routeVersion = 21;
    state.me = { id: "owner" };
    state.view = "agent-new";
    state.agents = [];
    state.agentCreationResult = null;
    state.agentCreateNotice = "";
    state.error = "";
    api.post = async path => {
      if (path !== "/api/v1/agents") throw new Error("unexpected POST " + path);
      return { id: "agent", displayName: "Builder Bot", token: "slate_agent_copy_now" };
    };
    api.get = async path => {
      if (path !== "/api/v1/agents") throw new Error("unexpected GET " + path);
      throw new Error("agents temporarily unavailable");
    };
  `, app);

  assert.equal(await app.createAgent("Builder Bot", "Build product", 21), true);
  assert.equal(vm.runInContext("state.agentCreationResult.token", app), "slate_agent_copy_now");
  assert.equal(vm.runInContext("state.agentCreationResult.ownerID", app), "owner");
  assert.equal(vm.runInContext("state.agents[0].id", app), "agent");
  assert.equal(vm.runInContext(`"token" in state.agents[0]`, app), false);
  assert.match(vm.runInContext("state.agentCreateNotice", app), /still available until you leave/);
  assert.match(app.agentConnectionResultHTML(JSON.parse(vm.runInContext("JSON.stringify(state.agentCreationResult)", app))), /SLATE_API_TOKEN=slate_agent_copy_now/);
  vm.runInContext(`state.me = null; state.view = "home"; state.agents = []; state.agentCreationResult = null; state.agentCreateNotice = ""; state.error = "";`, app);
});

test("personal token result survives metadata failure only on its owner API page", async () => {
  vm.runInContext(`
    authVersion = 13;
    routeVersion = 60;
    state.me = { id: "owner", theme: "light" };
    state.settings = true;
    state.settingsPage = "api";
    state.newToken = "";
    state.newTokenOwnerID = "";
    state.tokens = [];
    state.settingsNotice = "";
    api.post = async path => {
      if (path !== "/api/v1/api-tokens") throw new Error("unexpected POST " + path);
      return { token: "slate_personal_copy_now" };
    };
    api.get = async path => {
      if (path !== "/api/v1/api-tokens") throw new Error("unexpected GET " + path);
      throw new Error("metadata unavailable");
    };
  `, app);

  assert.equal(await app.createAPIToken("Laptop CLI", 60), true);
  assert.equal(vm.runInContext("state.newTokenOwnerID", app), "owner");
  assert.match(app.settingsHTML(), /slate_personal_copy_now/);
  assert.match(vm.runInContext("state.settingsNotice", app), /could not be refreshed/);

  app.clearSettingsCredentialsLeaving("profile");
  assert.equal(vm.runInContext("state.newToken", app), "");
  vm.runInContext(`
    state.settingsPage = "api";
    state.newToken = "slate_wrong_owner";
    state.newTokenOwnerID = "account-a";
    state.me = { id: "account-b", theme: "light" };
  `, app);
  assert.doesNotMatch(app.settingsHTML(), /slate_wrong_owner/);
  vm.runInContext(`state.me = null; state.settings = false; state.settingsPage = "profile"; state.newToken = ""; state.newTokenOwnerID = "";`, app);
});

test("pending credentials cannot cross routes or accounts", async () => {
  let releaseToken;
  app.pendingTokenResponse = new Promise(resolve => { releaseToken = resolve; });
  app.releasePendingToken = releaseToken;
  vm.runInContext(`
    authVersion = 14;
    routeVersion = 70;
    state.me = { id: "owner" };
    state.settings = true;
    state.settingsPage = "api";
    state.newToken = "";
    state.tokens = [];
    state.agents = [];
    state.error = "";
    api.post = async path => {
      if (path === "/api/v1/api-tokens") return pendingTokenResponse;
      throw new Error("unexpected POST " + path);
    };
  `, app);

  const tokenCreation = app.createAPIToken("CLI", 70);
  vm.runInContext(`routeVersion = 71; state.settingsPage = "profile";`, app);
  app.releasePendingToken({ token: "slate_must_not_cross_routes" });
  assert.equal(await tokenCreation, false);
  assert.equal(vm.runInContext("state.newToken", app), "");
  assert.doesNotMatch(app.settingsHTML(), /slate_must_not_cross_routes/);
  vm.runInContext(`state.settingsPage = "api";`, app);
  assert.doesNotMatch(app.settingsHTML(), /slate_must_not_cross_routes/);

  vm.runInContext(`
    state.view = "agent-new";
    state.settings = false;
    state.agentCreationResult = { ownerID: "owner", agent: { id: "agent" }, token: "slate_agent_secret" };
    clearAgentCredentialLeaving("agents");
  `, app);
  assert.equal(vm.runInContext("state.agentCreationResult", app), null);

  vm.runInContext(`
    state.view = "agent-new";
    state.agentCreationResult = { ownerID: "owner", agent: { id: "agent" }, token: "slate_agent_account_a" };
  `, app);
  app.beginAuthenticatedSession({ id: "account-b", theme: "light" });
  assert.equal(vm.runInContext("state.agentCreationResult", app), null);

  vm.runInContext(`state.me = null; state.settings = false; state.settingsPage = "profile"; state.newToken = ""; state.agents = []; state.error = "";`, app);
});

test("agent detail responses cannot cross routes or accounts", async () => {
  let releaseDetail;
  app.pendingAgentDetail = new Promise(resolve => { releaseDetail = resolve; });
  vm.runInContext(`
    authVersion = 40;
    routeVersion = 80;
    state.me = { id: "owner-a" };
    state.agentDetail = null;
    api.get = async path => {
      if (path === "/api/v1/agents/agent-one") return pendingAgentDetail;
      throw new Error("unexpected request " + path);
    };
  `, app);
  const staleRoute = app.loadAgentDetail("agent-one", {
    sessionVersion: 40,
    userID: "owner-a",
    expectedRouteVersion: 80,
  });
  vm.runInContext(`routeVersion = 81;`, app);
  releaseDetail({ agent: { id: "agent-one" }, work: {} });
  assert.equal(await staleRoute, false);
  assert.equal(vm.runInContext("state.agentDetail", app), null);

  vm.runInContext(`
    routeVersion = 90;
    state.me = { id: "owner-a" };
    api.get = async () => ({ agent: { id: "agent-two" }, work: {} });
  `, app);
  app.beginAuthenticatedSession({ id: "owner-b", theme: "light" });
  assert.equal(await app.loadAgentDetail("agent-two", {
    sessionVersion: 40,
    userID: "owner-a",
    expectedRouteVersion: 90,
  }), false);
  assert.equal(vm.runInContext("state.agentDetail", app), null);
  vm.runInContext(`state.me = null; state.agents = [];`, app);
});

test("an older agent detail refresh cannot overwrite a newer refresh", async () => {
  let releaseOlderDetail;
  let releaseOlderWork;
  app.pendingOlderAgentDetail = new Promise(resolve => { releaseOlderDetail = resolve; });
  app.pendingOlderAgentWork = new Promise(resolve => { releaseOlderWork = resolve; });
  vm.runInContext(`
    savedBoardDeleteRender = render;
    render = () => {};
    authVersion = 50;
    routeVersion = 100;
    state.me = { id: "owner" };
    state.agents = [];
    state.agentDetail = null;
    state.agentWorkPage = null;
    let agentDetailRequests = 0;
    let agentWorkRequests = 0;
    api.get = async path => {
      if (path === "/api/v1/agents/agent-race") {
        agentDetailRequests += 1;
        return agentDetailRequests === 1
          ? pendingOlderAgentDetail
          : { agent: { id: "agent-race", displayName: "Newest" }, work: { ready: [] } };
      }
      if (path === "/api/v1/agents/agent-race/work?page=2&pageSize=50") {
        agentWorkRequests += 1;
        return agentWorkRequests === 1
          ? pendingOlderAgentWork
          : { items: [{ id: "newest-task" }], total: 1, page: 2, pageSize: 50 };
      }
      throw new Error("unexpected request " + path);
    };
  `, app);

  const older = app.loadAgentDetail("agent-race", {
    includeWorkPage: true,
    page: 2,
    sessionVersion: 50,
    userID: "owner",
    expectedRouteVersion: 100,
  });
  const newer = app.loadAgentDetail("agent-race", {
    includeWorkPage: true,
    page: 2,
    sessionVersion: 50,
    userID: "owner",
    expectedRouteVersion: 100,
  });

  assert.equal(await newer, true);
  assert.equal(vm.runInContext("state.agentDetail.agent.displayName", app), "Newest");
  assert.equal(vm.runInContext("state.agentWorkPage.items[0].id", app), "newest-task");

  releaseOlderDetail({ agent: { id: "agent-race", displayName: "Older" }, work: { ready: [] } });
  releaseOlderWork({ items: [{ id: "older-task" }], total: 1, page: 2, pageSize: 50 });
  assert.equal(await older, false);
  assert.equal(vm.runInContext("state.agentDetail.agent.displayName", app), "Newest");
  assert.equal(vm.runInContext("state.agentWorkPage.items[0].id", app), "newest-task");
  vm.runInContext(`state.me = null; state.agents = []; state.agentDetail = null; state.agentWorkPage = null;`, app);
});

test("an older failed agent detail refresh cannot reject after a newer refresh", async () => {
  let rejectOlderDetail;
  app.pendingFailedAgentDetail = new Promise((_, reject) => { rejectOlderDetail = reject; });
  vm.runInContext(`
    authVersion = 60;
    routeVersion = 110;
    state.me = { id: "owner" };
    state.agents = [];
    state.agentDetail = null;
    state.agentWorkPage = null;
    let failedAgentDetailRequests = 0;
    api.get = async path => {
      if (path !== "/api/v1/agents/agent-failure-race") throw new Error("unexpected request " + path);
      failedAgentDetailRequests += 1;
      return failedAgentDetailRequests === 1
        ? pendingFailedAgentDetail
        : { agent: { id: "agent-failure-race", displayName: "Newest" }, work: { ready: [] } };
    };
  `, app);

  const older = app.loadAgentDetail("agent-failure-race", {
    sessionVersion: 60,
    userID: "owner",
    expectedRouteVersion: 110,
  });
  const newer = app.loadAgentDetail("agent-failure-race", {
    sessionVersion: 60,
    userID: "owner",
    expectedRouteVersion: 110,
  });

  assert.equal(await newer, true);
  rejectOlderDetail(new Error("stale refresh failed"));
  assert.equal(await older, false);
  assert.equal(vm.runInContext("state.agentDetail.agent.displayName", app), "Newest");
  vm.runInContext(`state.me = null; state.agents = []; state.agentDetail = null;`, app);
});

test("a queued completion toggle inverts the latest committed task state", async () => {
  let releasePendingSave;
  app.pendingCompletionSave = new Promise(resolve => { releasePendingSave = resolve; });
  vm.runInContext(`
    authVersion = 89;
    savedCompletionGet = api.get;
    savedCompletionPatch = api.patch;
    completionRequests = [];
    api.get = async path => {
      completionRequests.push({ method: "GET", path });
      return { id: "task-completion-race", done: true };
    };
    api.patch = async (path, input) => {
      completionRequests.push({ method: "PATCH", path, input });
      return { id: "task-completion-race", done: input.done };
    };
  `, app);
  const pendingSave = app.serializeTaskMutation("task-completion-race", () => app.pendingCompletionSave);
  await new Promise(resolve => setImmediate(resolve));

  const queuedToggle = app.toggleTaskCompletion({ id: "task-completion-race", done: false });
  releasePendingSave({ id: "task-completion-race", done: true });
  await pendingSave;
  const result = await queuedToggle;

  assert.equal(result.done, false);
  assert.deepEqual(JSON.parse(vm.runInContext("JSON.stringify(completionRequests)", app)), [
    { method: "GET", path: "/api/v1/tasks/task-completion-race" },
    { method: "PATCH", path: "/api/v1/tasks/task-completion-race", input: { done: false } },
  ]);
  vm.runInContext(`
    api.get = savedCompletionGet;
    api.patch = savedCompletionPatch;
    taskMutationTurns.clear();
  `, app);
  delete app.pendingCompletionSave;
});

test("a completed toggle reconciles a reopened detail before its next save", async () => {
  let releaseCompletion;
  app.pendingCompletionResponse = new Promise(resolve => { releaseCompletion = resolve; });
  app.reopenedStatusControl = { value: "queued" };
  app.document = { querySelector: () => app.reopenedStatusControl };
  vm.runInContext(`
    authVersion = 90;
    savedReopenedCompletionPatch = api.patch;
    state.selectedTask = null;
    state.workspaceTasks = [{ id: "task-reopened-completion", status: "queued", done: false }];
    state.selectedSubtasks = [];
    state.taskDetailDrafts = {};
    state.agentDetail = null;
    state.agentWorkPage = null;
    state.board = null;
    api.patch = async () => pendingCompletionResponse;
  `, app);

  const completion = app.toggleTaskCompletion({ id: "task-reopened-completion", status: "queued", done: false });
  await new Promise(resolve => setImmediate(resolve));
  vm.runInContext(`
    state.selectedTask = { id: "task-reopened-completion", title: "Reopened task", status: "queued", done: false };
  `, app);
  releaseCompletion({ id: "task-reopened-completion", title: "Reopened task", status: "done", done: true });
  await completion;

  assert.equal(vm.runInContext("state.selectedTask.status", app), "done");
  assert.equal(vm.runInContext("state.selectedTask.done", app), true);
  assert.equal(vm.runInContext("state.workspaceTasks[0].status", app), "done");
  assert.equal(app.reopenedStatusControl.value, "done");
  vm.runInContext(`
    api.patch = savedReopenedCompletionPatch;
    state.selectedTask = null;
    state.workspaceTasks = [];
    taskMutationTurns.clear();
  `, app);
  delete app.pendingCompletionResponse;
  delete app.reopenedStatusControl;
  delete app.document;
});

test("an old-session completion response cannot reconcile into a new account", async () => {
  let releaseOldCompletion;
  app.pendingOldCompletion = new Promise(resolve => { releaseOldCompletion = resolve; });
  vm.runInContext(`
    authVersion = 91;
    savedOldSessionCompletionPatch = api.patch;
    state.me = { id: "old-owner" };
    state.workspaceTasks = [{ id: "shared-task-id", title: "Old account task", status: "queued", done: false }];
    state.selectedSubtasks = [];
    state.selectedTask = null;
    state.agentDetail = null;
    state.agentWorkPage = null;
    state.board = null;
    api.patch = async () => pendingOldCompletion;
  `, app);

  const oldCompletion = app.toggleTaskCompletion({ id: "shared-task-id", title: "Old account task", status: "queued", done: false });
  await new Promise(resolve => setImmediate(resolve));
  vm.runInContext(`authVersion += 1;`, app);
  app.resetAuthenticatedState();
  vm.runInContext(`
    state.me = { id: "new-owner" };
    state.workspaceTasks = [{ id: "shared-task-id", title: "New account task", status: "queued", done: false }];
  `, app);
  releaseOldCompletion({ id: "shared-task-id", title: "Old account task", status: "done", done: true });
  await oldCompletion;

  assert.equal(vm.runInContext("state.workspaceTasks[0].title", app), "New account task");
  assert.equal(vm.runInContext("state.workspaceTasks[0].done", app), false);
  vm.runInContext(`
    api.patch = savedOldSessionCompletionPatch;
    state.me = null;
    state.workspaceTasks = [];
    taskMutationTurns.clear();
  `, app);
  delete app.pendingOldCompletion;
});

test("an authenticated-state reset abandons old serialized task mutations", async () => {
  let releaseOldMutation;
  app.pendingOldTaskMutation = new Promise(resolve => { releaseOldMutation = resolve; });
  vm.runInContext(`authVersion = 90;`, app);
  const oldMutation = app.serializeTaskMutation("task-session-boundary", () => app.pendingOldTaskMutation);
  await new Promise(resolve => setImmediate(resolve));
  app.staleQueuedMutationCalled = false;
  const staleQueuedMutation = app.serializeTaskMutation("task-session-boundary", async () => {
    app.staleQueuedMutationCalled = true;
    return "stale queued save ran";
  });
  assert.equal(vm.runInContext("taskMutationTurns.has('task-session-boundary')", app), true);

  vm.runInContext(`authVersion += 1;`, app);
  app.resetAuthenticatedState();
  assert.equal(vm.runInContext("taskMutationTurns.has('task-session-boundary')", app), false);

  const newMutation = app.serializeTaskMutation("task-session-boundary", async () => "new session saved");
  assert.equal(await newMutation, "new session saved");
  releaseOldMutation("old session abandoned");
  assert.equal(await oldMutation, "old session abandoned");
  assert.equal(await staleQueuedMutation, null);
  assert.equal(app.staleQueuedMutationCalled, false);
  assert.equal(vm.runInContext("taskMutationTurns.has('task-session-boundary')", app), false);
});

test("an older list-index response cannot overwrite a newer count", async () => {
  let releaseOlderLists;
  app.pendingOlderLists = new Promise(resolve => { releaseOlderLists = resolve; });
  vm.runInContext(`
    authVersion = 70;
    routeVersion = 120;
    workspaceListVersion = 0;
    workspaceListLoadVersion = 0;
    state.me = { id: "owner" };
    state.workspaceLists = [];
    let listRequests = 0;
    api.get = async path => {
      if (path !== "/api/v1/lists") throw new Error("unexpected request " + path);
      listRequests += 1;
      return listRequests === 1
        ? pendingOlderLists
        : { lists: [{ id: "youtube", name: "YouTube", openCount: 3 }] };
    };
  `, app);

  const older = app.loadWorkspaceListIndex(120);
  const newer = app.loadWorkspaceListIndex(120);
  assert.equal(await newer, true);
  assert.equal(vm.runInContext("state.workspaceLists[0].openCount", app), 3);

  releaseOlderLists({ lists: [{ id: "youtube", name: "YouTube", openCount: 2 }] });
  assert.equal(await older, false);
  assert.equal(vm.runInContext("state.workspaceLists[0].openCount", app), 3);
  vm.runInContext(`state.me = null; state.workspaceLists = [];`, app);
});

test("an older failed list-index load cannot reject after a newer load", async () => {
  let rejectOlderLists;
  app.pendingFailedLists = new Promise((_, reject) => { rejectOlderLists = reject; });
  vm.runInContext(`
    authVersion = 80;
    routeVersion = 130;
    workspaceListVersion = 0;
    workspaceListLoadVersion = 0;
    state.me = { id: "owner" };
    state.workspaceLists = [];
    let failedListRequests = 0;
    api.get = async path => {
      if (path !== "/api/v1/lists") throw new Error("unexpected request " + path);
      failedListRequests += 1;
      return failedListRequests === 1
        ? pendingFailedLists
        : { lists: [{ id: "youtube", name: "YouTube", openCount: 4 }] };
    };
  `, app);

  const older = app.loadWorkspaceListIndex(130);
  const newer = app.loadWorkspaceListIndex(130);
  assert.equal(await newer, true);
  rejectOlderLists(new Error("stale list refresh failed"));
  assert.equal(await older, false);
  assert.equal(vm.runInContext("state.workspaceLists[0].openCount", app), 4);
  vm.runInContext(`state.me = null; state.workspaceLists = [];`, app);
});

test("an older workspace response cannot overwrite a newer same-route load", async () => {
  let releaseOlderTasks;
  app.pendingOlderTasks = new Promise(resolve => { releaseOlderTasks = resolve; });
  app.location = { pathname: "/app/review", search: "" };
  vm.runInContext(`
    savedWorkspaceGet = api.get;
    authVersion = 81;
    routeVersion = 140;
    workspaceLoadVersion = 0;
    state.me = { id: "owner" };
    state.workspaceLists = [];
    state.workspaceTasks = [];
    let workspaceRequests = 0;
    api.get = async path => {
      if (path === "/api/v1/card-review-kinds") return { kinds: { task: "other" } };
      if (!path.startsWith("/api/v1/tasks?")) throw new Error("unexpected request " + path);
      workspaceRequests += 1;
      return workspaceRequests === 1
        ? pendingOlderTasks
        : { tasks: [{ id: "task", title: "Current task", status: "needs_review" }] };
    };
  `, app);

  const older = app.loadWorkspace({ name: "workspace", scope: "review" }, 140);
  const newer = app.loadWorkspace({ name: "workspace", scope: "review" }, 140);
  assert.equal(await newer, true);
  assert.equal(vm.runInContext("state.workspaceTasks[0].title", app), "Current task");

  releaseOlderTasks({ tasks: [] });
  assert.equal(await older, null);
  assert.equal(vm.runInContext("state.workspaceTasks[0].title", app), "Current task");
  vm.runInContext(`api.get = savedWorkspaceGet; state.me = null; state.workspaceLists = []; state.workspaceTasks = [];`, app);
  delete app.location;
  delete app.pendingOlderTasks;
});

const board = {
  buckets: [
    {
      id: "home",
      name: "Home list",
      tasks: [
        { id: "ready", title: "Ready action", kind: "action", status: "queued", scheduledDate: "", done: false },
        { id: "working", title: "Working action", kind: "action", status: "working", scheduledDate: "2026-07-17", done: false },
        { id: "review", title: "Review action", kind: "action", status: "needs_review", scheduledDate: "", done: false },
        { id: "done", title: "Done action", kind: "action", status: "done", scheduledDate: "", done: true },
        { id: "reference", title: "Reference item", kind: "item", status: "queued", scheduledDate: "", done: false },
      ],
    },
    {
      id: "youtube",
      name: "YouTube",
      openCount: 1,
      limitCount: 20,
      tasks: [
        { id: "script", title: "Write video script", kind: "action", status: "queued", scheduledDate: "", done: false, priority: "p0" },
      ],
    },
  ],
};

test("Flow groups every list item into five fixed states without redundant move controls", () => {
  const html = app.flowHTML(board);

  assert.deepEqual([...html.matchAll(/data-flow-status="([^"]+)"/g)].map(match => match[1]), ["new", "queued", "working", "needs_review", "done"]);
  assert.match(html, /Working action/);
  assert.match(html, /Home list/);
  assert.match(html, /Fri, Jul 17/);
  assert.match(html, /Reference item/);
  assert.match(html, /aria-label="Filter Flow by list"/);
  assert.match(html, />All lists</);
  assert.match(html, />YouTube</);
  assert.doesNotMatch(html, /data-set-task-status/);
  assert.doesNotMatch(html, /aria-label="Move Working action to/);
});

test("priority filter hides items but keeps every list on the board", () => {
  vm.runInContext('state.priorityFilter = "p0"', app);

  const matching = app.listHTML(board.buckets[1]);
  assert.match(matching, /YouTube/);
  assert.match(matching, /Write video script/);

  const empty = app.listHTML(board.buckets[0]);
  assert.match(empty, /Home list/, "a list with no matching items still renders");
  assert.match(empty, /No P0 items/, "its empty state names the active filter");
  assert.doesNotMatch(empty, /Working action/);
  assert.doesNotMatch(empty, /Ready action/);

  vm.runInContext('state.priorityFilter = ""', app);
  assert.match(app.listHTML(board.buckets[0]), /Ready action/);
  assert.match(app.listHTML(board.buckets[0]), /Nothing here yet|Ready action/);
});

test("dropping a card while filtered lands it against the real task order", () => {
  vm.runInContext(`state.board = { buckets: [{ id: "home", tasks: [
    { id: "a", priority: "p1" },
    { id: "b", priority: "p0" },
    { id: "c", priority: "p1" },
    { id: "d", priority: "p0" },
  ] }] }`, app);

  // Only b and d render under a p0 filter. Dragging d leaves b as the sole card.
  const listElement = {
    dataset: { taskList: "home" },
    querySelectorAll: () => [{ dataset: { task: "b" } }],
  };

  vm.runInContext('state.priorityFilter = ""', app);
  assert.equal(app.fullTaskIndex(listElement, 0, "d"), 0, "unfiltered boards pass the index straight through");

  vm.runInContext('state.priorityFilter = "p0"', app);
  // Dropping before the visible card b must land at b's real index, not index 0,
  // so hidden item a keeps its place ahead of it.
  assert.equal(app.fullTaskIndex(listElement, 0, "d"), 1);
  // Dropping past the last visible card goes to the true end of the list.
  assert.equal(app.fullTaskIndex(listElement, 1, "d"), 3);

  vm.runInContext('state.priorityFilter = ""', app);
  vm.runInContext('state.board = null', app);
});

test("parent drag positions treat its subtasks as part of one group", () => {
  vm.runInContext(`state.board = { buckets: [{ id: "home", tasks: [
    { id: "other" },
    { id: "parent" },
    { id: "child-one", parentTaskId: "parent" },
    { id: "child-two", parentTaskId: "parent" },
  ] }] }`, app);
  const listElement = {
    dataset: { taskList: "home" },
    querySelectorAll: () => [
      { dataset: { task: "other" } },
      { dataset: { task: "child-one" } },
      { dataset: { task: "child-two" } },
    ],
  };

  vm.runInContext('state.priorityFilter = ""', app);
  assert.equal(app.fullTaskIndex(listElement, 0, "parent"), 0);
  assert.equal(app.fullTaskIndex(listElement, 1, "parent"), 1);
  assert.equal(app.fullTaskIndex(listElement, 3, "parent"), 1, "child cards cannot inflate the bottom position");

  vm.runInContext('state.board = null', app);
});

test("dropping a parent moves its ordered subtask group through the move endpoint", async () => {
  const requests = [];
  app.taskMoveRequests = requests;
  vm.runInContext(`
    savedTaskMoveRender = render;
    savedTaskMoveReload = reload;
    savedTaskMoveRefresh = refreshAfterTaskMutation;
    savedTaskMovePost = api.post;
    render = () => {};
    reload = async () => {};
    refreshAfterTaskMutation = async () => {};
    api.post = async (path, input) => {
      taskMoveRequests.push({ path, input });
      return { id: "parent", bucketId: "destination", status: "queued", done: false };
    };
    state.board = { buckets: [
      { id: "source", tasks: [
        { id: "before", bucketId: "source" },
        { id: "parent", bucketId: "source" },
        { id: "child-one", parentTaskId: "parent", bucketId: "source" },
        { id: "child-two", parentTaskId: "parent", bucketId: "source" },
        { id: "after", bucketId: "source" },
      ] },
      { id: "destination", tasks: [{ id: "existing", bucketId: "destination" }] },
    ] };
  `, app);

  await app.dropTask("parent", "destination", 1);

  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{
    path: "/api/v1/tasks/parent/move",
    input: { bucketId: "destination", position: 1 },
  }]);
  assert.deepEqual(
    JSON.parse(vm.runInContext("JSON.stringify(state.board.buckets.map(list => list.tasks.map(task => task.id)))", app)),
    [["before", "after"], ["existing", "parent", "child-one", "child-two"]],
  );

  vm.runInContext(`
    render = savedTaskMoveRender;
    reload = savedTaskMoveReload;
    refreshAfterTaskMutation = savedTaskMoveRefresh;
    api.post = savedTaskMovePost;
    state.board = null;
  `, app);
});

test("a completed list drag reconciles a task detail opened after navigation", async () => {
  const refreshes = [];
  app.taskMoveRefreshes = refreshes;
  app.location = { pathname: "/app/boards/board-one", search: "", origin: "http://localhost" };
  app.movedListControl = { value: "source" };
  app.document = {
    querySelector(selector) {
      if (selector === "#workspace-detail-form") return {
        querySelector: field => field === '[name="bucketId"]' ? app.movedListControl : null,
      };
      return null;
    },
  };
  vm.runInContext(`
    savedCrossRouteMoveRender = render;
    savedCrossRouteMoveRefresh = refreshAfterTaskMutation;
    savedCrossRouteMovePost = api.post;
    savedCrossRouteMoveAuthVersion = authVersion;
    savedCrossRouteMoveRouteVersion = routeVersion;
    render = () => {};
    refreshAfterTaskMutation = async version => { taskMoveRefreshes.push(version); return true; };
    authVersion = 9;
    routeVersion = 12;
    state.me = { id: "owner" };
    state.workspaceLists = [
      { id: "source", boardId: "board-one", name: "Source", openCount: 1 },
      { id: "destination", boardId: "board-one", name: "Destination", openCount: 0 },
    ];
    state.board = { buckets: [
      { id: "source", tasks: [{ id: "parent", bucketId: "source", status: "queued", done: false }] },
      { id: "destination", tasks: [] },
    ] };
    state.workspaceTasks = [{ id: "parent", bucketId: "source", status: "queued", done: false }];
    api.post = async () => {
      await new Promise(resolve => { releaseCrossRouteMove = resolve; });
      return { id: "parent", bucketId: "destination", status: "queued", done: false };
    };
  `, app);

  const moving = app.dropTask("parent", "destination", 0);
  while (typeof app.releaseCrossRouteMove !== "function") await new Promise(resolve => setImmediate(resolve));
  app.location.pathname = "/app/agents/agent-research/work";
  vm.runInContext(`
    routeVersion = 13;
    state.view = "agent-work";
    state.selectedTask = { id: "parent", bucketId: "source", status: "queued", done: false };
    releaseCrossRouteMove();
  `, app);
  await moving;

  assert.equal(vm.runInContext("state.selectedTask.bucketId", app), "destination");
  assert.equal(app.movedListControl.value, "destination");
  assert.deepEqual(refreshes, [12]);

  vm.runInContext(`
    render = savedCrossRouteMoveRender;
    refreshAfterTaskMutation = savedCrossRouteMoveRefresh;
    api.post = savedCrossRouteMovePost;
    authVersion = savedCrossRouteMoveAuthVersion;
    routeVersion = savedCrossRouteMoveRouteVersion;
    state.me = null;
    state.board = null;
    state.workspaceLists = [];
    state.workspaceTasks = [];
    state.selectedTask = null;
  `, app);
  delete app.location;
  delete app.document;
});

test("adding an item is blocked while a filter is active", () => {
  vm.runInContext('state.priorityFilter = "p0"', app);
  const filtered = app.listHTML(board.buckets[1]);
  assert.match(filtered, /Clear the filter to add items/);
  assert.match(filtered, /<input name="title"[^>]*disabled/);
  assert.doesNotMatch(filtered, /aria-describedby="item-limit/, "no dangling describedby when the limit is not the blocker");

  vm.runInContext('state.priorityFilter = ""', app);
  const open = app.listHTML(board.buckets[1]);
  assert.match(open, /placeholder="Add item"/);
  assert.doesNotMatch(open, /<input name="title"[^>]*disabled/);
});

test("priority renders as a card badge only when set", () => {
  assert.match(app.taskPriorityBadgeHTML({ priority: "p0" }), /class="priority-badge priority-p0">P0</);
  assert.equal(app.taskPriorityBadgeHTML({ priority: "" }), "");
  assert.equal(app.taskPriorityBadgeHTML({}), "");
});

test("priority options offer None plus the three levels", () => {
  const html = app.priorityOptionsHTML("p1");
  assert.match(html, /value="" >None|value="" selected>None/);
  assert.match(html, /value="p1" selected>P1/);
  assert.match(html, /value="p0" >P0|value="p0">P0/);
  assert.match(html, /value="p2"/);
});

test("Flow filters cards to one selected list", () => {
  vm.runInContext('state.flowListId = "youtube"', app);
  const html = app.flowHTML(board);

  assert.match(html, /value="youtube" selected>YouTube/);
  assert.match(html, /Write video script/);
  assert.doesNotMatch(html, /Working action/);
  assert.doesNotMatch(html, /Reference item/);
  vm.runInContext('state.flowListId = ""', app);
});

test("detail exposes state without a type control", () => {
  vm.runInContext(`
    state.workspaceLists = [{ id: "inbox", name: "Home list" }];
    state.selectedSubtasks = [];
  `, app);
  const actionHTML = app.workspaceDetailHTML({ ...board.buckets[0].tasks[1], description: "", priority: "", assigneeAgentId: "" });

  assert.match(actionHTML, /name="status"/);
  assert.match(actionHTML, /value="working" selected>In Progress/);
  assert.doesNotMatch(actionHTML, /name="kind"/);
});

test("detail presents one contextual accessible card editor with clear actions", () => {
  vm.runInContext(`
    state.view = "home";
    state.workspaceLists = [{ id: "inbox", name: "Home list" }];
    state.selectedSubtasks = [];
  `, app);
  const html = app.workspaceDetailHTML({ ...board.buckets[0].tasks[1], description: "", priority: "", assigneeAgentId: "" });

  assert.match(html, /class="workspace-detail" aria-label="Card detail"/);
  assert.doesNotMatch(html, /role="dialog"|aria-modal="true"|detail-overlay/);
  assert.match(html, /class="detail-title"/);
  assert.match(html, /class="detail-description"/);
  assert.match(html, /class="detail-properties"/);
  assert.match(html, />Save changes</);
  assert.match(html, /data-close-detail/);
  assert.match(html, />Back to cards<\/span>/);
  assert.match(html, />Delete card</);
  assert.match(html, /Home list/);
  assert.doesNotMatch(html, /aria-label="Close card"/);
});

test("detail can move a parent task between account-wide lists", () => {
  vm.runInContext(`
    state.boards = [{ id: "board", name: "Home" }, { id: "other", name: "Campaigns" }];
    state.workspaceLists = [
      { id: "list", boardId: "board", name: "Inbox", isInbox: true },
      { id: "other-list", boardId: "other", name: "Inbox", isInbox: true },
    ];
    state.selectedSubtasks = [];
  `, app);
  const html = app.workspaceDetailHTML({ id: "task", bucketId: "list", title: "Move me", description: "", status: "queued", priority: "", assigneeAgentId: "", scheduledDate: "" });
  assert.match(html, /id="workspace-detail-list" name="bucketId"/);
  assert.match(html, /value="list" selected>Home \/ Inbox<\/option>/);
  assert.match(html, /value="other-list" >Campaigns \/ Inbox<\/option>|value="other-list">Campaigns \/ Inbox<\/option>/);
  assert.doesNotMatch(html, /id="move-panel"|id="move-position"/);
  vm.runInContext(`state.boards = []; state.workspaceLists = [];`, app);
});

test("footer reports live Working and Review counts", () => {
  const html = app.footerHTML(board, false);
  assert.match(html, /1 working/);
  assert.match(html, /1 in review/);
});

test("failed status updates restore persisted state and expose an accessible error", async () => {
	let refreshed = false;
	await app.runMutation(
		async () => { throw new Error("Max active items per list is 20 on Pro."); },
		async () => { refreshed = true; },
	);

	assert.equal(refreshed, true);
	assert.equal(vm.runInContext("state.error", app), "Max active items per list is 20 on Pro.");
	assert.match(app.statusErrorHTML("Max active items per list is 20 on Pro."), /role="alert">Max active items per list is 20 on Pro\./);
});

test("plain-text API errors remain readable", () => {
  assert.throws(
    () => app.decodeResponseBody("method not allowed\n", false),
    error => error.message === "method not allowed",
  );
  assert.equal(app.decodeResponseBody('{"ok":true}', true).ok, true);
});

test("switching accounts clears old account data and loads only the new account's board", async () => {
  const requestedPaths = [];
  app.requestedPaths = requestedPaths;
  vm.runInContext(`
    state.me = { id: "account-a", theme: "dark" };
    state.boards = [{ id: "board-a", name: "Account A board" }];
    state.board = { id: "board-a", name: "Account A board", buckets: [{ id: "list-a", tasks: [{ id: "secret-a" }] }] };
    state.selectedTask = { id: "secret-a" };
    state.settings = true;
    state.tokens = [{ id: "token-a" }];
    state.newToken = "secret-token-a";
    state.newTaskRecovery = { task: { id: "secret-a", title: "Account A card" }, message: "Could not open", pending: false };
    state.newTaskCapturePending = true;
    state.goalErrors = { "list-a": "old error" };
    state.flowListId = "list-a";
    state.weekStart = "2026-07-20";
    api.get = async path => {
      requestedPaths.push(path);
      if (path === "/api/v1/boards") return { boards: [{ id: "board-b", name: "Account B board" }], maxBoards: 5 };
      if (path === "/api/v1/boards/board-b") return { id: "board-b", name: "Account B board", buckets: [] };
      throw new Error("unexpected request for " + path);
    };
  `, app);

  app.beginAuthenticatedSession({
    id: "account-b",
    theme: "light",
    entitlement: { limits: { boards: 5, listsPerBoard: 9, activeItemsPerList: 20 } },
  });
  await app.loadBoards();

  assert.deepEqual(requestedPaths, ["/api/v1/boards", "/api/v1/boards/board-b"]);
  assert.deepEqual(
    JSON.parse(vm.runInContext(`JSON.stringify({
      me: state.me.id,
      boards: state.boards.map(board => board.id),
      board: state.board.id,
      selectedTask: state.selectedTask,
    settings: state.settings,
      settingsPage: state.settingsPage,
      tokens: state.tokens,
      newToken: state.newToken,
      newTaskRecovery: state.newTaskRecovery,
      newTaskCapturePending: state.newTaskCapturePending,
      goalErrors: state.goalErrors,
      flowListId: state.flowListId,
      weekStart: state.weekStart,
    })`, app)),
    {
      me: "account-b",
      boards: ["board-b"],
      board: "board-b",
      selectedTask: null,
      settings: false,
      settingsPage: "profile",
      tokens: [],
      newToken: "",
      newTaskRecovery: null,
      newTaskCapturePending: false,
      goalErrors: {},
      flowListId: "",
      weekStart: "",
    },
  );
});

test("a delayed board response from an old account cannot overwrite the new account", async () => {
  let releaseOldBoard;
  app.oldBoardResponse = new Promise(resolve => { releaseOldBoard = resolve; });
  app.releaseOldBoard = releaseOldBoard;
  vm.runInContext(`
    authVersion = 20;
    state.me = { id: "account-a", theme: "dark" };
    state.boards = [{ id: "board-a", name: "Account A board" }];
    state.board = { id: "board-a", name: "Account A board", buckets: [] };
    api.get = async path => {
      if (path === "/api/v1/boards/board-a") {
        await oldBoardResponse;
        return { id: "board-a", name: "Account A private board", buckets: [] };
      }
      if (path === "/api/v1/boards") return { boards: [{ id: "board-b", name: "Account B board" }], maxBoards: 5 };
      if (path === "/api/v1/boards/board-b") return { id: "board-b", name: "Account B board", buckets: [] };
      throw new Error("unexpected request for " + path);
    };
  `, app);

  const oldLoad = app.loadBoard("board-a");
  app.beginAuthenticatedSession({ id: "account-b", theme: "light" });
  await app.loadBoards();
  app.releaseOldBoard();
  assert.equal(await oldLoad, false);

  assert.equal(vm.runInContext("state.me.id", app), "account-b");
  assert.equal(vm.runInContext("state.board.id", app), "board-b");
});

test("delayed token metadata from an old account is discarded", async () => {
  let releaseOldTokens;
  app.oldTokensResponse = new Promise(resolve => { releaseOldTokens = resolve; });
  app.releaseOldTokens = releaseOldTokens;
  vm.runInContext(`
    authVersion = 30;
    state.me = { id: "account-a" };
    state.tokens = [];
    api.get = async path => {
      if (path !== "/api/v1/api-tokens") throw new Error("unexpected request for " + path);
      await oldTokensResponse;
      return { tokens: [{ id: "token-a", name: "Account A agent" }] };
    };
  `, app);

  const oldLoad = app.loadTokens();
  app.beginAuthenticatedSession({ id: "account-b", theme: "light" });
  app.releaseOldTokens();

  assert.equal(await oldLoad, false);
  assert.deepEqual(JSON.parse(vm.runInContext("JSON.stringify(state.tokens)", app)), []);
});

test("a delayed raw API token from an old account is discarded", async () => {
  let releaseOldTokenCreation;
  app.oldTokenCreationResponse = new Promise(resolve => { releaseOldTokenCreation = resolve; });
  app.releaseOldTokenCreation = releaseOldTokenCreation;
  vm.runInContext(`
    authVersion = 40;
    state.me = { id: "account-a" };
    state.newToken = "";
    api.post = async path => {
      if (path !== "/api/v1/api-tokens") throw new Error("unexpected request for " + path);
      await oldTokenCreationResponse;
      return { token: "slate_account_a_secret" };
    };
  `, app);

  const oldCreation = app.createAPIToken("Account A agent");
  app.beginAuthenticatedSession({ id: "account-b", theme: "light" });
  app.releaseOldTokenCreation();

  assert.equal(await oldCreation, false);
  assert.equal(vm.runInContext("state.newToken", app), "");
});

test("a delayed board deletion from an old account cannot create data in the new account", async () => {
  let releaseOldDelete;
  const posts = [];
  app.oldDeleteResponse = new Promise(resolve => { releaseOldDelete = resolve; });
  app.releaseOldDelete = releaseOldDelete;
  app.boardDeletePosts = posts;
  app.confirm = () => true;
  vm.runInContext(`
    authVersion = 50;
    state.me = { id: "account-a" };
    state.boards = [{ id: "board-a", name: "Account A board" }, { id: "board-survivor", name: "Survivor" }];
    state.board = { id: "board-a", name: "Account A board", buckets: [] };
    state.workspaceLists = [{ id: "surviving-inbox", boardId: "board-survivor", isInbox: true }];
    api.del = async path => {
      if (path !== "/api/v1/boards/board-a") throw new Error("unexpected delete for " + path);
      await oldDeleteResponse;
      return { ok: true };
    };
    api.post = async (path, input) => {
      boardDeletePosts.push({ path, input });
      return { id: "unexpected-board" };
    };
  `, app);

  const oldDelete = app.deleteBoard("board-a");
  app.beginAuthenticatedSession({ id: "account-b", theme: "light" });
  app.releaseOldDelete();
  await oldDelete;

  assert.deepEqual(posts, []);
  assert.equal(vm.runInContext("state.me.id", app), "account-b");
  assert.deepEqual(JSON.parse(vm.runInContext("JSON.stringify(state.boards)", app)), []);
  assert.equal(vm.runInContext("state.board", app), null);
  vm.runInContext(`render = savedBoardDeleteRender;`, app);
});

test("API responses from an old session cannot resume mutation continuations", async () => {
  let releaseOldMutation;
  let continued = false;
  app.oldMutationResponse = new Promise(resolve => { releaseOldMutation = resolve; });
  app.releaseOldMutation = releaseOldMutation;
  app.fetch = async () => {
    await app.oldMutationResponse;
    return { ok: true, text: async () => '{"ok":true}' };
  };
  vm.runInContext(`authVersion = 60; state.me = { id: "account-a" };`, app);

  const oldMutation = vm.runInContext(`api.request("/api/v1/tasks/task-a", { method: "PATCH", body: '{"done":true}' })`, app).then(() => { continued = true; });
  app.beginAuthenticatedSession({ id: "account-b", theme: "light" });
  app.releaseOldMutation();
  await Promise.race([oldMutation, new Promise(resolve => setTimeout(resolve, 20))]);

  assert.equal(continued, false);
});

test("a stale theme request cannot block theme saves in the new session", async () => {
  let releaseOldTheme;
  let markOldThemeStarted;
  const fetchCalls = [];
  app.oldThemeResponse = new Promise(resolve => { releaseOldTheme = resolve; });
  app.oldThemeStarted = new Promise(resolve => { markOldThemeStarted = resolve; });
  app.releaseOldTheme = releaseOldTheme;
  app.themeFetchCalls = fetchCalls;
  app.fetch = async (path, options) => {
    fetchCalls.push({ path, body: options.body });
    if (fetchCalls.length === 1) {
      markOldThemeStarted();
      await app.oldThemeResponse;
    }
    const theme = JSON.parse(options.body).theme;
    return { ok: true, text: async () => JSON.stringify({ id: theme === "dark" ? "account-a" : "account-b", theme }) };
  };
  vm.runInContext(`
    api.patch = (path, input) => api.request(path, { method: "PATCH", body: JSON.stringify(input) });
    render = () => {};
    authVersion = 70;
    beginAuthenticatedSession({ id: "account-a", theme: "light" });
  `, app);

  app.updateTheme("dark");
  await app.oldThemeStarted;
  app.beginAuthenticatedSession({ id: "account-b", theme: "dark" });
  app.releaseOldTheme();
  await app.updateTheme("light");

  assert.equal(fetchCalls.length, 2);
  assert.equal(vm.runInContext("state.me.id", app), "account-b");
  assert.equal(vm.runInContext("state.theme", app), "light");
});

test("one theme holds when switching between boards", () => {
  vm.runInContext(`
    state.theme = "dark";
    state.board = { id: "light-board", name: "Light board", backgroundValue: "light", buckets: [] };
  `, app);

  assert.match(app.appHTML(), /class="shell task-shell theme-dark"/);
  vm.runInContext(`state.board = { id: "other-board", name: "Other board", backgroundValue: "charcoal", buckets: [] }`, app);
  assert.match(app.appHTML(), /class="shell task-shell theme-dark"/);
  assert.match(app.appHTML(), /class="theme-switch dark"/);
  assert.match(app.appHTML(), /data-set-theme="dark"[^>]*class="on"/);
});

test("changing theme updates the user preference once", async () => {
  const patched = [];
  app.patched = patched;
  vm.runInContext(`
    state.theme = "light";
    state.me = { id: "owner", theme: "light" };
    api.patch = async (path, input) => {
      patched.push({ path, input });
      return { id: "owner", theme: input.theme };
    };
    render = () => {};
  `, app);

  await app.updateTheme("dark");

  assert.deepEqual(patched.map(call => call.path), ["/api/v1/me"]);
  assert.equal(vm.runInContext("state.theme", app), "dark");
  assert.equal(vm.runInContext("state.me.theme", app), "dark");
});

test("changing theme updates the interface before persistence completes", async () => {
  app.pendingThemeSave = new Promise(resolve => { app.releaseThemeSave = resolve; });
  vm.runInContext(`
    state.theme = "light";
    state.me = { id: "owner", theme: "light" };
    api.patch = async (path, input) => {
      await pendingThemeSave;
      return { id: "owner", theme: input.theme };
    };
  `, app);

  const save = app.updateTheme("dark");

  assert.equal(vm.runInContext("state.theme", app), "dark");
  app.releaseThemeSave();
  await save;
});

test("a current theme failure restores the persisted preference with a readable status", async () => {
  vm.runInContext(`
    authVersion = 6;
    state.theme = "light";
    state.themeStatus = "";
    state.error = "";
    state.me = { id: "owner", theme: "light" };
    api.patch = async () => { throw new Error("Theme save failed"); };
    render = () => {};
  `, app);

  assert.equal(await app.updateTheme("dark"), false);
  assert.equal(vm.runInContext("state.theme", app), "light");
  assert.equal(vm.runInContext("state.error", app), "Theme save failed");
  assert.match(vm.runInContext("state.themeStatus", app), /Could not save theme. Restored light/);
});

test("finishing a theme save after logout does not restore the user", async () => {
  app.pendingLogoutThemeSave = new Promise(resolve => { app.releaseLogoutThemeSave = resolve; });
  vm.runInContext(`
    state.theme = "light";
    state.me = { id: "owner", theme: "light" };
    api.patch = async (path, input) => {
      await pendingLogoutThemeSave;
      return { id: "owner", theme: input.theme };
    };
  `, app);

  const save = app.updateTheme("dark");
  vm.runInContext(`state.me = null`, app);
  app.releaseLogoutThemeSave();
  await save;

  assert.equal(vm.runInContext("state.me", app), null);
});

test("a theme response from an old session cannot overwrite a new login", async () => {
  app.pendingOldSessionThemeSave = new Promise(resolve => { app.releaseOldSessionThemeSave = resolve; });
  vm.runInContext(`
    authVersion = 7;
    state.theme = "light";
    state.me = { id: "owner", theme: "light" };
    api.patch = async (path, input) => {
      await pendingOldSessionThemeSave;
      return { id: "owner", theme: input.theme };
    };
  `, app);

  const save = app.updateTheme("dark");
  await Promise.resolve();
  vm.runInContext(`
    authVersion = 8;
    state.me = { id: "owner", theme: "light" };
  `, app);
  app.releaseOldSessionThemeSave();
  await save;

  assert.equal(vm.runInContext("state.me.theme", app), "light");
});

test("a theme failure from an old session is cancelled after a new login", async () => {
  app.pendingOldSessionThemeFailure = new Promise((resolve, reject) => { app.rejectOldSessionThemeSave = reject; });
  app.oldSessionFailureStarted = new Promise(resolve => { app.markOldSessionFailureStarted = resolve; });
  vm.runInContext(`
    authVersion = 8;
    state.theme = "light";
    state.me = { id: "owner", theme: "light" };
    api.patch = async () => {
      markOldSessionFailureStarted();
      return pendingOldSessionThemeFailure;
    };
  `, app);

  const save = app.updateTheme("dark");
  await app.oldSessionFailureStarted;
  vm.runInContext(`
    authVersion = 9;
    state.me = { id: "owner", theme: "light" };
  `, app);
  app.rejectOldSessionThemeSave(new Error("old session expired"));
  await save;

  assert.equal(vm.runInContext("state.me.theme", app), "light");
});

test("a queued theme save does not start after the session changes", async () => {
  const patches = [];
  app.queuedThemePatches = patches;
  app.pendingFirstThemeSave = new Promise(resolve => { app.releaseFirstThemeSave = resolve; });
  app.firstThemePatchStarted = new Promise(resolve => { app.markFirstThemePatchStarted = resolve; });
  vm.runInContext(`
    authVersion = 10;
    state.theme = "light";
    state.me = { id: "owner", theme: "light" };
    api.patch = async (path, input) => {
      queuedThemePatches.push(input.theme);
      if (queuedThemePatches.length === 1) {
        markFirstThemePatchStarted();
        await pendingFirstThemeSave;
      }
      return { id: "owner", theme: input.theme };
    };
  `, app);

  const first = app.updateTheme("dark");
  const second = app.updateTheme("light");
  await app.firstThemePatchStarted;
  vm.runInContext(`authVersion = 11; state.me = null`, app);
  app.releaseFirstThemeSave();
  await Promise.all([first, second]);

  assert.deepEqual(patches, ["dark"]);
  assert.equal(vm.runInContext("state.me", app), null);
});

test("rapid theme changes are persisted in click order", async () => {
  const patched = [];
  app.patched = patched;
  vm.runInContext(`
    state.theme = "light";
    state.me = { id: "owner", theme: "light" };
    api.patch = async (path, input) => {
      patched.push(input.theme);
      return { id: "owner", theme: input.theme };
    };
  `, app);

  await Promise.all([app.updateTheme("dark"), app.updateTheme("light"), app.updateTheme("dark")]);

  assert.deepEqual(patched, ["dark", "light", "dark"]);
  assert.equal(vm.runInContext("state.theme", app), "dark");
});

test("same-list drops produce the requested task order", () => {
  const ids = ["one", "two", "three"];

  assert.deepEqual(Array.from(app.reorderedTaskIDs(ids, "three", "one")), ["three", "one", "two"]);
  assert.deepEqual(Array.from(app.reorderedTaskIDs(ids, "one", "two", true)), ["two", "one", "three"]);
  assert.deepEqual(Array.from(app.reorderedTaskIDs(ids, "one", "")), ["two", "three", "one"]);
  assert.deepEqual(Array.from(app.reorderedTaskIDs(ids, "two", "two")), ids);
});

test("counts use readable singular and plural labels", () => {
  assert.equal(app.formatCount(1, "open action", "open actions"), "1 open action");
  assert.equal(app.formatCount(2, "open action", "open actions"), "2 open actions");
});

test("horizontal list drops use pointer x position", () => {
  const rects = [
    { left: 0, width: 300 },
    { left: 320, width: 300 },
  ];

  assert.equal(app.bucketDropIndexForRects(rects, 20), 0);
  assert.equal(app.bucketDropIndexForRects(rects, 280), 1);
  assert.equal(app.bucketDropIndexForRects(rects, 640), 2);
});

// Each router test gets its own module instance so history and auth state
// cannot leak between cases.
function router({ signedIn = false, boards = [], url = "/" } = {}) {
  const context = { console, Date, URLSearchParams, window: { addEventListener() {} } };
  vm.createContext(context);
  vm.runInContext(source, context, { filename });

  const split = value => {
    const [path, search = ""] = String(value).split("#")[0].split("?");
    return { path, search: search ? `?${search}` : "" };
  };
  const entries = [split(url)];
  const rendered = [];

  context.location = {
    get pathname() { return entries[entries.length - 1].path; },
    get search() { return entries[entries.length - 1].search; },
    hash: "",
  };
  context.history = {
    pushState(_state, _title, value) { entries.push(split(value)); },
    replaceState(_state, _title, value) { entries[entries.length - 1] = split(value); },
  };
  context.render = () => rendered.push(vm.runInContext("state.view + (state.settings ? \":settings\" : \"\")", context));
  context.realLoadTokens = context.loadTokens;
  context.realLoadAgents = context.loadAgents;
  context.loadTokens = async () => true;
  context.boardRequests = [];

  vm.runInContext(`
    state.me = ${signedIn ? '{ id: "owner", theme: "light" }' : "null"};
    api.get = async path => {
      if (path === "/api/v1/boards") return { boards: ${JSON.stringify(boards)} };
      if (path === "/api/v1/agents") return { agents: [] };
      const id = path.replace("/api/v1/boards/", "");
      boardRequests.push(id);
      return { id, name: id, buckets: [] };
    };
  `, context);

  return {
    context,
    rendered,
    url: () => entries[entries.length - 1].path + entries[entries.length - 1].search,
    depth: () => entries.length,
    view: () => rendered[rendered.length - 1],
    board: () => vm.runInContext("state.board && state.board.id", context),
    error: () => vm.runInContext("state.error", context),
    routeError: () => vm.runInContext("state.routeError && state.routeError.name", context),
    go: value => context.navigate(value),
    home: () => context.goHome(),
    apply: () => context.applyRoute(),
    back: () => { entries.pop(); return context.applyRoute(); },
  };
}

test("routes parse into the surface they name", () => {
  // parseRoute returns objects from the vm realm, so compare plain copies.
  const route = path => ({ ...app.parseRoute(path) });

  assert.deepEqual(route("/"), { name: "home" });
  assert.deepEqual(route("/login"), { name: "login" });
  assert.deepEqual(route("/app"), { name: "workspace", scope: "today", redirect: true });
  assert.deepEqual(route("/app/tasks"), { name: "workspace", scope: "all" });
  assert.deepEqual(route("/app/inbox"), { name: "workspace", scope: "inbox" });
  assert.deepEqual(route("/app/today"), { name: "workspace", scope: "today" });
  assert.deepEqual(route("/app/week"), { name: "workspace", scope: "week" });
  assert.deepEqual(route("/app/review"), { name: "workspace", scope: "review" });
  assert.deepEqual(route("/app/lists/list-one"), { name: "workspace", scope: "list", listId: "list-one" });
  assert.deepEqual(route("/app/settings"), { name: "settings", settingsPage: "profile", redirect: true });
  for (const page of ["profile", "preferences", "api"]) {
    assert.deepEqual(route(`/app/settings/${page}`), { name: "settings", settingsPage: page });
  }
  assert.deepEqual(route("/app/settings/agents"), { name: "agents", redirect: true });
  assert.deepEqual(route("/app/agents"), { name: "agents" });
  assert.deepEqual(route("/app/agents/new"), { name: "agent-new" });
  assert.deepEqual(route("/app/agents/agent-one"), { name: "agent-detail", agentId: "agent-one" });
  assert.deepEqual(route("/app/agents/a%20b"), { name: "agent-detail", agentId: "a b" });
  assert.deepEqual(route("/app/agents/agent-one/work"), { name: "agent-work", agentId: "agent-one" });
  assert.deepEqual(route("/early-access"), { name: "early-access" });
  assert.deepEqual(route("/reset-password"), { name: "reset-password" });
  assert.deepEqual(route("/app/boards/board_1"), { name: "board", boardId: "board_1" });
  assert.deepEqual(route("/app/boards/board_1/settings"), { name: "board", boardId: "board_1", redirect: true });
  assert.deepEqual(route("/app/boards/a%20b"), { name: "board", boardId: "a b" });
  assert.deepEqual(route("/app/boards/a%20b/settings"), { name: "board", boardId: "a b", redirect: true });
  assert.deepEqual(route("/app/boards/%ED%A0%80"), { name: "not-found" });

  // Trailing slashes, queries, and fragments never change which route is named.
  assert.deepEqual(route("/app/"), { name: "workspace", scope: "today", redirect: true });
  assert.deepEqual(route("/login?next=/app"), { name: "login" });
  assert.deepEqual(route("/app/settings#token"), { name: "settings", settingsPage: "profile", redirect: true });

  for (const path of ["/nonsense", "/app/boards", "/app/boards/a/b", "/app/agents/agent-one/extra", "/app/agents/agent-one/work/extra", "/app/agents/new/extra", "/app/settings/board", "/app/settings/unknown", "/app/settings/profile/extra", "/appleseed", "/cli"]) {
    assert.equal(app.parseRoute(path).name, "not-found", path);
  }
});

test("only same-origin app paths survive as a login next target", () => {
  assert.equal(app.safeNextPath("/app/settings"), "/app/settings");
  assert.equal(app.safeNextPath("/app/settings/agents"), "/app/settings/agents");
  assert.equal(app.safeNextPath("/app/agents"), "/app/agents");
  assert.equal(app.safeNextPath("/app/agents/new"), "/app/agents/new");
  assert.equal(app.safeNextPath("/app/agents/agent-one"), "/app/agents/agent-one");
  assert.equal(app.safeNextPath("/app/agents/agent-one/work"), "/app/agents/agent-one/work");
  assert.equal(app.safeNextPath("/app/agents/agent-one/work?page=2"), "/app/agents/agent-one/work?page=2");
  assert.equal(app.safeNextPath("/app/boards/board_1"), "/app/boards/board_1");
  assert.equal(app.safeNextPath("/app/boards/board_1/settings"), "/app/boards/board_1/settings");
  assert.equal(app.safeNextPath("/app/"), "/app");

  for (const value of ["//evil.example", "https://evil.example/app", "/\\evil.example", "/app\\..", "/", "/login", "/nonsense", "", null, undefined]) {
    assert.equal(app.safeNextPath(value), "", String(value));
  }

  assert.equal(app.loginPathFor("/app/settings"), "/login?next=%2Fapp%2Fsettings");
  assert.equal(app.loginPathFor("/app/settings/api"), "/login?next=%2Fapp%2Fsettings%2Fapi");
  assert.equal(app.loginPathFor("/app/agents/agent-one/work?page=2"), "/login?next=%2Fapp%2Fagents%2Fagent-one%2Fwork%3Fpage%3D2");
  assert.equal(app.loginPathFor("/app"), "/login");
  assert.equal(app.loginPathFor("https://evil.example"), "/login");
});

test("signed-out visits to protected routes redirect to login and keep the exact destination", async () => {
  for (const target of ["/app/boards/board_1", "/app/boards/board_1/settings", "/app/agents", "/app/agents/new", "/app/agents/agent-one", "/app/agents/agent-one/work", "/app/settings/profile", "/app/settings/preferences", "/app/settings/agents", "/app/settings/api"]) {
    const it = router({ url: target });
    await it.apply();
    assert.equal(it.url(), `/login?next=${encodeURIComponent(target)}`);
    assert.equal(it.view(), "login");
  }
});

test("logging in returns to the requested route, defaulting to the app", async () => {
  const it = router({ url: "/login?next=%2Fapp%2Fsettings", boards: [{ id: "board_1" }] });
  vm.runInContext(`state.me = { id: "owner", theme: "light" };`, it.context);

  await it.apply();

  assert.equal(it.url(), "/app/settings/profile");
  assert.equal(it.view(), "app:settings");
  assert.equal(it.depth(), 1, "the legacy settings path must be replaced by profile");

  const plain = router({ url: "/login", signedIn: true, boards: [{ id: "board_1" }] });
  await plain.apply();
  assert.equal(plain.url(), "/app/today");
});

test("a rejected next target falls back to the app rather than leaving the origin", async () => {
  const it = router({ url: "/login?next=https%3A%2F%2Fevil.example", signedIn: true, boards: [{ id: "board_1" }] });

  await it.apply();

  assert.equal(it.url(), "/app/today");
});

test("/app resolves to Today", async () => {
  const withBoards = router({ url: "/app", signedIn: true, boards: [{ id: "board_1" }, { id: "board_2" }] });
  await withBoards.apply();
  assert.equal(withBoards.url(), "/app/today");
  assert.equal(withBoards.board(), "board_1");
  assert.equal(withBoards.depth(), 1, "resolving /app must not add a history entry");

  const empty = router({ url: "/app", signedIn: true, boards: [] });
  await empty.apply();
  assert.equal(empty.url(), "/app/today");
  assert.equal(empty.view(), "app");
  assert.equal(empty.board(), null);
});

test("the brand link goes to Today when signed in, and home when signed out", async () => {
  const onBoard = router({ url: "/app/boards/board_2", signedIn: true, boards: [{ id: "board_1" }, { id: "board_2" }] });
  await onBoard.apply();
  await onBoard.home();
  assert.equal(onBoard.url(), "/app/today", "the brand must not drop a signed-in user onto the landing page");

  const noBoardLoaded = router({ url: "/app/settings/profile", signedIn: true, boards: [{ id: "board_1" }] });
  await noBoardLoaded.apply();
  await noBoardLoaded.home();
  assert.equal(noBoardLoaded.url(), "/app/today");

  const staleBoard = router({ url: "/app/boards/board_2", signedIn: true, boards: [{ id: "board_1" }, { id: "board_2" }] });
  await staleBoard.apply();
  vm.runInContext(`state.boards = [{ id: "board_1" }];`, staleBoard.context);
  await staleBoard.home();
  assert.equal(staleBoard.url(), "/app/today");

  const noBoards = router({ url: "/app", signedIn: true, boards: [] });
  await noBoards.apply();
  await noBoards.home();
  assert.equal(noBoards.url(), "/app/today");

  const signedOut = router({ url: "/login" });
  await signedOut.apply();
  await signedOut.home();
  assert.equal(signedOut.url(), "/");
});

test("a board deep link loads that board, and an unknown id is not found", async () => {
  const it = router({ url: "/app/boards/board_2", signedIn: true, boards: [{ id: "board_1" }, { id: "board_2" }] });
  await it.apply();
  assert.equal(it.board(), "board_2");
  assert.equal(it.view(), "board");

  const missing = router({ url: "/app/boards/board_9", signedIn: true, boards: [{ id: "board_1" }] });
  await missing.apply();
  assert.equal(missing.view(), "not-found");
  assert.equal(missing.url(), "/app/boards/board_9", "a not-found board keeps its URL rather than silently swapping boards");
  assert.equal(missing.board(), null);
});

test("legacy board settings URLs return to the board", async () => {
  const existing = router({ url: "/app/boards/board_1/settings", signedIn: true, boards: [{ id: "board_1" }] });
  await existing.apply();
  assert.equal(existing.url(), "/app/boards/board_1");
  assert.equal(existing.view(), "board");

  const missing = router({ url: "/app/boards/missing/settings", signedIn: true, boards: [{ id: "board_1" }] });
  await missing.apply();
  assert.equal(missing.view(), "not-found");
  assert.equal(missing.url(), "/app/boards/missing");
  assert.equal(missing.board(), null);
});

test("a failed board-list navigation renders an error for the requested URL and retries in place", async () => {
  const boards = [{ id: "board_1" }, { id: "board_2" }];
  const it = router({ url: "/app/boards/board_1", signedIn: true, boards });
  await it.apply();
  const depth = it.depth();
  vm.runInContext(`api.get = async () => { throw new Error("Boards are unavailable"); };`, it.context);

  await assert.doesNotReject(it.go("/app/boards/board_2"));

  assert.equal(it.url(), "/app/boards/board_2");
  assert.equal(it.depth(), depth + 1);
  assert.equal(it.view(), "route-error");
  assert.equal(it.routeError(), "board");
  assert.equal(it.error(), "Boards are unavailable");
  assert.equal(it.board(), "board_1", "the previous board may remain cached but must not be rendered");

  vm.runInContext(`
    api.get = async path => {
      if (path === "/api/v1/boards") return { boards: ${JSON.stringify(boards)} };
      return { id: "board_2", name: "Board two", buckets: [] };
    };
  `, it.context);
  await it.apply();

  assert.equal(it.url(), "/app/boards/board_2");
  assert.equal(it.depth(), depth + 1, "retry must not add another history entry");
  assert.equal(it.view(), "board");
  assert.equal(it.board(), "board_2");
  assert.equal(it.error(), "");
});

test("a failed board-detail navigation renders an error for that board without rejecting", async () => {
  const boards = [{ id: "board_1" }, { id: "board_2" }];
  const it = router({ url: "/app/boards/board_1", signedIn: true, boards });
  await it.apply();
  vm.runInContext(`
    api.get = async path => {
      if (path === "/api/v1/boards") return { boards: ${JSON.stringify(boards)} };
      if (path === "/api/v1/boards/board_2") throw new Error("Board could not be loaded");
      return { id: "board_1", name: "Board one", buckets: [] };
    };
  `, it.context);

  await assert.doesNotReject(it.go("/app/boards/board_2"));

  assert.equal(it.url(), "/app/boards/board_2");
  assert.equal(it.view(), "route-error");
  assert.equal(it.routeError(), "board");
  assert.equal(it.error(), "Board could not be loaded");
});

test("failed token loads render route-owned errors at the requested page", async () => {
  const tokenFailure = router({ url: "/app/boards/board_1", signedIn: true, boards: [{ id: "board_1" }] });
  await tokenFailure.apply();
  tokenFailure.context.loadTokens = tokenFailure.context.realLoadTokens;
  vm.runInContext(`
    api.get = async path => {
      if (path === "/api/v1/boards") return { boards: [{ id: "board_1" }] };
      if (path === "/api/v1/lists") return { lists: [] };
      if (path === "/api/v1/api-tokens") throw new Error("Tokens could not be loaded");
      throw new Error("unexpected request: " + path);
    };
  `, tokenFailure.context);

  await assert.doesNotReject(tokenFailure.go("/app/settings/api"));

  assert.equal(tokenFailure.url(), "/app/settings/api");
  assert.equal(tokenFailure.view(), "route-error");
  assert.equal(tokenFailure.routeError(), "settings");
  assert.equal(tokenFailure.error(), "Tokens could not be loaded");
});

test("a route failure during back navigation preserves the history destination", async () => {
  const boards = [{ id: "board_1" }, { id: "board_2" }];
  const it = router({ url: "/", signedIn: true, boards });
  await it.apply();
  await it.go("/app/boards/board_1");
  await it.go("/app/boards/board_2");
  const depth = it.depth();
  vm.runInContext(`api.get = async () => { throw new Error("History destination unavailable"); };`, it.context);

  await assert.doesNotReject(it.back());

  assert.equal(it.url(), "/app/boards/board_1");
  assert.equal(it.depth(), depth - 1);
  assert.equal(it.view(), "route-error");
  assert.equal(it.routeError(), "board");
  assert.equal(it.error(), "History destination unavailable");
});

test("a stale board response cannot overwrite newer route navigation", async () => {
  const it = router({ url: "/", signedIn: true });
  let releaseBoardOne;
  const boardOneResponse = new Promise(resolve => { releaseBoardOne = resolve; });
  it.context.boardOneResponse = boardOneResponse;
  vm.runInContext(`
    api.get = async path => {
      if (path === "/api/v1/boards") return { boards: [{ id: "board_1" }, { id: "board_2" }] };
      if (path === "/api/v1/boards/board_1") return boardOneResponse;
      if (path === "/api/v1/boards/board_2") return { id: "board_2", name: "Board two", buckets: [] };
      if (path === "/api/v1/lists") return { lists: [] };
      if (path.startsWith("/api/v1/tasks?")) return { tasks: [] };
      throw new Error("unexpected request: " + path);
    };
  `, it.context);

  const staleNavigation = it.go("/app/boards/board_1");
  await new Promise(resolve => setImmediate(resolve));
  await it.go("/app/boards/board_2");
  releaseBoardOne({ id: "board_1", name: "Board one", buckets: [] });
  await staleNavigation;

  assert.equal(it.url(), "/app/boards/board_2");
  assert.equal(it.board(), "board_2");
  assert.equal(it.view(), "board");
});

test("a stale board-list response cannot overwrite newer route navigation", async () => {
  const it = router({ url: "/", signedIn: true });
  let releaseOldBoardList;
  it.context.oldBoardListResponse = new Promise(resolve => { releaseOldBoardList = resolve; });
  vm.runInContext(`
    let boardListRequests = 0;
    api.get = async path => {
      if (path === "/api/v1/boards" && ++boardListRequests === 1) return oldBoardListResponse;
      if (path === "/api/v1/boards") return { boards: [{ id: "board_2" }] };
      if (path === "/api/v1/lists") return { lists: [] };
      if (path === "/api/v1/boards/board_2") return { id: "board_2", name: "Board two", buckets: [] };
      throw new Error("unexpected request: " + path);
    };
  `, it.context);

  const staleNavigation = it.go("/app/boards/board_1");
  await new Promise(resolve => setImmediate(resolve));
  await it.go("/app/boards/board_2");
  releaseOldBoardList({ boards: [{ id: "board_1" }] });
  await staleNavigation;

  const boardIds = JSON.parse(vm.runInContext("JSON.stringify(state.boards.map(board => board.id))", it.context));
  assert.deepEqual(boardIds, ["board_2"]);
  assert.equal(it.board(), "board_2");
  assert.equal(it.url(), "/app/boards/board_2");
});

test("a stale workspace response cannot render Not Found over newer navigation", async () => {
  const it = router({ url: "/", signedIn: true });
  let releaseOldLists;
  it.context.oldListsResponse = new Promise(resolve => { releaseOldLists = resolve; });
  vm.runInContext(`
    let listRequests = 0;
    api.get = async path => {
      if (path === "/api/v1/boards") return { boards: [{ id: "board_1" }] };
      if (path === "/api/v1/boards/board_1") return { id: "board_1", name: "Board one", buckets: [] };
      if (path === "/api/v1/agents") return { agents: [] };
      if (path === "/api/v1/lists" && ++listRequests === 1) return oldListsResponse;
      if (path === "/api/v1/lists") return { lists: [{ id: "list-current", name: "Current" }] };
      if (path.startsWith("/api/v1/tasks?")) return { tasks: [] };
      throw new Error("unexpected request: " + path);
    };
  `, it.context);

  const staleNavigation = it.go("/app/lists/list-missing");
  await new Promise(resolve => setImmediate(resolve));
  await it.go("/app/tasks");
  releaseOldLists({ lists: [] });
  await staleNavigation;

  assert.equal(it.url(), "/app/tasks");
  assert.equal(it.view(), "app");
  assert.equal(vm.runInContext("state.workspaceScope", it.context), "all");
  assert.notEqual(it.rendered.at(-1), "not-found");
});

test("a current workspace request for a missing list renders Not Found", async () => {
  const it = router({ url: "/app/lists/list-missing", signedIn: true });
  vm.runInContext(`
    api.get = async path => {
      if (path === "/api/v1/boards") return { boards: [{ id: "board_1" }] };
      if (path === "/api/v1/boards/board_1") return { id: "board_1", name: "Board one", buckets: [] };
      if (path === "/api/v1/agents") return { agents: [] };
      if (path === "/api/v1/lists") return { lists: [{ id: "list-current", name: "Current" }] };
      if (path.startsWith("/api/v1/tasks?")) return { tasks: [] };
      throw new Error("unexpected request: " + path);
    };
  `, it.context);

  await it.apply();

  assert.equal(it.url(), "/app/lists/list-missing");
  assert.equal(it.view(), "not-found");
});

test("a stale settings token response cannot overwrite newer settings data", async () => {
  const it = router({ url: "/", signedIn: true });
  let releaseOldTokens;
  it.context.oldTokensResponse = new Promise(resolve => { releaseOldTokens = resolve; });
  it.context.loadTokens = it.context.realLoadTokens;
  vm.runInContext(`
    let tokenRequests = 0;
    api.get = async path => {
      if (path === "/api/v1/boards") return { boards: [{ id: "board_1" }] };
      if (path === "/api/v1/lists") return { lists: [] };
      if (path === "/api/v1/boards/board_1") return { id: "board_1", name: "Board one", buckets: [] };
      if (path === "/api/v1/api-tokens" && ++tokenRequests === 1) return oldTokensResponse;
      if (path === "/api/v1/api-tokens") return { tokens: [{ id: "new" }] };
      throw new Error("unexpected request: " + path);
    };
  `, it.context);

  const staleSettings = it.go("/app/settings/api");
  await new Promise(resolve => setImmediate(resolve));
  await it.go("/app/boards/board_1");
  await it.go("/app/settings/api");
  releaseOldTokens({ tokens: [{ id: "old" }] });
  await staleSettings;

  const tokenIds = JSON.parse(vm.runInContext("JSON.stringify(state.tokens.map(token => token.id))", it.context));
  assert.deepEqual(tokenIds, ["new"]);
  assert.equal(it.url(), "/app/settings/api");
  assert.equal(it.view(), "app:settings");
});

test("a stale agent response cannot overwrite newer route data", async () => {
  const it = router({ url: "/", signedIn: true });
  let releaseOldAgents;
  it.context.oldAgentsResponse = new Promise(resolve => { releaseOldAgents = resolve; });
  it.context.loadAgents = it.context.realLoadAgents;
  vm.runInContext(`
    let agentRequests = 0;
    api.get = async path => {
      if (path === "/api/v1/boards") return { boards: [{ id: "board_1" }, { id: "board_2" }] };
      if (path === "/api/v1/lists") return { lists: [] };
      if (path === "/api/v1/agents" && ++agentRequests === 1) return oldAgentsResponse;
      if (path === "/api/v1/agents") return { agents: [{ id: "new" }] };
      if (path.startsWith("/api/v1/boards/")) {
        const id = path.replace("/api/v1/boards/", "");
        return { id, name: id, buckets: [] };
      }
      throw new Error("unexpected request: " + path);
    };
  `, it.context);

  const staleRoute = it.go("/app/boards/board_1");
  await new Promise(resolve => setImmediate(resolve));
  await it.go("/app/boards/board_2");
  releaseOldAgents({ agents: [{ id: "old" }] });
  await staleRoute;

  const agentIDs = JSON.parse(vm.runInContext("JSON.stringify(state.agents.map(agent => agent.id))", it.context));
  assert.deepEqual(agentIDs, ["new"]);
  assert.equal(it.url(), "/app/boards/board_2");
  assert.equal(it.board(), "board_2");
});

test("back and forward move between landing, boards, and settings", async () => {
  const it = router({ url: "/", signedIn: true, boards: [{ id: "board_1" }, { id: "board_2" }] });
  await it.apply();
  assert.equal(it.view(), "home");

  await it.go("/app");
  assert.equal(it.url(), "/app/today");
  await it.go("/app/boards/board_2");
  assert.equal(it.board(), "board_2");
  await it.go("/app/settings/profile");
  assert.equal(it.view(), "app:settings");

  await it.back();
  assert.equal(it.url(), "/app/boards/board_2");
  assert.equal(it.view(), "board");
  await it.back();
  assert.equal(it.url(), "/app/today");
  await it.back();
  assert.equal(it.url(), "/");
  assert.equal(it.view(), "home");
});

test("selecting all tasks twice does not stack history entries", async () => {
  const it = router({ url: "/app/tasks", signedIn: true, boards: [{ id: "board_1" }] });
  await it.apply();
  const depth = it.depth();

  await it.go("/app/tasks");

  assert.equal(it.depth(), depth);
});

test("an authenticated visit to early access is sent to the app", async () => {
  const it = router({ url: "/early-access", signedIn: true, boards: [{ id: "board_1" }] });

  await it.apply();

  assert.equal(it.url(), "/app/today");
});

test("the landing page stays public while signed in", async () => {
  const it = router({ url: "/", signedIn: true, boards: [{ id: "board_1" }] });

  await it.apply();

  assert.equal(it.view(), "home");
  assert.equal(it.url(), "/");
});

test("signing out from an app route lands on login", async () => {
  const it = router({ url: "/app/settings/profile", signedIn: true, boards: [{ id: "board_1" }] });
  await it.apply();
  assert.equal(it.view(), "app:settings");
  vm.runInContext(`api.post = async () => ({});`, it.context);

  await it.context.logout();

  assert.equal(it.url(), "/login");
  assert.equal(it.view(), "login");
  assert.equal(vm.runInContext("state.me", it.context), null);
});

test("unknown paths render not found without redirecting", async () => {
  const it = router({ url: "/nonsense", signedIn: true, boards: [{ id: "board_1" }] });

  await it.apply();

  assert.equal(it.view(), "not-found");
  assert.equal(it.url(), "/nonsense");
});
