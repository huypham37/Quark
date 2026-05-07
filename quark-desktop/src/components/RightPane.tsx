import { useState, useEffect, useRef, useCallback, useReducer } from "react"
import type { Message, MessagePart } from "@web/state"

// ---- Reducer ----
interface ChatState {
  messages: Message[]
  sessionId: string | null
  connected: boolean
  running: boolean
  showThinking: boolean
  errorMsg: string | null
}

type ChatAction =
  | { type: "SET_CONNECTED"; connected: boolean }
  | { type: "SET_SESSION"; sessionId: string }
  | { type: "SET_RUNNING"; running: boolean }
  | { type: "SET_SHOW_THINKING"; show: boolean }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "ADD_USER_MSG"; id: string; text: string }
  | { type: "ENSURE_ASSISTANT"; id: string }
  | { type: "UPDATE_MSG"; id: string; updater: (m: Message) => Message }
  | { type: "LOAD_MESSAGES"; messages: Message[] }
  | { type: "CLEAR_MESSAGES" }

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_CONNECTED":
      return { ...state, connected: action.connected }
    case "SET_SESSION":
      return { ...state, sessionId: action.sessionId }
    case "SET_RUNNING":
      return { ...state, running: action.running }
    case "SET_SHOW_THINKING":
      return { ...state, showThinking: action.show }
    case "ADD_USER_MSG":
      if (state.messages.find(m => m.id === action.id)) return state
      return {
        ...state,
        messages: [...state.messages, { id: action.id, role: "user", parts: [{ type: "text", text: action.text }] }],
      }
    case "ENSURE_ASSISTANT":
      if (state.messages.find(m => m.id === action.id)) return state
      return { ...state, messages: [...state.messages, { id: action.id, role: "assistant", parts: [] }] }
    case "UPDATE_MSG":
      return { ...state, messages: state.messages.map(m => m.id === action.id ? action.updater(m) : m) }
    case "LOAD_MESSAGES":
      return { ...state, messages: action.messages }
    case "SET_ERROR":
      return { ...state, errorMsg: action.error }
    case "CLEAR_MESSAGES":
      return { ...state, messages: [] }
    default:
      return state
  }
}

// ---- Props ----
interface RightPaneProps {
  backendUrl: string
  context?: string
}

// ---- Component ----
export function RightPane({ backendUrl, context }: RightPaneProps) {
  const [state, dispatch] = useReducer(chatReducer, {
    messages: [],
    sessionId: null,
    connected: false,
    running: false,
    showThinking: false,
    errorMsg: null,
  })

  const [input, setInput] = useState("")
  const wsRef = useRef<WebSocket | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const reconnectDelay = useRef(1000)
  const sessionIdRef = useRef<string | null>(null)
  const handleEventRef = useRef<(event: string, d: any) => void>(() => {})

  // Keep sessionId ref in sync for reconnect closure
  sessionIdRef.current = state.sessionId

  // Restore session on mount
  useEffect(() => {
    const saved = localStorage.getItem("quark-desktop-session")
    if (!saved) return
    dispatch({ type: "SET_SESSION", sessionId: saved })
    fetch(`${backendUrl}/api/sessions/${saved}/messages`)
      .then(r => r.json())
      .then((msgs: Message[]) => {
        if (Array.isArray(msgs)) dispatch({ type: "LOAD_MESSAGES", messages: msgs })
      })
      .catch(() => localStorage.removeItem("quark-desktop-session"))
    fetch(`${backendUrl}/api/sessions/${saved}/status`)
      .then(r => r.json())
      .then((s: { running: boolean }) => {
        if (s.running) dispatch({ type: "SET_RUNNING", running: true })
      })
      .catch(() => {})
  }, [backendUrl])

  // WebSocket connection
  useEffect(() => {
    let cancelled = false
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let pingTimer: ReturnType<typeof setInterval> | null = null

    function connect() {
      if (cancelled) return
      if (ws && ws.readyState === WebSocket.CONNECTING) return
      if (ws) {
        ws.onopen = null
        ws.onclose = null
        ws.onerror = null
        ws.onmessage = null
        if (ws.readyState === WebSocket.OPEN) ws.close()
      }

      const wsUrl = backendUrl.replace(/^http/, "ws") + "/ws"
      ws = new WebSocket(wsUrl)
      wsRef.current = ws

      const thisWs = ws

      const connectTimeout = setTimeout(() => {
        if (thisWs.readyState === WebSocket.CONNECTING) {
          thisWs.onopen = null
          thisWs.onclose = null
          thisWs.onerror = null
          thisWs.onmessage = null
          if (pingTimer) clearInterval(pingTimer)
          if (reconnectTimer) clearTimeout(reconnectTimer)
          reconnectTimer = setTimeout(connect, reconnectDelay.current)
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30000)
        }
      }, 10000)

      thisWs.onopen = () => {
        clearTimeout(connectTimeout)
        if (cancelled) return
        reconnectDelay.current = 1000
        dispatch({ type: "SET_CONNECTED", connected: true })

        pingTimer = setInterval(() => {
          if (thisWs.readyState === WebSocket.OPEN) {
            thisWs.send(JSON.stringify({ type: "ping" }))
          }
        }, 15000)

        // Reload messages on reconnect
        const sid = sessionIdRef.current
        if (sid) {
          fetch(`${backendUrl}/api/sessions/${sid}/messages`)
            .then(r => r.json())
            .then((msgs: Message[]) => {
              if (Array.isArray(msgs)) dispatch({ type: "LOAD_MESSAGES", messages: msgs })
            })
            .catch(() => {})
          fetch(`${backendUrl}/api/sessions/${sid}/status`)
            .then(r => r.json())
            .then((s: { running: boolean }) => {
              dispatch({ type: "SET_RUNNING", running: s.running })
            })
            .catch(() => {})
        }
      }

      thisWs.onclose = () => {
        clearTimeout(connectTimeout)
        if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
        if (cancelled) return
        dispatch({ type: "SET_CONNECTED", connected: false })
        if (reconnectTimer) clearTimeout(reconnectTimer)
        reconnectTimer = setTimeout(connect, reconnectDelay.current)
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30000)
      }

      thisWs.onerror = () => {}

      thisWs.onmessage = (e) => {
        try {
          const { event, data } = JSON.parse(e.data)
          handleEventRef.current(event, data)
        } catch {}
      }
    }

    connect()

    return () => {
      cancelled = true
      if (pingTimer) clearInterval(pingTimer)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (ws) {
        ws.onopen = null
        ws.onclose = null
        ws.onerror = null
        ws.onmessage = null
        ws.close()
      }
    }
  }, [backendUrl])

  // Event handler
  function handleEvent(event: string, d: any) {
    switch (event) {
      case "session-created":
        dispatch({ type: "SET_SESSION", sessionId: d.sessionId })
        localStorage.setItem("quark-desktop-session", d.sessionId)
        break

      case "user-message":
        // Add user message to chat if not already present
        dispatch({ type: "ADD_USER_MSG", id: d.messageId || `user-${Date.now()}`, text: d.text || "" })
        break

      case "assistant-message-start":
        dispatch({ type: "ENSURE_ASSISTANT", id: d.messageId })
        break

      case "text-start":
        dispatch({ type: "ENSURE_ASSISTANT", id: d.messageId })
        dispatch({
          type: "UPDATE_MSG", id: d.messageId, updater: m => {
            const hasTxt = m.parts.find(p => p.type === "text" && (p as any).partId === d.partId)
            if (hasTxt) return m
            return { ...m, parts: [...m.parts, { type: "text" as const, text: "", partId: d.partId, streaming: true }] }
          }
        })
        break

      case "text-delta":
        dispatch({
          type: "UPDATE_MSG", id: d.messageId, updater: m => ({
            ...m, parts: m.parts.map(p =>
              p.type === "text" && (p as any).partId === d.partId
                ? { ...p, text: d.text, streaming: true }
                : p
            )
          })
        })
        break

      case "text-end":
        dispatch({
          type: "UPDATE_MSG", id: d.messageId, updater: m => ({
            ...m, parts: m.parts.map(p =>
              p.type === "text" && (p as any).partId === d.partId
                ? { ...p, text: d.text, streaming: false }
                : p
            )
          })
        })
        break

      case "tool-start":
        dispatch({ type: "ENSURE_ASSISTANT", id: d.messageId })
        dispatch({
          type: "UPDATE_MSG", id: d.messageId, updater: m => ({
            ...m, parts: [...m.parts, {
              type: "tool" as const,
              tool: d.tool,
              callId: d.callId,
              status: "running" as const,
              input: null,
              output: null,
              error: null,
            }]
          })
        })
        break

      case "tool-input":
        dispatch({
          type: "UPDATE_MSG", id: d.messageId, updater: m => ({
            ...m, parts: m.parts.map(p =>
              p.type === "tool" && p.callId === d.callId
                ? { ...p, input: d.input }
                : p
            )
          })
        })
        break

      case "tool-end":
        dispatch({
          type: "UPDATE_MSG", id: d.messageId, updater: m => ({
            ...m, parts: m.parts.map(p =>
              p.type === "tool" && p.callId === d.callId
                ? { ...p, status: d.status === "completed" ? "completed" as const : "error" as const, output: d.output || null, error: d.error || null }
                : p
            )
          })
        })
        break

      case "reasoning-start":
        dispatch({ type: "ENSURE_ASSISTANT", id: d.messageId })
        dispatch({
          type: "UPDATE_MSG", id: d.messageId, updater: m => ({
            ...m, parts: [...m.parts, { type: "thinking" as const, text: "", partId: d.partId, done: false }]
          })
        })
        break

      case "reasoning-delta":
        dispatch({
          type: "UPDATE_MSG", id: d.messageId, updater: m => ({
            ...m, parts: m.parts.map(p =>
              p.type === "thinking" && (p as any).partId === d.partId
                ? { ...p, text: d.text }
                : p
            )
          })
        })
        break

      case "reasoning-end":
        dispatch({
          type: "UPDATE_MSG", id: d.messageId, updater: m => ({
            ...m, parts: m.parts.map(p =>
              p.type === "thinking" && (p as any).partId === d.partId
                ? { ...p, done: true }
                : p
            )
          })
        })
        break

      case "loop-start":
        dispatch({ type: "SET_RUNNING", running: true })
        break

      case "loop-end": {
        dispatch({ type: "SET_RUNNING", running: false })
        // Reconcile: fetch full message history
        const sid = d.sessionId || state.sessionId
        if (sid) {
          fetch(`${backendUrl}/api/sessions/${sid}/messages`)
            .then(r => r.json())
            .then((msgs: Message[]) => {
              if (Array.isArray(msgs)) dispatch({ type: "LOAD_MESSAGES", messages: msgs })
            })
            .catch(() => {})
        }
        break
      }

      case "assistant-message-end":
        if (d.finish === "stop" || d.finish === "length") {
          dispatch({ type: "SET_RUNNING", running: false })
        }
        break

      case "error": {
        const errText = typeof d.error === "string" ? d.error : (d.error?.message || JSON.stringify(d.error))
        if (!/abort/i.test(errText)) {
          console.error("[RightPane] Agent error:", errText)
          dispatch({ type: "SET_ERROR", error: errText })
        }
        break
      }

      case "session-switch":
        dispatch({ type: "SET_SESSION", sessionId: d.sessionId })
        if (d.messages) dispatch({ type: "LOAD_MESSAGES", messages: d.messages })
        break

      case "session-reset":
        dispatch({ type: "SET_SESSION", sessionId: d.sessionId })
        dispatch({ type: "CLEAR_MESSAGES" })
        break
    }
  }
  handleEventRef.current = handleEvent

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [state.messages])

  // Send message
  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || state.running) return

    setInput("")
    const optimisticId = `_opt_${Date.now()}`
    dispatch({ type: "ADD_USER_MSG", id: optimisticId, text })
    dispatch({ type: "SET_RUNNING", running: true })
    dispatch({ type: "SET_ERROR", error: null })

    try {
      const body: Record<string, unknown> = { text }
      if (state.sessionId) body.sessionId = state.sessionId
      if (context) body.context = context

      const res = await fetch(`${backendUrl}/api/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.sessionId) {
        dispatch({ type: "SET_SESSION", sessionId: data.sessionId })
        localStorage.setItem("quark-desktop-session", data.sessionId)
      }
      if (data.error) {
        dispatch({ type: "SET_ERROR", error: data.error })
        dispatch({ type: "SET_RUNNING", running: false })
      }
    } catch (err: any) {
      console.error("[RightPane] send error", err)
      dispatch({ type: "SET_ERROR", error: err.message || String(err) })
      dispatch({ type: "SET_RUNNING", running: false })
    }
  }, [input, state.sessionId, state.running, backendUrl, context])

  const cancelAgent = useCallback(async () => {
    if (!state.sessionId) return
    try {
      await fetch(`${backendUrl}/api/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId }),
      })
      dispatch({ type: "SET_RUNNING", running: false })
    } catch {}
  }, [backendUrl, state.sessionId])

  const toggleThinking = useCallback(async () => {
    const next = !state.showThinking
    dispatch({ type: "SET_SHOW_THINKING", show: next })
    try {
      await fetch(`${backendUrl}/api/thinking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      })
    } catch {}
  }, [backendUrl, state.showThinking])

  return (
    <div className="agent-card">
      {/* Agent Header */}
      <header className="agent-header">
        <div>
          <p className="eyebrow">Agent Intelligence</p>
          <h2>Quark</h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={toggleThinking}
            title={state.showThinking ? "Disable extended thinking" : "Enable extended thinking"}
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "3px 8px",
              borderRadius: 6,
              background: state.showThinking ? "var(--accent)" : "transparent",
              color: state.showThinking ? "#fff" : "var(--muted)",
              border: state.showThinking ? "none" : "1px solid var(--line)",
              cursor: "pointer",
            }}
          >
            T
          </button>
          <span className={`status-dot ${!state.connected ? "disconnected" : ""}`} />
        </div>
      </header>

      {/* Chat Thread */}
      <section className="chat-thread" aria-label="Agent chat">
        {state.errorMsg && (
          <div style={{
            padding: "10px 14px",
            background: "rgba(210,31,37,0.08)",
            border: "1px solid rgba(210,31,37,0.2)",
            borderRadius: 10,
            color: "#d21f25",
            fontSize: 13,
            lineHeight: 1.5,
            wordBreak: "break-word",
          }}>
            <strong>Error:</strong> {state.errorMsg}
          </div>
        )}
        {state.messages.length === 0 && !state.errorMsg && (
          <div style={{ color: "var(--muted)", fontSize: "14px", textAlign: "center", padding: "40px 0" }}>
            Send a message to start
          </div>
        )}

        {state.messages.map((msg) => (
          <article key={msg.id} className={msg.role === "user" ? "prompt-turn" : "response-turn"}>
            {msg.role === "user" ? (
              <>
                {msg.parts.filter(p => p.type === "text").map((p, i) => (
                  <p key={i}>{(p as any).text}</p>
                ))}
                <div className="message-actions">
                  <button
                    aria-label="Copy prompt"
                    title="Copy prompt"
                    onClick={() => {
                      const text = msg.parts.filter(p => p.type === "text").map(p => (p as any).text).join("\n")
                      navigator.clipboard.writeText(text).catch(() => {})
                    }}
                  >
                    <svg className="codex-icon"><use href="#icon-copy" /></svg>
                  </button>
                </div>
              </>
            ) : (
              <>
                {msg.parts.map((part, i) => {
                  if (part.type === "thinking") {
                    if (!state.showThinking) return null
                    const tp = part as any
                    return (
                      <details key={i} style={{ marginBottom: 8 }}>
                        <summary style={{
                          cursor: "pointer",
                          color: "var(--muted)",
                          fontSize: 12,
                          fontWeight: 500,
                          padding: "4px 0",
                        }}>
                          {tp.done ? "Thinking" : "Thinking…"}
                        </summary>
                        <pre style={{
                          margin: 0,
                          padding: "8px 12px",
                          background: "var(--pane)",
                          borderRadius: 8,
                          fontSize: 12,
                          lineHeight: 1.5,
                          color: "var(--muted)",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          maxHeight: 300,
                          overflow: "auto",
                        }}>
                          {tp.text || "…"}
                        </pre>
                      </details>
                    )
                  }
                  if (part.type === "tool") {
                    const tp = part as any
                    const isDone = tp.status === "completed" || tp.status === "error"
                    return (
                      <details key={i} style={{ marginBottom: 6 }} open={!isDone}>
                        <summary style={{
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "4px 0",
                          fontSize: 12,
                          color: tp.status === "error" ? "#d21f25" : "var(--muted)",
                        }}>
                          <span style={{
                            display: "inline-block",
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: tp.status === "running" ? "var(--accent)"
                              : tp.status === "error" ? "#d21f25"
                              : "#00a344",
                            animation: tp.status === "running" ? "blink 1s infinite" : "none",
                          }} />
                          {toolLabel(tp.tool)}
                          {tp.input && (
                            <span style={{ color: "var(--text)", fontWeight: 500 }}>
                              {toolDesc(tp.tool, tp.input)}
                            </span>
                          )}
                        </summary>
                        {isDone && tp.output && (
                          <pre style={{
                            margin: "4px 0 0",
                            padding: "6px 10px",
                            background: "var(--pane)",
                            borderRadius: 6,
                            fontSize: 11,
                            lineHeight: 1.4,
                            color: "var(--muted)",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            maxHeight: 200,
                            overflow: "auto",
                          }}>
                            {tp.output.length > 1000 ? tp.output.slice(0, 1000) + "…" : tp.output}
                          </pre>
                        )}
                        {tp.status === "error" && tp.error && (
                          <pre style={{
                            margin: "4px 0 0",
                            padding: "6px 10px",
                            background: "rgba(210,31,37,0.06)",
                            borderRadius: 6,
                            fontSize: 11,
                            lineHeight: 1.4,
                            color: "#d21f25",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}>
                            {tp.error}
                          </pre>
                        )}
                      </details>
                    )
                  }
                  if (part.type === "text") {
                    const tp = part as any
                    return (
                      <p key={i}>
                        {tp.text}
                        {tp.streaming && (
                          <span style={{
                            display: "inline-block",
                            width: 6,
                            height: 14,
                            background: "var(--accent)",
                            marginLeft: 2,
                            animation: "blink 1s infinite",
                          }} />
                        )}
                      </p>
                    )
                  }
                  return null
                })}

                {msg.parts.some(p => p.type === "text" && !(p as any).streaming && (p as any).text) && (
                  <div className="response-actions">
                    <button
                      aria-label="Copy response"
                      title="Copy response"
                      onClick={() => {
                        const text = msg.parts.filter(p => p.type === "text").map(p => (p as any).text).join("\n")
                        navigator.clipboard.writeText(text).catch(() => {})
                      }}
                    >
                      <svg className="codex-icon"><use href="#icon-copy" /></svg>
                    </button>
                  </div>
                )}
              </>
            )}
          </article>
        ))}

        {state.running && !state.messages.some(m => m.role === "assistant" && m.parts.some(p => p.type === "text" && (p as any).streaming)) && (
          <div className="work-row"><span>Thinking…</span></div>
        )}
        <div ref={bottomRef} />
      </section>

      {/* Omnibar */}
      <form
        className="omnibar"
        onSubmit={e => { e.preventDefault(); sendMessage() }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask Quark…"
          aria-label="Command input"
          disabled={!state.connected}
        />
        <div className="composer-tools">
          {state.running ? (
            <button
              type="button"
              onClick={cancelAgent}
              style={{
                marginLeft: "auto",
                background: "#d21f25",
                color: "#fff",
                width: 28,
                height: 28,
                borderRadius: 999,
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
              }}
              aria-label="Cancel"
              title="Cancel"
            >
              <svg className="codex-icon" style={{ width: 16, height: 16 }}><use href="#icon-more-h" /></svg>
            </button>
          ) : (
            <button
              type="submit"
              className="send-button"
              aria-label="Send command"
              title="Send command"
              disabled={!state.connected || !input.trim()}
            >
              <svg className="codex-icon"><use href="#icon-arrow-up" /></svg>
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

// ---- Tool display helpers (mirrors web client) ----
const TOOL_LABELS: Record<string, string> = {
  read: "Read", write: "Write", edit: "Edit", bash: "Bash",
  skill: "Skill", todo: "Todo", grep: "Search", glob: "Glob",
  websearch: "Web Search", webfetch: "Fetch", compact: "Compact",
}

function toolLabel(id: string) {
  return TOOL_LABELS[id] || id.charAt(0).toUpperCase() + id.slice(1)
}

function toolDesc(tool: string, input: Record<string, unknown> | null) {
  if (!input) return ""
  if ((tool === "read" || tool === "write" || tool === "edit") && (input.path || input.filePath))
    return (input.path || input.filePath) as string
  if (tool === "bash" && input.command) return (input.command as string).slice(0, 70)
  if (tool === "grep" && input.pattern) return input.pattern as string
  if (tool === "glob" && input.pattern) return input.pattern as string
  if (tool === "skill" && input.name) return input.name as string
  if (tool === "websearch" && input.query) return (input.query as string).slice(0, 50)
  if (tool === "webfetch" && input.url) return (input.url as string).slice(0, 50)
  return ""
}
