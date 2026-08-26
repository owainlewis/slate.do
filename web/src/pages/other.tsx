import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertCircle, Archive, Bot, CheckCircle2, ChevronLeft, Circle, Clipboard, Clock3, Copy, Inbox as InboxIcon, LoaderCircle, Moon, Play, Plus, RefreshCw, Server, Settings, Sun, Workflow } from "lucide-react"
import { Link, NavLink, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input, Label, Select, Textarea } from "@/components/ui/field"
import { TaskDetail } from "@/components/task-detail"
import { useApp, initials } from "@/app-context"
import { api } from "@/lib/api"
import { availableAgentHandle, buildAssignees, mentionHandle } from "@/lib/assignees"
import type { Agent, Entry, Task, User } from "@/lib/types"

function PageHeader({ title, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return <header className="page-header"><div className="page-heading"><h1>{title}</h1></div>{actions && <div className="page-actions">{actions}</div>}</header>
}

export function InboxPage() {
  const navigate = useNavigate()
  const query = useQuery({ queryKey: ["inbox"], queryFn: () => api.get<{ messages: Array<Entry & { taskId: string; taskTitle: string; body: string }>; nextCursor?: string }>("/api/v1/inbox") })
  const reviewQuery = useQuery({ queryKey: ["inbox-review"], queryFn: () => api.get<{ tasks: Task[] }>("/api/v1/tasks?status=needs_review&limit=100&topLevel=true"), refetchInterval: 5_000 })
  const reviewTasks = reviewQuery.data?.tasks || []
  const messages = query.data?.messages || []
  const isPending = query.isPending || reviewQuery.isPending
  const error = query.error || reviewQuery.error
  return <div className="page-wrap"><PageHeader title="Inbox" />{isPending ? <div className="loading-page"><div className="spinner" /></div> : error ? <p className="status-message error" role="alert">{error.message}</p> : reviewTasks.length || messages.length ? <div className="inbox-stack">{reviewTasks.length > 0 && <section><div className="section-title-row"><div><h2>Needs your review</h2><span>{reviewTasks.length}</span></div><p>Agent work pauses here until you approve it.</p></div><div className="surface-card">{reviewTasks.map(task => <button type="button" className="inbox-row inbox-review-row w-full text-left" key={task.id} onClick={() => navigate(`/app/tasks/${encodeURIComponent(task.id)}`)}><div className="operation-leading"><span className="operation-icon review"><AlertCircle /></span><div><strong>{task.title}</strong><p>{task.reviewReason || `Review the latest output from ${task.assigneeAgentName || "this agent"}.`}</p></div></div><div className="operation-tail"><span>{task.assigneeAgentName || "Agent"}</span><ChevronLeft /></div></button>)}</div></section>}{messages.length > 0 && <section><div className="section-title-row"><div><h2>Agent updates</h2><span>{messages.length}</span></div></div><div className="surface-card">{messages.map(message => <button type="button" className="inbox-row w-full text-left" key={message.id} data-inbox-task={message.taskId} onClick={() => navigate(`/app/tasks/${encodeURIComponent(message.taskId)}`)}><div><div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><Bot className="size-3.5" />{message.authorName || "Agent"} · {message.kind}</div><strong className="text-sm">{message.taskTitle}</strong><p className="mt-1 max-w-3xl text-xs leading-6 text-muted-foreground">{message.body}</p></div><ChevronLeft className="size-4 rotate-180 text-muted-foreground" /></button>)}</div></section>}</div> : <div className="empty-state"><div><InboxIcon /><h2 className="font-sans text-2xl font-semibold text-foreground">Your inbox is clear.</h2><p>Work that needs your attention will appear here.</p></div></div>}</div>
}

const settingsPages = [
  { id: "profile", label: "Profile", title: "Profile" },
  { id: "preferences", label: "Preferences", title: "Preferences" },
  { id: "api", label: "API access", title: "API access" },
]

export function SettingsPage() {
  const { page = "profile" } = useParams()
  const current = settingsPages.find(item => item.id === page) || settingsPages[0]
  return <div className="page-wrap"><PageHeader title="Settings" /><nav className="settings-tabs" aria-label="Settings sections" role="tablist">{settingsPages.map(item => <NavLink key={item.id} to={`/app/settings/${item.id}`} className={({ isActive }) => `settings-tab ${isActive ? "active" : ""}`} role="tab">{item.label}</NavLink>)}</nav><div className="mb-5"><h2 className="text-lg font-semibold">{current.title}</h2></div>{current.id === "profile" ? <ProfileSettings /> : current.id === "preferences" ? <PreferenceSettings /> : <APISettings />}</div>
}

function ProfileSettings() {
  const { me, updateMe } = useApp()
  const [name, setName] = React.useState(me.displayName || me.email.split("@")[0])
  const [notice, setNotice] = React.useState("")
  const save = useMutation({ mutationFn: () => api.patch<User>("/api/v1/me", { displayName: name.trim() }), onSuccess: user => { updateMe({ ...me, ...user }); setNotice("Profile saved.") }, onError: error => setNotice(error instanceof Error ? error.message : "Could not save profile") })
  const reset = useMutation({ mutationFn: () => api.post<{ message?: string }>("/api/v1/auth/password-reset/request", { email: me.email }), onSuccess: data => setNotice(data.message || "Reset link sent."), onError: error => setNotice(error instanceof Error ? error.message : "Could not send reset link") })
  return <form id="profile-form" className="settings-card surface-card" onSubmit={event => { event.preventDefault(); if (name.trim()) save.mutate() }}><div className="settings-row"><div className="settings-copy"><strong>Avatar</strong><span>Generated locally from your account ID.</span></div><div className="avatar size-12 text-sm">{initials(me.displayName || me.email)}</div></div><div className="settings-row"><label className="settings-copy" htmlFor="profile-display-name"><strong>Display name</strong><span>Used anywhere Slate identifies you. Tasks mention you as @{mentionHandle(name.trim().split(/\s+/)[0] || me.email.split("@")[0])}.</span></label><Input id="profile-display-name" value={name} onChange={event => setName(event.target.value)} maxLength={80} required /></div><div className="settings-row"><div className="settings-copy"><strong>Account email</strong><span>Your sign-in address cannot be changed here.</span></div><span className="text-sm">{me.email}</span></div><div className="settings-row"><div className="settings-copy"><strong>Password</strong><span>Send a secure reset link to your account email.</span></div><Button id="request-password-reset" type="button" variant="secondary" onClick={() => reset.mutate()} disabled={reset.isPending}>{reset.isPending ? "Sending…" : "Send reset link"}</Button></div>{notice && <p className={`status-message mt-3 ${save.isError || reset.isError ? "error" : ""}`}>{notice}</p>}<div className="mt-4 flex justify-end"><Button type="submit" disabled={save.isPending || !name.trim()}>{save.isPending ? "Saving…" : "Save profile"}</Button></div></form>
}

function PreferenceSettings() {
  const { me, updateMe } = useApp()
  const [notice, setNotice] = React.useState("")
  const theme = me.theme === "light" ? "light" : "dark"
  const update = useMutation({ mutationFn: (value: "light" | "dark") => api.patch<User>("/api/v1/me", { theme: value }), onSuccess: (user, value) => { updateMe({ ...me, ...user, theme: value }); setNotice("Preference saved.") }, onError: error => setNotice(error instanceof Error ? error.message : "Could not save preference") })
  return <section className="settings-card surface-card"><div className="settings-row"><div className="settings-copy"><strong>Appearance</strong><span>Slate follows this choice on every screen.</span></div><div className="view-toggle w-fit" role="group" aria-label="Theme preference"><button type="button" className={theme === "light" ? "active" : ""} aria-pressed={theme === "light"} onClick={() => update.mutate("light")}><Sun className="size-3.5" />Light</button><button type="button" className={theme === "dark" ? "active" : ""} aria-pressed={theme === "dark"} onClick={() => update.mutate("dark")}><Moon className="size-3.5" />Dark</button></div></div>{notice && <p className={`status-message mt-3 ${update.isError ? "error" : ""}`}>{notice}</p>}</section>
}

interface APIToken { id: string; name: string }
function APISettings() {
  const queryClient = useQueryClient()
  const [name, setName] = React.useState("")
  const [newToken, setNewToken] = React.useState("")
  const [notice, setNotice] = React.useState("")
  const query = useQuery({ queryKey: ["api-tokens"], queryFn: () => api.get<{ tokens: APIToken[] }>("/api/v1/api-tokens") })
  const create = useMutation({ mutationFn: () => api.post<{ token: string }>("/api/v1/api-tokens", { name: name.trim() }), onSuccess: async data => { setNewToken(data.token); setName(""); await queryClient.invalidateQueries({ queryKey: ["api-tokens"] }) }, onError: error => setNotice(error instanceof Error ? error.message : "Could not create token") })
  const revoke = useMutation({ mutationFn: (id: string) => api.del(`/api/v1/api-tokens/${encodeURIComponent(id)}`), onSuccess: async () => { setNotice("Personal token revoked."); await queryClient.invalidateQueries({ queryKey: ["api-tokens"] }) }, onError: error => setNotice(error instanceof Error ? error.message : "Could not revoke token") })
  return <div className="max-w-[850px] space-y-5"><section><div className="mb-3"><h2 className="font-semibold">Personal API tokens</h2><p className="mt-1 text-sm text-muted-foreground">Use these tokens for your own CLI and API access.</p></div><div className="surface-card p-4"><form id="token-form" className="flex gap-2" onSubmit={event => { event.preventDefault(); if (name.trim()) create.mutate() }}><Input id="token-name" name="name" value={name} onChange={event => setName(event.target.value)} placeholder="For example, laptop CLI" required /><Button type="submit" disabled={!name.trim() || create.isPending}>{create.isPending ? "Creating…" : "Create token"}</Button></form>{newToken && <div className="mt-4 rounded-xl border border-primary/30 bg-accent p-4"><strong className="text-sm">Copy this token now</strong><p className="mt-1 text-xs text-muted-foreground">Slate cannot show it again after you leave this page.</p><div className="mt-3 flex gap-2"><code id="personal-token" className="min-w-0 flex-1 overflow-auto rounded-lg bg-background p-3 text-xs">{newToken}</code><Button id="copy-personal-token" variant="secondary" size="icon" onClick={() => navigator.clipboard.writeText(newToken)}><Copy className="size-4" /></Button></div></div>}<div className="mt-3">{query.isPending ? <div className="p-4 text-sm text-muted-foreground">Loading tokens…</div> : (query.data?.tokens || []).length ? query.data!.tokens.map(token => <div className="token-row" key={token.id}><span><strong className="block text-sm">{token.name}</strong><small className="text-muted-foreground">Personal token</small></span><Button variant="ghost" className="text-destructive" onClick={() => { if (window.confirm("Revoke this personal token? Any client using it will lose access.")) revoke.mutate(token.id) }}>Revoke</Button></div>) : <div className="p-4 text-sm text-muted-foreground">No active personal tokens.</div>}</div>{notice && <p className={`status-message mt-3 ${create.isError || revoke.isError ? "error" : ""}`}>{notice}</p>}</div></section><section><h2 className="font-semibold">Agent credentials</h2><p className="mt-1 text-sm text-muted-foreground">Each agent has a separate identity limited to assigned work.</p><Button className="mt-3" asChild variant="secondary"><Link to="/app/agents"><Bot className="size-4" />Manage agents</Link></Button></section></div>
}

export function AgentsPage() {
  const { agents, assignees, maxAgents } = useApp()
  return <div className="page-wrap"><PageHeader title="Agents" actions={<Button asChild disabled={agents.filter(agent => !agent.archived).length >= maxAgents}><Link to="/app/agents/new"><Plus className="size-4" />New agent</Link></Button>} />{agents.length ? <section className="surface-card">{agents.map(agent => { const assignee = assignees.find(item => item.kind === "agent" && item.id === agent.id); return <Link to={`/app/agents/${encodeURIComponent(agent.id)}`} className="agent-row" data-agent-link={agent.id} key={agent.id}><div className="agent-name"><div className="avatar">{initials(agent.displayName)}</div><span><strong>{agent.displayName}</strong><small>{assignee ? `@${assignee.handle}` : `@${mentionHandle(agent.displayName, "agent")}`}{agent.purpose ? ` · ${agent.purpose}` : ""}</small></span></div><div className="flex items-center gap-3 text-xs text-muted-foreground"><span>{Object.values(agent.workCounts || {}).reduce<number>((sum, value) => sum + Number(value || 0), 0)} tasks</span><ChevronLeft className="size-4 rotate-180" /></div></Link> })}</section> : <div className="empty-state"><div><Bot /><h2 className="font-sans text-2xl font-semibold text-foreground">Bring your first agent.</h2><p>Create an agent identity, then assign work from any task.</p><Button className="mt-4" asChild><Link to="/app/agents/new">Create agent</Link></Button></div></div>}</div>
}

export function NewAgentPage() {
  const { me, agents, assignees, refreshAgents } = useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = React.useState("")
  const [purpose, setPurpose] = React.useState("")
  const [result, setResult] = React.useState<{ agent: Agent; token: string; handle: string } | null>(null)
  const previewHandle = availableAgentHandle(name, assignees)
  const create = useMutation({ mutationFn: () => api.post<Agent & { token: string }>("/api/v1/agents", { displayName: name.trim(), purpose: purpose.trim() }), onSuccess: async data => { const { token, ...agent } = data; await refreshAgents(); const refreshed = queryClient.getQueryData<{ agents: Agent[] }>(["agents"]); const directory = buildAssignees(me, refreshed?.agents || [...agents, agent as Agent]); const handle = directory.find(assignee => assignee.kind === "agent" && assignee.id === agent.id)?.handle || availableAgentHandle(agent.displayName, assignees); setResult({ agent: agent as Agent, token, handle }) } })
  return <div className="page-wrap"><PageHeader title={result ? "Connect your agent" : "New agent"} description={result ? "Copy the credential now and finish the connection." : "Give this agent a clear identity and purpose."} />{result ? <section className="surface-card max-w-2xl p-6"><div className="agent-name"><div className="avatar size-12 text-sm">{initials(result.agent.displayName)}</div><span><small className="text-primary">Agent created · @{result.handle}</small><strong className="text-lg">{result.agent.displayName}</strong></span></div><div className="mt-6 rounded-xl border border-primary/30 bg-accent p-4"><strong>Copy this token now.</strong><p className="mt-1 text-xs text-muted-foreground">For security, Slate cannot show it again after you leave.</p><div className="mt-3 flex gap-2"><code id="agent-credential" className="min-w-0 flex-1 overflow-auto rounded-lg bg-background p-3 text-xs">{result.token}</code><Button id="copy-agent-credential" variant="secondary" onClick={() => navigator.clipboard.writeText(result.token)}><Copy className="size-4" />Copy</Button></div></div><ol className="mt-6 space-y-3 text-sm"><li><strong>1. Set the environment variable</strong><code className="mt-1 block rounded-lg bg-muted p-3 text-xs">export SLATE_API_TOKEN={result.token}</code></li><li><strong>2. Verify the connection</strong><code className="mt-1 block rounded-lg bg-muted p-3 text-xs">slate auth status</code></li><li><strong>3. Start a configured runner</strong><code className="mt-1 block rounded-lg bg-muted p-3 text-xs">slate watch --profile &lt;name&gt;</code></li></ol><div className="mt-6 flex justify-end"><Button onClick={() => navigate("/app/agents")}>Done</Button></div></section> : <form id="agent-create-form" className="surface-card max-w-2xl space-y-5 p-6" onSubmit={event => { event.preventDefault(); if (name.trim()) create.mutate() }}><div><Label htmlFor="agent-name">Name</Label><Input id="agent-name" value={name} onChange={event => setName(event.target.value)} maxLength={100} required /><p className="mt-1.5 text-xs text-muted-foreground">Mentioned as <strong>@{previewHandle}</strong>. Handles use lowercase letters, numbers and underscores.</p></div><div><Label htmlFor="agent-purpose">Purpose</Label><Textarea id="agent-purpose" value={purpose} onChange={event => setPurpose(event.target.value)} placeholder="What should this agent help with?" /></div>{create.isError && <p className="status-message error" role="alert">{create.error.message}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => navigate("/app/agents")}>Cancel</Button><Button type="submit" disabled={!name.trim() || create.isPending}>{create.isPending ? "Creating…" : "Create agent"}</Button></div></form>}</div>
}

interface AgentDetailResponse { agent: Agent; work?: { ready?: Task[]; working?: Task[]; review?: Task[]; recentlyCompleted?: Task[]; totals?: Record<string, number> } }
export function AgentDetailPage() {
  const { agentId = "", tab = "overview" } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [search] = useSearchParams()
  const taskId = search.get("task") || ""
  const query = useQuery({ queryKey: ["agent", agentId], queryFn: () => api.get<AgentDetailResponse>(`/api/v1/agents/${encodeURIComponent(agentId)}`) })
  const workPage = useQuery({ queryKey: ["agent-work", agentId, search.get("page") || "1"], queryFn: () => api.get<{ items: Task[]; total: number; page: number; hasNext?: boolean; hasPrevious?: boolean }>(`/api/v1/agents/${encodeURIComponent(agentId)}/work?page=${search.get("page") || "1"}&pageSize=50`), enabled: tab === "work" })
  if (query.isPending) return <div className="loading-page"><div className="spinner" /></div>
  if (query.isError) return <div className="page-wrap"><p className="status-message error" role="alert">{query.error.message}</p></div>
  const agent = query.data.agent
  const allWork = tab === "work" ? workPage.data?.items || [] : [...(query.data.work?.working || []), ...(query.data.work?.ready || []), ...(query.data.work?.review || []), ...(query.data.work?.recentlyCompleted || [])]
  const openTask = (id: string) => navigate(`${location.pathname}?task=${encodeURIComponent(id)}`)
  return <div className="page-wrap"><div className="mb-4"><Button variant="ghost" size="sm" onClick={() => navigate("/app/agents")}><ChevronLeft className="size-4" />Agents</Button></div><PageHeader title={agent.displayName} description={agent.purpose || undefined} actions={<Button asChild variant="secondary"><Link to={`/app/agents/${encodeURIComponent(agentId)}/settings`}><Settings className="size-4" />Settings</Link></Button>} /><div className="stat-grid">{[["Ready", query.data.work?.totals?.ready || 0], ["Working", query.data.work?.totals?.working || 0], ["Review", query.data.work?.totals?.review || 0], ["Completed", query.data.work?.totals?.completed || 0]].map(([label, value]) => <div className="stat-card surface-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><nav className="settings-tabs"><NavLink end to={`/app/agents/${encodeURIComponent(agentId)}`} className={({ isActive }) => `settings-tab ${isActive ? "active" : ""}`}>Overview</NavLink><NavLink to={`/app/agents/${encodeURIComponent(agentId)}/work`} className={({ isActive }) => `settings-tab ${isActive ? "active" : ""}`}>All work</NavLink><NavLink to={`/app/agents/${encodeURIComponent(agentId)}/settings`} className={({ isActive }) => `settings-tab ${isActive ? "active" : ""}`}>Settings</NavLink></nav>{tab === "settings" ? <AgentSettings agent={agent} /> : allWork.length ? <section className="surface-card">{allWork.map(task => <button key={task.id} className="agent-row w-full text-left" data-open-agent-task={task.id} onClick={() => openTask(task.id)}><div><strong className="text-sm">{task.title}</strong><p className="mt-1 text-xs text-muted-foreground">{task.bucketName || task.listName} · {task.status.replaceAll("_", " ")}</p></div><ChevronLeft className="size-4 rotate-180 text-muted-foreground" /></button>)}</section> : <div className="empty-state"><div><Clipboard /><h2 className="font-sans text-2xl font-semibold text-foreground">No work assigned</h2><p>Assign a task when you’re ready to put {agent.displayName} to work.</p></div></div>}{taskId && <TaskDetail taskId={taskId} onClose={() => navigate(location.pathname)} onOpenTask={openTask} />}</div>
}

function AgentSettings({ agent }: { agent: Agent }) {
  const { assignees, refreshAgents } = useApp()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = React.useState(agent.displayName)
  const [purpose, setPurpose] = React.useState(agent.purpose || "")
  const [credential, setCredential] = React.useState("")
  const [notice, setNotice] = React.useState("")
  const save = useMutation({ mutationFn: () => api.patch<Agent>(`/api/v1/agents/${encodeURIComponent(agent.id)}`, { displayName: name.trim(), purpose: purpose.trim() }), onSuccess: async () => { setNotice("Agent saved."); await Promise.all([queryClient.invalidateQueries({ queryKey: ["agent", agent.id] }), refreshAgents()]) } })
  const rotate = useMutation({ mutationFn: () => api.post<{ token: string }>(`/api/v1/agents/${encodeURIComponent(agent.id)}/credential/rotate`, { idempotencyKey: crypto.randomUUID() }), onSuccess: data => setCredential(data.token) })
  const remove = useMutation({ mutationFn: () => api.del(`/api/v1/agents/${encodeURIComponent(agent.id)}`), onSuccess: async () => { await refreshAgents(); navigate("/app/agents") } })
  const previewHandle = availableAgentHandle(name, assignees, `agent:${agent.id}`)
  return <div className="max-w-[850px] space-y-5"><form className="settings-card surface-card" onSubmit={event => { event.preventDefault(); if (name.trim()) save.mutate() }}><div className="settings-row"><div className="settings-copy"><strong>Name</strong><span>How this agent appears throughout Slate. Mentioned as @{previewHandle}.</span></div><Input value={name} onChange={event => setName(event.target.value)} /></div><div className="settings-row"><div className="settings-copy"><strong>Purpose</strong><span>The work this agent is best suited to handle.</span></div><Textarea value={purpose} onChange={event => setPurpose(event.target.value)} /></div>{notice && <p className="status-message mt-3">{notice}</p>}<div className="mt-4 flex justify-end"><Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save agent"}</Button></div></form><section className="settings-card surface-card"><div className="settings-row"><div className="settings-copy"><strong>Credential</strong><span>Rotate the connection token if it may have been exposed.</span></div><Button variant="secondary" onClick={() => rotate.mutate()} disabled={rotate.isPending}><RefreshCw className="size-4" />{rotate.isPending ? "Rotating…" : "Rotate credential"}</Button></div>{credential && <div className="mt-3 rounded-xl bg-accent p-4"><strong className="text-sm">Copy the replacement token now</strong><div className="mt-2 flex gap-2"><code className="min-w-0 flex-1 overflow-auto rounded-lg bg-background p-3 text-xs">{credential}</code><Button variant="secondary" size="icon" onClick={() => navigator.clipboard.writeText(credential)}><Copy className="size-4" /></Button></div></div>}</section><section className="settings-card surface-card border-destructive/25"><div className="settings-row"><div className="settings-copy"><strong className="text-destructive">Archive agent</strong><span>Remove this identity from active use. Existing tasks remain.</span></div><Button variant="destructive" onClick={() => { if (window.confirm(`Archive ${agent.displayName}?`)) remove.mutate() }} disabled={remove.isPending}><Archive className="size-4" />{remove.isPending ? "Archiving…" : "Archive"}</Button></div></section></div>
}

function relativeTime(value?: string) {
  if (!value) return "Never"
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return "Unknown"
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
  if (seconds < 60) return "Just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const runStatus = {
  queued: { label: "Queued", Icon: Clock3, tone: "queued" },
  working: { label: "Running", Icon: LoaderCircle, tone: "working" },
  needs_review: { label: "Needs review", Icon: AlertCircle, tone: "review" },
  done: { label: "Completed", Icon: CheckCircle2, tone: "done" },
  new: { label: "Unassigned", Icon: Circle, tone: "new" },
} satisfies Record<Task["status"], { label: string; Icon: React.ComponentType<{ className?: string }>; tone: string }>

export function RunsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [search] = useSearchParams()
  const taskId = search.get("task") || ""
  const query = useQuery({ queryKey: ["runs-overview"], queryFn: () => api.get<{ tasks: Task[] }>("/api/v1/tasks?limit=200&topLevel=true"), refetchInterval: 5_000 })
  const tasks = (query.data?.tasks || []).filter(task => task.assigneeAgentId && task.status !== "new").sort((a, b) => {
    const order: Record<Task["status"], number> = { working: 0, needs_review: 1, queued: 2, done: 3, new: 4 }
    return order[a.status] - order[b.status] || String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
  })
  const count = (status: Task["status"]) => tasks.filter(task => task.status === status).length
  const openTask = (id: string) => navigate(`${location.pathname}?task=${encodeURIComponent(id)}`)
  return <div className="page-wrap"><PageHeader title="Runs" actions={<Button variant="secondary" onClick={() => query.refetch()} disabled={query.isFetching}><RefreshCw className={`size-4 ${query.isFetching ? "animate-spin" : ""}`} />Refresh</Button>} />{query.isPending ? <div className="loading-page"><div className="spinner" /></div> : query.isError ? <p className="status-message error" role="alert">{query.error.message}</p> : <><div className="stat-grid run-stats">{[["Running", count("working")], ["Queued", count("queued")], ["Review", count("needs_review")], ["Completed", count("done")]].map(([label, value]) => <div className="stat-card surface-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>{tasks.length ? <section className="surface-card operations-list">{tasks.map(task => { const status = runStatus[task.status]; const Icon = status.Icon; return <button type="button" className="operation-row" key={task.id} onClick={() => openTask(task.id)}><div className="operation-leading"><span className={`operation-icon ${status.tone}`}><Icon /></span><div><strong>{task.title}</strong><p>{task.assigneeAgentName || "Agent"}{task.bucketName || task.listName ? ` · ${task.bucketName || task.listName}` : ""}</p></div></div><div className="operation-tail"><span className={`status-chip ${status.tone}`}>{status.label}</span><time>{relativeTime(task.updatedAt)}</time><ChevronLeft /></div></button>})}</section> : <div className="empty-state"><div><Play /><h2 className="font-sans text-2xl font-semibold text-foreground">No agent runs yet</h2><p>Assign a task to an agent to queue work for a connected runner.</p><Button className="mt-4" asChild><Link to="/app/tasks">Open tasks</Link></Button></div></div>}</>}{taskId && <TaskDetail taskId={taskId} onClose={() => navigate(location.pathname)} onOpenTask={openTask} />}</div>
}

export function RunnersPage() {
  const { agents } = useApp()
  const activeAgents = agents.filter(agent => !agent.archived)
  const recentlyActive = activeAgents.filter(agent => { const value = agent.credential?.lastUsedAt || agent.lastUsedAt; return value && Date.now() - new Date(value).getTime() < 15 * 60 * 1000 }).length
  return <div className="page-wrap"><PageHeader title="Runners" actions={<Button asChild><Link to="/app/agents/new"><Plus className="size-4" />Connect agent</Link></Button>} /><section className="runner-callout surface-card"><div className="operation-leading"><span className="operation-icon working"><Server /></span><div><strong>Hosted coordination, local execution</strong><p>Slate queues and reviews the work. Your connected runner executes it from your own machine or environment.</p></div></div><code>slate watch --profile &lt;name&gt;</code></section><div className="stat-grid runner-stats"><div className="stat-card surface-card"><span>Identities</span><strong>{activeAgents.length}</strong></div><div className="stat-card surface-card"><span>Recently active</span><strong>{recentlyActive}</strong></div><div className="stat-card surface-card"><span>Not recently active</span><strong>{activeAgents.length - recentlyActive}</strong></div></div>{activeAgents.length ? <section className="surface-card operations-list">{activeAgents.map(agent => { const lastUsedAt = agent.credential?.lastUsedAt || agent.lastUsedAt; const recent = Boolean(lastUsedAt && Date.now() - new Date(lastUsedAt).getTime() < 15 * 60 * 1000); const workCount = Object.values(agent.workCounts || {}).reduce<number>((sum, value) => sum + Number(value || 0), 0); return <Link to={`/app/agents/${encodeURIComponent(agent.id)}`} className="operation-row runner-row" key={agent.id}><div className="operation-leading"><span className={`operation-icon ${recent ? "done" : "new"}`}><Workflow /></span><div><strong>{agent.displayName}</strong><p>{agent.purpose || "No purpose set"}</p></div></div><div className="operation-tail runner-tail"><span className={`status-chip ${recent ? "done" : "new"}`}>{recent ? "Recently active" : lastUsedAt ? "Inactive" : "Not connected"}</span><span>{workCount} tasks</span><time>{lastUsedAt ? relativeTime(lastUsedAt) : agent.credential?.tokenPrefix || "Credential ready"}</time><ChevronLeft /></div></Link>})}</section> : <div className="empty-state"><div><Workflow /><h2 className="font-sans text-2xl font-semibold text-foreground">Connect your first runner</h2><p>Create an agent identity, then use its credential with the Slate CLI.</p><Button className="mt-4" asChild><Link to="/app/agents/new">Create agent</Link></Button></div></div>}</div>
}
