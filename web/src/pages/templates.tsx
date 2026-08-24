import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, Bot, CalendarDays, Check, Clapperboard, FileText, Pencil, Play, Plus, Trash2, UserRound, Workflow, X } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input, Label, Select, Textarea } from "@/components/ui/field"
import { useApp } from "@/app-context"
import { api } from "@/lib/api"
import type { Task } from "@/lib/types"

type Executor = "Human" | "Agent-ready" | "Automation"

const MAX_TEMPLATE_STEPS = 200
const MAX_TEMPLATE_STEP_ID_BYTES = 150
const MAX_TASK_TITLE_RUNES = 300
const MAX_TASK_DESCRIPTION_BYTES = 16 * 1024

interface TemplateStep {
  id: string
  phaseId: string
  title: string
  executor: Executor
  instruction: string
}

interface TemplatePhase {
  id: string
  name: string
}

interface ProcessTemplate {
  id: string
  name: string
  summary: string
  taskPrefix: string
  phases: TemplatePhase[]
  steps: TemplateStep[]
}

const youtubeSteps: TemplateStep[] = [
  { id: "youtube-capture-idea", phaseId: "define", title: "Capture the idea", executor: "Human", instruction: "Write down the audience, problem, promise and reason this video should exist." },
  { id: "youtube-generate-titles", phaseId: "define", title: "Generate title options", executor: "Agent-ready", instruction: "Generate strong title options from the idea, audience and core promise." },
  { id: "youtube-approve-title", phaseId: "define", title: "Approve the title", executor: "Human", instruction: "Choose the title that makes the clearest promise without overstating the video." },
  { id: "youtube-write-outline", phaseId: "define", title: "Write the outline", executor: "Human", instruction: "Map the argument, examples and teaching sequence before writing the full script." },
  { id: "youtube-write-intro", phaseId: "define", title: "Handwrite the introduction", executor: "Human", instruction: "Write the opening hook in your own words and make the payoff clear." },
  { id: "youtube-write-script", phaseId: "define", title: "Write the script", executor: "Agent-ready", instruction: "Turn the approved outline and introduction into a complete recording script." },
  { id: "youtube-record", phaseId: "produce", title: "Record the video", executor: "Human", instruction: "Record the approved script and store the raw footage in the content folder." },
  { id: "youtube-edit", phaseId: "produce", title: "Edit the video", executor: "Human", instruction: "Edit the recording into the finished YouTube cut." },
  { id: "youtube-export", phaseId: "produce", title: "Export the final MP4", executor: "Human", instruction: "Export the approved master and add the canonical file location as an output." },
  { id: "youtube-transcript", phaseId: "publish", title: "Generate the transcript", executor: "Automation", instruction: "Transcribe the final MP4 and save the transcript in the content workspace." },
  { id: "youtube-description", phaseId: "publish", title: "Write the YouTube description", executor: "Agent-ready", instruction: "Create the description from the approved title, transcript, CTA and resource links." },
  { id: "youtube-publishing-check", phaseId: "publish", title: "Complete the publishing check", executor: "Human", instruction: "Verify the video, title, description and required publishing assets before release." },
  { id: "youtube-kit-email", phaseId: "repurpose", title: "Write the Kit promotional email", executor: "Agent-ready", instruction: "Turn the transcript into a concise email that earns the click to the video." },
  { id: "youtube-substack-newsletter", phaseId: "repurpose", title: "Write the Substack newsletter", executor: "Agent-ready", instruction: "Adapt the transcript into a useful standalone newsletter issue." },
  { id: "youtube-substack-post", phaseId: "repurpose", title: "Write the Substack promotional post", executor: "Agent-ready", instruction: "Create a short native post that promotes the newsletter or video." },
  { id: "youtube-linkedin-newsletter", phaseId: "repurpose", title: "Write the LinkedIn newsletter", executor: "Agent-ready", instruction: "Adapt the transcript into a clear LinkedIn newsletter in your voice." },
  { id: "youtube-linkedin-asset", phaseId: "repurpose", title: "Create the LinkedIn post or carousel", executor: "Agent-ready", instruction: "Choose the strongest LinkedIn format and turn one useful idea into a native asset." },
]

const phases: TemplatePhase[] = [{ id: "define", name: "Define" }, { id: "produce", name: "Produce" }, { id: "publish", name: "Publish" }, { id: "repurpose", name: "Repurpose" }]

const youtubeTemplate: ProcessTemplate = {
  id: "youtube-weekly",
  name: "Publish a YouTube video",
  summary: "Plan, produce, publish and repurpose one weekly video.",
  taskPrefix: "Publish",
  phases,
  steps: youtubeSteps,
}

function cloneTemplate(template: ProcessTemplate): ProcessTemplate {
  return JSON.parse(JSON.stringify(template)) as ProcessTemplate
}

function orderedTemplateSteps(template: ProcessTemplate) {
  return template.phases.flatMap(phase => template.steps.filter(step => step.phaseId === phase.id))
}

function runeLength(value: string) {
  return Array.from(value).length
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).length
}

function stepDescription(template: ProcessTemplate, step: TemplateStep) {
  const phaseName = template.phases.find(phase => phase.id === step.phaseId)?.name || "Process"
  return `Phase: ${phaseName}\nSuggested executor: ${step.executor}\n\n${step.instruction}`
}

function parentDescription(template: ProcessTemplate, brief: string) {
  return [
    `Created from template: ${template.name}`,
    brief,
    "",
    "Follow the ordered workflow below. Agent-ready subtasks stay unassigned until you choose to queue them.",
  ].filter(Boolean).join("\n")
}

function templateLimitError(template: ProcessTemplate) {
  if (template.steps.length > MAX_TEMPLATE_STEPS) return `Templates can contain up to ${MAX_TEMPLATE_STEPS} subtasks.`
  if (template.steps.some(step => byteLength(step.id) > MAX_TEMPLATE_STEP_ID_BYTES)) return "This template contains invalid subtask identifiers."
  if (template.steps.some(step => runeLength(step.title.trim()) > MAX_TASK_TITLE_RUNES)) return `Subtask names can contain up to ${MAX_TASK_TITLE_RUNES} characters.`
  if (template.steps.some(step => byteLength(stepDescription(template, step)) > MAX_TASK_DESCRIPTION_BYTES)) return "Subtask instructions are too long to create a task."
  return ""
}

function creationLimitError(template: ProcessTemplate, taskTitle: string, brief: string) {
  if (template.steps.some(step => !step.title.trim())) return "Every subtask needs a name."
  const parentTitle = `${template.taskPrefix || template.name}: ${taskTitle.trim()}`
  if (runeLength(parentTitle) > MAX_TASK_TITLE_RUNES) return `The generated task name can contain up to ${MAX_TASK_TITLE_RUNES} characters.`
  if (byteLength(parentDescription(template, brief.trim())) > MAX_TASK_DESCRIPTION_BYTES) return "The generated task brief is too long."
  return templateLimitError(template)
}

function isBuiltInTemplate(template: ProcessTemplate) {
  return template.id === youtubeTemplate.id
}

function migrateTemplate(value: unknown): ProcessTemplate | null {
  if (!value || typeof value !== "object") return null
  const template = value as Record<string, unknown>
  if (typeof template.id !== "string" || typeof template.name !== "string" || typeof template.summary !== "string" || typeof template.taskPrefix !== "string" || !Array.isArray(template.phases) || !Array.isArray(template.steps)) return null
  let migratedPhases: TemplatePhase[]
  if (template.phases.every(phase => typeof phase === "string")) {
    migratedPhases = template.phases.map((name, index) => ({ id: `${template.id}-phase-${index}`, name: String(name) }))
  } else {
    if (!template.phases.every(phase => phase && typeof phase === "object" && typeof (phase as Record<string, unknown>).id === "string" && typeof (phase as Record<string, unknown>).name === "string")) return null
    migratedPhases = template.phases.map(phase => ({ id: String((phase as Record<string, unknown>).id), name: String((phase as Record<string, unknown>).name) }))
  }
  if (!migratedPhases.length || new Set(migratedPhases.map(phase => phase.id)).size !== migratedPhases.length) return null
  const migratedSteps = template.steps.map((value, index) => {
    if (!value || typeof value !== "object") return null
    const step = value as Record<string, unknown>
    const phaseId = typeof step.phaseId === "string" ? step.phaseId : migratedPhases.find(phase => phase.name === step.phase)?.id
    const preferredId = typeof step.id === "string" && step.id.trim() ? step.id : `${template.id}-step-${index + 1}`
    const id = byteLength(preferredId) <= MAX_TEMPLATE_STEP_ID_BYTES ? preferredId : `step-${index + 1}`
    if (!phaseId || !migratedPhases.some(phase => phase.id === phaseId) || typeof step.title !== "string" || !step.title.trim() || typeof step.instruction !== "string" || typeof step.executor !== "string" || !["Human", "Agent-ready", "Automation"].includes(step.executor)) return null
    return { id, phaseId, title: step.title, instruction: step.instruction, executor: step.executor as Executor }
  })
  if (migratedSteps.some(step => !step)) return null
  const stepIds = (migratedSteps as TemplateStep[]).map(step => step.id)
  if (new Set(stepIds).size !== stepIds.length) return null
  return { id: template.id, name: template.name, summary: template.summary, taskPrefix: template.taskPrefix, phases: migratedPhases, steps: migratedSteps as TemplateStep[] }
}

function loadTemplates(key: string): ProcessTemplate[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null")
    if (!Array.isArray(value)) return [cloneTemplate(youtubeTemplate)]
    const seen = new Set([youtubeTemplate.id])
    const customTemplates = value.flatMap(item => {
      const template = migrateTemplate(item)
      if (!template || seen.has(template.id)) return []
      seen.add(template.id)
      return [template]
    })
    return [cloneTemplate(youtubeTemplate), ...customTemplates]
  } catch {
    return [cloneTemplate(youtubeTemplate)]
  }
}

function blankTemplate(): ProcessTemplate {
  const phase = { id: crypto.randomUUID(), name: "Phase 1" }
  return { id: crypto.randomUUID(), name: "", summary: "", taskPrefix: "Run", phases: [phase], steps: [{ id: crypto.randomUUID(), phaseId: phase.id, title: "", executor: "Human", instruction: "" }] }
}

function duplicateTemplate(template: ProcessTemplate): ProcessTemplate {
  const phaseIds = new Map(template.phases.map(phase => [phase.id, crypto.randomUUID()]))
  return {
    ...cloneTemplate(template),
    id: crypto.randomUUID(),
    name: `${template.name} copy`,
    phases: template.phases.map(phase => ({ ...phase, id: phaseIds.get(phase.id)! })),
    steps: template.steps.map(step => ({ ...step, id: crypto.randomUUID(), phaseId: phaseIds.get(step.phaseId)! })),
  }
}

function moved<T>(items: T[], index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= items.length) return items
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

function movePhaseStep(steps: TemplateStep[], phaseId: string, index: number, direction: -1 | 1) {
  const reordered = moved(steps.filter(step => step.phaseId === phaseId), index, direction)
  let nextIndex = 0
  return steps.map(step => step.phaseId === phaseId ? reordered[nextIndex++] : step)
}

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

interface ProcessCreationAttempt {
  id: string
  template: ProcessTemplate
  taskTitle: string
  plannedDate: string
  brief: string
  listId: string
}

type EditorMode = "new" | "edit" | "duplicate"

export function TemplatesPage() {
  const { me, lists, refreshLists } = useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const storageKey = `slate:process-templates:${me.id}`
  const activeStorageKey = React.useRef(storageKey)
  const [templates, setTemplates] = React.useState<ProcessTemplate[]>(() => loadTemplates(storageKey))
  const [selectedTemplateId, setSelectedTemplateId] = React.useState(() => templates[0].id)
  const [editorOpen, setEditorOpen] = React.useState(false)
  const [editorDraft, setEditorDraft] = React.useState<ProcessTemplate | null>(null)
  const [editorMode, setEditorMode] = React.useState<EditorMode>("new")
  const [deleteTarget, setDeleteTarget] = React.useState<ProcessTemplate | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [taskTitle, setTaskTitle] = React.useState("")
  const [plannedDate, setPlannedDate] = React.useState("")
  const [brief, setBrief] = React.useState("")
  const [listId, setListId] = React.useState("")
  const [creatingStep, setCreatingStep] = React.useState(0)
  const [partialTask, setPartialTask] = React.useState<Task | null>(null)
  const [creationAttempt, setCreationAttempt] = React.useState<ProcessCreationAttempt | null>(null)
  const [storageError, setStorageError] = React.useState(false)
  const templateSelectRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const focusAfterDeleteId = React.useRef("")
  const deleteTriggerRef = React.useRef<HTMLButtonElement | null>(null)

  const selectedTemplate = templates.find(template => template.id === selectedTemplateId) || templates[0]
  const selectedSteps = orderedTemplateSteps(selectedTemplate)
  const defaultList = lists.find(list => list.name.toLowerCase() === "content") || lists.find(list => !list.isInbox) || lists[0]

  React.useEffect(() => {
    if (activeStorageKey.current !== storageKey) {
      activeStorageKey.current = storageKey
      const nextTemplates = loadTemplates(storageKey)
      setTemplates(nextTemplates)
      setSelectedTemplateId(nextTemplates[0].id)
      return
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(templates.filter(template => !isBuiltInTemplate(template))))
      setStorageError(false)
    } catch {
      setStorageError(true)
    }
  }, [storageKey, templates])

  const resetForm = React.useCallback(() => {
    setTaskTitle("")
    setPlannedDate("")
    setBrief("")
    setListId(defaultList?.id || "")
    setCreatingStep(0)
    setPartialTask(null)
    setCreationAttempt(null)
  }, [defaultList?.id])

  const openTemplate = (template: ProcessTemplate) => {
    setSelectedTemplateId(template.id)
    resetForm()
    createFromTemplate.reset()
    setDialogOpen(true)
  }

  const openEditor = (template?: ProcessTemplate) => {
    setEditorMode(template ? "edit" : "new")
    setEditorDraft(template ? cloneTemplate(template) : blankTemplate())
    setEditorOpen(true)
  }

  const openDuplicate = (template: ProcessTemplate) => {
    setEditorMode("duplicate")
    setEditorDraft(duplicateTemplate(template))
    setEditorOpen(true)
  }

  const editorLimitError = editorDraft ? templateLimitError(editorDraft) : ""
  const editorValid = Boolean(editorDraft?.name.trim() && editorDraft.phases.length && new Set(editorDraft.phases.map(phase => phase.name.trim().toLowerCase())).size === editorDraft.phases.length && editorDraft.phases.every(phase => phase.name.trim() && editorDraft.steps.some(step => step.phaseId === phase.id && step.title.trim())) && !editorLimitError)
  const createLimitError = creationAttempt ? "" : creationLimitError(selectedTemplate, taskTitle, brief)

  const saveEditor = () => {
    if (!editorDraft || !editorValid) return
    const normalized = { ...editorDraft, name: editorDraft.name.trim(), summary: editorDraft.summary.trim(), taskPrefix: editorDraft.taskPrefix.trim() || "Run", phases: editorDraft.phases.map(phase => ({ ...phase, name: phase.name.trim() })), steps: editorDraft.steps.map(step => ({ ...step, title: step.title.trim(), instruction: step.instruction.trim() })) }
    const saved = { ...normalized, steps: orderedTemplateSteps(normalized) }
    setTemplates(current => current.some(template => template.id === saved.id) ? current.map(template => template.id === saved.id ? saved : template) : [...current, saved])
    setSelectedTemplateId(saved.id)
    setEditorOpen(false)
  }

  const confirmDelete = () => {
    if (!deleteTarget || isBuiltInTemplate(deleteTarget)) return
    const index = templates.findIndex(template => template.id === deleteTarget.id)
    if (index < 0) return
    const neighbour = templates[index + 1] || templates[index - 1]
    if (selectedTemplateId === deleteTarget.id && neighbour) setSelectedTemplateId(neighbour.id)
    focusAfterDeleteId.current = neighbour?.id || ""
    setTemplates(templates.filter(template => template.id !== deleteTarget.id))
    setDeleteTarget(null)
  }

  const taskUrl = (task: Task) => {
    const list = lists.find(item => item.id === task.bucketId)
    return list && !list.isInbox
      ? `/app/lists/${encodeURIComponent(list.id)}/tasks/${encodeURIComponent(task.id)}`
      : `/app/tasks/${encodeURIComponent(task.id)}`
  }

  const createFromTemplate = useMutation({
    mutationFn: async (attempt: ProcessCreationAttempt) => {
      let parent: Task | undefined
      try {
        const selectedList = attempt.listId
        const endpoint = selectedList ? `/api/v1/lists/${encodeURIComponent(selectedList)}/tasks` : "/api/v1/tasks"
        const steps = orderedTemplateSteps(attempt.template)
        const context = parentDescription(attempt.template, attempt.brief)
        parent = await api.post<Task>(endpoint, {
          title: `${attempt.template.taskPrefix || attempt.template.name}: ${attempt.taskTitle}`,
          description: context,
          kind: "action",
          status: "new",
          priority: "p1",
          scheduledDate: attempt.plannedDate,
        }, { "Idempotency-Key": `${attempt.id}:parent` })

        for (const [index, step] of steps.entries()) {
          setCreatingStep(index + 1)
          await api.post<Task>(`/api/v1/tasks/${encodeURIComponent(parent.id)}/subtasks`, {
            title: step.title,
            description: stepDescription(attempt.template, step),
            kind: "action",
            status: "new",
            priority: "p1",
          }, { "Idempotency-Key": `${attempt.id}:step:${step.id}` })
        }
        return parent
      } catch (error) {
        throw new TemplateCreationError(error instanceof Error ? error.message : "Could not create this task from the template.", parent)
      }
    },
    onMutate: () => setCreatingStep(0),
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

  const startOrRetryCreation = () => {
    if (!creationAttempt && creationLimitError(selectedTemplate, taskTitle, brief)) return
    const attempt = creationAttempt || {
      id: crypto.randomUUID(),
      template: cloneTemplate(selectedTemplate),
      taskTitle: taskTitle.trim(),
      plannedDate,
      brief: brief.trim(),
      listId: listId || defaultList?.id || "",
    }
    if (!creationAttempt) setCreationAttempt(attempt)
    createFromTemplate.mutate(attempt)
  }

  const closeDialog = (open: boolean) => {
    if (createFromTemplate.isPending) return
    setDialogOpen(open)
  }

  return (
    <div className="page-wrap template-page">
      <header className="page-header template-page-header">
        <div className="page-heading"><h1>Templates</h1><p>Reusable processes built from phases and ordered subtasks.</p></div>
        <Button variant="secondary" size="sm" onClick={() => openEditor()}><Plus className="size-3.5" />New template</Button>
      </header>
      {storageError && <div className="status-message error" role="alert"><strong>Templates could not be saved in this browser.</strong><span>Your changes will remain available until you leave this page.</span></div>}

      <section className="template-library" aria-label="Available templates">
        {templates.map(template => <article className={`template-list-row surface-card ${template.id === selectedTemplate.id ? "is-selected" : ""}`} key={template.id}>
          <button type="button" className="template-list-select" ref={element => { if (element) templateSelectRefs.current.set(template.id, element); else templateSelectRefs.current.delete(template.id) }} onClick={() => setSelectedTemplateId(template.id)} aria-pressed={template.id === selectedTemplate.id}>
            <div className="template-icon"><Clapperboard aria-hidden="true" /></div>
            <div><div className="template-name"><h2>{template.name}</h2>{isBuiltInTemplate(template) && <span>Built-in</span>}</div><p>{template.summary || "A reusable process in Slate."}</p><div className="template-meta"><span>{orderedTemplateSteps(template).length} subtasks</span><span>{template.phases.length} phases</span><span>Creates one parent task</span></div></div>
          </button>
          <div className="template-list-actions">{isBuiltInTemplate(template) ? <Button variant="ghost" size="sm" onClick={() => openDuplicate(template)}><Plus className="size-3.5" />Duplicate</Button> : <><Button variant="ghost" size="sm" onClick={() => openEditor(template)}><Pencil className="size-3.5" />Edit</Button><Button variant="ghost" size="sm" onClick={event => { deleteTriggerRef.current = event.currentTarget; setDeleteTarget(template) }}><Trash2 className="size-3.5" />Delete</Button></>}<Button variant="secondary" size="sm" className="template-use-button" onClick={() => openTemplate(template)}><Play className="size-3.5" />Use template</Button></div>
        </article>)}
      </section>

      <div className="template-workflow-heading">
        <div><h2>{selectedTemplate.name}</h2><p>{selectedSteps.length} ordered subtasks across {selectedTemplate.phases.length} phases. Human and agent work stays explicit.</p></div>
        {isBuiltInTemplate(selectedTemplate) ? <Button variant="ghost" size="sm" onClick={() => openDuplicate(selectedTemplate)}><Plus className="size-3.5" />Duplicate to customise</Button> : <Button variant="ghost" size="sm" onClick={() => openEditor(selectedTemplate)}><Pencil className="size-3.5" />Edit process</Button>}
      </div>
      <section className="template-workflow surface-card" aria-label={`${selectedTemplate.name} phases and subtasks`}>
        {selectedTemplate.phases.map((phase, phaseIndex) => {
          const steps = selectedTemplate.steps.filter(step => step.phaseId === phase.id)
          return <div className="template-phase" key={phase.id}>
            <header><span>{String(phaseIndex + 1).padStart(2, "0")}</span><h3>{phase.name}</h3><small>{steps.length}</small></header>
            <ol>{steps.map(step => { const Icon = executorIcon(step.executor); return <li key={step.id}><span className="template-step-check"><Check aria-hidden="true" /></span><strong>{step.title}</strong><small><Icon aria-hidden="true" />{step.executor}</small></li> })}</ol>
          </div>
        })}
      </section>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="template-editor-dialog" showClose={false}>
          {editorDraft && <form onSubmit={event => { event.preventDefault(); saveEditor() }}>
            <DialogHeader className="template-dialog-header"><div className="template-dialog-title"><div className="template-icon small"><Workflow aria-hidden="true" /></div><div><DialogTitle>{editorMode === "edit" ? "Edit template" : editorMode === "duplicate" ? "Duplicate template" : "New template"}</DialogTitle><DialogDescription>Define the phases and ordered subtasks in this process.</DialogDescription></div><button type="button" onClick={() => setEditorOpen(false)} aria-label="Close"><X aria-hidden="true" /></button></div></DialogHeader>
            <div className="template-editor-body">
              <div className="template-editor-details">
                <div><Label htmlFor="process-template-name">Template name</Label><Input id="process-template-name" value={editorDraft.name} onChange={event => setEditorDraft({ ...editorDraft, name: event.target.value })} placeholder="Publish a weekly newsletter" autoFocus required /></div>
                <div><Label htmlFor="process-template-summary">Description</Label><Input id="process-template-summary" value={editorDraft.summary} onChange={event => setEditorDraft({ ...editorDraft, summary: event.target.value })} placeholder="What does this process achieve?" /></div>
              </div>
              <div className="template-editor-section-head"><div><strong>Process</strong><span>{orderedTemplateSteps(editorDraft).length} ordered subtasks</span></div><Button type="button" variant="ghost" size="sm" disabled={editorDraft.steps.length >= MAX_TEMPLATE_STEPS} onClick={() => { const phase = { id: crypto.randomUUID(), name: `Phase ${editorDraft.phases.length + 1}` }; setEditorDraft({ ...editorDraft, phases: [...editorDraft.phases, phase], steps: [...editorDraft.steps, { id: crypto.randomUUID(), phaseId: phase.id, title: "", executor: "Human", instruction: "" }] }) }}><Plus className="size-3.5" />Add phase</Button></div>
              <div className="template-editor-phases">
                {editorDraft.phases.map((phase, phaseIndex) => {
                  const phaseSteps = editorDraft.steps.filter(step => step.phaseId === phase.id)
                  return <section className="template-editor-phase" key={phase.id}>
                    <header><span>{String(phaseIndex + 1).padStart(2, "0")}</span><Input aria-label={`Phase ${phaseIndex + 1} name`} value={phase.name} onChange={event => setEditorDraft({ ...editorDraft, phases: editorDraft.phases.map(item => item.id === phase.id ? { ...item, name: event.target.value } : item) })} required /><div className="template-order-actions"><button type="button" onClick={() => setEditorDraft({ ...editorDraft, phases: moved(editorDraft.phases, phaseIndex, -1) })} disabled={phaseIndex === 0} aria-label={`Move ${phase.name || `phase ${phaseIndex + 1}`} up`}><ArrowUp /></button><button type="button" onClick={() => setEditorDraft({ ...editorDraft, phases: moved(editorDraft.phases, phaseIndex, 1) })} disabled={phaseIndex === editorDraft.phases.length - 1} aria-label={`Move ${phase.name || `phase ${phaseIndex + 1}`} down`}><ArrowDown /></button><button type="button" onClick={() => setEditorDraft({ ...editorDraft, phases: editorDraft.phases.filter(item => item.id !== phase.id), steps: editorDraft.steps.filter(step => step.phaseId !== phase.id) })} disabled={editorDraft.phases.length === 1} aria-label={`Remove ${phase.name || `phase ${phaseIndex + 1}`}`}><Trash2 /></button></div></header>
                    <div className="template-editor-steps">
                      {phaseSteps.map((step, stepIndex) => <div className="template-editor-step" key={step.id}>
                        <span className="template-step-number">{phaseIndex + 1}.{stepIndex + 1}</span>
                        <div className="template-step-fields"><Input aria-label={`${phase.name || `Phase ${phaseIndex + 1}`} subtask ${stepIndex + 1}`} value={step.title} onChange={event => setEditorDraft({ ...editorDraft, steps: editorDraft.steps.map(item => item.id === step.id ? { ...item, title: event.target.value } : item) })} placeholder="Subtask name" required /><Textarea aria-label={`${step.title || `Subtask ${stepIndex + 1}`} instructions`} value={step.instruction} onChange={event => setEditorDraft({ ...editorDraft, steps: editorDraft.steps.map(item => item.id === step.id ? { ...item, instruction: event.target.value } : item) })} placeholder="Instructions or definition of done" /></div>
                        <Select aria-label={`${step.title || `Subtask ${stepIndex + 1}`} executor`} value={step.executor} onChange={event => setEditorDraft({ ...editorDraft, steps: editorDraft.steps.map(item => item.id === step.id ? { ...item, executor: event.target.value as Executor } : item) })}><option>Human</option><option>Agent-ready</option><option>Automation</option></Select>
                        <div className="template-order-actions"><button type="button" onClick={() => setEditorDraft({ ...editorDraft, steps: movePhaseStep(editorDraft.steps, phase.id, stepIndex, -1) })} disabled={stepIndex === 0} aria-label={`Move ${step.title || `subtask ${stepIndex + 1}`} up`}><ArrowUp /></button><button type="button" onClick={() => setEditorDraft({ ...editorDraft, steps: movePhaseStep(editorDraft.steps, phase.id, stepIndex, 1) })} disabled={stepIndex === phaseSteps.length - 1} aria-label={`Move ${step.title || `subtask ${stepIndex + 1}`} down`}><ArrowDown /></button><button type="button" onClick={() => setEditorDraft({ ...editorDraft, steps: editorDraft.steps.filter(item => item.id !== step.id) })} disabled={phaseSteps.length === 1} aria-label={`Remove ${step.title || `subtask ${stepIndex + 1}`}`}><Trash2 /></button></div>
                      </div>)}
                      <Button type="button" variant="ghost" size="sm" className="template-add-step" disabled={editorDraft.steps.length >= MAX_TEMPLATE_STEPS} onClick={() => setEditorDraft({ ...editorDraft, steps: [...editorDraft.steps, { id: crypto.randomUUID(), phaseId: phase.id, title: "", executor: "Human", instruction: "" }] })}><Plus className="size-3.5" />Add subtask</Button>
                    </div>
                  </section>
                })}
              </div>
            </div>
            {editorLimitError && <div className="status-message error" role="alert">{editorLimitError}</div>}
            <DialogFooter className="template-dialog-footer"><Button type="button" variant="ghost" onClick={() => setEditorOpen(false)}>Cancel</Button><Button type="submit" disabled={!editorValid}>Save template</Button></DialogFooter>
          </form>}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={open => { if (!open) setDeleteTarget(null) }}>
        <DialogContent showClose={false} onCloseAutoFocus={event => {
          const templateId = focusAfterDeleteId.current
          const deleteTrigger = deleteTriggerRef.current
          if (!templateId && !deleteTrigger) return
          event.preventDefault()
          focusAfterDeleteId.current = ""
          deleteTriggerRef.current = null
          requestAnimationFrame(() => {
            if (templateId) templateSelectRefs.current.get(templateId)?.focus()
            else if (deleteTrigger?.isConnected) deleteTrigger.focus()
          })
        }}>
          <DialogHeader><DialogTitle>Delete template?</DialogTitle><DialogDescription>Delete “{deleteTarget?.name}”? Tasks already created from this template will not change.</DialogDescription></DialogHeader>
          <DialogFooter><Button type="button" variant="ghost" autoFocus onClick={() => setDeleteTarget(null)}>Cancel</Button><Button type="button" variant="destructive" onClick={confirmDelete}>Delete template</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={closeDialog}>
        <DialogContent className="template-create-dialog" showClose={false}>
          <form onSubmit={event => { event.preventDefault(); if (taskTitle.trim() && !creationAttempt && !createLimitError) startOrRetryCreation() }}>
            <DialogHeader className="template-dialog-header"><div className="template-dialog-title"><div className="template-icon small"><Clapperboard aria-hidden="true" /></div><div><DialogTitle>Start process</DialogTitle><DialogDescription>{selectedTemplate.name} creates one parent task with {selectedSteps.length} ordered subtasks.</DialogDescription></div><button type="button" onClick={() => closeDialog(false)} disabled={createFromTemplate.isPending} aria-label="Close"><X aria-hidden="true" /></button></div></DialogHeader>
            <div className="template-form-grid">
              <div className="template-form-wide"><Label htmlFor="template-task-title">Task name</Label><Input id="template-task-title" value={taskTitle} onChange={event => setTaskTitle(event.target.value)} placeholder="This week’s run" autoFocus required disabled={createFromTemplate.isPending || Boolean(creationAttempt)} /></div>
              <div><Label htmlFor="template-planned-date">Plan for</Label><span className="date-property"><CalendarDays aria-hidden="true" /><Input id="template-planned-date" type="date" value={plannedDate} onChange={event => setPlannedDate(event.target.value)} disabled={createFromTemplate.isPending || Boolean(creationAttempt)} /></span></div>
              <div><Label htmlFor="template-list">List</Label><Select id="template-list" value={listId || defaultList?.id || ""} onChange={event => setListId(event.target.value)} disabled={createFromTemplate.isPending || Boolean(creationAttempt)}>{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</Select></div>
              <div className="template-form-wide"><Label htmlFor="template-brief">Brief</Label><Textarea id="template-brief" value={brief} onChange={event => setBrief(event.target.value)} placeholder="Add the context for this run" disabled={createFromTemplate.isPending || Boolean(creationAttempt)} /></div>
            </div>
            <div className="template-create-note"><FileText aria-hidden="true" /><p><strong>Template snapshot</strong><span>This task keeps its original phases and subtasks even if the template changes later.</span></p></div>
            {createFromTemplate.isPending && <div className="template-create-progress" role="status"><span style={{ width: `${Math.max(4, (creatingStep / selectedSteps.length) * 100)}%` }} /><p>Creating subtask {creatingStep || 1} of {selectedSteps.length}…</p></div>}
            {createFromTemplate.isError && <div className="status-message error" role="alert"><strong>{partialTask ? "The parent task was created, but the workflow is incomplete." : "Could not create this task."}</strong><span>{createFromTemplate.error.message}</span></div>}
            {createLimitError && <div className="status-message error" role="alert">{createLimitError}</div>}
            <DialogFooter className="template-dialog-footer">
              {createFromTemplate.isError ? <>{partialTask && <Button type="button" variant="ghost" onClick={() => { setDialogOpen(false); navigate(taskUrl(partialTask)) }}>Open partial task</Button>}<Button type="button" onClick={startOrRetryCreation}>Retry creation</Button></> : <><Button type="button" variant="ghost" onClick={() => closeDialog(false)} disabled={createFromTemplate.isPending}>Cancel</Button><Button type="submit" disabled={!taskTitle.trim() || createFromTemplate.isPending || Boolean(createLimitError)}>{createFromTemplate.isPending ? `Creating ${creatingStep || 1}/${selectedSteps.length}` : "Create task"}</Button></>}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
