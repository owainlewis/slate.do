import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import App from "./App"

afterEach(() => {
  cleanup()
  document.documentElement.classList.remove("dark")
  vi.unstubAllGlobals()
})

function renderApp(path = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></QueryClientProvider>)
}

test("the landing page leads with Slate's outcome", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ authenticated: false }), { status: 200 })))
  renderApp()
  expect(await screen.findByRole("heading", { name: /one operating plan/i })).toBeInTheDocument()
  expect(screen.getAllByRole("link", { name: /log in/i })[0]).toHaveAttribute("href", "/login")
})

test("the login form preserves protected destinations", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ authenticated: false }), { status: 200 })))
  renderApp("/login?next=%2Fapp%2Ftasks")
  expect(await screen.findByRole("heading", { name: "Welcome back." })).toBeInTheDocument()
  expect(screen.getByLabelText("Email")).toBeRequired()
  expect(screen.getByLabelText("Password")).toBeRequired()
})

test.each([
  ["/", /one operating plan/i],
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
