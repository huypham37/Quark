// TUI state types — the data model driving the UI

export interface TuiMessage {
  id: string
  role: "user" | "assistant"
  parts: TuiPart[]
  streaming?: boolean // true while assistant is streaming
}

export type TuiPart =
  | { type: "text"; text: string; streaming?: boolean }
  | { type: "tool"; tool: string; callId: string; status: "pending" | "running" | "completed" | "error"; input: Record<string, unknown>; output?: string; error?: string }
  | { type: "thinking"; done: boolean }

export interface TuiStatus {
  tokensUsed: number
  tokenLimit: number
  cost: number
  modelName: string
  skillCount: number
}

export interface PermissionRequest {
  requestId: string
  tool: string
  input: Record<string, unknown>
}

export interface TuiState {
  sessionId: string | null
  messages: TuiMessage[]
  running: boolean
  status: TuiStatus
  lastError?: string
  permission?: PermissionRequest
}

export function initialState(): TuiState {
  return {
    sessionId: null,
    messages: [],
    running: false,
    status: {
      tokensUsed: 0,
      tokenLimit: 168_000,
      cost: 0,
      modelName: "smart",
      skillCount: 0,
    },
  }
}

// ---- Actions ----

export type TuiAction =
  | { type: "set-session"; sessionId: string }
  | { type: "add-user-message"; id: string; text: string }
  | { type: "add-assistant-message"; id: string }
  | { type: "text-start"; messageId: string }
  | { type: "text-delta"; messageId: string; delta: string; text: string }
  | { type: "text-end"; messageId: string; text: string }
  | { type: "tool-start"; messageId: string; tool: string; callId: string }
  | { type: "tool-input"; messageId: string; callId: string; input: Record<string, unknown> }
  | { type: "tool-end"; messageId: string; callId: string; status: "completed" | "error"; output?: string; error?: string }
  | { type: "assistant-done"; messageId: string }
  | { type: "set-running"; running: boolean }
  | { type: "update-status"; partial: Partial<TuiStatus> }
  | { type: "set-error"; message: string }
  | { type: "clear-error" }
  | { type: "set-permission"; request: PermissionRequest }
  | { type: "clear-permission" }

// ---- Reducer ----

export function reduce(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case "set-session":
      return { ...state, sessionId: action.sessionId }

    case "add-user-message":
      return {
        ...state,
        messages: [...state.messages, {
          id: action.id,
          role: "user",
          parts: [{ type: "text", text: action.text }],
        }],
      }

    case "add-assistant-message":
      return {
        ...state,
        messages: [...state.messages, {
          id: action.id,
          role: "assistant",
          parts: [],
          streaming: true,
        }],
      }

    case "text-start": {
      return updateMessage(state, action.messageId, (msg) => ({
        ...msg,
        parts: [...msg.parts, { type: "text" as const, text: "", streaming: true }],
      }))
    }

    case "text-delta": {
      return updateMessage(state, action.messageId, (msg) => ({
        ...msg,
        parts: msg.parts.map((p, i) =>
          i === msg.parts.length - 1 && p.type === "text"
            ? { ...p, text: action.text }
            : p,
        ),
      }))
    }

    case "text-end": {
      return updateMessage(state, action.messageId, (msg) => ({
        ...msg,
        parts: msg.parts.map((p, i) =>
          i === msg.parts.length - 1 && p.type === "text"
            ? { ...p, text: action.text, streaming: false }
            : p,
        ),
      }))
    }

    case "tool-start": {
      return updateMessage(state, action.messageId, (msg) => ({
        ...msg,
        parts: [...msg.parts, {
          type: "tool" as const,
          tool: action.tool,
          callId: action.callId,
          status: "pending" as const,
          input: {},
        }],
      }))
    }

    case "tool-input": {
      return updateMessage(state, action.messageId, (msg) => ({
        ...msg,
        parts: msg.parts.map((p) =>
          p.type === "tool" && p.callId === action.callId
            ? { ...p, status: "running" as const, input: action.input }
            : p,
        ),
      }))
    }

    case "tool-end": {
      return updateMessage(state, action.messageId, (msg) => ({
        ...msg,
        parts: msg.parts.map((p) =>
          p.type === "tool" && p.callId === action.callId
            ? { ...p, status: action.status, output: action.output, error: action.error }
            : p,
        ),
      }))
    }

    case "assistant-done": {
      return updateMessage(state, action.messageId, (msg) => ({
        ...msg,
        streaming: false,
      }))
    }

    case "set-running":
      return { ...state, running: action.running }

    case "update-status":
      return { ...state, status: { ...state.status, ...action.partial } }

    case "set-error":
      return { ...state, lastError: action.message, running: false }

    case "clear-error":
      return { ...state, lastError: undefined }

    case "set-permission":
      return { ...state, permission: action.request, running: false }

    case "clear-permission":
      return { ...state, permission: undefined }

    default:
      return state
  }
}

// Helper: update a specific message immutably
function updateMessage(
  state: TuiState,
  messageId: string,
  fn: (msg: TuiMessage) => TuiMessage,
): TuiState {
  return {
    ...state,
    messages: state.messages.map((m) =>
      m.id === messageId ? fn(m) : m,
    ),
  }
}
