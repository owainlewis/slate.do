const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const filename = path.join(__dirname, "app.js");
const source = fs.readFileSync(filename, "utf8").replace(/\nboot\(\);\s*$/, "");
const app = { console, Date, window: { addEventListener() {} } };
vm.createContext(app);
vm.runInContext(source, app, { filename });

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

test("neutral items have bullets while actions have checkboxes", () => {
  const itemHTML = app.taskHTML({ id: "camera", title: "Sony FX3", kind: "item", status: "queued", scheduledDate: "", done: false });
  const actionHTML = app.taskHTML({ id: "record", title: "Record comparison", kind: "action", status: "queued", scheduledDate: "", done: false });

  assert.match(itemHTML, /class="item-dot"/);
  assert.doesNotMatch(itemHTML, /data-toggle-done/);
  assert.match(actionHTML, /data-toggle-done="record"/);
});

test("list actions show compact state treatment", () => {
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
  ],
};

test("Flow groups only actions into four fixed states with card context", () => {
  const html = app.flowHTML(board);

  assert.deepEqual([...html.matchAll(/data-flow-status="([^"]+)"/g)].map(match => match[1]), ["queued", "working", "needs_review", "done"]);
  assert.match(html, /Working action/);
  assert.match(html, /Home list/);
  assert.match(html, /Fri, Jul 17/);
  assert.doesNotMatch(html, /Reference item/);
  assert.match(html, /aria-label="State for Working action"/);
});

test("detail state controls appear for Actions only", () => {
  vm.runInContext(`state.board = ${JSON.stringify(board)}`, app);
  const actionHTML = app.detailHTML(board.buckets[0].tasks[1]);
  const itemHTML = app.detailHTML(board.buckets[0].tasks[4]);

  assert.match(actionHTML, /name="status"/);
  assert.match(actionHTML, /value="working" selected>Working/);
  assert.doesNotMatch(itemHTML, /name="status"/);
});

test("footer reports live Working and Review counts", () => {
  const html = app.footerHTML(board, false);
  assert.match(html, /1 working/);
  assert.match(html, /1 review/);
});

test("failed status updates restore persisted state and expose an accessible error", async () => {
  let refreshed = false;
  await app.runStatusUpdate(
    async () => { throw new Error("list limit reached"); },
    async () => { refreshed = true; },
  );

  assert.equal(refreshed, true);
  assert.equal(vm.runInContext("state.error", app), "list limit reached");
  assert.match(app.statusErrorHTML("list limit reached"), /role="alert">list limit reached/);
});
