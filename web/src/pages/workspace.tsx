import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Columns3 as BoardIcon, CalendarDays, List as ListIcon, MoreHorizontal, Rows3, Search, Trash2 } from "lucide-react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input, Select } from "@/components/ui/field"
import { TaskDetail } from "@/components/task-detail"
import { useApp, initials } from "@/app-context"
import { api } from "@/lib/api"
import type { Task, TaskStatus } from "@/lib/types"

const columns: Array<{ value: TaskStatus; label: string; statuses: TaskStatus[]; className: string }> = [
  { value: "new", label: "Todo", statuses: ["new", "queued"], className: "" },
  { value: "working", label: "In Progress", statuses: ["working"], className: "working" },
  { value: "needs_review", label: "Review", statuses: ["needs_review"], className: "review" },
  { value: "done", label: "Done", statuses: ["done"], className: "done" },
]

const statusName = (value: string) => columns.find(column => column.statuses.includes(value as TaskStatus))?.label || value
const priorityName = (value?: string) => value ? value.toUpperCase() : ""

function TaskCard({ task, onOpen, onMove, onDelete }: { task: Task; onOpen: () => void; onMove: (status: TaskStatus) => void; onDelete: () => void }) {
  return (
    <div className="task-card group" draggable data-task={task.id} onDragStart={event => { event.dataTransfer.setData("text/task-id", task.id); event.dataTransfer.effectAllowed = "move" }} onDoubleClick={onOpen}>
      <button type="button" className="w-full text-left" data-open-task={task.id} aria-label={`Open task: ${task.title}`} onClick={onOpen}>
        <span className="task-title">{task.title}</span>
        {task.description && <span className="task-description">{task.description}</span>}
        <span className="task-meta">
          {task.priority && <span className={`pill priority-${task.priority}`}>{priorityName(task.priority)}</span>}
          {task.scheduledDate && <span className="pill"><CalendarDays className="size-3" />{new Date(`${task.scheduledDate}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
          {task.assigneeAgentName && <span className="task-agent"><span className="mini-avatar">{initials(task.assigneeAgentName)}</span>{task.assigneeAgentName}</span>}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button type="button" className="absolute right-1.5 top-1.5 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 focus:opacity-100" aria-label={`Actions for ${task.title}`}><MoreHorizontal className="size-3.5" /></button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {columns.map(column => <DropdownMenuItem key={column.value} onSelect={() => onMove(column.value)}>{column.label}</DropdownMenuItem>)}
          <DropdownMenuItem className="text-destructive" onSelect={onDelete}><Trash2 className="size-4" />Delete task</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function WorkspacePage() {
  const { listId = "", taskId = "" } = useParams()
  const { lists, agents, refreshLists } = useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [dragOver, setDragOver] = React.useState<TaskStatus | "">("")
  const [pageError, setPageError] = React.useState("")
  const selectedList = lists.find(list => list.id === listId)
  const scope = listId ? "list" : "all"
  const layout = searchParams.get("view") === "table" ? "table" : "board"

  const taskQueryString = React.useMemo(() => {
    const query = new URLSearchParams({ limit: "200" })
    if (listId) { query.set("bucketId", listId); query.set("topLevel", "true") }
    for (const key of ["q", "status", "priority", "assigneeAgentId", "plannedFrom", "plannedTo"]) {
      const value = searchParams.get(key)
      if (value) query.set(key, value)
    }
    return query.toString()
  }, [listId, searchParams])

  const tasksQuery = useQuery({
    queryKey: ["tasks", scope, listId, taskQueryString],
    queryFn: () => api.get<{ tasks: Task[]; nextCursor?: string }>(`/api/v1/tasks?${taskQueryString}`),
  })
  const tasks = tasksQuery.data?.tasks || []

  const refresh = async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: ["tasks"] }), refreshLists()])
  }
  const moveTask = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => api.patch<Task>(`/api/v1/tasks/${encodeURIComponent(id)}/status`, { status }),
    onMutate: ({ id, status }) => {
      queryClient.setQueriesData<{ tasks: Task[] }>({ queryKey: ["tasks"] }, old => old ? { ...old, tasks: old.tasks.map(task => task.id === id ? { ...task, status } : task) } : old)
    },
    onSuccess: refresh,
    onError: error => { setPageError(error instanceof Error ? error.message : "Could not update task"); void refresh() },
  })
  const deleteTask = useMutation({
    mutationFn: (id: string) => api.del(`/api/v1/tasks/${encodeURIComponent(id)}`),
    onSuccess: refresh,
    onError: error => setPageError(error instanceof Error ? error.message : "Could not delete task"),
  })
  const renameList = useMutation({
    mutationFn: (name: string) => api.patch(`/api/v1/lists/${encodeURIComponent(listId)}`, { name: name.trim() }),
    onSuccess: refreshLists,
    onError: error => setPageError(error instanceof Error ? error.message : "Could not rename list"),
  })
  const removeList = useMutation({
    mutationFn: () => api.del(`/api/v1/lists/${encodeURIComponent(listId)}`),
    onSuccess: async () => { await refreshLists(); navigate("/app/tasks") },
    onError: error => setPageError(error instanceof Error ? error.message : "Could not delete list"),
  })

  const updateFilter = (name: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(name, value); else next.delete(name)
    setSearchParams(next, { replace: true })
  }
  const switchLayout = (value: "board" | "table") => updateFilter("view", value === "table" ? "table" : "")
  const openTask = (id: string) => navigate(`/app/tasks/${encodeURIComponent(id)}${searchParams.toString() ? `?${searchParams}` : ""}`)

  if (listId && !selectedList && !tasksQuery.isPending) return <div className="page-wrap"><div className="empty-state"><div><ListIcon /><h1 className="font-serif text-3xl text-foreground">List not found</h1><p>This list is no longer available.</p><Button className="mt-4" onClick={() => navigate("/app/tasks")}>Open all tasks</Button></div></div></div>

  return (
    <div className="page-wrap task-shell">
      <header className="page-header">
        <div className="page-heading">
          {selectedList && !selectedList.isInbox ? <input className="detail-title-input max-w-xl" aria-label="List name" data-bucket-name={selectedList.id} defaultValue={selectedList.name} onBlur={event => { if (event.target.value.trim() && event.target.value.trim() !== selectedList.name) renameList.mutate(event.target.value) }} /> : <h1>{selectedList?.name || "All tasks"}</h1>}
          <p>{selectedList?.goal || (selectedList ? "Tasks in this list." : "Tasks across every list.")}</p>
        </div>
        <div className="page-actions">{selectedList && !selectedList.isInbox && <Button id="delete-workspace-list" variant="ghost" size="sm" className="text-destructive" onClick={() => { if (window.confirm(`Delete “${selectedList.name}” and every task in it?`)) removeList.mutate() }}><Trash2 className="size-4" /><span className="button-label">Delete list</span></Button>}</div>
      </header>
      <div className="toolbar">
        <div className="filters" role="search">
          <div className="search-box"><Search /><Input aria-label="Search tasks" placeholder="Search tasks…" value={searchParams.get("q") || ""} onChange={event => updateFilter("q", event.target.value)} /></div>
          <Select className="compact-select" aria-label="Filter by agent" value={searchParams.get("assigneeAgentId") || ""} onChange={event => updateFilter("assigneeAgentId", event.target.value)}><option value="">Any agent</option><option value="unassigned">You</option>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.displayName}</option>)}</Select>
          <Select className="compact-select" aria-label="Filter by priority" value={searchParams.get("priority") || ""} onChange={event => updateFilter("priority", event.target.value)}><option value="">Any priority</option><option value="p0">P0</option><option value="p1">P1</option><option value="p2">P2</option></Select>
          {["q", "status", "priority", "assigneeAgentId", "plannedFrom", "plannedTo"].some(key => searchParams.has(key)) && <Button variant="ghost" size="sm" onClick={() => { const view = searchParams.get("view"); setSearchParams(view ? { view } : {}, { replace: true }) }}>Clear</Button>}
        </div>
        <div className="view-toggle" role="group" aria-label="Task layout"><button type="button" className={layout === "board" ? "active" : ""} aria-pressed={layout === "board"} onClick={() => switchLayout("board")}><BoardIcon className="size-3.5" /><span>Board</span></button><button type="button" className={layout === "table" ? "active" : ""} aria-pressed={layout === "table"} onClick={() => switchLayout("table")}><Rows3 className="size-3.5" /><span>Table</span></button></div>
      </div>
      {(pageError || tasksQuery.isError) && <p className="status-message error mb-3" role="alert">{pageError || tasksQuery.error?.message}</p>}
      {tasksQuery.isPending ? <div className="loading-page"><div className="spinner" /></div> : layout === "board" ? (
        <div className="board-scroll" id="workspace-task-panel">
          <div className="board workspace-flow">
            {columns.map(column => {
              const items = tasks.filter(task => column.statuses.includes(task.status))
              return <section key={column.value} className={`board-column workspace-flow-column ${dragOver === column.value ? "drag-over" : ""}`} data-status={column.value} onDragOver={event => { event.preventDefault(); setDragOver(column.value) }} onDragLeave={() => setDragOver("")} onDrop={event => { event.preventDefault(); setDragOver(""); const id = event.dataTransfer.getData("text/task-id"); if (id) moveTask.mutate({ id, status: column.value }) }}><header className="column-head"><div className="column-title"><span className={`column-dot ${column.className}`} />{column.label}</div><span className="column-count">{items.length}</span></header><div className="task-stack">{items.map(task => <TaskCard key={task.id} task={task} onOpen={() => openTask(task.id)} onMove={status => moveTask.mutate({ id: task.id, status })} onDelete={() => { if (window.confirm(`Delete “${task.title}”?`)) deleteTask.mutate(task.id) }} />)}{!items.length && <div className="empty-column">No tasks here</div>}</div></section>
            })}
          </div>
        </div>
      ) : (
        <div className="data-table-wrap"><table className="data-table workspace-table"><thead><tr><th>Task</th><th>Status</th><th>Agent</th><th>List</th><th>Priority</th><th>Planned</th></tr></thead><tbody>{tasks.map(task => <tr key={task.id} data-task={task.id}><td><button type="button" className="font-semibold" aria-label={`Open task: ${task.title}`} onClick={() => openTask(task.id)}>{task.title}</button></td><td>{statusName(task.status)}</td><td>{task.assigneeAgentName || "You"}</td><td>{task.listName || task.bucketName || lists.find(list => list.id === task.bucketId)?.name}</td><td>{task.priority ? <span className={`pill priority-${task.priority}`}>{priorityName(task.priority)}</span> : "—"}</td><td>{task.scheduledDate || "—"}</td></tr>)}</tbody></table></div>
      )}
      {tasksQuery.data?.nextCursor && <div className="mt-4 text-center"><Button variant="secondary">Load more tasks</Button></div>}
      {taskId && <TaskDetail taskId={taskId} onClose={() => navigate(`/app/tasks${searchParams.toString() ? `?${searchParams}` : ""}`)} onOpenTask={openTask} />}
    </div>
  )
}
