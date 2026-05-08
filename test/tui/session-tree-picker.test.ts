import { describe, expect, test } from "bun:test"
import {
  buildSessionTreeRows,
  firstSelectableSessionRow,
  moveSessionRowSelection,
  type SessionTreeInput,
} from "../../src/tui/session-tree-picker"

const day = (month: number, date: number) => new Date(2026, month - 1, date, 12).getTime()

describe("session tree picker", () => {
  test("groups sessions by task and renders leaf-to-root lineage rows", () => {
    const sessions: SessionTreeInput[] = [
      {
        id: "child",
        title: "Add JWT refresh token rotation",
        taskId: "auth",
        taskTitle: "Auth Middleware Refactor",
        parentSessionId: "root",
        timeUpdated: day(5, 4),
      },
      {
        id: "root",
        title: "Workspace Auth Cleanup",
        taskId: "auth",
        taskTitle: "Auth Middleware Refactor",
        parentSessionId: null,
        timeUpdated: day(5, 3),
      },
      {
        id: "login",
        title: "Fix Login Redirect Loop",
        taskId: "login-task",
        taskTitle: "Login Bug Fix",
        parentSessionId: null,
        timeUpdated: day(5, 2),
      },
    ]

    expect(buildSessionTreeRows(sessions, "child")).toEqual([
      { type: "task", label: "Auth Middleware Refactor", current: true },
      {
        type: "session",
        id: "child",
        label: "from Add JWT refresh token rotation · current · 5/4",
        current: true,
        root: false,
        depth: 0,
      },
      {
        type: "session",
        id: "root",
        label: "from Workspace Auth Cleanup · root · 5/3",
        current: false,
        root: true,
        depth: 1,
      },
      { type: "spacer" },
      { type: "task", label: "Login Bug Fix", current: false },
      {
        type: "session",
        id: "login",
        label: "from Fix Login Redirect Loop · root · 5/2",
        current: false,
        root: true,
        depth: 0,
      },
    ])
  })

  test("moves selection between visible session rows only", () => {
    const rows = buildSessionTreeRows([
      {
        id: "child",
        title: "Add JWT refresh token rotation",
        taskId: "auth",
        taskTitle: "Auth Middleware Refactor",
        parentSessionId: "root",
        timeUpdated: day(5, 4),
      },
      {
        id: "root",
        title: "Workspace Auth Cleanup",
        taskId: "auth",
        taskTitle: "Auth Middleware Refactor",
        parentSessionId: null,
        timeUpdated: day(5, 3),
      },
      {
        id: "login",
        title: "Fix Login Redirect Loop",
        taskId: "login-task",
        taskTitle: "Login Bug Fix",
        parentSessionId: null,
        timeUpdated: day(5, 2),
      },
    ], "child")

    const first = firstSelectableSessionRow(rows, "child")
    const second = moveSessionRowSelection(rows, first, 1)
    const third = moveSessionRowSelection(rows, second, 1)

    expect(rows[first]).toMatchObject({ type: "session", id: "child" })
    expect(rows[second]).toMatchObject({ type: "session", id: "root" })
    expect(rows[third]).toMatchObject({ type: "session", id: "login" })
    expect(moveSessionRowSelection(rows, third, 1)).toBe(third)
    expect(moveSessionRowSelection(rows, third, -1)).toBe(second)
  })

  test("renders sessions without taskId as plain rows without tree arrows", () => {
    const rows = buildSessionTreeRows([
      {
        id: "task-root",
        title: "Task Root",
        taskId: "task",
        taskTitle: "Real Task",
        parentSessionId: null,
        timeUpdated: day(5, 4),
      },
      {
        id: "orphan",
        title: "Standalone Session",
        taskId: null,
        parentSessionId: null,
        timeUpdated: day(5, 8),
      },
    ], "orphan")

    expect(rows).toEqual([
      { type: "task", label: "Real Task", current: false },
      {
        type: "session",
        id: "task-root",
        label: "from Task Root · root · 5/4",
        current: false,
        root: true,
        depth: 0,
      },
      { type: "spacer" },
      {
        type: "orphan",
        id: "orphan",
        label: "Standalone Session · current · 5/8",
        current: true,
      },
    ])
  })
})
