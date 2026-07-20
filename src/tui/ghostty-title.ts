import type { BusEvents, TypedBus } from "../session/events"

export type AgentTabStatus = "idle" | "working" | "worked" | "failed" | "stopped"

type TerminalTitleRenderer = { setTerminalTitle(title: string): void }
type SessionLookup = (id: string) => { title: string | null }

export function isGhostty(env: NodeJS.ProcessEnv = process.env, isTTY = process.stdout.isTTY): boolean {
  if (!isTTY) return false
  return env.TERM_PROGRAM?.toLowerCase() === "ghostty" || env.TERM === "xterm-ghostty"
}

export function sanitizeTerminalTitle(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/[\u202a-\u202e\u2066-\u2069]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 120)
}

export function formatTerminalTitle(title: string | null, status: AgentTabStatus): string {
  return `Quark · ${sanitizeTerminalTitle(title || "Untitled") || "Untitled"} · ${status}`
}

/** Keeps Ghostty's active tab title synchronized with Quark's visible session. */
export function createGhosttyTitleController(input: {
  bus: TypedBus
  renderer: TerminalTitleRenderer
  getSession: SessionLookup
  initialSessionId?: string | null
  enabled?: boolean
}) {
  let sessionId = input.initialSessionId ?? null
  let title = sessionId ? input.getSession(sessionId).title : null
  let status: AgentTabStatus = "idle"
  let lastTitle: string | undefined

  const emit = () => {
    if (!input.enabled) return
    const next = formatTerminalTitle(title, status)
    if (next === lastTitle) return
    input.renderer.setTerminalTitle(next)
    lastTitle = next
  }

  const setSession = (nextSessionId: string | null, nextStatus: AgentTabStatus = "idle") => {
    sessionId = nextSessionId
    title = sessionId ? input.getSession(sessionId).title : null
    status = nextStatus
    emit()
  }

  const matches = (id: string) => id === sessionId
  const setStatus = (id: string, nextStatus: AgentTabStatus) => {
    if (!matches(id)) return
    status = nextStatus
    emit()
  }

  const onCreated = ({ sessionId: id }: BusEvents["session-created"]) => setSession(id)
  const onReset = ({ sessionId: id }: BusEvents["session-reset"]) => setSession(id)
  const onSwitch = (data: BusEvents["session-switch"]) => {
    const nextStatus = data.kind === "branch" && status === "working" ? "working" : "idle"
    setSession(data.sessionId, nextStatus)
  }
  const onTitleChanged = ({ sessionId: id, title: nextTitle }: BusEvents["session-title-changed"]) => {
    if (!matches(id)) return
    title = nextTitle
    emit()
  }
  const onLoopStart = ({ sessionId: id }: BusEvents["loop-start"]) => setStatus(id, "working")
  const onAssistantEnd = ({ sessionId: id, finish }: BusEvents["assistant-message-end"]) => {
    if (finish === "tool-calls") return
    setStatus(id, finish === "aborted" ? "stopped" : "worked")
  }
  const onUserStatus = ({ sessionId: id }: BusEvents["user-message-status"]) => setStatus(id, "stopped")
  const onError = ({ sessionId: id }: BusEvents["error"]) => {
    if (matches(id) && status === "working") setStatus(id, "failed")
  }

  input.bus.on("session-created", onCreated)
  input.bus.on("session-reset", onReset)
  input.bus.on("session-switch", onSwitch)
  input.bus.on("session-title-changed", onTitleChanged)
  input.bus.on("loop-start", onLoopStart)
  input.bus.on("assistant-message-end", onAssistantEnd)
  input.bus.on("user-message-status", onUserStatus)
  input.bus.on("error", onError)
  emit()

  return {
    refresh() {
      lastTitle = undefined
      emit()
    },
    markStopped(id: string) {
      setStatus(id, "stopped")
    },
    dispose() {
      input.bus.off("session-created", onCreated)
      input.bus.off("session-reset", onReset)
      input.bus.off("session-switch", onSwitch)
      input.bus.off("session-title-changed", onTitleChanged)
      input.bus.off("loop-start", onLoopStart)
      input.bus.off("assistant-message-end", onAssistantEnd)
      input.bus.off("user-message-status", onUserStatus)
      input.bus.off("error", onError)
    },
  }
}
