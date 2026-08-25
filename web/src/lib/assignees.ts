import type { Agent, Task, User } from "@/lib/types"

export type AssigneeKey = "human" | `agent:${string}`

export interface AssigneeOption {
  key: AssigneeKey
  kind: "human" | "agent"
  id: string
  displayName: string
  handle: string
}

const MAX_HANDLE_LENGTH = 30

export function mentionHandle(value: string, fallback = "user") {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  const startsWithLetter = normalized.replace(/^[^a-z]+/, "")
  return (startsWithLetter || fallback).slice(0, MAX_HANDLE_LENGTH).replace(/_+$/g, "") || fallback
}

function uniqueHandle(base: string, used: Set<string>) {
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) {
    const ending = `_${suffix}`
    candidate = `${base.slice(0, MAX_HANDLE_LENGTH - ending.length)}${ending}`
    suffix += 1
  }
  used.add(candidate)
  return candidate
}

export function buildAssignees(me: User, agents: Agent[]): AssigneeOption[] {
  const used = new Set<string>()
  const humanName = me.displayName || me.email.split("@")[0] || "You"
  const firstName = humanName.trim().split(/\s+/)[0] || humanName
  const human: AssigneeOption = {
    key: "human",
    kind: "human",
    id: me.id,
    displayName: humanName,
    handle: uniqueHandle(mentionHandle(firstName), used),
  }
  const agentOptions = agents.filter(agent => !agent.archived).map(agent => ({
    key: `agent:${agent.id}` as const,
    kind: "agent" as const,
    id: agent.id,
    displayName: agent.displayName,
    handle: uniqueHandle(mentionHandle(agent.displayName, "agent"), used),
  }))
  return [human, ...agentOptions]
}

export function agentIDForAssignee(key: AssigneeKey | string) {
  return key.startsWith("agent:") ? key.slice("agent:".length) : ""
}

export function assigneeKeyForAgent(agentID?: string): AssigneeKey {
  return agentID ? `agent:${agentID}` : "human"
}

export function assigneeForTask(task: Pick<Task, "assigneeAgentId">, assignees: AssigneeOption[]) {
  const key = assigneeKeyForAgent(task.assigneeAgentId)
  const resolved = assignees.find(assignee => assignee.key === key)
  if (resolved) return resolved
  if (task.assigneeAgentId) {
    return {
      key,
      kind: "agent" as const,
      id: task.assigneeAgentId,
      displayName: "Unavailable agent",
      handle: "unavailable_agent",
    }
  }
  return assignees[0]
}

export function resolvedAssigneeKey(key: string, assignees: AssigneeOption[]): AssigneeKey | undefined {
  return assignees.some(assignee => assignee.key === key) ? key as AssigneeKey : undefined
}

export function availableAgentHandle(name: string, assignees: AssigneeOption[], excludeKey?: AssigneeKey) {
  const used = new Set(assignees.filter(assignee => assignee.key !== excludeKey).map(assignee => assignee.handle))
  return uniqueHandle(mentionHandle(name, "agent"), used)
}
