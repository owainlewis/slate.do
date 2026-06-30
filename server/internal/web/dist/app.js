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
  error: "",
  newToken: "",
  tokens: [],
};

const backgrounds = [
  { id: "plain", kind: "plain", value: "" },
  { id: "green", kind: "gradient", value: "green" },
  { id: "blue", kind: "gradient", value: "blue" },
  { id: "charcoal", kind: "gradient", value: "charcoal" },
];

async function boot() {
  try {
    const me = await api.get("/api/v1/me");
    state.me = me.authenticated ? me.user : null;
    if (state.me) await loadBoards();
  } catch (err) {
    state.error = err.message;
  }
  render();
}

async function loadBoards(selectId) {
  const data = await api.get("/api/v1/boards");
  state.boards = data.boards;
  const nextId = selectId || state.board?.id || state.boards[0]?.id;
  if (nextId) await loadBoard(nextId);
}

async function loadBoard(id) {
  state.board = await api.get(`/api/v1/boards/${id}`);
  state.selectedTask = state.selectedTask ? findTask(state.selectedTask.id) : null;
}

function render() {
  const root = document.querySelector("#app");
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
        <h1>Slate</h1>
        <p>Owner sign in.</p>
        <input name="email" type="email" autocomplete="email" placeholder="Email" required>
        <input name="password" type="password" autocomplete="current-password" placeholder="Password" required>
        <button class="primary" type="submit">Sign in</button>
        <p class="error">${escapeHTML(state.error)}</p>
      </form>
    </section>`;
}

function appHTML() {
  const board = state.board;
  const bg = board?.backgroundValue || "plain";
  return `
    <section class="shell">
      <aside class="sidebar">
        <div class="brand">slate<span>.do</span></div>
        <section class="nav-sec">
          <h3>Boards</h3>
          ${state.boards.map(b => `<button class="page-row ${b.id === board?.id ? "on" : ""}" data-board="${b.id}">${escapeHTML(b.name)}</button>`).join("")}
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
          <h3>Background</h3>
          <div class="swatches">
            ${backgrounds.map(item => `<button class="swatch ${bg === item.id ? "on" : ""}" data-bg="${item.id}"></button>`).join("")}
          </div>
        </section>
        <section class="nav-sec">
          <button class="plain-btn" id="settings">Settings and API tokens</button>
          <button class="plain-btn" id="logout">Sign out</button>
        </section>
      </aside>
      <div class="main ${escapeAttr(bg)}">
        <header class="topbar">
          <input class="title-input" id="board-title" value="${escapeAttr(board?.name || "")}">
          <span class="week">${new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</span>
          <div class="top-actions">
            <button class="icon-btn" id="add-bucket">+ Bucket</button>
          </div>
        </header>
        <div class="grid" style="grid-template-columns: repeat(${board?.layoutSize === 3 ? 3 : 3}, minmax(0, 1fr));">
          ${(board?.buckets || []).slice(0, board?.layoutSize || 6).map(bucketHTML).join("")}
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

function bucketHTML(bucket) {
  const over = bucket.openCount > bucket.limitCount ? "over-limit" : "";
  return `
    <section class="bucket ${over}" data-bucket="${bucket.id}">
      <div class="bucket-head">
        <span class="count">${bucket.openCount}/${bucket.limitCount}</span>
        <input data-bucket-name="${bucket.id}" value="${escapeAttr(bucket.name)}">
        <div class="bucket-menu">
          <input data-bucket-limit="${bucket.id}" type="number" min="1" value="${bucket.limitCount}" title="Bucket limit">
          <button class="icon-btn" data-delete-bucket="${bucket.id}">×</button>
        </div>
      </div>
      <ul class="tasks" data-task-list="${bucket.id}">
        ${(bucket.tasks || []).map(taskHTML).join("")}
      </ul>
      <form class="add-task" data-add-task="${bucket.id}">
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
        <div class="field"><label>Bucket</label><select name="bucketId">
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
  return `
    <section class="login">
      <div class="settings">
        <h2>Settings</h2>
        <p>API tokens are shown once when created. Use them with the CLI or agent routes.</p>
        <form id="token-form">
          <input name="name" placeholder="Token name" required>
          <button class="primary" type="submit">Create token</button>
        </form>
        ${state.newToken ? `<p><code>${escapeHTML(state.newToken)}</code></p>` : ""}
        <div>${state.tokens.map(t => `<div class="token-row"><span>${escapeHTML(t.name)}</span><button class="danger" data-revoke="${t.id}">Revoke</button></div>`).join("")}</div>
        <button class="plain-btn" id="back">Back to board</button>
      </div>
    </section>`;
}

function bindLogin() {
  document.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api.post("/api/v1/auth/login", { email: form.get("email"), password: form.get("password") });
      state.error = "";
      const me = await api.get("/api/v1/me");
      state.me = me.user;
      await loadBoards();
    } catch (err) {
      state.error = err.message;
    }
    render();
  });
}

function bindApp() {
  document.querySelectorAll("[data-board]").forEach(el => el.onclick = async () => { await loadBoard(el.dataset.board); render(); });
  document.querySelector("#settings").onclick = async () => { state.settings = true; await loadTokens(); render(); };
  document.querySelector("#logout").onclick = async () => { await api.post("/api/v1/auth/logout"); state.me = null; render(); };
  document.querySelector("#new-board").onclick = async () => {
    const board = await api.post("/api/v1/boards", { name: "Untitled board", layoutSize: 6 });
    await api.post(`/api/v1/boards/${board.id}/buckets`, { name: "Inbox", limitCount: 5, isInbox: true });
    await api.post(`/api/v1/boards/${board.id}/buckets`, { name: "Focus", limitCount: 3 });
    await loadBoards(board.id); render();
  };
  document.querySelector("#add-bucket").onclick = async () => { await api.post(`/api/v1/boards/${state.board.id}/buckets`, { name: "New bucket", limitCount: 5 }); await reload(); };
  document.querySelector("#board-title").addEventListener("change", async e => { await api.patch(`/api/v1/boards/${state.board.id}`, { name: e.target.value }); await reload(); });
  document.querySelectorAll("[data-layout]").forEach(el => el.onclick = async () => { await api.patch(`/api/v1/boards/${state.board.id}`, { layoutSize: Number(el.dataset.layout) }); await reload(); });
  document.querySelectorAll("[data-bg]").forEach(el => el.onclick = async () => { const bg = backgrounds.find(b => b.id === el.dataset.bg); await api.patch(`/api/v1/boards/${state.board.id}`, { backgroundKind: bg.kind, backgroundValue: bg.id }); await reload(); });
  document.querySelectorAll("[data-bucket-name]").forEach(el => el.addEventListener("change", async e => { await api.patch(`/api/v1/buckets/${el.dataset.bucketName}`, { name: e.target.value }); await reload(); }));
  document.querySelectorAll("[data-bucket-limit]").forEach(el => el.addEventListener("change", async e => { await api.patch(`/api/v1/buckets/${el.dataset.bucketLimit}`, { limitCount: Number(e.target.value) }); await reload(); }));
  document.querySelectorAll("[data-delete-bucket]").forEach(el => el.onclick = async () => { if (confirm("Delete this bucket and its tasks?")) { await api.del(`/api/v1/buckets/${el.dataset.deleteBucket}`); await reload(); } });
  document.querySelectorAll("[data-add-task]").forEach(form => form.addEventListener("submit", addTask));
  document.querySelectorAll("[data-open-task]").forEach(el => el.onclick = () => { state.selectedTask = findTask(el.dataset.openTask); render(); });
  document.querySelectorAll("[data-toggle-done]").forEach(el => el.onclick = async e => { e.stopPropagation(); const task = findTask(el.dataset.toggleDone); await api.patch(`/api/v1/tasks/${task.id}`, { done: !task.done }); await reload(); });
  bindDrag();
  bindDetail();
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
  document.querySelector("#back").onclick = () => { state.settings = false; state.newToken = ""; render(); };
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

async function addTask(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const title = new FormData(form).get("title").trim();
  if (!title) return;
  const bucket = state.board.buckets.find(b => b.id === form.dataset.addTask);
  const body = { title };
  try {
    await api.post(`/api/v1/buckets/${bucket.id}/tasks`, body);
  } catch (err) {
    if (err.message.includes("limit") && confirm("This bucket is full. Add anyway?")) {
      await api.post(`/api/v1/buckets/${bucket.id}/tasks`, { ...body, overrideLimit: true });
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
  for (const bucket of state.board?.buckets || []) {
    const task = (bucket.tasks || []).find(t => t.id === id);
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

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function escapeAttr(value) {
  return escapeHTML(value);
}

boot();
