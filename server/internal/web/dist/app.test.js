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
  const itemHTML = app.taskHTML({ id: "camera", title: "Sony FX3", kind: "item", scheduledDate: "", done: false });
  const actionHTML = app.taskHTML({ id: "record", title: "Record comparison", kind: "action", scheduledDate: "", done: false });

  assert.match(itemHTML, /class="item-dot"/);
  assert.doesNotMatch(itemHTML, /data-toggle-done/);
  assert.match(actionHTML, /data-toggle-done="record"/);
});
