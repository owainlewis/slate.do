import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Bot, CalendarDays, Check, Clapperboard, FileText, Play, UserRound, Workflow, X } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input, Label, Select } from "@/components/ui/field"
import { useApp } from "@/app-context"
import { api } from "@/lib/api"
import type { Task } from "@/lib/types"

type Executor = "Human" | "Agent-ready" | "Automation"

interface TemplateStep {
  phase: "Define" | "Produce" | "Publish" | "Repurpose"
  title: string
  executor: Executor
  instruction: string
}

const youtubeSteps: TemplateStep[] = [
  { phase: "Define", title: "Capture the idea", executor: "Human", instruction: "Write down the audience, problem, promise and reason this video should exist." },
  { phase: "Define", title: "Generate title options", executor: "Agent-ready", instruction: "Generate strong title options from the idea, audience and core promise." },
  { phase: "Define", title: "Approve the title", executor: "Human", instruction: "Choose the title that makes the clearest promise without overstating the video." },
  { phase: "Define", title: "Write the outline", executor: "Human", instruction: "Map the argument, examples and teaching sequence before writing the full script." },
  { phase: "Define", title: "Handwrite the introduction", executor: "Human", instruction: "Write the opening hook in your own words and make the payoff clear." },
  { phase: "Define", title: "Write the script", executor: "Agent-ready", instruction: "Turn the approved outline and introduction into a complete recording script." },
  { phase: "Produce", title: "Record the video", executor: "Human", instruction: "Record the approved script and store the raw footage in the content folder." },
  { phase: "Produce", title: "Edit the video", executor: "Human", instruction: "Edit the recording into the finished YouTube cut." },
  { phase: "Produce", title: "Export the final MP4", executor: "Human", instruction: "Export the approved master and add the canonical file location as an output." },
  { phase: "Publish", title: "Generate the transcript", executor: "Automation", instruction: "Transcribe the final MP4 and save the transcript in the content workspace." },
  { phase: "Publish", title: "Write the YouTube description", executor: "Agent-ready", instruction: "Create the description from the approved title, transcript, CTA and resource links." },
  { phase: "Publish", title: "Complete the publishing check", executor: "Human", instruction: "Verify the video, title, description and required publishing assets before release." },
  { phase: "Repurpose", title: "Write the Kit promotional email", executor: "Agent-ready", instruction: "Turn the transcript into a concise email that earns the click to the video." },
  { phase: "Repurpose", title: "Write the Substack newsletter", executor: "Agent-ready", instruction: "Adapt the transcript into a useful standalone newsletter issue." },
  { phase: "Repurpose", title: "Write the Substack promotional post", executor: "Agent-ready", instruction: "Create a short native post that promotes the newsletter or video." },
  { phase: "Repurpose", title: "Write the LinkedIn newsletter", executor: "Agent-ready", instruction: "Adapt the transcript into a clear LinkedIn newsletter in your voice." },
  { phase: "Repurpose", title: "Create the LinkedIn post or carousel", executor: "Agent-ready", instruction: "Choose the strongest LinkedIn format and turn one useful idea into a native asset." },
]

const phases = ["Define", "Produce", "Publish", "Repurpose"] as const

function executorIcon(executor: Executor) {
  if (executor === "Human") return UserRound
  if (executor === "Automation") return Workflow
  return Bot
}

class TemplateCreationError extends Error {
  parentTask?: Task

  constructor(message: string, parentTask?: Task) {
    super(message)
    this.parentTask = parentTask
  }
}

export function TemplatesPage() {
  const { lists, refreshLists } = useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [videoTitle, setVideoTitle] = React.useState("")
  const [publishDate, setPublishDate] = React.useState("")
  const [cta, setCta] = React.useState("")
  const [contentFolder, setContentFolder] = React.useState("")
  const [listId, setListId] = React.useState("")
  const [creatingStep, setCreatingStep] = React.useState(0)
  const [partialTask, setPartialTask] = React.useState<Task | null>(null)

  const defaultList = lists.find(list => list.name.toLowerCase() === "content") || lists.find(list => !list.isInbox) || lists[0]

  const resetForm = React.useCallback(() => {
    setVideoTitle("")
    setPublishDate("")
    setCta("")
    setContentFolder("")
    setListId(defaultList?.id || "")
    setCreatingStep(0)
    setPartialTask(null)
  }, [defaultList?.id])

  const openTemplate = () => {
    resetForm()
    createFromTemplate.reset()
    setDialogOpen(true)
  }

  const taskUrl = (task: Task) => {
    const list = lists.find(item => item.id === task.bucketId)
    return list && !list.isInbox
      ? `/app/lists/${encodeURIComponent(list.id)}/tasks/${encodeURIComponent(task.id)}`
      : `/app/tasks/${encodeURIComponent(task.id)}`
  }

  const createFromTemplate = useMutation({
    mutationFn: async () => {
      let parent: Task | undefined
      const attemptId = crypto.randomUUID()
      try {
        const selectedList = listId || defaultList?.id || ""
        const endpoint = selectedList ? `/api/v1/lists/${encodeURIComponent(selectedList)}/tasks` : "/api/v1/tasks"
        const context = [
          "Created from template: Publish a YouTube video",
          publishDate ? `Target publication date: ${publishDate}` : "",
          cta.trim() ? `Primary CTA: ${cta.trim()}` : "",
          contentFolder.trim() ? `Content folder: ${contentFolder.trim()}` : "",
          "",
          "Follow the ordered workflow below. Agent-ready steps stay unassigned until you choose to queue them.",
        ].filter(Boolean).join("\n")
        parent = await api.post<Task>(endpoint, {
          title: `Publish: ${videoTitle.trim()}`,
          description: context,
          kind: "action",
          status: "new",
          priority: "p1",
          scheduledDate: publishDate,
        }, { "Idempotency-Key": `${attemptId}:parent` })

        for (const [index, step] of youtubeSteps.entries()) {
          setCreatingStep(index + 1)
          await api.post<Task>(`/api/v1/tasks/${encodeURIComponent(parent.id)}/subtasks`, {
            title: step.title,
            description: `Phase: ${step.phase}\nSuggested executor: ${step.executor}\n\n${step.instruction}`,
            kind: "action",
            status: "new",
            priority: "p1",
          }, { "Idempotency-Key": `${attemptId}:step:${index + 1}` })
        }
        return parent
      } catch (error) {
        throw new TemplateCreationError(error instanceof Error ? error.message : "Could not create this task from the template.", parent)
      }
    },
    onSuccess: async task => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["subtasks", task.id] }),
        refreshLists(),
      ])
      setDialogOpen(false)
      navigate(taskUrl(task))
    },
    onError: error => {
      if (error instanceof TemplateCreationError && error.parentTask) setPartialTask(error.parentTask)
    },
  })

  const closeDialog = (open: boolean) => {
    if (createFromTemplate.isPending) return
    setDialogOpen(open)
  }

  return (
    <div className="page-wrap template-page">
      <header className="page-header template-page-header">
        <div className="page-heading"><h1>Templates</h1><p>Reusable processes built from phases and ordered subtasks.</p></div>
      </header>

      <section className="template-library" aria-label="Available templates">
        <article className="template-list-row surface-card">
          <div className="template-list-main">
            <div className="template-icon"><Clapperboard aria-hidden="true" /></div>
            <div><h2>Publish a YouTube video</h2><p>Plan, produce, publish and repurpose one weekly video.</p><div className="template-meta"><span>{youtubeSteps.length} subtasks</span><span>{phases.length} phases</span><span>Creates one parent task</span></div></div>
          </div>
          <Button variant="secondary" className="template-use-button" onClick={openTemplate}><Play className="size-3.5" />Use template</Button>
        </article>
      </section>

      <div className="template-workflow-heading">
        <div><h2>Workflow</h2><p>{youtubeSteps.length} ordered subtasks across {phases.length} phases. Human and agent work stays explicit.</p></div>
      </div>
      <section className="template-workflow surface-card" aria-label="YouTube template steps">
        {phases.map((phase, phaseIndex) => {
          const steps = youtubeSteps.filter(step => step.phase === phase)
          return <div className="template-phase" key={phase}>
            <header><span>{String(phaseIndex + 1).padStart(2, "0")}</span><h3>{phase}</h3><small>{steps.length}</small></header>
            <ol>{steps.map(step => { const Icon = executorIcon(step.executor); return <li key={step.title}><span className="template-step-check"><Check aria-hidden="true" /></span><strong>{step.title}</strong><small><Icon aria-hidden="true" />{step.executor}</small></li> })}</ol>
          </div>
        })}
      </section>

      <Dialog open={dialogOpen} onOpenChange={closeDialog}>
        <DialogContent className="template-create-dialog" showClose={false} aria-describedby={undefined}>
          <form onSubmit={event => { event.preventDefault(); if (videoTitle.trim() && !partialTask) createFromTemplate.mutate() }}>
            <DialogHeader className="template-dialog-header"><div className="template-dialog-title"><div className="template-icon small"><Clapperboard aria-hidden="true" /></div><div><DialogTitle>Start a YouTube task</DialogTitle><DialogDescription>Slate will create one parent task with {youtubeSteps.length} ordered subtasks.</DialogDescription></div><button type="button" onClick={() => closeDialog(false)} disabled={createFromTemplate.isPending} aria-label="Close"><X aria-hidden="true" /></button></div></DialogHeader>
            <div className="template-form-grid">
              <div className="template-form-wide"><Label htmlFor="template-video-title">Video name</Label><Input id="template-video-title" value={videoTitle} onChange={event => setVideoTitle(event.target.value)} placeholder="How I build agent workflows" autoFocus required disabled={createFromTemplate.isPending || Boolean(partialTask)} /></div>
              <div><Label htmlFor="template-publish-date">Publish date</Label><span className="date-property"><CalendarDays aria-hidden="true" /><Input id="template-publish-date" type="date" value={publishDate} onChange={event => setPublishDate(event.target.value)} disabled={createFromTemplate.isPending || Boolean(partialTask)} /></span></div>
              <div><Label htmlFor="template-list">List</Label><Select id="template-list" value={listId || defaultList?.id || ""} onChange={event => setListId(event.target.value)} disabled={createFromTemplate.isPending || Boolean(partialTask)}>{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</Select></div>
              <div className="template-form-wide"><Label htmlFor="template-cta">Primary CTA</Label><Input id="template-cta" value={cta} onChange={event => setCta(event.target.value)} placeholder="What should the viewer do next?" disabled={createFromTemplate.isPending || Boolean(partialTask)} /></div>
              <div className="template-form-wide"><Label htmlFor="template-content-folder">Content folder</Label><Input id="template-content-folder" value={contentFolder} onChange={event => setContentFolder(event.target.value)} placeholder="Drive, Dropbox or local folder link" disabled={createFromTemplate.isPending || Boolean(partialTask)} /></div>
            </div>
            <div className="template-create-note"><FileText aria-hidden="true" /><p><strong>Template snapshot</strong><span>This task keeps its original steps even if the template changes later.</span></p></div>
            {createFromTemplate.isPending && <div className="template-create-progress" role="status"><span style={{ width: `${Math.max(4, (creatingStep / youtubeSteps.length) * 100)}%` }} /><p>Creating step {creatingStep || 1} of {youtubeSteps.length}…</p></div>}
            {createFromTemplate.isError && <div className="status-message error" role="alert"><strong>{partialTask ? "The parent task was created, but the workflow is incomplete." : "Could not create this task."}</strong><span>{createFromTemplate.error.message}</span></div>}
            <DialogFooter className="template-dialog-footer">
              {partialTask ? <Button type="button" onClick={() => { setDialogOpen(false); navigate(taskUrl(partialTask)) }}>Open partial task</Button> : <><Button type="button" variant="ghost" onClick={() => closeDialog(false)} disabled={createFromTemplate.isPending}>Cancel</Button><Button type="submit" disabled={!videoTitle.trim() || createFromTemplate.isPending}>{createFromTemplate.isPending ? `Creating ${creatingStep || 1}/${youtubeSteps.length}` : "Create task"}</Button></>}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
