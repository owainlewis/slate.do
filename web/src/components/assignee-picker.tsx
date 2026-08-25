import { Bot, Check, ChevronDown, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItemIndicator, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { initials } from "@/app-context"
import type { AssigneeKey, AssigneeOption } from "@/lib/assignees"

export function AssigneeAvatar({ assignee, small = false }: { assignee: AssigneeOption; small?: boolean }) {
  const Icon = assignee.kind === "agent" ? Bot : UserRound
  return <span className={small ? "assignee-avatar small" : "assignee-avatar"} aria-hidden="true">{small ? <Icon /> : initials(assignee.displayName)}</span>
}

export function AssigneeLabel({ assignee, compact = false }: { assignee: AssigneeOption; compact?: boolean }) {
  return <span className="assignee-label"><AssigneeAvatar assignee={assignee} small={compact} /><span>@{assignee.handle}</span></span>
}

export function AssigneePicker({ value, assignees, onChange, disabled = false, ariaLabel = "Assign to" }: { value: AssigneeKey; assignees: AssigneeOption[]; onChange: (value: AssigneeKey) => void; disabled?: boolean; ariaLabel?: string }) {
  const selected = assignees.find(assignee => assignee.key === value) || (value.startsWith("agent:") ? {
    key: value,
    kind: "agent" as const,
    id: value.slice("agent:".length),
    displayName: "Unavailable agent",
    handle: "unavailable_agent",
  } : assignees[0])
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" className="assignee-picker-trigger" disabled={disabled} aria-label={ariaLabel}>
          <AssigneeLabel assignee={selected} compact />
          <ChevronDown className="ml-auto size-3.5 text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="assignee-picker-menu">
        <DropdownMenuLabel>Assign to</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={selected.key} onValueChange={next => onChange(next as AssigneeKey)}>
          {assignees.map(assignee => {
            const Icon = assignee.kind === "agent" ? Bot : UserRound
            return <DropdownMenuRadioItem key={assignee.key} value={assignee.key} className="assignee-picker-option">
              <span className="assignee-picker-icon"><Icon aria-hidden="true" /></span>
              <span className="assignee-picker-copy"><strong>@{assignee.handle}</strong><small>{assignee.displayName}{assignee.kind === "human" ? " · You" : " · Agent"}</small></span>
              <DropdownMenuItemIndicator className="ml-auto"><Check className="size-4" aria-hidden="true" /></DropdownMenuItemIndicator>
            </DropdownMenuRadioItem>
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
