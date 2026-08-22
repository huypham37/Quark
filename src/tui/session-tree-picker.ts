export interface SessionTreeInput {
  id: string
  title: string | null
  taskId?: string | null
  taskTitle?: string
  parentSessionId?: string | null
  pinned?: boolean
  filesModified?: string[] | null
  running?: boolean
  timeUpdated: number
}

export type SessionScope = "worktree" | "project"

export type SessionTreeRow =
  | { type: "task"; label: string; current: boolean }
  | {
    type: "session"
    id: string
    label: string
    current: boolean
    root: boolean
    guides: boolean[]
    connector: "plain" | "root" | "branch" | "last"
    running?: boolean
  }
  | { type: "orphan"; id: string; label: string; current: boolean; running?: boolean }
  | { type: "spacer" }

interface TaskGroup {
  key: string
  title: string
  current: boolean
  pinned: boolean
  updated: number
  sessions: SessionTreeInput[]
}

export interface SessionSearchResult {
  sessions: SessionTreeInput[]
  firstMatchId: string | null
}

export function searchSessionTree(sessions: SessionTreeInput[], query: string): SessionSearchResult {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return { sessions, firstMatchId: null }

  const byId = new Map(sessions.map((session) => [session.id, session]))
  const matches = sessions
    .filter((session) => [session.title, session.taskTitle, session.id, ...(session.filesModified ?? [])]
      .some((value) => value?.toLowerCase().includes(normalized)))
    .sort((a, b) => b.timeUpdated - a.timeUpdated)
  const included = new Set(matches.map((session) => session.id))

  for (const match of matches) {
    const seen = new Set<string>()
    let parentId = match.parentSessionId
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId)
      included.add(parentId)
      parentId = byId.get(parentId)?.parentSessionId
    }
  }

  return {
    sessions: sessions.filter((session) => included.has(session.id)),
    firstMatchId: matches[0]?.id ?? null,
  }
}

export function buildSessionTreeRows(
  sessions: SessionTreeInput[],
  currentSessionId: string | null,
  now = Date.now(),
): SessionTreeRow[] {
  const byId = new Map(sessions.map((session) => [session.id, session]))
  const current = currentSessionId ? byId.get(currentSessionId) : undefined
  const taskSessions = sessions.filter((session) => session.taskId)
  const orphanSessions = sessions.filter((session) => !session.taskId)
  const currentTaskKey = current?.taskId ? taskKey(current, byId) : null
  const groups = buildGroups(taskSessions, byId, currentTaskKey)
  const rows: SessionTreeRow[] = []

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex]!
    const previousGroup = groups[groupIndex - 1]
    if (previousGroup && (previousGroup.sessions.length > 1 || group.sessions.length > 1)) {
      rows.push({ type: "spacer" })
    }

    if (group.sessions.length === 1) {
      rows.push(sessionRow(group.sessions[0]!, currentSessionId, now, "plain"))
    } else {
      rows.push({ type: "task", label: group.title, current: group.current })
      rows.push(...sessionTreeRows(group.sessions, currentSessionId, now))
    }
  }

  if (orphanSessions.length > 0) {
    if (rows.length > 0) rows.push({ type: "spacer" })
    for (const session of orphanSessions.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
      return b.timeUpdated - a.timeUpdated
    })) {
      rows.push({
        type: "orphan",
        id: session.id,
        label: orphanLabel(session, currentSessionId, now),
        current: session.id === currentSessionId,
        ...(session.running ? { running: true } : {}),
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
      existing.pinned ||= !!session.pinned
      continue
    }

    groups.set(key, {
      key,
      title: taskTitle(session, byId),
      current: key === currentTaskKey,
      pinned: !!session.pinned,
      updated: session.timeUpdated,
      sessions: [session],
    })
  }

  return [...groups.values()].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (a.current !== b.current) return a.current ? -1 : 1
    return b.updated - a.updated
  })
}

function sessionRow(
  session: SessionTreeInput,
  currentSessionId: string | null,
  now: number,
  connector: Extract<SessionTreeRow, { type: "session" }>["connector"],
  guides: boolean[] = [],
): Extract<SessionTreeRow, { type: "session" }> {
  const root = connector === "root" || connector === "plain"
  return {
    type: "session",
    id: session.id,
    label: sessionLabel(session, root, connector !== "plain", now),
    current: session.id === currentSessionId,
    root,
    guides,
    connector,
    ...(session.running ? { running: true } : {}),
  }
}

function sessionTreeRows(
  sessions: SessionTreeInput[],
  currentSessionId: string | null,
  now: number,
): SessionTreeRow[] {
  const byId = new Map(sessions.map((session) => [session.id, session]))
  const children = new Map<string, SessionTreeInput[]>()
  const roots: SessionTreeInput[] = []

  for (const session of sessions) {
    const parentId = session.parentSessionId
    if (!parentId || !byId.has(parentId)) {
      roots.push(session)
      continue
    }
    const siblings = children.get(parentId) ?? []
    siblings.push(session)
    children.set(parentId, siblings)
  }

  const rows: SessionTreeRow[] = []
  const visited = new Set<string>()
  const sorted = (items: SessionTreeInput[]) => items.sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
    return b.timeUpdated - a.timeUpdated
  })

  const visit = (
    session: SessionTreeInput,
    guides: boolean[],
    connector: Extract<SessionTreeRow, { type: "session" }>["connector"],
  ) => {
    if (visited.has(session.id)) return
    visited.add(session.id)

    const root = connector === "root"
    rows.push(sessionRow(session, currentSessionId, now, connector, guides))

    const descendants = sorted(children.get(session.id) ?? [])
    for (let index = 0; index < descendants.length; index++) {
      const child = descendants[index]!
      const childGuides = root ? [] : [...guides, connector === "branch"]
      visit(child, childGuides, index === descendants.length - 1 ? "last" : "branch")
    }
  }

  for (const root of sorted(roots)) visit(root, [], "root")
  for (const session of sorted(sessions)) visit(session, [], "root")
  return rows
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
  root: boolean,
  branched: boolean,
  now: number,
): string {
  const markers: string[] = []
  if (session.pinned) markers.push("pinned")
  if (branched) markers.push(root ? "original" : "branch")
  if (session.running) markers.push("● running")
  const fileCount = new Set(session.filesModified ?? []).size
  if (fileCount) markers.push(`${fileCount} ${fileCount === 1 ? "file" : "files"}`)

  const suffix = [...markers, formatRelativeTime(session.timeUpdated, now)].join(" · ")
  return `${session.title ?? "(untitled)"}${suffix ? ` · ${suffix}` : ""}`
}

function orphanLabel(session: SessionTreeInput, _currentSessionId: string | null, now: number): string {
  const markers: string[] = []
  if (session.pinned) markers.push("pinned")
  if (session.running) markers.push("● running")
  const fileCount = new Set(session.filesModified ?? []).size
  if (fileCount) markers.push(`${fileCount} ${fileCount === 1 ? "file" : "files"}`)
  const suffix = [...markers, formatRelativeTime(session.timeUpdated, now)].join(" · ")
  return `${session.title ?? "(untitled)"}${suffix ? ` · ${suffix}` : ""}`
}

function selectableRow(row: SessionTreeRow | undefined): row is Extract<SessionTreeRow, { type: "session" | "orphan" }> {
  return row?.type === "session" || row?.type === "orphan"
}

export function formatRelativeTime(time: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - time) / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}
