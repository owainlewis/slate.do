import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ArrowRight, CheckCircle2 } from "lucide-react"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { Brand } from "@/components/shell"
import { Button } from "@/components/ui/button"
import { Input, Label, Textarea } from "@/components/ui/field"
import { useSession } from "@/app-context"
import { api } from "@/lib/api"
import type { User } from "@/lib/types"

const landingPreviewColumns = [
  {
    title: "Todo",
    tone: "todo",
    tasks: [
      { priority: "High", list: "Product", title: "Tighten first-run onboarding", description: "Help a new operator understand lists, agents and flow.", date: "Aug 21" },
      { priority: "Urgent", list: "Company", title: "Plan September launch", description: "Turn the product story into a focused launch plan.", date: "Aug 24", agent: "Research" },
    ],
  },
  {
    title: "In progress",
    tone: "progress",
    tasks: [
      { priority: "Urgent", list: "Product", title: "Ship the React workspace", description: "Replace the global renderer with a calm interface.", date: "Aug 18", agent: "Research" },
      { priority: "High", list: "Product", title: "Audit agent handoff states", description: "Make every transition between people and agents explicit.", date: "Aug 22", agent: "Research" },
    ],
  },
  {
    title: "Review",
    tone: "review",
    tasks: [
      { priority: "High", list: "Writing", title: "Edit the agent-speed essay", description: "Make the core argument tighter and more concrete.", date: "Aug 19", agent: "Editorial" },
      { priority: "Normal", list: "Company", title: "Review the launch brief", description: "Resolve the final positioning questions before design starts.", date: "Aug 23" },
    ],
  },
  {
    title: "Done",
    tone: "done",
    tasks: [
      { priority: "Normal", list: "Company", title: "Review weekly product signals", description: "Decide what changed and what deserves attention next.", date: "Aug 17" },
      { priority: "High", list: "Writing", title: "Publish the operator guide", description: "Turn the approved draft into final documentation.", date: "Aug 18", agent: "Editorial" },
    ],
  },
]

function LandingProductPreview() {
  return (
    <div className="landing-preview" aria-hidden="true">
      <aside className="landing-preview-sidebar">
        <div className="landing-preview-brand"><i /><strong>slate<span>.do</span></strong></div>
        <div className="landing-preview-new"><b>＋</b><strong>New task</strong><kbd>C</kbd></div>
        <div className="landing-preview-nav">
          <span>▱ <b>Inbox</b><small>2</small></span>
          <span className="active">☷ <b>All tasks</b></span>
        </div>
        <p>Lists <b>＋</b></p>
        <div className="landing-preview-nav muted">
          <span>○ <b>Product</b><small>5</small></span>
          <span>○ <b>Company</b><small>3</small></span>
          <span>○ <b>Writing</b><small>4</small></span>
        </div>
        <p>Agents</p>
        <div className="landing-preview-nav muted">
          <span>⌁ <b>Agents</b></span>
          <span>▷ <b>Runs</b></span>
          <span>⌘ <b>Runners</b></span>
        </div>
        <div className="landing-preview-user"><i>OL</i><strong>Owain Lewis</strong></div>
      </aside>
      <section className="landing-preview-main">
        <header>
          <h3>All tasks</h3>
        </header>
        <div className="landing-preview-toolbar">
          <div className="landing-preview-search">⌕ <span>Search tasks…</span></div>
          <div className="landing-preview-filter">Any agent⌄</div>
          <div className="landing-preview-filter">Any priority⌄</div>
          <div className="landing-preview-views"><b>▥ Board</b><span>▤ Table</span></div>
        </div>
        <div className="landing-preview-board">
          {landingPreviewColumns.map(column => (
            <section className={`landing-preview-column ${column.tone}`} key={column.title}>
              <header><strong><i />{column.title}</strong><span>{column.tasks.length}</span><b>＋</b></header>
              <div>
                {column.tasks.map(task => (
                  <article className="landing-preview-card" key={task.title}>
                    <div className="landing-preview-meta"><span className={task.priority.toLowerCase()}>⚑ {task.priority}</span><small>{task.list}</small></div>
                    <h4>{task.title}</h4>
                    <p>{task.description}</p>
                    <footer><span>▣ {task.date}</span>{task.agent && <small><i>{task.agent.slice(0, 1)}</i>{task.agent}</small>}</footer>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </div>
  )
}

export function LandingPage() {
  const session = useSession()
  const signedIn = Boolean(session.data?.authenticated)
  return (
    <div className="landing-page">
      <header className="landing-hero-shell">
        <nav className="landing-nav">
          <Brand />
          <div className="landing-nav-links"><a href="/cli">CLI guide</a><Button asChild size="sm" className="landing-nav-cta"><Link to={signedIn ? "/app/tasks" : "/login"}>{signedIn ? "Open app" : "Log in"}<ArrowRight className="size-3.5" /></Link></Button></div>
        </nav>
        <section className="hero">
          <div className="hero-copy">
            <p className="landing-kicker">Task management for people and AI agents</p>
            <h1>Turn repeatable work into <em>executable SOPs.</em></h1>
            <p>Slate is a shared task system for you and your AI agents. Templates turn recurring processes into executable SOPs, keeping every task, handoff and result in one place.</p>
            <div className="hero-actions"><Button asChild size="lg" className="landing-primary-cta"><Link to={signedIn ? "/app/tasks" : "/login"}>{signedIn ? "Open Slate" : "Log in to Slate"}<ArrowRight className="size-4" /></Link></Button><Button asChild size="lg" variant="ghost" className="landing-secondary-cta"><a href="mailto:owain@gradientwork.com?subject=Slate access">Request access</a></Button></div>
            <div className="hero-proof" aria-label="Slate principles"><span>Reusable templates</span><span>Human + agent tasks</span><span>One shared record</span></div>
          </div>
          <figure className="hero-product">
            <div className="hero-product-bar" aria-hidden="true"><i /><i /><i /><span>slate.do / focus</span></div>
            <LandingProductPreview />
            <figcaption>Slate showing tasks moving from todo through progress and review to done.</figcaption>
          </figure>
        </section>
      </header>
      <main>
        <section className="landing-section">
          <p className="landing-kicker">From process to progress</p>
          <h2>Build the process once. Run it whenever the work comes up.</h2>
          <div className="principles">
            <article className="principle"><span>01</span><h3>Organise the work</h3><p>Use lists and priorities to keep projects, commitments and next steps clear.</p></article>
            <article className="principle"><span>02</span><h3>Create executable SOPs</h3><p>Turn a repeatable process into a template with phases, ordered tasks and the context needed to do the work.</p></article>
            <article className="principle"><span>03</span><h3>Run with people and agents</h3><p>Start a template to create the work. Slate keeps each handoff, status and output visible from start to finish.</p></article>
          </div>
        </section>
      </main>
    </div>
  )
}

function AuthLayout({ children, quote = "Work is infinite. Attention is not." }: { children: React.ReactNode; quote?: string }) {
  return <div className="auth-shell"><section className="auth-panel"><Brand />{children}</section><aside className="auth-art"><img src="/landing-slabs.jpg" alt="Slate slabs against a pale wall" /><div className="auth-art-copy"><p>{quote}</p></div></aside></div>
}

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/app") || value.startsWith("//") || value.includes("\\")) return "/app/tasks"
  return value
}

export function LoginPage() {
  const session = useSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const login = useMutation({
    mutationFn: () => api.post("/api/v1/auth/login", { email, password }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] })
      navigate(safeNext(params.get("next")), { replace: true })
    },
  })
  if (session.data?.authenticated) return <Navigate to={safeNext(params.get("next"))} replace />
  return <AuthLayout><div className="auth-form-wrap"><h1>Welcome back.</h1><p>Sign in to your operating plan and pick up exactly where you left off.</p><form className="form-stack" id="login-form" onSubmit={event => { event.preventDefault(); login.mutate() }}><div><Label htmlFor="login-email">Email</Label><Input id="login-email" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required /></div><div><Label htmlFor="login-password">Password</Label><Input id="login-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required /></div>{login.isError && <p className="status-message error" role="alert">{login.error.message}</p>}<Button type="submit" size="lg" disabled={login.isPending}>{login.isPending ? "Signing in…" : "Sign in"}</Button></form><div className="auth-links"><Link to="/forgot-password">Forgot password?</Link><Link to="/early-access">Have an invite?</Link></div></div></AuthLayout>
}

export function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("")
  const request = useMutation({ mutationFn: () => api.post<{ message?: string }>("/api/v1/auth/password-reset/request", { email }) })
  return <AuthLayout quote="A clear system makes room for better decisions."><div className="auth-form-wrap"><h1>Reset your password.</h1><p>Enter your account email and we’ll send a secure reset link.</p><form className="form-stack" id="forgot-password-form" onSubmit={event => { event.preventDefault(); request.mutate() }}><div><Label htmlFor="reset-email">Email</Label><Input id="reset-email" type="email" value={email} onChange={event => setEmail(event.target.value)} required /></div>{request.isSuccess && <p className="status-message"><CheckCircle2 className="mr-2 inline size-4" />{request.data.message || "If an account exists, a reset link is on its way."}</p>}{request.isError && <p className="status-message error" role="alert">{request.error.message}</p>}<Button type="submit" disabled={request.isPending}>{request.isPending ? "Sending…" : "Send reset link"}</Button></form><div className="auth-links"><Link to="/login">Back to sign in</Link></div></div></AuthLayout>
}

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get("token") || ""
  const [password, setPassword] = React.useState("")
  const reset = useMutation({ mutationFn: () => api.post("/api/v1/auth/password-reset/confirm", { token, password }), onSuccess: () => navigate("/login", { replace: true }) })
  return <AuthLayout><div className="auth-form-wrap"><h1>Choose a new password.</h1><p>Use at least 8 characters, up to 72 bytes.</p>{token ? <form className="form-stack" id="reset-password-form" onSubmit={event => { event.preventDefault(); reset.mutate() }}><div><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" minLength={8} maxLength={72} value={password} onChange={event => setPassword(event.target.value)} required /></div>{reset.isError && <p className="status-message error" role="alert">{reset.error.message}</p>}<Button type="submit" disabled={reset.isPending}>{reset.isPending ? "Resetting…" : "Reset password"}</Button></form> : <p className="status-message error" role="alert">This reset link is invalid. Request a new one.</p>}<div className="auth-links"><Link to="/login">Back to sign in</Link></div></div></AuthLayout>
}

export function EarlyAccessPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = React.useState({ email: "", password: "", displayName: "", inviteCode: "" })
  const register = useMutation({
    mutationFn: () => api.post<{ user?: User }>("/api/v1/auth/register", form),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["me"] }); navigate("/app/tasks", { replace: true }) },
  })
  const field = (name: keyof typeof form) => ({ value: form[name], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(value => ({ ...value, [name]: event.target.value })) })
  return <AuthLayout quote="Build a plan you can trust. Then let agents help you run it."><div className="auth-form-wrap"><h1>Join Slate.</h1><p>Create your account with an invitation code.</p><form className="form-stack" id="early-access-form" onSubmit={event => { event.preventDefault(); register.mutate() }}><div><Label htmlFor="register-name">Display name</Label><Input id="register-name" {...field("displayName")} required /></div><div><Label htmlFor="register-email">Email</Label><Input id="register-email" type="email" {...field("email")} required /></div><div><Label htmlFor="register-password">Password</Label><Input id="register-password" type="password" minLength={8} maxLength={72} {...field("password")} required /></div><div><Label htmlFor="register-code">Invitation code</Label><Input id="register-code" type="password" {...field("inviteCode")} required /></div>{register.isError && <p className="status-message error" role="alert">{register.error.message}</p>}<Button type="submit" disabled={register.isPending}>{register.isPending ? "Creating account…" : "Create account"}</Button></form><div className="auth-links"><Link to="/login">Already have an account?</Link></div></div></AuthLayout>
}

export function NotFoundPage() {
  return <AuthLayout quote="The useful path is usually the simplest one."><div className="auth-form-wrap"><h1>Not found.</h1><p>That page does not exist, or it is no longer available to you.</p><Button asChild><Link to="/">Go to Slate</Link></Button></div></AuthLayout>
}
