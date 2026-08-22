import { describe, expect, test } from "bun:test"
import {
  buildSessionTreeRows,
  firstSelectableSessionRow,
  formatRelativeTime,
  moveSessionRowSelection,
  searchSessionTree,
  sessionQuickSwitchNumber,
  type SessionTreeInput,
} from "../../src/tui/session-tree-picker"

const day = (month: number, date: number) => new Date(2026, month - 1, date, 12).getTime()

describe("session tree picker", () => {
  test("renders each session once in a root-first branch tree", () => {
    const sessions: SessionTreeInput[] = [
      {
        id: "rotation",
        title: "Add refresh token rotation",
        taskId: "auth",
        taskTitle: "Auth Middleware Refactor",
        parentSessionId: "root",
        timeUpdated: day(5, 4),
      },
      {
        id: "cookies",
        title: "Move tokens to cookies",
        taskId: "auth",
        taskTitle: "Auth Middleware Refactor",
        parentSessionId: "root",
        timeUpdated: day(5, 5),
      },
      {
        id: "csrf",
        title: "Add CSRF protection",
        taskId: "auth",
        taskTitle: "Auth Middleware Refactor",
        parentSessionId: "cookies",
        timeUpdated: day(5, 6),
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

    const rows = buildSessionTreeRows(sessions, "csrf", day(5, 10))
    expect(rows).toEqual([
      { type: "task", label: "Auth Middleware Refactor", current: true },
      {
        type: "session",
        id: "root",
        label: "Workspace Auth Cleanup · root · 1w ago",
        current: false,
        root: true,
        guides: [],
        connector: "root",
      },
      {
        type: "session",
        id: "cookies",
        label: "Move tokens to cookies · 5d ago",
        current: false,
        root: false,
        guides: [],
        connector: "branch",
      },
      {
        type: "session",
        id: "csrf",
        label: "Add CSRF protection · current · 4d ago",
        current: true,
        root: false,
        guides: [true],
        connector: "last",
      },
      {
        type: "session",
        id: "rotation",
        label: "Add refresh token rotation · 6d ago",
        current: false,
        root: false,
        guides: [],
        connector: "last",
      },
      { type: "spacer" },
      { type: "task", label: "Login Bug Fix", current: false },
      {
        type: "session",
        id: "login",
        label: "Fix Login Redirect Loop · root · 1w ago",
        current: false,
        root: true,
        guides: [],
        connector: "root",
      },
    ])
    expect(rows.filter((row) => row.type === "session" && row.id === "root")).toHaveLength(1)
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

    const selected = firstSelectableSessionRow(rows, "child")
    const previous = moveSessionRowSelection(rows, selected, -1)
    const next = moveSessionRowSelection(rows, selected, 1)

    expect(rows[selected]).toMatchObject({ type: "session", id: "child" })
    expect(rows[previous]).toMatchObject({ type: "session", id: "root" })
    expect(rows[next]).toMatchObject({ type: "session", id: "login" })
    expect(moveSessionRowSelection(rows, next, 1)).toBe(next)
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
    ], "orphan", day(5, 10))

    expect(rows).toEqual([
      { type: "task", label: "Real Task", current: false },
      {
        type: "session",
        id: "task-root",
        label: "Task Root · root · 6d ago",
        current: false,
        root: true,
        guides: [],
        connector: "root",
      },
      { type: "spacer" },
      {
        type: "orphan",
        id: "orphan",
        label: "Standalone Session · current · 2d ago",
        current: true,
      },
    ])
  })

  test("searches titles and keeps matching session ancestors", () => {
    const sessions: SessionTreeInput[] = [
      {
        id: "root",
        title: "Workspace Auth Cleanup",
        taskId: "auth",
        taskTitle: "Auth Refactor",
        parentSessionId: null,
        timeUpdated: day(5, 3),
      },
      {
        id: "child",
        title: "Add refresh token rotation",
        taskId: "auth",
        taskTitle: "Auth Refactor",
        parentSessionId: "root",
        timeUpdated: day(5, 4),
      },
      {
        id: "other",
        title: "Fix login redirect",
        taskId: "login",
        taskTitle: "Login Bug",
        parentSessionId: null,
        timeUpdated: day(5, 5),
      },
    ]

    expect(searchSessionTree(sessions, "rotation")).toEqual({
      sessions: sessions.slice(0, 2),
      firstMatchId: "child",
    })
    expect(searchSessionTree(sessions, "login bug")).toEqual({
      sessions: [sessions[2]!],
      firstMatchId: "other",
    })
  })

  test("shows pinned session groups before newer groups", () => {
    const rows = buildSessionTreeRows([
      {
        id: "newer",
        title: "Newer session",
        taskId: "newer-task",
        taskTitle: "Newer task",
        timeUpdated: day(5, 8),
      },
      {
        id: "pinned",
        title: "Pinned session",
        taskId: "pinned-task",
        taskTitle: "Pinned task",
        pinned: true,
        timeUpdated: day(5, 1),
      },
    ], null, day(5, 10))

    expect(rows[0]).toEqual({ type: "task", label: "Pinned task", current: false })
    expect(rows[1]).toMatchObject({ id: "pinned", label: "Pinned session · pinned · root · 1w ago" })
  })

  test("numbers the first nine selectable rows for quick switching", () => {
    const rows = buildSessionTreeRows([
      {
        id: "root",
        title: "Root",
        taskId: "task",
        taskTitle: "Task",
        timeUpdated: day(5, 1),
      },
      {
        id: "child",
        title: "Child",
        taskId: "task",
        taskTitle: "Task",
        parentSessionId: "root",
        timeUpdated: day(5, 2),
      },
    ], null)

    expect(sessionQuickSwitchNumber(rows, 0)).toBeNull()
    expect(sessionQuickSwitchNumber(rows, 1)).toBe(1)
    expect(sessionQuickSwitchNumber(rows, 2)).toBe(2)
  })

  test("formats activity time for quick scanning", () => {
    const now = day(5, 10)

    expect(formatRelativeTime(now - 30_000, now)).toBe("now")
    expect(formatRelativeTime(now - 8 * 60_000, now)).toBe("8m ago")
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago")
    expect(formatRelativeTime(now - 14 * 86_400_000, now)).toBe("2w ago")
  })

  test("shows and searches changed-file metadata", () => {
    const sessions: SessionTreeInput[] = [{
      id: "files",
      title: "Update middleware",
      filesModified: ["src/auth.ts", "src/session.ts", "src/auth.ts"],
      timeUpdated: day(5, 9),
    }]

    expect(buildSessionTreeRows(sessions, null, day(5, 10))[0]).toMatchObject({
      label: "Update middleware · 2 files · 1d ago",
    })
    expect(searchSessionTree(sessions, "session.ts").firstMatchId).toBe("files")
  })

  test("marks a running session", () => {
    const rows = buildSessionTreeRows([{
      id: "running",
      title: "Active session",
      running: true,
      timeUpdated: day(5, 10),
    }], "running", day(5, 10))

    expect(rows[0]).toMatchObject({
      id: "running",
      label: "Active session · current · ● running · now",
      running: true,
    })
  })
})
