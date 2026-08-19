import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { NavLink, useLocation, useNavigate } from "react-router-dom"
import { Bot, ChevronDown, CircleDot, Inbox, ListTodo, LogOut, Menu, Plus, Play, Settings, UserRound, Workflow, X } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input, Label } from "@/components/ui/field"
import { useApp, initials } from "@/app-context"
import { api } from "@/lib/api"
import type { List, Task } from "@/lib/types"

export function Brand({ onClick }: { onClick?: () => void }) {
  return <button type="button" className="brand-mark" onClick={onClick} aria-label="Slate home">slate<span>.do</span></button>
}

function NavigationLink({ to, icon: Icon, children, count, id }: { to: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; count?: number; id?: string }) {
  return <NavLink id={id} to={to} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}><Icon /><span>{children}</span>{typeof count === "number" && count > 0 && <span className="count">{count}</span>}</NavLink>
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me, lists, refreshLists } = useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [listDialog, setListDialog] = React.useState(false)
  const [listName, setListName] = React.useState("")
  const [listError, setListError] = React.useState("")

  React.useEffect(() => setMobileOpen(false), [location.pathname])

  const createTask = useMutation({
    mutationFn: async () => {
      const match = location.pathname.match(/^\/app\/lists\/([^/]+)/)
      const endpoint = match ? `/api/v1/lists/${encodeURIComponent(decodeURIComponent(match[1]))}/tasks` : "/api/v1/tasks"
      return api.post<Task>(endpoint, { title: "Untitled task", description: "", kind: "action" }, { "Idempotency-Key": crypto.randomUUID() })
    },
    onSuccess: async task => {
      await queryClient.invalidateQueries({ queryKey: ["tasks"] })
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
  return (
    <div className="app-grid">
      {mobileOpen && <button className="fixed inset-0 z-30 bg-foreground/25 md:hidden" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`app-sidebar ${mobileOpen ? "open" : ""}`} id="primary-navigation">
        <div className="sidebar-top">
          <Brand onClick={() => navigate("/")} />
          <Button className="mobile-nav-trigger" variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X className="size-4" /></Button>
        </div>
        <Button className="mb-3 w-full justify-start" onClick={() => createTask.mutate()} disabled={createTask.isPending}><Plus className="size-4" />{createTask.isPending ? "Creating…" : "New task"}</Button>
        {createTask.isError && <p className="status-message error mb-2" role="alert">{createTask.error.message}</p>}
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
    </div>
  )
}
