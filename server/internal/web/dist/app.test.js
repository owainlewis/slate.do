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
const app = { console, Date, window: { addEventListener() {} } };
vm.createContext(app);
vm.runInContext(source, app, { filename });

test("the app provides its branded favicon", () => {
  assert.match(index, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/);
  assert.match(favicon, /<rect[^>]*fill="#4f5bc2"/);
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

test("the CLI guide covers installation, authentication, and agent workflows", () => {
  assert.match(cliGuide, /curl -fsSL https:\/\/raw\.githubusercontent\.com\/owainlewis\/slate\.do\/main\/install\.sh \| sh/);
  assert.match(cliGuide, /export SLATE_API_TOKEN=slate_\.\.\./);
  assert.match(cliGuide, /slate tasks claim &lt;task-id&gt;/);
  assert.match(cliGuide, /CLAUDE\.md/);
  assert.match(cliGuide, /AGENTS\.md/);
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

test("sidebar separates board creation and explains the board limit", () => {
  vm.runInContext(`
    state.maxBoards = 10;
    state.boards = Array.from({ length: 10 }, (_, index) => ({ id: String(index), name: "Board " + index }));
    state.board = { id: "0", name: "Board 0", buckets: [] };
  `, app);

  const html = app.appHTML();
  assert.match(html, /class="nav-sec nav-boards"/);
  assert.match(html, /class="board-create"/);
  assert.match(html, /id="new-board" disabled aria-describedby="board-limit"/);
  assert.match(html, />10 board limit reached</);

  vm.runInContext(`state.boards = state.boards.slice(0, 2);`, app);
  const availableHTML = app.appHTML();
  assert.match(availableHTML, /id="new-board"\s*>/);
  assert.doesNotMatch(availableHTML, /id="new-board"[^>]*disabled/);
  assert.doesNotMatch(availableHTML, /board limit reached/);
  vm.runInContext(`state.maxBoards = 10; state.boards = []; state.board = null;`, app);
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
  `, app);

  const html = app.appHTML();
  assert.doesNotMatch(html, /id="board-title"/);
  assert.doesNotMatch(html, /aria-label="Board name"/);
  assert.match(html, /class="week">Week \d+ \([^)]+\)<\/span>/);
  for (const [mode, label] of [["lists", "Lists"], ["flow", "Flow"], ["calendar", "Week"], ["today", "Today"]]) {
    assert.match(html, new RegExp(`data-board-mode="${mode}"[^>]*>[\\s\\S]*?<span>${label}</span>`));
  }
  assert.match(html, /data-set-theme="light"[\s\S]*?<span>Light<\/span>/);
  assert.match(html, /data-set-theme="dark"[\s\S]*?<span>Dark<\/span>/);
  assert.match(html, /class="theme-switch light"[\s\S]*?id="settings"/);
  assert.match(html, /id="settings"[\s\S]*?<span>Settings<\/span>/);
  assert.match(html, /id="logout"[\s\S]*?<span>Sign out<\/span>/);
  assert.match(html, /data-board-settings="board"[^>]*aria-label="Board settings for Board"/);

  const boardSettings = app.boardSettingsHTML();
  assert.match(boardSettings, /id="settings-list-limit"[^>]*value="12"/);
	assert.match(boardSettings, /Maximum active items/);
	assert.match(boardSettings, /aria-label="Max active items per list"[^>]*max="20"/);
  assert.doesNotMatch(boardSettings, /data-set-theme=/);
  vm.runInContext(`state.boards = []; state.board = null;`, app);
});

test("list limits remain scoped to the selected board", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(app.listLimitUpdate("current-board", "12"))),
    { next: 12, path: "/api/v1/boards/current-board", input: { maxTasksPerList: 12 } },
  );
  assert.equal(app.validateListLimit("0", 20), "Enter a value from 1 to 20.");
  assert.equal(app.validateListLimit("21", 20), "Enter a value from 1 to 20.");
  assert.equal(app.validateListLimit("2.5", 20), "Enter a whole number.");
  assert.equal(app.validateListLimit("20", 20), "");
});

test("Pro limits prevent obvious list and active-item creation", () => {
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
	assert.match(html, /id="add-list" disabled aria-describedby="list-limit"/);
	assert.match(html, />9 list Pro limit reached</);
	assert.match(html, /data-add-task="list-0"[\s\S]*?placeholder="Limit of 20 active items reached" disabled/);
	assert.match(html, />20 active item limit reached</);
	assert.equal(app.proLimits().boards, 5);
	vm.runInContext(`state.me = null; state.boards = []; state.board = null;`, app);
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

test("list items show compact state treatment", () => {
  const ready = app.taskHTML({ id: "ready", title: "Ready action", kind: "action", status: "queued", scheduledDate: "", done: false });
  const working = app.taskHTML({ id: "working", title: "Working action", kind: "action", status: "working", scheduledDate: "", done: false });
  const review = app.taskHTML({ id: "review", title: "Review action", kind: "action", status: "needs_review", scheduledDate: "", done: false });
  const done = app.taskHTML({ id: "done", title: "Done action", kind: "action", status: "done", scheduledDate: "", done: true });

  assert.doesNotMatch(ready, /state-badge/);
  assert.match(working, /state-working[^>]*>Working/);
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
  `, app);
  const assigned = { id: "assigned", bucketId: "list", title: "Research", kind: "action", status: "queued", done: false, scheduledDate: "", assigneeAgentId: "agent-one" };
  const taskHTML = app.taskHTML(assigned);
  assert.match(taskHTML, /class="avatar agent-avatar tone-\d avatar-small/);
  assert.match(taskHTML, /<rect x="5" y="7" width="14" height="11" rx="3"/);
  assert.doesNotMatch(taskHTML, />&lt;B<\/span>/);
  assert.doesNotMatch(taskHTML, /<Research Bot>/);

  const detail = app.detailHTML({ ...assigned, assigneeAgentId: "agent-old" });
  assert.match(detail, /id="detail-assignee" name="assigneeAgentId"/);
  assert.match(detail, /value="agent-one"/);
  assert.match(detail, /value="agent-old" selected disabled>Old Bot \(inactive\)/);

  vm.runInContext(`state.agents = [];`, app);
  const unavailable = app.detailHTML({ ...assigned, assigneeAgentId: "agent-one" });
  assert.match(unavailable, /value="agent-one" selected>Assigned agent unavailable/);
  assert.doesNotMatch(unavailable, /value="" selected>Unassigned/);

  const first = app.avatarHTML({ id: "stable", displayName: "Research Bot" });
  const second = app.avatarHTML({ id: "stable", displayName: "Research Bot" });
  assert.equal(first, second);
  assert.match(app.avatarHTML({ id: "stable", displayName: "Research Bot" }, { large: true }), /avatar-large/);
  vm.runInContext(`state.agents = []; state.boards = []; state.board = null;`, app);
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
  assert.match(html, /2 ready items · 1 working item · 1 review item/);
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
  assert.match(form, /id="agent-name"[^>]*maxlength="80"/);
  assert.match(form, /id="agent-purpose"[^>]*maxlength="500"/);
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

test("the board header shows a neutral user icon without their name or generated initials", () => {
  vm.runInContext(`
    state.me = { id: "owner", email: "owner@example.com", displayName: "Owain Lewis" };
    state.board = { id: "board", name: "Business", maxTasksPerList: 20, buckets: [] };
    state.boards = [{ id: "board", name: "Business" }];
  `, app);
  const html = app.appHTML();
  const currentUser = html.match(/<span class="current-user">([\s\S]*?)<\/span>\s*<div class="view-switch"/)?.[1] || "";
  assert.match(currentUser, /class="avatar user-avatar tone-\d avatar-small/);
  assert.match(currentUser, /<svg class="icon /);
  assert.doesNotMatch(currentUser, />Owain Lewis</);
  assert.doesNotMatch(currentUser, />OL<\/span>/);
  vm.runInContext(`state.me = null; state.board = null; state.boards = [];`, app);
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
        { id: "script", title: "Write video script", kind: "action", status: "queued", scheduledDate: "", done: false },
      ],
    },
  ],
};

test("Flow groups every list item into four fixed states without redundant move controls", () => {
  const html = app.flowHTML(board);

  assert.deepEqual([...html.matchAll(/data-flow-status="([^"]+)"/g)].map(match => match[1]), ["queued", "working", "needs_review", "done"]);
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
  vm.runInContext(`state.board = ${JSON.stringify(board)}`, app);
  const actionHTML = app.detailHTML(board.buckets[0].tasks[1]);

  assert.match(actionHTML, /name="status"/);
  assert.match(actionHTML, /value="working" selected>Working/);
  assert.doesNotMatch(actionHTML, /name="kind"/);
});

test("detail presents a focused, accessible editor with clear actions", () => {
  vm.runInContext(`state.board = ${JSON.stringify(board)}`, app);
  const html = app.detailHTML(board.buckets[0].tasks[1]);

  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /class="detail-title"/);
  assert.match(html, /class="detail-description"/);
  assert.match(html, /class="detail-properties"/);
  assert.match(html, />Save changes</);
  assert.match(html, /data-close-detail>Cancel</);
  assert.match(html, />Delete item</);
  assert.match(html, /Home list/);
});

test("detail offers a board, list, and position move flow", () => {
  vm.runInContext(`
    state.boards = [{ id: "board", name: "Current" }, { id: "other", name: "Other" }];
    state.board = { id: "board", name: "Current", buckets: [{ id: "list", name: "Inbox", openCount: 1, limitCount: 20, tasks: [{ id: "task", bucketId: "list", title: "Move me", kind: "action", status: "queued", done: false }] }] };
  `, app);
  const task = vm.runInContext("state.board.buckets[0].tasks[0]", app);
  const html = app.detailHTML(task);

  assert.match(html, /id="open-move"[^>]*>[^<]*<span>Current \/ Inbox<\/span><b>Move…<\/b>/);
  assert.match(html, /id="move-board"/);
  assert.match(html, /id="move-list"/);
  assert.match(html, /id="move-position"/);
  assert.match(html, /id="move-item"[^>]*>Move item<\/button>/);

  const fullBoard = vm.runInContext(`({ id: "full", buckets: [{ id: "full-list", name: "Full", openCount: 20, limitCount: 20, tasks: [] }] })`, app);
  assert.match(app.moveListOptionsHTML(fullBoard, task), /value="full-list"[^>]*disabled[^>]*>Full \(20\/20 full\)<\/option>/);
  const reference = vm.runInContext(`({ ...state.board.buckets[0].tasks[0], kind: "reference" })`, app);
  assert.doesNotMatch(app.moveListOptionsHTML(fullBoard, reference), /disabled/);
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
    state.boards = [{ id: "board-a", name: "Account A board" }];
    state.board = { id: "board-a", name: "Account A board", buckets: [] };
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

  assert.match(app.appHTML(), /class="shell theme-dark"/);
  vm.runInContext(`state.board = { id: "other-board", name: "Other board", backgroundValue: "charcoal", buckets: [] }`, app);
  assert.match(app.appHTML(), /class="shell theme-dark"/);
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

test("single-column list drops use vertical position", () => {
  const rects = [
    { top: 0, bottom: 100, left: 0, width: 300, height: 100 },
    { top: 120, bottom: 220, left: 0, width: 300, height: 100 },
  ];

  assert.equal(app.bucketDropIndexForRects(rects, 280, 20, true), 0);
  assert.equal(app.bucketDropIndexForRects(rects, 20, 90, true), 1);
  assert.equal(app.bucketDropIndexForRects(rects, 280, 210, true), 2);
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
    apply: () => context.applyRoute(),
    back: () => { entries.pop(); return context.applyRoute(); },
  };
}

test("routes parse into the surface they name", () => {
  // parseRoute returns objects from the vm realm, so compare plain copies.
  const route = path => ({ ...app.parseRoute(path) });

  assert.deepEqual(route("/"), { name: "home" });
  assert.deepEqual(route("/login"), { name: "login" });
  assert.deepEqual(route("/app"), { name: "app" });
  assert.deepEqual(route("/app/settings"), { name: "settings", settingsPage: "profile", redirect: true });
  for (const page of ["profile", "preferences", "api"]) {
    assert.deepEqual(route(`/app/settings/${page}`), { name: "settings", settingsPage: page });
  }
  assert.deepEqual(route("/app/settings/agents"), { name: "agents", redirect: true });
  assert.deepEqual(route("/app/agents"), { name: "agents" });
  assert.deepEqual(route("/app/agents/new"), { name: "agent-new" });
  assert.deepEqual(route("/early-access"), { name: "early-access" });
  assert.deepEqual(route("/reset-password"), { name: "reset-password" });
  assert.deepEqual(route("/app/boards/board_1"), { name: "board", boardId: "board_1" });
  assert.deepEqual(route("/app/boards/board_1/settings"), { name: "board-settings", boardId: "board_1" });
  assert.deepEqual(route("/app/boards/a%20b"), { name: "board", boardId: "a b" });
  assert.deepEqual(route("/app/boards/a%20b/settings"), { name: "board-settings", boardId: "a b" });
  assert.deepEqual(route("/app/boards/%ED%A0%80"), { name: "not-found" });

  // Trailing slashes, queries, and fragments never change which route is named.
  assert.deepEqual(route("/app/"), { name: "app" });
  assert.deepEqual(route("/login?next=/app"), { name: "login" });
  assert.deepEqual(route("/app/settings#token"), { name: "settings", settingsPage: "profile", redirect: true });

  for (const path of ["/nonsense", "/app/boards", "/app/boards/a/b", "/app/agents/agent-one", "/app/agents/new/extra", "/app/settings/board", "/app/settings/unknown", "/app/settings/profile/extra", "/appleseed", "/cli"]) {
    assert.equal(app.parseRoute(path).name, "not-found", path);
  }
});

test("only same-origin app paths survive as a login next target", () => {
  assert.equal(app.safeNextPath("/app/settings"), "/app/settings");
  assert.equal(app.safeNextPath("/app/settings/agents"), "/app/settings/agents");
  assert.equal(app.safeNextPath("/app/agents"), "/app/agents");
  assert.equal(app.safeNextPath("/app/agents/new"), "/app/agents/new");
  assert.equal(app.safeNextPath("/app/boards/board_1"), "/app/boards/board_1");
  assert.equal(app.safeNextPath("/app/boards/board_1/settings"), "/app/boards/board_1/settings");
  assert.equal(app.safeNextPath("/app/"), "/app");

  for (const value of ["//evil.example", "https://evil.example/app", "/\\evil.example", "/app\\..", "/", "/login", "/nonsense", "", null, undefined]) {
    assert.equal(app.safeNextPath(value), "", String(value));
  }

  assert.equal(app.loginPathFor("/app/settings"), "/login?next=%2Fapp%2Fsettings");
  assert.equal(app.loginPathFor("/app/settings/api"), "/login?next=%2Fapp%2Fsettings%2Fapi");
  assert.equal(app.loginPathFor("/app"), "/login");
  assert.equal(app.loginPathFor("https://evil.example"), "/login");
});

test("signed-out visits to protected routes redirect to login and keep the exact destination", async () => {
  for (const target of ["/app/boards/board_1", "/app/boards/board_1/settings", "/app/agents", "/app/agents/new", "/app/settings/profile", "/app/settings/preferences", "/app/settings/agents", "/app/settings/api"]) {
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
  assert.equal(plain.url(), "/app/boards/board_1");
});

test("a rejected next target falls back to the app rather than leaving the origin", async () => {
  const it = router({ url: "/login?next=https%3A%2F%2Fevil.example", signedIn: true, boards: [{ id: "board_1" }] });

  await it.apply();

  assert.equal(it.url(), "/app/boards/board_1");
});

test("/app resolves to the first board, or stays put when there are none", async () => {
  const withBoards = router({ url: "/app", signedIn: true, boards: [{ id: "board_1" }, { id: "board_2" }] });
  await withBoards.apply();
  assert.equal(withBoards.url(), "/app/boards/board_1");
  assert.equal(withBoards.board(), "board_1");
  assert.equal(withBoards.depth(), 1, "resolving /app must not add a history entry");

  const empty = router({ url: "/app", signedIn: true, boards: [] });
  await empty.apply();
  assert.equal(empty.url(), "/app");
  assert.equal(empty.view(), "app");
  assert.equal(empty.board(), null);
});

test("a board deep link loads that board, and an unknown id is not found", async () => {
  const it = router({ url: "/app/boards/board_2", signedIn: true, boards: [{ id: "board_1" }, { id: "board_2" }] });
  await it.apply();
  assert.equal(it.board(), "board_2");
  assert.equal(it.view(), "app");

  const missing = router({ url: "/app/boards/board_9", signedIn: true, boards: [{ id: "board_1" }] });
  await missing.apply();
  assert.equal(missing.view(), "not-found");
  assert.equal(missing.url(), "/app/boards/board_9", "a not-found board keeps its URL rather than silently swapping boards");
  assert.equal(missing.board(), null);
});

test("a missing exact-board settings route owns its error and keeps its URL", async () => {
  const missing = router({ url: "/app/boards/missing/settings", signedIn: true, boards: [{ id: "board_1" }] });

  await missing.apply();

  assert.equal(missing.view(), "route-error");
  assert.equal(missing.routeError(), "board-settings");
  assert.equal(missing.error(), "This board does not exist or is no longer available to you.");
  assert.equal(missing.url(), "/app/boards/missing/settings");
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
  assert.equal(it.view(), "app");
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

test("failed board-settings and token loads render route-owned errors at the requested page", async () => {
  const boardFailure = router({ url: "/", signedIn: true });
  vm.runInContext(`
    api.get = async path => {
      if (path === "/api/v1/boards") return { boards: [{ id: "board_1" }] };
      throw new Error("Settings board could not be loaded");
    };
  `, boardFailure.context);

  await assert.doesNotReject(boardFailure.go("/app/boards/board_1/settings"));

  assert.equal(boardFailure.url(), "/app/boards/board_1/settings");
  assert.equal(boardFailure.view(), "route-error");
  assert.equal(boardFailure.routeError(), "board-settings");
  assert.equal(boardFailure.error(), "Settings board could not be loaded");

  const tokenFailure = router({ url: "/app/boards/board_1", signedIn: true, boards: [{ id: "board_1" }] });
  await tokenFailure.apply();
  tokenFailure.context.loadTokens = tokenFailure.context.realLoadTokens;
  vm.runInContext(`
    api.get = async path => {
      if (path === "/api/v1/boards") return { boards: [{ id: "board_1" }] };
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
  assert.equal(it.view(), "app");
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

test("a stale board-settings load cannot overwrite newer board navigation", async () => {
  const it = router({ url: "/", signedIn: true });
  let releaseSettingsBoard;
  it.context.settingsBoardResponse = new Promise(resolve => { releaseSettingsBoard = resolve; });
  vm.runInContext(`
    api.get = async path => {
      if (path === "/api/v1/boards") return { boards: [{ id: "board_1" }, { id: "board_2" }] };
      if (path === "/api/v1/boards/board_1") return settingsBoardResponse;
      if (path === "/api/v1/boards/board_2") return { id: "board_2", name: "Board two", buckets: [] };
      throw new Error("unexpected request: " + path);
    };
  `, it.context);

  const staleSettings = it.go("/app/boards/board_1/settings");
  await new Promise(resolve => setImmediate(resolve));
  await it.go("/app/boards/board_2");
  releaseSettingsBoard({ id: "board_1", name: "Board one", buckets: [] });
  await staleSettings;

  assert.equal(it.board(), "board_2");
  assert.equal(it.url(), "/app/boards/board_2");
  assert.equal(it.view(), "app");
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
  assert.equal(it.url(), "/app/boards/board_1");
  await it.go("/app/boards/board_2");
  assert.equal(it.board(), "board_2");
  await it.go("/app/settings/profile");
  assert.equal(it.view(), "app:settings");

  await it.back();
  assert.equal(it.url(), "/app/boards/board_2");
  assert.equal(it.view(), "app");
  await it.back();
  assert.equal(it.url(), "/app/boards/board_1");
  await it.back();
  assert.equal(it.url(), "/");
  assert.equal(it.view(), "home");
});

test("selecting the same board twice does not stack history entries", async () => {
  const it = router({ url: "/app/boards/board_1", signedIn: true, boards: [{ id: "board_1" }] });
  await it.apply();
  const depth = it.depth();

  await it.go("/app/boards/board_1");

  assert.equal(it.depth(), depth);
});

test("an authenticated visit to early access is sent to the app", async () => {
  const it = router({ url: "/early-access", signedIn: true, boards: [{ id: "board_1" }] });

  await it.apply();

  assert.equal(it.url(), "/app/boards/board_1");
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
