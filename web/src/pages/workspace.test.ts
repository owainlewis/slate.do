import { compareBoardTasks, taskDropLocation } from "./workspace"
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
  expect(taskDropLocation(tasks, "first", "other", true)).toBeUndefined()
})

test("orders the all-tasks board by list and then persisted task position", () => {
  const tasks = [task("b-second", "list-b", 1), task("a-second", "list-a", 1), task("b-first", "list-b", 0), task("a-first", "list-a", 0)]

  expect(tasks.sort((left, right) => compareBoardTasks(left, right, ["list-a", "list-b"])).map(item => item.id)).toEqual(["a-first", "a-second", "b-first", "b-second"])
})
