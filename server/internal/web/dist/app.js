const ICON_PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4.6C9 3.7 9.7 3 10.6 3h2.8c.9 0 1.6.7 1.6 1.6V7"/><path d="M18.4 7l-.8 12.4a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9L5.6 7"/><path d="M10 11v6M14 11v6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
};

function icon(name, cls = "") {
  const paths = ICON_PATHS[name] || "";
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

const api = {
  async request(path, options = {}) {
    const res = await fetch(path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    const text = await res.text();
    const data = decodeResponseBody(text, res.ok);
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  },
  get(path) { return this.request(path); },
  post(path, body) { return this.request(path, { method: "POST", body: JSON.stringify(body || {}) }); },
  patch(path, body) { return this.request(path, { method: "PATCH", body: JSON.stringify(body || {}) }); },
  del(path) { return this.request(path, { method: "DELETE" }); },
};

function decodeResponseBody(text, ok) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    if (!ok) throw new Error(text.trim() || "Request failed");
    throw new Error("Invalid server response");
  }
}

const goalSaveChains = new Map();

const state = {
  me: null,
  boards: [],
  board: null,
  selectedTask: null,
  settings: false,
  view: "home",
  error: "",
  goalErrors: {},
  newToken: "",
  tokens: [],
  boardMode: "lists",
  weekStart: "",
};

const themes = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const DEFAULT_LIST_LIMIT = 20;
const FLOW_STATES = [
  { value: "queued", label: "Ready" },
  { value: "working", label: "Working" },
  { value: "needs_review", label: "Review" },
  { value: "done", label: "Done" },
];

async function boot() {
  try {
    const me = await api.get("/api/v1/me");
    state.me = me.authenticated ? me.user : null;
    if (state.me) {
      await loadBoards();
      state.view = "app";
    }
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
        <h1>Welcome back.</h1>
        <p>Sign in to your slate.</p>
        <label class="login-label" for="login-email">Email</label>
        <input id="login-email" name="email" type="email" autocomplete="email" required>
        <label class="login-label" for="login-password">Password</label>
        <input id="login-password" name="password" type="password" autocomplete="current-password" required>
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
        ${signedIn ? `<button class="nav-action" id="landing-open">Open app</button>` : `<button class="nav-action" id="landing-login">Log in</button>`}
      </nav>
      <main class="landing-main">
        <section class="landing-hero">
          <p class="landing-eyebrow">Private beta</p>
          <h1>Decide what deserves attention.</h1>
          <p class="landing-lede">Slate is a calm operating plan for one person running many streams of work, human and agent alike. A few lists, a hard limit on open actions, and one honest view of today.</p>
          <div class="landing-actions">
            ${signedIn ? `<button class="primary" id="open-app">Open app</button>` : `<button class="primary" id="hero-login">Log in</button>`}
            <a class="secondary-link" href="mailto:owain@gradientwork.com?subject=Slate access">Request access</a>
          </div>
        </section>
        <section class="landing-board" aria-label="Slate preview">
          <div class="preview-list">
            <header><span class="preview-name">Inbox</span><span class="preview-count">2/20</span></header>
            <div class="preview-task"><span class="preview-check"></span>Pricing feedback from Anna</div>
            <div class="preview-task"><span class="preview-check"></span>Reply to the beta list</div>
            <div class="preview-add">Add item</div>
          </div>
          <div class="preview-list preview-focus">
            <header><span class="preview-name">Focus</span><span class="preview-count">2/5</span></header>
            <div class="preview-task preview-done"><span class="preview-check checked">${icon("check")}</span>Draft launch note</div>
            <div class="preview-task"><span class="preview-check"></span>Review agent pull requests</div>
            <div class="preview-task"><span class="preview-check"></span>Ship one small thing</div>
            <div class="preview-add">Add item</div>
          </div>
          <div class="preview-list">
            <header><span class="preview-name">Agent work</span><span class="preview-count">1/20</span></header>
            <div class="preview-task"><span class="preview-check"></span>Research pricing pages<span class="preview-status">working</span></div>
            <div class="preview-add">Add item</div>
          </div>
        </section>
        <section class="landing-principles">
          <div>
            <h3>Limits, not lists</h3>
            <p>Every list caps its open actions. When a list is full, something has to finish before anything new begins.</p>
          </div>
          <div>
            <h3>Clear state, less noise</h3>
            <p>Every item is completable and moves through the same small set of states, so open work stays honest.</p>
          </div>
          <div>
            <h3>Agents welcome</h3>
            <p>Agents pull, claim, and finish work through the same plan you read. You keep the judgment. They keep the pace.</p>
          </div>
        </section>
      </main>
      <footer class="landing-footer">
        <span>slate.do</span>
        <a href="mailto:owain@gradientwork.com?subject=Slate access">Request access</a>
      </footer>
    </section>`;
}

function appHTML() {
  const board = state.board;
  const theme = themeFor(board?.backgroundValue);
  const lists = board?.buckets || [];
  const listsMode = state.boardMode === "lists";
  const flowMode = state.boardMode === "flow";
  const calendarMode = state.boardMode === "calendar";
  const todayMode = state.boardMode === "today";
  return `
    <section class="shell theme-${theme}">
      <aside class="sidebar">
        <div class="sidebar-head">
          <button class="brand brand-button" type="button" data-home>slate<span>.do</span></button>
          <button class="icon-btn sidebar-toggle" id="sidebar-toggle" type="button" aria-label="Open navigation" aria-controls="sidebar-content" aria-expanded="false">${icon("menu")}</button>
        </div>
        <div class="sidebar-content" id="sidebar-content">
          <section class="nav-sec">
            <h3>Boards</h3>
            <div class="pages">
              ${state.boards.map(boardRowHTML).join("")}
            </div>
            <button class="plain-btn icon-label" id="new-board">${icon("plus")}<span>New board</span></button>
          </section>
          <section class="nav-sec nav-sec-footer">
            <button class="plain-btn" id="settings">Settings</button>
            <button class="plain-btn" id="logout">Sign out</button>
          </section>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <input class="title-input" id="board-title" aria-label="Board name" value="${escapeAttr(board?.name || "")}">
          <span class="week">${calendarMode ? weekLabel() : new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</span>
          <div class="top-actions">
            <div class="view-switch" aria-label="Board view">
              <button data-board-mode="lists" aria-pressed="${listsMode}" class="${listsMode ? "on" : ""}">Lists</button>
              <button data-board-mode="flow" aria-pressed="${flowMode}" class="${flowMode ? "on" : ""}">Flow</button>
              <button data-board-mode="calendar" aria-pressed="${calendarMode}" class="${calendarMode ? "on" : ""}">Week</button>
              <button data-board-mode="today" aria-pressed="${todayMode}" class="${todayMode ? "on" : ""}">Today</button>
            </div>
            <details class="board-settings">
              <summary title="Board options" aria-label="Board options">Options</summary>
              <div class="board-settings-menu">
                <section>
                  <h3>Open actions per list</h3>
                  <div class="limit-control">
                    <input id="list-limit" aria-label="Open actions per list" type="number" min="1" value="${board?.maxTasksPerList || DEFAULT_LIST_LIMIT}">
                  </div>
                </section>
              </div>
            </details>
            <button class="icon-btn icon-label ${listsMode ? "" : "add-list-placeholder"}" id="add-list" ${listsMode ? "" : 'aria-hidden="true" tabindex="-1" disabled'}>${icon("plus")}<span>New list</span></button>
          </div>
        </header>
        ${statusErrorHTML(state.error)}
        ${flowMode ? flowHTML(board) : calendarMode ? calendarHTML(board) : todayMode ? todayHTML(board) : `<div class="grid">${lists.map(listHTML).join("")}</div>`}
        ${footerHTML(board, todayMode)}
      </div>
      ${state.selectedTask ? detailHTML(state.selectedTask) : ""}
    </section>`;
}

function boardRowHTML(board) {
  const current = board.id === state.board?.id;
  return `
    <div class="board-row ${current ? "on" : ""}">
      <button class="board-select" data-board="${board.id}"><span>${escapeHTML(board.name)}</span></button>
      <button class="board-delete" data-delete-board="${board.id}" title="Delete board">${icon("trash")}</button>
    </div>`;
}

function listHTML(list) {
  const over = list.openCount > list.limitCount ? "over-limit" : "";
  const tasks = list.tasks || [];
  return `
    <section class="bucket ${over}" data-bucket="${list.id}" draggable="true">
      <div class="bucket-head">
        <input data-bucket-name="${list.id}" aria-label="List name" value="${escapeAttr(list.name)}">
        <span class="count" title="Open items / limit">${list.openCount}/${list.limitCount}</span>
        <div class="bucket-menu">
          <button class="icon-btn" data-delete-bucket="${list.id}" title="Delete list">${icon("trash")}</button>
        </div>
      </div>
      <input class="bucket-goal" data-bucket-goal="${list.id}" value="${escapeAttr(list.goal || "")}" placeholder="Add a goal" aria-label="Goal for ${escapeAttr(list.name)}">
      ${state.goalErrors[list.id] ? `<p class="error bucket-goal-error">${escapeHTML(state.goalErrors[list.id])}</p>` : ""}
      <ul class="tasks ${tasks.length ? "" : "empty"}" data-task-list="${list.id}">
        ${tasks.length ? tasks.map(taskHTML).join("") : `<li class="empty-state"><p>Nothing here yet</p></li>`}
      </ul>
      <form class="add-task" data-add-task="${list.id}">
        <button class="add-icon" type="submit" title="Add item">${icon("plus")}</button>
        <input name="title" placeholder="Add item">
      </form>
    </section>`;
}

function taskHTML(task) {
  return `
    <li class="task action ${task.done ? "done" : ""}" draggable="true" data-task="${task.id}">
      <button class="check" data-toggle-done="${task.id}" aria-pressed="${task.done}" aria-label="${task.done ? "Mark incomplete" : "Mark complete"}">${task.done ? icon("check") : ""}</button>
      <button class="task-body task-open" type="button" data-open-task="${task.id}">
        <div class="task-title">${escapeHTML(task.title)}${taskStateBadgeHTML(task)}</div>
        ${task.scheduledDate ? `<span class="task-date">${formatTaskDate(task.scheduledDate)}</span>` : ""}
      </button>
    </li>`;
}

function taskStateBadgeHTML(task) {
  if (task.status === "queued" || task.status === "done") return "";
  return `<span class="state-badge state-${task.status}">${escapeHTML(statusLabel(task.status))}</span>`;
}

function flowHTML(board) {
  const actions = allTasks(board);
  return `
    <section class="flow" aria-label="Item flow">
      ${FLOW_STATES.map(state => flowColumnHTML(state, actions.filter(item => item.task.status === state.value))).join("")}
    </section>`;
}

function flowColumnHTML(flowState, items) {
  return `
    <section class="flow-column" data-flow-status="${flowState.value}" aria-labelledby="flow-${flowState.value}">
      <header><h2 id="flow-${flowState.value}">${flowState.label}</h2><span>${items.length}</span></header>
      <ul class="flow-cards">
        ${items.length ? items.map(flowCardHTML).join("") : `<li class="flow-empty">No items</li>`}
      </ul>
    </section>`;
}

function flowCardHTML(item) {
  const { task, list } = item;
  return `
    <li class="flow-card ${task.done ? "done" : ""}" draggable="true" data-task="${task.id}">
      <button class="task-open flow-card-open" type="button" data-open-task="${task.id}">
        <span class="flow-card-title">${escapeHTML(task.title)}</span>
        <span class="flow-card-meta"><span>${escapeHTML(list.name)}</span>${task.scheduledDate ? `<span>${formatTaskDate(task.scheduledDate)}</span>` : ""}</span>
      </button>
      ${flowCardActionsHTML(task)}
    </li>`;
}

function flowCardActionsHTML(task) {
  const index = FLOW_STATES.findIndex(item => item.value === task.status);
  const previous = index > 0 ? FLOW_STATES[index - 1] : null;
  const next = index >= 0 && index < FLOW_STATES.length - 1 ? FLOW_STATES[index + 1] : null;
  return `<div class="flow-card-actions">
    ${previous ? `<button type="button" data-set-task-status="${task.id}" data-status="${previous.value}" aria-label="Move ${escapeAttr(task.title)} to ${previous.label}">← ${previous.label}</button>` : ""}
    ${next ? `<button type="button" data-set-task-status="${task.id}" data-status="${next.value}" aria-label="Move ${escapeAttr(task.title)} to ${next.label}">${next.label} →</button>` : ""}
  </div>`;
}

function calendarHTML(board) {
  const days = weekDays();
  const tasks = allTasks(board);
  return `
    <section class="week-calendar">
      <div class="calendar-toolbar">
        <button class="icon-btn" id="previous-week" title="Previous week">${icon("chevronLeft")}</button>
        <button class="plain-btn" id="current-week">Today</button>
        <b>${weekLabel()}</b>
        <button class="icon-btn next" id="next-week" title="Next week">${icon("chevronLeft")}</button>
      </div>
      <div class="calendar-grid">
        ${days.map(day => calendarDayHTML(day, tasks)).join("")}
      </div>
    </section>`;
}

function calendarDayHTML(day, tasks) {
  const key = dateKey(day);
  const items = tasks.filter(item => item.task.scheduledDate === key);
  const today = key === dateKey(new Date());
  return `
    <section class="calendar-day ${today ? "today" : ""}" data-calendar-date="${key}">
      <header>
        <span>${day.toLocaleDateString(undefined, { weekday: "long" })}</span>
        <b>${day.getDate()}</b>
      </header>
      <ul class="calendar-tasks" data-calendar-date="${key}">
        ${items.length ? items.map(calendarTaskHTML).join("") : `<li class="calendar-empty">No dated items</li>`}
      </ul>
    </section>`;
}

function calendarTaskHTML(item) {
  const { task, list } = item;
  return `
    <li class="task calendar-task action ${task.done ? "done" : ""}" draggable="true" data-task="${task.id}">
      <button class="check" data-toggle-done="${task.id}" aria-pressed="${task.done}" aria-label="${task.done ? "Mark incomplete" : "Mark complete"}">${task.done ? icon("check") : ""}</button>
      <button class="task-body task-open" type="button" data-open-task="${task.id}">
        <div class="task-title">${escapeHTML(task.title)}</div>
        <span class="task-list-name">${escapeHTML(list.name)}</span>
      </button>
    </li>`;
}

function todayHTML(board) {
  const today = dateKey(new Date());
  const actions = allTasks(board).filter(item => item.task.scheduledDate === today);
  return `
    <section class="today-view">
      <section class="today-section">
        <div class="today-section-head"><div><span>${new Date().toLocaleDateString(undefined, { weekday: "long" })}</span><h2>Items</h2></div><b>${actions.length}</b></div>
        <ul>${actions.length ? actions.map(calendarTaskHTML).join("") : `<li class="today-empty">No items planned today.</li>`}</ul>
      </section>
    </section>`;
}

function detailHTML(task) {
  const list = state.board.buckets.find(item => item.id === task.bucketId);
  return `
    <div class="detail-overlay" data-detail-overlay>
      <section class="detail" role="dialog" aria-modal="true" aria-labelledby="detail-heading">
        <header class="detail-head">
          <div class="detail-context"><span>${escapeHTML(list?.name || "Item")}</span><span aria-hidden="true">/</span><b id="detail-heading">Edit item</b></div>
          <button class="detail-close" type="button" data-close-detail aria-label="Close editor" title="Close">${icon("x")}</button>
        </header>
        <form id="detail-form">
          <div class="detail-body">
            <label class="sr-only" for="detail-title">Title</label>
            <input class="detail-title" id="detail-title" name="title" type="text" value="${escapeAttr(task.title)}" placeholder="Item title" autocomplete="off" required>
            <label class="sr-only" for="detail-description">Description</label>
            <textarea class="detail-description" id="detail-description" name="description" placeholder="Add a description…">${escapeHTML(task.description || "")}</textarea>
            <div class="detail-properties" aria-label="Item properties">
              <div class="field"><label for="detail-status">State</label><select id="detail-status" name="status">${statusOptionsHTML(task.status)}</select></div>
              <div class="field"><label for="detail-list">List</label><select id="detail-list" name="bucketId">
                ${state.board.buckets.map(b => `<option value="${b.id}" ${b.id === task.bucketId ? "selected" : ""}>${escapeHTML(b.name)}</option>`).join("")}
              </select></div>
              <div class="field"><label for="detail-date">Plan for</label><input id="detail-date" name="scheduledDate" type="date" value="${escapeAttr(task.scheduledDate || "")}"></div>
            </div>
            <p class="error detail-error" role="alert">${escapeHTML(state.error)}</p>
          </div>
          <footer class="detail-actions">
            <button class="danger" type="button" id="delete-task">Delete item</button>
            <div>
              <button class="secondary" type="button" data-close-detail>Cancel</button>
              <button class="primary" type="submit">Save changes</button>
            </div>
          </footer>
        </form>
      </section>
    </div>`;
}

function statusOptionsHTML(selected) {
  return FLOW_STATES.map(item => `<option value="${item.value}" ${item.value === selected ? "selected" : ""}>${item.label}</option>`).join("");
}

function statusLabel(status) {
  return FLOW_STATES.find(item => item.value === status)?.label || "Ready";
}

function footerHTML(board, todayMode) {
  const counts = statusCounts(board);
  return `<footer class="footer"><span>${todayMode ? `${todayActionCount(board)} today` : `${openTaskCount(board)} open items`}</span><span>${counts.working} working</span><span>${counts.needs_review} review</span></footer>`;
}

function statusErrorHTML(error) {
  return error ? `<p class="status-error" role="alert">${escapeHTML(error)}</p>` : "";
}

function settingsHTML() {
  const theme = themeFor(state.board?.backgroundValue);
  return `
    <section class="settings-page theme-${theme}">
      <aside class="sidebar">
        <button class="brand brand-button" type="button" data-home>slate<span>.do</span></button>
        <section class="nav-sec">
          <button class="page-row on icon-label" id="back">${icon("chevronLeft")}<span>Board</span></button>
          <button class="plain-btn" id="settings-logout">Sign out</button>
        </section>
      </aside>
      <main class="settings-main">
        <section class="settings-panel">
          <div class="settings-head">
            <div>
              <p>Owner settings</p>
              <h1>Settings</h1>
            </div>
          </div>
          <section class="settings-section">
            <div class="settings-section-head">
              <h2>Appearance</h2>
              <p>Theme for ${escapeHTML(state.board?.name || "this board")}</p>
            </div>
            <div class="seg settings-theme">
              ${themes.map(item => `<button data-settings-theme="${item.id}" class="${theme === item.id ? "on" : ""}">${item.label}</button>`).join("")}
            </div>
          </section>
          <section class="settings-section">
            <div class="settings-section-head">
              <h2>API tokens</h2>
              <p>Access for CLI and agent workflows</p>
            </div>
            <form id="token-form" class="token-form">
              <input name="name" placeholder="Token name" required>
              <button class="primary" type="submit">Create token</button>
            </form>
            ${state.newToken ? `<div class="new-token"><label>New token</label><code>${escapeHTML(state.newToken)}</code></div>` : ""}
            <div class="token-list">
              ${state.tokens.length ? state.tokens.map(t => `<div class="token-row"><span>${escapeHTML(t.name)}</span><button class="danger" data-revoke="${t.id}">Revoke</button></div>`).join("") : `<div class="empty-state"><p>No active tokens.</p></div>`}
            </div>
          </section>
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
  const sidebar = document.querySelector(".sidebar");
  const sidebarToggle = document.querySelector("#sidebar-toggle");
  sidebarToggle.onclick = () => {
    const open = sidebar.classList.toggle("open");
    sidebarToggle.setAttribute("aria-expanded", String(open));
    sidebarToggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  };
  document.querySelectorAll("[data-board]").forEach(el => el.onclick = async () => { await loadBoard(el.dataset.board); render(); });
  document.querySelectorAll("[data-delete-board]").forEach(el => el.onclick = async () => deleteBoard(el.dataset.deleteBoard));
  document.querySelector("#settings").onclick = async () => { await openSettings(true); };
  document.querySelector("#logout").onclick = async () => { await api.post("/api/v1/auth/logout"); state.me = null; state.view = "home"; render(); };
  document.querySelector("#new-board").onclick = async () => {
    const board = await api.post("/api/v1/boards", { name: "Untitled board", maxTasksPerList: DEFAULT_LIST_LIMIT, backgroundKind: "theme", backgroundValue: themeFor(state.board?.backgroundValue) });
    await api.post(`/api/v1/boards/${board.id}/buckets`, { name: "Inbox", isInbox: true });
    await api.post(`/api/v1/boards/${board.id}/buckets`, { name: "Focus" });
    await loadBoards(board.id);
    render();
  };
  document.querySelectorAll("[data-board-mode]").forEach(el => el.onclick = () => {
    state.boardMode = el.dataset.boardMode;
    state.selectedTask = null;
    render();
  });
  document.querySelector("#previous-week")?.addEventListener("click", () => changeWeek(-7));
  document.querySelector("#next-week")?.addEventListener("click", () => changeWeek(7));
  document.querySelector("#current-week")?.addEventListener("click", () => { state.weekStart = ""; render(); });
  const addListButton = document.querySelector("#add-list");
  if (addListButton) addListButton.onclick = async () => {
    const list = await api.post(`/api/v1/boards/${state.board.id}/buckets`, { name: "New list" });
    await loadBoards(state.board.id);
    render();
    document.querySelector(`[data-bucket="${list.id}"] input[data-bucket-name]`)?.focus();
  };
  document.querySelector("#board-title").addEventListener("change", async e => { await api.patch(`/api/v1/boards/${state.board.id}`, { name: e.target.value }); await reload(); });
  document.querySelector("#list-limit").addEventListener("change", async e => {
    const next = Math.max(1, Number(e.target.value) || DEFAULT_LIST_LIMIT);
    await api.patch(`/api/v1/boards/${state.board.id}`, { maxTasksPerList: next });
    await reload();
  });
  document.querySelectorAll("[data-bucket-name]").forEach(el => el.addEventListener("change", async e => { await api.patch(`/api/v1/buckets/${el.dataset.bucketName}`, { name: e.target.value }); await reload(); }));
  document.querySelectorAll("[data-bucket-goal]").forEach(el => el.addEventListener("input", e => {
    const goal = e.target.value;
    const id = el.dataset.bucketGoal;
    const list = state.board.buckets.find(item => item.id === el.dataset.bucketGoal);
    if (list) list.goal = goal;
    delete state.goalErrors[id];
    clearTimeout(el.goalSaveTimer);
    el.goalSaveTimer = setTimeout(() => {
      const previous = goalSaveChains.get(id) || Promise.resolve();
      const next = previous.catch(() => {}).then(() => api.patch(`/api/v1/buckets/${id}`, { goal }));
      goalSaveChains.set(id, next);
      next.then(() => {
        if (goalSaveChains.get(id) === next) delete state.goalErrors[id];
      }).catch(err => {
        if (goalSaveChains.get(id) === next) {
          state.goalErrors[id] = err.message;
          render();
        }
      });
    }, 300);
  }));
  document.querySelectorAll("[data-delete-bucket]").forEach(el => el.onclick = async () => { if (confirm("Delete this list and its items?")) { await api.del(`/api/v1/buckets/${el.dataset.deleteBucket}`); await reload(); } });
  document.querySelectorAll("[data-add-task]").forEach(form => {
    form.addEventListener("submit", addTask);
    form.querySelector('input[name="title"]').addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      form.requestSubmit();
    });
  });
  document.querySelectorAll("[data-open-task]").forEach(el => el.onclick = () => { state.error = ""; state.selectedTask = findTask(el.dataset.openTask); render(); });
  document.querySelectorAll("[data-toggle-done]").forEach(el => el.onclick = async event => {
    event.stopPropagation();
    const task = findTask(el.dataset.toggleDone);
    await runMutation(() => api.patch(`/api/v1/tasks/${task.id}`, { done: !task.done }), reload);
  });
  document.querySelectorAll("[data-set-task-status]").forEach(el => el.onclick = async event => {
    event.stopPropagation();
    await updateTaskStatus(el.dataset.setTaskStatus, el.dataset.status);
  });
  bindDrag();
  bindDetail();
}

async function deleteBoard(id) {
  const board = state.boards.find(item => item.id === id);
  if (!board || !confirm(`Delete "${board.name}" and all its lists and items?`)) return;
  await api.del(`/api/v1/boards/${id}`);
  state.selectedTask = null;
  state.board = null;
  await loadBoards();
  if (!state.board) {
    const next = await api.post("/api/v1/boards", { name: "Today", maxTasksPerList: DEFAULT_LIST_LIMIT, backgroundKind: "theme", backgroundValue: "light" });
    await api.post(`/api/v1/boards/${next.id}/buckets`, { name: "Inbox", isInbox: true });
    await api.post(`/api/v1/boards/${next.id}/buckets`, { name: "Focus" });
    await loadBoards(next.id);
  }
  render();
}

function bindDetail() {
  if (!state.selectedTask) return;
  const overlay = document.querySelector("[data-detail-overlay]");
  const formElement = document.querySelector("#detail-form");
  const taskID = state.selectedTask.id;
  const bucketID = state.selectedTask.bucketId;
  let detailBusy = false;
  const focusAfterDetail = (preferredTaskID = taskID) => {
    const triggers = [...document.querySelectorAll("[data-open-task]")];
    const trigger = triggers.find(element => element.dataset.openTask === preferredTaskID);
    const addInput = document.querySelector(`[data-add-task="${bucketID}"] input[name="title"]`);
    (trigger || triggers[0] || addInput || document.querySelector("#board-title"))?.focus();
  };
  const setDetailBusy = busy => {
    detailBusy = busy;
    document.querySelectorAll("[data-close-detail], #delete-task, #detail-form button[type=submit]").forEach(element => { element.disabled = busy; });
  };
  const closeDetail = () => {
    if (detailBusy) return;
    state.selectedTask = null;
    state.error = "";
    render();
    focusAfterDetail();
  };
  document.querySelectorAll("[data-close-detail]").forEach(element => element.onclick = closeDetail);
  overlay.addEventListener("click", event => { if (event.target === overlay) closeDetail(); });
  overlay.addEventListener("keydown", event => {
    if (event.key === "Escape") closeDetail();
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (!detailBusy) formElement.requestSubmit();
    }
    if (event.key === "Tab") {
      const focusable = [...overlay.querySelectorAll("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)")];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  document.querySelector("#detail-title").focus();
  document.querySelector("#delete-task").onclick = async () => {
    if (!confirm("Delete this item?")) return;
    const visibleTaskIDs = [...document.querySelectorAll("[data-open-task]")].map(element => element.dataset.openTask);
    const taskIndex = visibleTaskIDs.indexOf(taskID);
    const nextTaskID = visibleTaskIDs[taskIndex + 1] || visibleTaskIDs[taskIndex - 1] || "";
    setDetailBusy(true);
    try {
      await api.del(`/api/v1/tasks/${taskID}`);
      state.selectedTask = null;
      state.error = "";
      await reload();
      focusAfterDetail(nextTaskID);
    } catch (err) {
      state.error = err.message;
      formElement.querySelector(".detail-error").textContent = err.message;
      setDetailBusy(false);
    }
  };
  formElement.addEventListener("submit", async event => {
    event.preventDefault();
    if (detailBusy) return;
    setDetailBusy(true);
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.textContent = "Saving…";
    const form = new FormData(event.currentTarget);
    try {
      const input = {
        title: form.get("title"),
        description: form.get("description"),
        scheduledDate: form.get("scheduledDate"),
        bucketId: form.get("bucketId"),
        status: form.get("status"),
      };
      await api.patch(`/api/v1/tasks/${taskID}/status`, input);
      state.error = "";
      state.selectedTask = null;
      await reload();
      focusAfterDetail();
    } catch (err) {
      state.error = err.message;
      const error = formElement.querySelector(".detail-error");
      error.textContent = err.message;
      setDetailBusy(false);
      submit.textContent = "Save changes";
    }
  });
}

async function bindSettings() {
  document.querySelectorAll("[data-home]").forEach(el => el.onclick = goHome);
  document.querySelector("#back").onclick = closeSettings;
  document.querySelector("#settings-logout").onclick = async () => { await api.post("/api/v1/auth/logout"); state.me = null; state.settings = false; state.view = "home"; render(); };
  document.querySelectorAll("[data-settings-theme]").forEach(el => el.onclick = async () => {
    await api.patch(`/api/v1/boards/${state.board.id}`, { backgroundKind: "theme", backgroundValue: el.dataset.settingsTheme });
    await reload();
  });
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
  await runMutation(() => api.post(`/api/v1/buckets/${list.id}/tasks`, { title }), reload);
}

let drag = null;

function bindDrag() {
  document.querySelectorAll("[data-task]").forEach(el => {
    el.addEventListener("dragstart", event => {
      drag = { type: "task", id: el.dataset.task };
      event.dataTransfer.setData("text/task-id", el.dataset.task);
      event.dataTransfer.effectAllowed = "move";
      requestAnimationFrame(() => el.classList.add("dragging"));
    });
    el.addEventListener("dragend", () => {
      drag = null;
      el.classList.remove("dragging");
      clearDropMarks();
    });
  });
  document.querySelectorAll("[data-task-list]").forEach(list => {
    list.addEventListener("dragover", event => {
      if (drag?.type !== "task") return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      markTaskDrop(list, event.clientY);
    });
    list.addEventListener("drop", async event => {
      if (drag?.type !== "task") return;
      event.preventDefault();
      const index = taskDropIndex(list, event.clientY);
      const id = drag.id;
      drag = null;
      clearDropMarks();
      await dropTask(id, list.dataset.taskList, index);
    });
  });
  document.querySelectorAll(".grid [data-bucket]").forEach(bucket => {
    bucket.addEventListener("dragstart", event => {
      if (event.target.closest?.("[data-task]")) return;
      if (event.target.closest?.("input, textarea, select, button")) {
        event.preventDefault();
        return;
      }
      drag = { type: "bucket", id: bucket.dataset.bucket };
      event.dataTransfer.setData("text/bucket-id", bucket.dataset.bucket);
      event.dataTransfer.effectAllowed = "move";
      requestAnimationFrame(() => bucket.classList.add("dragging"));
    });
    bucket.addEventListener("dragend", () => {
      drag = null;
      bucket.classList.remove("dragging");
      clearDropMarks();
    });
  });
  const grid = document.querySelector(".grid");
  if (grid) {
    grid.addEventListener("dragover", event => {
      if (drag?.type !== "bucket") return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      markBucketDrop(event);
    });
    grid.addEventListener("drop", async event => {
      if (drag?.type !== "bucket") return;
      event.preventDefault();
      const index = bucketDropIndex(event);
      const id = drag.id;
      drag = null;
      clearDropMarks();
      await dropBucket(id, index);
    });
  }
  document.querySelectorAll(".calendar-day[data-calendar-date]").forEach(day => {
    day.addEventListener("dragover", event => {
      if (drag?.type !== "task") return;
      event.preventDefault();
      day.classList.add("drop-into");
    });
    day.addEventListener("dragleave", () => day.classList.remove("drop-into"));
    day.addEventListener("drop", async event => {
      if (drag?.type !== "task") return;
      event.preventDefault();
      const id = drag.id;
      drag = null;
      clearDropMarks();
      await runMutation(() => api.patch(`/api/v1/tasks/${id}`, { scheduledDate: day.dataset.calendarDate }), reload);
    });
  });
  document.querySelectorAll("[data-flow-status]").forEach(column => {
    column.addEventListener("dragover", event => {
      if (drag?.type !== "task") return;
      event.preventDefault();
      column.classList.add("over");
    });
    column.addEventListener("dragleave", () => column.classList.remove("over"));
    column.addEventListener("drop", async event => {
      if (drag?.type !== "task") return;
      event.preventDefault();
      const id = drag.id;
      drag = null;
      clearDropMarks();
      column.classList.remove("over");
      await updateTaskStatus(id, column.dataset.flowStatus);
    });
  });
}

async function updateTaskStatus(id, status) {
  await runMutation(
    () => api.patch(`/api/v1/tasks/${id}/status`, { status }),
    reload,
  );
}

async function runMutation(request, refresh) {
  try {
    await request();
    state.error = "";
  } catch (err) {
    state.error = err.message;
  }
  await refresh();
}

function reorderedTaskIDs(ids, movingID, targetID, afterTarget = false) {
  if (!ids.includes(movingID) || targetID === movingID) return [...ids];
  const ordered = ids.filter(id => id !== movingID);
  if (!targetID) return [...ordered, movingID];
  let targetIndex = ordered.indexOf(targetID);
  if (targetIndex < 0) return [...ids];
  if (afterTarget) targetIndex += 1;
  ordered.splice(targetIndex, 0, movingID);
  return ordered;
}

function taskDropIndex(list, y) {
  const items = [...list.querySelectorAll("[data-task]:not(.dragging)")];
  for (let i = 0; i < items.length; i++) {
    const rect = items[i].getBoundingClientRect();
    if (y < rect.top + rect.height / 2) return i;
  }
  return items.length;
}

function markTaskDrop(list, y) {
  clearDropMarks();
  const items = [...list.querySelectorAll("[data-task]:not(.dragging)")];
  if (!items.length) {
    list.classList.add("drop-into");
    return;
  }
  const index = taskDropIndex(list, y);
  if (index < items.length) items[index].classList.add("drop-before");
  else items[items.length - 1].classList.add("drop-after");
}

function bucketDropIndex(event) {
  const buckets = [...document.querySelectorAll(".grid [data-bucket]:not(.dragging)")];
  const rects = buckets.map(bucket => bucket.getBoundingClientRect());
  return bucketDropIndexForRects(rects, event.clientX, event.clientY, window.matchMedia("(max-width: 900px)").matches);
}

function bucketDropIndexForRects(rects, x, y, singleColumn) {
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    if (singleColumn) {
      if (y < rect.top + rect.height / 2) return i;
      continue;
    }
    if (y < rect.top || (y <= rect.bottom && x < rect.left + rect.width / 2)) return i;
  }
  return rects.length;
}

function markBucketDrop(event) {
  clearDropMarks();
  const buckets = [...document.querySelectorAll(".grid [data-bucket]:not(.dragging)")];
  if (!buckets.length) return;
  const index = bucketDropIndex(event);
  if (index < buckets.length) buckets[index].classList.add("drop-before-bucket");
  else buckets[buckets.length - 1].classList.add("drop-after-bucket");
}

function clearDropMarks() {
  document.querySelectorAll(".drop-before, .drop-after, .drop-into, .drop-before-bucket, .drop-after-bucket").forEach(el => {
    el.classList.remove("drop-before", "drop-after", "drop-into", "drop-before-bucket", "drop-after-bucket");
  });
}

async function dropTask(taskId, bucketId, index) {
  const task = findTask(taskId);
  const target = state.board.buckets.find(b => b.id === bucketId);
  if (!task || !target) return;
  const moved = task.bucketId !== bucketId;
  const from = state.board.buckets.find(b => b.id === task.bucketId);
  if (from) from.tasks = (from.tasks || []).filter(t => t.id !== taskId);
  task.bucketId = bucketId;
  target.tasks = target.tasks || [];
  target.tasks.splice(index, 0, task);
  state.error = "";
  render();
  try {
    if (moved) await api.patch(`/api/v1/tasks/${taskId}`, { bucketId });
    await api.post(`/api/v1/buckets/${bucketId}/reorder-tasks`, { ids: target.tasks.map(t => t.id) });
  } catch (err) {
    state.error = err.message;
  }
  await reload();
}

async function dropBucket(bucketId, index) {
  const ids = state.board.buckets.map(b => b.id).filter(id => id !== bucketId);
  ids.splice(index, 0, bucketId);
  state.board.buckets.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  state.error = "";
  render();
  try {
    await api.post(`/api/v1/boards/${state.board.id}/reorder-buckets`, { ids });
  } catch (err) {
    state.error = err.message;
  }
  await reload();
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

function allTasks(board) {
  return (board?.buckets || []).flatMap(list => (list.tasks || []).map(task => ({ task, list })));
}

function calendarWeekStart() {
  if (state.weekStart) return parseDateKey(state.weekStart);
  return startOfWeek(new Date());
}

function startOfWeek(value) {
  const date = new Date(value);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

function weekDays() {
  const start = calendarWeekStart();
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function changeWeek(days) {
  state.weekStart = dateKey(addDays(calendarWeekStart(), days));
  render();
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateKey(date) {
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function weekLabel() {
  return formatWeekLabel(weekDays());
}

function formatWeekLabel(days) {
  const first = days[0];
  const last = days[6];
  const sameMonth = first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear();
  if (sameMonth) {
    return `${first.getDate()}–${last.getDate()} ${last.toLocaleDateString(undefined, { month: "short" })} ${last.getFullYear()}`;
  }
  const firstLabel = first.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const lastLabel = last.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${firstLabel} – ${lastLabel}`;
}

function formatTaskDate(value) {
  return parseDateKey(value).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function openTaskCount(board) {
  return (board?.buckets || []).reduce((sum, b) => sum + b.openCount, 0);
}

function todayActionCount(board) {
  const today = dateKey(new Date());
  return allTasks(board).filter(item => !item.task.done && item.task.scheduledDate === today).length;
}

function statusCounts(board) {
  const counts = { queued: 0, working: 0, needs_review: 0, done: 0 };
  for (const { task } of allTasks(board)) {
    if (Object.hasOwn(counts, task.status)) counts[task.status] += 1;
  }
  return counts;
}

function formatCount(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
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
