import * as React from "react"
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query"
import { Columns3 as BoardIcon, CalendarDays, List as ListIcon, MoreHorizontal, Plus, Rows3, Search, Trash2 } from "lucide-react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input, Select } from "@/components/ui/field"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { TaskDetail } from "@/components/task-detail"
import { TaskDeleteDialog } from "@/components/task-delete-dialog"
import { PriorityBadge, priorityLabel } from "@/components/priority"
import { useApp, initials } from "@/app-context"
import { api } from "@/lib/api"
import { workspaceSummaryQueryKey, workspaceSummaryQueryKeyFor, type Task, type TaskStatus, type WorkspaceSummary } from "@/lib/types"

const columns: Array<{ value: TaskStatus; label: string; statuses: TaskStatus[]; className: string }> = [
  { value: "new", label: "Todo", statuses: ["new", "queued"], className: "" },
  { value: "working", label: "In Progress", statuses: ["working"], className: "working" },
  { value: "needs_review", label: "Review", statuses: ["needs_review"], className: "review" },
  { value: "done", label: "Done", statuses: ["done"], className: "done" },
]

const statusName = (value: string) => columns.find(column => column.statuses.includes(value as TaskStatus))?.label || value
type TasksPage = { tasks: Task[]; nextCursor?: string }

type DeleteTarget = { task: Task; returnFocus: HTMLButtonElement | null }

function TaskCard({ task, onOpen, onMove, onDelete }: { task: Task; onOpen: () => void; onMove: (status: TaskStatus) => void; onDelete: (returnFocus: HTMLButtonElement | null) => void }) {
  const actionsTrigger = React.useRef<HTMLButtonElement>(null)
  return (
    <div className="task-card group" draggable data-task={task.id} onDragStart={event => { event.dataTransfer.setData("text/task-id", task.id); event.dataTransfer.effectAllowed = "move" }} onDoubleClick={onOpen}>
      <button type="button" className="w-full text-left" data-open-task={task.id} aria-label={`Open task: ${task.title}`} onClick={onOpen}>
        <span className="task-card-kicker"><PriorityBadge priority={task.priority} compact /><span>{task.listName || task.bucketName || "Inbox"}</span></span>
        <span className="task-title">{task.title}</span>
        {task.description && <span className="task-description">{task.description}</span>}
        <span className="task-meta">
          {task.scheduledDate && <span className="pill"><CalendarDays className="size-3" />{new Date(`${task.scheduledDate}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
          {task.assigneeAgentName && <span className="task-agent"><span className="mini-avatar">{initials(task.assigneeAgentName)}</span>{task.assigneeAgentName}</span>}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button ref={actionsTrigger} type="button" className="absolute right-1.5 top-1.5 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 focus:opacity-100" aria-label={`Actions for ${task.title}`}><MoreHorizontal className="size-3.5" /></button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Move to</DropdownMenuLabel>
          {columns.map(column => <DropdownMenuItem key={column.value} onSelect={() => onMove(column.value)}>{column.label}</DropdownMenuItem>)}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive" onSelect={() => onDelete(actionsTrigger.current)}><Trash2 className="size-4" />Delete task</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function TaskTableActions({ task, onDelete }: { task: Task; onDelete: (returnFocus: HTMLButtonElement | null) => void }) {
  const actionsTrigger = React.useRef<HTMLButtonElement>(null)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button ref={actionsTrigger} type="button" variant="ghost" size="icon" aria-label={`Actions for ${task.title}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Task options</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive" onSelect={() => onDelete(actionsTrigger.current)}><Trash2 className="size-4" />Delete task</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function WorkspaceSummaryStrip({ summary }: { summary: WorkspaceSummary }) {
  const items = [
    ["Active tasks", summary.activeTasks],
    ["In progress", summary.inProgress],
    ["In review", summary.inReview],
    ["Completed · 24h", summary.completed24h],
    ["Runs · 24h", summary.runs24h],
  ] as const
  return <section className="workspace-summary surface-card" aria-label="Workspace summary">{items.map(([label, value]) => <div className="workspace-summary-item" key={label}><strong>{value}</strong><span>{label}</span></div>)}</section>
}

export function WorkspacePage() {
  const { listId = "", taskId = "" } = useParams()
  const { me, lists, agents, refreshLists } = useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [dragOver, setDragOver] = React.useState<TaskStatus | "">("")
  const [pageError, setPageError] = React.useState("")
  const [deleteTarget, setDeleteTarget] = React.useState<DeleteTarget | null>(null)
  const selectedList = lists.find(list => list.id === listId)
  const scope = listId ? "list" : "all"
  const layout = searchParams.get("view") === "table" ? "table" : "board"

  const taskQueryString = React.useMemo(() => {
    const query = new URLSearchParams({ limit: "200", topLevel: "true" })
    if (listId) query.set("bucketId", listId)
    for (const key of ["q", "status", "priority", "assigneeAgentId", "plannedFrom", "plannedTo"]) {
      const value = searchParams.get(key)
      if (value) query.set(key, value)
    }
    return query.toString()
  }, [listId, searchParams])

  const tasksQuery = useInfiniteQuery({
    queryKey: ["tasks", scope, listId, taskQueryString],
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams(taskQueryString)
      if (pageParam) query.set("cursor", pageParam)
      return api.get<TasksPage>(`/api/v1/tasks?${query}`)
    },
    initialPageParam: "",
    getNextPageParam: page => page.nextCursor || undefined,
  })
  const tasks = tasksQuery.data?.pages.flatMap(page => page.tasks) || []

  const summaryQuery = useQuery({
    queryKey: workspaceSummaryQueryKeyFor(me.id),
    queryFn: () => api.get<WorkspaceSummary>("/api/v1/stats/summary"),
    staleTime: Infinity,
    retry: false,
  })

  const refresh = async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: ["tasks"] }), queryClient.invalidateQueries({ queryKey: workspaceSummaryQueryKey }), refreshLists()])
  }
  const moveTask = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => api.patch<Task>(`/api/v1/tasks/${encodeURIComponent(id)}/status`, { status }),
    onMutate: ({ id, status }) => {
      queryClient.setQueriesData<InfiniteData<TasksPage, string>>({ queryKey: ["tasks"] }, old => old ? { ...old, pages: old.pages.map(page => ({ ...page, tasks: page.tasks.map(task => task.id === id ? { ...task, status } : task) })) } : old)
    },
    onSuccess: refresh,
    onError: error => { setPageError(error instanceof Error ? error.message : "Could not update task"); void refresh() },
  })
  const deleteTask = useMutation({
    mutationFn: (id: string) => api.del(`/api/v1/tasks/${encodeURIComponent(id)}`),
    onSuccess: async () => { await refresh(); setPageError(""); setDeleteTarget(null) },
    onError: error => setPageError(error instanceof Error ? error.message : "Could not delete task"),
  })
  const renameList = useMutation({
    mutationFn: (name: string) => api.patch(`/api/v1/lists/${encodeURIComponent(listId)}`, { name: name.trim() }),
    onSuccess: refreshLists,
    onError: error => setPageError(error instanceof Error ? error.message : "Could not rename list"),
  })
  const removeList = useMutation({
    mutationFn: () => api.del(`/api/v1/lists/${encodeURIComponent(listId)}`),
    onSuccess: async () => { await Promise.all([refreshLists(), queryClient.invalidateQueries({ queryKey: workspaceSummaryQueryKey })]); navigate("/app/tasks") },
    onError: error => setPageError(error instanceof Error ? error.message : "Could not delete list"),
  })

  const updateFilter = (name: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(name, value); else next.delete(name)
    setSearchParams(next, { replace: true })
  }
  const switchLayout = (value: "board" | "table") => updateFilter("view", value === "table" ? "table" : "")
  const openTask = (id: string) => navigate(`${listId ? `/app/lists/${encodeURIComponent(listId)}` : "/app"}/tasks/${encodeURIComponent(id)}${searchParams.toString() ? `?${searchParams}` : ""}`)

  if (listId && !selectedList && !tasksQuery.isPending) return <div className="page-wrap"><div className="empty-state"><div><ListIcon /><h1 className="font-serif text-3xl text-foreground">List not found</h1><p>This list is no longer available.</p><Button className="mt-4" onClick={() => navigate("/app/tasks")}>Open all tasks</Button></div></div></div>

  return (
    <div className="page-wrap task-shell">
      <header className="page-header">
        <div className="page-heading">
          {selectedList && !selectedList.isInbox ? <input key={selectedList.id} className="page-title-input max-w-xl" aria-label="List name" data-bucket-name={selectedList.id} defaultValue={selectedList.name} onBlur={event => { if (event.target.value.trim() && event.target.value.trim() !== selectedList.name) renameList.mutate(event.target.value) }} /> : <h1>{selectedList?.name || "All tasks"}</h1>}
        </div>
        <div className="page-actions">{selectedList && !selectedList.isInbox && <DropdownMenu><DropdownMenuTrigger asChild><Button id="workspace-list-actions" variant="ghost" size="icon" aria-label="List actions"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>List options</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuItem id="delete-workspace-list" className="text-destructive focus:bg-destructive/10 focus:text-destructive" disabled={removeList.isPending} onSelect={() => { if (window.confirm(`Delete “${selectedList.name}” and every task in it?`)) removeList.mutate() }}><Trash2 className="size-4" />{removeList.isPending ? "Deleting…" : "Delete list"}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}</div>
      </header>
      {summaryQuery.data && <WorkspaceSummaryStrip summary={summaryQuery.data} />}
      <div className="toolbar">
        <div className="filters" role="search">
          <div className="search-box"><Search /><Input aria-label="Search tasks" placeholder="Search tasks…" value={searchParams.get("q") || ""} onChange={event => updateFilter("q", event.target.value)} /></div>
          {agents.length > 0 && <Select className="compact-select" aria-label="Filter by agent" value={searchParams.get("assigneeAgentId") || ""} onChange={event => updateFilter("assigneeAgentId", event.target.value)}><option value="">Any agent</option>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.displayName}</option>)}</Select>}
          <Select className="compact-select" aria-label="Filter by priority" value={searchParams.get("priority") || ""} onChange={event => updateFilter("priority", event.target.value)}><option value="">Any priority</option><option value="p0">Urgent</option><option value="p1">High</option><option value="p2">Normal</option></Select>
          {["q", "status", "priority", "assigneeAgentId", "plannedFrom", "plannedTo"].some(key => searchParams.has(key)) && <Button variant="ghost" size="sm" onClick={() => { const view = searchParams.get("view"); setSearchParams(view ? { view } : {}, { replace: true }) }}>Clear</Button>}
        </div>
        <div className="view-toggle" role="group" aria-label="Task layout"><button type="button" className={layout === "board" ? "active" : ""} aria-label="Board" aria-pressed={layout === "board"} onClick={() => switchLayout("board")}><BoardIcon className="size-3.5" /><span>Board</span></button><button type="button" className={layout === "table" ? "active" : ""} aria-label="Table" aria-pressed={layout === "table"} onClick={() => switchLayout("table")}><Rows3 className="size-3.5" /><span>Table</span></button></div>
      </div>
      {(pageError || tasksQuery.isError) && <p className="status-message error mb-3" role="alert">{pageError || tasksQuery.error?.message}</p>}
      {tasksQuery.isPending ? <div className="loading-page"><div className="spinner" /></div> : layout === "board" ? (
        <div className="board-scroll" id="workspace-task-panel">
          <div className="board workspace-flow">
            {columns.map(column => {
              const items = tasks.filter(task => column.statuses.includes(task.status))
              return <section key={column.value} className={`board-column workspace-flow-column column-${column.className || "todo"} ${dragOver === column.value ? "drag-over" : ""}`} data-status={column.value} onDragOver={event => { event.preventDefault(); setDragOver(column.value) }} onDragLeave={() => setDragOver("")} onDrop={event => { event.preventDefault(); setDragOver(""); const id = event.dataTransfer.getData("text/task-id"); if (id) moveTask.mutate({ id, status: column.value }) }}><header className="column-head"><div className="column-title"><span className={`column-dot ${column.className}`} /><span>{column.label}</span><span className="column-count">{items.length}</span></div><Tooltip delayDuration={350}><TooltipTrigger asChild><button type="button" className="column-action" aria-label={`Add task to ${column.label}`} onClick={() => window.dispatchEvent(new CustomEvent("slate:new-task", { detail: { status: column.value } }))}><Plus aria-hidden="true" /></button></TooltipTrigger><TooltipContent>Add task</TooltipContent></Tooltip></header><div className="task-stack">{items.map(task => <TaskCard key={task.id} task={task} onOpen={() => openTask(task.id)} onMove={status => moveTask.mutate({ id: task.id, status })} onDelete={returnFocus => { deleteTask.reset(); setPageError(""); setDeleteTarget({ task, returnFocus }) }} />)}{!items.length && <div className="empty-column">No tasks here</div>}</div></section>
            })}
          </div>
        </div>
      ) : (
        <div className="data-table-wrap"><table className="data-table workspace-table"><thead><tr><th>Task</th><th>Status</th><th>Agent</th><th>List</th><th>Priority</th><th>Planned</th><th>Actions</th></tr></thead><tbody>{tasks.map(task => <tr key={task.id} data-task={task.id}><td><button type="button" className="font-semibold" aria-label={`Open task: ${task.title}`} onClick={() => openTask(task.id)}>{task.title}</button></td><td>{statusName(task.status)}</td><td>{task.assigneeAgentName || "—"}</td><td>{task.listName || task.bucketName || lists.find(list => list.id === task.bucketId)?.name}</td><td>{task.priority ? <PriorityBadge priority={task.priority} compact /> : priorityLabel()}</td><td>{task.scheduledDate || "—"}</td><td><TaskTableActions task={task} onDelete={returnFocus => { deleteTask.reset(); setPageError(""); setDeleteTarget({ task, returnFocus }) }} /></td></tr>)}</tbody></table></div>
      )}
      {tasksQuery.hasNextPage && <div className="mt-4 text-center"><Button variant="secondary" onClick={() => tasksQuery.fetchNextPage()} disabled={tasksQuery.isFetchingNextPage}>{tasksQuery.isFetchingNextPage ? "Loading…" : "Load more tasks"}</Button></div>}
      <TaskDeleteDialog task={deleteTarget?.task || null} open={Boolean(deleteTarget)} pending={deleteTask.isPending} error={deleteTask.error instanceof Error ? deleteTask.error.message : deleteTask.error ? "Could not delete task" : ""} returnFocus={deleteTarget?.returnFocus} onCancel={() => setDeleteTarget(null)} onConfirm={() => { if (deleteTarget) { deleteTask.reset(); deleteTask.mutate(deleteTarget.task.id) } }} />
      {taskId && <TaskDetail taskId={taskId} backLabel={selectedList ? `Back to ${selectedList.name}` : "Back to all tasks"} onClose={() => navigate(`${listId ? `/app/lists/${encodeURIComponent(listId)}` : "/app/tasks"}${searchParams.toString() ? `?${searchParams}` : ""}`)} onOpenTask={openTask} />}
    </div>
  )
}
