import { taskDropLocation } from "./workspace"
import type { Task } from "@/lib/types"

const task = (id: string, bucketId: string, sortOrder: number): Task => ({ id, bucketId, sortOrder, title: id, status: "new" })

test("calculates same-list positions when a task is dropped before or after another task", () => {
  const tasks = [task("first", "list-a", 0), task("second", "list-a", 1), task("third", "list-a", 2)]

  expect(taskDropLocation(tasks, "third", "first")).toEqual({ referenceTaskId: "first", placement: "before" })
  expect(taskDropLocation(tasks, "first", "third", true)).toEqual({ referenceTaskId: "third", placement: "after" })
})

test("ignores tasks from other lists when calculating the persisted position", () => {
  const tasks = [task("first", "list-a", 0), task("other", "list-b", 0), task("second", "list-a", 1)]

  expect(taskDropLocation(tasks, "first", "second", true)).toEqual({ referenceTaskId: "second", placement: "after" })
  expect(taskDropLocation(tasks, "first", "other", true)).toEqual({ position: 0 })
})
