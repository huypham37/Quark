import { describe, test, expect, beforeEach, afterAll } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  createTask,
  findTaskByDescription,
  getTask,
  listTasks,
  setTaskStorageRoot,
  updateTask,
} from "../../src/task/task"

const tmpDir = mkdtempSync(join(tmpdir(), "quark-test-task-"))

beforeEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  setTaskStorageRoot(tmpDir)
})

afterAll(() => {
  setTaskStorageRoot(undefined)
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("task CRUD", () => {
  test("creates and lists tasks from the project task index", () => {
    const task = createTask({
      title: "Add auth refresh",
      description: "Add refresh token rotation",
      profile: "coder",
    })

    expect(task.id.startsWith("task_")).toBe(true)
    expect(listTasks()).toHaveLength(1)
    expect(getTask(task.id)?.description).toBe("Add refresh token rotation")
  })

  test("finds task by exact description", () => {
    const task = createTask({
      title: "Existing task",
      description: "Existing task",
      profile: "coder",
    })

    expect(findTaskByDescription("Existing task")?.id).toBe(task.id)
    expect(findTaskByDescription("existing task")).toBeNull()
  })

  test("updates task metadata atomically", () => {
    const task = createTask({
      title: "Old title",
      description: "Old description",
      profile: "coder",
    })

    const updated = updateTask(task.id, { title: "New title" })

    expect(updated.title).toBe("New title")
    expect(getTask(task.id)?.title).toBe("New title")
    expect(getTask(task.id)?.timeCreated).toBe(task.timeCreated)
  })
})
