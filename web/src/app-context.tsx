import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Navigate, useLocation } from "react-router-dom"
import { api } from "@/lib/api"
import type { Agent, List, User } from "@/lib/types"

interface MeResponse { authenticated: boolean; user?: User }
interface ListsResponse { lists: List[] }
interface AgentsResponse { agents: Agent[]; maxAgents?: number }

interface AppContextValue {
  me: User
  lists: List[]
  agents: Agent[]
  maxAgents: number
  refreshLists: () => Promise<unknown>
  refreshAgents: () => Promise<unknown>
  updateMe: (user: User) => void
}

const AppContext = React.createContext<AppContextValue | null>(null)

export function useSession() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<MeResponse>("/api/v1/me"),
    staleTime: 30_000,
    retry: false,
  })
}

export function Authenticated({ children }: { children: React.ReactNode }) {
  const session = useSession()
  const location = useLocation()
  const queryClient = useQueryClient()
  const authenticated = Boolean(session.data?.authenticated && session.data.user)
  const listsQuery = useQuery({
    queryKey: ["lists"],
    queryFn: () => api.get<ListsResponse>("/api/v1/lists"),
    enabled: authenticated,
  })
  const agentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<AgentsResponse>("/api/v1/agents"),
    enabled: authenticated,
  })

  React.useEffect(() => {
    const theme = session.data?.user?.theme === "light" ? "light" : "dark"
    document.documentElement.classList.toggle("dark", theme === "dark")
  }, [session.data?.user?.theme])

  if (session.isPending) return <div className="loading-page"><div className="spinner" aria-label="Loading Slate" /></div>
  if (!authenticated) {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={`/login${next === "/app" ? "" : `?next=${encodeURIComponent(next)}`}`} replace />
  }
  if (listsQuery.isPending || agentsQuery.isPending) return <div className="loading-page"><div className="spinner" aria-label="Loading workspace" /></div>

  const me = session.data!.user!
  const value: AppContextValue = {
    me,
    lists: listsQuery.data?.lists || [],
    agents: agentsQuery.data?.agents || [],
    maxAgents: agentsQuery.data?.maxAgents || me.entitlement?.limits?.agents || 5,
    refreshLists: () => queryClient.invalidateQueries({ queryKey: ["lists"] }),
    refreshAgents: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
    updateMe: user => queryClient.setQueryData<MeResponse>(["me"], { authenticated: true, user }),
  }
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const value = React.useContext(AppContext)
  if (!value) throw new Error("useApp must be used inside Authenticated")
  return value
}

export function initials(value: string) {
  return value.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "S"
}
