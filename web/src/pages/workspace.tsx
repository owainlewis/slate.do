import * as React from "react"
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query"
import { ArrowDownWideNarrow, Check, Columns3 as BoardIcon, CalendarDays, Layers3, List as ListIcon, MoreHorizontal, Plus, Rows3, Search, Trash2 } from "lucide-react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuItemIndicator, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/field"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { TaskDetail } from "@/components/task-detail"
import { TaskDeleteDialog } from "@/components/task-delete-dialog"
import { AssigneeLabel } from "@/components/assignee-picker"
import { PriorityBadge, PriorityFilter, priorityLabel } from "@/components/priority"
import { listColors, ListColorDot, type ListColor } from "@/components/list-color"
import { useApp } from "@/app-context"
import { api } from "@/lib/api"
import { assigneeForTask } from "@/lib/assignees"
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
  const { assignees } = useApp()
  const assignee = assigneeForTask(task, assignees)
  const actionsTrigger = React.useRef<HTMLButtonElement>(null)
  return (
    <div className="task-card group" draggable data-task={task.id} onDragStart={event => { event.dataTransfer.setData("text/task-id", task.id); event.dataTransfer.effectAllowed = "move" }} onDoubleClick={onOpen}>
      <button type="button" className="w-full text-left" data-open-task={task.id} aria-label={`Open task: ${task.title}`} onClick={onOpen}>
        <span className="task-card-kicker"><PriorityBadge priority={task.priority} compact /><span>{task.listName || task.bucketName || "Inbox"}</span></span>
        <span className="task-title">{task.title}</span>
        {task.description && <span className="task-description">{task.description}</span>}
        <span className="task-meta">
          {task.scheduledDate && <span className="pill"><CalendarDays className="size-3" />{new Date(`${task.scheduledDate}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
          <span className="task-agent"><AssigneeLabel assignee={assignee} compact /></span>
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
  const { me, lists, refreshLists } = useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [dragOver, setDragOver] = React.useState<TaskStatus | "">("")
  const [pageError, setPageError] = React.useState("")
  const [deleteTarget, setDeleteTarget] = React.useState<DeleteTarget | null>(null)
  const [listActionsOpen, setListActionsOpen] = React.useState(false)
  const selectedList = lists.find(list => list.id === listId)
  const scope = listId ? "list" : "all"
  const layout = searchParams.get("view") === "table" ? "table" : "board"
  const sortByPriority = searchParams.get("sort") === "priority"
  const groupByList = scope === "all" && searchParams.get("group") === "list"

  const taskQueryString = React.useMemo(() => {
    const query = new URLSearchParams({ limit: "200", topLevel: "true" })
    if (listId) query.set("bucketId", listId)
    for (const key of ["q", "status", "priority", "plannedFrom", "plannedTo"]) {
      const value = searchParams.get(key)
      if (value) query.set(key, value)
    }
    if (layout === "table" && groupByList) query.set("sort", sortByPriority ? "list_priority" : "list")
    else if (layout === "table" && sortByPriority) query.set("sort", "priority")
    return query.toString()
  }, [groupByList, layout, listId, searchParams, sortByPriority])

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
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  })

  React.useEffect(() => {
    if (!searchParams.has("assigneeAgentId")) return
    const next = new URLSearchParams(searchParams)
    next.delete("assigneeAgentId")
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const taskGroups = React.useMemo(() => {
    if (!groupByList) return []
    const groups = lists.map(list => ({ list, tasks: tasks.filter(task => task.bucketId === list.id) })).filter(group => group.tasks.length)
    const knownIDs = new Set(lists.map(list => list.id))
    const unknown = tasks.filter(task => !knownIDs.has(task.bucketId))
    return unknown.length ? [...groups, { list: undefined, tasks: unknown }] : groups
  }, [groupByList, lists, tasks])

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
  const recolorList = useMutation({
    mutationFn: (color: ListColor) => api.patch(`/api/v1/lists/${encodeURIComponent(listId)}`, { color }),
    onSuccess: refreshLists,
    onError: error => setPageError(error instanceof Error ? error.message : "Could not update list color"),
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

  if (listId && !selectedList && !tasksQuery.isPending) return <div className="page-wrap"><div className="empty-state"><div><ListIcon /><h1 className="font-sans text-3xl font-semibold text-foreground">List not found</h1><p>This list is no longer available.</p><Button className="mt-4" onClick={() => navigate("/app/tasks")}>Open all tasks</Button></div></div></div>

  return (
    <div className="page-wrap task-shell">
      <header className="page-header">
        <div className="page-heading">
          {selectedList && !selectedList.isInbox ? <div className="list-page-title"><ListColorDot color={selectedList.color} /><input key={selectedList.id} className="page-title-input max-w-xl" aria-label="List name" data-bucket-name={selectedList.id} defaultValue={selectedList.name} onBlur={event => { if (event.target.value.trim() && event.target.value.trim() !== selectedList.name) renameList.mutate(event.target.value) }} /></div> : <h1>{selectedList?.name || "All tasks"}</h1>}
        </div>
        <div className="page-actions">{selectedList && !selectedList.isInbox && <DropdownMenu open={listActionsOpen} onOpenChange={setListActionsOpen}><DropdownMenuTrigger asChild><Button id="workspace-list-actions" variant="ghost" size="icon" aria-label="List actions"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="list-actions-menu"><DropdownMenuLabel>List color</DropdownMenuLabel><DropdownMenuRadioGroup value={selectedList.color || "slate"} onValueChange={value => recolorList.mutate(value as ListColor)}>{listColors.map(color => <DropdownMenuRadioItem key={color.value} value={color.value} disabled={recolorList.isPending}><ListColorDot color={color.value} /><span>{color.label}</span><DropdownMenuItemIndicator className="ml-auto"><Check className="size-4" aria-hidden="true" /></DropdownMenuItemIndicator></DropdownMenuRadioItem>)}</DropdownMenuRadioGroup><DropdownMenuSeparator /><DropdownMenuItem id="delete-workspace-list" className="text-destructive focus:bg-destructive/10 focus:text-destructive" disabled={removeList.isPending} onSelect={() => { if (window.confirm(`Delete “${selectedList.name}” and every task in it?`)) removeList.mutate() }}><Trash2 className="size-4" />{removeList.isPending ? "Deleting…" : "Delete list"}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}</div>
      </header>
      {summaryQuery.data && <WorkspaceSummaryStrip summary={summaryQuery.data} />}
      <div className="toolbar">
        <div className="filters" role="search">
          <div className="search-box"><Search /><Input aria-label="Search tasks" placeholder="Search tasks…" value={searchParams.get("q") || ""} onChange={event => updateFilter("q", event.target.value)} /></div>
          <PriorityFilter value={searchParams.get("priority") || ""} onChange={value => updateFilter("priority", value)} />
          {["q", "status", "priority", "plannedFrom", "plannedTo"].some(key => searchParams.has(key)) && <Button variant="ghost" size="sm" onClick={() => { const preserved = Object.fromEntries(["view", "sort", "group"].map(key => [key, searchParams.get(key)]).filter((entry): entry is [string, string] => Boolean(entry[1]))); setSearchParams(preserved, { replace: true }) }}>Clear</Button>}
        </div>
        <div className="table-toolbar-actions">
          {layout === "table" && <button type="button" className={`table-option ${sortByPriority ? "active" : ""}`} aria-pressed={sortByPriority} onClick={() => updateFilter("sort", sortByPriority ? "" : "priority")}><ArrowDownWideNarrow aria-hidden="true" />Priority order</button>}
          {layout === "table" && scope === "all" && <button type="button" className={`table-option ${groupByList ? "active" : ""}`} aria-pressed={groupByList} onClick={() => updateFilter("group", groupByList ? "" : "list")}><Layers3 aria-hidden="true" />Group by list</button>}
          <div className="view-toggle" role="group" aria-label="Task layout"><button type="button" className={layout === "board" ? "active" : ""} aria-label="Board" aria-pressed={layout === "board"} onClick={() => switchLayout("board")}><BoardIcon className="size-3.5" /><span>Board</span></button><button type="button" className={layout === "table" ? "active" : ""} aria-label="Table" aria-pressed={layout === "table"} onClick={() => switchLayout("table")}><Rows3 className="size-3.5" /><span>Table</span></button></div>
        </div>
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
        <div className="data-table-wrap"><table className="data-table workspace-table"><thead><tr><th>Task</th><th>Status</th><th>Assignee</th><th>List</th><th>Priority</th><th>Planned</th><th>Actions</th></tr></thead><tbody>{groupByList ? taskGroups.map(group => <React.Fragment key={group.list?.id || "unknown"}><tr className="table-group-row"><th colSpan={7}><ListColorDot color={group.list?.color} />{group.list?.name || "Other"}<span>{group.tasks.length}</span></th></tr>{group.tasks.map(task => <TaskTableRow key={task.id} task={task} lists={lists} onOpen={() => openTask(task.id)} onDelete={returnFocus => { deleteTask.reset(); setPageError(""); setDeleteTarget({ task, returnFocus }) }} />)}</React.Fragment>) : tasks.map(task => <TaskTableRow key={task.id} task={task} lists={lists} onOpen={() => openTask(task.id)} onDelete={returnFocus => { deleteTask.reset(); setPageError(""); setDeleteTarget({ task, returnFocus }) }} />)}</tbody></table></div>
      )}
      {tasksQuery.isFetchNextPageError && <div className="table-loading table-loading-error mt-4" role="alert"><span>Could not load more tasks.</span><button type="button" onClick={() => tasksQuery.fetchNextPage()}>Retry</button></div>}
      {tasksQuery.hasNextPage && !tasksQuery.isFetchNextPageError && <div className="mt-4 text-center"><Button variant="secondary" onClick={() => tasksQuery.fetchNextPage()} disabled={tasksQuery.isFetchingNextPage}>{tasksQuery.isFetchingNextPage ? "Loading…" : "Load more tasks"}</Button></div>}
      <TaskDeleteDialog task={deleteTarget?.task || null} open={Boolean(deleteTarget)} pending={deleteTask.isPending} error={deleteTask.error instanceof Error ? deleteTask.error.message : deleteTask.error ? "Could not delete task" : ""} returnFocus={deleteTarget?.returnFocus} onCancel={() => setDeleteTarget(null)} onConfirm={() => { if (deleteTarget) { deleteTask.reset(); deleteTask.mutate(deleteTarget.task.id) } }} />
      {taskId && <TaskDetail taskId={taskId} backLabel={selectedList ? `Back to ${selectedList.name}` : "Back to all tasks"} onClose={() => navigate(`${listId ? `/app/lists/${encodeURIComponent(listId)}` : "/app/tasks"}${searchParams.toString() ? `?${searchParams}` : ""}`)} onOpenTask={openTask} />}
    </div>
  )
}

function TaskTableRow({ task, lists, onOpen, onDelete }: { task: Task; lists: ReturnType<typeof useApp>["lists"]; onOpen: () => void; onDelete: (returnFocus: HTMLButtonElement | null) => void }) {
  const { assignees } = useApp()
  const assignee = assigneeForTask(task, assignees)
  return <tr data-task={task.id}><td><button type="button" className="font-semibold" aria-label={`Open task: ${task.title}`} onClick={onOpen}>{task.title}</button></td><td>{statusName(task.status)}</td><td><AssigneeLabel assignee={assignee} compact /></td><td>{task.listName || task.bucketName || lists.find(list => list.id === task.bucketId)?.name}</td><td>{task.priority ? <PriorityBadge priority={task.priority} compact /> : priorityLabel()}</td><td>{task.scheduledDate || "—"}</td><td><TaskTableActions task={task} onDelete={onDelete} /></td></tr>
}
