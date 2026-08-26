import { describe, expect, it } from "vitest"
import { taskListName, type List, type Task } from "@/lib/types"

const task = { bucketId: "list-product", listName: "Old product", bucketName: "Older product" } as Task

describe("taskListName", () => {
  it("prefers the live list directory over names cached on a task", () => {
    expect(taskListName(task, [{ id: "list-product", name: "Roadmap" }] as List[])).toBe("Roadmap")
  })

  it("falls back for tasks whose list is not in the directory", () => {
    expect(taskListName(task, [])).toBe("Old product")
    expect(taskListName({ bucketId: "missing" } as Task, [])).toBe("Inbox")
  })
})
