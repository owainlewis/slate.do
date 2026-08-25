export type ID = string

export interface User {
  id: ID
  email: string
  displayName: string
  theme?: "light" | "dark"
  entitlement?: { plan?: string; limits?: Record<string, number> }
}

export interface List {
  id: ID
  name: string
  goal?: string
  isInbox?: boolean
  openCount?: number
}

export interface Agent {
  id: ID
  displayName: string
  purpose?: string
  archived?: boolean
  credential?: {
    id?: string
    tokenPrefix?: string
    lastUsedAt?: string
    revokedAt?: string
    createdAt?: string
  }
  workCounts?: { ready?: number; working?: number; review?: number; completed?: number; [key: string]: number | undefined }
  lastUsedAt?: string
  revokedAt?: string
  updatedAt?: string
  [key: string]: unknown
}

export type TaskStatus = "new" | "queued" | "working" | "needs_review" | "done"

export interface Task {
  id: ID
  title: string
  description?: string
  status: TaskStatus
  priority?: "p0" | "p1" | "p2" | ""
  bucketId: ID
  bucketName?: string
  listName?: string
  parentTaskId?: ID
  parentTaskTitle?: string
  scheduledDate?: string
  assigneeAgentId?: ID
  assigneeAgentName?: string
  reviewReason?: string
  executionRunId?: string
  sortOrder?: number
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

export interface Entry {
  id: ID
  kind: "comment" | "output"
  body?: string
  content?: string
  authorName?: string
  authorKind?: string
  createdAt?: string
}

export interface WorkspaceSummary {
  activeTasks: number
  inProgress: number
  inReview: number
  completed24h: number
  runs24h: number
}

export const workspaceSummaryQueryKey = ["workspace-summary"] as const
export const workspaceSummaryQueryKeyFor = (accountID: ID) => [...workspaceSummaryQueryKey, accountID] as const
