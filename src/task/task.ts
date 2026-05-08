// Task CRUD — project-scoped task index under .quark/tasks/index.json

import { generateId } from "ai"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export interface Task {
  id: string
  title: string
  description: string
  profile: string
  timeCreated: number
  timeUpdated: number
}

const INDEX_FILE = "index.json"
let storageRoot: string | null = null

function defaultRoot(): string {
  return join(process.cwd(), ".quark", "tasks")
}

export function getTaskStorageRoot(): string {
  return storageRoot ?? defaultRoot()
}

export function setTaskStorageRoot(root: string | undefined): void {
  storageRoot = root ?? null
}

export function ensureTaskStorageRoot(): void {
  mkdirSync(getTaskStorageRoot(), { recursive: true })
}

function indexPath(): string {
  return join(getTaskStorageRoot(), INDEX_FILE)
}

function isTask(value: unknown): value is Task {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.description === "string" &&
    typeof v.profile === "string" &&
    typeof v.timeCreated === "number" &&
    typeof v.timeUpdated === "number"
  )
}

function readTasks(): Task[] {
  const path = indexPath()
  if (!existsSync(path)) return []

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"))
    return Array.isArray(parsed) ? parsed.filter(isTask) : []
  } catch {
    return []
  }
}

function writeTasks(tasks: Task[]): void {
  ensureTaskStorageRoot()
  const path = indexPath()
  const tmpPath = `${path}.tmp`
  writeFileSync(tmpPath, JSON.stringify(tasks, null, 2))
  renameSync(tmpPath, path)
}

export function listTasks(): Task[] {
  return readTasks().sort((a, b) => b.timeUpdated - a.timeUpdated)
}

export function getTask(id: string): Task | null {
  return readTasks().find((task) => task.id === id) ?? null
}

export function findTaskByDescription(description: string): Task | null {
  return readTasks().find((task) => task.description === description) ?? null
}

export function createTask(input: {
  title: string
  description: string
  profile: string
}): Task {
  const now = Date.now()
  const task: Task = {
    id: `task_${generateId()}`,
    title: input.title,
    description: input.description,
    profile: input.profile,
    timeCreated: now,
    timeUpdated: now,
  }

  writeTasks([...readTasks(), task])
  return task
}

export function updateTask(
  id: string,
  patch: Partial<Pick<Task, "title" | "description" | "profile" | "timeUpdated">>,
): Task {
  const tasks = readTasks()
  const idx = tasks.findIndex((task) => task.id === id)
  if (idx === -1) throw new Error(`Task not found: ${id}`)

  const current = tasks[idx]!
  const updated: Task = {
    ...current,
    ...patch,
    id: current.id,
    timeCreated: current.timeCreated,
    timeUpdated: patch.timeUpdated ?? Date.now(),
  }
  tasks[idx] = updated
  writeTasks(tasks)
  return updated
}
