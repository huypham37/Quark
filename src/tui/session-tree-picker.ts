export interface SessionTreeInput {
  id: string
  title: string | null
  taskId?: string | null
  taskTitle?: string
  parentSessionId?: string | null
  timeUpdated: number
}

export type SessionTreeRow =
  | { type: "task"; label: string; current: boolean }
  | { type: "session"; id: string; label: string; current: boolean; root: boolean; depth: number }
  | { type: "orphan"; id: string; label: string; current: boolean }
  | { type: "spacer" }

interface TaskGroup {
  key: string
  title: string
  current: boolean
  updated: number
  sessions: SessionTreeInput[]
}

export function buildSessionTreeRows(sessions: SessionTreeInput[], currentSessionId: string | null): SessionTreeRow[] {
  const byId = new Map(sessions.map((session) => [session.id, session]))
  const current = currentSessionId ? byId.get(currentSessionId) : undefined
  const taskSessions = sessions.filter((session) => session.taskId)
  const orphanSessions = sessions.filter((session) => !session.taskId)
  const currentTaskKey = current?.taskId ? taskKey(current, byId) : null
  const groups = buildGroups(taskSessions, byId, currentTaskKey)
  const rows: SessionTreeRow[] = []

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex]!
    if (groupIndex > 0) rows.push({ type: "spacer" })

    rows.push({ type: "task", label: group.title, current: group.current })

    const leaves = leafSessions(group.sessions, sessions)
    for (let leafIndex = 0; leafIndex < leaves.length; leafIndex++) {
      if (leafIndex > 0) rows.push({ type: "spacer" })

      for (const { session, depth } of lineageFromLeaf(leaves[leafIndex]!, byId)) {
        rows.push({
          type: "session",
          id: session.id,
          label: sessionLabel(session, currentSessionId, byId),
          current: session.id === currentSessionId,
          root: isRoot(session, byId),
          depth,
        })
      }
    }
  }

  if (orphanSessions.length > 0) {
    if (rows.length > 0) rows.push({ type: "spacer" })
    for (const session of orphanSessions.sort((a, b) => b.timeUpdated - a.timeUpdated)) {
      rows.push({
        type: "orphan",
        id: session.id,
        label: orphanLabel(session, currentSessionId),
        current: session.id === currentSessionId,
      })
    }
  }

  return rows
}

export function firstSelectableSessionRow(rows: SessionTreeRow[], preferredSessionId: string | null): number {
  const preferred = preferredSessionId
    ? rows.findIndex((row) => selectableRow(row) && row.id === preferredSessionId)
    : -1
  if (preferred >= 0) return preferred

  const first = rows.findIndex(selectableRow)
  return Math.max(0, first)
}

export function moveSessionRowSelection(rows: SessionTreeRow[], selectedIndex: number, direction: -1 | 1): number {
  for (let i = selectedIndex + direction; i >= 0 && i < rows.length; i += direction) {
    if (selectableRow(rows[i])) return i
  }
  return selectedIndex
}

function buildGroups(
  sessions: SessionTreeInput[],
  byId: Map<string, SessionTreeInput>,
  currentTaskKey: string | null,
): TaskGroup[] {
  const groups = new Map<string, TaskGroup>()

  for (const session of sessions) {
    const key = taskKey(session, byId)
    const existing = groups.get(key)
    if (existing) {
      existing.sessions.push(session)
      existing.updated = Math.max(existing.updated, session.timeUpdated)
      continue
    }

    groups.set(key, {
      key,
      title: taskTitle(session, byId),
      current: key === currentTaskKey,
      updated: session.timeUpdated,
      sessions: [session],
    })
  }

  return [...groups.values()].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1
    return b.updated - a.updated
  })
}

function leafSessions(groupSessions: SessionTreeInput[], allSessions: SessionTreeInput[]): SessionTreeInput[] {
  const groupIds = new Set(groupSessions.map((session) => session.id))
  const parentIds = new Set(
    allSessions
      .map((session) => session.parentSessionId)
      .filter((id): id is string => !!id && groupIds.has(id)),
  )
  const leaves = groupSessions.filter((session) => !parentIds.has(session.id))
  return (leaves.length > 0 ? leaves : groupSessions).sort((a, b) => b.timeUpdated - a.timeUpdated)
}

function lineageFromLeaf(
  leaf: SessionTreeInput,
  byId: Map<string, SessionTreeInput>,
): Array<{ session: SessionTreeInput; depth: number }> {
  const lineage: Array<{ session: SessionTreeInput; depth: number }> = []
  const seen = new Set<string>()
  let session: SessionTreeInput | undefined = leaf
  let depth = 0

  while (session && !seen.has(session.id)) {
    seen.add(session.id)
    lineage.push({ session, depth })
    session = session.parentSessionId ? byId.get(session.parentSessionId) : undefined
    depth++
  }

  return lineage
}

function taskKey(session: SessionTreeInput, byId: Map<string, SessionTreeInput>): string {
  if (session.taskId) return `task:${session.taskId}`
  return `root:${rootSession(session, byId).id}`
}

function taskTitle(session: SessionTreeInput, byId: Map<string, SessionTreeInput>): string {
  return session.taskTitle ?? rootSession(session, byId).title ?? "(untitled)"
}

function rootSession(session: SessionTreeInput, byId: Map<string, SessionTreeInput>): SessionTreeInput {
  const seen = new Set<string>()
  let current = session

  while (current.parentSessionId && !seen.has(current.id)) {
    seen.add(current.id)
    const parent = byId.get(current.parentSessionId)
    if (!parent) break
    current = parent
  }

  return current
}

function sessionLabel(
  session: SessionTreeInput,
  currentSessionId: string | null,
  byId: Map<string, SessionTreeInput>,
): string {
  const markers: string[] = []
  if (session.id === currentSessionId) markers.push("current")
  if (isRoot(session, byId)) markers.push("root")

  const suffix = [...markers, formatDate(session.timeUpdated)].join(" · ")
  return `from ${session.title ?? "(untitled)"}${suffix ? ` · ${suffix}` : ""}`
}

function orphanLabel(session: SessionTreeInput, currentSessionId: string | null): string {
  const markers = session.id === currentSessionId ? ["current"] : []
  const suffix = [...markers, formatDate(session.timeUpdated)].join(" · ")
  return `${session.title ?? "(untitled)"}${suffix ? ` · ${suffix}` : ""}`
}

function selectableRow(row: SessionTreeRow | undefined): row is Extract<SessionTreeRow, { type: "session" | "orphan" }> {
  return row?.type === "session" || row?.type === "orphan"
}

function isRoot(session: SessionTreeInput, byId: Map<string, SessionTreeInput>): boolean {
  return !session.parentSessionId || !byId.has(session.parentSessionId)
}

function formatDate(time: number): string {
  const date = new Date(time)
  return `${date.getMonth() + 1}/${date.getDate()}`
}
