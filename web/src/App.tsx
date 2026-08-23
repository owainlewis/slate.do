import { useLayoutEffect } from "react"
import { Navigate, Outlet, Route, Routes } from "react-router-dom"
import { Authenticated } from "@/app-context"
import { AppShell } from "@/components/shell"
import { LandingPage, LoginPage, ForgotPasswordPage, ResetPasswordPage, EarlyAccessPage, NotFoundPage } from "@/pages/public"
import { WorkspacePage } from "@/pages/workspace"
import { AgentDetailPage, AgentsPage, InboxPage, NewAgentPage, RunnersPage, RunsPage, SettingsPage } from "@/pages/other"
import { TemplatesPage } from "@/pages/templates"

function ProtectedRoutes() {
  return (
    <Authenticated>
      <AppShell>
        <Routes>
          <Route index element={<Navigate to="tasks" replace />} />
          <Route path="tasks" element={<WorkspacePage />} />
          <Route path="tasks/:taskId" element={<WorkspacePage />} />
          <Route path="lists/:listId" element={<WorkspacePage />} />
          <Route path="lists/:listId/tasks/:taskId" element={<WorkspacePage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="agents/new" element={<NewAgentPage />} />
          <Route path="agents/:agentId" element={<AgentDetailPage />} />
          <Route path="agents/:agentId/:tab" element={<AgentDetailPage />} />
          <Route path="settings" element={<Navigate to="profile" replace />} />
          <Route path="settings/:page" element={<SettingsPage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="runners" element={<RunnersPage />} />
          <Route path="today" element={<Navigate to="/app/tasks" replace />} />
          <Route path="week" element={<Navigate to="/app/tasks" replace />} />
          <Route path="review" element={<Navigate to="/app/tasks?status=needs_review" replace />} />
          <Route path="boards/*" element={<Navigate to="/app/tasks" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AppShell>
    </Authenticated>
  )
}

function PublicRouteLayout() {
  useLayoutEffect(() => {
    const wasDark = document.documentElement.classList.contains("dark")
    document.documentElement.classList.remove("dark")
    return () => {
      document.documentElement.classList.toggle("dark", wasDark)
    }
  }, [])
  return <Outlet />
}

export default function App() {
  return (
    <Routes>
      <Route path="/app/*" element={<ProtectedRoutes />} />
      <Route element={<PublicRouteLayout />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/early-access" element={<EarlyAccessPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
