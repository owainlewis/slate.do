import { Navigate, Route, Routes } from "react-router-dom"
import { Authenticated } from "@/app-context"
import { AppShell } from "@/components/shell"
import { LandingPage, LoginPage, ForgotPasswordPage, ResetPasswordPage, EarlyAccessPage, NotFoundPage } from "@/pages/public"
import { WorkspacePage } from "@/pages/workspace"
import { AgentDetailPage, AgentsPage, ExecutionPlaceholder, InboxPage, NewAgentPage, SettingsPage } from "@/pages/other"

function ProtectedRoutes() {
  return (
    <Authenticated>
      <AppShell>
        <Routes>
          <Route index element={<Navigate to="tasks" replace />} />
          <Route path="tasks" element={<WorkspacePage />} />
          <Route path="tasks/:taskId" element={<WorkspacePage />} />
          <Route path="lists/:listId" element={<WorkspacePage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="agents/new" element={<NewAgentPage />} />
          <Route path="agents/:agentId" element={<AgentDetailPage />} />
          <Route path="agents/:agentId/:tab" element={<AgentDetailPage />} />
          <Route path="settings" element={<Navigate to="profile" replace />} />
          <Route path="settings/:page" element={<SettingsPage />} />
          <Route path="runs" element={<ExecutionPlaceholder type="runs" />} />
          <Route path="runners" element={<ExecutionPlaceholder type="runners" />} />
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

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/early-access" element={<EarlyAccessPage />} />
      <Route path="/app/*" element={<ProtectedRoutes />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
