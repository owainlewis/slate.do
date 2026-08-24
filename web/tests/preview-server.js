const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const dist = path.resolve(__dirname, "../../server/internal/web/dist");
const lists = [
  { id: "inbox", name: "Inbox", goal: "Capture now", isInbox: true, openCount: 2 },
  { id: "product", name: "Product", goal: "Make Slate feel inevitable", isInbox: false, openCount: 5 },
  { id: "company", name: "Company", goal: "Build a durable business", isInbox: false, openCount: 3 },
  { id: "writing", name: "Writing", goal: "Publish ideas worth keeping", isInbox: false, openCount: 4 },
];
const agents = [
  { id: "research", displayName: "Research agent", purpose: "Find evidence and turn it into decisions", workCounts: { ready: 2, working: 1, review: 1, completed: 8 } },
  { id: "editor", displayName: "Editorial agent", purpose: "Shape clear, useful writing", workCounts: { ready: 1, working: 1, review: 0, completed: 12 } },
];
const tasks = [
  { id: "react", bucketId: "product", bucketName: "Product", listName: "Product", title: "Ship the React workspace", description: "Replace the global renderer with a calm, component-led interface.", status: "working", priority: "p0", scheduledDate: "2026-08-18", assigneeAgentId: "research", assigneeAgentName: "Research agent" },
  { id: "onboarding", bucketId: "product", bucketName: "Product", listName: "Product", title: "Tighten first-run onboarding", description: "Help a new operator understand lists, agents and flow in under two minutes.", status: "new", priority: "p1", scheduledDate: "2026-08-21", assigneeAgentId: "", assigneeAgentName: "" },
  { id: "launch", bucketId: "company", bucketName: "Company", listName: "Company", title: "Plan September launch", description: "Turn the product story into a focused launch plan.", status: "queued", priority: "p0", scheduledDate: "2026-08-24", assigneeAgentId: "research", assigneeAgentName: "Research agent" },
  { id: "essay", bucketId: "writing", bucketName: "Writing", listName: "Writing", title: "Edit the agent-speed essay", description: "Make the core argument tighter and more concrete.", status: "needs_review", priority: "p1", scheduledDate: "2026-08-19", assigneeAgentId: "editor", assigneeAgentName: "Editorial agent" },
  { id: "metrics", bucketId: "company", bucketName: "Company", listName: "Company", title: "Review weekly product signals", description: "Decide what changed and what deserves attention next.", status: "done", priority: "p2", scheduledDate: "2026-08-17", assigneeAgentId: "", assigneeAgentName: "" },
  { id: "api", bucketId: "product", bucketName: "Product", listName: "Product", title: "Document task entries API", description: "Add examples for agent comments and outputs.", status: "new", priority: "p2", scheduledDate: "", assigneeAgentId: "editor", assigneeAgentName: "Editorial agent" },
  { id: "handoffs", bucketId: "product", bucketName: "Product", listName: "Product", title: "Audit agent handoff states", description: "Make every transition between people and agents explicit.", status: "working", priority: "p1", scheduledDate: "2026-08-22", assigneeAgentId: "research", assigneeAgentName: "Research agent" },
  { id: "brief", bucketId: "company", bucketName: "Company", listName: "Company", title: "Review the launch brief", description: "Resolve the final positioning questions before design starts.", status: "needs_review", priority: "p2", scheduledDate: "2026-08-23", assigneeAgentId: "", assigneeAgentName: "" },
  { id: "guide", bucketId: "writing", bucketName: "Writing", listName: "Writing", title: "Publish the operator guide", description: "Turn the approved draft into the final documentation page.", status: "done", priority: "p1", scheduledDate: "2026-08-18", assigneeAgentId: "editor", assigneeAgentName: "Editorial agent" },
];
const entries = { react: [{ id: "entry-1", kind: "comment", body: "The route and component architecture is in place. I’m checking the final interaction details now.", authorKind: "agent", authorName: "Research agent", createdAt: new Date().toISOString() }] };

function send(response, body, status = 200, type = "application/json") {
  response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  response.end(type === "application/json" ? JSON.stringify(body) : body);
}

async function input(request) { let body = ""; for await (const chunk of request) body += chunk; return JSON.parse(body || "{}"); }

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/capture.html") return send(response, `<!doctype html><html><head><meta charset="utf-8"><title>Slate capture</title><style>*{box-sizing:border-box}html,body{width:1706px;height:998px;margin:0;overflow:hidden;background:#fafafa}iframe{display:block;width:1846px;height:1080px;border:0;transform:scale(.92416);transform-origin:top left}</style></head><body><iframe src="/app/tasks" title="Slate"></iframe></body></html>`, 200, "text/html");
  if (url.pathname === "/api/v1/me" && request.method === "GET") return send(response, { authenticated: true, user: { id: "owner", email: "owain@slate.do", displayName: "Owain Lewis", theme: "light", entitlement: { plan: "pro", limits: { lists: 45, agents: 5, apiTokens: 10 } } } });
  if (url.pathname === "/api/v1/lists" && request.method === "GET") return send(response, { lists });
  if (url.pathname === "/api/v1/agents" && request.method === "GET") return send(response, { agents, maxAgents: 5 });
  if (url.pathname === "/api/v1/stats/summary" && request.method === "GET") return send(response, { activeTasks: 7, inProgress: 2, inReview: 2, completed24h: 2, runs24h: 2 });
  if (url.pathname === "/api/v1/inbox") return send(response, { messages: [{ id: "message", taskId: "react", taskTitle: "Ship the React workspace", kind: "output", body: "The interface is ready for your final review.", authorName: "Research agent" }] });
  if (url.pathname === "/api/v1/tasks" && request.method === "GET") {
    let result = [...tasks];
    const parent = url.searchParams.get("parentTaskId");
    if (parent) result = [];
    if (url.searchParams.get("bucketId")) result = result.filter(task => task.bucketId === url.searchParams.get("bucketId"));
    if (url.searchParams.get("q")) result = result.filter(task => `${task.title} ${task.description}`.toLowerCase().includes(url.searchParams.get("q").toLowerCase()));
    if (url.searchParams.get("priority")) result = result.filter(task => task.priority === url.searchParams.get("priority"));
    return send(response, { tasks: result });
  }
  if (url.pathname === "/api/v1/tasks" && request.method === "POST") { const data = await input(request); const task = { id: `task-${Date.now()}`, bucketId: "inbox", bucketName: "Inbox", status: "new", priority: "", scheduledDate: "", ...data }; tasks.unshift(task); return send(response, task, 201); }
  const taskMatch = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)(?:\/status)?$/);
  if (taskMatch && request.method === "GET") { const task = tasks.find(item => item.id === taskMatch[1]); return task ? send(response, task) : send(response, { error: "not found" }, 404); }
  if (taskMatch && request.method === "PATCH") { const task = tasks.find(item => item.id === taskMatch[1]); Object.assign(task, await input(request)); return send(response, task); }
  if (taskMatch && request.method === "DELETE") { const index = tasks.findIndex(item => item.id === taskMatch[1]); if (index >= 0) tasks.splice(index, 1); return send(response, {}); }
  const entryMatch = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/entries$/);
  if (entryMatch && request.method === "GET") return send(response, { entries: entries[entryMatch[1]] || [] });
  if (entryMatch && request.method === "POST") { const data = await input(request); const entry = { id: `entry-${Date.now()}`, ...data, authorName: "Owain Lewis", createdAt: new Date().toISOString() }; entries[entryMatch[1]] = [...(entries[entryMatch[1]] || []), entry]; return send(response, entry, 201); }
  if (url.pathname.match(/\/subtasks$/)) return request.method === "GET" ? send(response, { tasks: [] }) : send(response, { id: `sub-${Date.now()}`, ...(await input(request)), status: "new" }, 201);
  const agentMatch = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)$/);
  if (agentMatch) { const agent = agents.find(item => item.id === agentMatch[1]); const assigned = tasks.filter(task => task.assigneeAgentId === agent?.id); return send(response, { agent, work: { ready: assigned.filter(task => task.status === "queued"), working: assigned.filter(task => task.status === "working"), review: assigned.filter(task => task.status === "needs_review"), recentlyCompleted: assigned.filter(task => task.status === "done"), totals: agent?.workCounts || {} } }); }
  if (url.pathname === "/api/v1/api-tokens") return send(response, { tokens: [] });
  if (url.pathname.startsWith("/api/")) return send(response, {});
  const asset = url.pathname.slice(1);
  const target = url.pathname.startsWith("/assets/") || ["favicon.svg", "landing-stones.jpg", "landing-slabs.jpg", "landing-cinematic.jpg", "app-lists.jpg", "app-flow.jpg", "cli.html"].includes(asset) ? path.join(dist, asset) : path.join(dist, "index.html");
  const type = target.endsWith(".css") ? "text/css" : target.endsWith(".js") ? "text/javascript" : target.endsWith(".woff2") ? "font/woff2" : target.endsWith(".woff") ? "font/woff" : target.endsWith(".jpg") ? "image/jpeg" : target.endsWith(".svg") ? "image/svg+xml" : "text/html";
  return send(response, fs.readFileSync(target), 200, type);
});

const port = Number(process.env.SLATE_PREVIEW_PORT || 4173);
server.listen(port, "127.0.0.1", () => console.log(`Slate preview: http://127.0.0.1:${port}/app/tasks`));
