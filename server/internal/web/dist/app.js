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
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9.5 4v16"/>',
  rows: '<path d="M8.5 6h11.5M8.5 12h11.5M8.5 18h11.5"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  kanban: '<rect x="4" y="4.5" width="6.4" height="15" rx="1.6"/><rect x="13.6" y="4.5" width="6.4" height="10" rx="1.6"/>',
  columns: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M9 5v14M15 5v14"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4"/>',
  sun: '<circle cx="12" cy="12" r="3.6"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18"/>',
  moon: '<path d="M20 13.2A7.8 7.8 0 0 1 10.8 4a7.8 7.8 0 1 0 9.2 9.2z"/>',
  gear: '<circle cx="12" cy="12" r="3.1"/><path d="M12.6 2.6h-1.2a1.5 1.5 0 0 0-1.5 1.5v.3a1.5 1.5 0 0 1-.75 1.3l-.55.31a1.5 1.5 0 0 1-1.5 0l-.26-.14a1.5 1.5 0 0 0-2.05.54l-.6 1.04a1.5 1.5 0 0 0 .55 2.05l.26.15a1.5 1.5 0 0 1 .75 1.3v.62a1.5 1.5 0 0 1-.75 1.3l-.26.15a1.5 1.5 0 0 0-.55 2.05l.6 1.04a1.5 1.5 0 0 0 2.05.54l.26-.14a1.5 1.5 0 0 1 1.5 0l.55.31a1.5 1.5 0 0 1 .75 1.3v.3a1.5 1.5 0 0 0 1.5 1.5h1.2a1.5 1.5 0 0 0 1.5-1.5v-.3a1.5 1.5 0 0 1 .75-1.3l.55-.31a1.5 1.5 0 0 1 1.5 0l.26.14a1.5 1.5 0 0 0 2.05-.54l.6-1.04a1.5 1.5 0 0 0-.55-2.05l-.26-.15a1.5 1.5 0 0 1-.75-1.3v-.62a1.5 1.5 0 0 1 .75-1.3l.26-.15a1.5 1.5 0 0 0 .55-2.05l-.6-1.04a1.5 1.5 0 0 0-2.05-.54l-.26.14a1.5 1.5 0 0 1-1.5 0l-.55-.31a1.5 1.5 0 0 1-.75-1.3v-.3a1.5 1.5 0 0 0-1.5-1.5z"/>',
  user: '<circle cx="12" cy="8.2" r="3.2"/><path d="M5.8 19.5c.7-3.1 3-4.9 6.2-4.9s5.5 1.8 6.2 4.9"/>',
  bot: '<rect x="5" y="7" width="14" height="11" rx="3"/><path d="M12 7V4M9 12h.01M15 12h.01M9 15h6M3 11v3M21 11v3"/><circle cx="12" cy="3.5" r=".5" fill="currentColor" stroke="none"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  signOut: '<path d="M9.5 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2.5"/><path d="M15 8l4 4-4 4"/><path d="M9.5 12H19"/>',
  inboxTray: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 13h4.6a3.4 3.4 0 0 0 6.8 0H20"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 5v4h4"/><path d="M12 8v4.4l3 1.8"/>',
  server: '<rect x="3.5" y="4.5" width="17" height="6" rx="2"/><rect x="3.5" y="13.5" width="17" height="6" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  list: '<path d="M8.5 6h11.5M8.5 12h11.5M8.5 18h11.5"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
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
    const { headers = {}, ...requestOptions } = options;
    let res;
    try {
      res = await fetch(path, {
        credentials: "include",
        ...requestOptions,
        headers: { "Content-Type": "application/json", ...headers },
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
  post(path, body, options = {}) { return this.request(path, { ...options, method: "POST", body: JSON.stringify(body || {}) }); },
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
  boardCreatePending: false,
  selectedTask: null,
  selectedSubtasks: [],
  selectedEntries: [],
  cardEntryDraft: "",
  cardEntryKind: "comment",
  cardEntryPending: false,
  cardEntryError: "",
  cardEntryAttemptKey: "",
  taskDetailDrafts: {},
  taskMutationError: null,
  subtaskDraft: "",
  subtaskCreateAttempt: null,
  subtaskPending: false,
  subtaskError: "",
  newTaskRecovery: null,
  newTaskCapturePending: false,
  newTaskCaptureAttemptKey: "",
  settings: false,
  settingsPage: "profile",
  view: "home",
  error: "",
  settingsNotice: "",
  settingsPending: "",
  themeStatus: "",
  authNotice: "",
  resetToken: "",
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
  agentTaskMutationError: "",
  agentTaskRefreshError: "",
  agentLifecycleNotice: "",
  agentLifecycleError: "",
  agentLifecyclePending: "",
  agentLifecycleConfirm: "",
  agentCredentialResult: null,
  workspaceLists: [],
  workspaceListError: "",
  workspaceListPending: false,
  workspaceListDialog: "",
  workspaceListDialogListID: "",
  workspaceListDialogName: "",
  workspaceListDialogBoardID: "",
  workspaceListDialogError: "",
  inboxMessages: [],
  inboxLoading: false,
  workspaceTasks: [],
  workspaceScope: "all",
  workspaceListID: "",
  workspaceNextCursor: "",
  workspaceLoading: false,
  workspaceRefreshOnDetailClose: false,
  agentRefreshOnDetailClose: "",
  workspaceFiltersOpen: false,
  sidebarCollapsed: false,
  theme: "",
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
  { value: "new", label: "New" },
  { value: "queued", label: "Ready" },
  { value: "working", label: "In Progress" },
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
const TASKS_PATH = "/app/tasks";
const INBOX_PATH = "/app/inbox";
const TODAY_PATH = "/app/today";
const REVIEW_PATH = "/app/review";
const WEEK_PATH = "/app/week";
const SETTINGS_PATH = "/app/settings";
const SETTINGS_PAGES = [
  { id: "profile", label: "Profile", icon: "user", title: "Profile", description: "Your identity across Slate." },
  { id: "preferences", label: "Preferences", icon: "sun", title: "Preferences", description: "Choose how Slate looks for this account." },
  { id: "api", label: "API access", icon: "copy", title: "API access", description: "Manage personal access to the Slate CLI and API." },
];
const RUNS_PATH = "/app/runs";
const RUNNERS_PATH = "/app/runners";
const AGENTS_PATH = "/app/agents";
const NEW_AGENT_PATH = "/app/agents/new";
const EARLY_ACCESS_PATH = "/early-access";
const RESET_PASSWORD_PATH = "/reset-password";

function listPath(id) {
  return `/app/lists/${encodeURIComponent(id)}`;
}

function settingsPath(page = "profile") {
  return `${SETTINGS_PATH}/${page}`;
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
  if (path === APP_PATH) return { name: "workspace", scope: "all", redirect: true };
  if (path === TASKS_PATH) return { name: "workspace", scope: "all" };
  if (path === INBOX_PATH) return { name: "inbox" };
  // Retired views. Old links land on the board rather than a 404.
  if ([TODAY_PATH, REVIEW_PATH, WEEK_PATH].includes(path)) return { name: "workspace", scope: "all", redirect: true };
  const list = /^\/app\/lists\/([^/]+)$/.exec(path);
  if (list) {
    try {
      return { name: "workspace", scope: "list", listId: decodeURIComponent(list[1]) };
    } catch {
      return { name: "not-found" };
    }
  }
  if (path === SETTINGS_PATH) return { name: "settings", settingsPage: "profile", redirect: true };
  if (path === `${SETTINGS_PATH}/agents`) return { name: "agents", redirect: true };
  if (path === RUNS_PATH) return { name: "runs" };
  if (path === RUNNERS_PATH) return { name: "runners" };
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
      return { name: "board", boardId: decodeURIComponent(boardSettings[1]), redirect: true };
    } catch {
      return { name: "not-found" };
    }
  }
  const board = /^\/app\/boards\/([^/]+)$/.exec(path);
  if (board) {
    try {
      // A board is storage, not a surface. Its route folds into the one board.
      return { name: "board", boardId: decodeURIComponent(board[1]), redirect: true };
    } catch {
      return { name: "not-found" };
    }
  }
  return { name: "not-found" };
}

function isProtectedRoute(name) {
  return name === "workspace" || name === "board" || name === "settings" || name === "inbox" || name === "runs" || name === "runners"
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

function taskIDFromLocation(locationRef = globalThis.location) {
  return new URLSearchParams(locationRef?.search || "").get("task")?.trim() || "";
}

function routeSupportsTaskDetail(route) {
  return route.name === "workspace"
    || ["agent-detail", "agent-work", "agent-settings"].includes(route.name);
}

function taskLocationPath(taskID, locationRef = globalThis.location) {
  const query = new URLSearchParams(locationRef?.search || "");
  if (taskID) query.set("task", taskID);
  else query.delete("task");
  const search = query.toString();
  return `${locationRef?.pathname || TASKS_PATH}${search ? `?${search}` : ""}`;
}

function taskPermalink(taskID, locationRef = globalThis.location) {
  const path = taskLocationPath(taskID, locationRef);
  return locationRef?.origin ? `${locationRef.origin}${path}` : path;
}

const TASK_HISTORY_DEPTH_KEY = "slateTaskHistoryDepth";

function taskHistoryDepth(historyRef = globalThis.history) {
  const depth = Number(historyRef?.state?.[TASK_HISTORY_DEPTH_KEY]);
  return Number.isSafeInteger(depth) && depth > 0 ? depth : 0;
}

function syncTaskPermalink(taskID) {
  if (!globalThis.location || !globalThis.history) return;
  if (taskIDFromLocation() === taskID) return;
  const currentTaskID = taskIDFromLocation();
  const currentDepth = taskHistoryDepth();
  if (currentTaskID && currentDepth === 0) {
    history.replaceState({}, "", taskLocationPath(taskID));
    return;
  }
  const depth = currentTaskID ? currentDepth + 1 : 1;
  history.pushState({ [TASK_HISTORY_DEPTH_KEY]: depth }, "", taskLocationPath(taskID));
}

function clearTaskPermalink() {
  if (!globalThis.location || !globalThis.history) return;
  if (!taskIDFromLocation()) return;
  history.replaceState({}, "", taskLocationPath(""));
}

function returnFromTaskPermalink() {
  if (!globalThis.location || !globalThis.history || !taskIDFromLocation()) return false;
  const depth = taskHistoryDepth();
  clearTaskPermalink();
  if (depth > 0 && typeof history.go === "function") {
    taskHistoryReturnPath = currentLocationPath();
    history.go(-depth);
    return true;
  }
  return false;
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
let taskDetailVersion = 0;
let workspaceListVersion = 0;
let workspaceListLoadVersion = 0;
let workspaceLoadVersion = 0;
let boardLoadVersion = 0;
let taskHistoryReturnPath = "";
const agentDetailLoadVersions = new Map();
const taskMutationTurns = new Map();
let cardContextMenu = null;

async function serializeTaskMutation(taskID, mutation) {
  const sessionVersion = authVersion;
  const queued = taskMutationTurns.has(taskID);
  const previous = taskMutationTurns.get(taskID) || Promise.resolve();
  let release;
  const turn = new Promise(resolve => { release = resolve; });
  taskMutationTurns.set(taskID, turn);
  await previous.catch(() => {});
  try {
    if (sessionVersion !== authVersion) return null;
    return await mutation({ queued });
  } finally {
    release();
    if (taskMutationTurns.get(taskID) === turn) taskMutationTurns.delete(taskID);
  }
}

function handleAgentUnauthorized(err, route = parseRoute(location.pathname)) {
  if (err?.status !== 401 || !["agent-detail", "agent-work", "agent-settings"].includes(route.name)) return false;
  state.agents = [];
  state.activeAgents = 0;
  state.agentsLoadState = "idle";
  state.agentsLoadError = "";
  state.agentDetail = null;
  state.agentWorkPage = null;
  taskDetailVersion += 1;
  state.selectedTask = null;
  state.selectedSubtasks = [];
  state.selectedEntries = [];
  state.cardEntryDraft = "";
  state.cardEntryKind = "comment";
  state.cardEntryPending = false;
  state.cardEntryError = "";
  state.taskDetailDrafts = {};
  state.subtaskDraft = "";
  state.subtaskCreateAttempt = null;
  state.subtaskPending = false;
  state.subtaskError = "";
  state.newTaskRecovery = null;
  state.newTaskCapturePending = false;
  state.newTaskCaptureAttemptKey = "";
  state.agentAssignOpen = false;
  state.agentAssignError = "";
  state.agentAssignNotice = "";
  state.agentAssignBoardID = "";
  state.agentAssignDraft = null;
  state.agentTaskFocusID = "";
  state.agentTaskMutationError = "";
  state.agentTaskRefreshError = "";
  state.agentLifecycleNotice = "";
  state.agentLifecycleError = "";
  state.agentLifecyclePending = "";
  state.agentLifecycleConfirm = "";
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
  state.agentTaskMutationError = "";
  state.agentTaskRefreshError = "";
  state.agentLifecycleNotice = "";
  state.agentLifecycleError = "";
  state.agentLifecyclePending = "";
  state.agentLifecycleConfirm = "";
  state.agentDetailLoadState = "loading";
  state.agentDetailError = "";
  render();
}

// Renders whatever surface the current URL names, redirecting when the URL is
// not reachable in the current auth state. Every navigation funnels through here.
async function applyRoute() {
  const version = ++routeVersion;
  const route = parseRoute(location.pathname);
  const routeTaskID = routeSupportsTaskDetail(route) ? taskIDFromLocation() : "";
  if (state.agentRefreshOnDetailClose && state.agentRefreshOnDetailClose !== route.agentId) {
    state.agentRefreshOnDetailClose = "";
  }
  const hadMountedTask = Boolean(state.selectedTask);
  if (!routeTaskID || state.selectedTask?.id !== routeTaskID) {
    if (hadMountedTask) preserveCurrentTaskDraft();
    taskDetailVersion += 1;
    state.selectedTask = null;
    state.selectedSubtasks = [];
    state.selectedEntries = [];
    state.cardEntryDraft = "";
    state.cardEntryKind = "comment";
    state.cardEntryPending = false;
    state.cardEntryError = "";
    state.cardEntryAttemptKey = "";
    state.subtaskDraft = "";
    state.subtaskCreateAttempt = null;
    state.subtaskPending = false;
    state.subtaskError = "";
  }
  state.error = "";
  state.taskMutationError = null;
  state.workspaceRefreshOnDetailClose = false;
  state.workspaceListError = "";
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
    return route.name === "workspace"
      ? navigate(TASKS_PATH, { replace: true })
      : route.name === "agents"
      ? navigate(AGENTS_PATH, { replace: true })
      : route.name === "board"
      ? navigate(`${TASKS_PATH}${location.search}`, { replace: true })
      : navigate(settingsPath(route.settingsPage), { replace: true });
  }
  if (["agent-detail", "agent-work", "agent-settings"].includes(route.name)) prepareAgentRoute(route);
  try {
    const [boardsLoaded, listsLoaded] = await Promise.all([
      loadBoardList(version),
      loadWorkspaceListIndex(version),
    ]);
    if (!boardsLoaded || !listsLoaded) return;
    if (routeVersion !== version) return;
    if (route.name === "inbox") {
      await loadAgents(true, authVersion, state.me?.id, version);
      if (routeVersion !== version) return;
      if (await loadInbox(version) === null) return;
      if (routeVersion !== version) return;
      return showRoute("inbox");
    }
    if (route.name === "runs" || route.name === "runners") {
      await loadAgents(true, authVersion, state.me?.id, version);
      if (routeVersion !== version) return;
      return showRoute(route.name);
    }
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
      state.agentRefreshOnDetailClose = "";
      state.agentDetailLoadState = "ready";
      render();
      if (routeTaskID) await openTaskDetail(routeTaskID, null, { syncURL: false, preserveTaskDrafts: true, handleError: err => handleAgentUnauthorized(err, route) });
      return;
    }
    await loadAgents(true, authVersion, state.me?.id, version);
    if (routeVersion !== version) return;

    if (route.name === "workspace") {
      if (!state.board && state.boards[0]?.id && !await loadBoard(state.boards[0].id, authVersion, version)) return;
      const workspaceLoaded = await loadWorkspace(route, version);
      if (routeVersion !== version) return;
      if (workspaceLoaded === null) return;
      if (!workspaceLoaded) return showRoute("not-found");
      showRoute("app");
      if (routeTaskID) await openTaskDetail(routeTaskID, null, { syncURL: false, preserveTaskDrafts: true });
      return;
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

async function loadWorkspaceListIndex(expectedRouteVersion) {
  const sessionVersion = authVersion;
  const userID = state.me?.id;
  const expectedListVersion = workspaceListVersion;
  const loadVersion = ++workspaceListLoadVersion;
  const loadIsCurrent = () => loadVersion === workspaceListLoadVersion
    && sessionIsCurrent(sessionVersion, userID)
    && (expectedRouteVersion === undefined || expectedRouteVersion === routeVersion);
  let data;
  try {
    data = await api.get("/api/v1/lists");
  } catch (err) {
    if (!loadIsCurrent()) return false;
    throw err;
  }
  if (!loadIsCurrent()) return false;
  if (expectedListVersion !== workspaceListVersion) return true;
  state.workspaceLists = data.lists || [];
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

function workspaceQuery(route, cursor = "") {
  const current = new URLSearchParams(location.search);
  const query = new URLSearchParams({ limit: "200" });
  if (route.scope === "list") query.set("topLevel", "true");
  if (current.get("children") === "hide") query.set("topLevel", "true");
  if (route.scope === "list" && route.listId) query.set("bucketId", route.listId);
  for (const name of ["q", "status", "priority", "assigneeAgentId", "plannedFrom", "plannedTo"]) {
    if (current.get(name)) query.set(name, current.get(name));
  }
  if (cursor) query.set("cursor", cursor);
  return query;
}

async function loadInbox(expectedRouteVersion) {
  const sessionVersion = authVersion;
  const userID = state.me?.id;
  state.inboxLoading = true;
  try {
    const data = await api.get("/api/v1/inbox");
    if (!sessionIsCurrent(sessionVersion, userID) || expectedRouteVersion !== routeVersion) return null;
    state.inboxMessages = data.messages || [];
  } catch (err) {
    if (!sessionIsCurrent(sessionVersion, userID) || expectedRouteVersion !== routeVersion) return null;
    state.inboxLoading = false;
    throw err;
  }
  state.inboxLoading = false;
  return true;
}

async function loadWorkspace(route, expectedRouteVersion) {
  const sessionVersion = authVersion;
  const userID = state.me?.id;
  const loadVersion = ++workspaceLoadVersion;
  const loadIsCurrent = () => loadVersion === workspaceLoadVersion
    && sessionIsCurrent(sessionVersion, userID)
    && (expectedRouteVersion === undefined || expectedRouteVersion === routeVersion);
  state.workspaceLoading = true;
  if (route.scope === "list" && !state.workspaceLists.some(list => list.id === route.listId)) {
    state.workspaceLoading = false;
    return false;
  }
  let taskData;
  try {
    taskData = await api.get(`/api/v1/tasks?${workspaceQuery(route)}`);
  } catch (err) {
    if (!loadIsCurrent()) return null;
    state.workspaceLoading = false;
    throw err;
  }
  if (!loadIsCurrent()) return null;
  state.workspaceTasks = taskData.tasks || [];
  state.workspaceNextCursor = taskData.nextCursor || "";
  state.workspaceScope = route.scope || "all";
  state.workspaceListID = route.listId || "";
  state.workspaceLoading = false;
  return true;
}

async function loadMoreWorkspaceTasks() {
  if (!state.workspaceNextCursor || state.workspaceLoading) return;
  const route = parseRoute(location.pathname);
  if (route.name !== "workspace") return;
  const sessionVersion = authVersion;
  const userID = state.me?.id;
  const version = routeVersion;
  const cursor = state.workspaceNextCursor;
  const query = workspaceQuery(route, cursor).toString();
  state.workspaceLoading = true;
  render();
  try {
    const data = await api.get(`/api/v1/tasks?${query}`);
    if (!sessionIsCurrent(sessionVersion, userID) || version !== routeVersion) return;
    const known = new Set(state.workspaceTasks.map(task => task.id));
    state.workspaceTasks = [...state.workspaceTasks, ...(data.tasks || []).filter(task => !known.has(task.id))];
    state.workspaceNextCursor = data.nextCursor || "";
    state.error = "";
  } catch (err) {
    if (!sessionIsCurrent(sessionVersion, userID) || version !== routeVersion) return;
    state.error = err.message;
  }
  if (!sessionIsCurrent(sessionVersion, userID) || version !== routeVersion) return;
  state.workspaceLoading = false;
  render();
}

function resetAuthenticatedState() {
  goalSaveChains.clear();
  taskMutationTurns.clear();
  themeSaveChain = Promise.resolve();
  themeChangeVersion += 1;
  state.me = null;
  state.boards = [];
  state.maxBoards = DEFAULT_MAX_BOARDS;
  state.maxListsPerBoard = DEFAULT_MAX_LISTS_PER_BOARD;
  state.board = null;
  state.renamingBoardId = "";
  state.boardCreatePending = false;
  taskDetailVersion += 1;
  state.selectedTask = null;
  state.selectedSubtasks = [];
  state.selectedEntries = [];
  state.cardEntryDraft = "";
  state.cardEntryKind = "comment";
  state.cardEntryPending = false;
  state.cardEntryError = "";
  state.taskDetailDrafts = {};
  state.taskMutationError = null;
  state.subtaskDraft = "";
  state.subtaskCreateAttempt = null;
  state.subtaskPending = false;
  state.subtaskError = "";
  state.newTaskRecovery = null;
  state.newTaskCapturePending = false;
  state.newTaskCaptureAttemptKey = "";
  state.settings = false;
  state.settingsPage = "profile";
  state.error = "";
  state.settingsNotice = "";
  state.settingsPending = "";
  state.themeStatus = "";
  state.notice = "";
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
  state.agentTaskMutationError = "";
  state.agentTaskRefreshError = "";
  state.agentLifecycleNotice = "";
  state.agentLifecycleError = "";
  state.agentLifecyclePending = "";
  state.agentLifecycleConfirm = "";
  state.agentCredentialResult = null;
  state.workspaceLists = [];
  state.workspaceListError = "";
  state.workspaceListPending = false;
  state.workspaceListDialog = "";
  state.workspaceListDialogListID = "";
  state.workspaceListDialogName = "";
  state.workspaceListDialogBoardID = "";
  state.workspaceListDialogError = "";
  state.workspaceTasks = [];
  state.workspaceScope = "all";
  state.workspaceListID = "";
  state.workspaceNextCursor = "";
  state.workspaceLoading = false;
  state.workspaceRefreshOnDetailClose = false;
  state.agentRefreshOnDetailClose = "";
  state.workspaceFiltersOpen = false;
  state.sidebarCollapsed = false;
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
  const loadVersion = ++boardLoadVersion;
  const loadIsCurrent = () => loadVersion === boardLoadVersion
    && sessionVersion === authVersion
    && (expectedRouteVersion === undefined || expectedRouteVersion === routeVersion);
  const previousBoardID = state.board?.id || "";
  let board = await api.get(`/api/v1/boards/${id}`);
  if (!loadIsCurrent()) return false;
  const staleNames = (board.buckets || []).filter(list => list.name === "New bucket");
  if (staleNames.length) {
    try {
      await Promise.all(staleNames.map(list => api.patch(`/api/v1/buckets/${list.id}`, { name: "New list" })));
      if (!loadIsCurrent()) return false;
      board = await api.get(`/api/v1/boards/${id}`);
    } catch (err) {
      if (!loadIsCurrent()) return false;
      throw err;
    }
    if (!loadIsCurrent()) return false;
  }
  const changedBoard = previousBoardID && previousBoardID !== board.id;
  state.board = board;
  synchronizeWorkspaceListsForBoard(board);
  // A filter carried onto another board can render every column empty, which
  // reads as a broken board rather than an active filter.
  state.selectedTask = state.selectedTask ? findTask(state.selectedTask.id) : null;
  return true;
}

function synchronizeWorkspaceListsForBoard(board) {
  if (!board?.id) return;
  const lists = (board.buckets || []).map(list => ({
    ...list,
    boardId: list.boardId || board.id,
    boardName: list.boardName || board.name || "",
  }));
  const firstBoardListIndex = state.workspaceLists.findIndex(list => list.boardId === board.id);
  const retained = state.workspaceLists.filter(list => list.boardId !== board.id);
  const insertionIndex = firstBoardListIndex < 0
    ? retained.length
    : state.workspaceLists.slice(0, firstBoardListIndex).filter(list => list.boardId !== board.id).length;
  retained.splice(insertionIndex, 0, ...lists);
  state.workspaceLists = retained;
}

function workspaceListCount(boardID) {
  return state.workspaceLists.filter(list => list.boardId === boardID).length;
}

function boardWithWorkspaceListCapacity() {
  const limit = Number(state.maxListsPerBoard);
  if (!Number.isFinite(limit) || limit < 1) return null;
  return state.boards.find(board => workspaceListCount(board.id) < limit) || null;
}

async function createWorkspaceList(name) {
  if (state.workspaceListPending) return false;
  name = String(name || "").trim();
  if (!name) return false;
  state.workspaceListDialogName = name;
  const requestedBoard = state.boards.find(item => item.id === state.workspaceListDialogBoardID);
  const board = requestedBoard
    ? workspaceListCount(requestedBoard.id) < state.maxListsPerBoard ? requestedBoard : null
    : boardWithWorkspaceListCapacity();
  state.workspaceListDialogBoardID = board?.id || "";
  if (!board) {
    state.workspaceListDialogError = "No room for another list.";
    render();
    return false;
  }
  const sessionVersion = authVersion;
  const userID = state.me?.id;
  const routeAtStart = parseRoute(globalThis.location?.pathname || "");
  const routeVersionAtStart = routeVersion;
  state.workspaceListPending = true;
  state.workspaceListError = "";
  render();
  globalThis.document?.querySelector?.(".workspace-list-dialog")?.focus();
  try {
    const created = await api.post(`/api/v1/boards/${board.id}/buckets`, { name });
    if (!sessionIsCurrent(sessionVersion, userID)) return false;
    const list = {
      ...created,
      boardId: created.boardId || board.id,
      boardName: created.boardName || board.name || "",
      name: created.name || name,
      isInbox: Boolean(created.isInbox),
      openCount: Number(created.openCount || 0),
    };
    workspaceListVersion += 1;
    state.workspaceLists = [...state.workspaceLists.filter(item => item.id !== list.id), list];
    if (state.board?.id === board.id) {
      state.board = {
        ...state.board,
        buckets: [...(state.board.buckets || []).filter(item => item.id !== list.id), list],
      };
      synchronizeWorkspaceListsForBoard(state.board);
    }
    state.workspaceListPending = false;
    state.workspaceListError = "";
    state.workspaceListDialog = "";
    state.workspaceListDialogName = "";
    state.workspaceListDialogBoardID = "";
    state.workspaceListDialogError = "";
    if (routeVersionAtStart !== routeVersion) return true;
    if (routeAtStart.name === "workspace") await navigate(listPath(list.id));
    else render();
    return true;
  } catch (err) {
    if (!sessionIsCurrent(sessionVersion, userID)) return false;
    state.workspaceListPending = false;
    state.workspaceListDialogError = err.message;
    if (routeVersionAtStart !== routeVersion) {
      state.workspaceListDialog = "";
      state.workspaceListDialogListID = "";
      state.workspaceListDialogName = "";
      state.workspaceListDialogBoardID = "";
      return false;
    }
    render();
    globalThis.document?.querySelector?.("#workspace-list-name")?.focus();
    return false;
  }
}

async function deleteWorkspaceList(listID) {
  if (state.workspaceListPending) return false;
  const list = state.workspaceLists.find(item => item.id === listID);
  if (!list || list.isInbox) return false;
  const sessionVersion = authVersion;
  const userID = state.me?.id;
  const routeAtStart = parseRoute(globalThis.location?.pathname || "");
  const routeVersionAtStart = routeVersion;
  state.workspaceListPending = true;
  state.workspaceListDialogError = "";
  render();
  globalThis.document?.querySelector?.(".workspace-list-dialog")?.focus();
  try {
    await api.del(`/api/v1/buckets/${encodeURIComponent(listID)}`);
    if (!sessionIsCurrent(sessionVersion, userID)) return false;
    workspaceListVersion += 1;
    state.workspaceLists = state.workspaceLists.filter(item => item.id !== listID);
    state.workspaceTasks = state.workspaceTasks.filter(task => task.bucketId !== listID);
    if (state.board?.id === list.boardId) {
      state.board = { ...state.board, buckets: (state.board.buckets || []).filter(item => item.id !== listID) };
    }
    state.workspaceListPending = false;
    state.workspaceListDialog = "";
    state.workspaceListDialogListID = "";
    state.workspaceListDialogName = "";
    state.workspaceListDialogBoardID = "";
    state.workspaceListDialogError = "";
    if (routeVersionAtStart !== routeVersion) return true;
    if (routeAtStart.name === "workspace") await navigate(TASKS_PATH);
    else if (routeAtStart.name === "board") await reload();
    else render();
    return true;
  } catch (err) {
    if (!sessionIsCurrent(sessionVersion, userID)) return false;
    state.workspaceListPending = false;
    state.workspaceListDialogError = err.message;
    if (routeVersionAtStart !== routeVersion) {
      state.workspaceListDialog = "";
      state.workspaceListDialogListID = "";
      state.workspaceListDialogName = "";
      state.workspaceListDialogBoardID = "";
      return false;
    }
    render();
    globalThis.document?.querySelector?.("#confirm-workspace-list-dialog")?.focus();
    return false;
  }
}

async function loadAllSubtasks(taskID, isCurrent) {
  const tasks = [];
  const known = new Set();
  let cursor = "";
  do {
    const query = new URLSearchParams({ parentTaskId: taskID, limit: "200" });
    if (cursor) query.set("cursor", cursor);
    const page = await api.get(`/api/v1/tasks?${query}`);
    if (!isCurrent()) return null;
    for (const task of page.tasks || []) {
      if (known.has(task.id)) continue;
      known.add(task.id);
      tasks.push(task);
    }
    cursor = page.nextCursor || "";
  } while (cursor);
  return tasks;
}

async function openTaskDetail(taskID, trigger, options = {}) {
  const movingWithinTaskChain = Boolean(state.selectedTask) || options.preserveTaskDrafts;
  const detailVersion = ++taskDetailVersion;
  state.subtaskPending = false;
  if (!movingWithinTaskChain) {
    state.taskDetailDrafts = {};
    state.subtaskDraft = "";
    state.subtaskCreateAttempt = null;
    state.subtaskError = "";
  }
  const summary = findTask(taskID) || {};
  const sessionVersion = authVersion;
  const userID = state.me?.id;
  const version = routeVersion;
  const isCurrent = () => sessionIsCurrent(sessionVersion, userID) && version === routeVersion && detailVersion === taskDetailVersion;
  if (trigger) trigger.disabled = true;
  try {
    const [detail, subtasks, entryPage] = await Promise.all([
      api.get(`/api/v1/tasks/${encodeURIComponent(taskID)}`),
      loadAllSubtasks(taskID, isCurrent),
      api.get(`/api/v1/tasks/${encodeURIComponent(taskID)}/entries`),
    ]);
    if (!isCurrent() || subtasks === null) return false;
    const savedDraft = state.taskDetailDrafts[taskID] || {};
    const {
      cardEntryDraft = "",
      cardEntryKind = "comment",
      cardEntryPending = false,
      cardEntryError = "",
      cardEntryAttemptKey = "",
      subtaskDraft = "",
      subtaskCreateAttempt = null,
      subtaskPending = false,
      subtaskError = "",
      ...taskDraft
    } = savedDraft;
    state.selectedTask = { ...summary, ...detail, ...taskDraft };
    state.selectedSubtasks = subtasks;
    state.selectedEntries = entryPage.entries || [];
    state.cardEntryDraft = cardEntryDraft;
    state.cardEntryKind = cardEntryKind === "output" ? "output" : "comment";
    state.cardEntryPending = cardEntryPending;
    state.cardEntryError = cardEntryError;
    state.cardEntryAttemptKey = cardEntryAttemptKey;
    state.subtaskDraft = subtaskDraft;
    state.subtaskCreateAttempt = subtaskCreateAttempt;
    state.subtaskPending = subtaskPending;
    state.subtaskError = subtaskError;
    state.error = "";
    if (options.syncURL !== false) syncTaskPermalink(taskID);
    render();
    focusOpenedTaskDetail();
    return true;
  } catch (err) {
    if (!isCurrent()) return false;
    if (options.handleError?.(err)) return false;
    if (options.onError) options.onError(err);
    else state.error = err.message;
    render();
    return false;
  }
}

function focusOpenedTaskDetail() {
  globalThis.document?.querySelector?.("[data-close-detail]")?.focus();
}

function render() {
  closeCardContextMenu();
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
  if (state.view === "inbox") {
    root.innerHTML = inboxHTML();
    bindAppShell();
    bindWorkspaceListControl();
    document.querySelectorAll("[data-inbox-task]").forEach(element => element.addEventListener("click", event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(`${TASKS_PATH}?task=${encodeURIComponent(element.dataset.inboxTask)}`);
    }));
    return;
  }
  if (state.view === "runs" || state.view === "runners") {
    root.innerHTML = executionPlaceholderHTML(state.view);
    bindAppShell();
    bindWorkspaceListControl();
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
  if (parseRoute(location.pathname).name === "workspace") {
    root.innerHTML = appHTML();
    bindApp();
    return;
  }
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
            <h1 class="rise" style="--d:0">Stay on top of everything. <em>Operate at agent speed.</em></h1>
            <p class="landing-lede rise" style="--d:1">Slate turns your emails, projects, commitments, and loose ends into one clear operating plan. Agents help you organise the noise, surface what needs your attention, and execute the work.</p>
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
          </div>
          <div class="tour-frame" data-reveal>
            <img class="tour-img on" data-tour-img="lists" src="/app-lists.jpg" alt="Slate lists: flexible contexts containing tasks">
            <img class="tour-img" data-tour-img="flow" src="/app-flow.jpg" alt="Slate board: tasks grouped by status">
          </div>
          <p class="preview-caption" data-reveal>
            <span class="tour-caption on" data-tour-caption="lists">Use a list as a project, goal, area, or any context that helps you think.</span>
            <span class="tour-caption" data-tour-caption="flow">You and your agents move work through the same states.</span>
          </p>
        </section>
        <section class="landing-principles">
          <h2 class="principles-head" data-reveal>Less, on purpose.</h2>
          <p class="principles-sub" data-reveal style="--d:0">You do not get more done by taking on more. You get more done by being clear about what matters, then giving the rest to agents that can run it in parallel.</p>
          <div class="principle" data-reveal style="--d:0">
            <span class="principle-num">01</span>
            <h3>Lists for clear thinking</h3>
            <p>Put work into the buckets that match how you think. Switch the view when you need to plan, execute, or review it.</p>
          </div>
          <div class="principle" data-reveal style="--d:1">
            <span class="principle-num">02</span>
            <h3>One shared state</h3>
            <p>Every card carries its prompt, conversation, output, and state. You and your agents are always reading the same truth.</p>
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
  const theme = currentTheme();
  const tasks = workspaceScopedTasks();
  const list = state.workspaceLists.find(item => item.id === state.workspaceListID);
  const title = state.workspaceScope === "list" ? list?.name || "List" : "Board";
  const subtitle = state.workspaceScope === "list" ? list?.goal || "A focused bucket of work." : "One control plane for human and agent work.";
  const renameableList = state.workspaceScope === "list" && list && !list.isInbox;
  const overview = `
    <header class="workspace-topbar">
      <div><div class="workspace-title">${renameableList
        ? `<label class="sr-only" for="workspace-list-name">List name</label><input class="workspace-title-input" id="workspace-list-name" data-bucket-name="${escapeAttr(list.id)}" value="${escapeAttr(list.name)}" maxlength="100" autocomplete="off">`
        : `<h1>${escapeHTML(title)}</h1>`}<span>${tasks.length}</span></div><p>${escapeHTML(subtitle)}</p></div>
      <div class="workspace-topbar-actions">
        ${state.workspaceScope === "list" && list && !list.isInbox ? `<button class="plain-btn danger-text" id="delete-workspace-list" type="button" data-list-id="${escapeAttr(list.id)}">${icon("trash")}<span>Delete list</span></button>` : ""}
      </div>
    </header>
    ${state.selectedTask ? "" : statusErrorHTML(state.error || state.taskMutationError?.message)}
    <div class="workspace-viewbar">
      <div class="workspace-view-actions">
        <button class="plain-btn workspace-filter-toggle" id="workspace-filter-toggle">${icon("filter")}<span>Filter</span>${workspaceFilterCount() ? `<b>${workspaceFilterCount()}</b>` : ""}</button>
      </div>
    </div>
    ${state.workspaceFiltersOpen ? workspaceFilterHTML() : ""}
    <div class="workspace-content" id="workspace-task-panel">
      ${state.workspaceLoading ? `<div class="workspace-empty">Loading tasks…</div>` : workspaceFlowHTML(tasks)}
    </div>
    ${state.workspaceNextCursor ? `<button class="secondary workspace-load-more" id="workspace-load-more" ${state.workspaceLoading ? "disabled" : ""}>${state.workspaceLoading ? "Loading…" : "Load more tasks"}</button>` : ""}`;
  return `
    <section class="shell task-shell theme-${theme}">
      ${appSidebarHTML()}
      <div class="main workspace-main ${state.selectedTask ? "card-detail-main" : ""}">
        ${state.selectedTask ? workspaceDetailHTML(state.selectedTask) : overview}
      </div>
    </section>`;
}

function workspaceScopedTasks() {
  return state.workspaceTasks;
}

function workspaceFilterCount() {
  const query = new URLSearchParams(globalThis.location?.search || "");
  const names = ["q", "priority", "assigneeAgentId", "status", "plannedFrom", "plannedTo"];
  if (state.workspaceScope !== "list") names.push("children");
  return names.filter(name => query.get(name)).length;
}

function workspaceFilterHTML() {
  const query = new URLSearchParams(globalThis.location?.search || "");
  const agentOptions = state.agents.map(agent => `<option value="${escapeAttr(agent.id)}" ${query.get("assigneeAgentId") === agent.id ? "selected" : ""}>${escapeHTML(agent.displayName)}</option>`).join("");
  return `<form class="workspace-filters" id="workspace-filters">
    <label class="workspace-search"><span>Search</span><input name="q" value="${escapeAttr(query.get("q") || "")}" placeholder="Search tasks…"></label>
    <label><span>Status</span><select name="status"><option value="">Any status</option>${FLOW_STATES.map(item => `<option value="${item.value}" ${query.get("status") === item.value ? "selected" : ""}>${item.label}</option>`).join("")}</select></label>
    <label><span>Priority</span><select name="priority"><option value="">Any priority</option>${PRIORITIES.map(item => `<option value="${item.value}" ${query.get("priority") === item.value ? "selected" : ""}>${item.label}</option>`).join("")}</select></label>
    <label><span>Owner</span><select name="assigneeAgentId"><option value="">Anyone</option><option value="unassigned" ${query.get("assigneeAgentId") === "unassigned" ? "selected" : ""}>${escapeHTML(state.me?.displayName || "You")}</option>${agentOptions}</select></label>
    ${state.workspaceScope === "list" ? "" : `<fieldset class="workspace-child-filter"><legend>Subtasks</legend><label class="workspace-checkbox"><input type="checkbox" name="children" value="hide" ${query.get("children") === "hide" ? "checked" : ""}><span>Hide subtasks</span></label></fieldset>`}
    <label><span>From</span><input type="date" name="plannedFrom" value="${escapeAttr(query.get("plannedFrom") || "")}"></label>
    <label><span>To</span><input type="date" name="plannedTo" value="${escapeAttr(query.get("plannedTo") || "")}"></label>
    <button class="secondary" type="submit">Apply</button><button class="plain-btn" id="clear-workspace-filters" type="button">Clear</button>
  </form>`;
}

function workspaceTaskOwner(task) {
  return task.assigneeAgentName || state.agents.find(agent => agent.id === task.assigneeAgentId)?.displayName || state.me?.displayName || "You";
}

function workspaceTaskContext(task, includeOwner = false) {
  const context = [];
  if (task.parentTaskId) context.push(`Child of ${task.parentTaskTitle || "parent task"}`);
  context.push(task.listName || "Inbox");
  if (includeOwner) context.push(workspaceTaskOwner(task));
  return context.join(" · ");
}

function workspaceFlowHTML(tasks) {
  const card = task => `<article class="workspace-flow-card" draggable="true" data-task="${task.id}"><button data-open-task="${task.id}" aria-label="Open task: ${escapeAttr(task.title)}"><strong>${escapeHTML(task.title)}</strong><small>${escapeHTML(workspaceTaskContext(task, true))}</small></button></article>`;
  return `<section class="workspace-flow grouped-by-status">${FLOW_STATES.map(group => {
    const items = tasks.filter(task => task.status === group.value);
    return `<section class="workspace-flow-column" data-flow-status="${escapeAttr(group.value)}"><header><h2>${escapeHTML(group.label)}</h2><span>${items.length}</span></header><div>${items.length ? items.map(card).join("") : `<p>Drag tasks here</p>`}</div></section>`;
  }).join("")}</section>`;
}

function taskDetailBackLabel() {
  if (["agent-detail", "agent-work", "agent-settings"].includes(state.view)) return "Back to agent work";
  return "Back to board";
}

function workspaceListDialogHTML() {
  if (!state.workspaceListDialog) return "";
  const deletingList = state.workspaceListDialog === "delete";
  const deletingBoard = state.workspaceListDialog === "delete-board";
  const deleting = deletingList || deletingBoard;
  const list = state.workspaceLists.find(item => item.id === state.workspaceListDialogListID);
  const board = state.boards.find(item => item.id === state.workspaceListDialogBoardID);
  if (deletingList && (!list || list.isInbox)) return "";
  if (deletingBoard && !board) return "";
  const targetName = deletingBoard ? board.name : list?.name;
  return `<div class="detail-overlay workspace-list-dialog-overlay">
    <section class="agent-lifecycle-dialog workspace-list-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-list-dialog-title" tabindex="-1">
      <header>
        <span class="agent-state-icon">${icon(deleting ? "trash" : "plus")}</span>
        <div><h2 id="workspace-list-dialog-title">${deleting ? `Delete ${escapeHTML(targetName)}?` : "New list"}</h2><p>${deletingBoard ? "Every list and task on this board will be permanently deleted. This cannot be undone." : deletingList ? "Tasks in this list will also be permanently deleted. This cannot be undone." : "Lists are flexible containers for related tasks."}</p></div>
      </header>
      <form id="workspace-list-dialog-form">
        ${deleting ? "" : `<label class="workspace-list-dialog-field"><span>Name</span><input id="workspace-list-name" name="name" value="${escapeAttr(state.workspaceListDialogName)}" maxlength="100" autocomplete="off" required ${state.workspaceListPending ? "disabled" : ""}></label>`}
        <p class="status-error" role="alert">${escapeHTML(state.workspaceListDialogError)}</p>
        <footer><button class="secondary" id="cancel-workspace-list-dialog" type="button" ${state.workspaceListPending ? "disabled" : ""}>Cancel</button><button class="${deleting ? "danger" : "primary"}" id="confirm-workspace-list-dialog" type="submit" ${state.workspaceListPending ? "disabled" : ""}>${state.workspaceListPending ? (deleting ? "Deleting…" : "Creating…") : (deletingBoard ? "Delete board" : deletingList ? "Delete list" : "Create list")}</button></footer>
      </form>
    </section>
  </div>`;
}

function workspaceListLabel(list) {
  const name = list.isInbox ? "Inbox" : list.name;
  const duplicates = state.workspaceLists.filter(item => (item.isInbox ? "Inbox" : item.name) === name);
  if (duplicates.length < 2) return name;
  const duplicateBoardIDs = new Set(duplicates.map(item => item.boardId).filter(Boolean));
  const board = state.boards.find(candidate => candidate.id === list.boardId);
  const qualified = duplicateBoardIDs.size > 1 && board?.name ? `${board.name} / ${name}` : name;
  const sameQualified = duplicates.filter(item => {
    const itemBoard = state.boards.find(candidate => candidate.id === item.boardId);
    const itemQualified = duplicateBoardIDs.size > 1 && itemBoard?.name ? `${itemBoard.name} / ${name}` : name;
    return itemQualified === qualified;
  });
  return sameQualified.length > 1 ? `${qualified} (${list.id})` : qualified;
}

function workspaceDetailHTML(task) {
  const list = state.workspaceLists.find(item => item.id === task.bucketId);
  const completed = state.selectedSubtasks.filter(item => item.status === "done").length;
  const entries = state.selectedEntries.map(entry => `<article class="card-entry card-entry-${entry.kind}">
    <header><span class="card-entry-author ${entry.authorKind === "agent" ? "agent" : ""}">${entry.authorKind === "agent" ? icon("bot") : icon("user")}<strong>${escapeHTML(entry.authorName)}</strong></span><time>${new Date(entry.createdAt).toLocaleString()}</time></header>
    <p>${escapeHTML(entry.body).replace(/\n/g, "<br>")}</p>
    <footer>${entry.kind === "output" ? `<span class="card-entry-kind">Output</span>` : ""}</footer>
  </article>`).join("");
  const subtaskSection = task.parentTaskId ? `<button class="workspace-parent-link" type="button" data-open-parent>${icon("chevronLeft")}<span>Back to parent task</span></button>` : `
    <section class="workspace-subtasks" aria-labelledby="subtasks-heading">
      <header><div><h3 id="subtasks-heading">Subtasks</h3><span>${completed} of ${state.selectedSubtasks.length} done</span></div></header>
      ${state.selectedSubtasks.length ? `<div class="workspace-subtask-list">
        ${state.selectedSubtasks.map(item => `<div class="workspace-subtask-row" data-task="${item.id}"><button class="workspace-subtask-open" type="button" data-open-task="${item.id}"><strong>${escapeHTML(item.title)}</strong><span class="state-badge state-${item.status}">${escapeHTML(statusLabel(item.status))}</span><span>${escapeHTML(workspaceTaskOwner(item))}</span></button></div>`).join("")}
      </div>` : `<p class="workspace-subtask-empty">Use subtasks only when this task needs smaller pieces.</p>`}
      <div id="add-subtask" class="workspace-add-subtask"><input name="title" value="${escapeAttr(state.subtaskDraft)}" placeholder="Add a subtask" aria-label="Subtask title" ${state.subtaskPending ? "disabled" : ""}><button type="button" class="plain-btn" ${state.subtaskPending ? "disabled" : ""}>${icon("plus")}<span>${state.subtaskPending ? "Adding…" : "Add subtask"}</span></button></div>
      <p class="error workspace-subtask-error" role="alert">${escapeHTML(state.subtaskError)}</p>
    </section>`;
  const details = `
          <section class="detail-block detail-summary" aria-labelledby="detail-summary-heading">
            <h3 id="detail-summary-heading" class="detail-block-heading">Details</h3>
            <div class="detail-properties">
              <div class="field"><label for="workspace-detail-owner">Agent</label><select id="workspace-detail-owner" name="assigneeAgentId">${agentOptionsHTML(task.assigneeAgentId)}</select></div>
              <div class="field"><label for="workspace-detail-status">Status</label><select id="workspace-detail-status" name="status">${statusOptionsHTML(task.status)}</select></div>
              <div class="field"><label for="workspace-detail-list">List</label><select id="workspace-detail-list" ${task.parentTaskId ? "disabled aria-describedby=\"workspace-detail-list-help\"" : 'name="bucketId"'}>${state.workspaceLists.map(item => `<option value="${item.id}" ${item.id === task.bucketId ? "selected" : ""}>${escapeHTML(workspaceListLabel(item))}</option>`).join("")}</select>${task.parentTaskId ? `<small id="workspace-detail-list-help">Subtasks stay with their parent task.</small>` : ""}</div>
              <div class="field"><label for="workspace-detail-priority">Priority</label><select id="workspace-detail-priority" name="priority">${priorityOptionsHTML(task.priority)}</select></div>
              <div class="field"><label for="workspace-detail-date">Planned</label><input id="workspace-detail-date" name="scheduledDate" type="date" value="${escapeAttr(task.scheduledDate || "")}"></div>
            </div>
          </section>`;
  const reference = `
          <section class="task-reference-field" aria-label="Task reference">
            <span class="task-reference-label">Task ID</span>
            <div class="task-reference-value">
              <code id="workspace-task-id" tabindex="0">${escapeHTML(task.id)}</code>
              <button class="secondary icon-label" id="copy-task-id" type="button" aria-label="Copy task ID">${icon("copy")}<span>Copy ID</span></button>
              <button class="secondary icon-label task-link-copy" id="copy-task-link" type="button">${icon("copy")}<span>Copy link</span></button>
            </div>
            <code class="sr-only" id="workspace-task-link" aria-hidden="true">${escapeHTML(taskPermalink(task.id))}</code>
            <p class="task-reference-status" id="task-reference-status" role="status" aria-live="polite"></p>
          </section>`;
  return `<section class="workspace-detail" aria-label="Task detail" data-detail-surface tabindex="-1">
      <header class="detail-head"><button class="plain-btn workspace-detail-close" type="button" data-close-detail>${icon("chevronLeft")}<span>${taskDetailBackLabel()}</span></button><div class="detail-context"><span>${escapeHTML(list?.name || "Inbox")}</span><span>/</span><b>${task.parentTaskId ? "Subtask" : "Task"}</b></div></header>
      <form id="workspace-detail-form" class="workspace-detail-form">
        <div class="workspace-detail-main">
         <div class="detail-column">
          <label class="sr-only" for="workspace-detail-title">Title</label><input class="detail-title" id="workspace-detail-title" name="title" value="${escapeAttr(task.title)}" required>
          ${details}
          <section class="detail-block">
            <label class="detail-block-heading" for="workspace-detail-description">Description</label>
            <textarea class="detail-description" id="workspace-detail-description" name="description" placeholder="What is the intent? Add the outcome, context, constraints, and useful links…">${escapeHTML(task.description || "")}</textarea>
            <p class="detail-block-hint">An assigned agent receives this as its instruction.</p>
          </section>
          ${task.parentTaskId ? `<div class="workspace-parent-context">${subtaskSection}</div>` : subtaskSection}
          <section class="card-conversation" aria-labelledby="card-conversation-heading">
            <header><div><h3 id="card-conversation-heading">Conversation</h3><span>${state.selectedEntries.length}</span></div></header>
            ${entries ? `<div class="card-entry-list">${entries}</div>` : `<p class="card-conversation-empty">Comments and agent outputs will appear here.</p>`}
            <div class="card-entry-composer">
              <div class="card-entry-tabs" role="group" aria-label="Entry type"><button type="button" data-entry-kind="comment" class="${state.cardEntryKind === "comment" ? "on" : ""}">Comment</button><button type="button" data-entry-kind="output" class="${state.cardEntryKind === "output" ? "on" : ""}">Output</button></div>
              <textarea id="card-entry-body" placeholder="${state.cardEntryKind === "output" ? "Add the result, links, or deliverable…" : "Add feedback, context, or a question…"}" ${state.cardEntryPending ? "disabled" : ""}>${escapeHTML(state.cardEntryDraft)}</textarea>
              <footer><span>${state.cardEntryKind === "output" ? "Outputs move the task to Review." : "Comments stay with the task."}</span><button class="primary" id="add-card-entry" type="button" ${state.cardEntryPending ? "disabled" : ""}>${state.cardEntryPending ? "Adding…" : `Add ${state.cardEntryKind}`}</button></footer>
              <p class="error card-entry-error" role="alert">${escapeHTML(state.cardEntryError)}</p>
            </div>
          </section>
          ${reference}
          <p class="error detail-error" role="alert">${escapeHTML(state.error)}</p>
         </div>
        </div>
        <footer class="detail-actions"><button class="danger" type="button" id="delete-task">Delete task</button><div><button class="primary" type="submit">Save changes</button></div></footer>
      </form>
    </section>`;
}

function appSidebarHTML({ agentsCurrent = false } = {}) {
  const route = parseRoute(globalThis.location?.pathname || APP_PATH);
  const workspaceOn = name => route.name === "workspace" && state.workspaceScope === name;
  return `
    <aside class="sidebar ${state.sidebarCollapsed ? "collapsed" : ""}" id="primary-navigation" aria-label="Primary navigation">
      <div class="sidebar-head">
        <button class="brand brand-button" type="button" data-home>slate<span>.do</span></button>
        <button class="icon-btn sidebar-toggle" id="sidebar-toggle" type="button" aria-label="Open navigation" aria-controls="sidebar-content" aria-expanded="false">${icon("menu")}</button>
      </div>
      <div class="sidebar-content" id="sidebar-content">
        ${globalNewTaskButtonHTML()}
        ${newTaskRecoveryNoticeHTML()}
        <section class="nav-sec nav-collaborators workspace-nav">
          <a class="nav-link ${route.name === "inbox" ? "on" : ""}" href="${INBOX_PATH}">${icon("inboxTray")}<span>Inbox</span></a>
          <a class="nav-link ${workspaceOn("all") ? "on" : ""}" href="${TASKS_PATH}">${icon("kanban")}<span>Board</span></a>
        </section>
        ${listsNavigationHTML()}
        <section class="nav-sec nav-collaborators">
          <a class="plain-btn icon-label nav-link ${agentsCurrent ? "on" : ""}" id="agents-nav" href="${AGENTS_PATH}" ${agentsCurrent ? 'aria-current="page"' : ""}>${icon("bot")}<span>Agents</span></a>
          <a class="nav-link ${route.name === "runs" ? "on" : ""}" href="${RUNS_PATH}">${icon("history")}<span>Runs</span></a>
          <a class="nav-link ${route.name === "runners" ? "on" : ""}" href="${RUNNERS_PATH}">${icon("server")}<span>Runners</span></a>
        </section>
        <section class="nav-sec nav-sec-footer">
          <button class="plain-btn icon-label" id="settings">${icon("gear")}<span>Settings</span></button>
          <button class="plain-btn icon-label" id="logout">${icon("signOut")}<span>Sign out</span></button>
        </section>
      </div>
    </aside>${desktopSidebarToggleHTML()}${workspaceListDialogHTML()}`;
}

function desktopSidebarToggleHTML() {
  const expanded = !state.sidebarCollapsed;
  return `<button class="icon-btn desktop-sidebar-toggle" id="desktop-sidebar-toggle" type="button" aria-label="${expanded ? "Hide" : "Show"} navigation" aria-controls="primary-navigation" aria-expanded="${expanded}">${icon("sidebar")}</button>`;
}

function inboxHTML() {
  const theme = currentTheme();
  const messages = state.inboxMessages;
  const body = state.inboxLoading
    ? `<div class="workspace-empty">Loading messages…</div>`
    : messages.length
    ? `<ol class="inbox-list">${messages.map(inboxMessageHTML).join("")}</ol>`
    : `<div class="inbox-empty">
        <span class="inbox-empty-mark">${icon("inboxTray")}</span>
        <h2>No messages yet</h2>
        <p>This is where your agents talk to you. As an agent works it posts updates here, like <em>“I have drafted the spec, can you take a look?”</em>, each one linked to the task it came from.</p>
        <p class="inbox-empty-hint">Only agents write to your inbox. Your own comments stay on the task.</p>
      </div>`;
  return `
    <section class="shell theme-${theme}">
      ${appSidebarHTML()}
      <div class="main workspace-main">
        <header class="workspace-topbar">
          <div><div class="workspace-title"><h1>Inbox</h1>${messages.length ? `<span>${messages.length}</span>` : ""}</div><p>Updates your agents have posted, newest first.</p></div>
        </header>
        ${statusErrorHTML(state.error)}
        <div class="workspace-content">${body}</div>
      </div>
    </section>`;
}

function inboxMessageHTML(message) {
  const agent = state.agents.find(item => item.id === message.authorId);
  return `<li class="inbox-message">
    <span class="inbox-message-avatar">${agent ? avatarHTML(agent, { small: true, decorative: true }) : icon("bot")}</span>
    <div class="inbox-message-body">
      <header><strong>${escapeHTML(message.authorName)}</strong>${message.kind === "output" ? `<span class="inbox-message-kind">Output</span>` : ""}<time>${new Date(message.createdAt).toLocaleString()}</time></header>
      <p>${escapeHTML(message.body).replace(/\n/g, "<br>")}</p>
      <a class="plain-btn inbox-message-task" href="${TASKS_PATH}?task=${encodeURIComponent(message.taskId)}" data-inbox-task="${escapeAttr(message.taskId)}">${icon("kanban")}<span>${escapeHTML(message.taskTitle)}</span></a>
    </div>
  </li>`;
}

// Runs and Runners exist so the shape of the product is visible before the
// execution layer lands. They stay empty until runs and runners are real rows.
function executionPlaceholderHTML(view) {
  const theme = currentTheme();
  const runs = view === "runs";
  return `
    <section class="shell theme-${theme}">
      ${appSidebarHTML()}
      <div class="main workspace-main">
        <header class="workspace-topbar">
          <div><div class="workspace-title"><h1>${runs ? "Runs" : "Runners"}</h1></div><p>${runs
            ? "Every attempt an agent makes at a task, with its event log and result."
            : "Machines running the Slate CLI that pick up work from this account."}</p></div>
        </header>
        <div class="workspace-content">
          <div class="workspace-empty">${runs
            ? "No runs yet. A run appears here once a runner executes a task."
            : "No runners yet. Install the Slate CLI on a machine and register it to run work here."}</div>
        </div>
      </div>
    </section>`;
}

function listsNavigationHTML() {
  const route = parseRoute(globalThis.location?.pathname || APP_PATH);
  const lists = state.workspaceLists.filter(list => !list.isInbox);
  return `
    <section class="nav-sec nav-lists nav-collaborators">
      <div class="nav-section-title"><h3>Lists</h3><button class="plain-btn" id="new-workspace-list" type="button" aria-label="New list">${icon("plus")}</button></div>
      <p class="status-error sidebar-list-error" role="alert" data-workspace-list-error ${state.workspaceListError ? "" : "hidden"}>${escapeHTML(state.workspaceListError)}</p>
      <div class="pages">${lists.length
        ? lists.map(list => `<a class="nav-link ${route.scope === "list" && route.listId === list.id ? "on" : ""}" href="${listPath(list.id)}">${icon("list")}<span>${escapeHTML(workspaceListLabel(list))}</span></a>`).join("")
        : `<p class="nav-empty">No lists yet.</p>`}</div>
    </section>`;
}

function boardsNavigationHTML() {
  const boardLimitReached = state.boards.length >= state.maxBoards;
  return `
    <section class="nav-sec nav-boards">
      <div class="nav-section-title"><h3>Boards</h3><button class="plain-btn" id="new-board" type="button" aria-label="New board" ${boardLimitReached || state.boardCreatePending ? "disabled" : ""}>${icon("plus")}</button></div>
      <p class="status-error sidebar-list-error" role="alert" data-workspace-list-error ${state.workspaceListError ? "" : "hidden"}>${escapeHTML(state.workspaceListError)}</p>
      <div class="pages">${state.boards.map(boardRowHTML).join("")}</div>
      ${boardLimitReached ? `<p class="board-limit">${state.maxBoards} board limit reached</p>` : ""}
    </section>`;
}

function syncWorkspaceListError() {
  document.querySelectorAll("[data-workspace-list-error]").forEach(element => {
    element.textContent = state.workspaceListError;
    element.hidden = !state.workspaceListError;
  });
}

async function refreshCurrentWorkspaceListMetadata() {
  const currentRoute = parseRoute(location.pathname);
  const settingsMounted = state.settings
    && state.settingsPage === currentRoute.settingsPage
    && Boolean(globalThis.document?.querySelector?.(".settings-page"));
  const workspaceMounted = state.view === "app" && Boolean(globalThis.document?.querySelector?.(".task-shell"));
  const agentsMounted = state.view === currentRoute.name && Boolean(globalThis.document?.querySelector?.(".agents-shell"));
  const agentSettingsMounted = state.view === "agent-settings"
    && state.agentDetailLoadState === "ready"
    && state.agentDetail?.agent?.id === currentRoute.agentId
    && Boolean(globalThis.document?.querySelector?.(".agents-shell"));
  const routeNeedsCompletion = (currentRoute.name === "settings" && !settingsMounted)
    || (currentRoute.name === "workspace" && !workspaceMounted)
    || (["agents", "agent-new"].includes(currentRoute.name) && !agentsMounted)
    || (currentRoute.name === "agent-settings" && !agentSettingsMounted);
  if (routeNeedsCompletion) {
    await applyRoute();
    const completedRoute = parseRoute(location.pathname);
    if (completedRoute.name === "settings") {
      return state.settings
        && state.settingsPage === completedRoute.settingsPage
        && Boolean(globalThis.document?.querySelector?.(".settings-page"));
    }
    if (completedRoute.name === "workspace") return state.view === "app" && Boolean(globalThis.document?.querySelector?.(".task-shell"));
    if (["agents", "agent-new"].includes(completedRoute.name)) {
      return state.view === completedRoute.name && Boolean(globalThis.document?.querySelector?.(".agents-shell"));
    }
    if (completedRoute.name === "agent-settings") {
      return state.view === "agent-settings"
        && state.agentDetailLoadState === "ready"
        && state.agentDetail?.agent?.id === completedRoute.agentId
        && Boolean(globalThis.document?.querySelector?.(".agents-shell"));
    }
    return false;
  }
  const version = routeVersion;
  try {
    if (!await loadWorkspaceListIndex(version) || version !== routeVersion) return false;
    state.workspaceListError = "";
    syncWorkspaceListError();
    return true;
  } catch (err) {
    if (version !== routeVersion) return false;
    state.workspaceListError = err.message;
    syncWorkspaceListError();
    return false;
  }
}

function syncAgentTaskMutationError() {
  document.querySelectorAll("[data-agent-task-mutation-error]").forEach(element => {
    element.textContent = state.agentTaskMutationError;
    element.hidden = !state.agentTaskMutationError;
  });
}

function syncTaskDetailError() {
  const element = document.querySelector(".detail-error");
  if (element) element.textContent = state.error;
}

function clearResolvedAgentTaskRefreshError() {
  const message = state.agentTaskRefreshError;
  state.agentTaskRefreshError = "";
  if (!message) return;
  if (state.agentTaskMutationError === message) {
    state.agentTaskMutationError = "";
    syncAgentTaskMutationError();
  }
  if (state.error === message) {
    state.error = "";
    syncTaskDetailError();
  }
}

function globalNewTaskButtonHTML() {
  return `<button class="primary sidebar-new-task" id="global-new-task" type="button" ${newTaskCaptureBlocked() ? "disabled" : ""}>${icon("plus")}<span>${state.newTaskCapturePending ? "Creating…" : "New task"}</span></button>`;
}

function newTaskCaptureBlocked() {
  return state.newTaskCapturePending || Boolean(state.newTaskRecovery);
}

function newTaskRecoveryNoticeHTML() {
  const recovery = state.newTaskRecovery;
  if (!recovery) return "";
  return `<section class="status-notice new-task-recovery" role="alert" aria-label="Created task recovery"><span><strong>Card created.</strong> Slate saved ${escapeHTML(recovery.task.title)} in Inbox, but could not open it: ${escapeHTML(recovery.message)}</span><button id="retry-created-task" type="button" ${recovery.pending ? "disabled" : ""}>${recovery.pending ? "Opening…" : "Open task"}</button></section>`;
}

function bindNewTaskRecoveryActions() {
  document.querySelector("#retry-created-task")?.addEventListener("click", recoverCreatedTask);
}

function boardRowHTML(board) {
  const route = parseRoute(globalThis.location?.pathname || APP_PATH);
  const current = route.name === "board" && board.id === state.board?.id;
  const deletable = boardCanBeDeleted(board.id);
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
      <span class="board-select" data-board="${board.id}">${escapeHTML(board.name)}</span>
      <div class="board-actions">
        <button data-start-rename-board="${board.id}" aria-label="Rename ${escapeAttr(board.name)}" title="Rename board">${icon("pencil")}</button>
        <button data-delete-board="${board.id}" aria-label="Delete ${escapeAttr(board.name)}" title="${deletable ? "Delete board" : "Move or create another Inbox before deleting this board"}" ${deletable ? "" : "disabled"}>${icon("trash")}</button>
      </div>
    </div>`;
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
  const accessibility = options.decorative ? 'aria-hidden="true"' : `title="${escapeAttr(name)}" aria-label="${escapeAttr(name)}"`;
  return `<span class="avatar agent-avatar tone-${avatarTone(identity.id)} ${options.small ? "avatar-small" : ""} ${options.large ? "avatar-large" : ""}" ${accessibility}>${icon("bot")}</span>`;
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
  return `<span class="task-assignee">${avatarHTML(agent, { small: true })}${showName ? `<span>${escapeHTML(agent.displayName)}</span>` : ""}</span>`;
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

function calendarTaskHTML(item) {
  const { task, list } = item;
  return `
    <li class="task calendar-task action status-${task.status || "new"}" draggable="true" data-task="${task.id}">
      <button class="task-body task-open" type="button" data-open-task="${task.id}" aria-label="${escapeAttr(task.title)}">
        <div class="task-title">${escapeHTML(task.title)}</div>
        <span class="task-list-name">${escapeHTML(list.name)}</span>
      </button>
      ${taskAssigneeHTML(task)}
    </li>`;
}

function agentOptionsHTML(selectedID = "") {
  const selectedExists = state.agents.some(agent => agent.id === selectedID);
  return [
    `<option value="" ${selectedID ? "" : "selected"}>No agent</option>`,
    ...state.agents.map(agent => `<option value="${escapeAttr(agent.id)}" ${agent.id === selectedID ? "selected" : ""}>${escapeHTML(agent.displayName)}</option>`),
    selectedID && !selectedExists ? `<option value="${escapeAttr(selectedID)}" selected disabled>Assigned agent unavailable</option>` : "",
  ].join("");
}

function statusOptionsHTML(selected) {
  return FLOW_STATES.map(item => `<option value="${item.value}" ${item.value === selected ? "selected" : ""}>${item.label}</option>`).join("");
}

function statusLabel(status) {
  return FLOW_STATES.find(item => item.value === status)?.label || "New";
}

function statusErrorHTML(error) {
  return error ? `<p class="status-error" role="alert">${escapeHTML(error)}</p>` : "";
}

function agentsHTML() {
  const theme = currentTheme();
  const onNew = state.view === "agent-new";
  const limitReached = state.activeAgents >= state.maxAgents;
  return `
    <section class="shell agents-shell theme-${theme}">
      ${appSidebarHTML({ agentsCurrent: true })}
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
            ${!onNew && state.agents.length ? `<a class="primary agents-new-action ${limitReached ? "disabled" : ""}" href="${NEW_AGENT_PATH}" id="new-agent-link" ${limitReached ? 'aria-disabled="true" aria-describedby="agents-limit"' : ""}>${icon("plus")}<span>New agent</span></a>` : ""}
          </header>
          <p class="status-error agents-context-error" role="alert" ${state.error ? "" : "hidden"}>${escapeHTML(state.error)}</p>
          ${state.agentLifecycleNotice && !onNew ? `<p class="agent-detail-notice" role="status">${escapeHTML(state.agentLifecycleNotice)}</p>` : ""}
          ${state.agentsLoadState === "loading" ? agentsLoadingHTML() : ""}
          ${state.agentsLoadState === "error" ? agentsErrorHTML() : ""}
          ${state.agentsLoadState === "ready" && onNew ? newAgentHTML(limitReached) : ""}
          ${state.agentsLoadState === "ready" && !onNew ? agentDirectoryHTML(state.agents, limitReached) : ""}
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

function agentDirectoryHTML(agents, limitReached) {
  return `
    <section aria-labelledby="active-agents-heading">
      <div class="agent-directory-meta">
        <div>
          <h2 id="active-agents-heading">Your agents <span>${agents.length}</span></h2>
          <p id="agents-limit">${limitReached
            ? `${state.maxAgents} of ${state.maxAgents} agents. Delete an agent before creating another.`
            : `${state.activeAgents} of ${state.maxAgents} agent slots used.`}</p>
        </div>
      </div>
      ${agents.length ? `<div class="agent-directory">${agents.map(agentRowHTML).join("")}</div>` : `
        <section class="agents-empty">
          <span class="agent-state-icon">${icon("bot")}</span>
          <h2>Bring an agent into the plan.</h2>
          <p>An agent is an external collaborator with its own identity and credential. Assign it work when you are ready.</p>
          <a class="primary" href="${NEW_AGENT_PATH}" id="empty-new-agent">${icon("plus")}<span>New agent</span></a>
        </section>`}
    </section>`;
}

function agentRowHTML(agent) {
  const stateLabel = agentConnectionState(agent);
  const counts = agent.workCounts || {};
  const assigned = Number(counts.ready || 0) + Number(counts.working || 0) + Number(counts.review || 0);
  const countParts = [
    counts.ready ? formatCount(counts.ready, "open task", "open tasks") : "",
    counts.working ? formatCount(counts.working, "working task", "working tasks") : "",
    counts.review ? formatCount(counts.review, "review task", "review tasks") : "",
  ].filter(Boolean);
  return `
    <article class="agent-directory-row">
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
      ${appSidebarHTML({ agentsCurrent: true })}
      <main class="${state.selectedTask ? "main workspace-main card-detail-main agent-task-main" : "agents-main"}">
        ${state.selectedTask ? workspaceDetailHTML(state.selectedTask) : `<div class="agents-wrap agent-detail-wrap">
          <a class="back-link" href="${AGENTS_PATH}" id="agent-detail-back">${icon("chevronLeft")}<span>Agents</span></a>
          ${agentDetailBodyHTML()}
        </div>`}
      </main>
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
          ${agent.purpose ? `<p>${escapeHTML(agent.purpose)}</p>` : ""}
        </div>
      </div>
      ${current === "settings" ? "" : `<button class="primary icon-label" id="assign-work" type="button">${icon("plus")}<span>Assign work</span></button>`}
    </header>
    <nav class="agent-tabs" aria-label="Agent sections" role="tablist">
      <a id="agent-tab-overview" href="${agentPath(agent.id)}" role="tab" tabindex="${current === "overview" ? "0" : "-1"}" aria-selected="${current === "overview"}" aria-controls="agent-panel-overview" ${current === "overview" ? 'aria-current="page"' : ""} data-agent-tab>Overview</a>
      <a id="agent-tab-work" href="${agentWorkPath(agent.id)}" role="tab" tabindex="${current === "work" ? "0" : "-1"}" aria-selected="${current === "work"}" aria-controls="agent-panel-work" ${current === "work" ? 'aria-current="page"' : ""} data-agent-tab>Work</a>
      <a id="agent-tab-settings" href="${agentSettingsPath(agent.id)}" role="tab" tabindex="${current === "settings" ? "0" : "-1"}" aria-selected="${current === "settings"}" aria-controls="agent-panel-settings" ${current === "settings" ? 'aria-current="page"' : ""} data-agent-tab>Settings</a>
    </nav>
    ${state.agentAssignNotice ? `<p class="agent-detail-notice" role="status">${escapeHTML(state.agentAssignNotice)}</p>` : ""}
    <p class="status-error" role="alert" data-agent-task-mutation-error ${state.agentTaskMutationError ? "" : "hidden"}>${escapeHTML(state.agentTaskMutationError)}</p>
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
      <p>${connected ? "Only this agent’s assigned work is available through its active credential." : "Create a new credential to connect this identity again."}</p>
      <div class="agent-settings-actions">
        <button class="secondary icon-label" id="rotate-agent-credential" type="button" ${state.agentLifecyclePending ? "disabled" : ""}>${icon("key")}<span>${connected ? "Rotate credential" : "Create credential"}</span></button>
        ${connected ? `<button class="secondary danger-text" id="revoke-agent-credential" type="button" ${state.agentLifecyclePending ? "disabled" : ""}>Revoke credential</button>` : ""}
      </div>
    </section>
    <section class="agent-settings-card agent-danger-zone" aria-labelledby="agent-delete-heading">
      <header><div><p class="eyebrow">Danger zone</p><h2 id="agent-delete-heading">Delete agent</h2></div>${icon("trash")}</header>
      <p>Delete this identity and every credential. Assigned cards remain in Slate and become unassigned. Comments and outputs keep their recorded author name. This cannot be undone.</p>
      <div class="agent-settings-actions"><button class="danger" id="delete-agent" type="button" ${state.agentLifecyclePending ? "disabled" : ""}>Delete agent</button></div>
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
    delete: {
      title: `Delete ${agent.displayName}?`,
      body: "The identity and every credential will be deleted. Assigned tasks remain and become unassigned. Comments and outputs keep their recorded author name. This cannot be undone.",
      confirm: "Delete agent",
    },
  }[action];
  return `
    <div class="detail-overlay agent-lifecycle-overlay">
      <section class="agent-lifecycle-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-lifecycle-confirm-heading" ${pending ? 'aria-busy="true"' : ""}>
        <header><span class="agent-state-icon">${icon(action === "delete" ? "trash" : "key")}</span><div><h2 id="agent-lifecycle-confirm-heading">${escapeHTML(config.title)}</h2><p>${escapeHTML(config.body)}</p></div></header>
        ${pending ? '<p class="agent-lifecycle-pending" id="agent-lifecycle-pending" role="status" tabindex="-1">Working… Keep this page open.</p>' : ""}
        ${state.agentLifecycleError ? `<p class="status-error" role="alert">${escapeHTML(state.agentLifecycleError)}</p>` : ""}
        <footer><button class="secondary" id="cancel-agent-lifecycle" type="button" ${pending ? "disabled" : ""}>Cancel</button><button class="${action === "rotate" ? "primary" : "danger"}" id="confirm-agent-lifecycle" type="button" ${pending ? "disabled" : ""}>${pending ? "Working…" : escapeHTML(config.confirm)}</button></footer>
      </section>
    </div>`;
}

function agentOverviewHTML(agent) {
  const work = state.agentDetail.work;
  const ready = work.ready || [];
  const working = work.working || [];
  const review = work.review || [];
  const recentlyCompleted = work.recentlyCompleted || [];
  const counts = {
    ready: Math.max(Number(work.totals?.ready || 0), ready.length),
    working: Math.max(Number(work.totals?.working || 0), working.length),
    review: Math.max(Number(work.totals?.review || 0), review.length),
    completed: Math.max(Number(work.totals?.completed || 0), recentlyCompleted.length),
  };
  const total = counts.ready + counts.working + counts.review + counts.completed;
  if (!total) {
    return `
      <section class="agent-overview-empty" aria-labelledby="agent-empty-heading">
        <span class="agent-empty-icon" aria-hidden="true">${icon("rows")}</span>
        <div>
          <h2 id="agent-empty-heading">No work assigned</h2>
          <p>Assign a card when you’re ready to put ${escapeHTML(agent.displayName)} to work.</p>
        </div>
      </section>`;
  }
  return `
    ${counts.working ? `<section class="agent-current" aria-labelledby="agent-current-heading">
      <div class="agent-section-heading">
        <div>
          <p class="eyebrow">Current focus</p>
          <h2 id="agent-current-heading">Working now</h2>
        </div>
        <span>${counts.working}</span>
      </div>
      ${working.length ? `<div class="agent-current-list">${working.map(item => agentWorkItemHTML(item)).join("")}</div>` : `<p class="agent-work-truncated">Open the full work view to see active tasks.</p>`}
    </section>` : ""}
    <div class="agent-work-groups">
      ${counts.ready ? agentWorkSectionHTML("Ready", "Assigned and ready to pick up.", ready, counts.ready, "queued") : ""}
      ${counts.review ? agentWorkSectionHTML("Review", "Waiting for your review.", review, counts.review, "needs_review") : ""}
      ${counts.completed ? agentWorkSectionHTML("Recently completed", "Latest completed tasks.", recentlyCompleted, counts.completed, "done") : ""}
    </div>
    <div class="agent-view-all">
      <a class="secondary icon-label" href="${agentWorkPath(agent.id)}" data-agent-tab>${icon("rows")}<span>View all work</span></a>
    </div>
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
    <button class="agent-work-item" type="button" data-task="${escapeAttr(item.id)}" data-open-task="${escapeAttr(item.id)}" data-open-agent-task="${escapeAttr(item.id)}" data-agent-task-board="${escapeAttr(item.boardId)}">
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
    ["New", "new"],
    ["Ready", "queued"],
    ["In Progress", "working"],
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
        const items = page.items.filter(item => item.status === status);
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
  const lists = assignmentListsForBoard(selectedBoardID);
  const availableLists = lists;
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
              <div class="field"><label for="assign-list">List</label><select id="assign-list" name="bucketId" ${availableLists.length ? "" : "disabled"}>${lists.map(list => `<option value="${escapeAttr(list.id)}" ${list.id === draft.bucketId ? "selected" : ""}>${escapeHTML(list.name)}</option>`).join("") || '<option value="">No available lists</option>'}</select></div>
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

function assignmentListsForBoard(boardID) {
  if (!boardID) return [];
  return state.workspaceLists.filter(list => list.boardId === boardID);
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
        <div class="settings-row">
          <div class="settings-row-copy">
            <strong>Password</strong>
            <span>Send a secure reset link to your account email.</span>
          </div>
          <div class="settings-row-actions">
            <button class="secondary" id="request-password-reset" type="button" ${state.settingsPending ? 'aria-disabled="true"' : ""}>${state.settingsPending === "password-reset" ? "Sending…" : "Send reset link"}</button>
          </div>
        </div>
        <div class="settings-card-actions">
          ${settingsStatusHTML()}
          <button class="primary settings-submit" type="submit" ${state.settingsPending ? "disabled" : ""}>${state.settingsPending === "profile" ? "Saving…" : "Save profile"}</button>
        </div>
      </form>`;
  } else if (page.id === "preferences") {
    content = `
      <section class="settings-card" aria-labelledby="appearance-heading">
        <div class="settings-row">
          <div class="settings-row-copy">
            <strong id="appearance-heading">Appearance</strong>
            <span>Slate follows this choice on every screen.</span>
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
      <aside class="sidebar settings-sidebar ${state.sidebarCollapsed ? "collapsed" : ""}" id="primary-navigation" aria-label="Primary navigation">
        <button class="brand brand-button" type="button" data-home>slate<span>.do</span></button>
        ${globalNewTaskButtonHTML()}
        ${newTaskRecoveryNoticeHTML()}
        <section class="nav-sec nav-collaborators settings-workspace-nav" aria-label="Work">
          <a class="nav-link" href="${INBOX_PATH}">${icon("inboxTray")}<span>Inbox</span></a>
          <a class="nav-link" href="${TASKS_PATH}">${icon("kanban")}<span>Board</span></a>
          <a class="nav-link" href="${AGENTS_PATH}">${icon("bot")}<span>Agents</span></a>
          <a class="nav-link" href="${RUNS_PATH}">${icon("history")}<span>Runs</span></a>
          <a class="nav-link" href="${RUNNERS_PATH}">${icon("server")}<span>Runners</span></a>
        </section>
        ${listsNavigationHTML()}
        ${boardsNavigationHTML()}
        <p class="settings-sidebar-title">Account settings</p>
        <nav class="settings-nav" aria-label="Settings">
          ${SETTINGS_PAGES.map(item => `<a class="page-row icon-label settings-nav-link ${item.id === page.id ? "on" : ""}" href="${settingsPath(item.id)}" ${item.id === page.id ? 'aria-current="page"' : ""}>${icon(item.icon)}<span>${item.label}</span></a>`).join("")}
        </nav>
        <section class="settings-actions" aria-label="Account actions">
          <button class="plain-btn icon-label" id="back">${icon("chevronLeft")}<span>Back to board</span></button>
          <button class="plain-btn icon-label" id="settings-logout">${icon("signOut")}<span>Sign out</span></button>
        </section>
      </aside>
      ${desktopSidebarToggleHTML()}
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
      ${workspaceListDialogHTML()}
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

function bindWorkspace() {
  document.onkeydown = null;
  document.querySelectorAll("[data-open-task]").forEach(element => {
    element.onclick = () => openTaskDetail(element.dataset.openTask, element);
    if (!["BUTTON", "A"].includes(element.tagName)) element.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      element.click();
    });
  });
  document.querySelectorAll("[data-task-row]").forEach(row => row.addEventListener("click", event => {
    if (event.target.closest("button, a")) return;
    row.querySelector("[data-open-task]")?.click();
  }));
  document.querySelector("#workspace-filter-toggle")?.addEventListener("click", () => {
    state.workspaceFiltersOpen = !state.workspaceFiltersOpen;
    render();
  });
  document.querySelector("#workspace-filters")?.addEventListener("submit", event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const query = new URLSearchParams();
    for (const name of ["q", "status", "priority", "assigneeAgentId", "children", "plannedFrom", "plannedTo"]) {
      const value = String(data.get(name) || "").trim();
      if (value) query.set(name, value);
    }
    navigate(`${location.pathname}${query.size ? `?${query}` : ""}`);
  });
  document.querySelector("#clear-workspace-filters")?.addEventListener("click", () => {
    navigate(location.pathname);
  });
  document.querySelector("#workspace-load-more")?.addEventListener("click", loadMoreWorkspaceTasks);
  document.querySelectorAll("[data-bucket-name]").forEach(element => {
    element.addEventListener("change", () => renameWorkspaceList(element));
    element.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); element.blur(); }
    });
  });
  bindDrag();
  bindWorkspaceDetail();
}

function cardContextMenuHTML(task) {
  return `<div class="card-context-menu" role="menu" aria-label="Actions for ${escapeAttr(task.title)}">
    <button type="button" role="menuitem" data-context-delete>${icon("trash")}<span>Delete task</span></button>
  </div>`;
}

function cardContextMenuPosition(x, y, width, height, viewportWidth, viewportHeight) {
  const margin = 8;
  const offset = 4;
  return {
    left: Math.max(margin, Math.min(x + offset, viewportWidth - width - margin)),
    top: Math.max(margin, Math.min(y + offset, viewportHeight - height - margin)),
  };
}

function closeCardContextMenu({ restoreFocus = false } = {}) {
  if (!cardContextMenu) return;
  const { menu, card, trigger, onPointerDown, onKeyDown } = cardContextMenu;
  cardContextMenu = null;
  globalThis.document?.removeEventListener?.("pointerdown", onPointerDown, true);
  globalThis.document?.removeEventListener?.("keydown", onKeyDown, true);
  card?.classList?.remove("context-open");
  menu?.remove?.();
  if (restoreFocus) trigger?.focus?.();
}

function bindCardContextMenus() {
  document.querySelectorAll("[data-task]").forEach(card => card.addEventListener("contextmenu", event => {
    const task = findTask(card.dataset.task);
    if (!task) return;
    event.preventDefault();
    closeCardContextMenu();

    const trigger = card.matches("button, a") ? card : card.querySelector("[data-open-task], button, a") || card;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = cardContextMenuHTML(task);
    const menu = wrapper.firstElementChild;
    const menuHost = document.querySelector("#app > .theme-dark, #app > .theme-light") || document.body;
    menuHost.append(menu);

    let x = event.clientX;
    let y = event.clientY;
    if (!x && !y) {
      const bounds = trigger.getBoundingClientRect();
      x = bounds.left;
      y = bounds.bottom;
    }
    const position = cardContextMenuPosition(x, y, menu.offsetWidth, menu.offsetHeight, window.innerWidth, window.innerHeight);
    menu.style.left = `${position.left}px`;
    menu.style.top = `${position.top}px`;
    card.classList.add("context-open");

    const onPointerDown = pointerEvent => {
      if (!menu.contains(pointerEvent.target)) closeCardContextMenu();
    };
    const onKeyDown = keyEvent => {
      if (keyEvent.key === "Escape") {
        keyEvent.preventDefault();
        closeCardContextMenu({ restoreFocus: true });
      } else if (keyEvent.key === "Tab") {
        closeCardContextMenu();
      }
    };
    cardContextMenu = { menu, card, trigger, onPointerDown, onKeyDown };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    menu.querySelector("[data-context-delete]").addEventListener("click", async () => {
      closeCardContextMenu({ restoreFocus: true });
      await deleteCardFromContext(task.id);
    });
    menu.querySelector("[role=menuitem]").focus();
  }));
}

function loadedTaskFamily(taskID) {
  const candidates = [
    ...state.workspaceTasks,
    ...state.selectedSubtasks,
    ...(state.selectedTask ? [state.selectedTask] : []),
    ...(state.board?.buckets || []).flatMap(list => list.tasks || []),
    ...(state.agentWorkPage?.items || []),
    ...["ready", "working", "review", "recentlyCompleted"].flatMap(group => state.agentDetail?.work?.[group] || []),
  ];
  const byID = new Map(candidates.filter(task => task?.id).map(task => [task.id, task]));
  const familyIDs = new Set([taskID]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of byID.values()) {
      if (!familyIDs.has(task.id) && familyIDs.has(task.parentTaskId)) {
        familyIDs.add(task.id);
        changed = true;
      }
    }
  }
  return [...familyIDs].map(id => byID.get(id)).filter(Boolean);
}

function removeLoadedTaskFamily(taskID, tasks) {
  const deletedIDs = new Set([taskID, ...tasks.map(task => task.id)]);
  const keep = task => !deletedIDs.has(task.id);
  const openCountChanges = new Map();
  for (const task of tasks) {
    if (task.status === "done") continue;
    openCountChanges.set(task.bucketId, Number(openCountChanges.get(task.bucketId) || 0) + 1);
  }
  const reconciledLists = new Set();
  for (const list of [...state.workspaceLists, ...(state.board?.buckets || [])]) {
    if (reconciledLists.has(list)) continue;
    reconciledLists.add(list);
    const change = openCountChanges.get(list.id);
    if (change) list.openCount = Math.max(0, Number(list.openCount || 0) - change);
  }
  state.workspaceTasks = state.workspaceTasks.filter(keep);
  state.selectedSubtasks = state.selectedSubtasks.filter(keep);
  for (const list of state.board?.buckets || []) list.tasks = (list.tasks || []).filter(keep);
  for (const task of tasks) {
    reconcileAgentTaskCaches(task, { deleted: true });
    delete state.taskDetailDrafts[task.id];
  }
  if (!state.selectedTask || !deletedIDs.has(state.selectedTask.id)) return;
  taskDetailVersion += 1;
  state.selectedTask = null;
  state.selectedSubtasks = [];
  state.selectedEntries = [];
  state.cardEntryDraft = "";
  state.cardEntryKind = "comment";
  state.cardEntryPending = false;
  state.cardEntryError = "";
  state.subtaskDraft = "";
  state.subtaskCreateAttempt = null;
  state.subtaskPending = false;
  state.subtaskError = "";
}

function contextDeleteSurfaceMatchesRoute(route) {
  if (route.name === "workspace") {
    return state.view === "app" && state.workspaceScope === route.scope
      && (route.scope !== "list" || state.workspaceListID === route.listId);
  }
  if (["agent-detail", "agent-work"].includes(route.name)) {
    return state.view === route.name && state.agentDetailLoadState === "ready" && state.agentDetail?.agent?.id === route.agentId;
  }
  return false;
}

async function refreshAfterContextDelete() {
  const route = parseRoute(location.pathname);
  if (!contextDeleteSurfaceMatchesRoute(route)) {
    if (["settings", "agent-new", "agent-settings"].includes(route.name)) {
      return refreshCurrentWorkspaceListMetadata();
    }
    await applyRoute();
    return true;
  }

  const refreshRouteVersion = routeVersion;
  try {
    if (route.name === "workspace") {
      const loaded = await reload();
      return Boolean(loaded) && refreshRouteVersion === routeVersion;
    }
    const [detailResult, listsResult] = await Promise.allSettled([
      loadAgentDetail(route.agentId, {
        includeWorkPage: route.name === "agent-work",
        page: route.name === "agent-work" ? workPageFromLocation() : 1,
        sessionVersion: authVersion,
        userID: state.me?.id,
        expectedRouteVersion: refreshRouteVersion,
      }),
      loadWorkspaceListIndex(refreshRouteVersion),
    ]);
    if (refreshRouteVersion !== routeVersion) return false;
    const unauthorized = [detailResult, listsResult]
      .find(result => result.status === "rejected" && result.reason?.status === 401);
    if (unauthorized) throw unauthorized.reason;
    if (detailResult.status === "rejected") throw detailResult.reason;
    if (listsResult.status === "rejected") throw listsResult.reason;
    const detailLoaded = detailResult.value;
    const listsLoaded = listsResult.value;
    if (!detailLoaded || !listsLoaded || refreshRouteVersion !== routeVersion) return false;
    state.agentDetailLoadState = "ready";
    state.workspaceListError = "";
    renderPreservingCurrentTaskDetail();
    return true;
  } catch (err) {
    if (refreshRouteVersion !== routeVersion) return false;
    if (handleAgentUnauthorized(err, route)) return false;
    state.workspaceLoading = false;
    const message = `The card was deleted, but this view couldn’t be refreshed: ${err.message}`;
    state.error = message;
    if (["agent-detail", "agent-work"].includes(route.name)) {
      state.agentTaskRefreshError = message;
      state.agentTaskMutationError = message;
    }
    renderPreservingCurrentTaskDetail();
    return false;
  }
}

async function deleteCardFromContext(taskID) {
  const task = findTask(taskID);
  if (!task || !confirm(`Delete “${task.title}” and its subtasks?`)) return false;
  const deleteErrorPrefix = `Couldn’t delete “${task.title}”:`;
  const sessionVersion = authVersion;
  const userID = state.me?.id;
  const family = loadedTaskFamily(taskID);
  try {
    const deleted = await serializeTaskMutation(taskID, () => api.del(`/api/v1/tasks/${encodeURIComponent(taskID)}`));
    if (!deleted || !sessionIsCurrent(sessionVersion, userID)) return false;
  } catch (err) {
    if (!sessionIsCurrent(sessionVersion, userID)) return false;
    if (handleAgentUnauthorized(err)) return false;
    const message = `Couldn’t delete “${task.title}”: ${err.message}`;
    const route = parseRoute(location.pathname);
    if (["agent-detail", "agent-work", "agent-settings"].includes(route.name)) {
      state.agentTaskMutationError = message;
      if (state.selectedTask) state.error = message;
    } else state.error = message;
    if (state.selectedTask) {
      renderPreservingCurrentTaskDetail();
      return false;
    }
    if (["settings", "agent-new", "agent-settings"].includes(route.name)) {
      if (route.name === "agent-settings") syncAgentTaskMutationError();
      if (route.name === "agent-new") {
        const error = document.querySelector(".agents-context-error");
        if (error) {
          error.textContent = message;
          error.hidden = false;
        }
      }
      if (route.name === "settings") {
        const status = document.querySelector(".settings-status");
        if (status) {
          status.textContent = message;
          status.classList.add("error");
          status.setAttribute("role", "alert");
        }
      }
      return false;
    }
    render();
    document.querySelector(`[data-task="${CSS.escape(taskID)}"] [data-open-task], [data-task="${CSS.escape(taskID)}"]`)?.focus();
    return false;
  }

  const deletedTasks = new Map([...family, ...loadedTaskFamily(taskID)].map(item => [item.id, item]));
  removeLoadedTaskFamily(taskID, [...deletedTasks.values()]);
  if (state.error.startsWith(deleteErrorPrefix)) state.error = "";
  if (state.agentTaskMutationError.startsWith(deleteErrorPrefix)) state.agentTaskMutationError = "";
  await refreshAfterContextDelete();
  return true;
}

function agentWorkGroupForTask(task) {
  if (task.status === "done") return "recentlyCompleted";
  if (task.status === "working") return "working";
  if (task.status === "needs_review") return "review";
  if (task.status === "queued") return "ready";
  return "";
}

function taskWithResolvedLocation(task) {
  const list = state.workspaceLists.find(item => item.id === task.bucketId);
  if (!list) return task;
  const boardID = list.boardId || task.boardId;
  const board = state.boards.find(item => item.id === boardID);
  return {
    ...task,
    boardId: boardID,
    boardName: board?.name || task.boardName,
    bucketName: list.name,
  };
}

function reconcileAgentTaskCaches(task, { deleted = false, previousTask = null } = {}) {
  task = taskWithResolvedLocation(task);
  previousTask = previousTask ? taskWithResolvedLocation(previousTask) : null;
  const workPage = state.agentWorkPage;
  const agentID = state.agentDetail?.agent?.id;
  const pageIndex = workPage?.items?.findIndex(item => item.id === task.id) ?? -1;
  const isAssigned = task.assigneeAgentId === agentID;
  const wasAssigned = previousTask ? previousTask.assigneeAgentId === agentID : isAssigned;
  let changed = false;
  const decrementPageTotal = () => {
    workPage.total = Math.max(0, Number(workPage.total || 0) - 1);
    workPage.hasNext = Number(workPage.page || 1) * Number(workPage.pageSize || 50) < workPage.total;
  };
  if (pageIndex >= 0) {
    changed = true;
    const remainsAssigned = !deleted && isAssigned;
    workPage.items = remainsAssigned
      ? workPage.items.map(item => item.id === task.id ? { ...item, ...task } : item)
      : workPage.items.filter(item => item.id !== task.id);
    if (!remainsAssigned && !deleted) decrementPageTotal();
  }
  if (workPage && deleted && (wasAssigned || pageIndex >= 0)) {
    changed = true;
    decrementPageTotal();
  }
  if (workPage && pageIndex < 0 && previousTask && !deleted && wasAssigned !== isAssigned) {
    changed = true;
    workPage.total = Math.max(0, Number(workPage.total || 0) + (isAssigned ? 1 : -1));
    workPage.hasNext = Number(workPage.page || 1) * Number(workPage.pageSize || 50) < workPage.total;
  }

  const groups = ["ready", "working", "review", "recentlyCompleted"];
  const work = state.agentDetail?.work;
  const parentMoved = !task.parentTaskId && previousTask && previousTask.bucketId !== task.bucketId;
  const childLocation = parentMoved ? {
    boardId: task.boardId,
    boardName: task.boardName,
    bucketId: task.bucketId,
    bucketName: task.bucketName,
    listName: task.bucketName,
  } : null;
  const moveChildren = items => (items || []).map(item => {
    if (!childLocation || item.parentTaskId !== task.id) return item;
    changed = true;
    return { ...item, ...childLocation };
  });
  if (workPage) workPage.items = moveChildren(workPage.items);
  if (!work) return changed;
  const previousGroup = groups.find(group => (work[group] || []).some(item => item.id === task.id));
  const previousItem = previousGroup ? work[previousGroup].find(item => item.id === task.id) : null;
  changed ||= Boolean(previousGroup);
  work.totals ||= {};
  for (const group of groups) work[group] = (work[group] || []).filter(item => item.id !== task.id);
  const totalKey = group => group === "recentlyCompleted" ? "completed" : group;
  if (deleted) {
    const countedGroup = previousGroup || (wasAssigned ? agentWorkGroupForTask(task) : "");
    if (countedGroup) {
      changed = true;
      const key = totalKey(countedGroup);
      work.totals[key] = Math.max(0, Number(work.totals[key] || 0) - 1);
    }
    return changed;
  }

  const previousCountedGroup = previousGroup || (previousTask && wasAssigned ? agentWorkGroupForTask(previousTask) : "");
  const nextGroup = isAssigned ? agentWorkGroupForTask(task) : "";
  if (previousGroup && nextGroup) work[nextGroup] = [{ ...previousItem, ...task }, ...work[nextGroup]];
  if (previousCountedGroup && previousCountedGroup !== nextGroup) {
    changed = true;
    const key = totalKey(previousCountedGroup);
    work.totals[key] = Math.max(0, Number(work.totals[key] || 0) - 1);
  }
  if (nextGroup && previousCountedGroup !== nextGroup) {
    changed = true;
    const key = totalKey(nextGroup);
    work.totals[key] = Number(work.totals[key] || 0) + 1;
  }

  for (const group of groups) work[group] = moveChildren(work[group]);
  return changed;
}

function taskDraftFromCurrentForm(task) {
  const form = globalThis.document?.querySelector?.("#workspace-detail-form");
  if (!form) return null;
  const value = name => String((form.querySelector?.(`[name="${name}"]`) || form.elements?.namedItem?.(name))?.value || "");
  return {
    title: value("title"),
    description: value("description"),
    status: value("status") || task.status || "new",
    bucketId: task.parentTaskId ? task.bucketId : value("bucketId"),
    priority: value("priority"),
    assigneeAgentId: value("assigneeAgentId"),
    scheduledDate: value("scheduledDate"),
  };
}

function preserveCurrentTaskDraft() {
  if (!state.selectedTask) return false;
  const formDraft = taskDraftFromCurrentForm(state.selectedTask);
  const draft = {
    ...(state.taskDetailDrafts[state.selectedTask.id] || {}),
    ...(formDraft || {}),
    cardEntryDraft: state.cardEntryDraft,
    cardEntryKind: state.cardEntryKind,
    cardEntryPending: state.cardEntryPending,
    cardEntryError: state.cardEntryError,
    cardEntryAttemptKey: state.cardEntryAttemptKey,
    subtaskDraft: state.subtaskDraft,
    subtaskCreateAttempt: state.subtaskCreateAttempt,
    subtaskPending: state.subtaskPending,
    subtaskError: state.subtaskError,
  };
  state.taskDetailDrafts[state.selectedTask.id] = draft;
  if (formDraft) state.selectedTask = { ...state.selectedTask, ...formDraft };
  return true;
}

function reconcileCachedCardEntryAttempt(taskID, attemptKey, updates) {
  const draft = state.taskDetailDrafts[taskID];
  if (!draft || draft.cardEntryAttemptKey !== attemptKey) return false;
  Object.assign(draft, updates);
  return true;
}

function reconcileCachedSubtaskAttempt(taskID, attemptKey, updates) {
  const draft = state.taskDetailDrafts[taskID];
  if (!draft || draft.subtaskCreateAttempt?.key !== attemptKey) return false;
  Object.assign(draft, updates);
  return true;
}

function captureTaskDetailFocus() {
  const documentRef = globalThis.document;
  if (!documentRef) return null;
  const active = documentRef.activeElement;
  if (!active || !documentRef.querySelector("[data-detail-surface]")?.contains(active)) return null;
  return {
    id: active.id,
    ariaLabel: active.getAttribute("aria-label"),
    openTask: active.dataset?.openTask,
  };
}

function restoreTaskDetailFocus(focus) {
  const documentRef = globalThis.document;
  if (!focus || !documentRef) return;
  const element = focus.id ? documentRef.getElementById(focus.id)
    : focus.openTask ? documentRef.querySelector(`[data-open-task="${focus.openTask}"]`)
      : focus.ariaLabel ? [...documentRef.querySelectorAll("[aria-label]")].find(item => item.getAttribute("aria-label") === focus.ariaLabel) : null;
  element?.focus();
}

function renderPreservingCurrentTaskDetail() {
  const focus = captureTaskDetailFocus();
  preserveCurrentTaskDraft();
  render();
  restoreTaskDetailFocus(focus);
}

function bindWorkspaceDetail(options = {}) {
  if (!state.selectedTask) return;
  const refresh = options.refresh || reload;
  const handleError = err => options.handleError?.(err) || false;
  const boundSessionVersion = authVersion;
  const boundUserID = state.me?.id;
  const boundRouteVersion = routeVersion;
  const boundRoute = parseRoute(location.pathname);
  const boundAgentID = ["agent-detail", "agent-work", "agent-settings"].includes(boundRoute.name)
    ? state.agentDetail?.agent?.id || ""
    : "";
  const boundContextIsCurrent = () => {
    if (!sessionIsCurrent(boundSessionVersion, boundUserID)) return false;
    const currentRoute = parseRoute(location.pathname);
    const sameAgentContext = boundAgentID
      && ["agent-detail", "agent-work", "agent-settings"].includes(currentRoute.name)
      && currentRoute.agentId === boundAgentID;
    return boundRouteVersion === routeVersion || sameAgentContext;
  };
  const reportBackgroundMutationFailure = (action, taskTitle, err) => {
    if (!boundContextIsCurrent()) return false;
    if (handleError(err)) return true;
    const message = `Couldn’t ${action} “${taskTitle}”: ${err.message}`;
    const focus = state.selectedTask ? captureDetailFocus() : null;
    if (state.selectedTask) preserveTaskDraft();
    if (["agent-detail", "agent-work", "agent-settings"].includes(state.view)) {
      state.agentTaskMutationError = message;
      if (state.selectedTask) state.error = message;
    } else state.error = message;
    if (state.view === "agent-settings" && !state.selectedTask) {
      syncAgentTaskMutationError();
      return true;
    }
    render();
    restoreDetailFocus(focus);
    return true;
  };
  const reconcileLoadedTask = (task, { deleted = false, deferAgentRender = false, previousTask = null } = {}) => {
    if (!boundContextIsCurrent()) return false;
    const reconcile = items => (items || []).flatMap(item => item.id !== task.id ? [item] : deleted ? [] : [{ ...item, ...task }]);
    state.workspaceTasks = reconcile(state.workspaceTasks);
    state.selectedSubtasks = reconcile(state.selectedSubtasks);

    const movedParent = !deleted && previousTask && !task.parentTaskId && previousTask.bucketId !== task.bucketId;
    if (movedParent) {
      const location = taskWithResolvedLocation(task);
      const moveChildren = items => (items || []).map(item => item.parentTaskId === task.id ? {
        ...item,
        boardId: location.boardId,
        bucketId: location.bucketId,
        listName: location.bucketName,
      } : item);
      state.workspaceTasks = moveChildren(state.workspaceTasks);
      state.selectedSubtasks = moveChildren(state.selectedSubtasks);
      if (state.selectedTask?.parentTaskId === task.id) {
        state.selectedTask = moveChildren([state.selectedTask])[0];
      }
    }

    const agentCacheChanged = reconcileAgentTaskCaches(task, { deleted, previousTask });

    if (!deferAgentRender && agentCacheChanged && !state.selectedTask && ["agent-detail", "agent-work"].includes(state.view)) {
      const focusedTaskID = document.activeElement?.dataset?.openAgentTask || task.id;
      state.agentTaskFocusID = focusedTaskID;
      render();
    }
    return agentCacheChanged;
  };
  const taskDraftFromForm = taskDraftFromCurrentForm;
  const preserveTaskDraft = preserveCurrentTaskDraft;
  const reconcileReopenedTaskDetail = updated => {
    if (state.selectedTask?.id !== updated.id) return;
    const baseline = { ...state.selectedTask };
    const live = taskDraftFromForm(baseline);
    const merged = { ...baseline, ...updated };
    if (!live) {
      state.selectedTask = merged;
      return;
    }
    const form = document.querySelector("#workspace-detail-form");
    const fields = ["title", "description", "status", "priority", "assigneeAgentId", "scheduledDate", "bucketId"];
    for (const field of fields) {
      if (String(live[field] || "") !== String(baseline[field] || "")) {
        merged[field] = live[field];
        continue;
      }
      if (!(field in updated)) continue;
      const control = form?.querySelector(`[name="${field}"]`);
      if (control && "value" in control) control.value = String(updated[field] || "");
    }
    state.selectedTask = merged;
    state.taskDetailDrafts[updated.id] = {
      ...(state.taskDetailDrafts[updated.id] || {}),
      ...Object.fromEntries(fields.map(field => [field, merged[field] || ""])),
    };
  };
  const captureDetailFocus = captureTaskDetailFocus;
  const restoreDetailFocus = restoreTaskDetailFocus;
  const refreshAfterSubtaskMutation = async focus => {
    let latestFocus = focus;
    try {
      if (boundAgentID) preserveTaskDraft();
      const refreshed = await refresh({
        preserveTaskDetail: Boolean(boundAgentID),
        beforeTaskDetailRender: () => {
          latestFocus = captureDetailFocus() || latestFocus;
          preserveTaskDraft();
        },
        afterTaskDetailRender: () => restoreDetailFocus(latestFocus),
      });
      if (refreshed !== false) restoreDetailFocus(latestFocus);
      return refreshed;
    } catch (err) {
      if (!boundContextIsCurrent()) return false;
      if (handleError(err)) return false;
      latestFocus = captureDetailFocus() || latestFocus;
      preserveTaskDraft();
      state.error = `The task was updated, but this view couldn’t be refreshed: ${err.message}`;
      render();
      restoreDetailFocus(latestFocus);
      return false;
    }
  };
  const refreshAfterCommittedMutation = async (action, focus) => {
    returnFromTaskPermalink();
    try {
      const refreshed = await refresh();
      if (refreshed !== false) restoreDetailFocus(focus);
      return refreshed;
    } catch (err) {
      if (!boundContextIsCurrent()) return false;
      if (handleError(err)) return false;
      state.error = `The task was ${action}, but this view couldn’t be refreshed: ${err.message}`;
      render();
      restoreDetailFocus(focus);
      return false;
    }
  };
  const refreshCurrentAgentSurface = async () => {
    if (!boundAgentID || !["agent-detail", "agent-work", "agent-settings"].includes(state.view) || !boundContextIsCurrent()) return false;
    const refreshRouteVersion = routeVersion;
    const refreshView = state.view;
    if (refreshView === "agent-settings") {
      const routeWasLoading = state.agentDetailLoadState === "loading";
      try {
        const [detailResult, listResult] = await Promise.allSettled([
          routeWasLoading ? loadAgentDetail(boundAgentID, {
            sessionVersion: boundSessionVersion,
            userID: boundUserID,
            expectedRouteVersion: refreshRouteVersion,
          }) : Promise.resolve(true),
          loadWorkspaceListIndex(refreshRouteVersion),
        ]);
        if (!boundContextIsCurrent() || state.view !== refreshView) return false;
        if (detailResult.status === "rejected") throw detailResult.reason;
        if (!detailResult.value) return false;
        if (listResult.status === "fulfilled" && !listResult.value) return false;
        const completeRouteLoad = routeWasLoading && state.agentDetailLoadState === "loading";
        if (completeRouteLoad) state.agentDetailLoadState = "ready";
        state.workspaceListError = listResult.status === "rejected" ? listResult.reason?.message || "Lists could not be refreshed." : "";
        syncWorkspaceListError();
        if (completeRouteLoad) render();
        return true;
      } catch (err) {
        if (!boundContextIsCurrent() || state.view !== refreshView) return false;
        if (handleError(err)) return false;
        if (routeWasLoading && state.agentDetailLoadState === "loading") {
          state.agentDetail = null;
          state.agentDetailLoadState = err.status === 404 ? "not-found" : err.status === 401 || err.status === 403 ? "unauthorized" : "error";
          state.agentDetailError = err.message;
          render();
          return false;
        }
        state.workspaceListError = err.message;
        syncWorkspaceListError();
        return false;
      }
    }
    const routeWasLoading = state.agentDetailLoadState === "loading";
    try {
      const [detailResult, listResult] = await Promise.allSettled([
        loadAgentDetail(boundAgentID, {
          includeWorkPage: refreshView === "agent-work",
          page: workPageFromLocation(),
          sessionVersion: boundSessionVersion,
          userID: boundUserID,
          expectedRouteVersion: refreshRouteVersion,
        }),
        loadWorkspaceListIndex(refreshRouteVersion),
      ]);
      if (!boundContextIsCurrent() || state.view !== refreshView) return false;
      if (detailResult.status === "rejected") throw detailResult.reason;
      if (!detailResult.value) return false;
      state.agentDetailLoadState = "ready";
      state.workspaceListError = listResult.status === "rejected" ? listResult.reason?.message || "Lists could not be refreshed." : "";
      syncWorkspaceListError();
      clearResolvedAgentTaskRefreshError();
      if (state.selectedTask) return true;
      const agentTaskFocusID = document.activeElement?.dataset?.openAgentTask || "";
      const agentControlFocusID = agentTaskFocusID ? "" : document.activeElement?.id || "";
      if (agentTaskFocusID) state.agentTaskFocusID = agentTaskFocusID;
      render();
      if (agentControlFocusID) document.getElementById(agentControlFocusID)?.focus();
      return true;
    } catch (err) {
      if (!boundContextIsCurrent() || state.view !== refreshView) return false;
      if (handleError(err)) return false;
      if (routeWasLoading && state.agentDetailLoadState === "loading") {
        state.agentDetail = null;
        state.agentDetailLoadState = err.status === 404 ? "not-found" : err.status === 401 || err.status === 403 ? "unauthorized" : "error";
        state.agentDetailError = err.message;
        render();
        return false;
      }
      state.agentTaskRefreshError = `The task was updated, but assigned work couldn’t be refreshed: ${err.message}`;
      state.agentTaskMutationError = state.agentTaskRefreshError;
      if (state.selectedTask) {
        state.error = state.agentTaskMutationError;
        syncTaskDetailError();
      } else render();
      return false;
    }
  };
  const refreshCurrentTaskSurface = async () => {
    const currentRoute = parseRoute(location.pathname);
    if (currentRoute.name === "workspace") {
      const mounted = state.view === "app" && Boolean(globalThis.document?.querySelector?.(".task-shell"));
      return mounted ? refreshAfterTaskMutation(boundRouteVersion) : refreshCurrentWorkspaceListMetadata();
    }
    if (boundAgentID && currentRoute.agentId === boundAgentID) return refreshCurrentAgentSurface();
    if (["settings", "agents", "agent-new", "agent-settings"].includes(currentRoute.name)) return refreshCurrentWorkspaceListMetadata();
    if (!["agent-detail", "agent-work"].includes(currentRoute.name)) return true;
    let focus = captureDetailFocus();
    return refreshAgentSurface({
      preserveTaskDetail: true,
      beforeTaskDetailRender: () => {
        focus = captureDetailFocus() || focus;
        preserveTaskDraft();
      },
      afterTaskDetailRender: () => restoreDetailFocus(focus),
    });
  };
  const close = async () => {
    const currentRoute = parseRoute(location.pathname);
    const closedTaskID = state.selectedTask?.id || "";
    const refreshWorkspace = state.workspaceRefreshOnDetailClose && currentRoute.name === "workspace";
    const refreshAgent = state.agentRefreshOnDetailClose === currentRoute.agentId
      && ["agent-detail", "agent-work"].includes(currentRoute.name);
    taskDetailVersion += 1;
    state.selectedTask = null;
    state.selectedSubtasks = [];
    state.selectedEntries = [];
    state.cardEntryDraft = "";
    state.cardEntryKind = "comment";
    state.cardEntryPending = false;
    state.cardEntryError = "";
    state.cardEntryAttemptKey = "";
    state.taskDetailDrafts = {};
    state.subtaskDraft = "";
    state.subtaskCreateAttempt = null;
    state.subtaskPending = false;
    state.subtaskError = "";
    returnFromTaskPermalink();
    if (refreshWorkspace) {
      state.workspaceRefreshOnDetailClose = false;
      state.workspaceLoading = true;
      render();
      try {
        await reload();
        document.querySelector(`[data-open-task="${CSS.escape(closedTaskID)}"]`)?.focus();
      } catch (err) {
        if (handleError(err)) return;
        state.workspaceLoading = false;
        state.error = err.message;
        renderPreservingCurrentTaskDetail();
      }
      return;
    }
    if (refreshAgent) {
      state.agentRefreshOnDetailClose = "";
      state.agentTaskFocusID = closedTaskID;
      render();
      let detailFocus = captureDetailFocus();
      let agentTaskFocusID = document.activeElement?.dataset?.openAgentTask || closedTaskID;
      await refreshAgentSurface({
        preserveTaskDetail: true,
        beforeTaskDetailRender: () => {
          if (state.selectedTask) {
            detailFocus = captureDetailFocus() || detailFocus;
            preserveTaskDraft();
            return;
          }
          agentTaskFocusID = document.activeElement?.dataset?.openAgentTask || agentTaskFocusID;
          state.agentTaskFocusID = agentTaskFocusID;
        },
        afterTaskDetailRender: () => restoreDetailFocus(detailFocus),
      });
      return;
    }
    render();
    document.querySelector(`[data-open-task="${CSS.escape(closedTaskID)}"]`)?.focus();
  };
  document.querySelectorAll("[data-close-detail]").forEach(element => element.onclick = close);
  document.onkeydown = event => { if (event.key === "Escape") close(); };
  const copyTaskReference = async (value, source, button, successMessage, failureMessage) => {
    const copied = await copyAgentCredential(value, source);
    const status = document.querySelector("#task-reference-status");
    if (copied) {
      button.innerHTML = `${icon("check")}<span>Copied</span>`;
      if (status) status.textContent = successMessage;
      return;
    }
    if (status) status.textContent = failureMessage;
  };
  document.querySelector("#copy-task-id")?.addEventListener("click", event => {
    copyTaskReference(state.selectedTask.id, document.querySelector("#workspace-task-id"), event.currentTarget, "Task ID copied.", "Copy failed. The task ID is selected so you can copy it manually.");
  });
  document.querySelector("#copy-task-link")?.addEventListener("click", event => {
    copyTaskReference(taskPermalink(state.selectedTask.id), document.querySelector("#workspace-task-link"), event.currentTarget, "Task link copied.", "Copy failed. Copy the link from your browser address bar.");
  });
  document.querySelectorAll("[data-entry-kind]").forEach(element => element.addEventListener("click", () => {
    preserveTaskDraft();
    state.cardEntryDraft = document.querySelector("#card-entry-body")?.value || state.cardEntryDraft;
    const nextKind = element.dataset.entryKind;
    if (state.cardEntryKind !== nextKind) state.cardEntryAttemptKey = "";
    state.cardEntryKind = nextKind;
    render();
    document.querySelector("#card-entry-body")?.focus();
  }));
  document.querySelector("#card-entry-body")?.addEventListener("input", event => {
    if (state.cardEntryDraft !== event.currentTarget.value) state.cardEntryAttemptKey = "";
    state.cardEntryDraft = event.currentTarget.value;
  });
  document.querySelector("#add-card-entry")?.addEventListener("click", async () => {
    const taskID = state.selectedTask?.id;
    const body = document.querySelector("#card-entry-body")?.value.trim() || "";
    if (!taskID || !body || state.cardEntryPending) return;
    const detailVersion = taskDetailVersion;
    preserveTaskDraft();
    state.cardEntryDraft = body;
    state.cardEntryAttemptKey ||= newClientRequestKey();
    const attemptKey = state.cardEntryAttemptKey;
    const entryKind = state.cardEntryKind;
    const attemptIsCurrent = () => state.selectedTask?.id === taskID && state.cardEntryAttemptKey === attemptKey;
    state.cardEntryPending = true;
    state.cardEntryError = "";
    preserveTaskDraft();
    render();
    try {
      const entry = await api.post(`/api/v1/tasks/${encodeURIComponent(taskID)}/entries`, {
        kind: entryKind,
        body,
      }, { headers: { "Idempotency-Key": attemptKey } });
      reconcileCachedCardEntryAttempt(taskID, attemptKey, {
        cardEntryDraft: "",
        cardEntryAttemptKey: "",
        cardEntryPending: false,
        cardEntryError: "",
      });
      if ((detailVersion !== taskDetailVersion || state.selectedTask?.id !== taskID) && !attemptIsCurrent()) {
        const currentRoute = parseRoute(location.pathname);
        const currentAgentSurface = boundAgentID
          && ["agent-detail", "agent-work"].includes(currentRoute.name)
          && currentRoute.agentId === boundAgentID;
        if (entry.kind === "output" && (boundRouteVersion === routeVersion || currentAgentSurface)) {
          await refreshCurrentTaskSurface();
        }
        return;
      }
      state.selectedEntries = [...state.selectedEntries.filter(item => item.id !== entry.id), entry];
      state.cardEntryDraft = "";
      state.cardEntryAttemptKey = "";
      state.cardEntryPending = false;
      if (entry.kind === "output") {
        const status = entry.taskStatus || "needs_review";
        const reviewReason = entry.taskReviewReason || (status === "needs_review" ? "output" : "");
        state.selectedTask = { ...state.selectedTask, status, reviewReason };
        state.workspaceTasks = state.workspaceTasks.map(item => item.id === taskID ? { ...item, status, reviewReason } : item);
        const currentRoute = parseRoute(location.pathname);
        if (boundAgentID && ["agent-detail", "agent-work"].includes(currentRoute.name) && currentRoute.agentId === boundAgentID) {
          state.agentRefreshOnDetailClose = boundAgentID;
        } else {
          state.workspaceRefreshOnDetailClose = true;
        }
      }
      render();
      document.querySelector("#card-entry-body")?.focus();
    } catch (err) {
      reconcileCachedCardEntryAttempt(taskID, attemptKey, {
        cardEntryPending: false,
        cardEntryError: err.message,
      });
      if ((detailVersion !== taskDetailVersion || state.selectedTask?.id !== taskID) && !attemptIsCurrent()) return;
      if (handleError(err)) return;
      state.cardEntryPending = false;
      state.cardEntryError = err.message;
      render();
      document.querySelector("#card-entry-body")?.focus();
    }
  });
  document.querySelector("[data-open-parent]")?.addEventListener("click", event => {
    preserveTaskDraft();
    state.subtaskDraft = "";
    state.subtaskCreateAttempt = null;
    state.subtaskError = "";
    openTaskDetail(state.selectedTask.parentTaskId, event.currentTarget);
  });
  document.querySelectorAll(".workspace-subtask-list [data-open-task]").forEach(element => element.onclick = () => {
    preserveTaskDraft();
    state.subtaskDraft = "";
    state.subtaskCreateAttempt = null;
    state.subtaskError = "";
    openTaskDetail(element.dataset.openTask, element);
  });
  const subtaskControl = document.querySelector("#add-subtask");
  const addSubtask = async () => {
    if (!subtaskControl || state.subtaskPending) return;
    const input = subtaskControl.querySelector('input[name="title"]');
    const title = input.value.trim();
    if (!title) return;
    const parentID = state.selectedTask.id;
    const detailVersion = taskDetailVersion;
    preserveTaskDraft();
    state.subtaskDraft = title;
    state.subtaskPending = true;
    state.subtaskError = "";
    const idempotencyKey = subtaskCreateIdempotencyKey(parentID, title);
    const attemptIsCurrent = () => state.subtaskCreateAttempt?.key === idempotencyKey;
    preserveTaskDraft();
    input.readOnly = true;
    const addButton = subtaskControl.querySelector("button");
    addButton.disabled = true;
    addButton.querySelector("span").textContent = "Adding…";
    try {
      const created = await api.post(
        `/api/v1/tasks/${parentID}/subtasks`,
        { title, kind: "action" },
        { headers: { "Idempotency-Key": idempotencyKey } },
      );
      reconcileLoadedTask(created);
      reconcileCachedSubtaskAttempt(parentID, idempotencyKey, {
        subtaskDraft: "",
        subtaskCreateAttempt: null,
        subtaskPending: false,
        subtaskError: "",
      });
      if (detailVersion !== taskDetailVersion || state.selectedTask?.id !== parentID) {
        await refreshCurrentTaskSurface();
        if (state.selectedTask?.id === parentID) {
          const focus = captureDetailFocus();
          preserveTaskDraft();
          state.selectedSubtasks = [...state.selectedSubtasks.filter(item => item.id !== created.id), created];
          if (attemptIsCurrent()) {
            state.subtaskPending = false;
            state.subtaskDraft = "";
            state.subtaskCreateAttempt = null;
          }
          await refreshAfterSubtaskMutation(focus);
        }
        return;
      }
      if (attemptIsCurrent()) {
        state.subtaskPending = false;
        state.subtaskDraft = "";
        state.subtaskCreateAttempt = null;
      }
      state.selectedSubtasks = [...state.selectedSubtasks.filter(item => item.id !== created.id), created];
      await refreshAfterSubtaskMutation({ openTask: created.id });
    } catch (err) {
      reconcileCachedSubtaskAttempt(parentID, idempotencyKey, {
        subtaskPending: false,
        subtaskError: err.message,
      });
      if ((detailVersion !== taskDetailVersion || state.selectedTask?.id !== parentID) && !attemptIsCurrent()) {
        reportBackgroundMutationFailure("add subtask", title, err);
        return;
      }
      if (!attemptIsCurrent()) {
        reportBackgroundMutationFailure("add subtask", title, err);
        return;
      }
      if (handleError(err)) return;
      state.subtaskPending = false;
      state.subtaskError = err.message;
      render();
      document.querySelector('#add-subtask input[name="title"]')?.focus();
    }
  };
  subtaskControl?.querySelector("button")?.addEventListener("click", addSubtask);
  subtaskControl?.querySelector("input")?.addEventListener("input", event => {
    if (event.currentTarget.value !== state.subtaskDraft) state.subtaskCreateAttempt = null;
    state.subtaskDraft = event.currentTarget.value;
  });
  subtaskControl?.querySelector("input")?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      addSubtask();
    }
  });
  document.querySelector("#delete-task")?.addEventListener("click", async () => {
    if (!confirm("Delete this task and its subtasks?")) return;
    const taskID = state.selectedTask.id;
    const taskTitle = state.selectedTask.title;
    const parentTaskID = state.selectedTask.parentTaskId || "";
    const deletedTasks = parentTaskID
      ? [{ ...state.selectedTask }]
      : [{ ...state.selectedTask }, ...state.selectedSubtasks.filter(item => item.parentTaskId === taskID).map(item => ({ ...item }))];
    const detailVersion = taskDetailVersion;
    state.agentTaskMutationError = "";
    state.agentTaskRefreshError = "";
    preserveTaskDraft();
    try {
      const deleted = await serializeTaskMutation(taskID, () => api.del(`/api/v1/tasks/${taskID}`));
      if (!deleted) return;
      const agentCacheChanged = deletedTasks.reduce((changed, task) => reconcileLoadedTask(task, { deleted: true, deferAgentRender: true }) || changed, false);
      if (agentCacheChanged && !state.selectedTask && ["agent-detail", "agent-work"].includes(state.view)) {
        state.agentTaskFocusID = document.activeElement?.dataset?.openAgentTask || taskID;
        render();
      }
      if (detailVersion !== taskDetailVersion || state.selectedTask?.id !== taskID) {
        state.workspaceTasks = state.workspaceTasks.filter(item => item.id !== taskID);
        state.selectedSubtasks = state.selectedSubtasks.filter(item => item.id !== taskID);
        await refreshCurrentTaskSurface();
        const selectedTaskID = state.selectedTask?.id || "";
        const selectedTaskWasDeleted = selectedTaskID === taskID || state.selectedTask?.parentTaskId === taskID;
        if (selectedTaskWasDeleted) {
          taskDetailVersion += 1;
          for (const task of deletedTasks) delete state.taskDetailDrafts[task.id];
          delete state.taskDetailDrafts[selectedTaskID];
          state.selectedTask = null;
          state.selectedSubtasks = [];
          state.subtaskDraft = "";
          state.subtaskCreateAttempt = null;
          state.subtaskPending = false;
          state.subtaskError = "";
          state.agentTaskFocusID = taskID;
          returnFromTaskPermalink();
          render();
          return;
        }
        if (state.selectedTask?.id !== taskID) return;
        delete state.taskDetailDrafts[taskID];
        state.subtaskDraft = "";
        state.subtaskCreateAttempt = null;
        state.subtaskPending = false;
        state.subtaskError = "";
        if (parentTaskID) {
          await openTaskDetail(parentTaskID);
          await refreshAfterSubtaskMutation();
          return;
        }
        taskDetailVersion += 1;
        state.selectedTask = null;
        state.selectedSubtasks = [];
        state.taskDetailDrafts = {};
        await refreshAfterCommittedMutation("deleted");
        return;
      }
      if (parentTaskID) {
        delete state.taskDetailDrafts[taskID];
        state.subtaskDraft = "";
        state.subtaskCreateAttempt = null;
        state.subtaskPending = false;
        state.subtaskError = "";
        await openTaskDetail(parentTaskID);
        await refreshAfterSubtaskMutation();
        return;
      }
      taskDetailVersion += 1;
      state.selectedTask = null;
      state.selectedSubtasks = [];
      state.taskDetailDrafts = {};
      state.subtaskDraft = "";
      state.subtaskCreateAttempt = null;
      state.subtaskPending = false;
      state.subtaskError = "";
      await refreshAfterCommittedMutation("deleted");
    } catch (err) {
      if (detailVersion !== taskDetailVersion || state.selectedTask?.id !== taskID) {
        reportBackgroundMutationFailure("delete", taskTitle, err);
        return;
      }
      if (handleError(err)) return;
      state.error = err.message;
      render();
    }
  });
  document.querySelector("#workspace-detail-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const controls = [...event.currentTarget.querySelectorAll("input, textarea, select, button")];
    const form = new FormData(event.currentTarget);
    const taskID = state.selectedTask.id;
    const taskTitle = String(form.get("title") || state.selectedTask.title);
    const parentTaskID = state.selectedTask.parentTaskId || "";
    const previousTask = { ...state.selectedTask };
    const detailVersion = taskDetailVersion;
    state.agentTaskMutationError = "";
    state.agentTaskRefreshError = "";
    preserveTaskDraft();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    controls.forEach(control => { control.disabled = true; });
    submit.textContent = "Saving…";
    try {
      const input = {
        title: form.get("title"), description: form.get("description"), status: form.get("status"),
        priority: form.get("priority"), assigneeAgentId: form.get("assigneeAgentId"),
        scheduledDate: form.get("scheduledDate"),
      };
      if (!parentTaskID) input.bucketId = form.get("bucketId");
      const updated = await serializeTaskMutation(taskID, async ({ queued }) => {
        if (!queued) return api.patch(`/api/v1/tasks/${taskID}/status`, input);
        const current = await api.get(`/api/v1/tasks/${taskID}`);
        const rebased = { status: current.status };
        for (const field of ["title", "description", "status", "priority", "assigneeAgentId", "scheduledDate", "bucketId"]) {
          if (!(field in input)) continue;
          const previousValue = String(previousTask[field] || "");
          if (String(input[field] || "") !== previousValue) rebased[field] = input[field];
        }
        return api.patch(`/api/v1/tasks/${taskID}/status`, rebased);
      });
      if (!updated) return;
      reconcileLoadedTask(updated, { previousTask });
      if (detailVersion !== taskDetailVersion || state.selectedTask?.id !== taskID) {
        state.workspaceTasks = state.workspaceTasks.map(item => item.id === taskID ? { ...item, ...updated } : item);
        state.selectedSubtasks = state.selectedSubtasks.map(item => item.id === taskID ? { ...item, ...updated } : item);
        reconcileReopenedTaskDetail(updated);
        await refreshCurrentTaskSurface();
        return;
      }
      if (parentTaskID) {
        delete state.taskDetailDrafts[taskID];
        state.subtaskDraft = "";
        state.subtaskCreateAttempt = null;
        state.subtaskPending = false;
        state.subtaskError = "";
        await openTaskDetail(parentTaskID);
        await refreshAfterSubtaskMutation();
        return;
      }
      taskDetailVersion += 1;
      state.selectedTask = null;
      state.selectedSubtasks = [];
      state.taskDetailDrafts = {};
      state.subtaskDraft = "";
      state.subtaskCreateAttempt = null;
      state.subtaskPending = false;
      state.subtaskError = "";
      await refreshAfterCommittedMutation("saved");
    } catch (err) {
      if (detailVersion !== taskDetailVersion || state.selectedTask?.id !== taskID) {
        reportBackgroundMutationFailure("save", taskTitle, err);
        return;
      }
      if (handleError(err)) return;
      state.error = err.message;
      render();
    }
  });
  document.querySelector("#workspace-detail-title")?.focus();
}

function bindApp() {
  bindAppShell();
  bindWorkspace();
}

function clearTaskMutationError(taskID) {
  const ownedError = state.taskMutationError?.taskID === taskID ? state.taskMutationError.message : "";
  if (ownedError) state.taskMutationError = null;
  if (ownedError && state.error === ownedError) {
    state.error = "";
    if (state.selectedTask) syncTaskDetailError();
  }
}

async function refreshAfterTaskMutation(startedRouteVersion) {
  const currentRoute = parseRoute(location.pathname);
  if (currentRoute.name === "workspace") {
    if (state.view !== "app" || !globalThis.document?.querySelector?.(".task-shell")) return refreshCurrentWorkspaceListMetadata();
    if (state.selectedTask) {
      state.workspaceRefreshOnDetailClose = true;
      return;
    }
  } else if (["agent-detail", "agent-work"].includes(currentRoute.name)) {
    if (state.selectedTask) {
      state.agentRefreshOnDetailClose = currentRoute.agentId;
      return true;
    }
    let focus = captureTaskDetailFocus();
    return refreshAgentSurface({
      preserveTaskDetail: true,
      beforeTaskDetailRender: () => {
        focus = captureTaskDetailFocus() || focus;
        preserveCurrentTaskDraft();
      },
      afterTaskDetailRender: () => restoreTaskDetailFocus(focus),
    });
  } else if (["settings", "agents", "agent-new", "agent-settings"].includes(currentRoute.name)) {
    return refreshCurrentWorkspaceListMetadata();
  } else if (state.selectedTask || startedRouteVersion !== routeVersion) {
    return true;
  }
  const refreshRouteVersion = routeVersion;
  try {
    return await reload();
  } catch (err) {
    if (refreshRouteVersion !== routeVersion) return false;
    state.workspaceLoading = false;
    state.error = `The task was updated, but this view couldn’t be refreshed: ${err.message}`;
    renderPreservingCurrentTaskDetail();
    return false;
  }
}

function reconcileTaskMutation(updated, previousTask) {
  const reconciled = { ...updated };
  const merge = items => (items || []).map(item => item.id === reconciled.id ? { ...item, ...reconciled } : item);
  state.workspaceTasks = merge(state.workspaceTasks);
  state.selectedSubtasks = merge(state.selectedSubtasks);
  for (const list of state.board?.buckets || []) list.tasks = merge(list.tasks);
  reconcileAgentTaskCaches(reconciled, { previousTask });

  const movedParent = !reconciled.parentTaskId && previousTask && previousTask.bucketId !== reconciled.bucketId;
  if (movedParent) {
    const location = taskWithResolvedLocation(reconciled);
    const moveChildren = items => (items || []).map(item => item.parentTaskId === reconciled.id ? {
      ...item,
      boardId: location.boardId,
      boardName: location.boardName,
      bucketId: location.bucketId,
      bucketName: location.bucketName,
      listName: location.bucketName,
    } : item);
    state.workspaceTasks = moveChildren(state.workspaceTasks);
    state.selectedSubtasks = moveChildren(state.selectedSubtasks);
    if (state.selectedTask?.parentTaskId === reconciled.id) {
      const savedDraft = state.taskDetailDrafts[state.selectedTask.id] || {};
      const draft = taskDraftFromCurrentForm(state.selectedTask) || savedDraft;
      state.selectedTask = { ...moveChildren([state.selectedTask])[0], ...draft, bucketId: location.bucketId };
      state.taskDetailDrafts[state.selectedTask.id] = { ...savedDraft, ...draft, bucketId: location.bucketId };
      const listControl = globalThis.document?.querySelector?.("#workspace-detail-list");
      if (listControl) listControl.value = location.bucketId;
      const context = globalThis.document?.querySelector?.(".detail-context span");
      if (context) context.textContent = location.bucketName || "Inbox";
    }
  }

  if (previousTask.status !== reconciled.status && (previousTask.status === "done" || reconciled.status === "done")) {
    const list = state.workspaceLists.find(item => item.id === (reconciled.bucketId || previousTask.bucketId));
    if (list) list.openCount = Math.max(0, Number(list.openCount || 0) + (reconciled.status === "done" ? -1 : 1));
  }

  if (state.selectedTask?.id !== reconciled.id) return;
  const baseline = state.selectedTask;
  const live = taskDraftFromCurrentForm(baseline);
  const statusControl = globalThis.document?.querySelector?.('#workspace-detail-form [name="status"]');
  const liveStatus = live?.status || statusControl?.value || baseline.status;
  const statusWasEdited = Boolean(statusControl) && liveStatus !== baseline.status;
  const merged = { ...baseline, ...reconciled };
  const form = globalThis.document?.querySelector?.("#workspace-detail-form");
  for (const field of ["title", "description", "priority", "assigneeAgentId", "scheduledDate", "bucketId"]) {
    if (live && String(live[field] || "") !== String(baseline[field] || "")) {
      merged[field] = live[field];
      continue;
    }
    if (!(field in reconciled)) continue;
    const control = form?.querySelector?.(`[name="${field}"]`);
    if (control && "value" in control) control.value = String(reconciled[field] || "");
  }
  merged.status = statusWasEdited ? liveStatus : reconciled.status;
  state.selectedTask = merged;
  if (statusControl && !statusWasEdited) statusControl.value = reconciled.status;
  const fields = ["title", "description", "status", "priority", "assigneeAgentId", "scheduledDate", "bucketId"];
  state.taskDetailDrafts[reconciled.id] = {
    ...(state.taskDetailDrafts[reconciled.id] || {}),
    ...Object.fromEntries(fields.map(field => [field, merged[field] || ""])),
  };
}

function bindAppShell() {
  document.querySelectorAll("[data-home]").forEach(el => el.onclick = goHome);
  bindCardContextMenus();
  document.querySelectorAll(".nav-sec a.nav-link, .task-nav-pages a").forEach(el => el.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const target = new URL(el.href, location.origin);
    navigate(`${target.pathname}${target.search}`);
  }));
  const sidebar = document.querySelector(".sidebar");
  const sidebarToggle = document.querySelector("#sidebar-toggle");
  bindDesktopSidebarToggle();
  sidebarToggle.onclick = () => {
    const open = sidebar.classList.toggle("open");
    sidebarToggle.setAttribute("aria-expanded", String(open));
    sidebarToggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  };
  bindThemeControls();
  bindNewTaskRecoveryActions();
  bindGlobalNewTask();
  bindWorkspaceListControl();
  bindBoardNavigationControls(sidebar);
  document.querySelector("#agents-nav")?.addEventListener("click", event => {
    event.preventDefault();
    navigate(AGENTS_PATH);
  });
  document.querySelector("#settings").onclick = openSettings;
  document.querySelector("#logout").onclick = logout;
  return sidebar;
}

const desktopNavigationMedia = globalThis.window?.matchMedia?.("(min-width: 901px)") || null;

function syncDesktopSidebar() {
  const sidebar = document.querySelector("#primary-navigation");
  const toggle = document.querySelector("#desktop-sidebar-toggle");
  if (!sidebar || !toggle) return;
  const collapsed = state.sidebarCollapsed && (desktopNavigationMedia?.matches ?? true);
  sidebar.classList.toggle("collapsed", collapsed);
  sidebar.toggleAttribute("inert", collapsed);
  sidebar.setAttribute("aria-hidden", String(collapsed));
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.setAttribute("aria-label", collapsed ? "Show navigation" : "Hide navigation");
}

function bindDesktopSidebarToggle() {
  const toggle = document.querySelector("#desktop-sidebar-toggle");
  if (!toggle) return;
  syncDesktopSidebar();
  toggle.onclick = () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    syncDesktopSidebar();
  };
}

desktopNavigationMedia?.addEventListener?.("change", syncDesktopSidebar);

function bindBoardNavigationControls(sidebar = document.querySelector(".sidebar")) {
  document.querySelectorAll("[data-start-rename-board]").forEach(el => el.onclick = () => {
    const keepSidebarOpen = sidebar?.classList.contains("open");
    state.renamingBoardId = el.dataset.startRenameBoard;
    renderKeepingSidebarOpen(keepSidebarOpen);
    const input = document.querySelector(`[data-rename-board="${state.renamingBoardId}"] input[name="name"]`);
    input?.focus();
    input?.select();
  });
  document.querySelectorAll("[data-rename-board]").forEach(form => bindBoardRename(form));
  document.querySelectorAll("[data-delete-board]").forEach(el => el.onclick = () => openBoardDeleteDialog(el.dataset.deleteBoard));
  const newBoardButton = document.querySelector("#new-board");
  if (newBoardButton) newBoardButton.onclick = async () => {
    if (state.boardCreatePending || state.boards.length >= state.maxBoards) return;
    const sessionVersion = authVersion;
    const userID = state.me?.id;
    const startedRouteVersion = routeVersion;
    state.boardCreatePending = true;
    render();
    let result;
    try {
      result = await createDefaultBoard();
    } catch (err) {
      if (sessionIsCurrent(sessionVersion, userID)) state.error = err.message;
    }
    if (!sessionIsCurrent(sessionVersion, userID)) return;
    state.boardCreatePending = false;
    if (startedRouteVersion !== routeVersion) {
      const currentButton = document.querySelector("#new-board");
      if (currentButton) currentButton.disabled = state.boards.length >= state.maxBoards;
      return;
    }
    if (result?.complete) navigate(TASKS_PATH);
    else render();
  };
}

async function renameWorkspaceList(element) {
  const id = element.dataset.bucketName;
  const list = state.workspaceLists.find(item => item.id === id) || state.board?.buckets?.find(item => item.id === id);
  if (!list) return false;
  const name = element.value.trim();
  const expectedRouteVersion = routeVersion;
  if (!name) {
    state.error = "List name is required.";
    render();
    document.querySelector(`[data-bucket-name="${CSS.escape(id)}"]`)?.focus();
    return false;
  }
  if (name === list.name) {
    element.value = name;
    return true;
  }
  element.disabled = true;
  try {
    const updated = await api.patch(`/api/v1/buckets/${id}`, { name });
    if (expectedRouteVersion !== routeVersion) return false;
    const nextName = updated.name || name;
    const rename = item => item.id === id ? {
      ...item,
      ...updated,
      name: nextName,
      tasks: (item.tasks || []).map(task => ({ ...task, listName: nextName, bucketName: nextName })),
    } : item;
    if (state.board?.buckets) state.board = { ...state.board, buckets: state.board.buckets.map(rename) };
    state.workspaceLists = state.workspaceLists.map(rename);
    state.error = "";
    render();
    document.querySelector(`[data-bucket-name="${CSS.escape(id)}"]`)?.focus();
    return true;
  } catch (err) {
    if (expectedRouteVersion !== routeVersion) return false;
    state.error = err.message;
    render();
    const restored = document.querySelector(`[data-bucket-name="${CSS.escape(id)}"]`);
    restored?.focus();
    restored?.select();
    return false;
  }
}

function bindWorkspaceListControl() {
  document.querySelector("#add-list")?.addEventListener("click", () => {
    if (!state.board || workspaceListCount(state.board.id) >= state.maxListsPerBoard) return;
    state.workspaceListError = "";
    state.workspaceListDialog = "create";
    state.workspaceListDialogListID = "";
    state.workspaceListDialogName = "";
    state.workspaceListDialogBoardID = state.board.id;
    state.workspaceListDialogError = "";
    render();
    document.querySelector("#workspace-list-name")?.focus();
  });
  document.querySelector("#new-workspace-list")?.addEventListener("click", () => {
    const board = boardWithWorkspaceListCapacity();
    if (!board) {
      state.workspaceListError = state.boards.length
        ? "Every board has reached the list limit for your plan."
        : "Create a board before adding a list.";
      render();
      return;
    }
    state.workspaceListError = "";
    state.workspaceListDialog = "create";
    state.workspaceListDialogListID = "";
    state.workspaceListDialogName = "";
    state.workspaceListDialogBoardID = board.id;
    state.workspaceListDialogError = "";
    render();
    document.querySelector("#workspace-list-name")?.focus();
  });
  document.querySelector("#delete-workspace-list")?.addEventListener("click", event => openWorkspaceListDeleteDialog(event.currentTarget.dataset.listId));
  document.querySelectorAll("[data-delete-bucket]").forEach(element => {
    element.onclick = () => openWorkspaceListDeleteDialog(element.dataset.deleteBucket);
  });
  bindWorkspaceListDialog();
}

function openWorkspaceListDeleteDialog(listID) {
  const list = state.workspaceLists.find(item => item.id === listID);
  if (!list || list.isInbox) return;
  state.workspaceListDialog = "delete";
  state.workspaceListDialogListID = listID;
  state.workspaceListDialogName = "";
  state.workspaceListDialogBoardID = "";
  state.workspaceListDialogError = "";
  render();
  document.querySelector("#confirm-workspace-list-dialog")?.focus();
}

function openBoardDeleteDialog(boardID) {
  if (!state.boards.some(item => item.id === boardID) || !boardCanBeDeleted(boardID)) return;
  state.workspaceListDialog = "delete-board";
  state.workspaceListDialogListID = "";
  state.workspaceListDialogName = "";
  state.workspaceListDialogBoardID = boardID;
  state.workspaceListDialogError = "";
  render();
  document.querySelector("#confirm-workspace-list-dialog")?.focus();
}

function bindWorkspaceListDialog() {
  const overlay = document.querySelector(".workspace-list-dialog-overlay");
  const form = document.querySelector("#workspace-list-dialog-form");
  if (!overlay || !form) return;
  const close = () => {
    if (state.workspaceListPending) return;
    const deletingList = state.workspaceListDialog === "delete";
    const deletingBoard = state.workspaceListDialog === "delete-board";
    const listID = state.workspaceListDialogListID;
    const boardID = state.workspaceListDialogBoardID;
    state.workspaceListDialog = "";
    state.workspaceListDialogListID = "";
    state.workspaceListDialogName = "";
    state.workspaceListDialogBoardID = "";
    state.workspaceListDialogError = "";
    render();
    const createTrigger = parseRoute(location.pathname).name === "board" ? "#add-list" : "#new-workspace-list";
    const focusTarget = deletingBoard
      ? `[data-delete-board="${CSS.escape(boardID)}"]`
      : deletingList ? `[data-list-id="${CSS.escape(listID)}"], [data-delete-bucket="${CSS.escape(listID)}"]` : createTrigger;
    document.querySelector(focusTarget)?.focus();
  };
  document.querySelector("#cancel-workspace-list-dialog")?.addEventListener("click", close);
  document.querySelector("#workspace-list-name")?.addEventListener("input", event => {
    state.workspaceListDialogName = event.currentTarget.value;
  });
  overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
  overlay.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [...overlay.querySelectorAll("input:not(:disabled), select:not(:disabled), button:not(:disabled)")];
    if (!controls.length) {
      event.preventDefault();
      overlay.querySelector(".workspace-list-dialog")?.focus();
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
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (state.workspaceListDialog === "delete-board") {
      await deleteBoard(state.workspaceListDialogBoardID);
      return;
    }
    if (state.workspaceListDialog === "delete") {
      await deleteWorkspaceList(state.workspaceListDialogListID);
      return;
    }
    const data = new FormData(form);
    state.workspaceListDialogName = String(data.get("name") || "");
    await createWorkspaceList(data.get("name"));
  });
}

async function captureInboxTask(button) {
  if (newTaskCaptureBlocked()) return false;
  state.newTaskCapturePending = true;
  state.error = "";
  render();
  let task;
  state.newTaskCaptureAttemptKey ||= newClientRequestKey();
  try {
    task = await api.post(
      "/api/v1/tasks",
      { title: "Untitled task", description: "", kind: "action" },
      { headers: { "Idempotency-Key": state.newTaskCaptureAttemptKey } },
    );
  } catch (err) {
    state.newTaskCapturePending = false;
    state.error = err.message;
    render();
    return false;
  }

  state.newTaskCapturePending = false;
  state.newTaskCaptureAttemptKey = "";
  state.newTaskRecovery = { task, message: "The Inbox could not be refreshed.", pending: false };
  try {
    if (parseRoute(location.pathname).name === "workspace") {
      if (!await reload()) throw new Error(state.error || "The Inbox could not be refreshed.");
    } else {
      await navigate(INBOX_PATH);
      if (parseRoute(location.pathname).name !== "workspace" || state.view !== "app") {
        throw new Error(state.error || "The Inbox could not be loaded.");
      }
    }
    let detailError;
    const opened = await openTaskDetail(task.id, null, { onError: err => { detailError = err; } });
    if (!opened) throw detailError || new Error("The task could not be loaded.");
    state.newTaskRecovery = null;
    render();
    focusOpenedTaskDetail();
    return true;
  } catch (err) {
    state.error = "";
    state.newTaskRecovery = { task, message: err.message || "The task could not be opened.", pending: false };
    render();
    return false;
  }
}

async function recoverCreatedTask() {
  const recovery = state.newTaskRecovery;
  if (!recovery || recovery.pending || state.newTaskCapturePending) return false;
  state.newTaskRecovery = { ...recovery, pending: true };
  render();
  try {
    await navigate(INBOX_PATH);
    if (parseRoute(location.pathname).name !== "workspace" || state.view !== "app") {
      throw new Error(state.error || "The Inbox could not be loaded.");
    }
    let detailError;
    const opened = await openTaskDetail(recovery.task.id, null, { onError: err => { detailError = err; } });
    if (!opened) throw detailError || new Error("The task could not be loaded.");
    state.newTaskRecovery = null;
    render();
    focusOpenedTaskDetail();
    return true;
  } catch (err) {
    state.error = "";
    state.newTaskRecovery = { ...recovery, message: err.message || "The task could not be opened.", pending: false };
    render();
    return false;
  }
}

function bindGlobalNewTask() {
  document.querySelector("#global-new-task")?.addEventListener("click", event => captureInboxTask(event.currentTarget));
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
  if (!board || !boardCanBeDeleted(id) || state.workspaceListPending) return false;
  const sessionVersion = authVersion;
  const userID = state.me?.id;
  const startedRouteVersion = routeVersion;
  const routeIsCurrent = () => startedRouteVersion === routeVersion;
  const clearCommittedDialog = ({ remove = false } = {}) => {
    if (state.workspaceListDialog !== "delete-board" || state.workspaceListDialogBoardID !== id) return;
    state.workspaceListPending = false;
    state.workspaceListDialog = "";
    state.workspaceListDialogBoardID = "";
    state.workspaceListDialogError = "";
    if (remove) globalThis.document?.querySelector?.(".workspace-list-dialog-overlay")?.remove();
  };
  state.workspaceListPending = true;
  state.workspaceListDialogError = "";
  render();
  globalThis.document?.querySelector?.(".workspace-list-dialog")?.focus();
  try {
    await api.del(`/api/v1/boards/${id}`);
  } catch (err) {
    if (!sessionIsCurrent(sessionVersion, userID)) return false;
    if (!routeIsCurrent()) {
      clearCommittedDialog({ remove: true });
      return false;
    }
    state.workspaceListPending = false;
    state.workspaceListDialogError = err.message;
    render();
    globalThis.document?.querySelector?.("#confirm-workspace-list-dialog")?.focus();
    return false;
  }
  if (!sessionIsCurrent(sessionVersion, userID)) return false;
  const deletedListIDs = new Set(state.workspaceLists.filter(list => list.boardId === id).map(list => list.id));
  const belongsToDeletedBoard = task => task.boardId === id || deletedListIDs.has(task.bucketId);
  const cachedAgentTasks = [
    ...(state.agentWorkPage?.items || []),
    ...["ready", "working", "review", "recentlyCompleted"].flatMap(group => state.agentDetail?.work?.[group] || []),
  ].filter(belongsToDeletedBoard);
  const reconciledAgentTaskIDs = new Set();
  for (const task of cachedAgentTasks) {
    if (reconciledAgentTaskIDs.has(task.id)) continue;
    reconciledAgentTaskIDs.add(task.id);
    reconcileAgentTaskCaches(task, { deleted: true });
  }
  const deletedTasks = [...state.workspaceTasks, ...state.selectedSubtasks].filter(belongsToDeletedBoard);
  workspaceListVersion += 1;
  state.boards = state.boards.filter(board => board.id !== id);
  state.workspaceLists = state.workspaceLists.filter(list => list.boardId !== id);
  state.workspaceTasks = state.workspaceTasks.filter(task => !belongsToDeletedBoard(task));
  state.selectedSubtasks = state.selectedSubtasks.filter(task => !belongsToDeletedBoard(task));
  for (const task of [...deletedTasks, ...cachedAgentTasks]) {
    delete state.taskDetailDrafts[task.id];
  }
  clearCommittedDialog({ remove: !routeIsCurrent() });
  if (state.selectedTask && belongsToDeletedBoard(state.selectedTask)) state.selectedTask = null;
  if (state.board?.id === id) state.board = null;
  if (!routeIsCurrent()) {
    const currentRoute = parseRoute(location.pathname);
    if (currentRoute.name === "board" && currentRoute.boardId === id) {
      await navigate(TASKS_PATH, { replace: true });
    }
    return true;
  }
  try {
    if (!await loadBoards(undefined, startedRouteVersion)) return false;
    if (!await loadAgents(false, sessionVersion, userID, startedRouteVersion)) return false;
    const route = parseRoute(location.pathname);
    if (["agent-detail", "agent-work", "agent-settings"].includes(route.name)) {
      const loaded = await loadAgentDetail(route.agentId, {
        includeWorkPage: route.name === "agent-work",
        page: route.name === "agent-work" ? workPageFromLocation() : 1,
        sessionVersion,
        userID,
        expectedRouteVersion: startedRouteVersion,
      });
      if (!loaded) return false;
    }
  } catch (err) {
    if (!sessionIsCurrent(sessionVersion, userID) || startedRouteVersion !== routeVersion) return false;
    const message = `The board was deleted, but Slate could not refresh all views: ${err.message}`;
    state.error = message;
    if (["agent-detail", "agent-work", "agent-settings"].includes(parseRoute(location.pathname).name)) {
      state.agentTaskRefreshError = message;
      state.agentTaskMutationError = message;
    }
    render();
    return true;
  }
  if (!sessionIsCurrent(sessionVersion, userID) || startedRouteVersion !== routeVersion) return false;
  if (!state.board) return false;
  render();
  return true;
}

function boardCanBeDeleted(boardID) {
  return state.workspaceLists.some(list => list.isInbox && list.boardId !== boardID);
}

async function bindSettings() {
  document.querySelectorAll("[data-home]").forEach(el => el.onclick = goHome);
  bindDesktopSidebarToggle();
  bindNewTaskRecoveryActions();
  bindGlobalNewTask();
  bindWorkspaceListControl();
  bindBoardNavigationControls(document.querySelector(".settings-sidebar"));
  document.querySelectorAll(".settings-nav-link").forEach(el => el.onclick = event => {
    event.preventDefault();
    navigate(el.getAttribute("href"));
  });
  document.querySelector("#back").onclick = closeSettings;
  document.querySelector("#settings-logout").onclick = logout;
  bindThemeControls();
  document.querySelector("#request-password-reset")?.addEventListener("click", async event => {
    const version = routeVersion;
    const sessionVersion = authVersion;
    const userID = state.me?.id;
    const email = state.me?.email;
    if (state.settingsPending || !email) return;
    state.settingsPending = "password-reset";
    state.settingsNotice = "";
    state.error = "";
    const button = event.currentTarget;
    button.setAttribute("aria-disabled", "true");
    button.textContent = "Sending…";
    const profileSubmit = document.querySelector('#profile-form button[type="submit"]');
    if (profileSubmit) profileSubmit.disabled = true;
    try {
      const result = await api.post("/api/v1/auth/password-reset/request", { email });
      if (!settingsMutationIsCurrent(sessionVersion, userID, version, "profile")) return;
      state.settingsNotice = result.message;
    } catch (err) {
      if (!settingsMutationIsCurrent(sessionVersion, userID, version, "profile")) return;
      state.error = err.message;
    }
    state.settingsPending = "";
    render();
    document.querySelector("#request-password-reset")?.focus();
  });
  document.querySelector("#profile-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    if (state.settingsPending) return;
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
    bindWorkspaceDetail({
      refresh: refreshAgentSurface,
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
    state.agentLifecycleError = "";
    render();
    document.querySelector("#confirm-agent-lifecycle")?.focus();
  };
  document.querySelector("#rotate-agent-credential")?.addEventListener("click", () => openConfirm("rotate"));
  document.querySelector("#revoke-agent-credential")?.addEventListener("click", () => openConfirm("revoke"));
  document.querySelector("#delete-agent")?.addEventListener("click", () => openConfirm("delete"));
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
    state.agentLifecycleError = "";
    render();
    document.querySelector(`#${action === "rotate" ? "rotate-agent-credential" : action === "revoke" ? "revoke-agent-credential" : "delete-agent"}`)?.focus();
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
    } else if (action === "delete") {
      await api.del(`/api/v1/agents/${encodeURIComponent(context.agentID)}`);
      if (!agentMutationIsCurrent(context)) return;
      await finishAgentDeletion(context);
      return;
    }
    if (!agentMutationIsCurrent(context)) return;
    state.agentLifecycleConfirm = "";
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
    if (action === "delete" && err.status === 404) {
      await finishAgentDeletion(context);
      return;
    }
    state.agentLifecyclePending = "";
    state.agentLifecycleError = err.message;
    render();
    document.querySelector("#confirm-agent-lifecycle")?.focus();
  }
}

async function finishAgentDeletion(context) {
  if (!agentMutationIsCurrent(context)) return;
  state.agents = state.agents.filter(agent => agent.id !== context.agentID);
  state.activeAgents = Math.max(0, state.activeAgents - 1);
  state.agentDetail = null;
  state.agentWorkPage = null;
  state.agentDetailLoadState = "idle";
  state.agentLifecycleConfirm = "";
  state.agentLifecyclePending = "";
  state.agentLifecycleNotice = "Agent deleted.";
  await navigate(AGENTS_PATH);
}

function focusAfterAgentLifecycle(action) {
  const selector = action === "revoke" ? "#rotate-agent-credential" : "#copy-lifecycle-credential";
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
  return newClientRequestKey();
}

function newClientRequestKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const values = new Uint8Array(24);
  globalThis.crypto.getRandomValues(values);
  return [...values].map(value => value.toString(16).padStart(2, "0")).join("");
}

function subtaskCreateIdempotencyKey(parentID, title) {
  const previous = state.subtaskCreateAttempt;
  if (previous?.parentID === parentID && previous.title === title) return previous.key;
  const key = newClientRequestKey();
  state.subtaskCreateAttempt = { parentID, title, key };
  return key;
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
  state.agentTaskFocusID = item.id;
  state.agentTaskMutationError = "";
  state.agentTaskRefreshError = "";
  const opened = await openTaskDetail(item.id, element, {
    handleError: handleAgentUnauthorized,
    onError: err => { state.agentAssignNotice = `Item couldn’t be opened: ${err.message}`; },
  });
  if (!opened && state.agentTaskFocusID === item.id) {
    document.querySelector(`[data-open-agent-task="${CSS.escape(item.id)}"]`)?.focus();
  }
}

async function refreshAgentSurface(options = {}) {
  const route = parseRoute(location.pathname);
  if (!["agent-detail", "agent-work", "agent-settings"].includes(route.name)) return;
  const version = routeVersion;
  const sessionVersion = authVersion;
  const userID = state.me?.id;
  try {
    const [detailResult, listResult] = await Promise.allSettled([
      loadAgentDetail(route.agentId, {
        includeWorkPage: route.name === "agent-work",
        page: workPageFromLocation(),
        sessionVersion,
        userID,
        expectedRouteVersion: version,
      }),
      loadWorkspaceListIndex(version),
    ]);
    if (!sessionIsCurrent(sessionVersion, userID) || version !== routeVersion) return false;
    if (detailResult.status === "rejected") throw detailResult.reason;
    if (!detailResult.value) return false;
    state.agentDetailLoadState = "ready";
    state.workspaceListError = listResult.status === "rejected" ? listResult.reason?.message || "Lists could not be refreshed." : "";
    clearResolvedAgentTaskRefreshError();
    options.beforeTaskDetailRender?.();
    render();
    options.afterTaskDetailRender?.();
    return true;
  } catch (err) {
    if (version !== routeVersion) return false;
    if (handleAgentUnauthorized(err, route)) return false;
    if (options.preserveTaskDetail && state.selectedTask) {
      const message = `The task was updated, but assigned work couldn’t be refreshed: ${err.message}`;
      options.beforeTaskDetailRender?.();
      state.agentDetailLoadState = "ready";
      state.agentTaskRefreshError = message;
      state.agentTaskMutationError = message;
      state.error = message;
      render();
      options.afterTaskDetailRender?.();
      return false;
    }
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
  return navigate(APP_PATH);
}

function showLogin() {
  state.error = "";
  return navigate(LOGIN_PATH);
}

function openApp() {
  return navigate(state.me ? APP_PATH : LOGIN_PATH);
}

function goHome() {
  if (!state.me || state.view === "logging-out" || state.view === "logout-error") return navigate(HOME_PATH);
  return navigate(APP_PATH);
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
  const sessionVersion = authVersion;
  const userID = state.me?.id;
  const startedRouteVersion = routeVersion;
  let previousTask = findTask(id);
  let updated;
  try {
    updated = await serializeTaskMutation(id, async ({ queued }) => {
      if (queued) previousTask = await api.get(`/api/v1/tasks/${encodeURIComponent(id)}`);
      return api.patch(`/api/v1/tasks/${encodeURIComponent(id)}/status`, { status });
    });
  } catch (err) {
    if (!sessionIsCurrent(sessionVersion, userID) || startedRouteVersion !== routeVersion) return false;
    state.taskMutationError = { taskID: id, message: err.message };
    if (state.selectedTask?.id === id) {
      state.error = err.message;
      syncTaskDetailError();
      return false;
    }
    if (state.selectedTask) return false;
    state.error = err.message;
    render();
    return false;
  }
  if (!updated || !sessionIsCurrent(sessionVersion, userID)) return false;
  reconcileTaskMutation(updated, previousTask);
  clearTaskMutationError(id);
  await refreshAfterTaskMutation(startedRouteVersion);
  return true;
}

async function runMutation(request, refresh) {
  const sessionVersion = authVersion;
  const startedRouteVersion = routeVersion;
  const contextIsCurrent = () => sessionVersion === authVersion && startedRouteVersion === routeVersion;
  try {
    const result = await request();
    if (result === null) return false;
    if (!contextIsCurrent()) return false;
    state.error = "";
  } catch (err) {
    if (!contextIsCurrent()) return false;
    state.error = err.message;
  }
  if (!contextIsCurrent()) return false;
  await refresh();
  return true;
}

function clearDropMarks() {
  document.querySelectorAll(".drop-before, .drop-after, .drop-into, .drop-before-bucket, .drop-after-bucket").forEach(el => {
    el.classList.remove("drop-before", "drop-after", "drop-into", "drop-before-bucket", "drop-after-bucket");
  });
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
      : state.agents.length;
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
  const loadVersion = (agentDetailLoadVersions.get(agentID) || 0) + 1;
  agentDetailLoadVersions.set(agentID, loadVersion);
  const loadIsCurrent = () => agentDetailLoadVersions.get(agentID) === loadVersion
    && sessionIsCurrent(sessionVersion, userID)
    && (expectedRouteVersion === undefined || expectedRouteVersion === routeVersion);
  const requests = [api.get(`/api/v1/agents/${encodeURIComponent(agentID)}`)];
  if (options.includeWorkPage) {
    requests.push(api.get(`/api/v1/agents/${encodeURIComponent(agentID)}/work?page=${options.page || 1}&pageSize=50`));
  }
  let detail;
  let workPage;
  try {
    [detail, workPage] = await Promise.all(requests);
  } catch (err) {
    if (!loadIsCurrent()) return false;
    throw err;
  }
  if (!loadIsCurrent()) return false;
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
    state.activeAgents = state.agents.length;
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
  const route = parseRoute(location.pathname);
  const expectedRouteVersion = routeVersion;
  if (route.name === "workspace") {
    const [listsLoaded, workspaceLoaded] = await Promise.all([
      loadWorkspaceListIndex(expectedRouteVersion),
      loadWorkspace(route, expectedRouteVersion),
    ]);
    if (!listsLoaded || !workspaceLoaded || expectedRouteVersion !== routeVersion) return false;
    state.workspaceRefreshOnDetailClose = false;
  } else {
    if (!await loadBoards(state.board?.id, expectedRouteVersion) || expectedRouteVersion !== routeVersion) return false;
  }
  renderPreservingCurrentTaskDetail();
  return true;
}

function findTask(id) {
  const workspaceTask = state.workspaceTasks.find(task => task.id === id) || state.selectedSubtasks.find(task => task.id === id);
  if (workspaceTask) return workspaceTask;
  for (const list of state.board?.buckets || []) {
    const task = (list.tasks || []).find(t => t.id === id);
    if (task) return task;
  }
  const agentTask = (state.agentWorkPage?.items || []).find(task => task.id === id)
    || ["ready", "working", "review", "recentlyCompleted"]
      .flatMap(group => state.agentDetail?.work?.[group] || [])
      .find(task => task.id === id);
  if (agentTask) return agentTask;
  if (state.selectedTask?.id === id) return state.selectedTask;
  return null;
}

function dateKey(date) {
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function formatTaskDate(value) {
  return parseDateKey(value).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
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
  if (taskHistoryReturnPath && currentLocationPath() === taskHistoryReturnPath) {
    taskHistoryReturnPath = "";
    return;
  }
  taskHistoryReturnPath = "";
  const nextRoute = parseRoute(location.pathname);
  clearSettingsCredentialsLeaving(nextRoute.settingsPage || "");
  clearAgentCredentialLeaving(nextRoute);
  await applyRoute();
});

boot();
