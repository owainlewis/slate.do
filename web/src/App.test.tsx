import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import App from "./App"
import { workspaceSummaryQueryKeyFor } from "@/lib/types"

afterEach(() => {
  cleanup()
  document.documentElement.classList.remove("dark")
  vi.unstubAllGlobals()
})

function renderApp(path = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></QueryClientProvider>)
}

test("workspace summary cache entries are isolated by account", () => {
  const client = new QueryClient()
  client.setQueryData(workspaceSummaryQueryKeyFor("account-a"), { activeTasks: 4 })
  expect(client.getQueryData(workspaceSummaryQueryKeyFor("account-a"))).toEqual({ activeTasks: 4 })
  expect(client.getQueryData(workspaceSummaryQueryKeyFor("account-b"))).toBeUndefined()
})

test("login discards cached data from the previous account", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(["lists"], { lists: [{ id: "old-list", name: "Old private list", isInbox: true }] })
  client.setQueryData(["tasks", "all", "", "limit=200&topLevel=true"], {
    pages: [{ tasks: [{ id: "old-task", title: "Old private task", bucketId: "old-list", status: "new", priority: "p1" }] }],
    pageParams: [""],
  })
  let authenticated = false
  const requests: string[] = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    const method = init?.method || "GET"
    requests.push(`${method} ${path}`)
    if (path === "/api/v1/me") return new Response(JSON.stringify(authenticated ? { authenticated: true, user: { id: "new-owner", email: "new@example.com", displayName: "New Owner", theme: "light" } } : { authenticated: false }), { status: 200 })
    if (path === "/api/v1/auth/login") { authenticated = true; return new Response(JSON.stringify({ authenticated: true }), { status: 200 }) }
    if (path === "/api/v1/lists") return new Response(JSON.stringify({ lists: [{ id: "new-inbox", name: "Inbox", isInbox: true }] }), { status: 200 })
    if (path === "/api/v1/agents") return new Response(JSON.stringify({ agents: [] }), { status: 200 })
    if (path.startsWith("/api/v1/tasks?")) return new Response(JSON.stringify({ tasks: [] }), { status: 200 })
    return new Response(JSON.stringify({}), { status: 200 })
  }))

  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/login"]}><App /></MemoryRouter></QueryClientProvider>)
  await screen.findByRole("heading", { name: "Welcome back." })
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } })
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "new-password" } })
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }))

  await screen.findByRole("heading", { name: "All tasks" })
  expect(screen.queryByText("Old private task")).not.toBeInTheDocument()
  expect(screen.queryByText("Old private list")).not.toBeInTheDocument()
  expect(requests).toContain("GET /api/v1/lists")
  expect(requests.some(request => request.startsWith("GET /api/v1/tasks?"))).toBe(true)
})

test("the landing page explains Slate as a shared task list", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ authenticated: false }), { status: 200 })))
  renderApp()
  expect(await screen.findByRole("heading", { name: /one shared task list for you and your agents/i })).toBeInTheDocument()
  expect(screen.getByText(/slate keeps every task, brief, conversation and result in one place/i)).toBeInTheDocument()
  expect(screen.getByRole("heading", { name: "Save reusable templates" })).toBeInTheDocument()
  expect(screen.getAllByRole("link", { name: /log in/i })[0]).toHaveAttribute("href", "/login")
})

test("the login form preserves protected destinations", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ authenticated: false }), { status: 200 })))
  renderApp("/login?next=%2Fapp%2Ftasks")
  expect(await screen.findByRole("heading", { name: "Welcome back." })).toBeInTheDocument()
  expect(screen.getByLabelText("Email")).toBeRequired()
  expect(screen.getByLabelText("Password")).toBeRequired()
})

test("the templates route starts new accounts without shared defaults", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://slate.test").pathname
    if (path === "/api/v1/me") return new Response(JSON.stringify({ authenticated: true, user: { id: "user-1", email: "customer@example.com", displayName: "Customer", theme: "light" } }), { status: 200 })
    if (path === "/api/v1/lists") return new Response(JSON.stringify({ lists: [{ id: "list-1", name: "Product", isInbox: false }] }), { status: 200 })
    if (path === "/api/v1/agents") return new Response(JSON.stringify({ agents: [] }), { status: 200 })
    return new Response(JSON.stringify({}), { status: 200 })
  }))
  const { container } = renderApp("/app/templates")
  expect(await screen.findByRole("heading", { name: "Templates" })).toBeInTheDocument()
  expect(screen.getByRole("heading", { name: "No templates yet" })).toBeInTheDocument()
  expect(container.querySelectorAll(".template-list-row")).toHaveLength(0)
})

test.each([
  ["/", /one shared task list for you and your agents/i],
  ["/login", "Welcome back."],
  ["/forgot-password", "Reset your password."],
  ["/reset-password", "Choose a new password."],
  ["/early-access", "Join Slate."],
  ["/missing", "Not found."],
])("the public route %s always uses the light theme", async (path, heading) => {
  document.documentElement.classList.add("dark")
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ authenticated: false }), { status: 200 })))
  renderApp(path)
  expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument()
  expect(document.documentElement).not.toHaveClass("dark")
})
