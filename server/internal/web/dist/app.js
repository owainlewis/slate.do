const api = {
  async request(path, options = {}) {
    const res = await fetch(path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  },
  get(path) { return this.request(path); },
  post(path, body) { return this.request(path, { method: "POST", body: JSON.stringify(body || {}) }); },
  patch(path, body) { return this.request(path, { method: "PATCH", body: JSON.stringify(body || {}) }); },
  del(path) { return this.request(path, { method: "DELETE" }); },
};

const state = {
  me: null,
  boards: [],
  board: null,
  selectedTask: null,
  settings: false,
  view: "home",
  error: "",
  newToken: "",
  tokens: [],
};

const themes = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

async function boot() {
  try {
    const me = await api.get("/api/v1/me");
    state.me = me.authenticated ? me.user : null;
    if (state.me) await loadBoards();
    if (location.hash === "#settings" && state.me) await openSettings(false);
  } catch (err) {
    state.error = err.message;
  }
  render();
}

async function loadBoards(selectId) {
  const data = await api.get("/api/v1/boards");
  state.boards = data.boards;
  const nextId = selectId || state.board?.id || state.boards[0]?.id;
  if (nextId) {
    await loadBoard(nextId);
  } else {
    state.board = null;
  }
}

async function loadBoard(id) {
  state.board = await api.get(`/api/v1/boards/${id}`);
  const staleNames = (state.board.buckets || []).filter(list => list.name === "New bucket");
  if (staleNames.length) {
    await Promise.all(staleNames.map(list => api.patch(`/api/v1/buckets/${list.id}`, { name: "New list" })));
    state.board = await api.get(`/api/v1/boards/${id}`);
  }
  state.selectedTask = state.selectedTask ? findTask(state.selectedTask.id) : null;
}

function render() {
  const root = document.querySelector("#app");
  if (state.view === "home") {
    root.innerHTML = landingHTML();
    bindLanding();
    return;
  }
  if (!state.me) {
    root.innerHTML = loginHTML();
    bindLogin();
    return;
  }
  if (state.settings) {
    root.innerHTML = settingsHTML();
    bindSettings();
    return;
  }
  root.innerHTML = appHTML();
  bindApp();
}

function loginHTML() {
  return `
    <section class="login">
      <form id="login-form">
        <button class="brand brand-button" type="button" data-home>slate<span>.do</span></button>
        <h1>Sign in</h1>
        <p>Owner sign in.</p>
        <input name="email" type="email" autocomplete="email" placeholder="Email" required>
        <input name="password" type="password" autocomplete="current-password" placeholder="Password" required>
        <button class="primary" type="submit">Sign in</button>
        <p class="error">${escapeHTML(state.error)}</p>
      </form>
    </section>`;
}

function landingHTML() {
  const signedIn = Boolean(state.me);
  return `
    <section class="landing">
      <nav class="landing-nav">
        <button class="brand brand-button" type="button" data-home>slate<span>.do</span></button>
        <div>
          ${signedIn ? `<button class="plain-btn nav-action" id="landing-open">Open app</button>` : `<button class="plain-btn nav-action" id="landing-login">Log in</button>`}
        </div>
      </nav>
      <main class="landing-main">
        <section class="landing-copy">
          <p>Private beta</p>
          <h1>Slate</h1>
          <h2>A calm board for choosing what gets attention.</h2>
          <div class="landing-actions">
            ${signedIn ? `<button class="primary" id="open-app">Open app</button>` : `<button class="primary" id="hero-login">Log in</button>`}
            <a class="secondary-link" href="mailto:owain@gradientwork.com?subject=Slate access">Request access</a>
          </div>
        </section>
        <section class="landing-preview" aria-label="Slate preview">
          <div>
            <span>0/3</span>
            <b>Focus</b>
          </div>
          <p>Draft launch note</p>
          <p>Review agent work</p>
          <p>Ship one small thing</p>
        </section>
      </main>
    </section>`;
}

function appHTML() {
  const board = state.board;
  const theme = themeFor(board?.backgroundValue);
  const lists = board?.buckets || [];
  return `
    <section class="shell theme-${theme}">
      <aside class="sidebar">
        <button class="brand brand-button" type="button" data-home>slate<span>.do</span></button>
        <section class="nav-sec">
          <h3>Boards</h3>
          <div class="pages">
            ${state.boards.map(boardRowHTML).join("")}
          </div>
          <button class="plain-btn" id="new-board">+ New board</button>
        </section>
        <section class="nav-sec">
          <h3>Layout</h3>
          <div class="seg">
            <button data-layout="3" class="${board?.layoutSize === 3 ? "on" : ""}">3</button>
            <button data-layout="6" class="${board?.layoutSize !== 3 ? "on" : ""}">6</button>
          </div>
        </section>
        <section class="nav-sec">
          <h3>Theme</h3>
          <div class="seg">
            ${themes.map(item => `<button data-theme="${item.id}" class="${theme === item.id ? "on" : ""}">${item.label}</button>`).join("")}
          </div>
        </section>
        <section class="nav-sec">
          <button class="plain-btn" id="settings">Settings and API tokens</button>
          <button class="plain-btn" id="logout">Sign out</button>
        </section>
      </aside>
      <div class="main">
        <header class="topbar">
          <input class="title-input" id="board-title" value="${escapeAttr(board?.name || "")}">
          <span class="week">${new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</span>
          <div class="top-actions">
            <button class="icon-btn" id="add-list">+ List</button>
          </div>
        </header>
        <div class="grid ${board?.layoutSize === 3 ? "compact" : ""}">
          ${lists.map(listHTML).join("")}
        </div>
        <footer class="footer">
          <span>${openTaskCount(board)} open</span>
          <span>${focusCount(board)} focus</span>
          <span>Owner-only MVP</span>
        </footer>
      </div>
      ${state.selectedTask ? detailHTML(state.selectedTask) : ""}
    </section>`;
}

function boardRowHTML(board) {
  const current = board.id === state.board?.id;
  return `
    <div class="board-row ${current ? "on" : ""}">
      <button class="board-select" data-board="${board.id}">${escapeHTML(board.name)}</button>
      <button class="board-delete" data-delete-board="${board.id}" title="Delete board">×</button>
    </div>`;
}

function listHTML(list) {
  const over = list.openCount > list.limitCount ? "over-limit" : "";
  return `
    <section class="bucket ${over}" data-bucket="${list.id}">
      <div class="bucket-head">
        <span class="count">${list.openCount}/${list.limitCount}</span>
        <input data-bucket-name="${list.id}" value="${escapeAttr(list.name)}">
        <div class="bucket-menu">
          <input data-bucket-limit="${list.id}" type="number" min="1" value="${list.limitCount}" title="List limit">
          <button class="icon-btn" data-delete-bucket="${list.id}" title="Delete list">×</button>
        </div>
      </div>
      <ul class="tasks" data-task-list="${list.id}">
        ${(list.tasks || []).map(taskHTML).join("")}
      </ul>
      <form class="add-task" data-add-task="${list.id}">
        <span class="check"></span>
        <input name="title" placeholder="Add task">
      </form>
    </section>`;
}

function taskHTML(task) {
  return `
    <li class="task ${task.done ? "done" : ""} ${task.focus ? "focus" : ""}" draggable="true" data-task="${task.id}">
      <button class="check" data-toggle-done="${task.id}" title="Done"></button>
      <div class="task-body" data-open-task="${task.id}">
        <div class="task-title">${escapeHTML(task.title)}</div>
        <div class="meta">
          ${task.dueDate ? `<span>${escapeHTML(task.dueDate)}</span>` : ""}
          ${task.assignee ? `<span>${escapeHTML(task.assignee)}</span>` : ""}
          ${task.status && task.status !== "queued" ? `<span>${escapeHTML(task.status)}</span>` : ""}
        </div>
      </div>
    </li>`;
}

function detailHTML(task) {
  return `
    <aside class="detail">
      <div class="detail-head"><b>Task detail</b><button id="close-detail">×</button></div>
      <form class="detail-body" id="detail-form">
        <div class="field"><label>Title</label><textarea name="title">${escapeHTML(task.title)}</textarea></div>
        <div class="toggles">
          <label><input name="done" type="checkbox" ${task.done ? "checked" : ""}> Done</label>
          <label><input name="focus" type="checkbox" ${task.focus ? "checked" : ""}> Focus</label>
        </div>
        <div class="field"><label>List</label><select name="bucketId">
          ${state.board.buckets.map(b => `<option value="${b.id}" ${b.id === task.bucketId ? "selected" : ""}>${escapeHTML(b.name)}</option>`).join("")}
        </select></div>
        <div class="field"><label>Due date</label><input name="dueDate" type="date" value="${escapeAttr(task.dueDate || "")}"></div>
        <div class="field"><label>Assignee</label><input name="assignee" value="${escapeAttr(task.assignee || "")}" placeholder="coder, analyst, Owain"></div>
        <div class="field"><label>Status</label><select name="status">
          ${["queued", "working", "needs_review", "done"].map(s => `<option ${task.status === s ? "selected" : ""}>${s}</option>`).join("")}
        </select></div>
        <div class="field"><label>Notes</label><textarea name="notes">${escapeHTML(task.notes || "")}</textarea></div>
        <div class="field"><label>Agent brief</label><textarea name="agentBrief">${escapeHTML(task.agentBrief || "")}</textarea></div>
        <button class="primary" type="submit">Save</button>
        <button class="danger" type="button" id="delete-task">Delete</button>
      </form>
    </aside>`;
}

function settingsHTML() {
  const theme = themeFor(state.board?.backgroundValue);
  return `
    <section class="settings-page theme-${theme}">
      <aside class="sidebar">
        <button class="brand brand-button" type="button" data-home>slate<span>.do</span></button>
        <section class="nav-sec">
          <button class="page-row on" id="back">Board</button>
          <button class="plain-btn" id="settings-logout">Sign out</button>
        </section>
      </aside>
      <main class="settings-main">
        <section class="settings-panel">
          <div class="settings-head">
            <div>
              <p>Owner settings</p>
              <h1>API tokens</h1>
            </div>
            <button class="icon-btn" id="settings-back">Back</button>
          </div>
          <form id="token-form" class="token-form">
            <input name="name" placeholder="Token name" required>
            <button class="primary" type="submit">Create token</button>
          </form>
          ${state.newToken ? `<div class="new-token"><label>New token</label><code>${escapeHTML(state.newToken)}</code></div>` : ""}
          <div class="token-list">
            ${state.tokens.length ? state.tokens.map(t => `<div class="token-row"><span>${escapeHTML(t.name)}</span><button class="danger" data-revoke="${t.id}">Revoke</button></div>`).join("") : `<p>No active tokens.</p>`}
          </div>
        </section>
      </main>
    </section>`;
}

function bindLogin() {
  document.querySelectorAll("[data-home]").forEach(el => el.onclick = goHome);
  document.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api.post("/api/v1/auth/login", { email: form.get("email"), password: form.get("password") });
      state.error = "";
      const me = await api.get("/api/v1/me");
      state.me = me.user;
      await loadBoards();
      state.view = "app";
    } catch (err) {
      state.error = err.message;
    }
    render();
  });
}

function bindLanding() {
  document.querySelectorAll("[data-home]").forEach(el => el.onclick = goHome);
  document.querySelector("#landing-login")?.addEventListener("click", showLogin);
  document.querySelector("#hero-login")?.addEventListener("click", showLogin);
  document.querySelector("#landing-open")?.addEventListener("click", openApp);
  document.querySelector("#open-app")?.addEventListener("click", openApp);
}

function bindApp() {
  document.querySelectorAll("[data-home]").forEach(el => el.onclick = goHome);
  document.querySelectorAll("[data-board]").forEach(el => el.onclick = async () => { await loadBoard(el.dataset.board); render(); });
  document.querySelectorAll("[data-delete-board]").forEach(el => el.onclick = async () => deleteBoard(el.dataset.deleteBoard));
  document.querySelector("#settings").onclick = async () => { await openSettings(true); };
  document.querySelector("#logout").onclick = async () => { await api.post("/api/v1/auth/logout"); state.me = null; state.view = "home"; render(); };
  document.querySelector("#new-board").onclick = async () => {
    const board = await api.post("/api/v1/boards", { name: "Untitled board", layoutSize: 6, backgroundKind: "theme", backgroundValue: themeFor(state.board?.backgroundValue) });
    await api.post(`/api/v1/boards/${board.id}/buckets`, { name: "Inbox", limitCount: 5, isInbox: true });
    await api.post(`/api/v1/boards/${board.id}/buckets`, { name: "Focus", limitCount: 3 });
    await loadBoards(board.id);
    render();
  };
  document.querySelector("#add-list").onclick = async () => {
    const list = await api.post(`/api/v1/boards/${state.board.id}/buckets`, { name: "New list", limitCount: 5 });
    await loadBoards(state.board.id);
    render();
    document.querySelector(`[data-bucket="${list.id}"] input[data-bucket-name]`)?.focus();
  };
  document.querySelector("#board-title").addEventListener("change", async e => { await api.patch(`/api/v1/boards/${state.board.id}`, { name: e.target.value }); await reload(); });
  document.querySelectorAll("[data-layout]").forEach(el => el.onclick = async () => { await api.patch(`/api/v1/boards/${state.board.id}`, { layoutSize: Number(el.dataset.layout) }); await reload(); });
  document.querySelectorAll("[data-theme]").forEach(el => el.onclick = async () => { await api.patch(`/api/v1/boards/${state.board.id}`, { backgroundKind: "theme", backgroundValue: el.dataset.theme }); await reload(); });
  document.querySelectorAll("[data-bucket-name]").forEach(el => el.addEventListener("change", async e => { await api.patch(`/api/v1/buckets/${el.dataset.bucketName}`, { name: e.target.value }); await reload(); }));
  document.querySelectorAll("[data-bucket-limit]").forEach(el => el.addEventListener("change", async e => { await api.patch(`/api/v1/buckets/${el.dataset.bucketLimit}`, { limitCount: Number(e.target.value) }); await reload(); }));
  document.querySelectorAll("[data-delete-bucket]").forEach(el => el.onclick = async () => { if (confirm("Delete this list and its tasks?")) { await api.del(`/api/v1/buckets/${el.dataset.deleteBucket}`); await reload(); } });
  document.querySelectorAll("[data-add-task]").forEach(form => form.addEventListener("submit", addTask));
  document.querySelectorAll("[data-open-task]").forEach(el => el.onclick = () => { state.selectedTask = findTask(el.dataset.openTask); render(); });
  document.querySelectorAll("[data-toggle-done]").forEach(el => el.onclick = async e => { e.stopPropagation(); const task = findTask(el.dataset.toggleDone); await api.patch(`/api/v1/tasks/${task.id}`, { done: !task.done }); await reload(); });
  bindDrag();
  bindDetail();
}

async function deleteBoard(id) {
  const board = state.boards.find(item => item.id === id);
  if (!board || !confirm(`Delete "${board.name}" and all its lists and tasks?`)) return;
  await api.del(`/api/v1/boards/${id}`);
  state.selectedTask = null;
  state.board = null;
  await loadBoards();
  if (!state.board) {
    const next = await api.post("/api/v1/boards", { name: "Today", layoutSize: 6, backgroundKind: "theme", backgroundValue: "light" });
    await api.post(`/api/v1/boards/${next.id}/buckets`, { name: "Inbox", limitCount: 5, isInbox: true });
    await api.post(`/api/v1/boards/${next.id}/buckets`, { name: "Focus", limitCount: 3 });
    await loadBoards(next.id);
  }
  render();
}

function bindDetail() {
  if (!state.selectedTask) return;
  document.querySelector("#close-detail").onclick = () => { state.selectedTask = null; render(); };
  document.querySelector("#delete-task").onclick = async () => { await api.del(`/api/v1/tasks/${state.selectedTask.id}`); state.selectedTask = null; await reload(); };
  document.querySelector("#detail-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api.patch(`/api/v1/tasks/${state.selectedTask.id}`, {
      title: form.get("title"),
      done: form.get("done") === "on",
      focus: form.get("focus") === "on",
      bucketId: form.get("bucketId"),
      dueDate: form.get("dueDate"),
      assignee: form.get("assignee"),
      status: form.get("status"),
      notes: form.get("notes"),
      agentBrief: form.get("agentBrief"),
    });
    await reload();
  });
}

async function bindSettings() {
  document.querySelectorAll("[data-home]").forEach(el => el.onclick = goHome);
  document.querySelector("#back").onclick = closeSettings;
  document.querySelector("#settings-back").onclick = closeSettings;
  document.querySelector("#settings-logout").onclick = async () => { await api.post("/api/v1/auth/logout"); state.me = null; state.settings = false; state.view = "home"; render(); };
  document.querySelector("#token-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data = await api.post("/api/v1/api-tokens", { name: form.get("name") });
    state.newToken = data.token;
    await loadTokens();
    render();
  });
  document.querySelectorAll("[data-revoke]").forEach(el => el.onclick = async () => { await api.del(`/api/v1/api-tokens/${el.dataset.revoke}`); await loadTokens(); render(); });
}

async function openSettings(pushHistory) {
  state.settings = true;
  state.view = "app";
  await loadTokens();
  if (pushHistory && location.hash !== "#settings") history.pushState({ settings: true }, "", "#settings");
  render();
}

function closeSettings() {
  state.settings = false;
  state.newToken = "";
  state.view = "app";
  if (location.hash === "#settings") history.replaceState({}, "", location.pathname);
  render();
}

function showLogin() {
  state.view = "login";
  state.error = "";
  render();
}

function openApp() {
  if (!state.me) {
    showLogin();
    return;
  }
  state.view = "app";
  state.settings = false;
  render();
}

function goHome() {
  state.view = "home";
  state.settings = false;
  state.selectedTask = null;
  if (location.hash) history.replaceState({}, "", location.pathname);
  render();
}

async function addTask(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const title = new FormData(form).get("title").trim();
  if (!title) return;
  const list = state.board.buckets.find(b => b.id === form.dataset.addTask);
  const body = { title };
  try {
    await api.post(`/api/v1/buckets/${list.id}/tasks`, body);
  } catch (err) {
    if (err.message.includes("limit") && confirm("This list is full. Add anyway?")) {
      await api.post(`/api/v1/buckets/${list.id}/tasks`, { ...body, overrideLimit: true });
    } else {
      throw err;
    }
  }
  await reload();
}

function bindDrag() {
  document.querySelectorAll("[data-task]").forEach(el => {
    el.addEventListener("dragstart", event => event.dataTransfer.setData("text/task-id", el.dataset.task));
  });
  document.querySelectorAll("[data-task-list]").forEach(list => {
    list.addEventListener("dragover", event => event.preventDefault());
    list.addEventListener("drop", async event => {
      event.preventDefault();
      const id = event.dataTransfer.getData("text/task-id");
      if (!id) return;
      await api.patch(`/api/v1/tasks/${id}`, { bucketId: list.dataset.taskList });
      await reload();
    });
  });
}

async function loadTokens() {
  const data = await api.get("/api/v1/api-tokens");
  state.tokens = data.tokens;
}

async function reload() {
  await loadBoards(state.board.id);
  render();
}

function findTask(id) {
  for (const list of state.board?.buckets || []) {
    const task = (list.tasks || []).find(t => t.id === id);
    if (task) return task;
  }
  return null;
}

function openTaskCount(board) {
  return (board?.buckets || []).reduce((sum, b) => sum + b.openCount, 0);
}

function focusCount(board) {
  return (board?.buckets || []).flatMap(b => b.tasks || []).filter(t => t.focus && !t.done).length;
}

function themeFor(value) {
  if (value === "charcoal" || value === "dark") return "dark";
  return "light";
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function escapeAttr(value) {
  return escapeHTML(value);
}

window.addEventListener("popstate", async () => {
  if (location.hash === "#settings") {
    await openSettings(false);
    return;
  }
  if (state.settings) {
    state.settings = false;
    state.newToken = "";
    state.view = "app";
    render();
  }
});

boot();
