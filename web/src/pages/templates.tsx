import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, Bot, Check, Clapperboard, FileText, Pencil, Play, Plus, Trash2, UserRound, Workflow, X } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { AssigneePicker } from "@/components/assignee-picker"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input, Label, Select, Textarea } from "@/components/ui/field"
import { useApp } from "@/app-context"
import { api } from "@/lib/api"
import { agentIDForAssignee, resolvedAssigneeKey, type AssigneeKey, type AssigneeOption } from "@/lib/assignees"
import { workspaceSummaryQueryKey, type Task } from "@/lib/types"

// A process must fit below the server's 60 authenticated writes per minute, including its parent and retry headroom.
const MAX_TEMPLATE_STEPS = 50
const MAX_TEMPLATE_STEP_ID_BYTES = 150
const MAX_TASK_TITLE_RUNES = 300
const MAX_TASK_DESCRIPTION_BYTES = 16 * 1024
// Server idempotency keys are retained for seven days. Expire browser retries first.
const MAX_PROCESS_ATTEMPT_AGE_MS = 6 * 24 * 60 * 60 * 1000
const REMOVED_DEFAULT_TEMPLATE_ID = "youtube-weekly"

interface TemplateStep {
  id: string
  phaseId: string
  title: string
  executor: AssigneeKey
  instruction: string
}

interface TemplatePhase {
  id: string
  name: string
}

interface ProcessTemplate {
  version: 2
  id: string
  name: string
  summary: string
  taskPrefix: string
  listId: string
  phases: TemplatePhase[]
  steps: TemplateStep[]
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

function assigneeMention(key: string, assignees: AssigneeOption[]) {
  const resolved = resolvedAssigneeKey(key, assignees)
  const assignee = assignees.find(item => item.key === resolved)
  return assignee ? `@${assignee.handle}` : "@unavailable_agent"
}

function templateAssigneeError(template: ProcessTemplate, assignees: AssigneeOption[]) {
  return template.steps.some(step => !resolvedAssigneeKey(step.executor, assignees))
    ? "This template references an unavailable agent. Edit the template and reassign that step."
    : ""
}

function stepDescription(template: ProcessTemplate, step: TemplateStep, assignees: AssigneeOption[] = []) {
  const phaseName = template.phases.find(phase => phase.id === step.phaseId)?.name || "Process"
  const assignedTo = assignees.length ? assigneeMention(step.executor, assignees) : step.executor
  return `Phase: ${phaseName}\nAssigned to: ${assignedTo}\n\n${step.instruction}`
}

function parentDescription(template: ProcessTemplate, brief: string) {
  return [
    `Created from template: ${template.name}`,
    brief,
    "",
    "Follow the ordered workflow below. Each subtask has a named owner.",
  ].filter(Boolean).join("\n")
}

function templateLimitError(template: ProcessTemplate, assignees?: AssigneeOption[]) {
  if (template.steps.length > MAX_TEMPLATE_STEPS) return `Templates can contain up to ${MAX_TEMPLATE_STEPS} subtasks.`
  if (template.steps.some(step => byteLength(step.id) > MAX_TEMPLATE_STEP_ID_BYTES)) return "This template contains invalid subtask identifiers."
  if (template.steps.some(step => runeLength(step.title.trim()) > MAX_TASK_TITLE_RUNES)) return `Subtask names can contain up to ${MAX_TASK_TITLE_RUNES} characters.`
  if (assignees && template.steps.some(step => byteLength(stepDescription(template, step, assignees)) > MAX_TASK_DESCRIPTION_BYTES)) return "Subtask instructions are too long to create a task."
  return ""
}

function creationLimitError(template: ProcessTemplate, parentTitle: string, brief: string, assignees?: AssigneeOption[]) {
  if (template.steps.some(step => !step.title.trim())) return "Every subtask needs a name."
  if (runeLength(parentTitle) > MAX_TASK_TITLE_RUNES) return `The generated task name can contain up to ${MAX_TASK_TITLE_RUNES} characters.`
  if (byteLength(parentDescription(template, brief.trim())) > MAX_TASK_DESCRIPTION_BYTES) return "The generated task brief is too long."
  return templateLimitError(template, assignees)
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
    if (!phaseId || !migratedPhases.some(phase => phase.id === phaseId) || typeof step.title !== "string" || !step.title.trim() || typeof step.instruction !== "string" || typeof step.executor !== "string") return null
    const executor = step.executor === "human" || step.executor.startsWith("agent:") ? step.executor as AssigneeKey : ["Human", "Agent-ready", "Automation"].includes(step.executor) ? "human" : null
    if (!executor) return null
    return { id, phaseId, title: step.title, instruction: step.instruction, executor }
  })
  if (migratedSteps.some(step => !step)) return null
  const stepIds = (migratedSteps as TemplateStep[]).map(step => step.id)
  if (new Set(stepIds).size !== stepIds.length) return null
  const version = template.version === 2 ? 2 : null
  const defaultTaskTitle = version ? template.taskPrefix : template.name
  return { version: 2, id: template.id, name: template.name, summary: template.summary, taskPrefix: defaultTaskTitle, listId: typeof template.listId === "string" ? template.listId : "", phases: migratedPhases, steps: migratedSteps as TemplateStep[] }
}

function loadTemplates(key: string): ProcessTemplate[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null")
    if (!Array.isArray(value)) return []
    const seen = new Set([REMOVED_DEFAULT_TEMPLATE_ID])
    const customTemplates = value.flatMap(item => {
      const template = migrateTemplate(item)
      if (!template || seen.has(template.id)) return []
      seen.add(template.id)
      return [template]
    })
    return customTemplates
  } catch {
    return []
  }
}

function blankTemplate(listId: string): ProcessTemplate {
  const phase = { id: crypto.randomUUID(), name: "Phase 1" }
  return { version: 2, id: crypto.randomUUID(), name: "", summary: "", taskPrefix: "", listId, phases: [phase], steps: [{ id: crypto.randomUUID(), phaseId: phase.id, title: "", executor: "human", instruction: "" }] }
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

function executorIcon(executor: string) {
  return executor.startsWith("agent:") ? Bot : UserRound
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
  createdAt: number
  parentTaskId: string
  nextStepIndex: number
  template: ProcessTemplate
  parentTitle: string
  plannedDate: string
  brief: string
  listId: string
}

function loadCreationAttempt(key: string): ProcessCreationAttempt | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null") as Partial<ProcessCreationAttempt> | null
    if (!value || typeof value.id !== "string" || !value.id.trim() || byteLength(value.id) > MAX_TEMPLATE_STEP_ID_BYTES || typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt) || value.createdAt <= 0 || value.createdAt > Date.now() + 5 * 60 * 1000 || typeof value.plannedDate !== "string" || typeof value.brief !== "string" || typeof value.listId !== "string") return null
    const legacyTemplatePrefix = value.template && typeof value.template === "object" && "taskPrefix" in value.template && typeof value.template.taskPrefix === "string" ? value.template.taskPrefix : ""
    const template = migrateTemplate(value.template)
    const legacyTaskTitle = typeof (value as Partial<ProcessCreationAttempt> & { taskTitle?: unknown }).taskTitle === "string" ? String((value as Partial<ProcessCreationAttempt> & { taskTitle?: string }).taskTitle).trim() : ""
    const parentTitle = typeof value.parentTitle === "string" && value.parentTitle.trim() ? value.parentTitle.trim() : legacyTaskTitle ? `${legacyTemplatePrefix || template?.name}: ${legacyTaskTitle}` : ""
    if (!template || !parentTitle || templateLimitError(template) || creationLimitError(template, parentTitle, value.brief)) return null
    const parentTaskId = typeof value.parentTaskId === "string" ? value.parentTaskId.trim() : ""
    const nextStepIndex = value.nextStepIndex === undefined ? 0 : value.nextStepIndex
    if (byteLength(parentTaskId) > MAX_TEMPLATE_STEP_ID_BYTES || !Number.isInteger(nextStepIndex) || nextStepIndex < 0 || nextStepIndex > template.steps.length || (nextStepIndex > 0 && !parentTaskId)) return null
    return { id: value.id, createdAt: value.createdAt, parentTaskId, nextStepIndex, template, parentTitle, plannedDate: value.plannedDate, brief: value.brief, listId: value.listId }
  } catch {
    return null
  }
}

function loadCreationAttempts(prefix: string) {
  const attempts: ProcessCreationAttempt[] = []
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key?.startsWith(prefix)) continue
      const attempt = loadCreationAttempt(key)
      if (!attempt || key !== `${prefix}${attempt.id}`) continue
      attempts.push(attempt)
    }
  } catch {
    return []
  }
  return attempts.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
}

type EditorMode = "new" | "edit"

export function TemplatesPage() {
  const { me, lists, assignees, refreshLists } = useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const storageKey = `slate:process-templates:${me.id}`
  const attemptStoragePrefix = `slate:process-attempt:${me.id}:`
  const [initialAttempt] = React.useState(() => loadCreationAttempts(attemptStoragePrefix)[0] || null)
  const activeStorageKey = React.useRef(storageKey)
  const activeAttemptStoragePrefix = React.useRef(attemptStoragePrefix)
  const [templates, setTemplates] = React.useState<ProcessTemplate[]>(() => loadTemplates(storageKey))
  const [selectedTemplateId, setSelectedTemplateId] = React.useState(() => templates[0]?.id || "")
  const [editorOpen, setEditorOpen] = React.useState(false)
  const [editorDraft, setEditorDraft] = React.useState<ProcessTemplate | null>(null)
  const [editorMode, setEditorMode] = React.useState<EditorMode>("new")
  const [deleteTarget, setDeleteTarget] = React.useState<ProcessTemplate | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(Boolean(initialAttempt))
  const [creatingStep, setCreatingStep] = React.useState(0)
  const [partialTask, setPartialTask] = React.useState<Task | null>(null)
  const [creationAttempt, setCreationAttempt] = React.useState<ProcessCreationAttempt | null>(initialAttempt)
  const [storageError, setStorageError] = React.useState(false)
  const [attemptStorageError, setAttemptStorageError] = React.useState(false)
  const [attemptDiscardError, setAttemptDiscardError] = React.useState(false)
  const [attemptExpiryReached, setAttemptExpiryReached] = React.useState(false)
  const creationAttemptLock = React.useRef(Boolean(initialAttempt))
  const templateSelectRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const focusAfterDeleteId = React.useRef("")
  const deleteTriggerRef = React.useRef<HTMLButtonElement | null>(null)

  const selectedTemplate = templates.find(template => template.id === selectedTemplateId) || templates[0]
  const activeTemplate = creationAttempt?.template || selectedTemplate
  const selectedSteps = selectedTemplate ? orderedTemplateSteps(selectedTemplate) : []
  const activeSteps = activeTemplate ? orderedTemplateSteps(activeTemplate) : []
  const attemptExpired = Boolean(creationAttempt && (attemptExpiryReached || Date.now() - creationAttempt.createdAt >= MAX_PROCESS_ATTEMPT_AGE_MS))
  const defaultList = lists.find(list => list.name.toLowerCase() === "content") || lists.find(list => !list.isInbox) || lists[0]

  React.useEffect(() => {
    if (activeStorageKey.current !== storageKey) {
      activeStorageKey.current = storageKey
      const nextTemplates = loadTemplates(storageKey)
      setTemplates(nextTemplates)
      setSelectedTemplateId(nextTemplates[0]?.id || "")
      return
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(templates))
      setStorageError(false)
    } catch {
      setStorageError(true)
    }
  }, [storageKey, templates])

  React.useEffect(() => {
    if (activeAttemptStoragePrefix.current === attemptStoragePrefix) return
    activeAttemptStoragePrefix.current = attemptStoragePrefix
    const restored = loadCreationAttempts(attemptStoragePrefix)[0] || null
    creationAttemptLock.current = Boolean(restored)
    setCreationAttempt(restored)
    setDialogOpen(Boolean(restored))
    setAttemptStorageError(false)
    setAttemptDiscardError(false)
  }, [attemptStoragePrefix])

  React.useEffect(() => {
    setAttemptExpiryReached(false)
    if (!creationAttempt) return
    const remaining = creationAttempt.createdAt + MAX_PROCESS_ATTEMPT_AGE_MS - Date.now()
    if (remaining <= 0) {
      setAttemptExpiryReached(true)
      return
    }
    const timer = window.setTimeout(() => setAttemptExpiryReached(true), remaining + 50)
    return () => window.clearTimeout(timer)
  }, [creationAttempt])

  const resetCreation = React.useCallback(() => {
    setCreatingStep(0)
    setPartialTask(null)
  }, [])

  const openTemplate = (template: ProcessTemplate) => {
    if (creationAttemptLock.current) {
      setDialogOpen(true)
      return
    }
    if (templateCreationError(template)) return
    setSelectedTemplateId(template.id)
    resetCreation()
    createFromTemplate.reset()
    setDialogOpen(true)
    const attempt: ProcessCreationAttempt = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      parentTaskId: "",
      nextStepIndex: 0,
      template: cloneTemplate(template),
      parentTitle: template.taskPrefix.trim(),
      plannedDate: "",
      brief: "",
      listId: template.listId || defaultList?.id || "",
    }
    if (!attempt.parentTitle || creationLimitError(template, attempt.parentTitle, attempt.brief)) return
    creationAttemptLock.current = true
    try {
      localStorage.setItem(`${attemptStoragePrefix}${attempt.id}`, JSON.stringify(attempt))
    } catch {
      creationAttemptLock.current = false
      setAttemptStorageError(true)
      return
    }
    setCreationAttempt(attempt)
    setAttemptStorageError(false)
    setAttemptDiscardError(false)
    createFromTemplate.mutate(attempt)
  }

  const openEditor = (template?: ProcessTemplate) => {
    setEditorMode(template ? "edit" : "new")
    setEditorDraft(template ? { ...cloneTemplate(template), listId: template.listId || defaultList?.id || "" } : blankTemplate(defaultList?.id || ""))
    setEditorOpen(true)
  }

  const templateCreationError = (template: ProcessTemplate) => {
    if (!template.taskPrefix.trim()) return "Set a default task title before creating from this template."
    const targetListId = template.listId || defaultList?.id || ""
    if (!targetListId || !lists.some(list => list.id === targetListId)) return "Choose an available list before creating from this template."
    return templateAssigneeError(template, assignees) || creationLimitError(template, template.taskPrefix.trim(), "", assignees)
  }
  const editorLimitError = editorDraft ? templateLimitError(editorDraft, assignees) || templateAssigneeError(editorDraft, assignees) : ""
  const editorValid = Boolean(editorDraft?.name.trim() && editorDraft.taskPrefix.trim() && editorDraft.listId && lists.some(list => list.id === editorDraft.listId) && editorDraft.phases.length && new Set(editorDraft.phases.map(phase => phase.name.trim().toLowerCase())).size === editorDraft.phases.length && editorDraft.phases.every(phase => phase.name.trim() && editorDraft.steps.some(step => step.phaseId === phase.id && step.title.trim())) && !editorLimitError && runeLength(editorDraft.taskPrefix.trim()) <= MAX_TASK_TITLE_RUNES)
  const createLimitError = !activeTemplate ? "" : templateAssigneeError(activeTemplate, assignees) || creationLimitError(activeTemplate, creationAttempt?.parentTitle || activeTemplate.taskPrefix, creationAttempt?.brief || "", assignees)

  const saveEditor = () => {
    if (!editorDraft || !editorValid) return
    const normalized = { ...editorDraft, name: editorDraft.name.trim(), summary: editorDraft.summary.trim(), taskPrefix: editorDraft.taskPrefix.trim(), phases: editorDraft.phases.map(phase => ({ ...phase, name: phase.name.trim() })), steps: editorDraft.steps.map(step => ({ ...step, title: step.title.trim(), instruction: step.instruction.trim() })) }
    const saved = { ...normalized, steps: orderedTemplateSteps(normalized) }
    setTemplates(current => current.some(template => template.id === saved.id) ? current.map(template => template.id === saved.id ? saved : template) : [...current, saved])
    setSelectedTemplateId(saved.id)
    setEditorOpen(false)
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    const index = templates.findIndex(template => template.id === deleteTarget.id)
    if (index < 0) return
    const neighbour = templates[index + 1] || templates[index - 1]
    if (selectedTemplateId === deleteTarget.id) setSelectedTemplateId(neighbour?.id || "")
    focusAfterDeleteId.current = neighbour?.id || "__new__"
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
        let progress = attempt
        const selectedList = attempt.listId
        const endpoint = selectedList ? `/api/v1/lists/${encodeURIComponent(selectedList)}/tasks` : "/api/v1/tasks"
        const steps = orderedTemplateSteps(attempt.template)
        const unavailableAssignee = templateAssigneeError(attempt.template, assignees)
        if (unavailableAssignee) throw new TemplateCreationError(unavailableAssignee)
        const limitError = creationLimitError(attempt.template, attempt.parentTitle, attempt.brief, assignees)
        if (limitError) throw new TemplateCreationError(limitError)
        const context = parentDescription(attempt.template, attempt.brief)
        if (attempt.parentTaskId) {
          parent = await api.get<Task>(`/api/v1/tasks/${encodeURIComponent(attempt.parentTaskId)}`)
        } else {
          parent = await api.post<Task>(endpoint, {
            title: attempt.parentTitle,
            description: context,
            kind: "action",
            status: "new",
            priority: "p1",
            scheduledDate: attempt.plannedDate,
          }, { "Idempotency-Key": `${attempt.id}:parent` })
          progress = { ...attempt, parentTaskId: parent.id }
          localStorage.setItem(`${attemptStoragePrefix}${attempt.id}`, JSON.stringify(progress))
          setCreationAttempt(progress)
        }

        for (let index = progress.nextStepIndex; index < steps.length; index += 1) {
          const step = steps[index]
          setCreatingStep(index + 1)
          await api.post<Task>(`/api/v1/tasks/${encodeURIComponent(parent.id)}/subtasks`, {
            title: step.title,
            description: stepDescription(attempt.template, step, assignees),
            kind: "action",
            status: "new",
            priority: "p1",
            assigneeAgentId: agentIDForAssignee(resolvedAssigneeKey(step.executor, assignees)!),
          }, { "Idempotency-Key": `${attempt.id}:step:${step.id}` })
          progress = { ...progress, nextStepIndex: index + 1 }
          localStorage.setItem(`${attemptStoragePrefix}${attempt.id}`, JSON.stringify(progress))
          setCreationAttempt(progress)
        }
        return parent
      } catch (error) {
        throw new TemplateCreationError(error instanceof Error ? error.message : "Could not create this task from the template.", parent)
      }
    },
    onMutate: attempt => setCreatingStep(Math.min(orderedTemplateSteps(attempt.template).length, attempt.nextStepIndex + 1)),
    onSuccess: async (task, attempt) => {
      try { localStorage.removeItem(`${attemptStoragePrefix}${attempt.id}`) } catch { /* A retained successful attempt remains safe to replay. */ }
      creationAttemptLock.current = false
      setCreationAttempt(null)
      setAttemptStorageError(false)
      setAttemptDiscardError(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["subtasks", task.id] }),
        queryClient.invalidateQueries({ queryKey: workspaceSummaryQueryKey }),
        refreshLists(),
      ])
      setDialogOpen(false)
      navigate(taskUrl(task))
    },
    onError: error => {
      if (error instanceof TemplateCreationError && error.parentTask) setPartialTask(error.parentTask)
      void queryClient.invalidateQueries({ queryKey: workspaceSummaryQueryKey })
    },
  })

  const startOrRetryCreation = () => {
    if (!creationAttempt) return
    if (createLimitError) return
    if (creationAttempt && Date.now() - creationAttempt.createdAt >= MAX_PROCESS_ATTEMPT_AGE_MS) {
      setAttemptExpiryReached(true)
      return
    }
    createFromTemplate.mutate(creationAttempt)
  }

  const discardCreationAttempt = () => {
    if (!creationAttempt || !window.confirm("Discard this saved process attempt? Any partial task will remain in Slate.")) return
    try {
      localStorage.removeItem(`${attemptStoragePrefix}${creationAttempt.id}`)
    } catch {
      setAttemptDiscardError(true)
      return
    }
    const nextAttempt = loadCreationAttempts(attemptStoragePrefix)[0] || null
    createFromTemplate.reset()
    creationAttemptLock.current = Boolean(nextAttempt)
    setCreationAttempt(nextAttempt)
    setAttemptStorageError(false)
    setAttemptDiscardError(false)
    if (nextAttempt) {
      setCreatingStep(0)
      setPartialTask(null)
      return
    }
    resetCreation()
    setDialogOpen(false)
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

      {templates.length ? <section className="template-library" aria-label="Available templates">
        {templates.map(template => {
          const creationError = templateCreationError(template)
          const errorId = `template-${template.id}-creation-error`
          return <article className={`template-list-row surface-card ${template.id === selectedTemplate.id ? "is-selected" : ""}`} key={template.id}>
            <button type="button" className="template-list-select" ref={element => { if (element) templateSelectRefs.current.set(template.id, element); else templateSelectRefs.current.delete(template.id) }} onClick={() => setSelectedTemplateId(template.id)} aria-pressed={template.id === selectedTemplate.id}>
              <div className="template-icon"><Clapperboard aria-hidden="true" /></div>
              <div><h2>{template.name}</h2><p>{template.summary || "A reusable process in Slate."}</p><div className="template-meta"><span>{orderedTemplateSteps(template).length} subtasks</span><span>{template.phases.length} phases</span><span>{template.taskPrefix || "Set a default task title"}</span></div></div>
            </button>
            <div className="template-list-actions"><Button variant="ghost" size="sm" onClick={() => openEditor(template)}><Pencil className="size-3.5" />Edit</Button><Button variant="ghost" size="sm" onClick={event => { deleteTriggerRef.current = event.currentTarget; setDeleteTarget(template) }}><Trash2 className="size-3.5" />Delete</Button><Button variant="secondary" size="sm" className="template-use-button" disabled={Boolean(creationError)} aria-describedby={creationError ? errorId : undefined} onClick={() => openTemplate(template)}><Play className="size-3.5" />Create From Template</Button></div>
            {creationError && <p className="template-create-blocked" id={errorId}>{creationError}</p>}
          </article>
        })}
      </section> : <section className="template-empty surface-card"><div><Workflow aria-hidden="true" /><h2>No templates yet</h2><p>Create a reusable process for this account. Templates stay in this browser.</p><Button variant="secondary" onClick={() => openEditor()}><Plus className="size-3.5" />New template</Button></div></section>}

      {selectedTemplate && <><div className="template-workflow-heading">
        <div><h2>{selectedTemplate.name}</h2><p>{selectedSteps.length} ordered subtasks across {selectedTemplate.phases.length} phases. Human and agent work stays explicit.</p></div>
        <Button variant="ghost" size="sm" onClick={() => openEditor(selectedTemplate)}><Pencil className="size-3.5" />Edit process</Button>
      </div>
      <section className="template-workflow surface-card" aria-label={`${selectedTemplate.name} phases and subtasks`}>
        {selectedTemplate.phases.map((phase, phaseIndex) => {
          const steps = selectedTemplate.steps.filter(step => step.phaseId === phase.id)
          return <div className="template-phase" key={phase.id}>
            <header><span>{String(phaseIndex + 1).padStart(2, "0")}</span><h3>{phase.name}</h3><small>{steps.length}</small></header>
            <ol>{steps.map(step => { const Icon = executorIcon(step.executor); return <li key={step.id}><span className="template-step-check"><Check aria-hidden="true" /></span><strong>{step.title}</strong><small><Icon aria-hidden="true" />{assigneeMention(step.executor, assignees)}</small></li> })}</ol>
          </div>
        })}
      </section></>}

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="template-editor-dialog" showClose={false}>
          {editorDraft && <form onSubmit={event => { event.preventDefault(); saveEditor() }}>
            <DialogHeader className="template-dialog-header"><div className="template-dialog-title"><div className="template-icon small"><Workflow aria-hidden="true" /></div><div><DialogTitle>{editorMode === "edit" ? "Edit template" : "New template"}</DialogTitle><DialogDescription>Define the phases and ordered subtasks in this process.</DialogDescription></div><button type="button" onClick={() => setEditorOpen(false)} aria-label="Close"><X aria-hidden="true" /></button></div></DialogHeader>
            <div className="template-editor-body">
              <div className="template-editor-details">
                <div><Label htmlFor="process-template-name">Template name</Label><Input id="process-template-name" value={editorDraft.name} onChange={event => setEditorDraft({ ...editorDraft, name: event.target.value })} placeholder="Publish a weekly newsletter" autoFocus required /></div>
                <div><Label htmlFor="process-template-summary">Description</Label><Input id="process-template-summary" value={editorDraft.summary} onChange={event => setEditorDraft({ ...editorDraft, summary: event.target.value })} placeholder="What does this process achieve?" /></div>
                <div><Label htmlFor="process-template-task-title">Default task title</Label><Input id="process-template-task-title" value={editorDraft.taskPrefix} onChange={event => setEditorDraft({ ...editorDraft, taskPrefix: event.target.value })} placeholder="Publish this week’s newsletter" required /></div>
                <div><Label htmlFor="process-template-list">List</Label><Select id="process-template-list" value={editorDraft.listId} onChange={event => setEditorDraft({ ...editorDraft, listId: event.target.value })} required><option value="" disabled>Select a list</option>{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</Select></div>
              </div>
              <div className="template-editor-section-head"><div><strong>Process</strong><span>{orderedTemplateSteps(editorDraft).length} ordered subtasks</span></div><Button type="button" variant="ghost" size="sm" disabled={editorDraft.steps.length >= MAX_TEMPLATE_STEPS} onClick={() => { const phase = { id: crypto.randomUUID(), name: `Phase ${editorDraft.phases.length + 1}` }; setEditorDraft({ ...editorDraft, phases: [...editorDraft.phases, phase], steps: [...editorDraft.steps, { id: crypto.randomUUID(), phaseId: phase.id, title: "", executor: "human", instruction: "" }] }) }}><Plus className="size-3.5" />Add phase</Button></div>
              <div className="template-editor-phases">
                {editorDraft.phases.map((phase, phaseIndex) => {
                  const phaseSteps = editorDraft.steps.filter(step => step.phaseId === phase.id)
                  return <section className="template-editor-phase" key={phase.id}>
                    <header><span>{String(phaseIndex + 1).padStart(2, "0")}</span><Input aria-label={`Phase ${phaseIndex + 1} name`} value={phase.name} onChange={event => setEditorDraft({ ...editorDraft, phases: editorDraft.phases.map(item => item.id === phase.id ? { ...item, name: event.target.value } : item) })} required /><div className="template-order-actions"><button type="button" onClick={() => setEditorDraft({ ...editorDraft, phases: moved(editorDraft.phases, phaseIndex, -1) })} disabled={phaseIndex === 0} aria-label={`Move ${phase.name || `phase ${phaseIndex + 1}`} up`}><ArrowUp /></button><button type="button" onClick={() => setEditorDraft({ ...editorDraft, phases: moved(editorDraft.phases, phaseIndex, 1) })} disabled={phaseIndex === editorDraft.phases.length - 1} aria-label={`Move ${phase.name || `phase ${phaseIndex + 1}`} down`}><ArrowDown /></button><button type="button" onClick={() => setEditorDraft({ ...editorDraft, phases: editorDraft.phases.filter(item => item.id !== phase.id), steps: editorDraft.steps.filter(step => step.phaseId !== phase.id) })} disabled={editorDraft.phases.length === 1} aria-label={`Remove ${phase.name || `phase ${phaseIndex + 1}`}`}><Trash2 /></button></div></header>
                    <div className="template-editor-steps">
                      {phaseSteps.map((step, stepIndex) => <div className="template-editor-step" key={step.id}>
                        <span className="template-step-number">{phaseIndex + 1}.{stepIndex + 1}</span>
                        <div className="template-step-fields"><Input aria-label={`${phase.name || `Phase ${phaseIndex + 1}`} subtask ${stepIndex + 1}`} value={step.title} onChange={event => setEditorDraft({ ...editorDraft, steps: editorDraft.steps.map(item => item.id === step.id ? { ...item, title: event.target.value } : item) })} placeholder="Subtask name" required /><Textarea aria-label={`${step.title || `Subtask ${stepIndex + 1}`} instructions`} value={step.instruction} onChange={event => setEditorDraft({ ...editorDraft, steps: editorDraft.steps.map(item => item.id === step.id ? { ...item, instruction: event.target.value } : item) })} placeholder="Instructions or definition of done" /></div>
                        <AssigneePicker ariaLabel={`${step.title || `Subtask ${stepIndex + 1}`} assign to`} value={step.executor} assignees={assignees} onChange={value => setEditorDraft({ ...editorDraft, steps: editorDraft.steps.map(item => item.id === step.id ? { ...item, executor: value } : item) })} />
                        <div className="template-order-actions"><button type="button" onClick={() => setEditorDraft({ ...editorDraft, steps: movePhaseStep(editorDraft.steps, phase.id, stepIndex, -1) })} disabled={stepIndex === 0} aria-label={`Move ${step.title || `subtask ${stepIndex + 1}`} up`}><ArrowUp /></button><button type="button" onClick={() => setEditorDraft({ ...editorDraft, steps: movePhaseStep(editorDraft.steps, phase.id, stepIndex, 1) })} disabled={stepIndex === phaseSteps.length - 1} aria-label={`Move ${step.title || `subtask ${stepIndex + 1}`} down`}><ArrowDown /></button><button type="button" onClick={() => setEditorDraft({ ...editorDraft, steps: editorDraft.steps.filter(item => item.id !== step.id) })} disabled={phaseSteps.length === 1} aria-label={`Remove ${step.title || `subtask ${stepIndex + 1}`}`}><Trash2 /></button></div>
                      </div>)}
                      <Button type="button" variant="ghost" size="sm" className="template-add-step" disabled={editorDraft.steps.length >= MAX_TEMPLATE_STEPS} onClick={() => setEditorDraft({ ...editorDraft, steps: [...editorDraft.steps, { id: crypto.randomUUID(), phaseId: phase.id, title: "", executor: "human", instruction: "" }] })}><Plus className="size-3.5" />Add subtask</Button>
                    </div>
                  </section>
                })}
              </div>
            </div>
            {(editorLimitError || runeLength(editorDraft.taskPrefix.trim()) > MAX_TASK_TITLE_RUNES) && <div className="status-message error" role="alert">{editorLimitError || `Default task titles can contain up to ${MAX_TASK_TITLE_RUNES} characters.`}</div>}
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
            if (templateId === "__new__") document.querySelector<HTMLButtonElement>(".template-page-header button")?.focus()
            else if (templateId) templateSelectRefs.current.get(templateId)?.focus()
            else if (deleteTrigger?.isConnected) deleteTrigger.focus()
          })
        }}>
          <DialogHeader><DialogTitle>Delete template?</DialogTitle><DialogDescription>Delete “{deleteTarget?.name}”? Tasks already created from this template will not change.</DialogDescription></DialogHeader>
          <DialogFooter><Button type="button" variant="ghost" autoFocus onClick={() => setDeleteTarget(null)}>Cancel</Button><Button type="button" variant="destructive" onClick={confirmDelete}>Delete template</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={closeDialog}>
        <DialogContent className="template-create-dialog" showClose={false}>
          {activeTemplate && <div className="template-create-content">
            <DialogHeader className="template-dialog-header"><div className="template-dialog-title"><div className="template-icon small"><Clapperboard aria-hidden="true" /></div><div><DialogTitle>Start process</DialogTitle><DialogDescription>{activeTemplate.name} creates one parent task with {activeSteps.length} ordered subtasks.</DialogDescription></div><button type="button" onClick={() => closeDialog(false)} disabled={createFromTemplate.isPending} aria-label="Close"><X aria-hidden="true" /></button></div></DialogHeader>
            <div className="template-create-note"><FileText aria-hidden="true" /><p><strong>{creationAttempt?.parentTitle || activeTemplate.taskPrefix}</strong><span>This task keeps its original phases and subtasks even if the template changes later.</span></p></div>
            {createFromTemplate.isPending && <div className="template-create-progress" role="status"><span style={{ width: `${Math.max(4, (creatingStep / activeSteps.length) * 100)}%` }} /><p>Creating subtask {creatingStep || 1} of {activeSteps.length}…</p></div>}
            {createFromTemplate.isError && <div className="status-message error" role="alert"><strong>{partialTask ? "The parent task was created, but the workflow is incomplete." : "Could not create this task."}</strong><span>{createFromTemplate.error.message}</span></div>}
            {attemptExpired ? <div className="status-message error" role="alert"><strong>This saved process attempt is too old to retry safely.</strong><span>Review its partial task if available, then discard the attempt before starting another process.</span></div> : creationAttempt && !createFromTemplate.isPending && !createFromTemplate.isError && <div className="status-message" role="status"><strong>A previous process attempt may be incomplete.</strong><span>Resume it to reuse the same task and subtask keys safely.</span></div>}
            {attemptStorageError && <div className="status-message error" role="alert">Slate could not save a safe retry key in this browser. No task was created.</div>}
            {attemptDiscardError && <div className="status-message error" role="alert">Slate could not discard this attempt from browser storage.</div>}
            {createLimitError && <div className="status-message error" role="alert">{createLimitError}</div>}
            <DialogFooter className="template-dialog-footer">
              {creationAttempt && !createFromTemplate.isPending ? <><Button type="button" variant="ghost" onClick={discardCreationAttempt}>Discard attempt</Button>{(partialTask || creationAttempt.parentTaskId) && <Button type="button" variant="ghost" onClick={() => { setDialogOpen(false); navigate(partialTask ? taskUrl(partialTask) : `/app/tasks/${encodeURIComponent(creationAttempt.parentTaskId)}`) }}>Open partial task</Button>}<Button type="button" variant="ghost" onClick={() => closeDialog(false)}>Keep for later</Button>{!attemptExpired && <Button type="button" onClick={startOrRetryCreation} disabled={Boolean(createLimitError)}>{createFromTemplate.isError ? "Retry creation" : "Resume creation"}</Button>}</> : <Button type="button" variant="ghost" onClick={() => closeDialog(false)} disabled={createFromTemplate.isPending}>{createFromTemplate.isPending ? `Creating ${creatingStep || 1}/${activeSteps.length}` : "Close"}</Button>}
            </DialogFooter>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  )
}
