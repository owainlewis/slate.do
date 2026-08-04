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

function closeTestServer(server) {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

test("a board can be renamed, cancelled, validated, and reloaded in place", async t => {
  let boardName = "Business";
  const patches = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api/v1/me") return json(response, { authenticated: true, user: { id: "owner", email: "owner@example.com" } });
    if (url.pathname === "/api/v1/boards" && request.method === "GET") {
      return json(response, { boards: [{ id: "board-one", name: boardName }] });
    }
    if (url.pathname === "/api/v1/boards/board-one" && request.method === "GET") {
      return json(response, { ...board(false), name: boardName });
    }
    if (url.pathname === "/api/v1/boards/board-one" && request.method === "PATCH") {
      const input = await requestJSON(request);
      patches.push(input);
      const name = String(input.name || "").trim();
      if (!name) {
        response.writeHead(400, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({ error: "board name is required" }));
      }
      boardName = name;
      return json(response, { id: "board-one", name: boardName });
    }
    if (isAppShell(url.pathname)) return html(response);
    if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
    if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => closeTestServer(server));

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/app`);
  await page.getByRole("button", { name: "Improve the vault", exact: true }).waitFor();
  const originalURL = page.url();
  await page.getByRole("button", { name: "Flow", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();

  await page.getByRole("button", { name: "Rename Business", exact: true }).click();
  const nameInput = page.getByRole("textbox", { name: "Board name", exact: true });
  await nameInput.fill("Cancelled name");
  await page.getByRole("button", { name: "Cancel board rename", exact: true }).click();
  await page.getByRole("button", { name: "Rename Business", exact: true }).waitFor();
  assert.deepEqual(patches, []);

  await page.getByRole("button", { name: "Rename Business", exact: true }).click();
  await nameInput.fill("Also cancelled");
  await nameInput.press("Escape");
  await page.getByRole("button", { name: "Rename Business", exact: true }).waitFor();
  assert.deepEqual(patches, []);

  await page.getByRole("button", { name: "Rename Business", exact: true }).click();
  await nameInput.fill("   ");
  await page.getByRole("button", { name: "Save board name", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Board name is required." }).waitFor();
  assert.equal(await nameInput.getAttribute("aria-invalid"), "true");
  assert.deepEqual(patches, []);

  await nameInput.fill("  Growth plan  ");
  await page.getByRole("button", { name: "Save board name", exact: true }).click();
  await page.getByRole("button", { name: "Rename Growth plan", exact: true }).waitFor();
  assert.deepEqual(patches, [{ name: "Growth plan" }]);
  assert.equal(page.url(), originalURL);
  assert.equal(await page.getByRole("button", { name: "Flow", exact: true }).getAttribute("aria-pressed"), "true");
  await page.getByText("Improve the vault", { exact: true }).waitFor();

  await page.reload();
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("button", { name: "Rename Growth plan", exact: true }).waitFor();
  await page.getByText("Improve the vault", { exact: true }).waitFor();
});

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
    if (url.pathname === "/api/v1/tasks/task-one" && request.method === "GET") return json(response, task);
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
    if (isAppShell(url.pathname)) return html(response);
    if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
    if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => closeTestServer(server));

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/app`);

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
  const description = page.getByRole("textbox", { name: "Description", exact: true });
  assert.equal(await description.evaluate(element => getComputedStyle(element).marginTop), "18px");
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
  const mobileDescription = page.getByRole("textbox", { name: "Description", exact: true });
  assert.equal(await mobileDescription.evaluate(element => getComputedStyle(element).marginTop), "18px");
  const mobileDialog = await page.getByRole("dialog").boundingBox();
  const mobileTitle = await page.getByRole("textbox", { name: "Title", exact: true }).boundingBox();
  const mobileDescriptionBox = await mobileDescription.boundingBox();
  assert.ok(mobileDialog && mobileTitle && mobileDescriptionBox);
  assert.ok(mobileTitle.x >= mobileDialog.x && mobileTitle.x + mobileTitle.width <= mobileDialog.x + mobileDialog.width);
  assert.ok(mobileDescriptionBox.x >= mobileDialog.x && mobileDescriptionBox.x + mobileDescriptionBox.width <= mobileDialog.x + mobileDialog.width);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(patchCount, 3);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.boardMode), "flow");
});

test("saving an item moves it to the chosen position on another board", async t => {
  let moved = false;
  let moveBody;
  let saveBody;
  let currentTask = { ...task };
  const sourceTask = { ...task, id: "source-task", title: "Keep me first" };
  const destinationTask = { ...task, id: "destination-task", boardId: "board-two", bucketId: "list-target", title: "Already there" };
  const sourceBoard = () => ({
    id: "board-one", name: "Business", maxTasksPerList: 20,
    buckets: [
      { id: "list-inbox", boardId: "board-one", name: "Inbox", openCount: 0, limitCount: 20, tasks: [] },
      { id: "list-one", boardId: "board-one", name: "Ideas", openCount: moved ? 1 : 2, limitCount: 20, tasks: moved ? [sourceTask] : [sourceTask, currentTask] },
    ],
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
    if (url.pathname === "/api/v1/boards/board-two") {
      await new Promise(resolve => setTimeout(resolve, 200));
      return json(response, targetBoard());
    }
    if (url.pathname === "/api/v1/tasks/task-one" && request.method === "GET") return json(response, currentTask);
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
    if (isAppShell(url.pathname)) return html(response);
    if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
    if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => closeTestServer(server));

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/app`);
  await page.getByRole("button", { name: "Improve the vault", exact: true }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Edited before moving");
  await page.locator("#detail-date").fill("2026-07-30");
  await page.getByRole("button", { name: /Move…/ }).click();
  await page.getByLabel("Board", { exact: true }).selectOption("board-two");
  const save = page.getByRole("button", { name: "Save changes", exact: true });
  assert.equal(await page.locator("#move-list").textContent(), "Loading lists…");
  assert.equal(await page.getByRole("button", { name: "Move item", exact: true }).isDisabled(), true);
  assert.equal(await save.isDisabled(), true);
  await page.keyboard.press("Control+Enter");
  assert.equal(moveBody, undefined);
  assert.equal(saveBody, undefined);
  await page.getByLabel("List", { exact: true }).selectOption("list-target");
  await page.getByLabel("Board", { exact: true }).selectOption("board-one");
  assert.equal(await page.getByLabel("List", { exact: true }).inputValue(), "list-one");
  assert.equal(await page.getByLabel("Position", { exact: true }).inputValue(), "1");
  await save.click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(moveBody, undefined);
  assert.equal(saveBody.title, "Edited before moving");
  assert.equal(saveBody.scheduledDate, "2026-07-30");

  await page.locator('[data-open-task="task-one"]').click();
  await page.getByRole("button", { name: /Move…/ }).click();
  await page.getByLabel("Board", { exact: true }).selectOption("board-two");
  await page.getByLabel("List", { exact: true }).selectOption("list-target");
  await page.getByLabel("Position", { exact: true }).selectOption("1");
  const moveSave = page.getByRole("button", { name: "Save changes", exact: true });
  assert.equal(await moveSave.isEnabled(), true);
  await moveSave.click();

  await page.getByText("Moved to Website / Ready", { exact: true }).waitFor();
  assert.deepEqual(moveBody, { bucketId: "list-target", position: 1 });
  assert.equal(await page.locator('[data-open-task="task-one"]').count(), 0);
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
    if (url.pathname === "/api/v1/tasks/task-one" && request.method === "GET") return json(response, task);
    if (url.pathname === "/api/v1/tasks/task-one/move" && request.method === "POST") {
      await requestJSON(request);
      moved = true;
      return json(response, { ...task, boardId: "board-two", bucketId: "list-target", sortOrder: 0 });
    }
    if (isAppShell(url.pathname)) return html(response);
    if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
    if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => closeTestServer(server));

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/app`);
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
		if (isAppShell(url.pathname)) return html(response);
		if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
		if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
		response.writeHead(404).end();
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(() => closeTestServer(server));

	const browser = await chromium.launch({ headless: true });
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	await page.goto(`http://127.0.0.1:${server.address().port}/app`);

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
		if (isAppShell(url.pathname)) return html(response);
		if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
		if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
		response.writeHead(404).end();
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(() => closeTestServer(server));

	const browser = await chromium.launch({ headless: true });
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	await page.goto(`http://127.0.0.1:${server.address().port}/app`);

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
		if (isAppShell(url.pathname)) return html(response);
		if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
		if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
		response.writeHead(404).end();
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(() => closeTestServer(server));

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

	assert.equal(page.url(), `http://127.0.0.1:${server.address().port}/app/boards/board-one`);
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
		if (isAppShell(url.pathname)) return html(response);
		if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
		if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
		response.writeHead(404).end();
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(() => closeTestServer(server));

	const browser = await chromium.launch({ headless: true });
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	await page.goto(`http://127.0.0.1:${server.address().port}/app`);
	await page.getByText("Account A private board", { exact: true }).first().waitFor();

	await page.getByRole("button", { name: "Account A delayed board", exact: true }).click();
	await page.getByRole("button", { name: "Sign out", exact: true }).click();
	await page.getByText("Signing out…", { exact: true }).waitFor();
	assert.equal(await page.getByRole("button", { name: "Sign in", exact: true }).count(), 0);
	releaseLogout();
	await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
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
		if (isAppShell(url.pathname)) return html(response);
		if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
		if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
		response.writeHead(404).end();
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(() => closeTestServer(server));

	const browser = await chromium.launch({ headless: true });
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	await page.goto(`http://127.0.0.1:${server.address().port}/app`);
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
		if (isAppShell(url.pathname)) return html(response);
		if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
		if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
		response.writeHead(404).end();
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(() => closeTestServer(server));

	const browser = await chromium.launch({ headless: true });
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	await page.goto(`http://127.0.0.1:${server.address().port}/app`);
	await page.getByText("Private account board", { exact: true }).first().waitFor();
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	await page.getByRole("heading", { name: "Profile", exact: true }).waitFor();
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
	await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
	assert.equal(logoutAttempts, 2);
});

test("route load failures replace stale UI and retry without changing history", async t => {
	let failTokens = true;
	const server = http.createServer(async (request, response) => {
		const url = new URL(request.url, "http://localhost");
		if (url.pathname === "/api/v1/me") return json(response, { authenticated: true, user: { id: "owner", email: "owner@example.com" } });
		if (url.pathname === "/api/v1/boards") return json(response, { boards: [{ id: "board-one", name: "Business" }] });
		if (url.pathname === "/api/v1/boards/board-one") return json(response, board(false));
		if (url.pathname === "/api/v1/api-tokens") {
			if (failTokens) {
				response.writeHead(500, { "Content-Type": "application/json" });
				return response.end(JSON.stringify({ error: "Tokens are unavailable" }));
			}
			return json(response, { tokens: [] });
		}
		if (isAppShell(url.pathname)) return html(response);
		if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
		if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
		response.writeHead(404).end();
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(() => closeTestServer(server));

	const browser = await chromium.launch({ headless: true });
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	const pageErrors = [];
	page.on("pageerror", error => pageErrors.push(error.message));
	const baseURL = `http://127.0.0.1:${server.address().port}`;
	await page.goto(`${baseURL}/app`);
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	await page.getByRole("link", { name: "API access", exact: true }).click();

	await page.getByRole("heading", { name: "Couldn’t load API access settings.", exact: true }).waitFor();
	assert.equal(page.url(), `${baseURL}/app/settings/api`);
	assert.equal(await page.getByRole("alert").innerText(), "Tokens are unavailable");
	assert.equal(await page.getByRole("button", { name: "Business", exact: true }).count(), 0, "the previous board must not remain visible");
	assert.deepEqual(pageErrors, []);

	failTokens = false;
	await page.getByRole("button", { name: "Try again", exact: true }).click();
	await page.getByRole("heading", { name: "API access", exact: true }).waitFor();
	assert.equal(page.url(), `${baseURL}/app/settings/api`);
	assert.deepEqual(pageErrors, []);
});

test("account and exact-board settings stay synchronized, safe, and responsive", async t => {
  let user = { id: "owner", email: "owner@example.com", displayName: "Owner", theme: "light" };
  const boards = [
    { id: "board-one", name: "Business", maxTasksPerList: 12, buckets: [] },
    { id: "board-two", name: "A very long board name that still belongs to this exact board", maxTasksPerList: 8, buckets: [] },
  ];
  let tokens = [];
  let failTokenMetadata = false;
  let failThemeOnce = false;
  let delayBoardPatch = false;
  let releaseBoardPatch;
  let markBoardPatchStarted;
  const boardPatchResponse = new Promise(resolve => { releaseBoardPatch = resolve; });
  const boardPatchStarted = new Promise(resolve => { markBoardPatchStarted = resolve; });
  const profilePatches = [];
  const boardPatches = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api/v1/me" && request.method === "GET") {
      return json(response, { authenticated: true, user });
    }
    if (url.pathname === "/api/v1/me" && request.method === "PATCH") {
      const input = await requestJSON(request);
      profilePatches.push(input);
      if (input.theme && failThemeOnce) {
        failThemeOnce = false;
        response.writeHead(503, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({ error: "Theme preference could not be saved" }));
      }
      user = { ...user, ...input };
      return json(response, user);
    }
    if (url.pathname === "/api/v1/boards") {
      return json(response, { boards: boards.map(({ buckets, ...item }) => item) });
    }
    const exactBoard = boards.find(item => url.pathname === `/api/v1/boards/${item.id}`);
    if (exactBoard && request.method === "PATCH") {
      const input = await requestJSON(request);
      boardPatches.push({ id: exactBoard.id, ...input });
      if (delayBoardPatch && exactBoard.id === "board-one") {
        markBoardPatchStarted();
        await boardPatchResponse;
        response.writeHead(503, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({ error: "Board update failed" }));
      }
      Object.assign(exactBoard, input);
      return json(response, exactBoard);
    }
    if (exactBoard) return json(response, exactBoard);
    if (url.pathname === "/api/v1/agents") return json(response, { agents: [], activeAgents: 0, maxAgents: 5 });
    if (url.pathname === "/api/v1/api-tokens" && request.method === "GET") {
      if (failTokenMetadata) {
        failTokenMetadata = false;
        response.writeHead(503, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({ error: "Token metadata unavailable" }));
      }
      return json(response, { tokens });
    }
    if (url.pathname === "/api/v1/api-tokens" && request.method === "POST") {
      const input = await requestJSON(request);
      tokens = [{ id: "token-one", name: input.name }];
      failTokenMetadata = true;
      return json(response, { token: "slate_personal_one_time" });
    }
    if (url.pathname === "/api/v1/api-tokens/token-one" && request.method === "DELETE") {
      tokens = [];
      return json(response, { ok: true });
    }
    if (isAppShell(url.pathname)) return html(response);
    if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
    if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => closeTestServer(server));

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const baseURL = `http://127.0.0.1:${server.address().port}`;

  await page.goto(`${baseURL}/app/settings`);
  await page.getByRole("heading", { name: "Profile", exact: true }).waitFor();
  assert.equal(page.url(), `${baseURL}/app/settings/profile`);
  assert.deepEqual(await page.locator(".settings-nav-link").allTextContents(), ["Profile", "Preferences", "API access"]);
  const displayName = page.locator("#profile-display-name");
  assert.equal(await displayName.inputValue(), "Owner");
  assert.equal(await page.getByText("owner@example.com", { exact: true }).count(), 1);
  assert.match(await page.locator(".profile-card .user-avatar").getAttribute("class"), /tone-\d/);
  assert.equal(await page.getByRole("spinbutton", { name: "Max active items per list", exact: true }).count(), 0);
  assert.equal(await page.locator('.settings-nav-link[aria-current="page"]').innerText(), "Profile");
  await displayName.fill("   ");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Display name is required." }).waitFor();
  assert.equal(profilePatches.length, 0);
  await displayName.fill("Owain Lewis");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Profile saved." }).waitFor();
  assert.deepEqual(profilePatches, [{ displayName: "Owain Lewis" }]);

  await page.getByRole("link", { name: "Preferences", exact: true }).click();
  await page.getByRole("heading", { name: "Preferences", exact: true }).waitFor();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.locator(".settings-page.theme-dark").waitFor();
  await page.getByRole("status").filter({ hasText: "Theme preference saved." }).waitFor();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Theme preference saved." }).waitFor();
  assert.equal(user.theme, "dark");
  assert.deepEqual(profilePatches.slice(1).map(input => input.theme), ["dark", "light", "dark"]);
  failThemeOnce = true;
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Could not save theme. Restored dark." }).waitFor();
  assert.equal(user.theme, "dark");
  assert.equal(await page.getByRole("button", { name: "Dark", exact: true }).getAttribute("aria-pressed"), "true");

  await page.getByRole("link", { name: "API access", exact: true }).click();
  await page.getByRole("heading", { name: "API access", exact: true }).waitFor();
  await page.getByText("Personal API tokens", { exact: true }).waitFor();
  await page.getByText("Agent credentials", { exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: /Manage agents/ }).getAttribute("href"), "/app/agents");
  assert.equal(await page.getByRole("textbox", { name: "Agent name", exact: true }).count(), 0);
  await page.locator("#token-name").fill("Laptop CLI");
  await page.getByRole("button", { name: "Create token", exact: true }).click();
  await page.getByText("slate_personal_one_time", { exact: true }).waitFor();
  await page.getByRole("status").filter({ hasText: "could not be refreshed" }).waitFor();
  await page.getByRole("link", { name: "Preferences", exact: true }).click();
  assert.equal(await page.getByText("slate_personal_one_time", { exact: true }).count(), 0);
  await page.goBack();
  await page.getByRole("heading", { name: "API access", exact: true }).waitFor();
  assert.equal(await page.getByText("slate_personal_one_time", { exact: true }).count(), 0);
  await page.reload();
  assert.equal(await page.getByText("slate_personal_one_time", { exact: true }).count(), 0);

  await page.goto(`${baseURL}/app/boards/board-one`);
  await page.getByRole("button", { name: "Dark", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Dark", exact: true }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "Board settings for Business", exact: true }).click();
  await page.waitForURL(`${baseURL}/app/boards/board-one/settings`);
  await page.getByRole("heading", { name: "Business", exact: true }).waitFor();
  const listLimit = page.getByRole("spinbutton", { name: "Max active items per list", exact: true });
  assert.equal(await listLimit.inputValue(), "12");
  await listLimit.fill("0");
  await page.getByRole("button", { name: "Save limit", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Enter a value from 1 to 20." }).waitFor();
  assert.equal(boardPatches.length, 0);
  await listLimit.fill("13");
  await page.getByRole("button", { name: "Save limit", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Board limit saved." }).waitFor();
  assert.deepEqual(boardPatches, [{ id: "board-one", maxTasksPerList: 13 }]);

  delayBoardPatch = true;
  await listLimit.fill("14");
  await page.getByRole("button", { name: "Save limit", exact: true }).click();
  await boardPatchStarted;
  await page.goto(`${baseURL}/app/boards/board-two/settings`);
  await page.getByRole("heading", { name: boards[1].name, exact: true }).waitFor();
  assert.equal(await page.getByRole("spinbutton", { name: "Max active items per list", exact: true }).inputValue(), "8");
  releaseBoardPatch();
  await page.waitForTimeout(40);
  assert.equal(await page.getByText("Board update failed", { exact: true }).count(), 0);

  for (const viewport of [{ width: 1280, height: 800 }, { width: 640, height: 500 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      true,
      `settings must not overflow at ${viewport.width}px`,
    );
  }
  await page.getByRole("button", { name: "Back to board", exact: true }).focus();
  assert.match(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), /solid|auto/);

  await page.goto(`${baseURL}/app/boards/missing/settings`);
  await page.getByRole("heading", { name: "Couldn’t load board settings.", exact: true }).waitFor();
  await page.getByRole("alert").filter({ hasText: "does not exist or is no longer available" }).waitFor();
  assert.equal(page.url(), `${baseURL}/app/boards/missing/settings`);

  await page.goto(`${baseURL}/app/settings/profile`);
  await page.getByRole("button", { name: "Back to board", exact: true }).click();
  await page.waitForURL(`${baseURL}/app/boards/board-one`);
  assert.equal(page.url(), `${baseURL}/app/boards/board-one`);
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
		if (isAppShell(url.pathname)) return html(response);
		if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
		if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
		response.writeHead(404).end();
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(() => closeTestServer(server));

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
	assert.equal(page.url(), `${baseURL}/login`);
});

test("agent directory handles loading, errors, limits, archives, themes, keyboard use, and narrow layouts", async t => {
  let theme = "light";
  let failAgentLoad = false;
  let releaseInitialLoad;
  const initialLoad = new Promise(resolve => { releaseInitialLoad = resolve; });
  let delayInitialLoad = true;
  let agents = [
    {
      id: "agent-connected", displayName: "Builder Bot", purpose: "Ships product",
      credential: { lastUsedAt: "2026-07-27T14:30:00Z" },
      workCounts: { ready: 2, working: 1, review: 1 },
    },
    {
      id: "agent-disconnected", displayName: "Research Bot", purpose: "Finds evidence",
      credential: { revokedAt: "2026-07-26T14:30:00Z" }, workCounts: {},
    },
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `agent-${index + 3}`, displayName: `Agent ${index + 3}`, purpose: "", credential: {}, workCounts: {},
    })),
    {
      id: "agent-archived", displayName: "Archived Bot", purpose: "Old work",
      archivedAt: "2026-07-25T10:00:00Z", credential: { revokedAt: "2026-07-25T10:00:00Z" },
      workCounts: { review: 2 },
    },
  ];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api/v1/me" && request.method === "GET") {
      return json(response, { authenticated: true, user: { id: "owner", email: "owner@example.com", displayName: "Owner", theme } });
    }
    if (url.pathname === "/api/v1/me" && request.method === "PATCH") {
      theme = (await requestJSON(request)).theme;
      return json(response, { id: "owner", email: "owner@example.com", displayName: "Owner", theme });
    }
    if (url.pathname === "/api/v1/boards") return json(response, { boards: [{ id: "board-one", name: "Business" }] });
    if (url.pathname === "/api/v1/agents") {
      if (delayInitialLoad) {
        delayInitialLoad = false;
        await initialLoad;
      }
      if (failAgentLoad) {
        failAgentLoad = false;
        response.writeHead(503, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({ error: "agents temporarily unavailable" }));
      }
      const activeAgents = agents.filter(agent => !agent.archivedAt).length;
      return json(response, { agents, activeAgents, maxAgents: 5 });
    }
    if (isAppShell(url.pathname)) return html(response);
    if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
    if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => closeTestServer(server));

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${baseURL}/app/agents`);
  await page.getByRole("heading", { name: "Loading agents…", exact: true }).waitFor();
  releaseInitialLoad();
  await page.getByRole("heading", { name: "Agents", exact: true }).waitFor();

  assert.equal(await page.getByRole("link", { name: "Agents", exact: true }).getAttribute("aria-current"), "page");
  await page.getByText("Connected", { exact: true }).first().waitFor();
  await page.getByText("Needs connection", { exact: true }).waitFor();
  await page.getByText("2 ready items · 1 working item · 1 review item", { exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "New agent", exact: true }).getAttribute("aria-disabled"), "true");
  await page.getByText(/5 of 5 active agents/).waitFor();
  await page.getByText(/^Archived 1$/).click();
  await page.getByText("Archived Bot", { exact: true }).waitFor();
  await page.getByText("Archived", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.locator(".agents-shell.theme-dark").waitFor();
  assert.equal(theme, "dark");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("link", { name: "Agents", exact: true }).focus();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Agents");

  failAgentLoad = true;
  await page.reload();
  await page.getByRole("heading", { name: "Agents couldn’t be loaded.", exact: true }).waitFor();
  await page.getByRole("alert").filter({ hasText: "agents temporarily unavailable" }).waitFor();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByText("Builder Bot", { exact: true }).waitFor();

  agents = [];
  await page.reload();
  await page.getByRole("heading", { name: "Bring an agent into the plan.", exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "New agent", exact: true }).count(), 1);
  await page.goto(`${baseURL}/app/settings/agents`);
  await page.waitForURL(`${baseURL}/app/agents`);
  assert.equal(await page.getByRole("heading", { name: "Agents", exact: true }).count(), 1);
});

test("shared new-board flow stays on agents and exposes a default-list failure", async t => {
  let boards = [{ id: "board-one", name: "Business" }];
  let bucketPosts = 0;
  let boardDetailRequests = 0;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api/v1/me") return json(response, {
      authenticated: true,
      user: { id: "owner", email: "owner@example.com", displayName: "Owner", theme: "light" },
    });
    if (url.pathname === "/api/v1/boards" && request.method === "GET") {
      return json(response, { boards, maxBoards: 5 });
    }
    if (url.pathname === "/api/v1/boards" && request.method === "POST") {
      const board = { id: "partial-board", name: "Untitled board" };
      boards = [...boards, board];
      return json(response, board);
    }
    if (url.pathname === "/api/v1/boards/partial-board/buckets" && request.method === "POST") {
      bucketPosts += 1;
      if (bucketPosts === 2) {
        response.writeHead(503, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({ error: "Focus list could not be created" }));
      }
      return json(response, { id: "inbox", name: "Inbox" });
    }
    if (url.pathname === "/api/v1/boards/partial-board") {
      boardDetailRequests += 1;
      return json(response, { id: "partial-board", name: "Untitled board", buckets: [] });
    }
    if (url.pathname === "/api/v1/agents") return json(response, {
      agents: [{ id: "agent", displayName: "Builder Bot", credential: {}, workCounts: {} }],
      activeAgents: 1,
      maxAgents: 5,
    });
    if (isAppShell(url.pathname)) return html(response);
    if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
    if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => closeTestServer(server));

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${baseURL}/app/agents`);
  await page.getByRole("heading", { name: "Agents", exact: true }).waitFor();
  await page.getByRole("button", { name: "New board", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Focus list could not be created" }).waitFor();

  assert.equal(page.url(), `${baseURL}/app/agents`);
  assert.equal(bucketPosts, 2);
  assert.equal(boardDetailRequests, 0);
  await page.getByText("Untitled board", { exact: true }).waitFor();
});

test("guided agent creation validates, preserves one-time credentials on refresh failure, and clears stale results", async t => {
  let agents = [];
  let failMetadataOnce = false;
  let releaseDelayedCreate;
  let markDelayedCreateStarted;
  const delayedCreate = new Promise(resolve => { releaseDelayedCreate = resolve; });
  const delayedCreateStarted = new Promise(resolve => { markDelayedCreateStarted = resolve; });
  let lastCreateInput;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api/v1/me") return json(response, {
      authenticated: true,
      user: { id: "owner", email: "owner@example.com", displayName: "Owner", theme: "light" },
    });
    if (url.pathname === "/api/v1/boards") return json(response, { boards: [{ id: "board-one", name: "Business" }] });
    if (url.pathname === "/api/v1/agents" && request.method === "GET") {
      if (failMetadataOnce) {
        failMetadataOnce = false;
        response.writeHead(503, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({ error: "metadata refresh failed" }));
      }
      return json(response, { agents, activeAgents: agents.length, maxAgents: 5 });
    }
    if (url.pathname === "/api/v1/agents" && request.method === "POST") {
      const input = await requestJSON(request);
      if (input.displayName === "Rejected Bot") {
        response.writeHead(503, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({ error: "agent could not be created" }));
      }
      if (input.displayName === "Delayed Bot") {
        markDelayedCreateStarted();
        await delayedCreate;
      }
      lastCreateInput = input;
      const agent = {
        id: `agent-${agents.length + 1}`, displayName: input.displayName, purpose: input.purpose,
        credential: { tokenPrefix: "slate_agent_created" }, workCounts: {},
      };
      agents = [...agents, agent];
      if (input.displayName === "Builder Bot") failMetadataOnce = true;
      return json(response, { ...agent, token: `slate_agent_${input.displayName === "Delayed Bot" ? "delayed" : "create_once"}` });
    }
    if (isAppShell(url.pathname)) return html(response);
    if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
    if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => closeTestServer(server));

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${baseURL}/app/agents/new`);
  const create = page.getByRole("button", { name: "Create agent", exact: true });
  await create.click();
  await page.getByRole("alert").filter({ hasText: "Agent name is required." }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "agent-name");

  await page.getByLabel("Name Required", { exact: true }).fill("Rejected Bot");
  await create.click();
  await page.getByRole("alert").filter({ hasText: "agent could not be created" }).waitFor();
  await page.getByLabel("Name Required", { exact: true }).fill("  Builder Bot  ");
  await page.getByLabel("Purpose Optional", { exact: true }).fill("  Ships polished product  ");
  await create.click();
  await page.getByRole("heading", { name: "Connect your agent", exact: true }).waitFor();
  await page.getByText("slate_agent_create_once", { exact: true }).waitFor();
  await page.getByText(/credential is still available until you leave this page/).waitFor();
  assert.deepEqual(lastCreateInput, { displayName: "Builder Bot", purpose: "Ships polished product" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);

  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText() { throw new Error("permission denied"); },
        async readText() { return window.__copiedCredential || ""; },
      },
    });
    document.execCommand = () => false;
  });
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "The token is selected" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Copy", exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Copied", exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.getSelection().toString()), "slate_agent_create_once");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "agent-credential");

  await page.evaluate(() => {
    navigator.clipboard.writeText = async text => { window.__copiedCredential = text; };
  });
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "slate_agent_create_once");
  await page.getByText("export SLATE_API_TOKEN=slate_agent_create_once", { exact: true }).waitFor();
  await page.getByText("slate auth status", { exact: true }).waitFor();

  await page.reload();
  await page.getByRole("heading", { name: "New agent", exact: true }).waitFor();
  assert.equal(await page.getByText("slate_agent_create_once", { exact: true }).count(), 0);
  await page.goBack();
  await page.goForward();
  assert.equal(await page.getByText("slate_agent_create_once", { exact: true }).count(), 0);

  await page.getByLabel("Name Required", { exact: true }).fill("Delayed Bot");
  await create.click();
  await delayedCreateStarted;
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await page.waitForURL(`${baseURL}/app/agents`);
  releaseDelayedCreate();
  await page.waitForTimeout(50);
  assert.equal(await page.getByText("slate_agent_delayed", { exact: true }).count(), 0);
  await page.reload();
  await page.getByText("Delayed Bot", { exact: true }).waitFor();
  assert.equal(await page.getByText("slate_agent_delayed", { exact: true }).count(), 0);
});

test("agent detail routes paginate, assign, edit, regroup, and stay safe across responsive states", async t => {
  const owner = { id: "owner", email: "owner@example.com", displayName: "Owner", theme: "light" };
  const agent = {
    id: "agent-one",
    displayName: "Builder with a deliberately long but readable collaborator name",
    purpose: "Ships focused product work without pretending Slate hosts execution.",
    credential: { lastUsedAt: "2026-07-28T08:15:00Z" },
    workCounts: { ready: 1, working: 1, review: 1 },
  };
  const archivedAgent = {
    id: "agent-archived", displayName: "Archived builder", purpose: "Historical work",
    archivedAt: "2026-07-27T08:00:00Z", credential: { revokedAt: "2026-07-27T08:00:00Z" }, workCounts: {},
  };
  let tasks = [
    { id: "ready", boardId: "board-one", bucketId: "list-one", title: "Ready item", description: "", scheduledDate: "", kind: "action", done: false, status: "queued", assigneeAgentId: agent.id, createdAt: "2026-07-28T07:00:00Z", updatedAt: "2026-07-28T07:00:00Z" },
    { id: "working", boardId: "board-one", bucketId: "list-one", title: "Working item", description: "", scheduledDate: "", kind: "action", done: false, status: "working", assigneeAgentId: agent.id, createdAt: "2026-07-28T07:10:00Z", updatedAt: "2026-07-28T07:10:00Z" },
    { id: "review", boardId: "board-one", bucketId: "list-one", title: "Review item", description: "", scheduledDate: "", kind: "action", done: false, status: "needs_review", assigneeAgentId: agent.id, createdAt: "2026-07-28T07:20:00Z", updatedAt: "2026-07-28T07:20:00Z" },
    { id: "done", boardId: "board-one", bucketId: "list-one", title: "Completed item", description: "", scheduledDate: "", kind: "action", done: true, status: "done", assigneeAgentId: agent.id, createdAt: "2026-07-27T07:00:00Z", updatedAt: "2026-07-28T06:00:00Z" },
  ];
  let releaseInitialDetail;
  const initialDetail = new Promise(resolve => { releaseInitialDetail = resolve; });
  let firstDetailRequest = true;
  let omittedTaskID = "";
  let expireBoardPreflight = false;
  const delayedBoardPreflights = [];
  const delayNextBoardPreflight = () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    delayedBoardPreflights.push(pending);
    return release;
  };
  const patchBodies = [];
  const workItem = task => ({ ...task, boardName: "Business", bucketName: "Product" });
  const detailFor = identity => {
    const assigned = tasks.filter(task => task.assigneeAgentId === identity.id);
    const visible = assigned.filter(task => task.id !== omittedTaskID);
    const open = (items, status) => items.filter(task => !task.done && task.status === status);
    const completed = visible.filter(task => task.done).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map(workItem);
    return {
      agent: identity,
      work: {
        ready: open(visible, "queued").map(workItem).slice(0, 50),
        working: open(visible, "working").map(workItem).slice(0, 50),
        review: open(visible, "needs_review").map(workItem).slice(0, 50),
        recentlyCompleted: completed.slice(0, 20),
        totals: {
          ready: open(assigned, "queued").length,
          working: open(assigned, "working").length,
          review: open(assigned, "needs_review").length,
          completed: assigned.filter(task => task.done).length,
        },
        openLimit: 50,
        completedLimit: 20,
      },
    };
  };
  const boardPayload = () => ({
    id: "board-one", name: "Business", backgroundValue: owner.theme, maxTasksPerList: 20,
    buckets: [{
      id: "list-one", boardId: "board-one", name: "Product", goal: "", limitCount: 20,
      openCount: tasks.filter(task => !task.done).length,
      tasks: tasks.map(task => ({ ...task })),
    }],
  });
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api/v1/me" && request.method === "GET") return json(response, { authenticated: true, user: owner });
    if (url.pathname === "/api/v1/me" && request.method === "PATCH") {
      Object.assign(owner, await requestJSON(request));
      return json(response, owner);
    }
    if (url.pathname === "/api/v1/auth/logout") return json(response, { ok: true });
    if (url.pathname === "/api/v1/boards") {
      const delayed = delayedBoardPreflights.shift();
      if (delayed) await delayed;
      if (expireBoardPreflight) {
        response.writeHead(401, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({ error: "sign in required" }));
      }
      return json(response, { boards: [{ id: "board-one", name: "Business" }], maxBoards: 5 });
    }
    if (url.pathname === "/api/v1/boards/board-one") return json(response, boardPayload());
    if (url.pathname === "/api/v1/agents") return json(response, { agents: [agent, archivedAgent], activeAgents: 1, maxAgents: 5 });
    if (url.pathname === "/api/v1/agents/agent-one/work") {
      const page = Number(url.searchParams.get("page") || 1);
      const items = tasks.filter(task => task.assigneeAgentId === agent.id).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map(workItem);
      return json(response, { items: page === 1 ? items : [], page, pageSize: 50, total: 51, hasPrevious: page > 1, hasNext: page === 1 });
    }
    if (url.pathname === "/api/v1/agents/agent-one") {
      if (firstDetailRequest) {
        firstDetailRequest = false;
        await initialDetail;
      }
      return json(response, detailFor(agent));
    }
    if (url.pathname === "/api/v1/agents/agent-archived") return json(response, detailFor(archivedAgent));
    if (url.pathname === "/api/v1/agents/agent-expired") {
      response.writeHead(401, { "Content-Type": "application/json" });
      return response.end(JSON.stringify({ error: "sign in required" }));
    }
    if (url.pathname === "/api/v1/agents/agent-failed") {
      response.writeHead(503, { "Content-Type": "application/json" });
      return response.end(JSON.stringify({ error: "agent service unavailable" }));
    }
    if (url.pathname === "/api/v1/agents/agent-missing") {
      response.writeHead(404, { "Content-Type": "application/json" });
      return response.end(JSON.stringify({ error: "agent not found" }));
    }
    if (url.pathname.startsWith("/api/v1/tasks/") && request.method === "GET") {
      const id = url.pathname.split("/")[4];
      const selected = tasks.find(task => task.id === id);
      if (selected) return json(response, selected);
      response.writeHead(404, { "Content-Type": "application/json" });
      return response.end(JSON.stringify({ error: "task not found" }));
    }
    if (url.pathname.startsWith("/api/v1/tasks/") && url.pathname.endsWith("/status") && request.method === "PATCH") {
      const id = url.pathname.split("/")[4];
      const input = await requestJSON(request);
      patchBodies.push(input);
      tasks = tasks.map(task => {
        if (task.id !== id) return task;
        const updated = { ...task, ...input, updatedAt: "2026-07-28T10:00:00Z" };
        updated.done = input.status === "done";
        return updated;
      });
      return json(response, tasks.find(task => task.id === id));
    }
    if (url.pathname === "/api/v1/buckets/list-one/tasks" && request.method === "POST") {
      const input = await requestJSON(request);
      if (input.title === "Expire session") {
        response.writeHead(401, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({ error: "sign in required" }));
      }
      if (input.title === "Network failure") {
        response.writeHead(503, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({ error: "item could not be created" }));
      }
      const created = {
        id: `created-${tasks.length}`, boardId: "board-one", bucketId: "list-one",
        title: input.title, description: input.description, scheduledDate: input.scheduledDate,
        kind: "action", done: false, status: "queued", assigneeAgentId: input.assigneeAgentId,
        createdAt: "2026-07-28T11:00:00Z", updatedAt: "2026-07-28T11:00:00Z",
      };
      tasks = [...tasks, created];
      if (input.title === "Beyond response limit") omittedTaskID = created.id;
      return json(response, created);
    }
    if (isAppShell(url.pathname)) return html(response);
    if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
    if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => closeTestServer(server));

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const releaseInitialPreflight = delayNextBoardPreflight();
  const navigation = page.goto(`${baseURL}/app/agents/agent-one`);
  await page.getByRole("heading", { name: "Loading agent…", exact: true }).waitFor();
  assert.equal(await page.getByText("Ready item", { exact: true }).count(), 0);
  releaseInitialPreflight();
  releaseInitialDetail();
  await navigation;
  await page.getByRole("heading", { name: agent.displayName, exact: true }).waitFor();
  for (const title of ["Ready item", "Working item", "Review item", "Completed item"]) {
    await page.getByText(title, { exact: true }).waitFor();
  }
  assert.equal(await page.getByText("Working item", { exact: true }).count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  const overviewTab = page.getByRole("tab", { name: "Overview", exact: true });
  assert.equal(await overviewTab.getAttribute("aria-controls"), "agent-panel-overview");
  assert.equal(await page.locator("#agent-panel-overview").getAttribute("aria-labelledby"), "agent-tab-overview");
  assert.equal(await page.locator("#agent-panel-overview").isVisible(), true);
  assert.equal(await page.locator("#agent-panel-work").isHidden(), true);

  const releaseWorkPreflight = delayNextBoardPreflight();
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await page.waitForURL(`${baseURL}/app/agents/agent-one/work`);
  await page.getByRole("heading", { name: "Loading agent…", exact: true }).waitFor();
  assert.equal(await page.getByText("Ready item", { exact: true }).count(), 0, "old overview work must clear before the board preflight resolves");
  assert.equal(await page.getByRole("heading", { name: agent.displayName, exact: true }).count(), 0);
  releaseWorkPreflight();
  await page.getByRole("heading", { name: "All work", exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "tab" && document.activeElement?.textContent.trim() === "Work");
  assert.equal(await page.getByRole("tab", { name: "Work", exact: true }).getAttribute("aria-controls"), "agent-panel-work");
  assert.equal(await page.locator("#agent-panel-work").getAttribute("aria-labelledby"), "agent-tab-work");
  assert.equal(await page.locator("#agent-panel-work").isVisible(), true);
  assert.equal(await page.locator("#agent-panel-overview").isHidden(), true);
  await page.getByRole("link", { name: "Next", exact: true }).click();
  await page.waitForURL(`${baseURL}/app/agents/agent-one/work?page=2`);
  await page.getByText("Page 2 · 0 of 51", { exact: true }).waitFor();
  await page.goBack();
  await page.waitForURL(`${baseURL}/app/agents/agent-one/work`);
  const releaseOverviewPreflight = delayNextBoardPreflight();
  await page.goBack();
  await page.waitForURL(`${baseURL}/app/agents/agent-one`);
  await page.getByRole("heading", { name: "Loading agent…", exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "All work", exact: true }).count(), 0, "old work page must clear during browser back navigation");
  releaseOverviewPreflight();
  await page.getByRole("heading", { name: agent.displayName, exact: true }).waitFor();
  const releaseForwardPreflight = delayNextBoardPreflight();
  await page.goForward();
  await page.waitForURL(`${baseURL}/app/agents/agent-one/work`);
  await page.getByRole("heading", { name: "Loading agent…", exact: true }).waitFor();
  assert.equal(await page.getByText("Ready item", { exact: true }).count(), 0, "old overview work must clear during browser forward navigation");
  releaseForwardPreflight();
  await page.getByRole("heading", { name: "All work", exact: true }).waitFor();
  await page.goBack();
  await page.waitForURL(`${baseURL}/app/agents/agent-one`);
  await page.getByText("Ready item", { exact: true }).waitFor();

  await page.getByRole("button", { name: /Ready item/ }).click();
  await page.getByLabel("State", { exact: true }).selectOption("working");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await page.getByText("Ready item", { exact: true }).count(), 1, "regrouping must not duplicate the edited item");
  assert.equal(await page.locator(".agent-current .agent-section-heading > span").textContent(), "2");
  await page.waitForFunction(() => Boolean(document.activeElement?.dataset.openAgentTask));
  assert.equal(patchBodies[0].status, "working");

  await page.getByRole("button", { name: /Ready item/ }).click();
  await page.getByLabel("Description", { exact: true }).fill("Fresh work data stays authoritative.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(patchBodies[1].status, "working", "a stale board cache must not revert the regrouped state");
  assert.equal(tasks.find(task => task.id === "ready").status, "working");
  assert.equal(await page.locator(".agent-current .agent-section-heading > span").textContent(), "2");

  const assign = page.getByRole("button", { name: "Assign work", exact: true });
  await assign.click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "assign-work");
  await assign.click();
  await page.getByRole("button", { name: "Create item", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Item title is required." }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "assign-title");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Network failure");
  await page.getByRole("button", { name: "Create item", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "item could not be created" }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Title", exact: true }).inputValue(), "Network failure");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("New assigned item");
  await page.getByRole("button", { name: "Create item", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "was assigned" }).waitFor();
  await page.getByText("New assigned item", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.openAgentTask?.startsWith("created-")), true);

  await assign.click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Beyond response limit");
  await page.getByRole("button", { name: "Create item", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Beyond response limit" }).waitFor();
  assert.equal(await page.getByText("Beyond response limit", { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "assign-work", "bounded responses need a stable focus fallback");

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/v1/me") && response.request().method() === "PATCH"),
    page.getByRole("button", { name: "Dark", exact: true }).click(),
  ]);
  await page.locator(".theme-dark").waitFor();
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(15, 16, 17)");
  await overviewTab.focus();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Overview");
  await overviewTab.press("ArrowRight");
  await page.waitForURL(`${baseURL}/app/agents/agent-one/work`);
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "tab" && document.activeElement?.getAttribute("aria-selected") === "true");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role")), "tab");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-selected")), "true");

  await page.goto(`${baseURL}/app/agents/agent-one`);
  await page.getByRole("button", { name: "Assign work", exact: true }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Expire session");
  await page.getByRole("button", { name: "Create item", exact: true }).click();
  await page.getByRole("heading", { name: "Your session has expired.", exact: true }).waitFor();
  assert.equal(await page.getByText("Ready item", { exact: true }).count(), 0);

  await page.goto(`${baseURL}/app/agents/agent-archived`);
  await page.getByText("Archived identity", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Assign work", exact: true }).count(), 0);
  await page.goto(`${baseURL}/app/agents/agent-missing`);
  await page.getByRole("heading", { name: "Agent not found.", exact: true }).waitFor();
  await page.goto(`${baseURL}/app/agents/agent-failed`);
  await page.getByRole("alert").filter({ hasText: "agent service unavailable" }).waitFor();
  expireBoardPreflight = true;
  await page.goto(`${baseURL}/app/agents/agent-one`);
  await page.getByRole("heading", { name: "Your session has expired.", exact: true }).waitFor();
  assert.equal(await page.getByText("Ready item", { exact: true }).count(), 0);
});

test("agent settings safely edit, rotate, revoke, archive, restore, and scrub one-time credentials", async t => {
  const owner = { id: "owner", email: "owner@example.com", displayName: "Owner", theme: "light" };
  const agent = {
    id: "agent-one", displayName: "Builder", purpose: "Ships work",
    credential: { id: "credential-one", tokenPrefix: "slate_agent_connected" },
    workCounts: { ready: 2, working: 1, review: 1 },
  };
  let archived = false;
  let connected = true;
  let failDetailRefresh = false;
  let loseRotationResponse = false;
  let archiveAttempts = 0;
  let revokeGate = null;
  let archiveGate = null;
  let restoreGate = null;
  const patches = [];
  const deferredResponse = () => {
    let release;
    return { promise: new Promise(resolve => { release = resolve; }), release };
  };
  const detail = () => ({
    agent: {
      ...agent,
      archivedAt: archived ? "2026-07-28T12:00:00Z" : undefined,
      credential: connected
        ? { id: "credential-current", tokenPrefix: "slate_agent_current" }
        : { id: "credential-old", tokenPrefix: "slate_agent_old", revokedAt: "2026-07-28T11:00:00Z" },
    },
    work: {
      ready: [], working: [], review: [], recentlyCompleted: [],
      totals: { ready: archived ? 0 : 2, working: archived ? 0 : 1, review: 1, completed: 1 },
      openLimit: 50, completedLimit: 20,
    },
  });
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api/v1/me") return json(response, { authenticated: true, user: owner });
    if (url.pathname === "/api/v1/auth/logout") return json(response, { ok: true });
    if (url.pathname === "/api/v1/boards") return json(response, { boards: [{ id: "board-one", name: "Business" }], maxBoards: 5 });
    if (url.pathname === "/api/v1/boards/board-one") return json(response, { ...board(false), buckets: [] });
    if (url.pathname === "/api/v1/agents" && request.method === "GET") {
      return json(response, { agents: [detail().agent], activeAgents: archived ? 0 : 1, maxAgents: 5 });
    }
    if (url.pathname === "/api/v1/agents/agent-one" && request.method === "GET") {
      if (failDetailRefresh) {
        failDetailRefresh = false;
        response.writeHead(503, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({ error: "metadata refresh failed" }));
      }
      return json(response, detail());
    }
    if (url.pathname === "/api/v1/agents/agent-one" && request.method === "PATCH") {
      const input = await requestJSON(request);
      patches.push(input);
      agent.displayName = String(input.displayName).trim();
      agent.purpose = String(input.purpose).trim();
      return json(response, detail().agent);
    }
    if (url.pathname === "/api/v1/agents/agent-one/credential" && request.method === "DELETE") {
      const gate = revokeGate;
      revokeGate = null;
      if (gate) await gate.promise;
      connected = false;
      return json(response, { ok: true });
    }
    if (url.pathname === "/api/v1/agents/agent-one/credential/rotate" && request.method === "POST") {
      const input = await requestJSON(request);
      assert.ok(input.idempotencyKey.length >= 16);
      connected = true;
      if (loseRotationResponse) {
        loseRotationResponse = false;
        response.writeHead(503, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({ error: "rotation response lost" }));
      }
      failDetailRefresh = true;
      return json(response, {
        id: "credential-rotated",
        tokenPrefix: "slate_agent_rotated",
        token: "slate_agent_once_only_browser",
        alreadyApplied: false,
      });
    }
    if (url.pathname === "/api/v1/agents/agent-one/archive" && request.method === "POST") {
      const input = await requestJSON(request);
      archiveAttempts += 1;
      const gate = archiveGate;
      archiveGate = null;
      if (gate) await gate.promise;
      if (!input.unassignOpenWork) {
        response.writeHead(409, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({
          code: "agent_open_work",
          error: "Ready and Working work must be unassigned before this agent can be archived.",
          conflict: { ready: 2, working: 1 },
        }));
      }
      archived = true;
      connected = false;
      return json(response, { ok: true, ready: 2, working: 1 });
    }
    if (url.pathname === "/api/v1/agents/agent-one/restore" && request.method === "POST") {
      const gate = restoreGate;
      restoreGate = null;
      if (gate) await gate.promise;
      archived = false;
      connected = false;
      return json(response, detail().agent);
    }
    if (isAppShell(url.pathname)) return html(response);
    if (url.pathname === "/app.js") return file(response, "app.js", "text/javascript");
    if (url.pathname === "/styles.css") return file(response, "styles.css", "text/css");
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => closeTestServer(server));

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const assertPendingFocus = async () => {
    await page.getByRole("status").filter({ hasText: "Working… Keep this page open." }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.id), "agent-lifecycle-pending");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "agent-lifecycle-pending");
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 1);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "agent-lifecycle-pending");
  };
  await page.goto(`${baseURL}/app/agents/agent-one/settings`);
  await page.getByRole("tab", { name: "Settings", exact: true }).waitFor();
  assert.equal(await page.getByRole("tab", { name: "Settings", exact: true }).getAttribute("aria-selected"), "true");

  const name = page.locator("#agent-settings-name");
  await name.fill("  Builder Prime  ");
  await page.locator("#agent-settings-purpose").fill("  Focused delivery  ");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Agent identity saved." }).waitFor();
  assert.deepEqual(patches, [{ displayName: "Builder Prime", purpose: "Focused delivery" }]);

  await page.getByRole("button", { name: "Revoke credential", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "revoke-agent-credential");

  const slowRevoke = deferredResponse();
  revokeGate = slowRevoke;
  await page.getByRole("button", { name: "Revoke credential", exact: true }).click();
  await page.getByRole("dialog").getByText("assigned work stays assigned", { exact: false }).waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Revoke credential", exact: true }).click();
  await assertPendingFocus();
  slowRevoke.release();
  await page.getByRole("status").filter({ hasText: "Assigned work is unchanged." }).waitFor();
  await page.getByRole("heading", { name: "Needs connection", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "rotate-agent-credential");

  await page.getByRole("button", { name: "Create credential", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Create credential", exact: true }).click();
  await page.getByText("slate_agent_once_only_browser", { exact: true }).waitFor();
  await page.getByText(/metadata could not be refreshed/).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "copy-lifecycle-credential");
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await page.waitForURL(`${baseURL}/app/agents/agent-one`);
  assert.equal(await page.getByText("slate_agent_once_only_browser", { exact: true }).count(), 0);
  await page.goBack();
  await page.getByRole("tab", { name: "Settings", exact: true }).waitFor();
  assert.equal(await page.getByText("slate_agent_once_only_browser", { exact: true }).count(), 0);

  loseRotationResponse = true;
  await page.getByRole("button", { name: "Rotate credential", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Rotate credential", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "old credential may have been revoked" }).waitFor();
  assert.equal(await page.getByText("slate_agent_once_only_browser", { exact: true }).count(), 0);

  const slowArchiveCheck = deferredResponse();
  archiveGate = slowArchiveCheck;
  await page.getByRole("button", { name: "Archive agent", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archive agent", exact: true }).click();
  await assertPendingFocus();
  slowArchiveCheck.release();
  await page.getByRole("dialog").getByText("2 Ready items and 1 Working item", { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "confirm-agent-lifecycle");
  const slowForcedArchive = deferredResponse();
  archiveGate = slowForcedArchive;
  await page.getByRole("dialog").getByRole("button", { name: "Unassign open work and archive", exact: true }).click();
  await assertPendingFocus();
  slowForcedArchive.release();
  await page.getByText("Archived identity", { exact: true }).waitFor();
  assert.equal(archiveAttempts, 2);
  assert.equal(await page.getByRole("button", { name: "Assign work", exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "restore-agent");

  owner.theme = "dark";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator(".agents-shell.theme-dark").waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  const slowRestore = deferredResponse();
  restoreGate = slowRestore;
  await page.getByRole("button", { name: "Restore agent", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Restore agent", exact: true }).press("Enter");
  await assertPendingFocus();
  slowRestore.release();
  await page.getByRole("status").filter({ hasText: "Agent restored." }).waitFor();
  await page.getByRole("heading", { name: "Needs connection", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "rotate-agent-credential");

  await page.reload();
  await page.getByRole("tab", { name: "Settings", exact: true }).waitFor();
  assert.equal(await page.getByText("slate_agent_once_only_browser", { exact: true }).count(), 0);
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

// Mirrors the server's SPA fallback: every frontend route boots the same shell.
function isAppShell(pathname) {
	if (["/", "/index.html", "/login", "/app", "/app/settings", "/early-access", "/reset-password"].includes(pathname)) return true;
	if (pathname.startsWith("/app/settings/")) return true;
	if (pathname === "/app/agents" || pathname === "/app/agents/new") return true;
	if (pathname.startsWith("/app/agents/")) {
		const parts = pathname.slice("/app/agents/".length).split("/");
		return parts.length === 1 || (parts.length === 2 && (parts[1] === "work" || parts[1] === "settings"));
	}
	const rest = pathname.startsWith("/app/boards/") ? pathname.slice("/app/boards/".length) : "";
	const segments = rest.split("/");
	return Boolean(rest) && (segments.length === 1 || (segments.length === 2 && segments[1] === "settings"));
}

function html(response) {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><main id="app"></main><script type="module" src="/app.js"></script></body></html>');
}
