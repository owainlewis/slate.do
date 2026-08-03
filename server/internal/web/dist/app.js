const ICON_PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  pencil: '<path d="M4 20h4l10.7-10.7a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4.6C9 3.7 9.7 3 10.6 3h2.8c.9 0 1.6.7 1.6 1.6V7"/><path d="M18.4 7l-.8 12.4a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9L5.6 7"/><path d="M10 11v6M14 11v6"/>',
  archive: '<path d="M5 8v11h14V8M3.5 4h17v4h-17zM9 12h6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M15 8l2 2M17 6l2 2"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  rows: '<path d="M8.5 6h11.5M8.5 12h11.5M8.5 18h11.5"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  kanban: '<rect x="4" y="4.5" width="6.4" height="15" rx="1.6"/><rect x="13.6" y="4.5" width="6.4" height="10" rx="1.6"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4"/>',
  sun: '<circle cx="12" cy="12" r="3.6"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18"/>',
  moon: '<path d="M20 13.2A7.8 7.8 0 0 1 10.8 4a7.8 7.8 0 1 0 9.2 9.2z"/>',
  gear: '<circle cx="12" cy="12" r="3.1"/><path d="M12.6 2.6h-1.2a1.5 1.5 0 0 0-1.5 1.5v.3a1.5 1.5 0 0 1-.75 1.3l-.55.31a1.5 1.5 0 0 1-1.5 0l-.26-.14a1.5 1.5 0 0 0-2.05.54l-.6 1.04a1.5 1.5 0 0 0 .55 2.05l.26.15a1.5 1.5 0 0 1 .75 1.3v.62a1.5 1.5 0 0 1-.75 1.3l-.26.15a1.5 1.5 0 0 0-.55 2.05l.6 1.04a1.5 1.5 0 0 0 2.05.54l.26-.14a1.5 1.5 0 0 1 1.5 0l.55.31a1.5 1.5 0 0 1 .75 1.3v.3a1.5 1.5 0 0 0 1.5 1.5h1.2a1.5 1.5 0 0 0 1.5-1.5v-.3a1.5 1.5 0 0 1 .75-1.3l.55-.31a1.5 1.5 0 0 1 1.5 0l.26.14a1.5 1.5 0 0 0 2.05-.54l.6-1.04a1.5 1.5 0 0 0-.55-2.05l-.26-.15a1.5 1.5 0 0 1-.75-1.3v-.62a1.5 1.5 0 0 1 .75-1.3l.26-.15a1.5 1.5 0 0 0 .55-2.05l-.6-1.04a1.5 1.5 0 0 0-2.05-.54l-.26.14a1.5 1.5 0 0 1-1.5 0l-.55-.31a1.5 1.5 0 0 1-.75-1.3v-.3a1.5 1.5 0 0 0-1.5-1.5z"/>',
  user: '<circle cx="12" cy="8.2" r="3.2"/><path d="M5.8 19.5c.7-3.1 3-4.9 6.2-4.9s5.5 1.8 6.2 4.9"/>',
  bot: '<rect x="5" y="7" width="14" height="11" rx="3"/><path d="M12 7V4M9 12h.01M15 12h.01M9 15h6M3 11v3M21 11v3"/><circle cx="12" cy="3.5" r=".5" fill="currentColor" stroke="none"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  signOut: '<path d="M9.5 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2.5"/><path d="M15 8l4 4-4 4"/><path d="M9.5 12H19"/>',
  inboxTray: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 13h4.6a3.4 3.4 0 0 0 6.8 0H20"/>',
};

const AGENT_NAME_LIMIT = 100;
const AGENT_INSTRUCTIONS_BYTE_LIMIT = 4096;

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
    if (!res.ok) {
      const error = new Error(data.error || "Request failed");
      error.status = res.status;
      error.code = data.code || "";
      error.data = data;
      throw error;
    }
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

function utf8Length(value) {
  let bytes = 0;
  for (const character of String(value || "")) {
    const codePoint = character.codePointAt(0);
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function listLimitUpdate(boardId, value) {
  const next = Number(value);
  return { next, path: `/api/v1/boards/${boardId}`, input: { maxTasksPerList: next } };
}

function validateListLimit(value, maximum = accountLimits().activeItemsPerList) {
  const next = Number(value);
  if (!Number.isInteger(next)) return "Enter a whole number.";
  if (next < 1 || next > maximum) return `Enter a value from 1 to ${maximum}.`;
  return "";
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
  renamingBoardId: "",
  selectedTask: null,
  settings: false,
  settingsPage: "profile",
  view: "home",
  error: "",
  settingsNotice: "",
  settingsPending: "",
  themeStatus: "",
  authNotice: "",
  resetToken: "",
  goalErrors: {},
  newToken: "",
  newTokenOwnerID: "",
  tokens: [],
  agents: [],
  maxAgents: 5,
  activeAgents: 0,
  agentsLoadState: "idle",
  agentsLoadError: "",
  agentCreationResult: null,
  agentCreateNotice: "",
  credentialCopied: false,
  credentialCopyError: "",
  agentDetail: null,
  agentDetailLoadState: "idle",
  agentDetailError: "",
  agentWorkPage: null,
  agentAssignOpen: false,
  agentAssignError: "",
  agentAssignNotice: "",
  agentAssignBoardID: "",
  agentAssignDraft: null,
  agentTaskFocusID: "",
  agentLifecycleNotice: "",
  agentLifecycleError: "",
  agentLifecyclePending: "",
  agentLifecycleConfirm: "",
  agentArchiveConflict: null,
  agentCredentialResult: null,
  boardMode: "lists",
  flowListId: "",
  priorityFilter: "",
  weekStart: "",
  theme: "",
  moveNotice: null,
  routeError: null,
};

const themes = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const DEFAULT_LIST_LIMIT = 20;
const DEFAULT_MAX_BOARDS = 5;
const DEFAULT_MAX_LISTS_PER_BOARD = 9;
const DEFAULT_MAX_AGENTS = 5;
const FLOW_STATES = [
  { value: "queued", label: "Ready" },
  { value: "working", label: "Working" },
  { value: "needs_review", label: "Review" },
  { value: "done", label: "Done" },
];
const PRIORITIES = [
  { value: "p0", label: "P0" },
  { value: "p1", label: "P1" },
  { value: "p2", label: "P2" },
];

const HOME_PATH = "/";
const LOGIN_PATH = "/login";
const APP_PATH = "/app";
const SETTINGS_PATH = "/app/settings";
const SETTINGS_PAGES = [
  { id: "profile", label: "Profile", icon: "user", title: "Profile", description: "Your identity across Slate." },
  { id: "preferences", label: "Preferences", icon: "sun", title: "Preferences", description: "Choose how Slate looks for this account." },
  { id: "api", label: "API access", icon: "copy", title: "API access", description: "Manage personal access to the Slate CLI and API." },
];
const AGENTS_PATH = "/app/agents";
const NEW_AGENT_PATH = "/app/agents/new";
const EARLY_ACCESS_PATH = "/early-access";
const RESET_PASSWORD_PATH = "/reset-password";

function boardPath(id) {
  return `/app/boards/${encodeURIComponent(id)}`;
}

function boardSettingsPath(id) {
  return `${boardPath(id)}/settings`;
}

function settingsPath(page = "profile") {
  return `${SETTINGS_PATH}/${page}`;
}

function agentsPath() {
  return AGENTS_PATH;
}

function agentPath(id) {
  return `${AGENTS_PATH}/${encodeURIComponent(id)}`;
}

function agentWorkPath(id, page = 1) {
  const path = `${agentPath(id)}/work`;
  return page > 1 ? `${path}?page=${page}` : path;
}

function agentSettingsPath(id) {
  return `${agentPath(id)}/settings`;
}

function normalizePath(value) {
  const path = String(value ?? "").split("?")[0].split("#")[0];
  if (!path.startsWith("/")) return HOME_PATH;
  const trimmed = path.replace(/\/+$/, "");
  return trimmed || HOME_PATH;
}

// The single source of truth for which surface a URL names. Pure, so it is
// testable without a DOM, and shared by boot, navigate, and popstate.
function parseRoute(pathname) {
  const path = normalizePath(pathname);
  if (path === HOME_PATH) return { name: "home" };
  if (path === LOGIN_PATH) return { name: "login" };
  if (path === EARLY_ACCESS_PATH) return { name: "early-access" };
  if (path === RESET_PASSWORD_PATH) return { name: "reset-password" };
  if (path === APP_PATH) return { name: "app" };
  if (path === SETTINGS_PATH) return { name: "settings", settingsPage: "profile", redirect: true };
  if (path === `${SETTINGS_PATH}/agents`) return { name: "agents", redirect: true };
  if (path === AGENTS_PATH) return { name: "agents" };
  if (path === NEW_AGENT_PATH) return { name: "agent-new" };
  const agentWork = /^\/app\/agents\/([^/]+)\/work$/.exec(path);
  if (agentWork) {
    try {
      return { name: "agent-work", agentId: decodeURIComponent(agentWork[1]) };
    } catch {
      return { name: "not-found" };
    }
  }
  const agentSettings = /^\/app\/agents\/([^/]+)\/settings$/.exec(path);
  if (agentSettings) {
    try {
      return { name: "agent-settings", agentId: decodeURIComponent(agentSettings[1]) };
    } catch {
      return { name: "not-found" };
    }
  }
  const agentDetail = /^\/app\/agents\/([^/]+)$/.exec(path);
  if (agentDetail) {
    try {
      return { name: "agent-detail", agentId: decodeURIComponent(agentDetail[1]) };
    } catch {
      return { name: "not-found" };
    }
  }
  const settings = /^\/app\/settings\/([^/]+)$/.exec(path);
  if (settings && SETTINGS_PAGES.some(page => page.id === settings[1])) {
    return { name: "settings", settingsPage: settings[1] };
  }
  const boardSettings = /^\/app\/boards\/([^/]+)\/settings$/.exec(path);
  if (boardSettings) {
    try {
      return { name: "board-settings", boardId: decodeURIComponent(boardSettings[1]) };
    } catch {
      return { name: "not-found" };
    }
  }
  const board = /^\/app\/boards\/([^/]+)$/.exec(path);
  if (board) {
    try {
      return { name: "board", boardId: decodeURIComponent(board[1]) };
    } catch {
      return { name: "not-found" };
    }
  }
  return { name: "not-found" };
}

function isProtectedRoute(name) {
  return name === "app" || name === "board" || name === "board-settings" || name === "settings"
    || name === "agents" || name === "agent-new" || name === "agent-detail" || name === "agent-work" || name === "agent-settings";
}

// Only same-origin app paths may be returned to after login. Anything else,
// including protocol-relative and backslash forms, falls back to the default.
function safeNextPath(value) {
  if (typeof value !== "string") return "";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "";
  const withoutHash = value.split("#")[0];
  const queryIndex = withoutHash.indexOf("?");
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const search = queryIndex >= 0 ? withoutHash.slice(queryIndex) : "";
  const path = normalizePath(pathname);
  return isProtectedRoute(parseRoute(path).name) ? `${path}${search}` : "";
}

function loginPathFor(target) {
  const next = safeNextPath(target);
  return next && next !== APP_PATH ? `${LOGIN_PATH}?next=${encodeURIComponent(next)}` : LOGIN_PATH;
}

function currentPath() {
  return normalizePath(location.pathname);
}

function currentLocationPath() {
  return `${location.pathname}${location.search || ""}`;
}

function syncPath(path) {
  if (currentPath() !== normalizePath(path)) history.replaceState({}, "", path);
}

function navigate(path, options = {}) {
  const nextRoute = parseRoute(path);
  clearSettingsCredentialsLeaving(nextRoute.name === "settings" ? nextRoute.settingsPage : "");
  clearAgentCredentialLeaving(nextRoute);
  if (options.replace || currentLocationPath() === path) history.replaceState({}, "", path);
  else history.pushState({}, "", path);
  return applyRoute();
}

let routeVersion = 0;

function handleAgentUnauthorized(err, route = parseRoute(location.pathname)) {
  if (err?.status !== 401 || !["agent-detail", "agent-work", "agent-settings"].includes(route.name)) return false;
  state.agents = [];
  state.activeAgents = 0;
  state.agentsLoadState = "idle";
  state.agentsLoadError = "";
  state.agentDetail = null;
  state.agentWorkPage = null;
  state.selectedTask = null;
  state.agentAssignOpen = false;
  state.agentAssignError = "";
  state.agentAssignNotice = "";
  state.agentAssignBoardID = "";
  state.agentAssignDraft = null;
  state.agentTaskFocusID = "";
  state.agentLifecycleNotice = "";
  state.agentLifecycleError = "";
  state.agentLifecyclePending = "";
  state.agentLifecycleConfirm = "";
  state.agentArchiveConflict = null;
  clearAgentLifecycleCredential();
  state.agentDetailLoadState = "unauthorized";
  state.agentDetailError = err.message;
  state.settings = false;
  state.settingsPage = "profile";
  state.view = route.name;
  render();
  return true;
}

function prepareAgentRoute(route) {
  state.settings = false;
  state.settingsPage = "profile";
  state.view = route.name;
  state.selectedTask = null;
  state.agentDetail = null;
  state.agentWorkPage = null;
  state.agentAssignOpen = false;
  state.agentAssignError = "";
  state.agentAssignNotice = "";
  state.agentAssignBoardID = "";
  state.agentAssignDraft = null;
  state.agentTaskFocusID = "";
  state.agentLifecycleNotice = "";
  state.agentLifecycleError = "";
  state.agentLifecyclePending = "";
  state.agentLifecycleConfirm = "";
  state.agentArchiveConflict = null;
  state.agentDetailLoadState = "loading";
  state.agentDetailError = "";
  render();
}

// Renders whatever surface the current URL names, redirecting when the URL is
// not reachable in the current auth state. Every navigation funnels through here.
async function applyRoute() {
  const version = ++routeVersion;
  const route = parseRoute(location.pathname);
  if (route.name !== "board" && !["agent-detail", "agent-work", "agent-settings"].includes(route.name)) state.selectedTask = null;
  state.error = "";
  state.settingsNotice = "";
  state.settingsPending = "";
  state.routeError = null;

  if (route.name === "reset-password") return showRoute("reset-password", readResetToken);
  if (route.name === "early-access") {
    if (state.me) return navigate(APP_PATH, { replace: true });
    return showRoute("early-access");
  }
  if (route.name === "home") return showRoute("home");
  if (route.name === "not-found") return showRoute("not-found");
  if (route.name === "login") {
    if (state.me) return navigate(safeNextPath(new URLSearchParams(location.search).get("next")) || APP_PATH, { replace: true });
    return showRoute("login");
  }
  if (!state.me) return navigate(loginPathFor(currentLocationPath()), { replace: true });
  if (route.redirect) {
    return route.name === "agents"
      ? navigate(AGENTS_PATH, { replace: true })
      : navigate(settingsPath(route.settingsPage), { replace: true });
  }
  if (["agent-detail", "agent-work", "agent-settings"].includes(route.name)) prepareAgentRoute(route);
  try {
    if (!await loadBoardList(version)) return;
    if (routeVersion !== version) return;
    if (route.name === "agents" || route.name === "agent-new") {
      state.settings = false;
      state.settingsPage = "profile";
      state.view = route.name;
      state.agentsLoadState = "loading";
      state.agentsLoadError = "";
      render();
      try {
        await loadAgents(false, authVersion, state.me?.id, version);
      } catch (err) {
        if (routeVersion !== version) return;
        state.agentsLoadState = "error";
        state.agentsLoadError = err.message;
        render();
        return;
      }
      if (routeVersion !== version) return;
      state.agentsLoadState = "ready";
      render();
      return;
    }
    if (["agent-detail", "agent-work", "agent-settings"].includes(route.name)) {
      await loadAgents(true, authVersion, state.me?.id, version);
      if (routeVersion !== version) return;
      try {
        const requestedPage = route.name === "agent-work" ? workPageFromLocation() : 1;
        const loaded = await loadAgentDetail(route.agentId, {
          includeWorkPage: route.name === "agent-work",
          page: requestedPage,
          sessionVersion: authVersion,
          userID: state.me?.id,
          expectedRouteVersion: version,
        });
        if (!loaded || routeVersion !== version) return;
      } catch (err) {
        if (routeVersion !== version) return;
        if (handleAgentUnauthorized(err, route)) return;
        state.agentDetail = null;
        state.agentWorkPage = null;
        state.agentDetailLoadState = err.status === 404 ? "not-found" : err.status === 401 || err.status === 403 ? "unauthorized" : "error";
        state.agentDetailError = err.message;
        render();
        return;
      }
      state.agentDetailLoadState = "ready";
      render();
      return;
    }
    await loadAgents(true, authVersion, state.me?.id, version);
    if (routeVersion !== version) return;

    if (route.name === "app") {
      const first = state.boards[0]?.id;
      if (first) return navigate(boardPath(first), { replace: true });
      state.board = null;
      return showRoute("app");
    }
    if (route.name === "board" || route.name === "board-settings") {
      if (!state.boards.some(board => board.id === route.boardId)) {
        if (route.name === "board-settings") {
          state.error = "This board does not exist or is no longer available to you.";
          state.routeError = route;
          return showRoute("route-error");
        }
        return showRoute("not-found");
      }
      if (state.board?.id !== route.boardId && !await loadBoard(route.boardId, authVersion, version)) return;
      if (routeVersion !== version) return;
      if (route.name === "board-settings") return showRoute("board-settings");
      return showRoute("app");
    }
    if (route.settingsPage === "api" && !await loadTokens(authVersion, state.me?.id, version)) return;
    if (routeVersion !== version) return;
    state.view = "app";
    state.settings = true;
    state.settingsPage = route.settingsPage;
    render();
  } catch (err) {
    if (routeVersion !== version) return;
    if (handleAgentUnauthorized(err, route)) return;
    state.error = err.message;
    state.routeError = route;
    showRoute("route-error");
  }
}

// Settings is the one surface that sets its own flag, immediately below.
// Every other route clears it, so leaving /app/settings by any means closes it.
function showRoute(view, before) {
  state.settings = false;
  state.settingsPage = "profile";
  if (before) before();
  state.view = view;
  render();
}

function readResetToken() {
  if (!location.hash) return;
  state.resetToken = new URLSearchParams(location.hash.slice(1)).get("token") || "";
  history.replaceState({}, "", RESET_PASSWORD_PATH);
}

async function boot() {
  try {
    const me = await api.get("/api/v1/me");
    if (me.authenticated) beginAuthenticatedSession(me.user);
    // Legacy /#settings deep link from before settings had its own route.
    if (location.hash === "#settings") {
      history.replaceState({}, "", state.me ? SETTINGS_PATH : HOME_PATH);
    }
    await applyRoute();
    return;
  } catch (err) {
    state.error = err.message;
  }
  render();
}

async function loadBoardList(expectedRouteVersion) {
  const sessionVersion = authVersion;
  const data = await api.get("/api/v1/boards");
  if (sessionVersion !== authVersion || (expectedRouteVersion !== undefined && expectedRouteVersion !== routeVersion)) return false;
  state.boards = data.boards;
  state.maxBoards = data.maxBoards || accountLimits().boards;
  return true;
}

async function loadBoards(selectId, expectedRouteVersion) {
  const sessionVersion = authVersion;
  if (!await loadBoardList(expectedRouteVersion)) return false;
  const requestedId = selectId || state.board?.id;
  const nextId = state.boards.some(board => board.id === requestedId) ? requestedId : state.boards[0]?.id;
  if (nextId) {
    if (!await loadBoard(nextId, sessionVersion, expectedRouteVersion)) return false;
  } else {
    if (expectedRouteVersion !== undefined && expectedRouteVersion !== routeVersion) return false;
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
  state.renamingBoardId = "";
  state.selectedTask = null;
  state.settings = false;
  state.settingsPage = "profile";
  state.error = "";
  state.settingsNotice = "";
  state.settingsPending = "";
  state.themeStatus = "";
  state.notice = "";
  state.goalErrors = {};
  state.newToken = "";
  state.newTokenOwnerID = "";
  state.tokens = [];
  state.agents = [];
  state.maxAgents = DEFAULT_MAX_AGENTS;
  state.activeAgents = 0;
  state.agentsLoadState = "idle";
  state.agentsLoadError = "";
  state.agentCreationResult = null;
  state.agentCreateNotice = "";
  state.credentialCopied = false;
  state.credentialCopyError = "";
  state.agentDetail = null;
  state.agentDetailLoadState = "idle";
  state.agentDetailError = "";
  state.agentWorkPage = null;
  state.agentAssignOpen = false;
  state.agentAssignError = "";
  state.agentAssignNotice = "";
  state.agentAssignBoardID = "";
  state.agentAssignDraft = null;
  state.agentTaskFocusID = "";
  state.agentLifecycleNotice = "";
  state.agentLifecycleError = "";
  state.agentLifecyclePending = "";
  state.agentLifecycleConfirm = "";
  state.agentArchiveConflict = null;
  state.agentCredentialResult = null;
  state.boardMode = "lists";
  state.flowListId = "";
  state.priorityFilter = "";
  state.weekStart = "";
  state.theme = "";
  state.routeError = null;
}

function beginAuthenticatedSession(user) {
  authVersion += 1;
  resetAuthenticatedState();
  state.me = user;
  state.maxBoards = accountLimits().boards;
  state.maxListsPerBoard = accountLimits().listsPerBoard;
  state.theme = themeFor(user.theme);
}

async function establishAuthenticatedSession(path, input) {
  if (authenticationRequest) return false;
  const request = (async () => {
    if (logoutRequest) await logoutRequest;
    await api.post(path, input);
    const me = await api.get("/api/v1/me");
    beginAuthenticatedSession(me.user);
    return true;
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
  render();
  const request = api.post("/api/v1/auth/logout").then(() => navigate(LOGIN_PATH, { replace: true })).catch(() => {
    state.error = "Sign out failed. Your session may still be active. Try again.";
    state.view = "logout-error";
    render();
  }).finally(() => {
    if (logoutRequest === request) logoutRequest = null;
  });
  logoutRequest = request;
  return request;
}

async function loadBoard(id, sessionVersion = authVersion, expectedRouteVersion) {
  const previousBoardID = state.board?.id || "";
  let board = await api.get(`/api/v1/boards/${id}`);
  if (sessionVersion !== authVersion || (expectedRouteVersion !== undefined && expectedRouteVersion !== routeVersion)) return false;
  const staleNames = (board.buckets || []).filter(list => list.name === "New bucket");
  if (staleNames.length) {
    try {
      await Promise.all(staleNames.map(list => api.patch(`/api/v1/buckets/${list.id}`, { name: "New list" })));
      if (sessionVersion !== authVersion || (expectedRouteVersion !== undefined && expectedRouteVersion !== routeVersion)) return false;
      board = await api.get(`/api/v1/boards/${id}`);
    } catch (err) {
      if (sessionVersion !== authVersion || (expectedRouteVersion !== undefined && expectedRouteVersion !== routeVersion)) return false;
      throw err;
    }
    if (sessionVersion !== authVersion || (expectedRouteVersion !== undefined && expectedRouteVersion !== routeVersion)) return false;
  }
  const changedBoard = previousBoardID && previousBoardID !== board.id;
  state.board = board;
  if (!(board.buckets || []).some(list => list.id === state.flowListId)) state.flowListId = "";
  // A filter carried onto another board can render every column empty, which
  // reads as a broken board rather than an active filter.
  if (changedBoard) state.priorityFilter = "";
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
  if (state.view === "not-found") {
    root.innerHTML = notFoundHTML();
    bindNotFound();
    return;
  }
  if (state.view === "route-error") {
    root.innerHTML = routeErrorHTML();
    bindRouteError();
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
    syncPath(settingsPath(state.settingsPage));
    root.innerHTML = settingsHTML();
    bindSettings();
    return;
  }
  if (state.view === "board-settings") {
    syncPath(boardSettingsPath(state.board.id));
    root.innerHTML = boardSettingsHTML();
    bindBoardSettings();
    return;
  }
  if (state.view === "agents" || state.view === "agent-new") {
    syncPath(state.view === "agent-new" ? NEW_AGENT_PATH : AGENTS_PATH);
    root.innerHTML = agentsHTML();
    bindAgents();
    return;
  }
  if (state.view === "agent-detail" || state.view === "agent-work" || state.view === "agent-settings") {
    const agentID = state.agentDetail?.agent?.id || parseRoute(location.pathname).agentId || "";
    syncPath(state.view === "agent-work"
      ? agentWorkPath(agentID, state.agentWorkPage?.page || workPageFromLocation())
      : state.view === "agent-settings" ? agentSettingsPath(agentID) : agentPath(agentID));
    root.innerHTML = agentDetailHTML();
    bindAgentDetail();
    return;
  }
  // Whenever a board is on screen its id belongs in the URL, however it was selected.
  syncPath(state.board ? boardPath(state.board.id) : APP_PATH);
  root.innerHTML = appHTML();
  bindApp();
}

function renderKeepingSidebarOpen(open) {
  render();
  if (!open) return;
  const sidebar = document.querySelector(".sidebar");
  const toggle = document.querySelector("#sidebar-toggle");
  sidebar?.classList.add("open");
  toggle?.setAttribute("aria-expanded", "true");
  toggle?.setAttribute("aria-label", "Close navigation");
}

function notFoundHTML() {
  return `
    <section class="login">
      <div>
        <button class="brand brand-button" type="button" data-home>slate<span>.do</span></button>
        <h1>Not found.</h1>
        <p>That page does not exist${state.me ? ", or the board is no longer available to you" : ""}.</p>
        <button class="primary" id="not-found-continue" type="button">${state.me ? "Open app" : "Go to slate.do"}</button>
      </div>
    </section>`;
}

function bindNotFound() {
  document.querySelectorAll("[data-home]").forEach(el => el.onclick = goHome);
  document.querySelector("#not-found-continue").onclick = state.me ? openApp : goHome;
}

function routeErrorHTML() {
  const settingsPage = SETTINGS_PAGES.find(page => page.id === state.routeError?.settingsPage);
  const target = settingsPage
    ? `${settingsPage.title} settings`
    : state.routeError?.name === "board-settings"
      ? "board settings"
    : state.routeError?.name === "settings"
      ? "settings"
      : state.routeError?.name === "board"
        ? "this board"
        : state.routeError?.name === "agents" || state.routeError?.name === "agent-new"
          || state.routeError?.name === "agent-detail" || state.routeError?.name === "agent-work" || state.routeError?.name === "agent-settings"
          ? "agents"
          : "the app";
  return `
    <section class="login">
      <div>
        <button class="brand brand-button" type="button" data-home>slate<span>.do</span></button>
        <h1>Couldn’t load ${target}.</h1>
        <p class="error" role="alert">${escapeHTML(state.error || "Something went wrong. Try again.")}</p>
        <button class="primary" id="route-error-retry" type="button">Try again</button>
      </div>
    </section>`;
}

function bindRouteError() {
  document.querySelectorAll("[data-home]").forEach(el => el.onclick = goHome);
  document.querySelector("#route-error-retry").onclick = applyRoute;
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
        <p class="notice" role="status">${escapeHTML(state.authNotice)}</p>
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
        <p class="notice reset-notice" role="status">${escapeHTML(state.authNotice)}</p>
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
            <p class="landing-lede rise" style="--d:1">Work is infinite. Attention is not. Slate is one plan you and your agents share. You decide what matters. They pick up the work and hand it back done. A few lists, a hard cap on open work, and one honest view of today.</p>
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
            <span class="tour-caption" data-tour-caption="flow">You and your agents move work through the same four states.</span>
            <span class="tour-caption" data-tour-caption="week">See the week before you're already in it.</span>
          </p>
        </section>
        <section class="landing-principles">
          <h2 class="principles-head" data-reveal>Less, on purpose.</h2>
          <p class="principles-sub" data-reveal style="--d:0">You do not get more done by taking on more. You get more done by being clear about what matters, then giving the rest to agents that can run it in parallel.</p>
          <div class="principle" data-reveal style="--d:0">
            <span class="principle-num">01</span>
            <h3>Limits, not lists</h3>
            <p>Every list caps its open actions. When a list is full, something has to finish before anything new begins.</p>
          </div>
          <div class="principle" data-reveal style="--d:1">
            <span class="principle-num">02</span>
            <h3>One shared state</h3>
            <p>Every item is completable and moves through the same four states. You and your agents are always reading the same truth.</p>
          </div>
          <div class="principle" data-reveal style="--d:2">
            <span class="principle-num">03</span>
            <h3>You think, they execute</h3>
            <p>Agents read the plan, claim work, and return it finished. You keep the judgement. They cover the ground. Together you get through far more than either could alone.</p>
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
            <p data-reveal style="--d:1">Then agents changed how much one person can execute. The limit moved. It is no longer how much work you can do, it is how clearly you can say what is worth doing. More tools made that harder to see, not easier.</p>
            <p data-reveal style="--d:2">So I stripped things back instead of adding more. Slate is the one app I use to plan and track everything in my business, as a founder running a lot of moving pieces day to day. I plan there. I hand work to my agents there. I review what comes back there. One place, not five.</p>
            <p data-reveal style="--d:3">If you want to get more done, the fastest path is usually to simplify, not to add. Fewer tools, clearer priorities, and a team of agents that can act on them. That is what Slate is for me.</p>
          </div>
          <p class="note-sign" data-reveal style="--d:4">Owain Lewis<span>Founder, Slate</span></p>
        </section>
        <section class="landing-close">
          <h2 data-reveal>Begin with a clear slate.</h2>
          <p data-reveal style="--d:1">Bring your work and your agents. A short note about how you work is enough to get started.</p>
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
      ${appSidebarHTML({ theme, boardLimitReached })}
      <div class="main">
        <header class="topbar">
          <span class="week">${formatWeekHeading(headerDays)}</span>
          <div class="top-actions">
            <span class="current-user">${userAvatarHTML(state.me, { small: true })}</span>
            <div class="view-switch" aria-label="Board view">
              <button data-board-mode="lists" aria-pressed="${listsMode}" class="${listsMode ? "on" : ""}" title="Lists">${icon("rows")}<span>Lists</span></button>
              <button data-board-mode="flow" aria-pressed="${flowMode}" class="${flowMode ? "on" : ""}" title="Flow">${icon("kanban")}<span>Flow</span></button>
              <button data-board-mode="calendar" aria-pressed="${calendarMode}" class="${calendarMode ? "on" : ""}" title="Week">${icon("calendar")}<span>Week</span></button>
              <button data-board-mode="today" aria-pressed="${todayMode}" class="${todayMode ? "on" : ""}" title="Today">${icon("sun")}<span>Today</span></button>
            </div>
      <button class="icon-btn icon-label ${listsMode ? "" : "add-list-placeholder"}" id="add-list" ${listsMode ? (listLimitReached ? 'disabled aria-describedby="list-limit"' : "") : 'aria-hidden="true" tabindex="-1" disabled'}>${icon("plus")}<span>New list</span></button>
      ${listsMode && listLimitReached ? `<span class="board-limit" id="list-limit">${state.maxListsPerBoard} list ${planLabel()} limit reached</span>` : ""}
          </div>
        </header>
        ${statusErrorHTML(state.error)}
        ${statusNoticeHTML(state.moveNotice)}
        ${listsMode ? priorityToolbarHTML() : ""}
        ${flowMode ? flowHTML(board) : calendarMode ? calendarHTML(board) : todayMode ? todayHTML(board) : `<div class="grid">${lists.map(listHTML).join("")}</div>`}
        ${footerHTML(board, todayMode)}
      </div>
      ${state.selectedTask ? detailHTML(state.selectedTask) : ""}
    </section>`;
}

function appSidebarHTML({ theme = currentTheme(), agentsCurrent = false, boardLimitReached = state.boards.length >= state.maxBoards } = {}) {
  return `
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
        <section class="nav-sec nav-collaborators">
          <h3>Collaborators</h3>
          <a class="plain-btn icon-label nav-link ${agentsCurrent ? "on" : ""}" id="agents-nav" href="${AGENTS_PATH}" ${agentsCurrent ? 'aria-current="page"' : ""}>${icon("bot")}<span>Agents</span></a>
        </section>
        <section class="nav-sec nav-sec-footer">
          ${themeSwitchHTML(theme)}
          <button class="plain-btn icon-label" id="settings">${icon("gear")}<span>Settings</span></button>
          <button class="plain-btn icon-label" id="logout">${icon("signOut")}<span>Sign out</span></button>
        </section>
      </div>
    </aside>`;
}

function themeSwitchHTML(theme) {
  return `
    <div class="theme-switch ${theme}" role="group" aria-label="Theme">
      <span class="theme-switch-thumb" aria-hidden="true"></span>
      ${themes.map(item => `<button type="button" data-set-theme="${item.id}" class="${theme === item.id ? "on" : ""}" aria-pressed="${theme === item.id}" title="${item.label} theme">${icon(item.id === "dark" ? "moon" : "sun")}<span>${item.label}</span></button>`).join("")}
    </div>`;
}

function boardRowHTML(board) {
  const current = board.id === state.board?.id;
  if (board.id === state.renamingBoardId) {
    return `
      <div class="board-row board-row-editing ${current ? "on" : ""}">
        <form class="board-rename" data-rename-board="${board.id}" novalidate>
          <div class="board-rename-controls">
            <input name="name" aria-label="Board name" aria-describedby="board-rename-error-${board.id}" value="${escapeAttr(board.name)}" autocomplete="off">
            <button type="submit" aria-label="Save board name" title="Save board name">${icon("check")}</button>
            <button type="button" data-cancel-rename-board="${board.id}" aria-label="Cancel board rename" title="Cancel">${icon("x")}</button>
          </div>
          <p class="error board-rename-error" id="board-rename-error-${board.id}" role="alert"></p>
        </form>
      </div>`;
  }
  return `
    <div class="board-row ${current ? "on" : ""}">
      <button class="board-select" data-board="${board.id}"><span>${escapeHTML(board.name)}</span></button>
      <div class="board-actions">
        <button data-board-settings="${board.id}" aria-label="Board settings for ${escapeAttr(board.name)}" title="Board settings">${icon("gear")}</button>
        <button data-start-rename-board="${board.id}" aria-label="Rename ${escapeAttr(board.name)}" title="Rename board">${icon("pencil")}</button>
        <button data-delete-board="${board.id}" aria-label="Delete ${escapeAttr(board.name)}" title="Delete board">${icon("trash")}</button>
      </div>
    </div>`;
}

function priorityToolbarHTML() {
  const selected = state.priorityFilter;
  return `
    <div class="priority-toolbar">
      <label for="priority-filter">Priority</label>
      <select id="priority-filter" aria-label="Filter board by priority">
        <option value="">All items</option>
        ${PRIORITIES.map(p => `<option value="${escapeAttr(p.value)}" ${p.value === selected ? "selected" : ""}>${escapeHTML(p.label)} only</option>`).join("")}
      </select>
    </div>`;
}

function priorityMatches(task) {
  return !state.priorityFilter || task.priority === state.priorityFilter;
}

function emptyListMessage() {
  if (!state.priorityFilter) return "Nothing here yet";
  return `No ${priorityLabel(state.priorityFilter)} items`;
}

function listHTML(list) {
  const over = list.openCount > list.limitCount ? "over-limit" : "";
  const tasks = (list.tasks || []).filter(priorityMatches);
  const activeLimit = Math.min(list.limitCount || DEFAULT_LIST_LIMIT, accountLimits().activeItemsPerList);
  const activeLimitReached = (list.openCount || 0) >= activeLimit;
  // New items carry no priority, so adding one under a filter would create it
  // and immediately hide it. Block the form instead of failing silently.
  const addBlocked = activeLimitReached || Boolean(state.priorityFilter);
  const addPlaceholder = activeLimitReached
    ? `Limit of ${activeLimit} active items reached`
    : state.priorityFilter
      ? "Clear the filter to add items"
      : "Add item";
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
        ${tasks.length ? tasks.map(taskHTML).join("") : `<li class="empty-state">${icon("inboxTray")}<p>${escapeHTML(emptyListMessage())}</p></li>`}
      </ul>
    <form class="add-task" data-add-task="${list.id}">
    <button class="add-icon" type="submit" title="Add item" ${addBlocked ? "disabled" : ""} ${activeLimitReached ? 'aria-describedby="item-limit-' + list.id + '"' : ""}>${icon("plus")}</button>
    <input name="title" placeholder="${addPlaceholder}" ${addBlocked ? "disabled" : ""} ${activeLimitReached ? 'aria-describedby="item-limit-' + list.id + '"' : ""}>
  </form>
  ${activeLimitReached ? `<p class="board-limit" id="item-limit-${list.id}">${activeLimit} active item limit reached</p>` : ""}
  </section>`;
}

function accountLimits() {
  return state.me?.entitlement?.limits || {
    boards: DEFAULT_MAX_BOARDS,
    listsPerBoard: DEFAULT_MAX_LISTS_PER_BOARD,
    activeItemsPerList: DEFAULT_LIST_LIMIT,
    agents: DEFAULT_MAX_AGENTS,
    storedTasks: 10000,
    storedContentBytes: 250 * 1024 * 1024,
    apiTokens: 20,
  };
}

function planLabel() {
  return state.me?.entitlement?.plan === "pro" ? "Pro" : "Free";
}

function avatarTone(id) {
  let hash = 0;
  for (const character of String(id || "")) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % 6;
}

function avatarHTML(identity, options = {}) {
  if (!identity) return "";
  const name = identity.displayName || identity.email || "User";
  const inactive = Boolean(identity.archivedAt || identity.deletedAt);
  const label = inactive ? `${name} (archived)` : name;
  const accessibility = options.decorative ? 'aria-hidden="true"' : `title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}"`;
  return `<span class="avatar agent-avatar tone-${avatarTone(identity.id)} ${options.small ? "avatar-small" : ""} ${options.large ? "avatar-large" : ""} ${inactive ? "avatar-inactive" : ""}" ${accessibility}>${icon("bot")}</span>`;
}

function userAvatarHTML(identity, options = {}) {
  if (!identity) return "";
  const label = identity.displayName || identity.email || "User";
  return `<span class="avatar user-avatar tone-${avatarTone(identity.id)} ${options.small ? "avatar-small" : ""} ${options.large ? "avatar-large" : ""}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">${icon("user")}</span>`;
}

function taskAgent(task) {
  return state.agents.find(agent => agent.id === task.assigneeAgentId);
}

function taskAssigneeHTML(task, showName = false) {
  const agent = taskAgent(task);
  if (!agent) return "";
  return `<span class="task-assignee">${avatarHTML(agent, { small: true })}${showName ? `<span>${escapeHTML(agent.displayName)}${agent.deletedAt ? " (inactive)" : ""}</span>` : ""}</span>`;
}

function taskHTML(task) {
  return `
    <li class="task action ${task.done ? "done" : ""}" draggable="true" data-task="${task.id}">
      <button class="check" data-toggle-done="${task.id}" aria-pressed="${task.done}" aria-label="${task.done ? "Mark incomplete" : "Mark complete"}">${icon("check")}</button>
      <button class="task-body task-open" type="button" data-open-task="${task.id}" aria-label="${escapeAttr(task.title)}">
        <div class="task-title">${escapeHTML(task.title)}${taskPriorityBadgeHTML(task)}${taskStateBadgeHTML(task)}</div>
        ${task.scheduledDate ? `<span class="task-date">${formatTaskDate(task.scheduledDate)}</span>` : ""}
      </button>
      ${taskAssigneeHTML(task)}
    </li>`;
}

function taskStateBadgeHTML(task) {
  if (task.status === "queued" || task.status === "done") return "";
  return `<span class="state-badge state-${task.status}">${escapeHTML(statusLabel(task.status))}</span>`;
}

function taskPriorityBadgeHTML(task) {
  if (!task.priority) return "";
  return `<span class="priority-badge priority-${task.priority}">${escapeHTML(priorityLabel(task.priority))}</span>`;
}

function priorityLabel(priority) {
  return PRIORITIES.find(p => p.value === priority)?.label || "";
}

function priorityOptionsHTML(selected) {
  const options = [{ value: "", label: "None" }].concat(PRIORITIES);
  return options.map(p => `<option value="${escapeAttr(p.value)}" ${p.value === (selected || "") ? "selected" : ""}>${escapeHTML(p.label)}</option>`).join("");
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
      <button class="task-open flow-card-open" type="button" data-open-task="${task.id}" aria-label="${escapeAttr(task.title)}">
        <span class="flow-card-title">${escapeHTML(task.title)}</span>
        <span class="flow-card-meta"><span>${escapeHTML(list.name)}</span>${task.scheduledDate ? `<span>${formatTaskDate(task.scheduledDate)}</span>` : ""}${taskAssigneeHTML(task, true)}</span>
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
      <button class="task-body task-open" type="button" data-open-task="${task.id}" aria-label="${escapeAttr(task.title)}">
        <div class="task-title">${escapeHTML(task.title)}</div>
        <span class="task-list-name">${escapeHTML(list.name)}</span>
      </button>
      ${taskAssigneeHTML(task)}
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
              <div class="field"><label for="detail-priority">Priority</label><select id="detail-priority" name="priority">${priorityOptionsHTML(task.priority)}</select></div>
              <div class="field"><label for="detail-assignee">Agent</label><select id="detail-assignee" name="assigneeAgentId">${agentOptionsHTML(task.assigneeAgentId)}</select></div>
              <div class="field"><label>Location</label><button class="location-button" id="open-move" type="button"><span>${escapeHTML(state.board.name)} / ${escapeHTML(list?.name || "List")}</span><b>Move…</b></button></div>
              <div class="field"><label for="detail-date">Plan for</label><input id="detail-date" name="scheduledDate" type="date" value="${escapeAttr(task.scheduledDate || "")}"></div>
            </div>
            <section class="move-panel" id="move-panel" aria-labelledby="move-heading" hidden>
              <div class="move-panel-head"><div><span>Change location</span><h3 id="move-heading">Move item</h3></div><button class="detail-close" id="close-move" type="button" aria-label="Close move options">${icon("x")}</button></div>
              <div class="move-fields">
                <div class="field"><label for="move-board">Board</label><select id="move-board">${state.boards.map(board => `<option value="${board.id}" ${board.id === state.board.id ? "selected" : ""}>${escapeHTML(board.name)}</option>`).join("")}</select></div>
                <div class="field"><label for="move-list">List</label><select id="move-list">${moveListOptionsHTML(state.board, task)}</select></div>
                <div class="field"><label for="move-position">Position</label><select id="move-position">${movePositionOptionsHTML(list, task)}</select></div>
              </div>
              <div class="move-panel-actions"><button class="primary" id="move-item" type="button">Move item</button></div>
            </section>
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

function agentOptionsHTML(selectedID = "") {
  const selectedExists = state.agents.some(agent => agent.id === selectedID);
  return [
    `<option value="" ${selectedID ? "" : "selected"}>Unassigned</option>`,
    ...state.agents
      .filter(agent => !agent.deletedAt || agent.id === selectedID)
      .map(agent => `<option value="${escapeAttr(agent.id)}" ${agent.id === selectedID ? "selected" : ""} ${agent.deletedAt ? "disabled" : ""}>${escapeHTML(agent.displayName)}${agent.deletedAt ? " (inactive)" : ""}</option>`),
    selectedID && !selectedExists ? `<option value="${escapeAttr(selectedID)}" selected>Assigned agent unavailable</option>` : "",
  ].join("");
}

function moveListOptionsHTML(board, task, selectedID = task.bucketId) {
  return (board?.buckets || []).map(list => {
    const limit = Math.min(list.limitCount || DEFAULT_LIST_LIMIT, accountLimits().activeItemsPerList);
    const full = task.kind === "action" && !task.done && list.id !== task.bucketId && (list.openCount || 0) >= limit;
    return `<option value="${list.id}" ${list.id === selectedID ? "selected" : ""} ${full ? "disabled" : ""}>${escapeHTML(list.name)}${full ? ` (${list.openCount}/${limit} full)` : ""}</option>`;
  }).join("");
}

function movePositionOptionsHTML(list, task) {
  const listTasks = list?.tasks || [];
  const tasks = listTasks.filter(item => item.id !== task.id);
  const currentIndex = list?.id === task.bucketId ? Math.max(0, listTasks.findIndex(item => item.id === task.id)) : tasks.length;
  return Array.from({ length: tasks.length + 1 }, (_, index) => {
    const suffix = index === 0 ? " (top)" : index === tasks.length ? " (bottom)" : "";
    return `<option value="${index}" ${index === currentIndex ? "selected" : ""}>${index + 1}${suffix}</option>`;
  }).join("");
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

function statusNoticeHTML(notice) {
  if (!notice) return "";
  return `<div class="status-notice" role="status"><span>${escapeHTML(notice.message)}</span><button id="view-moved-item" type="button">View</button><button id="dismiss-notice" type="button" aria-label="Dismiss">${icon("x")}</button></div>`;
}

function agentsHTML() {
  const theme = currentTheme();
  const onNew = state.view === "agent-new";
  const active = state.agents.filter(agent => !agent.archivedAt && !agent.deletedAt);
  const archived = state.agents.filter(agent => agent.archivedAt || agent.deletedAt);
  const limitReached = state.activeAgents >= state.maxAgents;
  return `
    <section class="shell agents-shell theme-${theme}">
      ${appSidebarHTML({ theme, agentsCurrent: true })}
      <main class="agents-main">
        <div class="agents-wrap">
          <header class="agents-head">
            <div>
              ${onNew ? `<a class="back-link" href="${AGENTS_PATH}" id="agents-back">${icon("chevronLeft")}<span>Agents</span></a>` : '<p class="eyebrow">Collaborators</p>'}
              <h1>${onNew ? (state.agentCreationResult ? "Connect your agent" : "New agent") : "Agents"}</h1>
              <p>${onNew
                ? (state.agentCreationResult ? "Save this credential, then verify the connection from your agent’s environment." : "Give this collaborator a clear identity and purpose.")
                : "External agents can pick up only the work assigned to them in Slate."}</p>
            </div>
            ${!onNew && active.length ? `<a class="primary agents-new-action ${limitReached ? "disabled" : ""}" href="${NEW_AGENT_PATH}" id="new-agent-link" ${limitReached ? 'aria-disabled="true" aria-describedby="agents-limit"' : ""}>${icon("plus")}<span>New agent</span></a>` : ""}
          </header>
          ${statusErrorHTML(state.error)}
          ${state.agentsLoadState === "loading" ? agentsLoadingHTML() : ""}
          ${state.agentsLoadState === "error" ? agentsErrorHTML() : ""}
          ${state.agentsLoadState === "ready" && onNew ? newAgentHTML(limitReached) : ""}
          ${state.agentsLoadState === "ready" && !onNew ? agentDirectoryHTML(active, archived, limitReached) : ""}
        </div>
      </main>
    </section>`;
}

function agentsLoadingHTML() {
  return `
    <section class="agents-state" aria-live="polite" aria-busy="true">
      <span class="agent-loading-mark">${icon("bot")}</span>
      <h2>Loading agents…</h2>
      <p>Checking identities, credentials, and assigned work.</p>
    </section>`;
}

function agentsErrorHTML() {
  return `
    <section class="agents-state agent-error-state">
      <span class="agent-state-icon">${icon("bot")}</span>
      <h2>Agents couldn’t be loaded.</h2>
      <p class="error" role="alert">${escapeHTML(state.agentsLoadError || "Try again.")}</p>
      <button class="secondary" id="retry-agents" type="button">Try again</button>
    </section>`;
}

function agentDirectoryHTML(active, archived, limitReached) {
  return `
    <section aria-labelledby="active-agents-heading">
      <div class="agent-directory-meta">
        <div>
          <h2 id="active-agents-heading">Active agents <span>${active.length}</span></h2>
          <p id="agents-limit">${limitReached
            ? `${state.maxAgents} of ${state.maxAgents} active agents. Archive an agent before creating another.`
            : `${state.activeAgents} of ${state.maxAgents} active agent slots used.`}</p>
        </div>
      </div>
      ${active.length ? `<div class="agent-directory">${active.map(agentRowHTML).join("")}</div>` : `
        <section class="agents-empty">
          <span class="agent-state-icon">${icon("bot")}</span>
          <h2>Bring an agent into the plan.</h2>
          <p>An agent is an external collaborator with its own identity and credential. Assign it work when you are ready.</p>
          <a class="primary" href="${NEW_AGENT_PATH}" id="empty-new-agent">${icon("plus")}<span>New agent</span></a>
        </section>`}
      ${archived.length ? `
        <details class="archived-agents">
          <summary>Archived <span>${archived.length}</span></summary>
          <p>Archived identities stay visible for assignment history and cannot connect.</p>
          <div class="agent-directory archived-agent-directory">${archived.map(agentRowHTML).join("")}</div>
        </details>` : ""}
    </section>`;
}

function agentRowHTML(agent) {
  const stateLabel = agentConnectionState(agent);
  const counts = agent.workCounts || {};
  const assigned = Number(counts.ready || 0) + Number(counts.working || 0) + Number(counts.review || 0);
  const countParts = [
    counts.ready ? formatCount(counts.ready, "ready item", "ready items") : "",
    counts.working ? formatCount(counts.working, "working item", "working items") : "",
    counts.review ? formatCount(counts.review, "review item", "review items") : "",
  ].filter(Boolean);
  const archived = stateLabel === "Archived";
  return `
    <article class="agent-directory-row ${archived ? "archived" : ""}">
      <a class="agent-directory-link" href="${agentPath(agent.id)}" data-agent-link="${escapeAttr(agent.id)}">
        ${avatarHTML(agent, { large: true, decorative: true })}
        <div class="agent-identity">
          <div class="agent-name-line">
            <h3>${escapeHTML(agent.displayName)}</h3>
            <span class="connection-state state-${stateLabel.toLowerCase().replace(/\s+/g, "-")}">${escapeHTML(stateLabel)}</span>
          </div>
          <p class="agent-purpose">${escapeHTML(agent.purpose || "No purpose added")}</p>
        </div>
        <dl class="agent-facts">
          <div><dt>Assigned work</dt><dd>${assigned ? countParts.join(" · ") : "No open work assigned"}</dd></div>
          <div><dt>Last credential use</dt><dd>${formatLastUse(agent.credential?.lastUsedAt || agent.lastUsedAt)}</dd></div>
        </dl>
        <span class="agent-row-arrow" aria-hidden="true">${icon("chevronLeft")}</span>
      </a>
    </article>`;
}

function agentConnectionState(agent) {
  if (agent.archivedAt || agent.deletedAt) return "Archived";
  const credential = agent.credential;
  if (credential && !credential.revokedAt) return "Connected";
  return "Needs connection";
}

function formatLastUse(value) {
  if (!value) return "Never used";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function agentDetailHTML() {
  const theme = currentTheme();
  return `
    <section class="shell agents-shell theme-${theme}">
      ${appSidebarHTML({ theme, agentsCurrent: true })}
      <main class="agents-main">
        <div class="agents-wrap agent-detail-wrap">
          <a class="back-link" href="${AGENTS_PATH}" id="agent-detail-back">${icon("chevronLeft")}<span>Agents</span></a>
          ${agentDetailBodyHTML()}
        </div>
      </main>
      ${state.selectedTask ? detailHTML(state.selectedTask) : ""}
      ${state.agentAssignOpen ? assignWorkHTML() : ""}
      ${state.agentLifecycleConfirm ? agentLifecycleConfirmHTML() : ""}
    </section>`;
}

function agentDetailBodyHTML() {
  if (state.agentDetailLoadState === "loading") {
    return `
      <section class="agents-state agent-detail-state" aria-live="polite" aria-busy="true">
        <span class="agent-loading-mark">${icon("bot")}</span>
        <h1>Loading agent…</h1>
        <p>Finding this identity and its assigned work.</p>
      </section>`;
  }
  if (state.agentDetailLoadState === "not-found") {
    return `
      <section class="agents-state agent-detail-state">
        <span class="agent-state-icon">${icon("bot")}</span>
        <h1>Agent not found.</h1>
        <p>This identity does not exist, or it belongs to another account.</p>
        <a class="secondary" href="${AGENTS_PATH}" data-agent-directory>View agents</a>
      </section>`;
  }
  if (state.agentDetailLoadState === "unauthorized") {
    return `
      <section class="agents-state agent-detail-state">
        <span class="agent-state-icon">${icon("signOut")}</span>
        <h1>Your session has expired.</h1>
        <p>No agent or assigned-work data is being shown. Sign in again to continue.</p>
        <button class="primary" id="agent-detail-sign-in" type="button">Sign in</button>
      </section>`;
  }
  if (state.agentDetailLoadState === "error" || !state.agentDetail) {
    return `
      <section class="agents-state agent-error-state agent-detail-state">
        <span class="agent-state-icon">${icon("bot")}</span>
        <h1>Agent couldn’t be loaded.</h1>
        <p class="error" role="alert">${escapeHTML(state.agentDetailError || "Try again.")}</p>
        <button class="secondary" id="retry-agent-detail" type="button">Try again</button>
      </section>`;
  }
  const agent = state.agentDetail.agent;
  const archived = Boolean(agent.archivedAt || agent.deletedAt);
  const current = state.view === "agent-work" ? "work" : state.view === "agent-settings" ? "settings" : "overview";
  return `
    <header class="agent-detail-head">
      <div class="agent-detail-identity">
        ${avatarHTML(agent, { large: true, decorative: true })}
        <div>
          <div class="agent-name-line">
            <h1>${escapeHTML(agent.displayName)}</h1>
            <span class="connection-state state-${agentConnectionState(agent).toLowerCase().replace(/\s+/g, "-")}">${escapeHTML(agentConnectionState(agent))}</span>
          </div>
          <p>${escapeHTML(agent.purpose || "No purpose added")}</p>
          <p class="agent-last-used">Last credential use: ${escapeHTML(formatLastUse(agent.credential?.lastUsedAt || agent.lastUsedAt))}</p>
        </div>
      </div>
      ${archived || current === "settings" ? "" : `<button class="primary icon-label" id="assign-work" type="button">${icon("plus")}<span>Assign work</span></button>`}
    </header>
    <nav class="agent-tabs" aria-label="Agent sections" role="tablist">
      <a id="agent-tab-overview" href="${agentPath(agent.id)}" role="tab" tabindex="${current === "overview" ? "0" : "-1"}" aria-selected="${current === "overview"}" aria-controls="agent-panel-overview" ${current === "overview" ? 'aria-current="page"' : ""} data-agent-tab>Overview</a>
      <a id="agent-tab-work" href="${agentWorkPath(agent.id)}" role="tab" tabindex="${current === "work" ? "0" : "-1"}" aria-selected="${current === "work"}" aria-controls="agent-panel-work" ${current === "work" ? 'aria-current="page"' : ""} data-agent-tab>Work</a>
      <a id="agent-tab-settings" href="${agentSettingsPath(agent.id)}" role="tab" tabindex="${current === "settings" ? "0" : "-1"}" aria-selected="${current === "settings"}" aria-controls="agent-panel-settings" ${current === "settings" ? 'aria-current="page"' : ""} data-agent-tab>Settings</a>
    </nav>
    ${archived ? `
      <section class="agent-archived-note" role="status">
        <strong>Archived identity</strong>
        <p>This agent cannot connect or receive new work. Its assigned task history stays available.</p>
      </section>` : ""}
    ${state.agentAssignNotice ? `<p class="agent-detail-notice" role="status">${escapeHTML(state.agentAssignNotice)}</p>` : ""}
    <section id="agent-panel-overview" class="agent-tab-panel" role="tabpanel" aria-labelledby="agent-tab-overview" tabindex="0" ${current === "overview" ? "" : "hidden"}>
      ${current === "overview" ? agentOverviewHTML(agent) : ""}
    </section>
    <section id="agent-panel-work" class="agent-tab-panel" role="tabpanel" aria-labelledby="agent-tab-work" tabindex="0" ${current === "work" ? "" : "hidden"}>
      ${current === "work" ? agentWorkPageHTML(agent) : ""}
    </section>
    <section id="agent-panel-settings" class="agent-tab-panel" role="tabpanel" aria-labelledby="agent-tab-settings" tabindex="0" ${current === "settings" ? "" : "hidden"}>
      ${current === "settings" ? agentSettingsHTML(agent) : ""}
    </section>
  `;
}

function agentSettingsHTML(agent) {
  const archived = Boolean(agent.archivedAt || agent.deletedAt);
  const connected = agentConnectionState(agent) === "Connected";
  if (state.agentCredentialResult?.ownerID === state.me?.id && state.agentCredentialResult?.agentID === agent.id) {
    return agentRotationResultHTML(agent, state.agentCredentialResult);
  }
  return `
    ${state.agentLifecycleNotice ? `<p class="agent-detail-notice" role="status">${escapeHTML(state.agentLifecycleNotice)}</p>` : ""}
    ${state.agentLifecycleError ? `<p class="status-error" role="alert">${escapeHTML(state.agentLifecycleError)}</p>` : ""}
    <form class="agent-settings-card" id="agent-identity-form" novalidate>
      <header><div><p class="eyebrow">Identity</p><h2>Name and purpose</h2></div><span>Immutable ID ${escapeHTML(agent.id)}</span></header>
      <label class="agent-create-field"><span class="field-title">Name</span><input id="agent-settings-name" name="displayName" value="${escapeAttr(agent.displayName)}" required aria-describedby="agent-settings-name-error"><small class="error" id="agent-settings-name-error"></small></label>
      <label class="agent-create-field"><span class="field-title">Purpose</span><textarea id="agent-settings-purpose" name="purpose" aria-describedby="agent-settings-purpose-error">${escapeHTML(agent.purpose || "")}</textarea><small class="error" id="agent-settings-purpose-error"></small></label>
      <div class="agent-settings-actions"><button class="primary" type="submit" ${state.agentLifecyclePending ? "disabled" : ""}>${state.agentLifecyclePending === "identity" ? "Saving…" : "Save changes"}</button></div>
    </form>
    <section class="agent-settings-card" aria-labelledby="credential-settings-heading">
      <header><div><p class="eyebrow">Credential</p><h2 id="credential-settings-heading">${connected ? "Connected" : "Needs connection"}</h2></div>${icon("key")}</header>
      <p>${archived ? "Archived agents cannot connect. Restore this identity before creating a new credential." : connected ? "Only this agent’s assigned work is available through its active credential." : "Create a new credential to connect this identity again."}</p>
      ${archived ? "" : `<div class="agent-settings-actions">
        <button class="secondary icon-label" id="rotate-agent-credential" type="button" ${state.agentLifecyclePending ? "disabled" : ""}>${icon("key")}<span>${connected ? "Rotate credential" : "Create credential"}</span></button>
        ${connected ? `<button class="secondary danger-text" id="revoke-agent-credential" type="button" ${state.agentLifecyclePending ? "disabled" : ""}>Revoke credential</button>` : ""}
      </div>`}
    </section>
    <section class="agent-settings-card agent-danger-zone" aria-labelledby="agent-lifecycle-heading">
      <header><div><p class="eyebrow">Lifecycle</p><h2 id="agent-lifecycle-heading">${archived ? "Restore identity" : "Archive agent"}</h2></div>${icon("archive")}</header>
      <p>${archived ? "Restore this identity as Needs connection. Historical assignments remain attached." : "Archiving removes this agent from assignment choices and revokes every credential. Review and Done history remains attached."}</p>
      <div class="agent-settings-actions"><button class="${archived ? "secondary" : "danger"}" id="${archived ? "restore-agent" : "archive-agent"}" type="button" ${state.agentLifecyclePending ? "disabled" : ""}>${archived ? "Restore agent" : "Archive agent"}</button></div>
    </section>`;
}

function agentRotationResultHTML(agent, result) {
  return `
    <section class="agent-connection-result agent-lifecycle-secret" aria-labelledby="rotation-result-heading">
      <div class="connection-agent">${avatarHTML(agent, { decorative: true })}<div><p>Credential rotated</p><h2 id="rotation-result-heading">Connect ${escapeHTML(agent.displayName)}</h2></div></div>
      <div class="credential-warning"><strong>Copy this credential now.</strong><p>Slate stores only its hash. This value disappears when you leave or refresh this page.</p></div>
      <div class="credential-value"><code id="agent-lifecycle-credential" tabindex="0">${escapeHTML(result.token)}</code><button class="secondary icon-label" id="copy-lifecycle-credential" type="button">${icon(state.credentialCopied ? "check" : "copy")}<span>${state.credentialCopied ? "Copied" : "Copy"}</span></button></div>
      <p class="error credential-copy-error" id="lifecycle-copy-error">${escapeHTML(state.credentialCopyError)}</p>
      <div class="credential-steps"><p><span>1</span><code>export SLATE_API_TOKEN=${escapeHTML(result.token)}</code></p><p><span>2</span><code>slate auth status</code></p></div>
      ${state.agentLifecycleNotice ? `<p class="agent-create-notice" role="status">${escapeHTML(state.agentLifecycleNotice)}</p>` : ""}
      <div class="agent-settings-actions"><button class="primary" id="finish-lifecycle-credential" type="button">Done</button></div>
    </section>`;
}

function agentLifecycleConfirmHTML() {
  const agent = state.agentDetail.agent;
  const action = state.agentLifecycleConfirm;
  const pending = Boolean(state.agentLifecyclePending);
  const conflict = state.agentArchiveConflict;
  const config = {
    rotate: {
      title: agentConnectionState(agent) === "Connected" ? "Rotate credential?" : "Create credential?",
      body: agentConnectionState(agent) === "Connected"
        ? "The current credential will stop working as soon as the replacement is created."
        : "A one-time credential will be created for this identity.",
      confirm: agentConnectionState(agent) === "Connected" ? "Rotate credential" : "Create credential",
    },
    revoke: {
      title: "Revoke credential?",
      body: "The agent will become Needs connection. All assigned work stays assigned.",
      confirm: "Revoke credential",
    },
    archive: {
      title: conflict ? "Open work is still assigned." : "Archive this agent?",
      body: conflict
        ? `${formatCount(conflict.ready, "Ready item", "Ready items")} and ${formatCount(conflict.working, "Working item", "Working items")} must be unassigned. Review and Done history will remain attached.`
        : "Credentials will be revoked and the identity will leave assignment choices. Slate will first check for Ready and Working work.",
      confirm: conflict ? "Unassign open work and archive" : "Archive agent",
    },
    restore: {
      title: "Restore this identity?",
      body: "It will return as Needs connection and use one active agent slot. Existing credentials stay revoked.",
      confirm: "Restore agent",
    },
  }[action];
  return `
    <div class="detail-overlay agent-lifecycle-overlay">
      <section class="agent-lifecycle-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-lifecycle-confirm-heading" ${pending ? 'aria-busy="true"' : ""}>
        <header><span class="agent-state-icon">${icon(action === "rotate" ? "key" : action === "restore" ? "bot" : "archive")}</span><div><h2 id="agent-lifecycle-confirm-heading">${escapeHTML(config.title)}</h2><p>${escapeHTML(config.body)}</p></div></header>
        ${pending ? '<p class="agent-lifecycle-pending" id="agent-lifecycle-pending" role="status" tabindex="-1">Working… Keep this page open.</p>' : ""}
        ${state.agentLifecycleError ? `<p class="status-error" role="alert">${escapeHTML(state.agentLifecycleError)}</p>` : ""}
        <footer><button class="secondary" id="cancel-agent-lifecycle" type="button" ${pending ? "disabled" : ""}>Cancel</button><button class="${action === "rotate" || action === "restore" ? "primary" : "danger"}" id="confirm-agent-lifecycle" type="button" ${pending ? "disabled" : ""}>${pending ? "Working…" : escapeHTML(config.confirm)}</button></footer>
      </section>
    </div>`;
}

function agentOverviewHTML(agent) {
  const work = state.agentDetail.work;
  const working = work.working || [];
  const totalOpen = Number(work.totals?.ready || 0) + Number(work.totals?.working || 0) + Number(work.totals?.review || 0);
  const total = totalOpen + Number(work.totals?.completed || 0);
  return `
    <section class="agent-current" aria-labelledby="agent-current-heading">
      <div class="agent-section-heading">
        <div>
          <p class="eyebrow">Current focus</p>
          <h2 id="agent-current-heading">Working now</h2>
        </div>
        <span>${Number(work.totals?.working || 0)}</span>
      </div>
      ${working.length ? `<div class="agent-current-list">${working.map(item => agentWorkItemHTML(item)).join("")}</div>` : `
        <div class="agent-no-current">${icon("inboxTray")}<p>${escapeHTML(agent.displayName)} has no active work.</p></div>`}
    </section>
    <div class="agent-work-groups">
      ${agentWorkSectionHTML("Ready", "Work assigned and ready to pick up.", work.ready, work.totals?.ready, "queued")}
      ${agentWorkSectionHTML("Review", "Work waiting for human review.", work.review, work.totals?.review, "needs_review")}
      ${agentWorkSectionHTML("Recently completed", "Current completed tasks, sorted by their latest update. This is not run history.", work.recentlyCompleted, work.totals?.completed, "done")}
    </div>
    ${total ? `
      <div class="agent-view-all">
        <a class="secondary icon-label" href="${agentWorkPath(agent.id)}" data-agent-tab>${icon("rows")}<span>View all work</span></a>
        <p>${formatCount(total, "assigned item", "assigned items")} in current task data.</p>
      </div>` : ""}
  `;
}

function agentWorkSectionHTML(title, description, items = [], total = 0, status = "") {
  return `
    <section class="agent-work-section state-group-${status}" aria-labelledby="agent-work-${status}">
      <header>
        <div><h2 id="agent-work-${status}">${title}</h2><p>${description}</p></div>
        <span>${Number(total || 0)}</span>
      </header>
      ${items.length ? `<div class="agent-work-list">${items.map(item => agentWorkItemHTML(item)).join("")}</div>` : `<p class="agent-work-empty">No ${title.toLowerCase()} items.</p>`}
      ${Number(total || 0) > items.length ? `<p class="agent-work-truncated">Showing ${items.length} of ${Number(total)}. View all work for the rest.</p>` : ""}
    </section>`;
}

function agentWorkItemHTML(item) {
  return `
    <button class="agent-work-item" type="button" data-open-task="${escapeAttr(item.id)}" data-open-agent-task="${escapeAttr(item.id)}" data-agent-task-board="${escapeAttr(item.boardId)}">
      <span class="agent-work-title">${escapeHTML(item.title)}</span>
      <span class="agent-work-meta">
        <span class="state-badge state-${escapeAttr(item.status)}">${escapeHTML(statusLabel(item.status))}</span>
        <span>${escapeHTML(item.boardName)} / ${escapeHTML(item.bucketName)}</span>
        <span>Updated ${escapeHTML(formatUpdatedAt(item.updatedAt))}</span>
      </span>
    </button>`;
}

function agentWorkPageHTML(agent) {
  const page = state.agentWorkPage;
  if (!page) {
    return `<section class="agents-state agent-detail-state"><h2>Work couldn’t be loaded.</h2><button class="secondary" id="retry-agent-detail" type="button">Try again</button></section>`;
  }
  const groups = [
    ["Ready", "queued"],
    ["Working", "working"],
    ["Review", "needs_review"],
    ["Completed", "done"],
  ];
  return `
    <section class="agent-all-work" aria-labelledby="all-work-heading">
      <header class="agent-section-heading">
        <div><p class="eyebrow">Assigned tasks</p><h2 id="all-work-heading">All work</h2></div>
        <span>${Number(page.total || 0)}</span>
      </header>
      ${page.items?.length ? groups.map(([label, status]) => {
        const items = page.items.filter(item => status === "done" ? item.done || item.status === "done" : !item.done && item.status === status);
        return items.length ? `<section class="agent-page-group"><h3>${label}</h3><div class="agent-work-list">${items.map(agentWorkItemHTML).join("")}</div></section>` : "";
      }).join("") : `<div class="agents-empty agent-work-page-empty"><span class="agent-state-icon">${icon("inboxTray")}</span><h2>No assigned work.</h2><p>${escapeHTML(agent.displayName)} has no current or completed task data.</p></div>`}
      ${page.total ? `
        <nav class="agent-pagination" aria-label="Assigned work pages">
          <a class="secondary ${page.hasPrevious ? "" : "disabled"}" href="${agentWorkPath(agent.id, page.page - 1)}" data-work-page="${page.page - 1}" ${page.hasPrevious ? "" : 'aria-disabled="true"'}>Previous</a>
          <span>Page ${page.page} · ${page.items.length} of ${page.total}</span>
          <a class="secondary ${page.hasNext ? "" : "disabled"}" href="${agentWorkPath(agent.id, page.page + 1)}" data-work-page="${page.page + 1}" ${page.hasNext ? "" : 'aria-disabled="true"'}>Next</a>
        </nav>` : ""}
    </section>`;
}

function assignWorkHTML() {
  const agent = state.agentDetail.agent;
  const draft = state.agentAssignDraft || {};
  const selectedBoardID = state.agentAssignBoardID || state.board?.id || state.boards[0]?.id || "";
  const selectedBoard = state.board?.id === selectedBoardID ? state.board : null;
  const lists = selectedBoard?.buckets || [];
  const availableLists = lists.filter(list => {
    const limit = Math.min(list.limitCount || DEFAULT_LIST_LIMIT, accountLimits().activeItemsPerList);
    return (list.openCount || 0) < limit;
  });
  return `
    <div class="detail-overlay" data-assign-overlay>
      <section class="detail assign-work-dialog" role="dialog" aria-modal="true" aria-labelledby="assign-work-heading">
        <header class="detail-head">
          <div class="detail-context"><span>Agents</span><span aria-hidden="true">/</span><b id="assign-work-heading">Assign work</b></div>
          <button class="detail-close" type="button" data-close-assign aria-label="Close assign work" title="Close">${icon("x")}</button>
        </header>
        <form id="assign-work-form" novalidate>
          <div class="detail-body">
            <div class="assign-agent-summary">${avatarHTML(agent, { decorative: true })}<span><small>Assigning to</small><strong>${escapeHTML(agent.displayName)}</strong></span></div>
            <label class="sr-only" for="assign-title">Title</label>
            <input class="detail-title" id="assign-title" name="title" type="text" value="${escapeAttr(draft.title || "")}" placeholder="What needs doing?" autocomplete="off" required aria-describedby="assign-error">
            <label class="sr-only" for="assign-description">Description</label>
            <textarea class="detail-description" id="assign-description" name="description" placeholder="Add a description…">${escapeHTML(draft.description || "")}</textarea>
            <div class="detail-properties" aria-label="Item properties">
              <div class="field"><label for="assign-board">Board</label><select id="assign-board" name="boardId">${state.boards.map(board => `<option value="${escapeAttr(board.id)}" ${board.id === selectedBoardID ? "selected" : ""}>${escapeHTML(board.name)}</option>`).join("")}</select></div>
              <div class="field"><label for="assign-list">List</label><select id="assign-list" name="bucketId" ${availableLists.length ? "" : "disabled"}>${lists.map(list => {
                const limit = Math.min(list.limitCount || DEFAULT_LIST_LIMIT, accountLimits().activeItemsPerList);
                const full = (list.openCount || 0) >= limit;
                return `<option value="${escapeAttr(list.id)}" ${list.id === draft.bucketId ? "selected" : ""} ${full ? "disabled" : ""}>${escapeHTML(list.name)}${full ? ` (${list.openCount}/${limit} full)` : ""}</option>`;
              }).join("") || '<option value="">No available lists</option>'}</select></div>
              <div class="field"><label for="assign-date">Plan for</label><input id="assign-date" name="scheduledDate" type="date" value="${escapeAttr(draft.scheduledDate || "")}"></div>
            </div>
            <p class="error detail-error" id="assign-error" role="alert">${escapeHTML(state.agentAssignError)}</p>
          </div>
          <footer class="detail-actions assign-actions">
            <span></span>
            <div>
              <button class="secondary" type="button" data-close-assign>Cancel</button>
              <button class="primary" type="submit" ${availableLists.length ? "" : "disabled"}>Create item</button>
            </div>
          </footer>
        </form>
      </section>
    </div>`;
}

function formatUpdatedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function newAgentHTML(limitReached) {
  if (state.agentCreationResult) return agentConnectionResultHTML(state.agentCreationResult);
  if (limitReached) {
    return `
      <section class="agents-state agent-limit-state">
        <span class="agent-state-icon">${icon("bot")}</span>
        <h2>Active-agent limit reached.</h2>
        <p>${planLabel()} includes ${formatCount(state.maxAgents, "active agent", "active agents")}. Archive one before creating another.</p>
        <a class="secondary" href="${AGENTS_PATH}" data-agents-directory>View agents</a>
      </section>`;
  }
  return `
    <form class="agent-create-form" id="agent-create-form" novalidate>
      <div class="field agent-create-field">
        <label for="agent-name">Name <span>Required</span></label>
        <input id="agent-name" name="displayName" autocomplete="off" aria-describedby="agent-name-help agent-name-error" required>
        <p class="form-help" id="agent-name-help">Use a clear name, up to ${AGENT_NAME_LIMIT} Unicode characters.</p>
        <p class="error field-error" id="agent-name-error" role="alert"></p>
      </div>
      <div class="field agent-create-field">
        <label for="agent-purpose">Purpose <span>Optional</span></label>
        <textarea id="agent-purpose" name="purpose" rows="4" aria-describedby="agent-purpose-help agent-purpose-error" placeholder="What should this agent help with?"></textarea>
        <p class="form-help" id="agent-purpose-help">A short description helps you assign the right work. Up to 4 KiB in UTF-8.</p>
        <p class="error field-error" id="agent-purpose-error" role="alert"></p>
      </div>
      <p class="error agent-create-error" role="alert">${escapeHTML(state.error)}</p>
      <div class="agent-form-actions">
        <a class="secondary" href="${AGENTS_PATH}" data-agents-directory>Cancel</a>
        <button class="primary" type="submit">Create agent</button>
      </div>
    </form>`;
}

function agentConnectionResultHTML(result) {
  return `
    <section class="agent-connection-result" aria-labelledby="connection-heading">
      <div class="connection-agent">
        ${avatarHTML(result.agent, { large: true, decorative: true })}
        <div><p>Agent created</p><h2 id="connection-heading">${escapeHTML(result.agent.displayName)}</h2></div>
      </div>
      <div class="credential-warning" role="note">
        <strong>Copy this token now.</strong>
        <p>For security, Slate cannot show it again after you leave this page or refresh.</p>
      </div>
      <div class="credential-value">
        <code id="agent-credential" tabindex="0" aria-describedby="credential-copy-error">${escapeHTML(result.token)}</code>
        <button class="secondary icon-label" id="copy-agent-credential" type="button">${icon(state.credentialCopied ? "check" : "copy")}<span>${state.credentialCopied ? "Copied" : "Copy"}</span></button>
      </div>
      <p class="error credential-copy-error" id="credential-copy-error" role="alert">${escapeHTML(state.credentialCopyError)}</p>
      <ol class="connection-steps">
        <li><span>1</span><div><strong>Set the environment variable</strong><code>export SLATE_API_TOKEN=${escapeHTML(result.token)}</code></div></li>
        <li><span>2</span><div><strong>Verify the connection</strong><code>slate auth status</code></div></li>
      </ol>
      ${state.agentCreateNotice ? `<p class="agent-create-notice" role="status">${escapeHTML(state.agentCreateNotice)}</p>` : ""}
      <div class="agent-form-actions">
        <a class="primary" href="${AGENTS_PATH}" data-agents-directory>Done</a>
      </div>
    </section>`;
}

function settingsHTML() {
  const theme = currentTheme();
  const page = SETTINGS_PAGES.find(item => item.id === state.settingsPage) || SETTINGS_PAGES[0];
  let content = "";
  if (page.id === "profile") {
    content = `
      <form id="profile-form" class="settings-card profile-card" novalidate>
        <div class="settings-row profile-avatar-row">
          <div class="settings-row-copy">
            <strong>Avatar</strong>
            <span>Generated locally from your account ID.</span>
          </div>
          ${userAvatarHTML(state.me, { large: true })}
        </div>
        <div class="settings-row">
          <label class="settings-row-copy" for="profile-display-name">
            <strong>Display name</strong>
            <span>Used anywhere Slate identifies you.</span>
          </label>
          <div class="settings-field-wrap">
            <input id="profile-display-name" name="displayName" value="${escapeAttr(state.me?.displayName || state.me?.email?.split("@")[0] || "")}" maxlength="80" aria-describedby="profile-name-error" required>
            <p class="field-error" id="profile-name-error" role="alert"></p>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-copy">
            <strong>Account email</strong>
            <span>Your sign-in address cannot be changed here.</span>
          </div>
          <span class="read-only-value">${escapeHTML(state.me?.email || "")}</span>
        </div>
        <div class="settings-card-actions">
          ${settingsStatusHTML()}
          <button class="primary settings-submit" type="submit" ${state.settingsPending === "profile" ? "disabled" : ""}>${state.settingsPending === "profile" ? "Saving…" : "Save profile"}</button>
        </div>
      </form>`;
  } else if (page.id === "preferences") {
    content = `
      <section class="settings-card" aria-labelledby="appearance-heading">
        <div class="settings-row">
          <div class="settings-row-copy">
            <strong id="appearance-heading">Appearance</strong>
            <span>This preference also controls the shortcut in the app navigation.</span>
          </div>
          <div class="theme-choice" role="group" aria-label="Theme preference">
            ${themes.map(item => `
              <button type="button" data-set-theme="${item.id}" class="${theme === item.id ? "on" : ""}" aria-pressed="${theme === item.id}">
                ${icon(item.id === "dark" ? "moon" : "sun")}<span>${item.label}</span>
              </button>`).join("")}
          </div>
        </div>
        <div class="settings-card-actions">
          <p class="settings-status ${state.themeStatus.startsWith("Could not") ? "error" : ""}" role="${state.themeStatus.startsWith("Could not") ? "alert" : "status"}">${escapeHTML(state.themeStatus)}</p>
        </div>
      </section>`;
  } else {
    const tokenVisible = state.newToken && state.newTokenOwnerID === state.me?.id;
    const tokenLimit = Number(accountLimits().apiTokens) || 0;
    const tokenLimitReached = tokenLimit > 0 && state.tokens.length >= tokenLimit;
    content = `
      <section class="settings-section" aria-labelledby="personal-tokens-heading">
        <div class="settings-section-head">
          <h2 id="personal-tokens-heading">Personal API tokens</h2>
          <p>Use these tokens for your own CLI and API access. They carry your account permissions.</p>
        </div>
        <div class="settings-card">
          <form id="token-form" class="settings-row token-form" novalidate>
            <label class="settings-row-copy" for="token-name">
              <strong>Create personal token</strong>
              <span>${tokenLimitReached ? `${planLabel()} includes ${tokenLimit} active API tokens. Revoke one before creating another.` : `Name it after the device or integration that will use it. ${state.tokens.length} of ${tokenLimit} slots used.`}</span>
            </label>
            <div class="token-create-control">
              <input id="token-name" name="name" placeholder="For example, laptop CLI" maxlength="80" aria-describedby="token-name-error" required ${tokenLimitReached ? "disabled" : ""}>
              <button class="primary settings-submit" type="submit" ${state.settingsPending === "token" || tokenLimitReached ? "disabled" : ""}>${state.settingsPending === "token" ? "Creating…" : "Create token"}</button>
              <p class="field-error" id="token-name-error" role="alert"></p>
            </div>
          </form>
          ${tokenVisible ? `
            <div class="one-time-token" aria-labelledby="new-token-heading">
              <div>
                <strong id="new-token-heading">Copy this token now</strong>
                <p>For security, Slate cannot show this personal token again after you leave or refresh this page.</p>
              </div>
              <div class="credential-value">
                <code id="personal-token" tabindex="0">${escapeHTML(state.newToken)}</code>
                <button class="secondary icon-label" id="copy-personal-token" type="button">${icon("copy")}<span>Copy</span></button>
              </div>
            </div>` : ""}
          <div class="token-list" aria-label="Active personal tokens">
            ${state.tokens.length ? state.tokens.map(t => `
              <div class="token-row">
                <span><strong>${escapeHTML(t.name)}</strong><small>Personal token</small></span>
                <div class="settings-row-actions"><button class="danger" data-revoke="${t.id}" ${state.settingsPending === "revoke" ? "disabled" : ""}>${state.settingsPending === "revoke" ? "Revoking…" : "Revoke"}</button></div>
              </div>`).join("") : `<div class="empty-state"><p>No active personal tokens.</p></div>`}
          </div>
          <div class="settings-card-actions">${settingsStatusHTML()}</div>
        </div>
      </section>
      <section class="settings-section" aria-labelledby="agent-credentials-heading">
        <div class="settings-section-head">
          <h2 id="agent-credentials-heading">Agent credentials</h2>
          <p>Each agent has a separate identity and credential limited to its assigned work.</p>
        </div>
        <a class="settings-card agent-credentials-link" href="${AGENTS_PATH}" id="manage-agent-credentials">
          <span class="settings-link-icon">${icon("bot")}</span>
          <span><strong>Manage agents</strong><small>Create agents and manage their connection setup in the agent directory.</small></span>
          ${icon("chevronLeft", "chevron-right")}
        </a>
      </section>`;
  }
  return `
    <section class="settings-page theme-${theme}">
      <aside class="sidebar settings-sidebar">
        <button class="brand brand-button" type="button" data-home>slate<span>.do</span></button>
        <p class="settings-sidebar-title">Account settings</p>
        <nav class="settings-nav" aria-label="Settings">
          ${SETTINGS_PAGES.map(item => `<a class="page-row icon-label settings-nav-link ${item.id === page.id ? "on" : ""}" href="${settingsPath(item.id)}" ${item.id === page.id ? 'aria-current="page"' : ""}>${icon(item.icon)}<span>${item.label}</span></a>`).join("")}
        </nav>
        <section class="settings-actions" aria-label="Account actions">
          <button class="plain-btn icon-label" id="back">${icon("chevronLeft")}<span>Back to board</span></button>
          <button class="plain-btn icon-label" id="settings-logout">${icon("signOut")}<span>Sign out</span></button>
        </section>
      </aside>
      <main class="settings-main">
        <section class="settings-panel">
          <div class="settings-head">
            <div>
              <p>Account settings</p>
              <h1>${page.title}</h1>
              <p class="settings-description">${page.description}</p>
            </div>
          </div>
          ${content}
        </section>
      </main>
    </section>`;
}

function boardSettingsHTML() {
  const theme = currentTheme();
  const board = state.board;
  const maximum = accountLimits().activeItemsPerList;
  return `
    <section class="settings-page board-settings-page theme-${theme}">
      <aside class="sidebar settings-sidebar board-settings-sidebar">
        <button class="brand brand-button" type="button" data-home>slate<span>.do</span></button>
        <p class="settings-sidebar-title">Board settings</p>
        <div class="board-settings-context">
          ${icon("rows")}
          <span>${escapeHTML(board.name)}</span>
        </div>
        <section class="settings-actions" aria-label="Board actions">
          <button class="plain-btn icon-label" id="back-to-board">${icon("chevronLeft")}<span>Back to board</span></button>
          <a class="plain-btn icon-label settings-account-link" href="${settingsPath()}" id="account-settings-link">${icon("user")}<span>Account settings</span></a>
        </section>
      </aside>
      <main class="settings-main">
        <section class="settings-panel">
          <div class="settings-head board-settings-head">
            <div>
              <p>Board settings</p>
              <h1>${escapeHTML(board.name)}</h1>
              <p class="settings-description">Configuration here applies only to this board.</p>
            </div>
          </div>
          <section class="settings-section" aria-labelledby="work-limits-heading">
            <div class="settings-section-head">
              <h2 id="work-limits-heading">Work limits</h2>
              <p>Keep active work focused across every list on ${escapeHTML(board.name)}.</p>
            </div>
            <form id="board-limit-form" class="settings-card" novalidate>
              <div class="settings-row">
                <label class="settings-row-copy" for="settings-list-limit">
                  <strong>Maximum active items</strong>
                  <span>The number of open items allowed in each list. ${planLabel()} supports 1 to ${maximum}.</span>
                </label>
                <div class="settings-field-wrap settings-limit">
                  <input id="settings-list-limit" aria-label="Max active items per list" type="number" inputmode="numeric" min="1" max="${maximum}" value="${board.maxTasksPerList || DEFAULT_LIST_LIMIT}" aria-describedby="settings-list-limit-error">
                  <p class="field-error" id="settings-list-limit-error" role="alert"></p>
                </div>
              </div>
              <div class="settings-card-actions">
                ${settingsStatusHTML()}
                <button class="primary settings-submit" type="submit" ${state.settingsPending === "board" ? "disabled" : ""}>${state.settingsPending === "board" ? "Saving…" : "Save limit"}</button>
              </div>
            </form>
          </section>
        </section>
      </main>
    </section>`;
}

function settingsStatusHTML() {
  const message = state.error || state.settingsNotice;
  const role = state.error ? "alert" : "status";
  return `<p class="settings-status ${state.error ? "error" : ""}" role="${role}">${escapeHTML(message)}</p>`;
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
      state.authNotice = "";
      await navigate(safeNextPath(new URLSearchParams(location.search).get("next")) || APP_PATH, { replace: true });
      return;
    } catch (err) {
      state.error = err.message;
    }
    render();
  });
  document.querySelector("#forgot-password").onclick = () => {
	state.view = "forgot-password";
	state.error = "";
	state.authNotice = "";
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
	  state.authNotice = result.message;
	  formElement.reset();
	} catch (err) {
	  state.authNotice = "";
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
	  state.error = "";
	  state.authNotice = "Password reset. Sign in with your new password.";
	  await navigate(LOGIN_PATH, { replace: true });
	  return;
	} catch (err) {
	  state.error = err.message;
	}
	render();
  });
}

function bindEarlyAccess() {
  document.querySelectorAll("[data-home]").forEach(el => el.onclick = goHome);
  document.querySelector("#early-access-login").onclick = showLogin;
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
	  await navigate(APP_PATH, { replace: true });
	  return;
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
  bindAppShell();
  document.querySelector("#view-moved-item")?.addEventListener("click", async () => {
    const notice = state.moveNotice;
    if (!notice) return;
    await loadBoard(notice.boardId);
    state.selectedTask = findTask(notice.taskId);
    state.moveNotice = null;
    render();
  });
  document.querySelector("#dismiss-notice")?.addEventListener("click", () => { state.moveNotice = null; render(); });
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
  document.querySelector("#priority-filter")?.addEventListener("change", event => {
    state.priorityFilter = event.target.value;
    state.selectedTask = null;
    render();
    document.querySelector("#priority-filter")?.focus();
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

function bindAppShell() {
  document.querySelectorAll("[data-home]").forEach(el => el.onclick = goHome);
  const sidebar = document.querySelector(".sidebar");
  const sidebarToggle = document.querySelector("#sidebar-toggle");
  sidebarToggle.onclick = () => {
    const open = sidebar.classList.toggle("open");
    sidebarToggle.setAttribute("aria-expanded", String(open));
    sidebarToggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  };
  bindThemeControls();
  document.querySelectorAll("[data-board]").forEach(el => el.onclick = () => navigate(boardPath(el.dataset.board)));
  document.querySelectorAll("[data-board-settings]").forEach(el => el.onclick = () => navigate(boardSettingsPath(el.dataset.boardSettings)));
  document.querySelectorAll("[data-start-rename-board]").forEach(el => el.onclick = () => {
    const keepSidebarOpen = sidebar.classList.contains("open");
    state.renamingBoardId = el.dataset.startRenameBoard;
    renderKeepingSidebarOpen(keepSidebarOpen);
    const input = document.querySelector(`[data-rename-board="${state.renamingBoardId}"] input[name="name"]`);
    input?.focus();
    input?.select();
  });
  document.querySelectorAll("[data-rename-board]").forEach(form => bindBoardRename(form));
  document.querySelectorAll("[data-delete-board]").forEach(el => el.onclick = async () => deleteBoard(el.dataset.deleteBoard));
  document.querySelector("#agents-nav")?.addEventListener("click", event => {
    event.preventDefault();
    navigate(AGENTS_PATH);
  });
  document.querySelector("#settings").onclick = openSettings;
  document.querySelector("#logout").onclick = logout;
  document.querySelector("#new-board").onclick = async () => {
    if (state.boards.length >= state.maxBoards) return;
    const result = await createDefaultBoard();
    if (result.complete) navigate(boardPath(result.board.id));
    else render();
  };
  return sidebar;
}

function bindThemeControls() {
  document.querySelectorAll("[data-set-theme]").forEach(el => el.onclick = async () => {
    if (el.dataset.setTheme === currentTheme()) return;
    await updateTheme(el.dataset.setTheme);
  });
}

async function createDefaultBoard() {
  let board;
  let complete = false;
  await runMutation(async () => {
    board = await api.post("/api/v1/boards", { name: "Untitled board", maxTasksPerList: DEFAULT_LIST_LIMIT, backgroundKind: "theme", backgroundValue: currentTheme() });
    await api.post(`/api/v1/boards/${board.id}/buckets`, { name: "Inbox", isInbox: true });
    await api.post(`/api/v1/boards/${board.id}/buckets`, { name: "Focus" });
    complete = true;
  }, async () => {
    if (complete) return loadBoards(board.id);
    return loadBoardList();
  });
  return { board, complete };
}

function bindBoardRename(form) {
  const id = form.dataset.renameBoard;
  const sidebarIsOpen = () => Boolean(form.closest(".sidebar")?.classList.contains("open"));
  const input = form.querySelector('input[name="name"]');
  const error = form.querySelector(".board-rename-error");
  const controls = [...form.querySelectorAll("input, button")];
  const cancel = () => {
    const keepSidebarOpen = sidebarIsOpen();
    state.renamingBoardId = "";
    renderKeepingSidebarOpen(keepSidebarOpen);
    document.querySelector(`[data-start-rename-board="${id}"]`)?.focus();
  };
  const showError = message => {
    error.textContent = message;
    input.setAttribute("aria-invalid", "true");
    input.focus();
  };
  form.querySelector("[data-cancel-rename-board]").onclick = cancel;
  input.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    cancel();
  });
  input.addEventListener("input", () => {
    error.textContent = "";
    input.removeAttribute("aria-invalid");
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) {
      showError("Board name is required.");
      return;
    }
    controls.forEach(control => { control.disabled = true; });
    try {
      if (!await renameBoard(id, name)) return;
      const keepSidebarOpen = sidebarIsOpen();
      renderKeepingSidebarOpen(keepSidebarOpen);
      document.querySelector(`[data-start-rename-board="${id}"]`)?.focus();
    } catch (err) {
      controls.forEach(control => { control.disabled = false; });
      showError(err.message);
    }
  });
}

async function renameBoard(id, name) {
  const nextName = String(name ?? "").trim();
  if (!nextName) throw new Error("Board name is required.");
  const sessionVersion = authVersion;
  const userID = state.me?.id;
  const updated = await api.patch(`/api/v1/boards/${id}`, { name: nextName });
  if (!sessionIsCurrent(sessionVersion, userID)) return false;
  state.boards = state.boards.map(board => board.id === id ? { ...board, ...updated } : board);
  if (state.board?.id === id) {
    state.board = { ...state.board, ...updated, buckets: state.board.buckets };
  }
  state.renamingBoardId = "";
  state.error = "";
  return true;
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

function bindDetail(options = {}) {
  if (!state.selectedTask) return;
  const refresh = options.refresh || reload;
  const overlay = document.querySelector("[data-detail-overlay]");
  const formElement = document.querySelector("#detail-form");
  const submitButton = formElement.querySelector('button[type="submit"]');
  const taskID = state.selectedTask.id;
  const bucketID = state.selectedTask.bucketId;
  let detailBusy = false;
  const detailInput = () => {
    const form = new FormData(formElement);
    return {
      title: form.get("title"),
      description: form.get("description"),
      scheduledDate: form.get("scheduledDate"),
      status: form.get("status"),
      priority: form.get("priority"),
      assigneeAgentId: form.get("assigneeAgentId"),
    };
  };
  let savedDetail = JSON.stringify(detailInput());
  const savePendingChanges = async () => {
    const input = detailInput();
    const serialized = JSON.stringify(input);
    if (serialized === savedDetail) return;
    await api.patch(`/api/v1/tasks/${taskID}/status`, input);
    savedDetail = serialized;
  };
  const focusAfterDetail = (preferredTaskID = taskID) => {
    const triggers = [...document.querySelectorAll("[data-open-task]")];
    const trigger = triggers.find(element => element.dataset.openTask === preferredTaskID);
    const addInput = document.querySelector(`[data-add-task="${bucketID}"] input[name="title"]`);
    const activeView = document.querySelector('[data-board-mode][aria-pressed="true"]');
    const selectedBoard = document.querySelector(`[data-board="${state.board?.id}"]`);
    const fallback = options.fallbackSelector ? document.querySelector(options.fallbackSelector) : null;
    // An edit can hide the item behind the active filter. Falling back to the
    // first card on the board would move focus to an unrelated list, so stay
    // in the item's own list instead.
    if (!trigger && state.priorityFilter) {
      (fallback || addInput || activeView || selectedBoard)?.focus();
      return;
    }
    (trigger || triggers[0] || fallback || addInput || activeView || selectedBoard)?.focus();
  };
  const setDetailBusy = busy => {
    detailBusy = busy;
    document.querySelectorAll("[data-close-detail], #delete-task, #detail-form button, #detail-form select").forEach(element => { element.disabled = busy; });
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
      if (!detailBusy && !moveController.isLoading()) formElement.requestSubmit();
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
  const moveController = bindMovePanel({
    taskID,
    task: state.selectedTask,
    setDetailBusy,
    savePendingChanges,
    submitButton,
    afterMove: options.afterMove,
    handleError: options.handleError,
  });
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
      await refresh();
      focusAfterDetail(nextTaskID);
    } catch (err) {
      if (options.handleError?.(err)) return;
      state.error = err.message;
      formElement.querySelector(".detail-error").textContent = err.message;
      setDetailBusy(false);
    }
  };
  formElement.addEventListener("submit", async event => {
    event.preventDefault();
    if (detailBusy || moveController.isLoading()) return;
    const submit = submitButton;
    if (moveController.hasPendingMove()) {
      await moveController.move({ button: submit, idleText: "Save changes" });
      return;
    }
    const input = detailInput();
    setDetailBusy(true);
    submit.textContent = "Saving…";
    try {
      await api.patch(`/api/v1/tasks/${taskID}/status`, input);
      state.error = "";
      state.selectedTask = null;
      await refresh();
      focusAfterDetail();
    } catch (err) {
      if (options.handleError?.(err)) return;
      state.error = err.message;
      const error = formElement.querySelector(".detail-error");
      error.textContent = err.message;
      setDetailBusy(false);
      submit.textContent = "Save changes";
    }
  });
}

function bindMovePanel({ taskID, task, setDetailBusy, savePendingChanges, submitButton, afterMove, handleError }) {
  const panel = document.querySelector("#move-panel");
  const boardSelect = document.querySelector("#move-board");
  const listSelect = document.querySelector("#move-list");
  const positionSelect = document.querySelector("#move-position");
  const moveButton = document.querySelector("#move-item");
  const loadedBoards = new Map([[state.board.id, state.board]]);
  const sourceBoardID = state.board.id;
  const sourceList = state.board.buckets.find(list => list.id === task.bucketId);
  const sourcePosition = Math.max(0, (sourceList?.tasks || []).findIndex(item => item.id === task.id));
  let destinationLoading = false;
  const showError = message => {
    state.error = message;
    document.querySelector(".detail-error").textContent = message;
  };
  const isLoading = () => destinationLoading;
  const selectedList = () => loadedBoards.get(boardSelect.value)?.buckets?.find(list => list.id === listSelect.value);
  const hasPendingMove = () => (
    boardSelect.value !== sourceBoardID
    || listSelect.value !== task.bucketId
    || Number(positionSelect.value) !== sourcePosition
  );
  const refreshPositions = () => {
    const available = selectedList() && !listSelect.selectedOptions[0]?.disabled;
    positionSelect.innerHTML = available ? movePositionOptionsHTML(selectedList(), task) : "";
    positionSelect.disabled = !available;
    moveButton.disabled = !available;
  };
  const refreshLists = (board, selectedID = "") => {
    listSelect.innerHTML = moveListOptionsHTML(board, task, selectedID);
    const firstAvailable = [...listSelect.options].find(option => !option.disabled);
    if (!listSelect.selectedOptions[0] || listSelect.selectedOptions[0].disabled) {
      listSelect.value = firstAvailable?.value || "";
    }
    listSelect.disabled = !firstAvailable;
    refreshPositions();
  };

  document.querySelector("#open-move").onclick = () => {
    panel.hidden = false;
    boardSelect.focus();
  };
  document.querySelector("#close-move").onclick = () => {
    panel.hidden = true;
    document.querySelector("#open-move").focus();
  };
  boardSelect.onchange = async () => {
    const destinationBoardID = boardSelect.value;
    try {
      destinationLoading = true;
      submitButton.disabled = true;
      boardSelect.disabled = true;
      listSelect.disabled = true;
      positionSelect.disabled = true;
      moveButton.disabled = true;
      listSelect.innerHTML = '<option value="">Loading lists…</option>';
      positionSelect.innerHTML = "";
      let board = loadedBoards.get(destinationBoardID);
      if (!board) {
        board = await api.get(`/api/v1/boards/${destinationBoardID}`);
        loadedBoards.set(board.id, board);
      }
      state.error = "";
      document.querySelector(".detail-error").textContent = "";
      refreshLists(board, destinationBoardID === sourceBoardID ? task.bucketId : "");
    } catch (err) {
      if (handleError?.(err)) return;
      showError(err.message);
    } finally {
      destinationLoading = false;
      submitButton.disabled = false;
      boardSelect.disabled = false;
    }
  };
  listSelect.onchange = refreshPositions;
  const move = async ({ button = moveButton, idleText = "Move item" } = {}) => {
    const destinationBoard = loadedBoards.get(boardSelect.value);
    const destinationList = selectedList();
    if (!destinationBoard || !destinationList) {
      showError("Choose a destination list before moving this item.");
      return;
    }
    button.textContent = "Saving…";
    const savePromise = savePendingChanges();
    setDetailBusy(true);
    let moved;
    try {
      await savePromise;
      button.textContent = "Moving…";
      moved = await api.post(`/api/v1/tasks/${taskID}/move`, {
        bucketId: destinationList.id,
        position: Number(positionSelect.value),
      });
    } catch (err) {
      if (handleError?.(err)) return;
      showError(err.message);
      setDetailBusy(false);
      button.textContent = idleText;
      return;
    }

    if (sourceList) {
      sourceList.tasks = (sourceList.tasks || []).filter(item => item.id !== taskID);
      if (task.kind === "action" && !task.done) sourceList.openCount = Math.max(0, (sourceList.openCount || 0) - 1);
    }
    state.selectedTask = null;
    if (afterMove) {
      state.agentTaskFocusID = moved.id;
      state.error = "";
      await afterMove(moved, destinationBoard, destinationList);
      return;
    }
    state.moveNotice = {
      message: `Moved to ${destinationBoard.name} / ${destinationList.name}`,
      boardId: moved.boardId,
      taskId: moved.id,
    };
    state.error = "";
    try {
      await loadBoards(sourceBoardID);
    } catch {
      state.error = "The item was moved, but this board could not be refreshed.";
    }
    render();
  };
  moveButton.onclick = () => move();
  return { hasPendingMove, isLoading, move };
}

async function bindSettings() {
  document.querySelectorAll("[data-home]").forEach(el => el.onclick = goHome);
  document.querySelectorAll(".settings-nav-link").forEach(el => el.onclick = event => {
    event.preventDefault();
    navigate(el.getAttribute("href"));
  });
  document.querySelector("#back").onclick = closeSettings;
  document.querySelector("#settings-logout").onclick = logout;
  bindThemeControls();
  document.querySelector("#profile-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.displayName;
    const error = document.querySelector("#profile-name-error");
    const displayName = input.value.trim();
    error.textContent = "";
    input.removeAttribute("aria-invalid");
    if (!displayName) {
      input.setAttribute("aria-invalid", "true");
      error.textContent = "Display name is required.";
      input.focus();
      return;
    }
    const version = routeVersion;
    const sessionVersion = authVersion;
    const userID = state.me?.id;
    state.settingsPending = "profile";
    state.settingsNotice = "";
    state.error = "";
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Saving…";
    try {
      const user = await api.patch("/api/v1/me", { displayName });
      if (!settingsMutationIsCurrent(sessionVersion, userID, version, "profile")) return;
      state.me = { ...state.me, ...user };
      state.settingsNotice = "Profile saved.";
      state.error = "";
    } catch (err) {
      if (!settingsMutationIsCurrent(sessionVersion, userID, version, "profile")) return;
      state.error = err.message;
    }
    state.settingsPending = "";
    render();
  });
  document.querySelector("#token-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const input = formElement.elements.name;
    const error = document.querySelector("#token-name-error");
    const name = input.value.trim();
    error.textContent = "";
    input.removeAttribute("aria-invalid");
    if (!name) {
      input.setAttribute("aria-invalid", "true");
      error.textContent = "Token name is required.";
      input.focus();
      return;
    }
    const version = routeVersion;
    state.settingsPending = "token";
    state.settingsNotice = "";
    state.error = "";
    const submit = formElement.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Creating…";
    if (await createAPIToken(name, version) && settingsRouteIsCurrent(version, "api")) {
      state.settingsPending = "";
      render();
      document.querySelector("#copy-personal-token")?.focus();
    }
  });
  document.querySelectorAll("[data-revoke]").forEach(el => el.onclick = async () => {
    if (!confirm("Revoke this personal token? Any client using it will lose access.")) return;
    const version = routeVersion;
    const sessionVersion = authVersion;
    const userID = state.me?.id;
    state.settingsPending = "revoke";
    state.settingsNotice = "";
    state.error = "";
    render();
    try {
      await api.del(`/api/v1/api-tokens/${el.dataset.revoke}`);
      if (!settingsMutationIsCurrent(sessionVersion, userID, version, "api")) return;
      if (!await loadTokens(sessionVersion, userID, version)) return;
      state.settingsNotice = "Personal token revoked.";
    } catch (err) {
      if (!settingsMutationIsCurrent(sessionVersion, userID, version, "api")) return;
      state.error = err.message;
    }
    state.settingsPending = "";
    if (settingsRouteIsCurrent(version, "api")) render();
  });
  document.querySelector("#copy-personal-token")?.addEventListener("click", async () => {
    const tokenElement = document.querySelector("#personal-token");
    if (!state.newToken || state.newTokenOwnerID !== state.me?.id) return;
    const copied = await copyAgentCredential(state.newToken, tokenElement);
    state.settingsNotice = copied ? "Personal token copied." : "Copy failed. The token is selected so you can copy it manually.";
    state.error = "";
    if (!copied) {
      const status = document.querySelector(".settings-status");
      status.textContent = state.settingsNotice;
      status.setAttribute("role", "alert");
      return;
    }
    render();
    document.querySelector("#copy-personal-token")?.focus();
  });
  document.querySelector("#manage-agent-credentials")?.addEventListener("click", event => {
    event.preventDefault();
    navigate(AGENTS_PATH);
  });
}

function bindBoardSettings() {
  document.querySelectorAll("[data-home]").forEach(el => el.onclick = goHome);
  document.querySelector("#back-to-board").onclick = () => navigate(boardPath(state.board.id));
  document.querySelector("#account-settings-link").onclick = event => {
    event.preventDefault();
    navigate(settingsPath());
  };
  const form = document.querySelector("#board-limit-form");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const input = document.querySelector("#settings-list-limit");
    const error = document.querySelector("#settings-list-limit-error");
    const validation = validateListLimit(input.value);
    error.textContent = validation;
    input.toggleAttribute("aria-invalid", Boolean(validation));
    if (validation) {
      input.focus();
      return;
    }
    const version = routeVersion;
    const sessionVersion = authVersion;
    const userID = state.me?.id;
    const boardID = state.board.id;
    const update = listLimitUpdate(boardID, input.value);
    state.settingsPending = "board";
    state.settingsNotice = "";
    state.error = "";
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Saving…";
    try {
      const updated = await api.patch(update.path, update.input);
      if (!boardSettingsMutationIsCurrent(sessionVersion, userID, version, boardID)) return;
      state.board = { ...state.board, ...updated, buckets: state.board.buckets };
      state.boards = state.boards.map(board => board.id === boardID ? { ...board, ...updated } : board);
      state.settingsNotice = "Board limit saved.";
    } catch (err) {
      if (!boardSettingsMutationIsCurrent(sessionVersion, userID, version, boardID)) return;
      state.error = err.message;
    }
    state.settingsPending = "";
    if (boardSettingsMutationIsCurrent(sessionVersion, userID, version, boardID)) render();
  });
}

function bindAgents() {
  bindAppShell();
  const follow = (selector, path) => {
    document.querySelectorAll(selector).forEach(element => element.addEventListener("click", event => {
      event.preventDefault();
      if (element.getAttribute("aria-disabled") === "true") return;
      navigate(path);
    }));
  };
  follow("#new-agent-link, #empty-new-agent", NEW_AGENT_PATH);
  follow("#agents-back, [data-agents-directory]", AGENTS_PATH);
  document.querySelectorAll("[data-agent-link]").forEach(element => element.addEventListener("click", event => {
    event.preventDefault();
    navigate(agentPath(element.dataset.agentLink));
  }));
  document.querySelector("#retry-agents")?.addEventListener("click", applyRoute);
  document.querySelector("#copy-agent-credential")?.addEventListener("click", async () => {
    const token = state.agentCreationResult?.token;
    if (!token) return;
    const tokenElement = document.querySelector("#agent-credential");
    state.credentialCopyError = "";
    document.querySelector("#credential-copy-error").textContent = "";
    if (!await copyAgentCredential(token, tokenElement)) {
      state.credentialCopied = false;
      state.credentialCopyError = "Copy failed. The token is selected. Press Command+C or Ctrl+C to copy it manually.";
      document.querySelector("#credential-copy-error").textContent = state.credentialCopyError;
      return;
    }
    state.credentialCopied = true;
    render();
    document.querySelector("#copy-agent-credential")?.focus();
  });
  const form = document.querySelector("#agent-create-form");
  if (!form) return;
  const name = form.elements.displayName;
  const purpose = form.elements.purpose;
  const nameError = document.querySelector("#agent-name-error");
  const purposeError = document.querySelector("#agent-purpose-error");
  const clearFieldError = (field, output) => {
    field.removeAttribute("aria-invalid");
    output.textContent = "";
  };
  name.addEventListener("input", () => clearFieldError(name, nameError));
  purpose.addEventListener("input", () => clearFieldError(purpose, purposeError));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    clearFieldError(name, nameError);
    clearFieldError(purpose, purposeError);
    const displayName = name.value.trim();
    const purposeValue = purpose.value.trim();
    if (!displayName) {
      name.setAttribute("aria-invalid", "true");
      nameError.textContent = "Agent name is required.";
      name.focus();
      return;
    }
    if ([...displayName].length > AGENT_NAME_LIMIT) {
	  name.setAttribute("aria-invalid", "true");
	  nameError.textContent = `Agent name must be ${AGENT_NAME_LIMIT} Unicode characters or fewer.`;
      name.focus();
      return;
    }
    if (utf8Length(purposeValue) > AGENT_INSTRUCTIONS_BYTE_LIMIT) {
	  purpose.setAttribute("aria-invalid", "true");
	  purposeError.textContent = "Purpose must be 4 KiB in UTF-8 or fewer.";
      purpose.focus();
      return;
    }
    const controls = [...form.querySelectorAll("input, textarea, button")];
    controls.forEach(control => { control.disabled = true; });
    form.querySelector('button[type="submit"]').textContent = "Creating…";
    const version = routeVersion;
    const created = await createAgent(displayName, purposeValue, version);
    if (!agentRouteIsCurrent(version, "agent-new")) return;
    if (created) {
      render();
      document.querySelector("#copy-agent-credential")?.focus();
      return;
    }
    controls.forEach(control => { control.disabled = false; });
    form.querySelector('button[type="submit"]').textContent = "Create agent";
    document.querySelector(".agent-create-error").textContent = state.error;
  });
}

function bindAgentDetail() {
  bindAppShell();
  document.querySelector("#agent-detail-back")?.addEventListener("click", event => {
    event.preventDefault();
    navigate(AGENTS_PATH);
  });
  document.querySelectorAll("[data-agent-directory]").forEach(element => element.addEventListener("click", event => {
    event.preventDefault();
    navigate(AGENTS_PATH);
  }));
  document.querySelectorAll("[data-agent-tab]").forEach(element => element.addEventListener("click", async event => {
    event.preventDefault();
    await navigate(element.getAttribute("href"));
    document.querySelector('[role="tab"][aria-selected="true"]')?.focus();
  }));
  const tabs = [...document.querySelectorAll('[role="tab"][data-agent-tab]')];
  tabs.forEach((element, index) => element.addEventListener("keydown", async event => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const target = tabs[(index + offset + tabs.length) % tabs.length];
    await navigate(target.getAttribute("href"));
    document.querySelector('[role="tab"][aria-selected="true"]')?.focus();
  }));
  document.querySelectorAll("[data-work-page]").forEach(element => element.addEventListener("click", event => {
    event.preventDefault();
    if (element.getAttribute("aria-disabled") === "true") return;
    navigate(element.getAttribute("href"));
  }));
  document.querySelector("#retry-agent-detail")?.addEventListener("click", applyRoute);
  document.querySelector("#agent-detail-sign-in")?.addEventListener("click", () => {
    const target = currentLocationPath();
    authVersion += 1;
    resetAuthenticatedState();
    navigate(loginPathFor(target), { replace: true });
  });
  document.querySelector("#assign-work")?.addEventListener("click", openAssignWork);
  document.querySelectorAll("[data-open-agent-task]").forEach(element => element.addEventListener("click", () => openAgentTask(element)));
  bindAssignWork();
  bindAgentLifecycle();
  if (state.selectedTask) {
    bindDetail({
      refresh: refreshAgentSurface,
      afterMove: refreshAgentSurface,
      fallbackSelector: "#assign-work, [data-agent-tab]",
      handleError: handleAgentUnauthorized,
    });
  } else if (state.agentTaskFocusID) {
    const focusID = state.agentTaskFocusID;
    state.agentTaskFocusID = "";
    const createdItem = document.querySelector(`[data-open-agent-task="${CSS.escape(focusID)}"]`);
    const fallback = document.querySelector("#assign-work") || document.querySelector('[role="tab"][aria-selected="true"]');
    (createdItem || fallback)?.focus();
  }
}

function bindAgentLifecycle() {
  if (state.view !== "agent-settings" || !state.agentDetail) return;
  const form = document.querySelector("#agent-identity-form");
  form?.addEventListener("submit", async event => {
    event.preventDefault();
    if (state.agentLifecyclePending) return;
    const name = form.elements.displayName;
    const purpose = form.elements.purpose;
    const displayName = name.value.trim();
    const purposeValue = purpose.value.trim();
    document.querySelector("#agent-settings-name-error").textContent = "";
    document.querySelector("#agent-settings-purpose-error").textContent = "";
    name.removeAttribute("aria-invalid");
    purpose.removeAttribute("aria-invalid");
    if (!displayName) {
      name.setAttribute("aria-invalid", "true");
      document.querySelector("#agent-settings-name-error").textContent = "Agent name is required.";
      name.focus();
      return;
    }
    if ([...displayName].length > AGENT_NAME_LIMIT) {
	  name.setAttribute("aria-invalid", "true");
	  document.querySelector("#agent-settings-name-error").textContent = `Agent name must be ${AGENT_NAME_LIMIT} Unicode characters or fewer.`;
      name.focus();
      return;
    }
    if (utf8Length(purposeValue) > AGENT_INSTRUCTIONS_BYTE_LIMIT) {
	  purpose.setAttribute("aria-invalid", "true");
	  document.querySelector("#agent-settings-purpose-error").textContent = "Purpose must be 4 KiB in UTF-8 or fewer.";
      purpose.focus();
      return;
    }
    const context = agentMutationContext();
    state.agentLifecyclePending = "identity";
    state.agentLifecycleError = "";
    state.agentLifecycleNotice = "";
    render();
    try {
      const updated = await api.patch(`/api/v1/agents/${encodeURIComponent(context.agentID)}`, { displayName, purpose: purposeValue });
      if (!agentMutationIsCurrent(context)) return;
      state.agentDetail.agent = updated;
      updateAgentCache(updated);
      state.agentLifecycleNotice = "Agent identity saved.";
    } catch (err) {
      if (!agentMutationIsCurrent(context)) return;
      if (handleAgentUnauthorized(err)) return;
      state.agentLifecycleError = err.message;
    }
    if (!agentMutationIsCurrent(context)) return;
    state.agentLifecyclePending = "";
    render();
    document.querySelector(state.agentLifecycleError ? "#agent-settings-name" : '#agent-identity-form button[type="submit"]')?.focus();
  });

  const openConfirm = action => {
    state.agentLifecycleConfirm = action;
    state.agentArchiveConflict = null;
    state.agentLifecycleError = "";
    render();
    document.querySelector("#confirm-agent-lifecycle")?.focus();
  };
  document.querySelector("#rotate-agent-credential")?.addEventListener("click", () => openConfirm("rotate"));
  document.querySelector("#revoke-agent-credential")?.addEventListener("click", () => openConfirm("revoke"));
  document.querySelector("#archive-agent")?.addEventListener("click", () => openConfirm("archive"));
  document.querySelector("#restore-agent")?.addEventListener("click", () => openConfirm("restore"));
  document.querySelector("#finish-lifecycle-credential")?.addEventListener("click", () => {
    clearAgentLifecycleCredential();
    state.agentLifecycleNotice = "Credential saved. Slate cannot show it again.";
    render();
    document.querySelector("#rotate-agent-credential")?.focus();
  });
  document.querySelector("#copy-lifecycle-credential")?.addEventListener("click", async () => {
    const token = state.agentCredentialResult?.token;
    if (!token) return;
    const element = document.querySelector("#agent-lifecycle-credential");
    state.credentialCopyError = "";
    if (!await copyAgentCredential(token, element)) {
      state.credentialCopied = false;
      state.credentialCopyError = "Copy failed. The credential is selected. Press Command+C or Ctrl+C to copy it manually.";
      document.querySelector("#lifecycle-copy-error").textContent = state.credentialCopyError;
      return;
    }
    state.credentialCopied = true;
    render();
    document.querySelector("#copy-lifecycle-credential")?.focus();
  });
  bindAgentLifecycleDialog();
}

function bindAgentLifecycleDialog() {
  const overlay = document.querySelector(".agent-lifecycle-overlay");
  if (!overlay) return;
  const cancel = () => {
    if (state.agentLifecyclePending) return;
    const action = state.agentLifecycleConfirm;
    state.agentLifecycleConfirm = "";
    state.agentArchiveConflict = null;
    state.agentLifecycleError = "";
    render();
    document.querySelector(`#${action === "rotate" ? "rotate-agent-credential" : action === "revoke" ? "revoke-agent-credential" : action === "restore" ? "restore-agent" : "archive-agent"}`)?.focus();
  };
  document.querySelector("#cancel-agent-lifecycle")?.addEventListener("click", cancel);
  overlay.addEventListener("click", event => { if (event.target === overlay) cancel(); });
  overlay.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [...overlay.querySelectorAll("button:not(:disabled)")];
    if (!controls.length) {
      event.preventDefault();
      document.querySelector("#agent-lifecycle-pending")?.focus();
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  document.querySelector("#confirm-agent-lifecycle")?.addEventListener("click", runAgentLifecycleMutation);
}

async function runAgentLifecycleMutation() {
  if (state.agentLifecyclePending) return;
  const context = agentMutationContext();
  const action = state.agentLifecycleConfirm;
  state.agentLifecyclePending = action;
  state.agentLifecycleError = "";
  render();
  document.querySelector("#agent-lifecycle-pending")?.focus();
  try {
    if (action === "rotate") {
      await rotateAgentCredential(context);
      return;
    }
    if (action === "revoke") {
      await api.del(`/api/v1/agents/${encodeURIComponent(context.agentID)}/credential`);
      if (!agentMutationIsCurrent(context)) return;
      state.agentDetail.agent = {
        ...state.agentDetail.agent,
        credential: { ...(state.agentDetail.agent.credential || {}), revokedAt: new Date().toISOString() },
      };
      updateAgentCache(state.agentDetail.agent);
      state.agentLifecycleNotice = "Credential revoked. Assigned work is unchanged.";
    } else if (action === "archive") {
      const force = Boolean(state.agentArchiveConflict);
      await api.post(`/api/v1/agents/${encodeURIComponent(context.agentID)}/archive`, { unassignOpenWork: force });
      if (!agentMutationIsCurrent(context)) return;
      state.agentLifecycleNotice = force
        ? "Open work was unassigned and the agent was archived."
        : "Agent archived.";
      state.agentDetail.agent = {
        ...state.agentDetail.agent,
        archivedAt: new Date().toISOString(),
        credential: { ...(state.agentDetail.agent.credential || {}), revokedAt: new Date().toISOString() },
      };
      updateAgentCache(state.agentDetail.agent);
      state.activeAgents = Math.max(0, state.activeAgents - 1);
    } else if (action === "restore") {
      const restored = await api.post(`/api/v1/agents/${encodeURIComponent(context.agentID)}/restore`, {});
      if (!agentMutationIsCurrent(context)) return;
      state.agentDetail.agent = restored;
      updateAgentCache(restored);
      state.activeAgents += 1;
      state.agentLifecycleNotice = "Agent restored. Create a credential when you are ready to connect it.";
    }
    if (!agentMutationIsCurrent(context)) return;
    state.agentLifecycleConfirm = "";
    state.agentArchiveConflict = null;
    state.agentLifecyclePending = "";
    try {
      await refreshAgentSettings(context);
    } catch {
      if (!agentMutationIsCurrent(context)) return;
      state.agentLifecycleNotice += " Agent metadata could not be refreshed.";
      render();
    }
    if (agentMutationIsCurrent(context)) focusAfterAgentLifecycle(action);
  } catch (err) {
    if (!agentMutationIsCurrent(context)) return;
    if (handleAgentUnauthorized(err)) return;
    state.agentLifecyclePending = "";
    if (action === "archive" && err.status === 409 && err.code === "agent_open_work") {
      state.agentArchiveConflict = {
        ready: Number(err.data?.conflict?.ready || 0),
        working: Number(err.data?.conflict?.working || 0),
      };
      state.agentLifecycleError = "";
    } else {
      state.agentLifecycleError = err.message;
    }
    render();
    document.querySelector("#confirm-agent-lifecycle")?.focus();
  }
}

function focusAfterAgentLifecycle(action) {
  const selector = action === "archive"
    ? "#restore-agent"
    : action === "restore" || action === "revoke"
      ? "#rotate-agent-credential"
      : "#copy-lifecycle-credential";
  const target = document.querySelector(selector)
    || document.querySelector("#agent-tab-settings")
    || document.querySelector(".agent-detail-notice")
    || document.querySelector(".agent-detail-head h1");
  if (target && !target.hasAttribute("tabindex") && !/^(BUTTON|A|INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
    target.setAttribute("tabindex", "-1");
  }
  target?.focus();
}

async function rotateAgentCredential(context) {
  const idempotencyKey = newAgentRotationKey();
  try {
    const result = await api.post(`/api/v1/agents/${encodeURIComponent(context.agentID)}/credential/rotate`, { idempotencyKey });
    if (!agentMutationIsCurrent(context)) return;
    if (result.alreadyApplied || !result.token) {
      state.agentLifecyclePending = "";
      state.agentLifecycleConfirm = "";
      state.agentLifecycleError = "The rotation was applied, but its one-time credential is no longer available. The old credential may have been revoked. Rotate again to create a credential you can save.";
      render();
      document.querySelector("#rotate-agent-credential")?.focus();
      return;
    }
    state.agentCredentialResult = { ownerID: context.userID, agentID: context.agentID, token: result.token };
    state.credentialCopied = false;
    state.credentialCopyError = "";
    state.agentLifecyclePending = "";
    state.agentLifecycleConfirm = "";
    state.agentLifecycleNotice = "";
    try {
      await refreshAgentSettings(context, false);
    } catch {
      if (!agentMutationIsCurrent(context)) return;
      state.agentLifecycleNotice = "Credential rotated. Agent metadata could not be refreshed, but this one-time credential remains available until you leave or refresh this page.";
    }
    if (!agentMutationIsCurrent(context)) return;
    render();
    document.querySelector("#copy-lifecycle-credential")?.focus();
  } catch (err) {
    if (!agentMutationIsCurrent(context)) return;
    if (handleAgentUnauthorized(err)) return;
    state.agentLifecyclePending = "";
    state.agentLifecycleConfirm = "";
    state.agentLifecycleError = "The rotation response could not be confirmed. The old credential may have been revoked. Rotate again to create a safe replacement.";
    render();
    document.querySelector("#rotate-agent-credential")?.focus();
  }
}

function newAgentRotationKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const values = new Uint8Array(24);
  globalThis.crypto.getRandomValues(values);
  return [...values].map(value => value.toString(16).padStart(2, "0")).join("");
}

function agentMutationContext() {
  return {
    sessionVersion: authVersion,
    routeVersion,
    userID: state.me?.id,
    agentID: state.agentDetail?.agent?.id,
  };
}

function agentMutationIsCurrent(context) {
  const route = parseRoute(location.pathname);
  return sessionIsCurrent(context.sessionVersion, context.userID)
    && context.routeVersion === routeVersion
    && state.view === "agent-settings"
    && route.name === "agent-settings"
    && route.agentId === context.agentID
    && state.agentDetail?.agent?.id === context.agentID;
}

async function refreshAgentSettings(context, renderAfter = true) {
  const loaded = await loadAgentDetail(context.agentID, {
    sessionVersion: context.sessionVersion,
    userID: context.userID,
    expectedRouteVersion: context.routeVersion,
  });
  if (!loaded || !agentMutationIsCurrent(context)) return false;
  state.agentDetailLoadState = "ready";
  if (renderAfter) render();
  return true;
}

function updateAgentCache(agent) {
  const index = state.agents.findIndex(item => item.id === agent.id);
  if (index >= 0) state.agents[index] = agent;
  else state.agents.push(agent);
}

async function openAssignWork() {
  const button = document.querySelector("#assign-work");
  const version = routeVersion;
  const sessionVersion = authVersion;
  const userID = state.me?.id;
  const boardID = state.board?.id && state.boards.some(board => board.id === state.board.id) ? state.board.id : state.boards[0]?.id;
  state.agentAssignError = "";
  state.agentAssignDraft = null;
  if (button) {
    button.disabled = true;
    button.querySelector("span").textContent = "Loading…";
  }
  try {
    if (boardID && (state.board?.id !== boardID || !state.board?.buckets)) {
      if (!await loadBoard(boardID, sessionVersion, version)) return;
    }
    if (!sessionIsCurrent(sessionVersion, userID) || version !== routeVersion) return;
    state.agentAssignBoardID = boardID || "";
    state.agentAssignOpen = true;
    render();
    document.querySelector("#assign-title")?.focus();
  } catch (err) {
    if (!sessionIsCurrent(sessionVersion, userID) || version !== routeVersion) return;
    if (handleAgentUnauthorized(err)) return;
    state.agentAssignOpen = true;
    state.agentAssignError = err.message;
    render();
    document.querySelector("#assign-title")?.focus();
  }
}

function bindAssignWork() {
  if (!state.agentAssignOpen) return;
  const overlay = document.querySelector("[data-assign-overlay]");
  const form = document.querySelector("#assign-work-form");
  const close = () => {
    state.agentAssignOpen = false;
    state.agentAssignError = "";
    state.agentAssignDraft = null;
    render();
    document.querySelector("#assign-work")?.focus();
  };
  document.querySelectorAll("[data-close-assign]").forEach(element => element.addEventListener("click", close));
  overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
  overlay.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
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
  });
  form.elements.boardId?.addEventListener("change", async event => {
    const version = routeVersion;
    const sessionVersion = authVersion;
    const userID = state.me?.id;
    const boardID = event.target.value;
    state.agentAssignDraft = assignDraftFromForm(form);
    state.agentAssignBoardID = boardID;
    state.agentAssignError = "";
    [...form.elements].forEach(control => { control.disabled = true; });
    try {
      if (!await loadBoard(boardID, sessionVersion, version)) return;
      if (!sessionIsCurrent(sessionVersion, userID) || version !== routeVersion || !state.agentAssignOpen) return;
      state.agentAssignDraft.bucketId = "";
      render();
      document.querySelector("#assign-board")?.focus();
    } catch (err) {
      if (!sessionIsCurrent(sessionVersion, userID) || version !== routeVersion || !state.agentAssignOpen) return;
      if (handleAgentUnauthorized(err)) return;
      state.agentAssignError = err.message;
      render();
      document.querySelector("#assign-board")?.focus();
    }
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const title = form.elements.title.value.trim();
    const bucketID = form.elements.bucketId.value;
    const error = document.querySelector("#assign-error");
    if (!title) {
      form.elements.title.setAttribute("aria-invalid", "true");
      error.textContent = "Item title is required.";
      form.elements.title.focus();
      return;
    }
    if (!bucketID) {
      error.textContent = "Choose an available list.";
      form.elements.bucketId.focus();
      return;
    }
    const version = routeVersion;
    const sessionVersion = authVersion;
    const userID = state.me?.id;
    const agent = state.agentDetail.agent;
    state.agentAssignDraft = assignDraftFromForm(form);
    state.agentAssignError = "";
    [...form.elements].forEach(control => { control.disabled = true; });
    form.querySelector('button[type="submit"]').textContent = "Creating…";
    try {
      const created = await api.post(`/api/v1/buckets/${encodeURIComponent(bucketID)}/tasks`, {
        title,
        description: form.elements.description.value,
        scheduledDate: form.elements.scheduledDate.value,
        assigneeAgentId: agent.id,
      });
      if (!sessionIsCurrent(sessionVersion, userID) || version !== routeVersion || !state.agentAssignOpen) return;
      state.agentAssignOpen = false;
      state.agentAssignDraft = null;
      state.agentAssignNotice = `"${created.title}" was assigned to ${agent.displayName}.`;
      state.agentTaskFocusID = created.id;
      await refreshAgentSurface();
    } catch (err) {
      if (!sessionIsCurrent(sessionVersion, userID) || version !== routeVersion || !state.agentAssignOpen) return;
      if (handleAgentUnauthorized(err)) return;
      state.agentAssignError = err.message;
      [...form.elements].forEach(control => { control.disabled = false; });
      form.querySelector('button[type="submit"]').textContent = "Create item";
      error.textContent = err.message;
    }
  });
}

function assignDraftFromForm(form) {
  return {
    title: form.elements.title?.value || "",
    description: form.elements.description?.value || "",
    scheduledDate: form.elements.scheduledDate?.value || "",
    bucketId: form.elements.bucketId?.value || "",
  };
}

function agentWorkItems() {
  if (state.agentWorkPage?.items) return state.agentWorkPage.items;
  const work = state.agentDetail?.work;
  return work ? [...(work.ready || []), ...(work.working || []), ...(work.review || []), ...(work.recentlyCompleted || [])] : [];
}

async function openAgentTask(element) {
  const item = agentWorkItems().find(work => work.id === element.dataset.openAgentTask);
  if (!item) return;
  const version = routeVersion;
  const sessionVersion = authVersion;
  const userID = state.me?.id;
  state.agentTaskFocusID = item.id;
  element.disabled = true;
  try {
    if (state.board?.id !== item.boardId || !state.board?.buckets) {
      if (!await loadBoard(item.boardId, sessionVersion, version)) return;
    }
    if (!sessionIsCurrent(sessionVersion, userID) || version !== routeVersion) return;
    state.selectedTask = { ...(findTask(item.id) || {}), ...item };
    state.error = "";
    render();
  } catch (err) {
    if (!sessionIsCurrent(sessionVersion, userID) || version !== routeVersion) return;
    if (handleAgentUnauthorized(err)) return;
    state.agentAssignNotice = `Item couldn’t be opened: ${err.message}`;
    render();
    document.querySelector(`[data-open-agent-task="${CSS.escape(item.id)}"]`)?.focus();
  }
}

async function refreshAgentSurface() {
  const route = parseRoute(location.pathname);
  if (!["agent-detail", "agent-work", "agent-settings"].includes(route.name)) return;
  const version = routeVersion;
  try {
    const loaded = await loadAgentDetail(route.agentId, {
      includeWorkPage: route.name === "agent-work",
      page: workPageFromLocation(),
      sessionVersion: authVersion,
      userID: state.me?.id,
      expectedRouteVersion: version,
    });
    if (!loaded || version !== routeVersion) return false;
    state.agentDetailLoadState = "ready";
    render();
    return true;
  } catch (err) {
    if (version !== routeVersion) return false;
    if (handleAgentUnauthorized(err, route)) return false;
    state.selectedTask = null;
    state.agentDetail = null;
    state.agentWorkPage = null;
    state.agentDetailLoadState = err.status === 404 ? "not-found" : err.status === 401 || err.status === 403 ? "unauthorized" : "error";
    state.agentDetailError = state.agentAssignNotice
      ? `${state.agentAssignNotice} Assigned work could not be refreshed.`
      : err.message;
    render();
    return false;
  }
}

async function copyAgentCredential(token, tokenElement, environment = {}) {
  const clipboard = environment.clipboard ?? globalThis.navigator?.clipboard;
  try {
    if (typeof clipboard?.writeText !== "function") throw new Error("Clipboard API unavailable");
    await clipboard.writeText(token);
    return true;
  } catch {
    // The browser may deny clipboard access. Select the credential before the
    // legacy fallback so a failed fallback still leaves a manual copy path.
  }

  const documentRef = environment.document ?? globalThis.document;
  const selection = environment.selection ?? globalThis.window?.getSelection?.();
  try {
    const range = documentRef.createRange();
    range.selectNodeContents(tokenElement);
    selection.removeAllRanges();
    selection.addRange(range);
    tokenElement.focus();
  } catch {
    tokenElement?.focus?.();
    return false;
  }

  try {
    const copied = documentRef.execCommand?.("copy") === true;
    if (copied) selection.removeAllRanges();
    return copied;
  } catch {
    return false;
  }
}

function openSettings() {
  if (!state.me || state.view === "logging-out" || state.view === "logout-error") return;
  return navigate(settingsPath());
}

function closeSettings() {
  const boardID = state.board?.id || state.boards[0]?.id;
  return navigate(boardID ? boardPath(boardID) : APP_PATH);
}

function showLogin() {
  state.error = "";
  return navigate(LOGIN_PATH);
}

function openApp() {
  return navigate(state.me ? APP_PATH : LOGIN_PATH);
}

function goHome() {
  return navigate(HOME_PATH);
}

async function addTask(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const title = new FormData(form).get("title").trim();
  if (!title) return;
  const list = state.board.buckets.find(b => b.id === form.dataset.addTask);
  const activeLimit = Math.min(list.limitCount || DEFAULT_LIST_LIMIT, accountLimits().activeItemsPerList);
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
      const id = drag.id;
      const index = fullTaskIndex(list, taskDropIndex(list, event.clientY), id);
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

// taskDropIndex counts rendered cards, but dropTask splices into the full task
// array. While a priority filter hides cards those two disagree, so translate
// the visible position into a real one by anchoring on the card dropped before.
function fullTaskIndex(listElement, visibleIndex, draggingID) {
  if (!state.priorityFilter) return visibleIndex;
  const bucket = state.board?.buckets?.find(b => b.id === listElement.dataset.taskList);
  const remaining = (bucket?.tasks || []).filter(task => task.id !== draggingID);
  const visibleIDs = [...listElement.querySelectorAll("[data-task]:not(.dragging)")].map(el => el.dataset.task);
  if (visibleIndex >= visibleIDs.length) return remaining.length;
  const anchor = remaining.findIndex(task => task.id === visibleIDs[visibleIndex]);
  return anchor < 0 ? remaining.length : anchor;
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

function settingsRouteIsCurrent(expectedRouteVersion, expectedPage) {
  return expectedRouteVersion === routeVersion && state.settings && state.settingsPage === expectedPage;
}

function clearSettingsCredentialsLeaving(nextPage) {
  if (state.settingsPage === "api" && nextPage !== "api") {
    state.newToken = "";
    state.newTokenOwnerID = "";
    // Navigation can wait on route metadata. Remove the secret from the live
    // page immediately so it is never visible under the next route's URL.
    globalThis.document?.querySelector(".one-time-token")?.remove();
  }
}

function clearAgentCredentialLeaving(nextRoute) {
  const nextRouteName = typeof nextRoute === "string" ? nextRoute : nextRoute?.name;
  if (state.view === "agent-new" && nextRouteName !== "agent-new") {
    state.agentCreationResult = null;
    state.agentCreateNotice = "";
    state.credentialCopied = false;
    state.credentialCopyError = "";
    globalThis.document?.querySelector(".agent-connection-result")?.remove();
  }
  const result = state.agentCredentialResult;
  const staysOnOwnerResult = result
    && nextRouteName === "agent-settings"
    && nextRoute?.agentId === result.agentID
    && result.ownerID === state.me?.id;
  if (result && !staysOnOwnerResult) clearAgentLifecycleCredential();
}

function clearAgentLifecycleCredential() {
  state.agentCredentialResult = null;
  state.credentialCopied = false;
  state.credentialCopyError = "";
  globalThis.document?.querySelector(".agent-lifecycle-secret")?.remove();
}

function settingsMutationIsCurrent(sessionVersion, userID, expectedRouteVersion, expectedPage) {
  return sessionIsCurrent(sessionVersion, userID)
    && (expectedRouteVersion === undefined || settingsRouteIsCurrent(expectedRouteVersion, expectedPage));
}

function boardSettingsMutationIsCurrent(sessionVersion, userID, expectedRouteVersion, boardID) {
  const route = parseRoute(location.pathname);
  return sessionIsCurrent(sessionVersion, userID)
    && expectedRouteVersion === routeVersion
    && state.view === "board-settings"
    && route.name === "board-settings"
    && route.boardId === boardID
    && state.board?.id === boardID;
}

function agentRouteIsCurrent(expectedRouteVersion, expectedView) {
  return expectedRouteVersion === routeVersion && state.view === expectedView;
}

async function loadTokens(sessionVersion = authVersion, userID = state.me?.id, expectedRouteVersion) {
  const data = await api.get("/api/v1/api-tokens");
  if (!sessionIsCurrent(sessionVersion, userID) || (expectedRouteVersion !== undefined && expectedRouteVersion !== routeVersion)) return false;
  state.tokens = data.tokens;
  return true;
}

async function loadAgents(optional = false, sessionVersion = authVersion, userID = state.me?.id, expectedRouteVersion) {
  try {
    const data = await api.get("/api/v1/agents");
    if (!sessionIsCurrent(sessionVersion, userID) || (expectedRouteVersion !== undefined && expectedRouteVersion !== routeVersion)) return false;
    state.agents = data.agents || [];
    state.maxAgents = Number(data.maxAgents) || accountLimits().agents || DEFAULT_MAX_AGENTS;
    state.activeAgents = Number.isInteger(data.activeAgents)
      ? data.activeAgents
      : state.agents.filter(agent => !agent.archivedAt && !agent.deletedAt).length;
    return true;
  } catch (err) {
    if (optional) return false;
    throw err;
  }
}

function workPageFromLocation() {
  const raw = new URLSearchParams(location.search).get("page");
  if (!raw) return 1;
  const page = Number(raw);
  return Number.isInteger(page) && page > 0 ? Math.min(page, 100000) : 1;
}

async function loadAgentDetail(agentID, options = {}) {
  const sessionVersion = options.sessionVersion ?? authVersion;
  const userID = options.userID ?? state.me?.id;
  const expectedRouteVersion = options.expectedRouteVersion;
  const requests = [api.get(`/api/v1/agents/${encodeURIComponent(agentID)}`)];
  if (options.includeWorkPage) {
    requests.push(api.get(`/api/v1/agents/${encodeURIComponent(agentID)}/work?page=${options.page || 1}&pageSize=50`));
  }
  const [detail, workPage] = await Promise.all(requests);
  if (!sessionIsCurrent(sessionVersion, userID) || (expectedRouteVersion !== undefined && expectedRouteVersion !== routeVersion)) return false;
  state.agentDetail = detail;
  state.agentWorkPage = options.includeWorkPage ? workPage : null;
  const index = state.agents.findIndex(agent => agent.id === detail.agent.id);
  if (index >= 0) state.agents[index] = detail.agent;
  else state.agents.push(detail.agent);
  return true;
}

async function createAgent(displayName, purpose, expectedRouteVersion) {
  const sessionVersion = authVersion;
  const userID = state.me?.id;
  try {
    const data = await api.post("/api/v1/agents", { displayName, purpose });
    if (!sessionIsCurrent(sessionVersion, userID) || !agentRouteIsCurrent(expectedRouteVersion, "agent-new")) return false;
    const { token, ...agent } = data;
    state.agentCreationResult = { ownerID: userID, agent, token };
    state.credentialCopied = false;
    state.credentialCopyError = "";
    state.agentCreateNotice = "";
    state.agents = [...state.agents.filter(item => item.id !== agent.id), agent];
    state.activeAgents = state.agents.filter(item => !item.archivedAt && !item.deletedAt).length;
    state.error = "";
    try {
      await loadAgents(false, sessionVersion, userID, expectedRouteVersion);
    } catch {
      if (!sessionIsCurrent(sessionVersion, userID) || !agentRouteIsCurrent(expectedRouteVersion, "agent-new")) return false;
      state.agentCreateNotice = "Agent created. The directory could not be refreshed, but this credential is still available until you leave this page.";
    }
    return true;
  } catch (err) {
    if (!sessionIsCurrent(sessionVersion, userID) || !agentRouteIsCurrent(expectedRouteVersion, "agent-new")) return false;
    state.error = err.message;
    return false;
  }
}

async function createAPIToken(name, expectedRouteVersion) {
  const sessionVersion = authVersion;
  const userID = state.me?.id;
  try {
    const data = await api.post("/api/v1/api-tokens", { name });
    if (!settingsMutationIsCurrent(sessionVersion, userID, expectedRouteVersion, "api")) return false;
    state.newToken = data.token;
    state.newTokenOwnerID = userID;
    state.settingsNotice = "";
    try {
      if (!await loadTokens(sessionVersion, userID, expectedRouteVersion)) return false;
      state.settingsNotice = "Personal token created.";
    } catch {
      if (!settingsMutationIsCurrent(sessionVersion, userID, expectedRouteVersion, "api")) return false;
      state.settingsNotice = "Personal token created. Active tokens could not be refreshed, but this one-time secret remains available until you leave or refresh this page.";
    }
    return true;
  } catch (err) {
    if (!settingsMutationIsCurrent(sessionVersion, userID, expectedRouteVersion, "api")) return false;
    state.settingsPending = "";
    state.error = err.message;
    render();
    return false;
  }
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
  state.themeStatus = "Saving preference…";
  state.error = "";
  render();
  const save = themeSaveChain.catch(() => {}).then(async () => {
    if (authVersion !== sessionVersion || state.me?.id !== userID) return;
    const user = await api.patch("/api/v1/me", { theme });
    if (authVersion !== sessionVersion || state.me?.id !== userID || user.id !== userID) return;
    state.me = { ...state.me, ...user };
    if (version === themeChangeVersion) state.theme = themeFor(user.theme);
    state.error = "";
    if (version === themeChangeVersion) state.themeStatus = "Theme preference saved.";
    render();
  }).catch(err => {
    if (!sessionIsCurrent(sessionVersion, userID)) return;
    if (version === themeChangeVersion) {
      state.theme = themeFor(state.me?.theme);
      state.error = err.message;
      state.themeStatus = `Could not save theme. Restored ${currentTheme()}.`;
      render();
    }
    return false;
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
  // Sign-out is in flight; the URL it lands on is decided when it finishes.
  if (state.view === "logging-out" || state.view === "logout-error") return;
  const nextRoute = parseRoute(location.pathname);
  clearSettingsCredentialsLeaving(nextRoute.settingsPage || "");
  clearAgentCredentialLeaving(nextRoute);
  await applyRoute();
});

boot();
