import * as React from "react"
import { Check, Flag, Minus } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn("property-button", className)} aria-label="Priority" disabled={disabled}>
          <PriorityMark priority={value || ""} /><span>{priorityLabel(value)}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="priority-menu">
        {allowNone && <DropdownMenuItem onSelect={() => onChange("")}><PriorityMark /><span>No priority</span>{!value && <Check className="ml-auto size-4" />}</DropdownMenuItem>}
        {priorities.map(priority => <DropdownMenuItem key={priority.value} onSelect={() => onChange(priority.value)}><span className={cn("priority-option", `priority-${priority.value}`)}><PriorityMark priority={priority.value} />{priority.label}</span>{value === priority.value && <Check className="ml-auto size-4" />}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
