const ICON_PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4.6C9 3.7 9.7 3 10.6 3h2.8c.9 0 1.6.7 1.6 1.6V7"/><path d="M18.4 7l-.8 12.4a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9L5.6 7"/><path d="M10 11v6M14 11v6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  inbox: '<polyline points="21 11 15 11 13 14 9 14 7 11 1 11"/><path d="M5.4 4.6L1 11v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-7l-4.4-6.4A2 2 0 0 0 15 3H7a2 2 0 0 0-1.6 1.4z"/>',
  file: '<path d="M13 2.4H6.6a1.6 1.6 0 0 0-1.6 1.6v16a1.6 1.6 0 0 0 1.6 1.6h10.8a1.6 1.6 0 0 0 1.6-1.6V8.6z"/><path d="M13 2.4V8.6h6.2"/>',
  grip: '<circle cx="9" cy="5" r="1.1"/><circle cx="9" cy="12" r="1.1"/><circle cx="9" cy="19" r="1.1"/><circle cx="15" cy="5" r="1.1"/><circle cx="15" cy="12" r="1.1"/><circle cx="15" cy="19" r="1.1"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  user: '<circle cx="12" cy="8" r="3.2"/><path d="M5 20.5c0-3.6 3.1-6.2 7-6.2s7 2.6 7 6.2"/>',
  tag: '<path d="M3 11.6V4.6A1.6 1.6 0 0 1 4.6 3h7l9 9-8.4 8.4-9-9z"/><circle cx="8" cy="8" r="1.3"/>',
  star: '<path d="M12 3.6l2.5 5.1 5.6.8-4 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-4 5.6-.8z"/>',
  boards: '<rect x="3" y="4" width="7" height="7" rx="1.6"/><rect x="14" y="4" width="7" height="7" rx="1.6"/><rect x="3" y="15" width="7" height="6" rx="1.6"/><rect x="14" y="15" width="7" height="6" rx="1.6"/>',
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
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  },
  get(path) { return this.request(path); },
  post(path, body) { return this.request(path, { method: "POST", body: JSON.stringify(body || {}) }); },
  patch(path, body) { return this.request(path, { method: "PATCH", body: JSON.stringify(body || {}) }); },
  del(path) { return this.request(path, { method: "DELETE" }); },
};

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
            <span>3/20</span>
            <b>Focus</b>
          </div>
          <p>${icon("star", "focus-star")}Draft launch note</p>
          <p>${icon("star", "focus-star")}Review agent work</p>
          <p>${icon("star", "focus-star")}Ship one small thing</p>
        </section>
      </main>
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
            <button class="plain-btn icon-label" id="settings">${icon("gear")}<span>Settings and API tokens</span></button>
            <button class="plain-btn icon-label" id="logout">${icon("logout")}<span>Sign out</span></button>
          </section>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <input class="title-input" id="board-title" value="${escapeAttr(board?.name || "")}">
          <span class="week">${calendarMode ? weekLabel() : new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</span>
          <div class="top-actions">
            <div class="view-switch" aria-label="Board view">
              <button data-board-mode="lists" aria-label="Lists" aria-pressed="${listsMode}" class="${listsMode ? "on" : ""}">${icon("boards")}<span>Lists</span></button>
              <button data-board-mode="flow" aria-label="Flow" aria-pressed="${flowMode}" class="${flowMode ? "on" : ""}">${icon("grip")}<span>Flow</span></button>
              <button data-board-mode="calendar" aria-label="Week" aria-pressed="${calendarMode}" class="${calendarMode ? "on" : ""}">${icon("calendar")}<span>Week</span></button>
              <button data-board-mode="today" aria-label="Today" aria-pressed="${todayMode}" class="${todayMode ? "on" : ""}">${icon("check")}<span>Today</span></button>
            </div>
            <details class="board-settings">
              <summary class="icon-btn" title="Board settings" aria-label="Board settings">${icon("gear")}</summary>
              <div class="board-settings-menu">
                <section>
                  <h3>Items per list</h3>
                  <div class="limit-control">
                    <input id="list-limit" type="number" min="1" value="${board?.maxTasksPerList || DEFAULT_LIST_LIMIT}">
                  </div>
                </section>
              </div>
            </details>
            <button class="icon-btn icon-label ${listsMode ? "" : "add-list-placeholder"}" id="add-list" ${listsMode ? "" : 'aria-hidden="true" tabindex="-1" disabled'}>${icon("plus")}<span>List</span></button>
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
      <button class="board-select" data-board="${board.id}">${icon("file", "board-icon")}<span>${escapeHTML(board.name)}</span></button>
      <button class="board-delete" data-delete-board="${board.id}" title="Delete board">${icon("trash")}</button>
    </div>`;
}

function listHTML(list) {
  const over = list.openCount > list.limitCount ? "over-limit" : "";
  const tasks = list.tasks || [];
  return `
    <section class="bucket ${over}" data-bucket="${list.id}">
      <div class="bucket-head">
        <span class="count" title="Open actions / limit">${list.openCount}/${list.limitCount}</span>
        <input data-bucket-name="${list.id}" value="${escapeAttr(list.name)}">
        <div class="bucket-menu">
          <button class="icon-btn" data-delete-bucket="${list.id}" title="Delete list">${icon("trash")}</button>
        </div>
      </div>
      <input class="bucket-goal" data-bucket-goal="${list.id}" value="${escapeAttr(list.goal || "")}" placeholder="What matters in this bucket?" aria-label="Goal for ${escapeAttr(list.name)}">
      ${state.goalErrors[list.id] ? `<p class="error bucket-goal-error">${escapeHTML(state.goalErrors[list.id])}</p>` : ""}
      <ul class="tasks ${tasks.length ? "" : "empty"}" data-task-list="${list.id}">
        ${tasks.length ? tasks.map(taskHTML).join("") : `<li class="empty-state">${icon("inbox")}<p>No items yet</p></li>`}
      </ul>
      <form class="add-task" data-add-task="${list.id}">
        <button class="add-icon" type="submit" title="Add item">${icon("plus")}</button>
        <input name="title" placeholder="Add item">
      </form>
    </section>`;
}

function taskHTML(task) {
  const action = task.kind === "action";
  return `
    <li class="task ${action ? "action" : "item"} ${task.done ? "done" : ""}" draggable="true" data-task="${task.id}">
      <span class="grip" aria-hidden="true">${icon("grip")}</span>
      ${action ? `<button class="check" data-toggle-done="${task.id}" aria-pressed="${task.done}" aria-label="${task.done ? "Mark incomplete" : "Mark complete"}">${task.done ? icon("check") : ""}</button>` : `<span class="item-dot" aria-hidden="true"></span>`}
      <button class="task-body task-open" type="button" data-open-task="${task.id}">
        <div class="task-title">${escapeHTML(task.title)}${taskStateBadgeHTML(task)}</div>
        ${task.scheduledDate ? `<span class="task-date">${icon("calendar")}${formatTaskDate(task.scheduledDate)}</span>` : ""}
      </button>
    </li>`;
}

function taskStateBadgeHTML(task) {
  if (task.kind !== "action" || task.status === "queued" || task.status === "done") return "";
  return `<span class="state-badge state-${task.status}">${escapeHTML(statusLabel(task.status))}</span>`;
}

function flowHTML(board) {
  const actions = allTasks(board).filter(item => item.task.kind === "action");
  return `
    <section class="flow" aria-label="Action flow">
      ${FLOW_STATES.map(state => flowColumnHTML(state, actions.filter(item => item.task.status === state.value))).join("")}
    </section>`;
}

function flowColumnHTML(flowState, items) {
  return `
    <section class="flow-column" data-flow-status="${flowState.value}" aria-labelledby="flow-${flowState.value}">
      <header><h2 id="flow-${flowState.value}">${flowState.label}</h2><span>${items.length}</span></header>
      <ul class="flow-cards">
        ${items.length ? items.map(flowCardHTML).join("") : `<li class="flow-empty">No actions</li>`}
      </ul>
    </section>`;
}

function flowCardHTML(item) {
  const { task, list } = item;
  return `
    <li class="flow-card ${task.done ? "done" : ""}" draggable="true" data-task="${task.id}">
      <button class="task-open flow-card-open" type="button" data-open-task="${task.id}">
        <span class="flow-card-title">${escapeHTML(task.title)}</span>
        <span class="flow-card-meta"><span>${escapeHTML(list.name)}</span>${task.scheduledDate ? `<span>${icon("calendar")}${formatTaskDate(task.scheduledDate)}</span>` : ""}</span>
      </button>
      <label class="flow-status"><span>State</span><select data-task-status="${task.id}" aria-label="State for ${escapeAttr(task.title)}">${statusOptionsHTML(task.status)}</select></label>
    </li>`;
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
  const action = task.kind === "action";
  return `
    <li class="task calendar-task ${action ? "action" : "item"} ${task.done ? "done" : ""}" draggable="true" data-task="${task.id}">
      ${action ? `<button class="check" data-toggle-done="${task.id}" aria-pressed="${task.done}" aria-label="${task.done ? "Mark incomplete" : "Mark complete"}">${task.done ? icon("check") : ""}</button>` : `<span class="item-dot" aria-hidden="true"></span>`}
      <button class="task-body task-open" type="button" data-open-task="${task.id}">
        <div class="task-title">${escapeHTML(task.title)}</div>
        <span class="task-list-name">${escapeHTML(list.name)}</span>
      </button>
    </li>`;
}

function todayHTML(board) {
  const today = dateKey(new Date());
  const dated = allTasks(board).filter(item => item.task.scheduledDate === today);
  const actions = dated.filter(item => item.task.kind === "action");
  const notes = dated.filter(item => item.task.kind !== "action");
  return `
    <section class="today-view">
      <section class="today-section">
        <div class="today-section-head"><div><span>${new Date().toLocaleDateString(undefined, { weekday: "long" })}</span><h2>Actions</h2></div><b>${actions.length}</b></div>
        <ul>${actions.length ? actions.map(calendarTaskHTML).join("") : `<li class="today-empty">No actions planned today.</li>`}</ul>
      </section>
      ${notes.length ? `<section class="today-section today-notes"><div class="today-section-head"><div><span>For context</span><h2>Notes</h2></div><b>${notes.length}</b></div><ul>${notes.map(calendarTaskHTML).join("")}</ul></section>` : ""}
    </section>`;
}

function detailHTML(task) {
  const action = task.kind === "action";
  return `
    <aside class="detail">
      <div class="detail-head"><b>Item detail</b><button id="close-detail" title="Close">${icon("x")}</button></div>
      <form class="detail-body" id="detail-form">
        <div class="field"><label>Title</label><input name="title" type="text" value="${escapeAttr(task.title)}" placeholder="Item title" required></div>
        <div class="field"><label>Type</label><select name="kind">
          <option value="item" ${action ? "" : "selected"}>Item</option>
          <option value="action" ${action ? "selected" : ""}>Action</option>
        </select></div>
        ${action ? `<div class="field"><label for="detail-status">State</label><select id="detail-status" name="status">${statusOptionsHTML(task.status)}</select></div>` : ""}
        <div class="field"><label>List</label><select name="bucketId">
          ${state.board.buckets.map(b => `<option value="${b.id}" ${b.id === task.bucketId ? "selected" : ""}>${escapeHTML(b.name)}</option>`).join("")}
        </select></div>
        <div class="field"><label>Date</label><input name="scheduledDate" type="date" value="${escapeAttr(task.scheduledDate || "")}"></div>
        <div class="field"><label>Description</label><textarea name="description" placeholder="Add details">${escapeHTML(task.description || "")}</textarea></div>
        <p class="error detail-error">${escapeHTML(state.error)}</p>
        <button class="primary" type="submit">Save</button>
        <button class="danger icon-label" type="button" id="delete-task">${icon("trash")}<span>Delete</span></button>
      </form>
    </aside>`;
}

function statusOptionsHTML(selected) {
  return FLOW_STATES.map(item => `<option value="${item.value}" ${item.value === selected ? "selected" : ""}>${item.label}</option>`).join("");
}

function statusLabel(status) {
  return FLOW_STATES.find(item => item.value === status)?.label || "Ready";
}

function footerHTML(board, todayMode) {
  const counts = statusCounts(board);
  return `<footer class="footer"><span>${todayMode ? `${todayActionCount(board)} today` : `${openTaskCount(board)} open actions`}</span><span>${counts.working} working</span><span>${counts.needs_review} review</span></footer>`;
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
          <button class="plain-btn icon-label" id="settings-logout">${icon("logout")}<span>Sign out</span></button>
        </section>
      </aside>
      <main class="settings-main">
        <section class="settings-panel">
          <div class="settings-head">
            <div>
              <p>Owner settings</p>
              <h1>Settings</h1>
            </div>
            <button class="icon-btn icon-label" id="settings-back">${icon("chevronLeft")}<span>Back</span></button>
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
              ${state.tokens.length ? state.tokens.map(t => `<div class="token-row"><span>${escapeHTML(t.name)}</span><button class="danger icon-label" data-revoke="${t.id}">${icon("trash")}<span>Revoke</span></button></div>`).join("") : `<div class="empty-state">${icon("inbox")}<p>No active tokens.</p></div>`}
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
  document.querySelectorAll("[data-toggle-done]").forEach(el => el.onclick = async e => { e.stopPropagation(); const task = findTask(el.dataset.toggleDone); await api.patch(`/api/v1/tasks/${task.id}`, { done: !task.done }); await reload(); });
  document.querySelectorAll("[data-task-status]").forEach(el => el.onchange = async () => { await updateTaskStatus(el.dataset.taskStatus, el.value); });
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
  document.querySelector("#close-detail").onclick = () => { state.selectedTask = null; render(); };
  document.querySelector("#delete-task").onclick = async () => { await api.del(`/api/v1/tasks/${state.selectedTask.id}`); state.selectedTask = null; await reload(); };
  document.querySelector("#detail-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const input = {
        title: form.get("title"),
        description: form.get("description"),
        scheduledDate: form.get("scheduledDate"),
        kind: form.get("kind"),
        bucketId: form.get("bucketId"),
      };
      if (state.selectedTask.kind === "action" && form.get("kind") === "action") {
        input.status = form.get("status");
        await api.patch(`/api/v1/tasks/${state.selectedTask.id}/status`, input);
      } else {
        await api.patch(`/api/v1/tasks/${state.selectedTask.id}`, input);
      }
      state.error = "";
      await reload();
    } catch (err) {
      state.error = err.message;
      render();
    }
  });
}

async function bindSettings() {
  document.querySelectorAll("[data-home]").forEach(el => el.onclick = goHome);
  document.querySelector("#back").onclick = closeSettings;
  document.querySelector("#settings-back").onclick = closeSettings;
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
  await api.post(`/api/v1/buckets/${list.id}/tasks`, { title, kind: "item" });
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
  document.querySelectorAll(".calendar-day[data-calendar-date]").forEach(day => {
    day.addEventListener("dragover", event => event.preventDefault());
    day.addEventListener("drop", async event => {
      event.preventDefault();
      const id = event.dataTransfer.getData("text/task-id");
      if (!id) return;
      await api.patch(`/api/v1/tasks/${id}`, { scheduledDate: day.dataset.calendarDate });
      await reload();
    });
  });
  document.querySelectorAll("[data-flow-status]").forEach(column => {
    column.addEventListener("dragover", event => event.preventDefault());
    column.addEventListener("drop", async event => {
      event.preventDefault();
      const id = event.dataTransfer.getData("text/task-id");
      if (!id) return;
      await updateTaskStatus(id, column.dataset.flowStatus);
    });
  });
}

async function updateTaskStatus(id, status) {
  await runStatusUpdate(
    () => api.patch(`/api/v1/tasks/${id}/status`, { status }),
    reload,
  );
}

async function runStatusUpdate(request, refresh) {
  try {
    await request();
    state.error = "";
  } catch (err) {
    state.error = err.message;
  }
  await refresh();
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
  return allTasks(board).filter(item => item.task.kind === "action" && !item.task.done && item.task.scheduledDate === today).length;
}

function statusCounts(board) {
  const counts = { queued: 0, working: 0, needs_review: 0, done: 0 };
  for (const { task } of allTasks(board)) {
    if (task.kind === "action" && Object.hasOwn(counts, task.status)) counts[task.status] += 1;
  }
  return counts;
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
