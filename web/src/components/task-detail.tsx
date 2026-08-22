import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Bot, CalendarDays, Check, CheckCircle2, ChevronDown, Circle, GripVertical, MessageSquare, MoreHorizontal, Plus, RotateCcw, Send, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input, Label, Select, Textarea } from "@/components/ui/field"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PriorityMark, PriorityPicker, type Priority } from "@/components/priority"
import { TaskDeleteDialog } from "@/components/task-delete-dialog"
import { useApp, initials } from "@/app-context"
import { api } from "@/lib/api"
import { workspaceSummaryQueryKey, type Entry, type Task, type TaskStatus } from "@/lib/types"

const statuses: Array<{ value: TaskStatus; label: string }> = [
  { value: "new", label: "Todo" },
  { value: "queued", label: "Queued" },
  { value: "working", label: "In Progress" },
  { value: "needs_review", label: "Review" },
  { value: "done", label: "Done" },
]

function entryBody(entry: Entry) { return entry.body || entry.content || "" }
function shortDate(value: string) { return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) }
function isPastDate(value: string) {
  const today = new Date()
  const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
  return value < localDate
}

export function TaskDetail({ taskId, onClose, onOpenTask, backLabel: returnLabel = "Back to all tasks" }: { taskId: string; onClose: () => void; onOpenTask?: (id: string) => void; backLabel?: string }) {
  const { lists, agents } = useApp()
  const queryClient = useQueryClient()
  const [draft, setDraft] = React.useState<Partial<Task>>({})
  const [subtaskTitle, setSubtaskTitle] = React.useState("")
  const [showSubtaskComposer, setShowSubtaskComposer] = React.useState(false)
  const [entryKind, setEntryKind] = React.useState<"comment" | "output">("comment")
  const [entryText, setEntryText] = React.useState("")
  const [error, setError] = React.useState("")
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const actionsTrigger = React.useRef<HTMLButtonElement>(null)
  const activeTaskID = React.useRef(taskId)
  const dirtyFields = React.useRef(new Set<keyof Task>())

  React.useLayoutEffect(() => {
    activeTaskID.current = taskId
  }, [taskId])

  const taskQuery = useQuery({ queryKey: ["task", taskId], queryFn: () => api.get<Task>(`/api/v1/tasks/${encodeURIComponent(taskId)}`), staleTime: 0 })
  const subtasksQuery = useQuery({
    queryKey: ["subtasks", taskId],
    queryFn: () => api.get<{ tasks: Task[] }>(`/api/v1/tasks/${encodeURIComponent(taskId)}/subtasks`),
  })
  const entriesQuery = useQuery({ queryKey: ["entries", taskId], queryFn: () => api.get<{ entries: Entry[] }>(`/api/v1/tasks/${encodeURIComponent(taskId)}/entries`) })

  React.useEffect(() => {
    dirtyFields.current.clear()
    setDraft({})
    setError("")
    setEntryText("")
    setSubtaskTitle("")
    setShowSubtaskComposer(false)
    setDeleteOpen(false)
  }, [taskId])
  React.useEffect(() => {
    if (!taskQuery.data) return
    setDraft(current => {
      const next: Partial<Task> = { ...taskQuery.data, priority: taskQuery.data.priority || "p1" }
      for (const key of dirtyFields.current) (next as Record<keyof Task, unknown>)[key] = current[key]
      return next
    })
  }, [taskId, taskQuery.data])

  const invalidateTaskSurfaces = async (targetTaskID = activeTaskID.current) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["task", targetTaskID] }),
      queryClient.invalidateQueries({ queryKey: ["agent"] }),
      queryClient.invalidateQueries({ queryKey: ["lists"] }),
      queryClient.invalidateQueries({ queryKey: ["inbox"] }),
      queryClient.invalidateQueries({ queryKey: ["inbox-review"] }),
      queryClient.invalidateQueries({ queryKey: ["runs-overview"] }),
      queryClient.invalidateQueries({ queryKey: ["global-task-search"] }),
      queryClient.invalidateQueries({ queryKey: workspaceSummaryQueryKey }),
    ])
  }

  const taskPayload = (source: Partial<Task>) => ({
    title: String(source.title || "").trim(),
    description: source.description || "",
    status: source.status || "new",
    priority: source.priority || "p1",
    assigneeAgentId: source.assigneeAgentId || "",
    scheduledDate: source.scheduledDate || "",
    ...(source.parentTaskId ? {} : { bucketId: source.bucketId || lists[0]?.id || "" }),
  })

  const draftPayload = () => taskPayload(draft)

  // A review decision carries the edits the user made in the open panel, but
  // nothing else. Sending the whole snapshot would revert any field another
  // session or an agent changed since the panel loaded, so compare against the
  // task as it was loaded and send only what this user actually touched. Both
  // sides go through the same normalisation so an absent value and an empty one
  // do not read as an edit.
  const editedFields = (status: TaskStatus) => {
    const draftValues = draftPayload()
    const loadedValues = taskPayload(taskQuery.data || {})
    const edited = Object.fromEntries(
      Object.entries(draftValues).filter(([key, value]) => value !== loadedValues[key as keyof typeof loadedValues]),
    )
    return { ...edited, status }
  }

  const save = useMutation({
    mutationFn: () => api.patch<Task>(`/api/v1/tasks/${encodeURIComponent(taskId)}/status`, draftPayload()),
    onSuccess: async task => { queryClient.setQueryData(["task", taskId], task); await invalidateTaskSurfaces(); onClose() },
    onError: value => setError(value instanceof Error ? value.message : "Could not save task"),
  })

  const updatePriority = useMutation({
    mutationFn: ({ targetTaskID, priority }: { targetTaskID: string; priority: Priority }) => api.patch<Task>(`/api/v1/tasks/${encodeURIComponent(targetTaskID)}`, { priority }),
    onMutate: ({ targetTaskID, priority }) => {
      setError("")
      const previous = (draft.priority || taskQuery.data?.priority || "p1") as Priority
      dirtyFields.current.add("priority")
      setDraft(current => ({ ...current, priority }))
      return { previous, targetTaskID }
    },
    onSuccess: async (updated, { targetTaskID }) => {
      queryClient.setQueryData(["task", targetTaskID], updated)
      if (targetTaskID === activeTaskID.current) {
        dirtyFields.current.delete("priority")
        setDraft(current => ({ ...current, priority: updated.priority || "p1" }))
      }
      await invalidateTaskSurfaces(targetTaskID)
    },
    onError: (value, { targetTaskID }, context) => {
      if (targetTaskID === activeTaskID.current) {
        dirtyFields.current.delete("priority")
        if (context) setDraft(current => ({ ...current, priority: context.previous }))
        setError(value instanceof Error ? value.message : "Could not update priority")
      }
    },
  })

  const remove = useMutation({
    mutationFn: () => api.del(`/api/v1/tasks/${encodeURIComponent(taskId)}`),
    onSuccess: async () => { queryClient.removeQueries({ queryKey: ["task", taskId] }); await invalidateTaskSurfaces(); onClose() },
    onError: value => setError(value instanceof Error ? value.message : "Could not delete task"),
  })

  const review = useMutation({
    mutationFn: (status: "working" | "done") => api.patch<Task>(`/api/v1/tasks/${encodeURIComponent(taskId)}/status`, editedFields(status)),
    onSuccess: async (updated, status) => {
      queryClient.setQueryData(["task", taskId], updated)
      setDraft({ ...updated, priority: updated.priority || "p1" })
      await invalidateTaskSurfaces()
      if (status === "done") onClose()
    },
    onError: value => setError(value instanceof Error ? value.message : "Could not review task"),
  })

  const createSubtask = useMutation({
    mutationFn: () => api.post<Task>(`/api/v1/tasks/${encodeURIComponent(taskId)}/subtasks`, { title: subtaskTitle.trim(), kind: "action", priority: task.priority || "p1" }, { "Idempotency-Key": crypto.randomUUID() }),
    onSuccess: async () => { setSubtaskTitle(""); setShowSubtaskComposer(false); await Promise.all([queryClient.invalidateQueries({ queryKey: ["subtasks", taskId] }), queryClient.invalidateQueries({ queryKey: ["tasks"] }), queryClient.invalidateQueries({ queryKey: workspaceSummaryQueryKey })]) },
    onError: value => setError(value instanceof Error ? value.message : "Could not add subtask"),
  })

  const toggleSubtask = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => api.patch<Task>(`/api/v1/tasks/${encodeURIComponent(id)}/status`, { status }),
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["subtasks", taskId] }), queryClient.invalidateQueries({ queryKey: ["tasks"] }), queryClient.invalidateQueries({ queryKey: workspaceSummaryQueryKey })]) },
    onError: value => setError(value instanceof Error ? value.message : "Could not update subtask"),
  })

  const reorderSubtasks = useMutation({
    mutationFn: (ids: string[]) => api.post(`/api/v1/tasks/${encodeURIComponent(taskId)}/reorder-subtasks`, { ids }),
    onMutate: async ids => {
      setError("")
      await queryClient.cancelQueries({ queryKey: ["subtasks", taskId] })
      const previous = queryClient.getQueryData<{ tasks: Task[] }>(["subtasks", taskId])
      const tasksByID = new Map((previous?.tasks || []).map(subtask => [subtask.id, subtask]))
      queryClient.setQueryData(["subtasks", taskId], { tasks: ids.map(id => tasksByID.get(id)).filter((subtask): subtask is Task => Boolean(subtask)) })
      return { previous }
    },
    onError: (value, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(["subtasks", taskId], context.previous)
      setError(value instanceof Error ? value.message : "Could not reorder subtasks")
    },
    onSettled: async () => { await queryClient.invalidateQueries({ queryKey: ["subtasks", taskId] }) },
  })

  const createEntry = useMutation({
    mutationFn: () => api.post<Entry & { taskStatus?: TaskStatus; taskReviewReason?: string }>(`/api/v1/tasks/${encodeURIComponent(taskId)}/entries`, { kind: entryKind, body: entryText.trim() }, { "Idempotency-Key": crypto.randomUUID() }),
    onSuccess: async entry => {
      setEntryText("")
      await queryClient.invalidateQueries({ queryKey: ["entries", taskId] })
      if (entry.kind === "output") await invalidateTaskSurfaces()
    },
    onError: value => setError(value instanceof Error ? value.message : "Could not add entry"),
  })

  const task = { ...(taskQuery.data || {}), ...draft } as Task
  const set = <K extends keyof Task>(key: K, value: Task[K]) => {
    dirtyFields.current.add(key)
    setDraft(current => ({ ...current, [key]: value }))
  }
  const list = lists.find(item => item.id === task.bucketId)
  const backLabel = task.parentTaskId ? "Back to parent task" : returnLabel
  const subtasks = [...(subtasksQuery.data?.tasks || [])].sort((left, right) => {
    const leftHasSortOrder = typeof left.sortOrder === "number"
    const rightHasSortOrder = typeof right.sortOrder === "number"
    if (leftHasSortOrder && rightHasSortOrder && left.sortOrder !== right.sortOrder) return left.sortOrder! - right.sortOrder!
    if (leftHasSortOrder !== rightHasSortOrder) return leftHasSortOrder ? -1 : 1
    const leftCreatedAt = left.createdAt || ""
    const rightCreatedAt = right.createdAt || ""
    return leftCreatedAt.localeCompare(rightCreatedAt) || left.id.localeCompare(right.id)
  })
  const completedSubtasks = subtasks.filter(subtask => subtask.status === "done").length
  const moveSubtask = (id: string, targetIndex: number) => {
    const currentIndex = subtasks.findIndex(subtask => subtask.id === id)
    const nextIndex = Math.max(0, Math.min(targetIndex, subtasks.length - 1))
    if (currentIndex < 0 || currentIndex === nextIndex || reorderSubtasks.isPending) return
    const ordered = [...subtasks]
    const [moved] = ordered.splice(currentIndex, 1)
    ordered.splice(nextIndex, 0, moved)
    reorderSubtasks.mutate(ordered.map(subtask => subtask.id))
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="detail-sheet" showClose={false} aria-describedby={undefined} onEscapeKeyDown={event => { if (showSubtaskComposer) { event.preventDefault(); setSubtaskTitle(""); setShowSubtaskComposer(false) } }}>
        <DialogTitle className="sr-only">Task detail</DialogTitle>
        <section aria-label="Task detail" data-detail-surface tabIndex={-1}>
          <header className="detail-head">
            <div className="detail-breadcrumb"><Button variant="ghost" size="sm" type="button" data-close-detail onClick={() => task.parentTaskId && onOpenTask ? onOpenTask(task.parentTaskId) : onClose()}><ArrowLeft className="size-4" />{backLabel}</Button><span>{list?.name || task.bucketName || "Inbox"}</span><span aria-hidden="true">/</span><strong>{task.parentTaskId ? "Subtask" : "Task"}</strong></div>
            <div className="detail-head-actions"><DropdownMenu><DropdownMenuTrigger asChild><Button ref={actionsTrigger} variant="ghost" size="icon" type="button" aria-label="Task actions"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>Task options</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuItem id="delete-task" className="text-destructive focus:bg-destructive/10 focus:text-destructive" disabled={remove.isPending || !taskQuery.data} onSelect={() => { if (taskQuery.data) { remove.reset(); setError(""); setDeleteOpen(true) } }}><Trash2 className="size-4" />Delete task</DropdownMenuItem></DropdownMenuContent></DropdownMenu><Button variant="ghost" size="icon" type="button" onClick={onClose} aria-label="Close task"><span className="text-xl leading-none">×</span></Button></div>
          </header>
          {taskQuery.isPending ? <div className="loading-page"><div className="spinner" /></div> : taskQuery.isError ? <div className="detail-main"><p className="status-message error" role="alert">{taskQuery.error.message}</p></div> : (
            <form className="detail-form" id="workspace-detail-form" onSubmit={event => { event.preventDefault(); if (!String(draft.title || "").trim()) return setError("Title is required."); save.mutate() }}>
              <div className="detail-layout">
                <main className="detail-main">
                <input id="workspace-detail-title" name="title" aria-label="Title" className="detail-title-input" value={String(draft.title || "")} onChange={event => set("title", event.target.value)} autoFocus />
                <textarea name="description" aria-label="Brief" className="detail-description-input" value={String(draft.description || "")} onChange={event => set("description", event.target.value)} placeholder="Add a clear brief…" />

                {!task.parentTaskId && <section className="detail-section subtask-section">
                  <div className="section-heading subtask-heading"><div className="subtask-heading-copy"><ChevronDown aria-hidden="true" /><h2>Subtasks</h2><span className="subtask-progress"><Circle aria-hidden="true" /><span>{completedSubtasks}/{subtasks.length}</span></span></div><Tooltip delayDuration={350}><TooltipTrigger asChild><button type="button" className="subtask-add-trigger" aria-label="Add subtask" aria-expanded={showSubtaskComposer} onClick={() => setShowSubtaskComposer(value => !value)}><Plus aria-hidden="true" /></button></TooltipTrigger><TooltipContent>Add subtask</TooltipContent></Tooltip></div>
                  <div className="subtask-list">
                    {subtasks.map((subtask, index) => <article
                      key={subtask.id}
                      className={`subtask-row ${subtask.status === "done" ? "is-complete" : ""}`}
                      onDragOver={event => event.preventDefault()}
                      onDrop={event => {
                        event.preventDefault()
                        const draggedID = event.dataTransfer.getData("text/subtask-id")
                        if (draggedID) moveSubtask(draggedID, index)
                      }}
                    >
                      <button
                        type="button"
                        className="subtask-reorder"
                        draggable
                        disabled={reorderSubtasks.isPending}
                        aria-label={`Reorder ${subtask.title}`}
                        aria-keyshortcuts="ArrowUp ArrowDown"
                        title="Drag to reorder. Use the arrow keys for precise movement."
                        onDragStart={event => {
                          event.dataTransfer.setData("text/subtask-id", subtask.id)
                          event.dataTransfer.effectAllowed = "move"
                        }}
                        onKeyDown={event => {
                          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
                          event.preventDefault()
                          moveSubtask(subtask.id, index + (event.key === "ArrowUp" ? -1 : 1))
                        }}
                      ><GripVertical aria-hidden="true" /></button>
                      <PriorityMark priority={subtask.priority} />
                      <button type="button" className="subtask-status" aria-label={subtask.status === "done" ? `Reopen ${subtask.title}` : `Complete ${subtask.title}`} disabled={toggleSubtask.isPending} onClick={() => toggleSubtask.mutate({ id: subtask.id, status: subtask.status === "done" ? "new" : "done" })}>{subtask.status === "done" ? <Check aria-hidden="true" /> : <span />}</button>
                      <button type="button" className="subtask-open" data-open-task={subtask.id} onClick={() => onOpenTask?.(subtask.id)}><span className="subtask-title">{subtask.title}</span></button>
                      <div className="subtask-meta">{subtask.scheduledDate && <span className={isPastDate(subtask.scheduledDate) && subtask.status !== "done" ? "is-overdue" : ""}><CalendarDays aria-hidden="true" />{shortDate(subtask.scheduledDate)}</span>}{subtask.assigneeAgentName && <span className="mini-avatar" aria-label={`Assigned to ${subtask.assigneeAgentName}`}>{initials(subtask.assigneeAgentName)}</span>}</div>
                    </article>)}
                    {!subtasks.length && !showSubtaskComposer && <button type="button" className="subtask-empty" onClick={() => setShowSubtaskComposer(true)}><Plus aria-hidden="true" />Break this task into smaller steps</button>}
                    {showSubtaskComposer && <div id="add-subtask" className="subtask-composer"><Input name="title" aria-label="New subtask title" value={subtaskTitle} autoFocus onChange={event => setSubtaskTitle(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (subtaskTitle.trim()) createSubtask.mutate() } }} placeholder="Add a subtask…" /><Button type="button" size="sm" onClick={() => createSubtask.mutate()} disabled={!subtaskTitle.trim() || createSubtask.isPending}>{createSubtask.isPending ? "Adding…" : "Add"}</Button></div>}
                  </div>
                </section>}

                <section className="detail-section activity-section"><div className="section-heading"><h2>Activity</h2><span className="pill">{entriesQuery.data?.entries.length || 0}</span></div><div className="entry-list">{(entriesQuery.data?.entries || []).map(entry => <article className="entry-row" key={entry.id}><div className="entry-meta"><span className="flex items-center gap-1.5">{entry.kind === "output" ? <Bot className="size-3" /> : <MessageSquare className="size-3" />}{entry.authorName || (entry.authorKind === "agent" ? "Agent" : "You")} · {entry.kind}</span><time>{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ""}</time></div><p>{entryBody(entry)}</p></article>)}</div><div className="composer"><div className="view-toggle w-fit"><button type="button" className={entryKind === "comment" ? "active" : ""} onClick={() => setEntryKind("comment")}>Comment</button><button type="button" className={entryKind === "output" ? "active" : ""} onClick={() => setEntryKind("output")}>Output</button></div><Textarea id="card-entry-body" aria-label="Entry" value={entryText} onChange={event => setEntryText(event.target.value)} placeholder={entryKind === "output" ? "Add the result, links or deliverable…" : "Leave a comment…"} /><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{entryKind === "output" ? "Outputs move the task to Review." : "Comments stay with the task."}</span><Button id="add-card-entry" type="button" size="sm" onClick={() => createEntry.mutate()} disabled={!entryText.trim() || createEntry.isPending}><Send className="size-3.5" />{createEntry.isPending ? "Adding…" : `Add ${entryKind}`}</Button></div></div></section>
                {error && <p className="status-message error mt-4" role="alert">{error}</p>}
                </main>
                <aside className="detail-properties" aria-label="Task properties">
                  <h2>Properties</h2>
                  <div className="property-row"><Label htmlFor="workspace-detail-status">Status</Label><Select id="workspace-detail-status" name="status" value={task.status || "new"} onChange={event => set("status", event.target.value as TaskStatus)}>{statuses.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></div>
                  <div className="property-row"><Label htmlFor="workspace-detail-owner">Agent</Label><Select id="workspace-detail-owner" name="assigneeAgentId" aria-label="Assigned agent" value={task.assigneeAgentId || ""} disabled={!agents.length} onChange={event => set("assigneeAgentId", event.target.value)}><option value="">{agents.length ? "No agent" : "None connected"}</option>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.displayName}</option>)}</Select></div>
                  <div className="property-row"><Label htmlFor="workspace-detail-list">List</Label><Select id="workspace-detail-list" name="bucketId" value={task.bucketId || ""} disabled={Boolean(task.parentTaskId)} onChange={event => set("bucketId", event.target.value)}>{lists.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></div>
                  <div className="property-row"><Label>Priority</Label><PriorityPicker value={(task.priority || "p1") as Priority} onChange={priority => updatePriority.mutate({ targetTaskID: taskId, priority })} allowNone={false} disabled={updatePriority.isPending} /></div>
                  <div className="property-row"><Label htmlFor="workspace-detail-date">Plan for</Label><Input id="workspace-detail-date" name="scheduledDate" type="date" value={task.scheduledDate || ""} onChange={event => set("scheduledDate", event.target.value)} /></div>
                  <div className="properties-note"><strong>{task.status === "needs_review" ? "Human approval" : "Task details"}</strong><p>{task.status === "needs_review" ? "Agent work is paused in Review. Approve the result or send it back for another pass." : task.assigneeAgentId ? "Assigned work is queued for a connected runner. Agent outputs return here for review." : "Assign an agent when this task is ready to run."}</p></div>
                </aside>
              </div>
              <footer className="detail-footer"><div className="detail-footer-actions">{task.status === "needs_review" && <><Button id="send-back-task" type="button" variant="secondary" onClick={() => review.mutate("working")} disabled={review.isPending}><RotateCcw className="size-4" />Send back</Button><Button id="approve-task" type="button" onClick={() => review.mutate("done")} disabled={review.isPending}><CheckCircle2 className="size-4" />{review.isPending ? "Updating…" : "Approve"}</Button></>}<Button type="submit" variant={task.status === "needs_review" ? "secondary" : "default"} disabled={save.isPending || review.isPending}>{save.isPending ? "Saving…" : "Save changes"}</Button></div></footer>
            </form>
          )}
        </section>
        <TaskDeleteDialog task={taskQuery.data || null} open={deleteOpen} pending={remove.isPending} error={remove.error instanceof Error ? remove.error.message : remove.error ? "Could not delete task" : ""} returnFocus={actionsTrigger.current} onCancel={() => setDeleteOpen(false)} onConfirm={() => { remove.reset(); remove.mutate() }} />
      </DialogContent>
    </Dialog>
  )
}
