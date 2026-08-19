import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Bot, CheckCircle2, MessageSquare, Plus, Send, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input, Label, Select, Textarea } from "@/components/ui/field"
import { PriorityPicker, type Priority } from "@/components/priority"
import { useApp, initials } from "@/app-context"
import { api } from "@/lib/api"
import type { Entry, Task, TaskStatus } from "@/lib/types"

const statuses: Array<{ value: TaskStatus; label: string }> = [
  { value: "new", label: "Todo" },
  { value: "queued", label: "Ready" },
  { value: "working", label: "In Progress" },
  { value: "needs_review", label: "Review" },
  { value: "done", label: "Done" },
]

function entryBody(entry: Entry) { return entry.body || entry.content || "" }

export function TaskDetail({ taskId, onClose, onOpenTask }: { taskId: string; onClose: () => void; onOpenTask?: (id: string) => void }) {
  const { lists, agents } = useApp()
  const queryClient = useQueryClient()
  const [draft, setDraft] = React.useState<Partial<Task>>({})
  const [subtaskTitle, setSubtaskTitle] = React.useState("")
  const [entryKind, setEntryKind] = React.useState<"comment" | "output">("comment")
  const [entryText, setEntryText] = React.useState("")
  const [error, setError] = React.useState("")

  const taskQuery = useQuery({ queryKey: ["task", taskId], queryFn: () => api.get<Task>(`/api/v1/tasks/${encodeURIComponent(taskId)}`) })
  const subtasksQuery = useQuery({
    queryKey: ["subtasks", taskId],
    queryFn: () => api.get<{ tasks: Task[] }>(`/api/v1/tasks?parentTaskId=${encodeURIComponent(taskId)}&limit=200`),
  })
  const entriesQuery = useQuery({ queryKey: ["entries", taskId], queryFn: () => api.get<{ entries: Entry[] }>(`/api/v1/tasks/${encodeURIComponent(taskId)}/entries`) })

  React.useEffect(() => { if (taskQuery.data) setDraft({ ...taskQuery.data, priority: taskQuery.data.priority || "p1" }) }, [taskQuery.data])
  React.useEffect(() => { setError(""); setEntryText(""); setSubtaskTitle("") }, [taskId])

  const invalidateTaskSurfaces = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
      queryClient.invalidateQueries({ queryKey: ["agent"] }),
      queryClient.invalidateQueries({ queryKey: ["lists"] }),
    ])
  }

  const save = useMutation({
    mutationFn: () => api.patch<Task>(`/api/v1/tasks/${encodeURIComponent(taskId)}/status`, {
      title: String(draft.title || "").trim(),
      description: draft.description || "",
      status: draft.status || "new",
      priority: draft.priority || "p1",
      assigneeAgentId: draft.assigneeAgentId || "",
      scheduledDate: draft.scheduledDate || "",
      ...(draft.parentTaskId ? {} : { bucketId: draft.bucketId || lists[0]?.id || "" }),
    }),
    onSuccess: async task => { queryClient.setQueryData(["task", taskId], task); await invalidateTaskSurfaces(); onClose() },
    onError: value => setError(value instanceof Error ? value.message : "Could not save task"),
  })

  const remove = useMutation({
    mutationFn: () => api.del(`/api/v1/tasks/${encodeURIComponent(taskId)}`),
    onSuccess: async () => { queryClient.removeQueries({ queryKey: ["task", taskId] }); await invalidateTaskSurfaces(); onClose() },
    onError: value => setError(value instanceof Error ? value.message : "Could not delete task"),
  })

  const createSubtask = useMutation({
    mutationFn: async () => {
      const subtask = await api.post<Task>(`/api/v1/tasks/${encodeURIComponent(taskId)}/subtasks`, { title: subtaskTitle.trim(), kind: "action" }, { "Idempotency-Key": crypto.randomUUID() })
      return api.patch<Task>(`/api/v1/tasks/${encodeURIComponent(subtask.id)}/status`, { status: subtask.status || "new", priority: task.priority || "p1" })
    },
    onSuccess: async () => { setSubtaskTitle(""); await queryClient.invalidateQueries({ queryKey: ["subtasks", taskId] }); await queryClient.invalidateQueries({ queryKey: ["tasks"] }) },
    onError: value => setError(value instanceof Error ? value.message : "Could not add subtask"),
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
  const set = <K extends keyof Task>(key: K, value: Task[K]) => setDraft(current => ({ ...current, [key]: value }))
  const list = lists.find(item => item.id === task.bucketId)
  const backLabel = task.parentTaskId ? "Back to parent task" : "Back to all tasks"

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="detail-sheet" showClose={false} aria-describedby={undefined}>
        <DialogTitle className="sr-only">Task detail</DialogTitle>
        <section aria-label="Task detail" data-detail-surface tabIndex={-1}>
          <header className="detail-head">
            <div className="detail-breadcrumb"><Button variant="ghost" size="sm" type="button" data-close-detail onClick={() => task.parentTaskId && onOpenTask ? onOpenTask(task.parentTaskId) : onClose()}><ArrowLeft className="size-4" />{backLabel}</Button><span>{list?.name || task.bucketName || "Inbox"}</span><span aria-hidden="true">/</span><strong>{task.parentTaskId ? "Subtask" : "Task"}</strong></div>
            <Button variant="ghost" size="icon" type="button" onClick={onClose} aria-label="Close task"><span className="text-xl leading-none">×</span></Button>
          </header>
          {taskQuery.isPending ? <div className="loading-page"><div className="spinner" /></div> : taskQuery.isError ? <div className="detail-main"><p className="status-message error" role="alert">{taskQuery.error.message}</p></div> : (
            <form className="detail-form" id="workspace-detail-form" onSubmit={event => { event.preventDefault(); if (!String(draft.title || "").trim()) return setError("Title is required."); save.mutate() }}>
              <div className="detail-layout">
                <main className="detail-main">
                <input id="workspace-detail-title" name="title" aria-label="Title" className="detail-title-input" value={String(draft.title || "")} onChange={event => set("title", event.target.value)} autoFocus />
                <textarea name="description" aria-label="Brief" className="detail-description-input" value={String(draft.description || "")} onChange={event => set("description", event.target.value)} placeholder="Add a clear brief…" />

                {!task.parentTaskId && <section className="detail-section"><div className="section-heading"><h2>Subtasks</h2><span className="pill">{subtasksQuery.data?.tasks.length || 0}</span></div><div className="subtask-list">{(subtasksQuery.data?.tasks || []).map(subtask => <button key={subtask.id} type="button" className="subtask-row" data-open-task={subtask.id} onClick={() => onOpenTask?.(subtask.id)}><CheckCircle2 className={`size-4 ${subtask.status === "done" ? "text-primary" : "text-muted-foreground"}`} /><span className="flex-1 text-left text-sm">{subtask.title}</span><span className="pill">{statuses.find(item => item.value === subtask.status)?.label}</span></button>)}</div><div id="add-subtask" className="mt-2 flex gap-2"><Input name="title" aria-label="New subtask title" value={subtaskTitle} onChange={event => setSubtaskTitle(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (subtaskTitle.trim()) createSubtask.mutate() } }} placeholder="Add a subtask…" /><Button type="button" variant="secondary" onClick={() => createSubtask.mutate()} disabled={!subtaskTitle.trim() || createSubtask.isPending}><Plus className="size-4" /><span>{createSubtask.isPending ? "Adding…" : "Add"}</span></Button></div></section>}

                <section className="detail-section activity-section"><div className="section-heading"><h2>Activity</h2><span className="pill">{entriesQuery.data?.entries.length || 0}</span></div><div className="entry-list">{(entriesQuery.data?.entries || []).map(entry => <article className="entry-row" key={entry.id}><div className="entry-meta"><span className="flex items-center gap-1.5">{entry.kind === "output" ? <Bot className="size-3" /> : <MessageSquare className="size-3" />}{entry.authorName || (entry.authorKind === "agent" ? "Agent" : "You")} · {entry.kind}</span><time>{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ""}</time></div><p>{entryBody(entry)}</p></article>)}</div><div className="composer"><div className="view-toggle w-fit"><button type="button" className={entryKind === "comment" ? "active" : ""} onClick={() => setEntryKind("comment")}>Comment</button><button type="button" className={entryKind === "output" ? "active" : ""} onClick={() => setEntryKind("output")}>Output</button></div><Textarea id="card-entry-body" aria-label="Entry" value={entryText} onChange={event => setEntryText(event.target.value)} placeholder={entryKind === "output" ? "Add the result, links or deliverable…" : "Leave a comment…"} /><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{entryKind === "output" ? "Outputs move the task to Review." : "Comments stay with the task."}</span><Button id="add-card-entry" type="button" size="sm" onClick={() => createEntry.mutate()} disabled={!entryText.trim() || createEntry.isPending}><Send className="size-3.5" />{createEntry.isPending ? "Adding…" : `Add ${entryKind}`}</Button></div></div></section>
                {error && <p className="status-message error mt-4" role="alert">{error}</p>}
                </main>
                <aside className="detail-properties" aria-label="Task properties">
                  <h2>Properties</h2>
                  <div className="property-row"><Label htmlFor="workspace-detail-status">Status</Label><Select id="workspace-detail-status" name="status" value={task.status || "new"} onChange={event => set("status", event.target.value as TaskStatus)}>{statuses.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></div>
                  <div className="property-row"><Label htmlFor="workspace-detail-owner">Owner</Label><Select id="workspace-detail-owner" name="assigneeAgentId" value={task.assigneeAgentId || ""} onChange={event => set("assigneeAgentId", event.target.value)}><option value="">You</option>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.displayName}</option>)}</Select></div>
                  <div className="property-row"><Label htmlFor="workspace-detail-list">List</Label><Select id="workspace-detail-list" name="bucketId" value={task.bucketId || ""} disabled={Boolean(task.parentTaskId)} onChange={event => set("bucketId", event.target.value)}>{lists.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></div>
                  <div className="property-row"><Label>Priority</Label><PriorityPicker value={(task.priority || "p1") as Priority} onChange={value => set("priority", value)} allowNone={false} /></div>
                  <div className="property-row"><Label htmlFor="workspace-detail-date">Plan for</Label><Input id="workspace-detail-date" name="scheduledDate" type="date" value={task.scheduledDate || ""} onChange={event => set("scheduledDate", event.target.value)} /></div>
                  <div className="properties-note"><strong>Task details</strong><p>Keep the outcome clear, assign an owner, and use priority to signal what matters most.</p></div>
                </aside>
              </div>
              <footer className="detail-footer"><Button id="delete-task" type="button" variant="ghost" className="text-destructive" onClick={() => { if (window.confirm("Delete this task and its subtasks?")) remove.mutate() }} disabled={remove.isPending}><Trash2 className="size-4" />{remove.isPending ? "Deleting…" : "Delete task"}</Button><Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save changes"}</Button></footer>
            </form>
          )}
        </section>
      </DialogContent>
    </Dialog>
  )
}
