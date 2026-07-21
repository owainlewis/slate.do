const ICON_PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4.6C9 3.7 9.7 3 10.6 3h2.8c.9 0 1.6.7 1.6 1.6V7"/><path d="M18.4 7l-.8 12.4a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9L5.6 7"/><path d="M10 11v6M14 11v6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  rows: '<path d="M8.5 6h11.5M8.5 12h11.5M8.5 18h11.5"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  kanban: '<rect x="4" y="4.5" width="6.4" height="15" rx="1.6"/><rect x="13.6" y="4.5" width="6.4" height="10" rx="1.6"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4"/>',
  sun: '<circle cx="12" cy="12" r="3.6"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18"/>',
  moon: '<path d="M20 13.2A7.8 7.8 0 0 1 10.8 4a7.8 7.8 0 1 0 9.2 9.2z"/>',
  gear: '<circle cx="12" cy="12" r="3.1"/><path d="M12.6 2.6h-1.2a1.5 1.5 0 0 0-1.5 1.5v.3a1.5 1.5 0 0 1-.75 1.3l-.55.31a1.5 1.5 0 0 1-1.5 0l-.26-.14a1.5 1.5 0 0 0-2.05.54l-.6 1.04a1.5 1.5 0 0 0 .55 2.05l.26.15a1.5 1.5 0 0 1 .75 1.3v.62a1.5 1.5 0 0 1-.75 1.3l-.26.15a1.5 1.5 0 0 0-.55 2.05l.6 1.04a1.5 1.5 0 0 0 2.05.54l.26-.14a1.5 1.5 0 0 1 1.5 0l.55.31a1.5 1.5 0 0 1 .75 1.3v.3a1.5 1.5 0 0 0 1.5 1.5h1.2a1.5 1.5 0 0 0 1.5-1.5v-.3a1.5 1.5 0 0 1 .75-1.3l.55-.31a1.5 1.5 0 0 1 1.5 0l.26.14a1.5 1.5 0 0 0 2.05-.54l.6-1.04a1.5 1.5 0 0 0-.55-2.05l-.26-.15a1.5 1.5 0 0 1-.75-1.3v-.62a1.5 1.5 0 0 1 .75-1.3l.26-.15a1.5 1.5 0 0 0 .55-2.05l-.6-1.04a1.5 1.5 0 0 0-2.05-.54l-.26.14a1.5 1.5 0 0 1-1.5 0l-.55-.31a1.5 1.5 0 0 1-.75-1.3v-.3a1.5 1.5 0 0 0-1.5-1.5z"/>',
  signOut: '<path d="M9.5 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2.5"/><path d="M15 8l4 4-4 4"/><path d="M9.5 12H19"/>',
  inboxTray: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 13h4.6a3.4 3.4 0 0 0 6.8 0H20"/>',
};

function icon(name, cls = "") {
  const paths = ICON_PATHS[name] || "";
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

const api = {
  async request(path, options = {}) {
    const sessionVersion = authVersion;
    let res;
    try {
      res = await fetch(path, {
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options,
      });
    } catch (err) {
      if (sessionVersion !== authVersion) return new Promise(() => {});
      throw err;
    }
    if (sessionVersion !== authVersion) return new Promise(() => {});
    let text;
    try {
      text = await res.text();
    } catch (err) {
      if (sessionVersion !== authVersion) return new Promise(() => {});
      throw err;
    }
    if (sessionVersion !== authVersion) return new Promise(() => {});
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

function listLimitUpdate(boardId, value) {
  const next = Math.min(proLimits().activeItemsPerList, Math.max(1, Number(value) || DEFAULT_LIST_LIMIT));
  return { next, path: `/api/v1/boards/${boardId}`, input: { maxTasksPerList: next } };
}

const goalSaveChains = new Map();
let themeSaveChain = Promise.resolve();
let themeChangeVersion = 0;
let authVersion = 0;
let logoutRequest = null;
let authenticationRequest = null;

const state = {
  me: null,
  boards: [],
  maxBoards: 5,
  maxListsPerBoard: 9,
  board: null,
  selectedTask: null,
  settings: false,
  view: "home",
  error: "",
  notice: "",
  resetToken: "",
  goalErrors: {},
  newToken: "",
  tokens: [],
  boardMode: "lists",
  flowListId: "",
  weekStart: "",
  theme: "",
};

const themes = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const DEFAULT_LIST_LIMIT = 20;
const DEFAULT_MAX_BOARDS = 5;
const DEFAULT_MAX_LISTS_PER_BOARD = 9;
const FLOW_STATES = [
  { value: "queued", label: "Ready" },
  { value: "working", label: "Working" },
  { value: "needs_review", label: "Review" },
  { value: "done", label: "Done" },
];

async function boot() {
  try {
    const me = await api.get("/api/v1/me");
    if (me.authenticated) beginAuthenticatedSession(me.user);
    if (location.pathname === "/reset-password") {
      state.resetToken = new URLSearchParams(location.hash.slice(1)).get("token") || "";
      history.replaceState({}, "", "/reset-password");
      state.view = "reset-password";
    } else if (state.me) {
      if (await loadBoards()) state.view = "app";
	} else if (location.pathname === "/early-access") {
	  state.view = "early-access";
    }
    if (location.hash === "#settings" && state.me) await openSettings(false);
  } catch (err) {
    state.error = err.message;
  }
  render();
}

async function loadBoards(selectId) {
  const sessionVersion = authVersion;
  const data = await api.get("/api/v1/boards");
  if (sessionVersion !== authVersion) return false;
  state.boards = data.boards;
  state.maxBoards = data.maxBoards || proLimits().boards;
  const requestedId = selectId || state.board?.id;
  const nextId = state.boards.some(board => board.id === requestedId) ? requestedId : state.boards[0]?.id;
  if (nextId) {
    if (!await loadBoard(nextId, sessionVersion)) return false;
  } else {
    state.board = null;
  }
  return true;
}

function resetAuthenticatedState() {
  goalSaveChains.clear();
  themeSaveChain = Promise.resolve();
  themeChangeVersion += 1;
  state.me = null;
  state.boards = [];
  state.maxBoards = DEFAULT_MAX_BOARDS;
  state.maxListsPerBoard = DEFAULT_MAX_LISTS_PER_BOARD;
  state.board = null;
  state.selectedTask = null;
  state.settings = false;
  state.error = "";
  state.notice = "";
  state.goalErrors = {};
  state.newToken = "";
  state.tokens = [];
  state.boardMode = "lists";
  state.flowListId = "";
  state.weekStart = "";
  state.theme = "";
}

function beginAuthenticatedSession(user) {
  authVersion += 1;
  resetAuthenticatedState();
  state.me = user;
  state.maxBoards = proLimits().boards;
  state.maxListsPerBoard = proLimits().listsPerBoard;
  state.theme = themeFor(user.theme);
}

async function establishAuthenticatedSession(path, input) {
  if (authenticationRequest) return false;
  const request = (async () => {
    if (logoutRequest) await logoutRequest;
    await api.post(path, input);
    const me = await api.get("/api/v1/me");
    beginAuthenticatedSession(me.user);
    return loadBoards();
  })();
  authenticationRequest = request;
  try {
    return await request;
  } finally {
    if (authenticationRequest === request) authenticationRequest = null;
  }
}

async function logout() {
  if (logoutRequest) return logoutRequest;
  authVersion += 1;
  resetAuthenticatedState();
  state.view = "logging-out";
  if (location.hash === "#settings") history.replaceState({}, "", location.pathname);
  render();
  const request = api.post("/api/v1/auth/logout").then(() => {
    state.view = "home";
    render();
  }).catch(() => {
    state.error = "Sign out failed. Your session may still be active. Try again.";
    state.view = "logout-error";
    render();
  }).finally(() => {
    if (logoutRequest === request) logoutRequest = null;
  });
  logoutRequest = request;
  return request;
}

async function loadBoard(id, sessionVersion = authVersion) {
  let board = await api.get(`/api/v1/boards/${id}`);
  if (sessionVersion !== authVersion) return false;
  const staleNames = (board.buckets || []).filter(list => list.name === "New bucket");
  if (staleNames.length) {
    try {
      await Promise.all(staleNames.map(list => api.patch(`/api/v1/buckets/${list.id}`, { name: "New list" })));
      if (sessionVersion !== authVersion) return false;
      board = await api.get(`/api/v1/boards/${id}`);
    } catch (err) {
      if (sessionVersion !== authVersion) return false;
      throw err;
    }
    if (sessionVersion !== authVersion) return false;
  }
  state.board = board;
  if (!(board.buckets || []).some(list => list.id === state.flowListId)) state.flowListId = "";
  state.selectedTask = state.selectedTask ? findTask(state.selectedTask.id) : null;
  return true;
}

function render() {
  const root = document.querySelector("#app");
	if (state.view === "logging-out" || state.view === "logout-error") {
	  root.innerHTML = logoutStatusHTML();
	  bindLogoutStatus();
	  return;
	}
	if (state.view === "forgot-password" && !state.me) {
	  root.innerHTML = forgotPasswordHTML();
	  bindForgotPassword();
	  return;
	}
	if (state.view === "reset-password") {
	  root.innerHTML = resetPasswordHTML();
	  bindResetPassword();
	  return;
	}
	if (state.view === "early-access" && !state.me) {
	  root.innerHTML = earlyAccessHTML();
	  bindEarlyAccess();
	  return;
	}
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

function logoutStatusHTML() {
  const failed = state.view === "logout-error";
  return `
    <section class="login">
      <div>
        <div class="brand">slate<span>.do</span></div>
        <h1>${failed ? "Sign out failed." : "Signing out…"}</h1>
        <p>${failed ? escapeHTML(state.error) : "Clearing your session."}</p>
        ${failed ? '<button class="primary" id="retry-logout" type="button">Try again</button>' : ""}
      </div>
    </section>`;
}

function bindLogoutStatus() {
  document.querySelector("#retry-logout")?.addEventListener("click", logout);
}

function earlyAccessHTML() {
  return `
    <section class="login early-access">
      <form id="early-access-form" method="post" action="/api/v1/auth/register">
        <button class="brand brand-button" type="button" data-home>slate<span>.do</span></button>
        <h1>Join Slate.</h1>
        <p>Create your Pro account with your early access invite.</p>
        <label class="login-label" for="signup-email">Email</label>
        <input id="signup-email" name="email" type="email" autocomplete="email" required>
        <label class="login-label" for="signup-password">Password</label>
        <input id="signup-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="72" aria-describedby="password-requirements" required>
        <p class="form-help" id="password-requirements">Use at least 8 characters, up to 72 bytes.</p>
        <label class="login-label" for="signup-invite-code">Invite code</label>
        <input id="signup-invite-code" name="inviteCode" type="password" autocomplete="off" required>
        <button class="primary" type="submit">Create Pro account</button>
        <button class="auth-link" id="early-access-login" type="button">Already have an account? Sign in</button>
        <p class="error" role="alert">${escapeHTML(state.error)}</p>
      </form>
    </section>`;
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
        <button class="auth-link" id="forgot-password" type="button">Forgot your password?</button>
        <p class="notice" role="status">${escapeHTML(state.notice)}</p>
        <p class="error" role="alert">${escapeHTML(state.error)}</p>
      </form>
    </section>`;
}

function forgotPasswordHTML() {
  return `
    <section class="login">
      <form id="forgot-password-form">
        <button class="brand brand-button" type="button" data-home>slate<span>.do</span></button>
        <h1>Reset your password.</h1>
        <p>Enter your email and we’ll send you a secure reset link.</p>
        <label class="login-label" for="reset-email">Email</label>
        <input id="reset-email" name="email" type="email" autocomplete="email" required>
        <button class="primary" type="submit">Send reset link</button>
        <p class="notice reset-notice" role="status">${escapeHTML(state.notice)}</p>
        <button class="auth-link" id="back-to-login" type="button">Back to sign in</button>
        <p class="error" role="alert">${escapeHTML(state.error)}</p>
      </form>
    </section>`;
}

function resetPasswordHTML() {
  const hasToken = Boolean(state.resetToken);
  return `
    <section class="login">
      <form id="reset-password-form">
        <button class="brand brand-button" type="button" data-home>slate<span>.do</span></button>
        <h1>Choose a new password.</h1>
        ${hasToken ? `
          <p>Your new password will sign you out on other devices.</p>
          <label class="login-label" for="new-password">New password</label>
          <input id="new-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="72" aria-describedby="new-password-requirements" required>
          <p class="form-help" id="new-password-requirements">Use at least 8 characters, up to 72 bytes.</p>
          <button class="primary" type="submit">Reset password</button>
        ` : `<p class="error" role="alert">This reset link is invalid. Request a new one.</p>`}
        <button class="auth-link" id="reset-back-to-login" type="button">Back to sign in</button>
        ${hasToken ? `<p class="error" role="alert">${escapeHTML(state.error)}</p>` : ""}
      </form>
    </section>`;
}

function landingHTML() {
  const signedIn = Boolean(state.me);
  return `
    <section class="landing">
      <nav class="landing-nav">
        <button class="brand brand-button" type="button" data-home>slate<span>.do</span></button>
        <div class="landing-nav-actions">
          <a href="/cli">CLI guide</a>
          ${signedIn ? `<button class="nav-action" id="landing-open">Open app</button>` : `<button class="nav-action" id="landing-login">Log in</button>`}
        </div>
      </nav>
      <main class="landing-main">
        <section class="landing-hero">
          <div class="hero-copy">
            <h1 class="rise" style="--d:0">Decide what deserves <em>attention</em>.</h1>
            <p class="landing-lede rise" style="--d:1">Work is infinite. Attention is not. Slate is a planning and execution tool for you and your agents: think clearly about what matters, then let your agents execute it. A few lists, a hard limit on open actions, and one honest view of today.</p>
            <div class="landing-actions rise" style="--d:2">
              ${signedIn ? `<button class="primary" id="open-app">Open app</button>` : `<button class="primary" id="hero-login">Log in</button>`}
              <a class="secondary-link" href="mailto:owain@gradientwork.com?subject=Slate access">Request access</a>
            </div>
          </div>
          <figure class="hero-photo rise" style="--d:1">
            <img src="/landing-stones.jpg" alt="Three balanced slate stones on a plain grey background" width="1050" height="1400">
          </figure>
        </section>
        <section class="landing-preview" aria-label="Slate preview">
          <div class="tour-tabs rise" style="--d:2" role="tablist" aria-label="Slate views">
            <button class="tour-tab on" type="button" data-tour="lists" role="tab" aria-selected="true">Lists</button>
            <button class="tour-tab" type="button" data-tour="flow" role="tab" aria-selected="false">Flow</button>
            <button class="tour-tab" type="button" data-tour="week" role="tab" aria-selected="false">Week</button>
          </div>
          <div class="tour-frame" data-reveal>
            <img class="tour-img on" data-tour-img="lists" src="/app-lists.jpg" alt="Slate Lists view: three goal-led lists of work, each with a hard cap on open items">
            <img class="tour-img" data-tour-img="flow" src="/app-flow.jpg" alt="Slate Flow view: work moving through Ready, Working, Review, and Done">
            <img class="tour-img" data-tour-img="week" src="/app-week.jpg" alt="Slate Week view: tasks laid out across the days of the week">
          </div>
          <p class="preview-caption" data-reveal>
            <span class="tour-caption on" data-tour-caption="lists">A few lists, each with a hard cap on open work.</span>
            <span class="tour-caption" data-tour-caption="flow">Every item moves through the same four honest states.</span>
            <span class="tour-caption" data-tour-caption="week">See the week before you're already in it.</span>
          </p>
        </section>
        <section class="landing-principles">
          <h2 class="principles-head" data-reveal>Less, on purpose.</h2>
          <p class="principles-sub" data-reveal style="--d:0">Radical productivity comes from getting clear on what actually matters, not from doing more. Avoid the busy work. Scale yourself by letting your agents do it for you.</p>
          <div class="principle" data-reveal style="--d:0">
            <span class="principle-num">01</span>
            <h3>Limits, not lists</h3>
            <p>Every list caps its open actions. When a list is full, something has to finish before anything new begins.</p>
          </div>
          <div class="principle" data-reveal style="--d:1">
            <span class="principle-num">02</span>
            <h3>Clear state, less noise</h3>
            <p>Every item is completable and moves through the same small set of states, so open work stays honest.</p>
          </div>
          <div class="principle" data-reveal style="--d:2">
            <span class="principle-num">03</span>
            <h3>You think, they execute</h3>
            <p>Agents pull, claim, and finish work through the same plan you read. You stay clear on what matters. They handle the busy work and scale what you can get done.</p>
          </div>
        </section>
        <section class="landing-manifesto">
          <div class="manifesto-inner" data-reveal>
            <img src="/landing-slabs.jpg" alt="Slate slabs leaning against a pale plaster wall" loading="lazy" width="1920" height="1080">
            <blockquote>
              <p class="manifesto-line" data-reveal style="--d:2">Work is infinite.<br><em>Attention is not.</em></p>
              <p class="manifesto-sub" data-reveal style="--d:3">Strip away the noise. Focus on what matters.</p>
            </blockquote>
          </div>
        </section>
        <section class="landing-note">
          <p class="note-label" data-reveal>A note from the founder</p>
          <div class="note-body">
            <p data-reveal style="--d:0">I have used a lot of task apps over the years. The problem was always the same: I spent more time learning or configuring the software than actually getting work done.</p>
            <p data-reveal style="--d:1">Then agents changed how fast we can execute. We can move faster than ever now, but we still need a clear place to think about what work matters. That place got harder to find, not easier, as I added more tools.</p>
            <p data-reveal style="--d:2">So I stripped things back instead of adding more. Slate is the one app I use to plan and track everything in my business, as a founder running a lot of moving pieces day to day. I plan there. I hand work to my agents there. I review what comes back there. One place, not five.</p>
            <p data-reveal style="--d:3">If you want to get more done, the fastest path is often to simplify your tools, not add to them. That is what Slate is for me. It might not be the answer for you, but it is mine.</p>
          </div>
          <p class="note-sign" data-reveal style="--d:4">Owain Lewis<span>Founder, Slate</span></p>
        </section>
        <section class="landing-close">
          <h2 data-reveal>Begin with a clear slate.</h2>
          <p data-reveal style="--d:1">A short note about how you work is enough to get started.</p>
          <div data-reveal style="--d:2"><a class="landing-request" href="mailto:owain@gradientwork.com?subject=Slate access">Request access</a></div>
        </section>
      </main>
      <footer class="landing-footer">
        <span>slate.do</span>
        <div class="landing-footer-links">
          <a href="/cli">CLI guide</a>
          <a href="mailto:owain@gradientwork.com?subject=Slate access">Request access</a>
        </div>
      </footer>
    </section>`;
}

function appHTML() {
  const board = state.board;
  const theme = currentTheme();
  const lists = board?.buckets || [];
  const listsMode = state.boardMode === "lists";
  const flowMode = state.boardMode === "flow";
  const calendarMode = state.boardMode === "calendar";
  const todayMode = state.boardMode === "today";
  const headerDays = calendarMode ? weekDays() : daysInWeek(new Date());
  const boardLimitReached = state.boards.length >= state.maxBoards;
  const listLimitReached = lists.length >= state.maxListsPerBoard;
  return `
    <section class="shell theme-${theme}">
      <aside class="sidebar">
        <div class="sidebar-head">
          <button class="brand brand-button" type="button" data-home>slate<span>.do</span></button>
          <button class="icon-btn sidebar-toggle" id="sidebar-toggle" type="button" aria-label="Open navigation" aria-controls="sidebar-content" aria-expanded="false">${icon("menu")}</button>
        </div>
        <div class="sidebar-content" id="sidebar-content">
          <section class="nav-sec nav-boards">
            <h3>Boards</h3>
            <div class="pages">
              ${state.boards.map(boardRowHTML).join("")}
            </div>
            <div class="board-create">
              <button class="plain-btn icon-label" id="new-board" ${boardLimitReached ? 'disabled aria-describedby="board-limit"' : ""}>${icon("plus")}<span>New board</span></button>
              ${boardLimitReached ? `<p class="board-limit" id="board-limit">${state.maxBoards} board limit reached</p>` : ""}
            </div>
          </section>
          <section class="nav-sec nav-sec-footer">
            <button class="plain-btn icon-label" id="settings">${icon("gear")}<span>Settings</span></button>
            <button class="plain-btn icon-label" id="logout">${icon("signOut")}<span>Sign out</span></button>
          </section>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <span class="week">${formatWeekHeading(headerDays)}</span>
          <div class="top-actions">
            <div class="view-switch" aria-label="Board view">
              <button data-board-mode="lists" aria-pressed="${listsMode}" class="${listsMode ? "on" : ""}" title="Lists">${icon("rows")}<span>Lists</span></button>
              <button data-board-mode="flow" aria-pressed="${flowMode}" class="${flowMode ? "on" : ""}" title="Flow">${icon("kanban")}<span>Flow</span></button>
              <button data-board-mode="calendar" aria-pressed="${calendarMode}" class="${calendarMode ? "on" : ""}" title="Week">${icon("calendar")}<span>Week</span></button>
              <button data-board-mode="today" aria-pressed="${todayMode}" class="${todayMode ? "on" : ""}" title="Today">${icon("sun")}<span>Today</span></button>
            </div>
      <button class="icon-btn icon-label ${listsMode ? "" : "add-list-placeholder"}" id="add-list" ${listsMode ? (listLimitReached ? 'disabled aria-describedby="list-limit"' : "") : 'aria-hidden="true" tabindex="-1" disabled'}>${icon("plus")}<span>New list</span></button>
      ${listsMode && listLimitReached ? `<span class="board-limit" id="list-limit">${state.maxListsPerBoard} list Pro limit reached</span>` : ""}
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
  const activeLimit = Math.min(list.limitCount || DEFAULT_LIST_LIMIT, proLimits().activeItemsPerList);
  const activeLimitReached = (list.openCount || 0) >= activeLimit;
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
        ${tasks.length ? tasks.map(taskHTML).join("") : `<li class="empty-state">${icon("inboxTray")}<p>Nothing here yet</p></li>`}
      </ul>
    <form class="add-task" data-add-task="${list.id}">
    <button class="add-icon" type="submit" title="Add item" ${activeLimitReached ? 'disabled aria-describedby="item-limit-' + list.id + '"' : ""}>${icon("plus")}</button>
    <input name="title" placeholder="${activeLimitReached ? `Limit of ${activeLimit} active items reached` : "Add item"}" ${activeLimitReached ? 'disabled aria-describedby="item-limit-' + list.id + '"' : ""}>
  </form>
  ${activeLimitReached ? `<p class="board-limit" id="item-limit-${list.id}">${activeLimit} active item limit reached</p>` : ""}
  </section>`;
}

function proLimits() {
  return state.me?.entitlement?.limits || {
    boards: DEFAULT_MAX_BOARDS,
    listsPerBoard: DEFAULT_MAX_LISTS_PER_BOARD,
    activeItemsPerList: DEFAULT_LIST_LIMIT,
  };
}

function taskHTML(task) {
  return `
    <li class="task action ${task.done ? "done" : ""}" draggable="true" data-task="${task.id}">
      <button class="check" data-toggle-done="${task.id}" aria-pressed="${task.done}" aria-label="${task.done ? "Mark incomplete" : "Mark complete"}">${icon("check")}</button>
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
  const lists = board?.buckets || [];
  const selectedList = lists.find(list => list.id === state.flowListId);
  const actions = allTasks(board).filter(item => !selectedList || item.list.id === selectedList.id);
  return `
    <section class="flow-view" aria-label="Item flow">
      <div class="flow-toolbar">
        <label for="flow-list-filter">List</label>
        <select id="flow-list-filter" aria-label="Filter Flow by list">
          <option value="">All lists</option>
          ${lists.map(list => `<option value="${escapeAttr(list.id)}" ${list.id === selectedList?.id ? "selected" : ""}>${escapeHTML(list.name)}</option>`).join("")}
        </select>
      </div>
      <div class="flow">
        ${FLOW_STATES.map(state => flowColumnHTML(state, actions.filter(item => item.task.status === state.value))).join("")}
      </div>
    </section>`;
}

function flowColumnHTML(flowState, items) {
  return `
    <section class="flow-column" data-flow-status="${flowState.value}" aria-labelledby="flow-${flowState.value}">
      <header><h2 id="flow-${flowState.value}">${flowState.label}</h2><span>${items.length}</span></header>
      <ul class="flow-cards">
        ${items.length ? items.map(flowCardHTML).join("") : `<li class="flow-empty">Drag items here</li>`}
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
    </li>`;
}

function calendarHTML(board) {
  const days = weekDays();
  const tasks = allTasks(board);
  return `
    <section class="week-calendar">
      <div class="calendar-toolbar">
        <button class="icon-btn" id="previous-week" title="Previous week">${icon("chevronLeft")}</button>
        <button class="plain-btn" id="current-week">This week</button>
        <button class="plain-btn" id="next-week-jump" aria-label="Jump to next week">Next week</button>
        <b>${weekLabel()}</b>
        <button class="icon-btn next" id="next-week" aria-label="Show following week" title="Show following week">${icon("chevronLeft")}</button>
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
        ${items.length ? items.map(calendarTaskHTML).join("") : `<li class="calendar-empty">Drag items here</li>`}
      </ul>
    </section>`;
}

function calendarTaskHTML(item) {
  const { task, list } = item;
  return `
    <li class="task calendar-task action ${task.done ? "done" : ""}" draggable="true" data-task="${task.id}">
      <button class="check" data-toggle-done="${task.id}" aria-pressed="${task.done}" aria-label="${task.done ? "Mark incomplete" : "Mark complete"}">${icon("check")}</button>
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
        <ul>${actions.length ? actions.map(calendarTaskHTML).join("") : `<li class="today-empty">${icon("sun")}<p>Nothing planned for today</p></li>`}</ul>
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
  return `<footer class="footer"><span>${todayMode ? `${todayActionCount(board)} today` : `${openTaskCount(board)} open items`}</span><span class="foot-stat"><span class="dot dot-working"></span>${counts.working} working</span><span class="foot-stat"><span class="dot dot-review"></span>${counts.needs_review} in review</span></footer>`;
}

function statusErrorHTML(error) {
  return error ? `<p class="status-error" role="alert">${escapeHTML(error)}</p>` : "";
}

function settingsHTML() {
  const theme = currentTheme();
  return `
    <section class="settings-page theme-${theme}">
      <aside class="sidebar">
        <button class="brand brand-button" type="button" data-home>slate<span>.do</span></button>
        <section class="nav-sec">
          <button class="page-row on icon-label" id="back">${icon("chevronLeft")}<span>Board</span></button>
          <button class="plain-btn icon-label" id="settings-logout">${icon("signOut")}<span>Sign out</span></button>
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
          ${statusErrorHTML(state.error)}
          <section class="settings-section">
            <div class="settings-section-head">
              <h2>Appearance</h2>
              <p>Theme across Slate</p>
            </div>
            <div class="seg settings-theme">
              ${themes.map(item => `<button data-settings-theme="${item.id}" class="${theme === item.id ? "on" : ""}">${icon(item.id === "dark" ? "moon" : "sun")}<span>${item.label}</span></button>`).join("")}
            </div>
          </section>
          <section class="settings-section">
            <div class="settings-section-head">
              <h2>Lists</h2>
        <p>Max active items per list on this board</p>
            </div>
            <div class="limit-control settings-limit">
        <input id="settings-list-limit" aria-label="Max active items per list" type="number" min="1" max="${proLimits().activeItemsPerList}" value="${state.board?.maxTasksPerList || DEFAULT_LIST_LIMIT}">
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
      const authenticated = await establishAuthenticatedSession("/api/v1/auth/login", {
        email: form.get("email"),
        password: form.get("password"),
      });
      if (!authenticated) return;
      state.error = "";
      state.view = "app";
    } catch (err) {
      state.error = err.message;
    }
    render();
  });
  document.querySelector("#forgot-password").onclick = () => {
	state.view = "forgot-password";
	state.error = "";
	state.notice = "";
	render();
  };
}

function bindForgotPassword() {
  document.querySelectorAll("[data-home]").forEach(el => el.onclick = goHome);
  document.querySelector("#back-to-login").onclick = showLogin;
  document.querySelector("#forgot-password-form").addEventListener("submit", async event => {
	event.preventDefault();
	const formElement = event.currentTarget;
	const form = new FormData(formElement);
	try {
	  const result = await api.post("/api/v1/auth/password-reset/request", { email: form.get("email") });
	  state.error = "";
	  state.notice = result.message;
	  formElement.reset();
	} catch (err) {
	  state.notice = "";
	  state.error = err.message;
	}
	render();
  });
}

function bindResetPassword() {
  document.querySelectorAll("[data-home]").forEach(el => el.onclick = goHome);
  document.querySelector("#reset-back-to-login").onclick = showLogin;
  document.querySelector("#reset-password-form").addEventListener("submit", async event => {
	event.preventDefault();
	if (!state.resetToken) return;
	const form = new FormData(event.currentTarget);
	try {
	  await api.post("/api/v1/auth/password-reset/confirm", { token: state.resetToken, password: form.get("password") });
	  authVersion += 1;
	  resetAuthenticatedState();
	  state.resetToken = "";
	  state.notice = "Password reset. Sign in with your new password.";
	  history.replaceState({}, "", "/");
	  state.view = "login";
	} catch (err) {
	  state.error = err.message;
	}
	render();
  });
}

function bindEarlyAccess() {
  document.querySelectorAll("[data-home]").forEach(el => el.onclick = goHome);
  document.querySelector("#early-access-login").onclick = () => {
	history.replaceState({}, "", "/");
	showLogin();
  };
  document.querySelector("#early-access-form").addEventListener("submit", async (event) => {
	event.preventDefault();
	const form = new FormData(event.currentTarget);
	try {
	  const authenticated = await establishAuthenticatedSession("/api/v1/auth/register", {
		email: form.get("email"),
		password: form.get("password"),
		inviteCode: form.get("inviteCode"),
	  });
	  if (!authenticated) return;
	  state.error = "";
	  history.replaceState({}, "", "/");
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
  document.querySelectorAll(".tour-tab").forEach(tab => tab.addEventListener("click", () => {
    const name = tab.dataset.tour;
    document.querySelectorAll(".tour-tab").forEach(el => {
      const on = el === tab;
      el.classList.toggle("on", on);
      el.setAttribute("aria-selected", String(on));
    });
    document.querySelectorAll("[data-tour-img]").forEach(el => el.classList.toggle("on", el.dataset.tourImg === name));
    document.querySelectorAll("[data-tour-caption]").forEach(el => el.classList.toggle("on", el.dataset.tourCaption === name));
  }));
  const revealEls = document.querySelectorAll("[data-reveal]");
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || typeof IntersectionObserver === "undefined") {
    revealEls.forEach(el => el.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("in");
      io.unobserve(entry.target);
    });
  }, { threshold: 0.15, rootMargin: "0px 0px -60px 0px" });
  revealEls.forEach(el => io.observe(el));
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
  document.querySelector("#logout").onclick = logout;
  document.querySelector("#new-board").onclick = async () => {
    if (state.boards.length >= state.maxBoards) return;
    let board;
    await runMutation(async () => {
      board = await api.post("/api/v1/boards", { name: "Untitled board", maxTasksPerList: DEFAULT_LIST_LIMIT, backgroundKind: "theme", backgroundValue: currentTheme() });
      await api.post(`/api/v1/boards/${board.id}/buckets`, { name: "Inbox", isInbox: true });
      await api.post(`/api/v1/boards/${board.id}/buckets`, { name: "Focus" });
    }, async () => loadBoards(board?.id));
    render();
  };
  document.querySelectorAll("[data-board-mode]").forEach(el => el.onclick = () => {
    state.boardMode = el.dataset.boardMode;
    state.selectedTask = null;
    render();
  });
  document.querySelector("#flow-list-filter")?.addEventListener("change", event => {
    state.flowListId = event.target.value;
    state.selectedTask = null;
    render();
    document.querySelector("#flow-list-filter")?.focus();
  });
  document.querySelector("#previous-week")?.addEventListener("click", () => changeWeek(-7));
  document.querySelector("#next-week")?.addEventListener("click", () => changeWeek(7));
  document.querySelector("#current-week")?.addEventListener("click", () => { state.weekStart = ""; render(); });
  document.querySelector("#next-week-jump")?.addEventListener("click", () => {
    state.weekStart = dateKey(addDays(startOfWeek(new Date()), 7));
    render();
  });
  const addListButton = document.querySelector("#add-list");
  if (addListButton) addListButton.onclick = async () => {
    if ((state.board.buckets || []).length >= state.maxListsPerBoard) return;
    let list;
    await runMutation(
      async () => { list = await api.post(`/api/v1/boards/${state.board.id}/buckets`, { name: "New list" }); },
      async () => loadBoards(state.board.id),
    );
    render();
    if (list) document.querySelector(`[data-bucket="${list.id}"] input[data-bucket-name]`)?.focus();
  };
  document.querySelectorAll("[data-bucket-name]").forEach(el => el.addEventListener("change", async e => { await api.patch(`/api/v1/buckets/${el.dataset.bucketName}`, { name: e.target.value }); await reload(); }));
  document.querySelectorAll("[data-bucket-goal]").forEach(el => el.addEventListener("input", e => {
    const goal = e.target.value;
    const id = el.dataset.bucketGoal;
    const sessionVersion = authVersion;
    const userID = state.me?.id;
    const list = state.board.buckets.find(item => item.id === el.dataset.bucketGoal);
    if (list) list.goal = goal;
    delete state.goalErrors[id];
    clearTimeout(el.goalSaveTimer);
    el.goalSaveTimer = setTimeout(() => {
      if (!sessionIsCurrent(sessionVersion, userID)) return;
      const previous = goalSaveChains.get(id) || Promise.resolve();
      const next = previous.catch(() => {}).then(() => {
        if (!sessionIsCurrent(sessionVersion, userID)) return;
        return api.patch(`/api/v1/buckets/${id}`, { goal });
      });
      goalSaveChains.set(id, next);
      next.then(() => {
        if (sessionIsCurrent(sessionVersion, userID) && goalSaveChains.get(id) === next) delete state.goalErrors[id];
      }).catch(err => {
        if (sessionIsCurrent(sessionVersion, userID) && goalSaveChains.get(id) === next) {
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
  bindDrag();
  bindDetail();
}

async function deleteBoard(id) {
  const board = state.boards.find(item => item.id === id);
  if (!board || !confirm(`Delete "${board.name}" and all its lists and items?`)) return;
  const sessionVersion = authVersion;
  const userID = state.me?.id;
  await api.del(`/api/v1/boards/${id}`);
  if (!sessionIsCurrent(sessionVersion, userID)) return;
  state.selectedTask = null;
  state.board = null;
  if (!await loadBoards()) return;
  if (!sessionIsCurrent(sessionVersion, userID)) return;
  if (!state.board) {
    const next = await api.post("/api/v1/boards", { name: "Today", maxTasksPerList: DEFAULT_LIST_LIMIT, backgroundKind: "theme", backgroundValue: currentTheme() });
    if (!sessionIsCurrent(sessionVersion, userID)) return;
    await api.post(`/api/v1/boards/${next.id}/buckets`, { name: "Inbox", isInbox: true });
    if (!sessionIsCurrent(sessionVersion, userID)) return;
    await api.post(`/api/v1/boards/${next.id}/buckets`, { name: "Focus" });
    if (!sessionIsCurrent(sessionVersion, userID)) return;
    if (!await loadBoards(next.id)) return;
  }
  if (!sessionIsCurrent(sessionVersion, userID)) return;
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
    const activeView = document.querySelector('[data-board-mode][aria-pressed="true"]');
    const selectedBoard = document.querySelector(`[data-board="${state.board?.id}"]`);
    (trigger || triggers[0] || addInput || activeView || selectedBoard)?.focus();
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
  document.querySelector("#settings-logout").onclick = logout;
  document.querySelector("#settings-list-limit")?.addEventListener("change", async e => {
    const update = listLimitUpdate(state.board.id, e.target.value);
    e.target.value = update.next;
    try {
      await api.patch(update.path, update.input);
      state.error = "";
      await loadBoards(state.board?.id);
    } catch (err) {
      state.error = err.message;
    }
    render();
  });
  document.querySelectorAll("[data-settings-theme]").forEach(el => el.onclick = async () => {
    try {
      await updateTheme(el.dataset.settingsTheme);
    } catch (err) {
      state.error = err.message;
      render();
    }
  });
  document.querySelector("#token-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (await createAPIToken(form.get("name"))) render();
  });
  document.querySelectorAll("[data-revoke]").forEach(el => el.onclick = async () => {
    const sessionVersion = authVersion;
    const userID = state.me?.id;
    await api.del(`/api/v1/api-tokens/${el.dataset.revoke}`);
    if (!sessionIsCurrent(sessionVersion, userID)) return;
    if (await loadTokens(sessionVersion, userID)) render();
  });
}

async function openSettings(pushHistory) {
  if (!state.me || state.view === "logging-out" || state.view === "logout-error") return;
  const sessionVersion = authVersion;
  const userID = state.me?.id;
  if (!await loadTokens(sessionVersion, userID)) return;
  state.settings = true;
  state.view = "app";
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
  if (location.pathname === "/reset-password") history.replaceState({}, "", "/");
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
	if (location.pathname === "/early-access" || location.hash) history.replaceState({}, "", "/");
	if (location.pathname === "/reset-password") history.replaceState({}, "", "/");
  render();
}

async function addTask(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const title = new FormData(form).get("title").trim();
  if (!title) return;
  const list = state.board.buckets.find(b => b.id === form.dataset.addTask);
  const activeLimit = Math.min(list.limitCount || DEFAULT_LIST_LIMIT, proLimits().activeItemsPerList);
  if ((list.openCount || 0) >= activeLimit) return;
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

function sessionIsCurrent(sessionVersion, userID) {
  return sessionVersion === authVersion && state.me?.id === userID;
}

async function loadTokens(sessionVersion = authVersion, userID = state.me?.id) {
  const data = await api.get("/api/v1/api-tokens");
  if (!sessionIsCurrent(sessionVersion, userID)) return false;
  state.tokens = data.tokens;
  return true;
}

async function createAPIToken(name) {
  const sessionVersion = authVersion;
  const userID = state.me?.id;
  const data = await api.post("/api/v1/api-tokens", { name });
  if (!sessionIsCurrent(sessionVersion, userID)) return false;
  state.newToken = data.token;
  return loadTokens(sessionVersion, userID);
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
  return daysInWeek(calendarWeekStart());
}

function daysInWeek(value) {
  const start = startOfWeek(value);
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

function formatWeekHeading(days) {
  const first = days[0];
  const last = days[6];
  const firstLabel = `${first.toLocaleDateString(undefined, { month: "long" })} ${ordinal(first.getDate())}`;
  const lastLabel = `${last.toLocaleDateString(undefined, { month: "long" })} ${ordinal(last.getDate())} ${last.getFullYear()}`;
  const firstYear = first.getFullYear() === last.getFullYear() ? "" : ` ${first.getFullYear()}`;
  return `Week ${isoWeekNumber(first)} (${firstLabel}${firstYear} – ${lastLabel})`;
}

function isoWeekNumber(value) {
  const date = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function ordinal(value) {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;
  return `${value}${{ 1: "st", 2: "nd", 3: "rd" }[value % 10] || "th"}`;
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

function currentTheme() {
  return themeFor(state.theme || state.board?.backgroundValue);
}

async function updateTheme(value) {
  const theme = themeFor(value);
  const version = ++themeChangeVersion;
  const sessionVersion = authVersion;
  const userID = state.me?.id;
  state.theme = theme;
  render();
  const save = themeSaveChain.catch(() => {}).then(async () => {
    if (authVersion !== sessionVersion || state.me?.id !== userID) return;
    const user = await api.patch("/api/v1/me", { theme });
    if (authVersion !== sessionVersion || state.me?.id !== userID || user.id !== userID) return;
    state.me = user;
    if (version === themeChangeVersion) state.theme = themeFor(user.theme);
    state.error = "";
    render();
  }).catch(err => {
    if (authVersion !== sessionVersion) return;
    if (version === themeChangeVersion && authVersion === sessionVersion) {
      state.theme = themeFor(state.me?.theme);
      render();
    }
    throw err;
  });
  themeSaveChain = save;
  return save;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function escapeAttr(value) {
  return escapeHTML(value);
}

window.addEventListener("popstate", async () => {
  if (state.view === "logging-out" || state.view === "logout-error") {
    if (location.hash === "#settings") history.replaceState({}, "", location.pathname);
    render();
    return;
  }
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
