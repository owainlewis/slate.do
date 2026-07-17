const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const { chromium } = require("playwright");

const dist = __dirname;
const task = {
  id: "task-one",
  boardId: "board-one",
  bucketId: "list-one",
  title: "Improve the vault",
  description: "",
  scheduledDate: "",
  kind: "action",
  done: false,
  status: "queued",
};

function board(deleted) {
  return {
    id: "board-one",
    name: "Business",
    backgroundValue: "dark",
    maxTasksPerList: 20,
    buckets: [{
      id: "list-one",
      boardId: "board-one",
      name: "AI Engineer",
      goal: "",
      openCount: deleted ? 0 : 1,
      limitCount: 20,
      tasks: deleted ? [] : [task],
    }],
  };
}

test("editor prevents duplicate saves, preserves failures, and restores focus", async t => {
  let deleted = false;
  let hidden = false;
  let patchCount = 0;
  let releaseFirstFailure;
  const firstFailure = new Promise(resolve => { releaseFirstFailure = resolve; });
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api/v1/me") return json(response, { authenticated: true, user: { id: "owner", email: "owner@example.com" } });
    if (url.pathname === "/api/v1/boards") return json(response, { boards: [board(deleted || hidden)] });
    if (url.pathname === "/api/v1/boards/board-one") return json(response, board(deleted || hidden));
    if (url.pathname === "/api/v1/tasks/task-one/status" && request.method === "PATCH") {
      patchCount += 1;
      if (patchCount === 1) {
        await firstFailure;
        response.writeHead(500, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({ error: "Save failed" }));
      }
      if (patchCount === 3) hidden = true;
      return json(response, task);
    }
    if (url.pathname === "/api/v1/tasks/task-one" && request.method === "DELETE") {
      deleted = true;
      return json(response, { ok: true });
    }
    if (url.pathname === "/" || url.pathname === "/index.html") return html(response);
    if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
    if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto(`http://127.0.0.1:${server.address().port}`);

  const taskButton = page.getByRole("button", { name: "Improve the vault", exact: true });
  await taskButton.click();
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("Changed but unsaved");
  await page.keyboard.press("Control+Enter");
  await page.getByRole("button", { name: "Saving…", exact: true }).waitFor();
  await title.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 1);
  await page.keyboard.press("Control+Enter");
  assert.equal(patchCount, 1);
  releaseFirstFailure();
  await page.getByText("Save failed", { exact: true }).waitFor();
  assert.equal(patchCount, 1);
  assert.equal(await title.inputValue(), "Changed but unsaved");
  assert.equal(await page.getByRole("button", { name: "Save changes", exact: true }).isEnabled(), true);

  await title.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Improve the vault");

  await taskButton.click();
  const save = page.getByRole("button", { name: "Save changes", exact: true });
  await save.focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Close editor");
  await save.click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(patchCount, 2);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Improve the vault");

  await taskButton.click();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete item", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("placeholder")), "Add item");

  deleted = false;
  await page.reload();
  await page.getByRole("button", { name: "Flow", exact: true }).click();
  await page.locator('[data-open-task="task-one"]').click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(patchCount, 3);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "board-title");
});

function json(response, body) {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function file(response, name, type) {
  response.writeHead(200, { "Content-Type": type });
  response.end(fs.readFileSync(path.join(dist, name)));
}

function html(response) {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><main id="app"></main><script type="module" src="/app.js"></script></body></html>');
}
