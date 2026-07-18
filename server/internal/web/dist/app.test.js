const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const filename = path.join(__dirname, "app.js");
const source = fs.readFileSync(filename, "utf8").replace(/\nboot\(\);\s*$/, "");
const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
const app = { console, Date, window: { addEventListener() {} } };
vm.createContext(app);
vm.runInContext(source, app, { filename });

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

test("Flow groups every list item into four fixed states with compact controls", () => {
  const html = app.flowHTML(board);

  assert.deepEqual([...html.matchAll(/data-flow-status="([^"]+)"/g)].map(match => match[1]), ["queued", "working", "needs_review", "done"]);
  assert.match(html, /Working action/);
  assert.match(html, /Home list/);
  assert.match(html, /Fri, Jul 17/);
  assert.match(html, /Reference item/);
  assert.match(html, /aria-label="Filter Flow by list"/);
  assert.match(html, />All lists</);
  assert.match(html, />YouTube</);
  assert.match(html, /aria-label="Move Working action to Ready"/);
  assert.match(html, /aria-label="Move Working action to Review"/);
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

test("footer reports live Working and Review counts", () => {
  const html = app.footerHTML(board, false);
  assert.match(html, /1 working/);
  assert.match(html, /1 review/);
});

test("failed status updates restore persisted state and expose an accessible error", async () => {
  let refreshed = false;
  await app.runMutation(
    async () => { throw new Error("list limit reached"); },
    async () => { refreshed = true; },
  );

  assert.equal(refreshed, true);
  assert.equal(vm.runInContext("state.error", app), "list limit reached");
  assert.match(app.statusErrorHTML("list limit reached"), /role="alert">list limit reached/);
});

test("plain-text API errors remain readable", () => {
  assert.throws(
    () => app.decodeResponseBody("method not allowed\n", false),
    error => error.message === "method not allowed",
  );
  assert.equal(app.decodeResponseBody('{"ok":true}', true).ok, true);
});

test("one theme holds when switching between boards", () => {
  vm.runInContext(`
    state.theme = "dark";
    state.board = { id: "light-board", name: "Light board", backgroundValue: "light", buckets: [] };
  `, app);

  assert.match(app.appHTML(), /class="shell theme-dark"/);
  vm.runInContext(`state.board = { id: "other-board", name: "Other board", backgroundValue: "charcoal", buckets: [] }`, app);
  assert.match(app.appHTML(), /class="shell theme-dark"/);
  assert.match(app.settingsHTML(), /Theme across Slate/);
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
