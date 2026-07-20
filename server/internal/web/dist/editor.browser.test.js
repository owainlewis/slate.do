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
const youtubeTask = {
  id: "task-youtube",
  boardId: "board-one",
  bucketId: "list-youtube",
  title: "Record YouTube video",
  description: "",
  scheduledDate: "",
  kind: "action",
  done: false,
  status: "working",
};

function board(deleted) {
  return {
    id: "board-one",
    name: "Business",
    backgroundValue: "dark",
    maxTasksPerList: 20,
    buckets: [
      {
        id: "list-one",
        boardId: "board-one",
        name: "AI Engineer",
        goal: "",
        openCount: deleted ? 0 : 1,
        limitCount: 20,
        tasks: deleted ? [] : [task],
      },
      {
        id: "list-youtube",
        boardId: "board-one",
        name: "YouTube",
        goal: "",
        openCount: deleted ? 0 : 1,
        limitCount: 20,
        tasks: deleted ? [] : [youtubeTask],
      },
    ],
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
  const listFilter = page.getByRole("combobox", { name: "Filter Flow by list" });
  await listFilter.selectOption("list-youtube");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "flow-list-filter");
  assert.equal(await page.locator('[data-open-task="task-one"]').count(), 0);
  assert.equal(await page.locator('[data-open-task="task-youtube"]').count(), 1);
  await listFilter.selectOption("");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "flow-list-filter");
  await page.locator('[data-open-task="task-one"]').click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(patchCount, 3);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "board-title");
});

test("Pro resource limits block obvious actions and show server rejection messages", async t => {
	const lists = Array.from({ length: 9 }, (_, index) => ({
		id: `list-${index}`,
		boardId: "board-one",
		name: `List ${index + 1}`,
		goal: "",
		openCount: index === 0 ? 20 : 0,
		limitCount: 20,
		tasks: [],
	}));
	const limitedBoard = { id: "board-one", name: "Limited", maxTasksPerList: 20, buckets: lists };
	const boards = Array.from({ length: 4 }, (_, index) => ({ id: index === 0 ? "board-one" : `board-${index}`, name: `Board ${index + 1}` }));
	const server = http.createServer((request, response) => {
		const url = new URL(request.url, "http://localhost");
		if (url.pathname === "/api/v1/me") return json(response, {
			authenticated: true,
			user: { id: "owner", email: "owner@example.com", entitlement: { plan: "pro", source: "admin", limits: { boards: 5, listsPerBoard: 9, activeItemsPerList: 20 } } },
		});
		if (url.pathname === "/api/v1/boards" && request.method === "GET") return json(response, { boards, maxBoards: 5 });
		if (url.pathname === "/api/v1/boards" && request.method === "POST") {
			response.writeHead(409, { "Content-Type": "application/json" });
			return response.end(JSON.stringify({ code: "pro_board_limit_reached", error: "Pro allows up to 5 boards." }));
		}
		if (url.pathname === "/api/v1/boards/board-one") return json(response, limitedBoard);
		if (url.pathname === "/" || url.pathname === "/index.html") return html(response);
		if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
		if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
		response.writeHead(404).end();
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise(resolve => server.close(resolve)));

	const browser = await chromium.launch({ headless: true });
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	await page.goto(`http://127.0.0.1:${server.address().port}`);

	await page.getByText("9 list Pro limit reached", { exact: true }).waitFor();
	assert.equal(await page.getByRole("button", { name: "New list", exact: true }).isDisabled(), true);
	assert.equal(await page.getByPlaceholder("Limit of 20 active items reached").isDisabled(), true);
	assert.equal(await page.getByText("20 active item limit reached", { exact: true }).count(), 1);

	await page.getByRole("button", { name: "New board", exact: true }).click();
	await page.getByRole("alert").filter({ hasText: "Pro allows up to 5 boards." }).waitFor();
});

test("server limit rejections stay visible for board, list, and active-item creation", async t => {
	const availableBoard = {
		id: "board-one",
		name: "Available",
		maxTasksPerList: 20,
		buckets: Array.from({ length: 8 }, (_, index) => ({
			id: `list-${index}`,
			boardId: "board-one",
			name: `List ${index + 1}`,
			goal: "",
			openCount: index === 0 ? 19 : 0,
			limitCount: 20,
			tasks: [],
		})),
	};
	const boards = Array.from({ length: 4 }, (_, index) => ({ id: index === 0 ? "board-one" : `board-${index}`, name: `Board ${index + 1}` }));
	const server = http.createServer((request, response) => {
		const url = new URL(request.url, "http://localhost");
		if (url.pathname === "/api/v1/me") return json(response, {
			authenticated: true,
			user: { id: "owner", entitlement: { plan: "pro", source: "admin", limits: { boards: 5, listsPerBoard: 9, activeItemsPerList: 20 } } },
		});
		if (url.pathname === "/api/v1/boards" && request.method === "GET") return json(response, { boards, maxBoards: 5 });
		if (url.pathname === "/api/v1/boards/board-one") return json(response, availableBoard);
		if (url.pathname === "/api/v1/boards" && request.method === "POST") return conflict(response, "pro_board_limit_reached", "Pro allows up to 5 boards.");
		if (url.pathname === "/api/v1/boards/board-one/buckets" && request.method === "POST") return conflict(response, "pro_list_limit_reached", "Pro allows up to 9 lists per board.");
		if (url.pathname === "/api/v1/buckets/list-0/tasks" && request.method === "POST") return conflict(response, "pro_active_item_limit_reached", "Max active items per list is 20 on Pro.");
		if (url.pathname === "/" || url.pathname === "/index.html") return html(response);
		if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
		if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
		response.writeHead(404).end();
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise(resolve => server.close(resolve)));

	const browser = await chromium.launch({ headless: true });
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	await page.goto(`http://127.0.0.1:${server.address().port}`);

	for (const action of [
		{ click: () => page.getByRole("button", { name: "New board", exact: true }).click(), message: "Pro allows up to 5 boards." },
		{ click: () => page.getByRole("button", { name: "New list", exact: true }).click(), message: "Pro allows up to 9 lists per board." },
		{ click: async () => { const input = page.locator('[data-add-task="list-0"] input'); await input.fill("Twenty first"); await input.press("Enter"); }, message: "Max active items per list is 20 on Pro." },
	]) {
		await action.click();
		await page.getByRole("alert").filter({ hasText: action.message }).waitFor();
	}
});

test("early access submits credentials in the body and opens the app", async t => {
	let authenticated = false;
	let registration;
	const defaultBoard = { id: "board-one", name: "Today", maxTasksPerList: 20, buckets: [] };
	const server = http.createServer(async (request, response) => {
		const url = new URL(request.url, "http://localhost");
		if (url.pathname === "/api/v1/me") return json(response, authenticated ? {
			authenticated: true,
			user: { id: "member", email: "member@example.com", theme: "light", entitlement: { plan: "pro", source: "invite_code", limits: { boards: 5, listsPerBoard: 9, activeItemsPerList: 20 } } },
		} : { authenticated: false });
		if (url.pathname === "/api/v1/auth/register" && request.method === "POST") {
			let body = "";
			for await (const chunk of request) body += chunk;
			registration = { url: request.url, body: JSON.parse(body) };
			authenticated = true;
			return json(response, { authenticated: true });
		}
		if (url.pathname === "/api/v1/boards") return json(response, { boards: [defaultBoard], maxBoards: 5 });
		if (url.pathname === "/api/v1/boards/board-one") return json(response, defaultBoard);
		if (url.pathname === "/early-access" || url.pathname === "/index.html") return html(response);
		if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
		if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
		response.writeHead(404).end();
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise(resolve => server.close(resolve)));

	const browser = await chromium.launch({ headless: true });
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	await page.goto(`http://127.0.0.1:${server.address().port}/early-access`);
	await page.getByLabel("Email").fill("member@example.com");
	await page.getByLabel("Password").fill("a secure password");
	await page.getByLabel("Invite code").fill("private-invite-code");
	await page.getByRole("button", { name: "Create Pro account" }).click();
	await page.getByText("Today", { exact: true }).first().waitFor();

	assert.equal(page.url(), `http://127.0.0.1:${server.address().port}/`);
	assert.equal(registration.url, "/api/v1/auth/register");
	assert.deepEqual(registration.body, { email: "member@example.com", password: "a secure password", inviteCode: "private-invite-code" });
});

function json(response, body) {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function conflict(response, code, error) {
	response.writeHead(409, { "Content-Type": "application/json" });
	response.end(JSON.stringify({ code, error }));
}

function file(response, name, type) {
  response.writeHead(200, { "Content-Type": type });
  response.end(fs.readFileSync(path.join(dist, name)));
}

function html(response) {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><main id="app"></main><script type="module" src="/app.js"></script></body></html>');
}
