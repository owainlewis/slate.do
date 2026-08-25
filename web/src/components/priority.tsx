import { Flag, Minus } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Task } from "@/lib/types"

export type Priority = NonNullable<Task["priority"]>

export const priorities: Array<{ value: Priority; label: string; shortLabel: string }> = [
  { value: "p0", label: "Urgent", shortLabel: "Urgent" },
  { value: "p1", label: "High", shortLabel: "High" },
  { value: "p2", label: "Normal", shortLabel: "Normal" },
]

export function priorityLabel(value?: string) {
  return priorities.find(priority => priority.value === value)?.label || "No priority"
}

export function PriorityMark({ priority = "" }: { priority?: Priority }) {
  return <span className={cn("priority-mark", priority && `priority-mark-${priority}`)} aria-hidden="true">{priority ? <Flag /> : <Minus />}</span>
}

export function PriorityBadge({ priority, compact = false }: { priority?: Priority; compact?: boolean }) {
  if (!priority) return null
  return <span className={cn("priority-badge", `priority-${priority}`, compact && "compact")}><PriorityMark priority={priority} />{priorityLabel(priority)}</span>
}

export function PriorityPicker({ value, onChange, allowNone = true, className, disabled = false }: { value?: Priority; onChange: (priority: Priority) => void; allowNone?: boolean; className?: string; disabled?: boolean }) {
  return (
    <div className={cn("priority-picker", className)} role="group" aria-label="Priority">
      {allowNone && <button type="button" aria-label="No priority" aria-pressed={!value} title="No priority" disabled={disabled} onClick={() => onChange("")}><PriorityMark /></button>}
      {priorities.map(priority => <button key={priority.value} type="button" className={`priority-${priority.value}`} aria-label={`${priority.label} priority`} aria-pressed={value === priority.value} title={priority.label} disabled={disabled} onClick={() => onChange(priority.value)}><PriorityMark priority={priority.value} /></button>)}
    </div>
  )
}
