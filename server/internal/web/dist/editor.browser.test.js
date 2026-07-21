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
  const patchBodies = [];
  let releaseFirstFailure;
  const firstFailure = new Promise(resolve => { releaseFirstFailure = resolve; });
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api/v1/me") return json(response, { authenticated: true, user: { id: "owner", email: "owner@example.com" } });
    if (url.pathname === "/api/v1/boards") return json(response, { boards: [board(deleted || hidden)] });
    if (url.pathname === "/api/v1/boards/board-one") return json(response, board(deleted || hidden));
    if (url.pathname === "/api/v1/tasks/task-one/status" && request.method === "PATCH") {
      patchCount += 1;
      patchBodies.push(await requestJSON(request));
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

  assert.equal(await page.getByRole("textbox", { name: "Board name" }).count(), 0);
  await page.locator(".week").filter({ hasText: /^Week \d+ \(.+\)$/ }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileWeek = await page.locator(".week").boundingBox();
  const mobileActions = await page.locator(".top-actions").boundingBox();
  assert.ok(mobileWeek && mobileWeek.x >= 0 && mobileWeek.x + mobileWeek.width <= 390);
  assert.ok(mobileActions && mobileWeek && mobileActions.y >= mobileWeek.y + mobileWeek.height);
  await page.setViewportSize({ width: 1024, height: 768 });

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
  assert.equal(patchBodies[1].status, "queued");
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-open-task="task-one"]').click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(patchCount, 3);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.boardMode), "flow");
});

test("an item can move to a chosen position on another board", async t => {
  let moved = false;
  let moveBody;
  let saveBody;
  let currentTask = { ...task };
  const destinationTask = { ...task, id: "destination-task", boardId: "board-two", bucketId: "list-target", title: "Already there" };
  const sourceBoard = () => ({
    id: "board-one", name: "Business", maxTasksPerList: 20,
    buckets: [{ id: "list-one", boardId: "board-one", name: "Ideas", openCount: moved ? 0 : 1, limitCount: 20, tasks: moved ? [] : [currentTask] }],
  });
  const targetBoard = () => ({
    id: "board-two", name: "Website", maxTasksPerList: 20,
    buckets: [{
      id: "list-target", boardId: "board-two", name: "Ready", openCount: moved ? 2 : 1, limitCount: 20,
      tasks: moved ? [destinationTask, { ...currentTask, boardId: "board-two", bucketId: "list-target", sortOrder: 1 }] : [destinationTask],
    }],
  });
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api/v1/me") return json(response, { authenticated: true, user: { id: "owner", email: "owner@example.com" } });
    if (url.pathname === "/api/v1/boards") return json(response, { boards: [{ id: "board-one", name: "Business" }, { id: "board-two", name: "Website" }] });
    if (url.pathname === "/api/v1/boards/board-one") return json(response, sourceBoard());
    if (url.pathname === "/api/v1/boards/board-two") return json(response, targetBoard());
    if (url.pathname === "/api/v1/tasks/task-one/status" && request.method === "PATCH") {
      saveBody = await requestJSON(request);
      currentTask = { ...currentTask, ...saveBody };
      return json(response, currentTask);
    }
    if (url.pathname === "/api/v1/tasks/task-one/move" && request.method === "POST") {
      moveBody = await requestJSON(request);
      moved = true;
      return json(response, { ...currentTask, boardId: "board-two", bucketId: "list-target", sortOrder: 1 });
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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("button", { name: "Improve the vault", exact: true }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Edited before moving");
  await page.locator("#detail-date").fill("2026-07-30");
  await page.getByRole("button", { name: /Move…/ }).click();
  await page.getByLabel("Board", { exact: true }).selectOption("board-two");
  await page.getByLabel("List", { exact: true }).selectOption("list-target");
  await page.getByLabel("Position", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Move item", exact: true }).click();

  await page.getByText("Moved to Website / Ready", { exact: true }).waitFor();
  assert.equal(saveBody.title, "Edited before moving");
  assert.equal(saveBody.scheduledDate, "2026-07-30");
  assert.deepEqual(moveBody, { bucketId: "list-target", position: 1 });
  assert.equal(await page.getByRole("button", { name: "Improve the vault", exact: true }).count(), 0);
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Title", exact: true }).inputValue(), "Edited before moving");
});

test("a committed move stays successful when the source board refresh fails", { timeout: 10000 }, async t => {
  let moved = false;
  const sourceBoard = {
    id: "board-one", name: "Business", maxTasksPerList: 20,
    buckets: [{ id: "list-one", boardId: "board-one", name: "Ideas", openCount: 1, limitCount: 20, tasks: [task] }],
  };
  const targetBoard = {
    id: "board-two", name: "Website", maxTasksPerList: 20,
    buckets: [{ id: "list-target", boardId: "board-two", name: "Ready", openCount: 0, limitCount: 20, tasks: [] }],
  };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api/v1/me") return json(response, { authenticated: true, user: { id: "owner", email: "owner@example.com" } });
    if (url.pathname === "/api/v1/boards") {
      if (moved) {
        response.writeHead(500, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({ error: "Refresh failed" }));
      }
      return json(response, { boards: [{ id: "board-one", name: "Business" }, { id: "board-two", name: "Website" }] });
    }
    if (url.pathname === "/api/v1/boards/board-one") return json(response, sourceBoard);
    if (url.pathname === "/api/v1/boards/board-two") return json(response, targetBoard);
    if (url.pathname === "/api/v1/tasks/task-one/move" && request.method === "POST") {
      await requestJSON(request);
      moved = true;
      return json(response, { ...task, boardId: "board-two", bucketId: "list-target", sortOrder: 0 });
    }
    if (url.pathname === "/" || url.pathname === "/index.html") return html(response);
    if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
    if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => {
    server.closeAllConnections();
    server.close(resolve);
  }));

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("button", { name: "Improve the vault", exact: true }).click();
  await page.getByRole("button", { name: /Move…/ }).click();
  await page.getByLabel("Board", { exact: true }).selectOption("board-two");
  await page.getByLabel("List", { exact: true }).selectOption("list-target");
  await page.getByRole("button", { name: "Move item", exact: true }).click();

  await page.getByText("Moved to Website / Ready", { exact: true }).waitFor();
  await page.getByRole("alert").filter({ hasText: "The item was moved, but this board could not be refreshed." }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Improve the vault", exact: true }).count(), 0);
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
	await page.getByLabel("Password").fill("abc1234");
	await page.getByLabel("Invite code").fill("private-invite-code");
	await page.getByRole("button", { name: "Create Pro account" }).click();
	assert.equal(registration, undefined);
	await page.getByLabel("Password").fill("abcd1234");
	await page.getByRole("button", { name: "Create Pro account" }).click();
	await page.getByText("Today", { exact: true }).first().waitFor();

	assert.equal(page.url(), `http://127.0.0.1:${server.address().port}/`);
	assert.equal(registration.url, "/api/v1/auth/register");
	assert.deepEqual(registration.body, { email: "member@example.com", password: "abcd1234", inviteCode: "private-invite-code" });
});

test("logging out and into another account cannot show the previous account's data", async t => {
	let authenticatedAccount = "account-a";
	const boardRequestsAfterLogout = [];
	let loggedOut = false;
	let loginRequests = 0;
	let releaseLogout;
	let releaseSlowBoard;
	const logoutResponse = new Promise(resolve => { releaseLogout = resolve; });
	const slowBoardResponse = new Promise(resolve => { releaseSlowBoard = resolve; });
	const accounts = {
		"account-a": {
			user: { id: "account-a", email: "first@example.com", theme: "dark" },
			boards: [
				{ id: "board-a", name: "Account A private board", maxTasksPerList: 20, buckets: [] },
				{ id: "board-a-slow", name: "Account A delayed board", maxTasksPerList: 20, buckets: [] },
			],
		},
		"account-b": {
			user: { id: "account-b", email: "second@example.com", theme: "light" },
			boards: [{ id: "board-b", name: "Account B board", maxTasksPerList: 20, buckets: [] }],
		},
	};
	const server = http.createServer(async (request, response) => {
		const url = new URL(request.url, "http://localhost");
		const account = accounts[authenticatedAccount];
		if (url.pathname === "/api/v1/me") return json(response, account ? { authenticated: true, user: account.user } : { authenticated: false });
		if (url.pathname === "/api/v1/auth/logout" && request.method === "POST") {
			authenticatedAccount = "";
			loggedOut = true;
			await logoutResponse;
			return json(response, { ok: true });
		}
		if (url.pathname === "/api/v1/auth/login" && request.method === "POST") {
			loginRequests += 1;
			authenticatedAccount = "account-b";
			return json(response, { authenticated: true });
		}
		if (url.pathname === "/api/v1/boards") return json(response, { boards: account.boards, maxBoards: 5 });
		if (url.pathname.startsWith("/api/v1/boards/")) {
			if (loggedOut) boardRequestsAfterLogout.push(url.pathname);
			if (url.pathname === "/api/v1/boards/board-a-slow") {
				await slowBoardResponse;
				return json(response, accounts["account-a"].boards[1]);
			}
			const board = account.boards.find(item => url.pathname === `/api/v1/boards/${item.id}`);
			if (board) return json(response, board);
			response.writeHead(404, { "Content-Type": "application/json" });
			return response.end(JSON.stringify({ error: "board not found" }));
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
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	await page.goto(`http://127.0.0.1:${server.address().port}`);
	await page.getByText("Account A private board", { exact: true }).first().waitFor();

	await page.getByRole("button", { name: "Account A delayed board", exact: true }).click();
	await page.getByRole("button", { name: "Sign out", exact: true }).click();
	await page.getByText("Signing out…", { exact: true }).waitFor();
	assert.equal(await page.getByRole("button", { name: "Log in", exact: true }).count(), 0);
	releaseLogout();
	await page.getByRole("button", { name: "Log in", exact: true }).first().click();
	await page.getByLabel("Email", { exact: true }).fill("second@example.com");
	await page.getByLabel("Password", { exact: true }).fill("account-b-password");
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	await page.getByText("Account B board", { exact: true }).first().waitFor();
	assert.equal(loginRequests, 1);
	const delayedResponse = page.waitForResponse(response => response.url().endsWith("/api/v1/boards/board-a-slow"));
	releaseSlowBoard();
	await delayedResponse;
	await page.waitForTimeout(50);

	assert.deepEqual(boardRequestsAfterLogout, ["/api/v1/boards/board-b"]);
	assert.equal(await page.getByText("Account A private board", { exact: true }).count(), 0);
	assert.equal(await page.getByText("Account A delayed board", { exact: true }).count(), 0);
	assert.equal(await page.getByText("Account B board", { exact: true }).count(), 1);
});

test("concurrent login submissions create only one authenticated session", async t => {
	let authenticated = false;
	let loginRequests = 0;
	let releaseLogin;
	const loginResponse = new Promise(resolve => { releaseLogin = resolve; });
	const defaultBoard = { id: "board-one", name: "Single session board", maxTasksPerList: 20, buckets: [] };
	const server = http.createServer(async (request, response) => {
		const url = new URL(request.url, "http://localhost");
		if (url.pathname === "/api/v1/me") return json(response, authenticated ? {
			authenticated: true,
			user: { id: "account-one", email: "person@example.com", theme: "light" },
		} : { authenticated: false });
		if (url.pathname === "/api/v1/auth/login" && request.method === "POST") {
			loginRequests += 1;
			await loginResponse;
			authenticated = true;
			return json(response, { authenticated: true });
		}
		if (url.pathname === "/api/v1/api-tokens") return json(response, { tokens: [] });
		if (url.pathname === "/api/v1/boards") return json(response, { boards: [defaultBoard], maxBoards: 5 });
		if (url.pathname === "/api/v1/boards/board-one") return json(response, defaultBoard);
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
	await page.getByRole("button", { name: "Log in", exact: true }).first().click();
	await page.getByLabel("Email", { exact: true }).fill("person@example.com");
	await page.getByLabel("Password", { exact: true }).fill("correct-password");
	const submit = page.getByRole("button", { name: "Sign in", exact: true });
	await submit.click();
	await submit.click();
	await page.waitForTimeout(50);
	assert.equal(loginRequests, 1);
	releaseLogin();
	await page.getByText("Single session board", { exact: true }).first().waitFor();
	assert.equal(loginRequests, 1);
});

test("failed logout keeps account data hidden and requires a retry", async t => {
	let logoutAttempts = 0;
	const defaultBoard = { id: "board-one", name: "Private account board", maxTasksPerList: 20, buckets: [] };
	const server = http.createServer((request, response) => {
		const url = new URL(request.url, "http://localhost");
		if (url.pathname === "/api/v1/me") return json(response, {
			authenticated: true,
			user: { id: "account-one", email: "person@example.com", theme: "light" },
		});
		if (url.pathname === "/api/v1/auth/logout" && request.method === "POST") {
			logoutAttempts += 1;
			if (logoutAttempts === 1) {
				response.writeHead(503, { "Content-Type": "application/json" });
				return response.end(JSON.stringify({ error: "temporarily unavailable" }));
			}
			return json(response, { ok: true });
		}
		if (url.pathname === "/api/v1/api-tokens") return json(response, { tokens: [] });
		if (url.pathname === "/api/v1/boards") return json(response, { boards: [defaultBoard], maxBoards: 5 });
		if (url.pathname === "/api/v1/boards/board-one") return json(response, defaultBoard);
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
	await page.getByText("Private account board", { exact: true }).first().waitFor();
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
	await page.getByRole("button", { name: "Sign out", exact: true }).click();
	await page.getByText("Sign out failed.", { exact: true }).waitFor();
	await page.goBack();
	await page.goForward();
	await page.getByRole("button", { name: "Try again", exact: true }).waitFor();

	assert.equal(await page.getByText("Private account board", { exact: true }).count(), 0);
	assert.equal(await page.getByRole("button", { name: "Log in", exact: true }).count(), 0);
	assert.equal(await page.getByRole("button", { name: "Sign in", exact: true }).count(), 0);
	assert.equal(await page.getByText("Your session may still be active", { exact: false }).count(), 1);
	await page.getByRole("button", { name: "Try again", exact: true }).click();
	await page.getByRole("button", { name: "Log in", exact: true }).first().waitFor();
	assert.equal(logoutAttempts, 2);
});

test("password reset request and confirmation work without exposing the token in the URL", async t => {
	let resetRequest;
	let resetConfirmation;
	const server = http.createServer(async (request, response) => {
		const url = new URL(request.url, "http://localhost");
		if (url.pathname === "/api/v1/me") return json(response, { authenticated: false });
		if (url.pathname === "/api/v1/auth/password-reset/request" && request.method === "POST") {
			let body = "";
			for await (const chunk of request) body += chunk;
			resetRequest = JSON.parse(body);
			return accepted(response, { message: "If an account exists for that email, a password reset link is on its way." });
		}
		if (url.pathname === "/api/v1/auth/password-reset/confirm" && request.method === "POST") {
			let body = "";
			for await (const chunk of request) body += chunk;
			resetConfirmation = JSON.parse(body);
			return json(response, { ok: true });
		}
		if (url.pathname === "/" || url.pathname === "/reset-password" || url.pathname === "/index.html") return html(response);
		if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
		if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
		response.writeHead(404).end();
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise(resolve => server.close(resolve)));

	const browser = await chromium.launch({ headless: true });
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	const baseURL = `http://127.0.0.1:${server.address().port}`;
	await page.goto(baseURL);
	await page.getByRole("button", { name: "Log in" }).first().click();
	await page.getByRole("button", { name: "Forgot your password?" }).click();
	await page.getByLabel("Email").fill("person@example.com");
	await page.getByRole("button", { name: "Send reset link" }).click();
	const resetNotice = page.getByRole("status").filter({ hasText: "If an account exists" });
	await resetNotice.waitFor();
	const backToLogin = page.getByRole("button", { name: "Back to sign in" });
	for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
		await page.setViewportSize(viewport);
		const noticeBox = await resetNotice.boundingBox();
		const backBox = await backToLogin.boundingBox();
		assert.ok(noticeBox && backBox && noticeBox.y + noticeBox.height + 8 <= backBox.y, `reset notice must stay separated at ${viewport.width}px`);
	}
	assert.deepEqual(resetRequest, { email: "person@example.com" });

	await page.goto(`${baseURL}/reset-password#token=reset_secret`);
	await page.getByLabel("New password").fill("a new secure password");
	assert.equal(page.url(), `${baseURL}/reset-password`);
	await page.getByRole("button", { name: "Reset password" }).click();
	await page.getByRole("status").filter({ hasText: "Password reset. Sign in" }).waitFor();
	assert.deepEqual(resetConfirmation, { token: "reset_secret", password: "a new secure password" });
	assert.equal(page.url(), `${baseURL}/`);
});

function json(response, body) {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function accepted(response, body) {
	response.writeHead(202, { "Content-Type": "application/json" });
	response.end(JSON.stringify(body));
}

function conflict(response, code, error) {
	response.writeHead(409, { "Content-Type": "application/json" });
	response.end(JSON.stringify({ code, error }));
}

async function requestJSON(request) {
	let body = "";
	for await (const chunk of request) body += chunk;
	return JSON.parse(body);
}

function file(response, name, type) {
  response.writeHead(200, { "Content-Type": type });
  response.end(fs.readFileSync(path.join(dist, name)));
}

function html(response) {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><main id="app"></main><script type="module" src="/app.js"></script></body></html>');
}
