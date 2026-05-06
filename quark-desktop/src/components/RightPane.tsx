import { useState, useEffect, useRef, useCallback, useReducer } from "react"

// ---- Types ----
interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  isStreaming?: boolean
}

// ---- Reducer ----
type ChatAction =
  | { type: "ADD_USER"; text: string }
  | { type: "START_ASSISTANT" }
  | { type: "APPEND_TEXT"; text: string }
  | { type: "FINISH_ASSISTANT" }
  | { type: "SET_CONNECTED"; connected: boolean }
  | { type: "SET_SESSION"; sessionId: string }

interface ChatState {
  messages: ChatMessage[]
  sessionId: string | null
  connected: boolean
  running: boolean
  streamingId: string | null
}

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "ADD_USER":
      return {
        ...state,
        messages: [...state.messages, {
          id: `user-${Date.now()}`,
          role: "user",
          content: action.text,
        }],
      }
    case "START_ASSISTANT": {
      const id = `asst-${Date.now()}`
      return {
        ...state,
        running: true,
        streamingId: id,
        messages: [...state.messages, {
          id,
          role: "assistant",
          content: "",
          isStreaming: true,
        }],
      }
    }
    case "APPEND_TEXT": {
      if (!state.streamingId) return state
      return {
        ...state,
        messages: state.messages.map(m =>
          m.id === state.streamingId
            ? { ...m, content: m.content + action.text }
            : m
        ),
      }
    }
    case "FINISH_ASSISTANT":
      return {
        ...state,
        running: false,
        streamingId: null,
        messages: state.messages.map(m =>
          m.id === state.streamingId
            ? { ...m, isStreaming: false }
            : m
        ),
      }
    case "SET_CONNECTED":
      return { ...state, connected: action.connected }
    case "SET_SESSION":
      return { ...state, sessionId: action.sessionId }
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
    streamingId: null,
  })

  const [input, setInput] = useState("")
  const wsRef = useRef<WebSocket | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // WebSocket connection
  useEffect(() => {
    const wsUrl = backendUrl.replace(/^http/, "ws") + "/ws"
    console.log("[RightPane] connecting to", wsUrl)
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      console.log("[RightPane] WS connected")
      dispatch({ type: "SET_CONNECTED", connected: true })
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        switch (msg.event) {
          case "text-delta":
            dispatch({ type: "APPEND_TEXT", text: msg.data.text })
            break
          case "text-start":
            dispatch({ type: "START_ASSISTANT" })
            break
          case "text-end":
            break
          case "assistant-message-start":
            dispatch({ type: "START_ASSISTANT" })
            break
          case "assistant-message-end":
            dispatch({ type: "FINISH_ASSISTANT" })
            break
          case "session-created":
            dispatch({ type: "SET_SESSION", sessionId: msg.data.sessionId })
            break
          case "loop-end":
            dispatch({ type: "FINISH_ASSISTANT" })
            break
        }
      } catch {}
    }

    ws.onclose = () => {
      console.log("[RightPane] WS disconnected")
      dispatch({ type: "SET_CONNECTED", connected: false })
    }

    ws.onerror = (err) => {
      console.error("[RightPane] WS error", err)
    }

    return () => {
      ws.close()
    }
  }, [backendUrl])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [state.messages])

  // Send message
  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || state.running) return

    setInput("")
    dispatch({ type: "ADD_USER", text })

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
      if (data.sessionId && !state.sessionId) {
        dispatch({ type: "SET_SESSION", sessionId: data.sessionId })
      }
    } catch (err) {
      console.error("[RightPane] send error", err)
    }
  }, [input, state.sessionId, state.running, backendUrl, context])

  const copyMessage = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(console.error)
  }, [])

  return (
    <div className="agent-card">
      {/* Agent Header */}
      <header className="agent-header">
        <div>
          <p className="eyebrow">Agent Intelligence</p>
          <h2>Quark</h2>
        </div>
        <span className={`status-dot ${!state.connected ? "disconnected" : ""}`} />
      </header>

      {/* Chat Thread */}
      <section className="chat-thread" aria-label="Agent chat">
        {/* Trace lines */}
        <div className="trace-line">
          <svg className="codex-icon"><use href="#icon-anchor" /></svg>
          <span>Stop</span>
        </div>
        <div className="trace-line">
          <svg className="codex-icon"><use href="#icon-anchor" /></svg>
          <span>UserPromptSubmit</span>
        </div>

        {state.messages.length === 0 && (
          <div style={{ color: "var(--muted)", fontSize: "14px", textAlign: "center", padding: "40px 0" }}>
            Send a message to start
          </div>
        )}

        {state.messages.map((msg) =>
          msg.role === "user" ? (
            <article key={msg.id} className="prompt-turn">
              <p>{msg.content}</p>
              <div className="message-actions">
                <button aria-label="Copy prompt" title="Copy prompt" onClick={() => copyMessage(msg.content)}>
                  <svg className="codex-icon"><use href="#icon-copy" /></svg>
                </button>
                <button aria-label="Edit prompt" title="Edit prompt">
                  <svg className="codex-icon"><use href="#icon-pencil" /></svg>
                </button>
              </div>
            </article>
          ) : (
            <article key={msg.id} className="response-turn">
              {msg.isStreaming && (
                <button className="work-row">
                  <span>Working...</span>
                  <svg className="codex-icon"><use href="#icon-chevron-right" /></svg>
                </button>
              )}
              <p>
                {msg.content}
                {msg.isStreaming && (
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
              {!msg.isStreaming && msg.content && (
                <div className="response-actions">
                  <button aria-label="Copy response" title="Copy response" onClick={() => copyMessage(msg.content)}>
                    <svg className="codex-icon"><use href="#icon-copy" /></svg>
                  </button>
                  <button aria-label="Good response" title="Good response">
                    <svg className="codex-icon"><use href="#icon-thumbs-up" /></svg>
                  </button>
                  <button aria-label="Bad response" title="Bad response">
                    <svg className="codex-icon"><use href="#icon-thumbs-down" /></svg>
                  </button>
                  <button aria-label="Expand response" title="Expand response">
                    <svg className="codex-icon"><use href="#icon-expand" /></svg>
                  </button>
                </div>
              )}

              <div className="trace-line">
                <svg className="codex-icon"><use href="#icon-anchor" /></svg>
                <span>Stop</span>
              </div>
            </article>
          )
        )}

        {state.running && !state.streamingId && (
          <div className="work-row"><span>Thinking...</span></div>
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
          placeholder="Ask for follow-up changes"
          aria-label="Command input"
          disabled={!state.connected}
        />
        <div className="composer-tools">
          <button type="button" aria-label="Add context" title="Add context">
            <svg className="codex-icon"><use href="#icon-plus" /></svg>
          </button>
          <span>Default permissions</span>
          <button
            type="submit"
            className="send-button"
            aria-label="Send command"
            title="Send command"
            disabled={!state.connected || state.running || !input.trim()}
          >
            <svg className="codex-icon"><use href="#icon-arrow-up" /></svg>
          </button>
        </div>
      </form>
    </div>
  )
}
