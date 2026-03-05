// Tool: todo — simplified task tracking via markdown file
//
// Reads/writes .agent/todo.md in the working directory.
// Format: `- [ ] task` (pending) / `- [x] task` (completed)

import * as fs from "fs"
import * as path from "path"
import { z } from "zod"
import { defineTool } from "./tool"

const TODO_FILE = ".agent/todo.md"

function todoPath(): string {
  return path.resolve(process.cwd(), TODO_FILE)
}

function readTodos(): string[] {
  const fp = todoPath()
  if (!fs.existsSync(fp)) return []
  return fs.readFileSync(fp, "utf-8").split("\n").filter((l) => l.trim() !== "")
}

function writeTodos(lines: string[]) {
  const fp = todoPath()
  const dir = path.dirname(fp)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(fp, lines.join("\n") + "\n", "utf-8")
}

export const todoTool = defineTool({
  id: "todo",
  description:
    "Track tasks using a markdown checklist. " +
    "Actions: 'add' (add a new task), 'complete' (mark a task as done), 'list' (show all tasks). " +
    "Tasks are stored in .agent/todo.md.",
  parameters: z.object({
    action: z.enum(["add", "complete", "list"]).describe("Action to perform"),
    task: z.string().optional().describe("Task description (required for add/complete)"),
  }),
  async execute(args, _ctx) {
    if (args.action === "list") {
      const lines = readTodos()
      if (lines.length === 0) {
        return {
          title: "Todo list",
          output: "No tasks found.",
          metadata: { count: 0 },
        }
      }
      return {
        title: "Todo list",
        output: lines.join("\n"),
        metadata: { count: lines.length },
      }
    }

    if (args.action === "add") {
      if (!args.task) throw new Error("task is required for 'add' action")
      const lines = readTodos()
      lines.push(`- [ ] ${args.task}`)
      writeTodos(lines)
      return {
        title: "Added task",
        output: `Added: ${args.task}`,
        metadata: { task: args.task, total: lines.length },
      }
    }

    if (args.action === "complete") {
      if (!args.task) throw new Error("task is required for 'complete' action")
      const lines = readTodos()
      let found = false
      const updated = lines.map((line) => {
        if (!found && line.includes(args.task!) && line.startsWith("- [ ]")) {
          found = true
          return line.replace("- [ ]", "- [x]")
        }
        return line
      })
      if (!found) {
        return {
          title: "Task not found",
          output: `Could not find pending task matching: ${args.task}`,
          metadata: { task: args.task, found: false },
        }
      }
      writeTodos(updated)
      return {
        title: "Completed task",
        output: `Completed: ${args.task}`,
        metadata: { task: args.task, found: true },
      }
    }

    throw new Error(`Unknown action: ${args.action}`)
  },
})
