import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { NavLink, useLocation, useNavigate } from "react-router-dom"
import { Bot, CalendarDays, ChevronDown, CircleDot, Inbox, ListTodo, LogOut, Menu, Plus, Play, Settings, UserRound, Workflow, X } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input, Label, Select, Textarea } from "@/components/ui/field"
import { PriorityPicker, type Priority } from "@/components/priority"
import { useApp, initials } from "@/app-context"
import { api } from "@/lib/api"
import type { List, Task, TaskStatus } from "@/lib/types"

export function Brand({ onClick }: { onClick?: () => void }) {
  return <button type="button" className="brand-mark" onClick={onClick} aria-label="Slate home">slate<span>.do</span></button>
}

function NavigationLink({ to, icon: Icon, children, count, id }: { to: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; count?: number; id?: string }) {
  return <NavLink id={id} to={to} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}><Icon /><span>{children}</span>{typeof count === "number" && count > 0 && <span className="count">{count}</span>}</NavLink>
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me, lists, agents, refreshLists } = useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [listDialog, setListDialog] = React.useState(false)
  const [listName, setListName] = React.useState("")
  const [listError, setListError] = React.useState("")
  const [taskDialog, setTaskDialog] = React.useState(false)
  const [taskTitle, setTaskTitle] = React.useState("")
  const [taskDescription, setTaskDescription] = React.useState("")
  const [taskList, setTaskList] = React.useState("")
  const [taskAgent, setTaskAgent] = React.useState("")
  const [taskPriority, setTaskPriority] = React.useState<Priority>("p1")
  const [taskDate, setTaskDate] = React.useState("")
  const [taskStatus, setTaskStatus] = React.useState<TaskStatus>("new")

  React.useEffect(() => setMobileOpen(false), [location.pathname])

  const createTask = useMutation({
    mutationFn: async () => {
      const endpoint = taskList ? `/api/v1/lists/${encodeURIComponent(taskList)}/tasks` : "/api/v1/tasks"
      return api.post<Task>(endpoint, { title: taskTitle.trim(), description: taskDescription.trim(), kind: "action", status: taskStatus, priority: taskPriority, assigneeAgentId: taskAgent, scheduledDate: taskDate }, { "Idempotency-Key": crypto.randomUUID() })
    },
    onSuccess: async task => {
      await queryClient.invalidateQueries({ queryKey: ["tasks"] })
      setTaskDialog(false)
      setTaskTitle("")
      setTaskDescription("")
      setTaskAgent("")
      setTaskPriority("p1")
      setTaskDate("")
      setTaskStatus("new")
      navigate(`/app/tasks/${encodeURIComponent(task.id)}`)
    },
  })

  const createList = useMutation({
    mutationFn: () => api.post<List>("/api/v1/lists", { name: listName.trim() }),
    onSuccess: async list => {
      await refreshLists()
      setListDialog(false)
      setListName("")
      navigate(`/app/lists/${encodeURIComponent(list.id)}`)
    },
    onError: error => setListError(error instanceof Error ? error.message : "Could not create list"),
  })

  const logout = useMutation({
    mutationFn: () => api.post("/api/v1/auth/logout"),
    onSettled: () => {
      queryClient.clear()
      navigate("/login", { replace: true })
    },
  })

  const inbox = lists.find(list => list.isInbox)
  const openTaskDialog = React.useCallback((status: TaskStatus = "new") => {
    const match = location.pathname.match(/^\/app\/lists\/([^/]+)/)
    setTaskList(match ? decodeURIComponent(match[1]) : (inbox?.id || ""))
    setTaskStatus(status)
    createTask.reset()
    setTaskDialog(true)
  }, [createTask, inbox?.id, location.pathname])
  React.useEffect(() => {
    const open = (event: Event) => openTaskDialog((event as CustomEvent<{ status?: TaskStatus }>).detail?.status || "new")
    window.addEventListener("slate:new-task", open)
    return () => window.removeEventListener("slate:new-task", open)
  }, [openTaskDialog])
  React.useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key.toLowerCase() !== "c" || event.metaKey || event.ctrlKey || event.altKey || target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName || "")) return
      event.preventDefault()
      openTaskDialog()
    }
    window.addEventListener("keydown", shortcut)
    return () => window.removeEventListener("keydown", shortcut)
  }, [openTaskDialog])
  return (
    <div className="app-grid">
      {mobileOpen && <button className="fixed inset-0 z-30 bg-foreground/25 md:hidden" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`app-sidebar ${mobileOpen ? "open" : ""}`} id="primary-navigation">
        <div className="sidebar-top">
          <Brand onClick={() => navigate("/")} />
          <Button className="mobile-nav-trigger" variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X className="size-4" /></Button>
        </div>
        <Button className="new-task-button" variant="ghost" onClick={() => openTaskDialog()}><Plus className="size-4" /><span>New task</span><kbd>C</kbd></Button>
        <nav className="sidebar-nav" aria-label="Primary navigation">
          <div className="nav-group">
            <NavigationLink to="/app/inbox" icon={Inbox} count={inbox?.openCount}>Inbox</NavigationLink>
            <NavigationLink to="/app/tasks" icon={ListTodo}>All tasks</NavigationLink>
          </div>
          <div className="nav-group">
            <div className="nav-label"><span>Lists</span><button type="button" onClick={() => { setListError(""); setListDialog(true) }} aria-label="New list"><Plus className="size-3.5" /></button></div>
            {lists.filter(list => !list.isInbox).map(list => <NavigationLink key={list.id} to={`/app/lists/${encodeURIComponent(list.id)}`} icon={CircleDot} count={list.openCount}>{list.name}</NavigationLink>)}
          </div>
          <div className="nav-group">
            <div className="nav-label"><span>Agents</span></div>
            <NavigationLink id="agents-nav" to="/app/agents" icon={Bot}>Agents</NavigationLink>
            <NavigationLink to="/app/runs" icon={Play}>Runs</NavigationLink>
            <NavigationLink to="/app/runners" icon={Workflow}>Runners</NavigationLink>
          </div>
        </nav>
        <div className="sidebar-user">
          <div className="avatar" aria-hidden="true">{initials(me.displayName || me.email)}</div>
          <div className="sidebar-user-copy"><strong>{me.displayName || me.email.split("@")[0]}</strong><small>{me.email}</small></div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button id="account-menu" variant="ghost" size="icon" aria-label="Account menu"><ChevronDown className="size-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => navigate("/app/settings/profile")}><UserRound className="size-4" />Profile</DropdownMenuItem>
              <DropdownMenuItem id="settings" onSelect={() => navigate("/app/settings/preferences")}><Settings className="size-4" />Settings</DropdownMenuItem>
              <DropdownMenuItem id="logout" onSelect={() => logout.mutate()}><LogOut className="size-4" />Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
      <main className="app-main">
        <Button className="mobile-nav-trigger fixed left-3 top-3 z-20 shadow-lg" variant="secondary" size="icon" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu className="size-4" /></Button>
        {children}
      </main>
      <Dialog open={listDialog} onOpenChange={setListDialog}>
        <DialogContent>
          <form onSubmit={event => { event.preventDefault(); if (!listName.trim()) return setListError("List name is required."); createList.mutate() }}>
            <DialogHeader><DialogTitle>New list</DialogTitle><DialogDescription>Create a clear context for a project, goal or area of work.</DialogDescription></DialogHeader>
            <Label htmlFor="workspace-list-name">Name</Label>
            <Input id="workspace-list-name" value={listName} onChange={event => setListName(event.target.value)} autoFocus maxLength={120} />
            {listError && <p className="status-message error mt-3" role="alert">{listError}</p>}
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setListDialog(false)}>Cancel</Button><Button id="confirm-workspace-list-dialog" type="submit" disabled={createList.isPending}>{createList.isPending ? "Creating…" : "Create list"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={taskDialog} onOpenChange={setTaskDialog}>
        <DialogContent className="task-create-dialog" showClose={false} aria-describedby={undefined}>
          <DialogTitle className="sr-only">New task</DialogTitle>
          <form className="task-create-form" onSubmit={event => { event.preventDefault(); if (taskTitle.trim()) createTask.mutate() }}>
            <div className="task-create-head"><div><span>{me.displayName || me.email.split("@")[0]}</span><strong>New task</strong></div><button type="button" onClick={() => setTaskDialog(false)} aria-label="Close"><X /></button></div>
            <div className="task-create-body">
              <Input className="task-create-title" aria-label="Task title" value={taskTitle} onChange={event => setTaskTitle(event.target.value)} placeholder="What needs to happen?" autoFocus />
              <Textarea className="task-create-description" aria-label="Task brief" value={taskDescription} onChange={event => setTaskDescription(event.target.value)} placeholder="Add context, an outcome, or a definition of done…" />
              <div className="task-create-properties">
                <label><span>List</span><Select aria-label="Task list" value={taskList} onChange={event => setTaskList(event.target.value)}>{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</Select></label>
                <label><span>Owner</span><Select aria-label="Task owner" value={taskAgent} onChange={event => setTaskAgent(event.target.value)}><option value="">You</option>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.displayName}</option>)}</Select></label>
                <label><span>Plan for</span><span className="date-property"><CalendarDays /><Input aria-label="Plan for" type="date" value={taskDate} onChange={event => setTaskDate(event.target.value)} /></span></label>
                <label><span>Priority</span><PriorityPicker value={taskPriority} onChange={setTaskPriority} allowNone={false} /></label>
              </div>
            </div>
            {createTask.isError && <p className="status-message error mx-6 mb-2" role="alert">{createTask.error.message}</p>}
            <div className="task-create-footer"><span>This task will start in {taskStatus === "working" ? "In Progress" : taskStatus === "needs_review" ? "Review" : taskStatus === "done" ? "Done" : "Todo"}.</span><div><Button type="button" variant="ghost" onClick={() => setTaskDialog(false)}>Cancel</Button><Button type="submit" disabled={!taskTitle.trim() || createTask.isPending}>{createTask.isPending ? "Creating…" : "Create task"}</Button></div></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
