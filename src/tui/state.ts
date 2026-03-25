// SolidJS state layer — replaces React useReducer with createStore
//
// Contains all TUI state types (formerly in tui/state/state.ts) and
// the SolidJS store + dispatch implementation.

import { createStore, produce, type SetStoreFunction } from "solid-js/store"
import type { MessageRow, PartRow, TextPartData, ToolPartData, ImagePartData } from "../session/message"
import { getModelLimit } from "../provider/models"
import { getModelId, loadConfig } from "../config/config"

// ---------------------------------------------------------------------------
// TUI data model types
// ---------------------------------------------------------------------------

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
  | { type: "image"; mime: string; label: string }

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

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type TuiAction =
  | { type: "set-session"; sessionId: string }
  | { type: "reset-session"; sessionId: string }
  | { type: "load-session"; sessionId: string; messages: TuiMessage[] }
  | { type: "add-user-message"; id: string; text: string; images?: { mime: string; label: string }[] }
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
  | { type: "set-compacting"; compacting: boolean }

// ---------------------------------------------------------------------------
// Convert persisted DB rows to TuiMessage[] for display
// ---------------------------------------------------------------------------

export function dbToTuiMessages(messages: MessageRow[], parts: PartRow[]): TuiMessage[] {
  // Group parts by message ID
  const partsByMsg = new Map<string, PartRow[]>()
  for (const p of parts) {
    const list = partsByMsg.get(p.messageId) ?? []
    list.push(p)
    partsByMsg.set(p.messageId, list)
  }

  const result: TuiMessage[] = []

  for (const msg of messages) {
    const msgParts = partsByMsg.get(msg.id) ?? []
    const tuiParts: TuiPart[] = []

    for (const p of msgParts) {
      if (p.type === "text" || p.type === "summary") {
        const d = JSON.parse(p.data) as TextPartData
        if (d.text) {
          tuiParts.push({ type: "text", text: d.text })
        }
      } else if (p.type === "tool") {
        const d = JSON.parse(p.data) as ToolPartData
        tuiParts.push({
          type: "tool",
          tool: d.tool,
          callId: d.callId,
          status: d.status,
          input: d.input,
          output: d.output,
          error: d.error,
        })
      } else if (p.type === "image") {
        const d = JSON.parse(p.data) as ImagePartData
        // Count existing image parts to derive label number
        const idx = tuiParts.filter((x) => x.type === "image").length + 1
        tuiParts.push({ type: "image", mime: d.mime, label: `Image ${idx}` })
      }
      // skip step-start, step-finish — they're metadata
    }

    if (tuiParts.length > 0) {
      result.push({
        id: msg.id,
        role: msg.role,
        parts: tuiParts,
        streaming: false,
      })
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// SolidJS store
// ---------------------------------------------------------------------------

export interface AppStore {
  sessionId: string | null
  messages: TuiMessage[]
  running: boolean
  compacting: boolean
  status: TuiStatus
  error?: string
  permission?: PermissionRequest
  permissionQueue: PermissionRequest[]
}

export interface AppState {
  store: AppStore
  setStore: SetStoreFunction<AppStore>
}

export function createAppState(initial: {
  sessionId: string | null
  modelName: string
  skillCount: number
}): AppState {
  const [store, setStore] = createStore<AppStore>({
    sessionId: initial.sessionId,
    messages: [],
    running: false,
    compacting: false,
    status: {
      tokensUsed: 0,
      tokenLimit: (() => { const lim = getModelLimit(getModelId("main")); return lim?.input ?? lim?.context ?? loadConfig().context_window })(),
      cost: 0,
      modelName: initial.modelName,
      skillCount: initial.skillCount,
    },
    error: undefined,
    permission: undefined,
    permissionQueue: [],
  })
  return { store, setStore }
}

export function dispatch(state: AppState, action: TuiAction): void {
  const { setStore } = state

  switch (action.type) {
    case "set-session":
      setStore("sessionId", action.sessionId)
      break

    case "reset-session":
      setStore(
        produce((s) => {
          s.sessionId = action.sessionId
          s.messages = []
          s.running = false
          s.status.tokensUsed = 0
          s.status.cost = 0
          s.error = undefined
          s.permission = undefined
        }),
      )
      break

    case "load-session":
      setStore(
        produce((s) => {
          s.sessionId = action.sessionId
          s.messages = action.messages
          s.running = false
          s.status.tokensUsed = 0
          s.status.cost = 0
          s.error = undefined
          s.permission = undefined
        }),
      )
      break

    case "add-user-message":
      setStore(
        "messages",
        state.store.messages.length,
        {
          id: action.id,
          role: "user",
          parts: [
            { type: "text", text: action.text },
            ...(action.images ?? []).map((img, i) => ({
              type: "image" as const,
              mime: img.mime,
              label: img.label ?? `Image ${i + 1}`,
            })),
          ],
        },
      )
      break

    case "add-assistant-message":
      setStore(
        "messages",
        state.store.messages.length,
        {
          id: action.id,
          role: "assistant",
          parts: [],
          streaming: true,
        },
      )
      break

    case "text-start":
      setStore(
        "messages",
        (m) => m.id === action.messageId,
        "parts",
        produce((parts: TuiPart[]) => {
          parts.push({ type: "text", text: "", streaming: true })
        }),
      )
      break

    case "text-delta":
      setStore(
        "messages",
        (m) => m.id === action.messageId,
        "parts",
        produce((parts: TuiPart[]) => {
          const last = parts[parts.length - 1]
          if (last && last.type === "text") {
            last.text = action.text
          }
        }),
      )
      break

    case "text-end":
      setStore(
        "messages",
        (m) => m.id === action.messageId,
        "parts",
        produce((parts: TuiPart[]) => {
          const last = parts[parts.length - 1]
          if (last && last.type === "text") {
            last.text = action.text
            last.streaming = false
          }
        }),
      )
      break

    case "tool-start":
      setStore(
        "messages",
        (m) => m.id === action.messageId,
        "parts",
        produce((parts: TuiPart[]) => {
          parts.push({
            type: "tool",
            tool: action.tool,
            callId: action.callId,
            status: "pending",
            input: {},
          })
        }),
      )
      break

    case "tool-input":
      setStore(
        "messages",
        (m) => m.id === action.messageId,
        "parts",
        produce((parts: TuiPart[]) => {
          const part = parts.find((p) => p.type === "tool" && p.callId === action.callId)
          if (part && part.type === "tool") {
            part.status = "running"
            part.input = action.input
          }
        }),
      )
      break

    case "tool-end":
      setStore(
        "messages",
        (m) => m.id === action.messageId,
        "parts",
        produce((parts: TuiPart[]) => {
          const part = parts.find((p) => p.type === "tool" && p.callId === action.callId)
          if (part && part.type === "tool") {
            part.status = action.status
            part.output = action.output
            part.error = action.error
          }
        }),
      )
      break

    case "assistant-done":
      setStore("messages", (m) => m.id === action.messageId, "streaming", false)
      break

    case "set-running":
      setStore("running", action.running)
      break

    case "update-status":
      setStore("status", (prev) => ({ ...prev, ...action.partial }))
      break

    case "set-error":
      setStore(
        produce((s) => {
          s.error = action.message
          s.running = false
        }),
      )
      break

    case "clear-error":
      setStore("error", undefined)
      break

    case "set-permission":
      setStore(
        produce((s) => {
          if (s.permission) {
            // Another prompt is already visible — queue this one
            s.permissionQueue.push(action.request)
          } else {
            s.permission = action.request
            s.running = false
          }
        }),
      )
      break

    case "clear-permission":
      setStore(
        produce((s) => {
          const next = s.permissionQueue.shift()
          if (next) {
            // Promote next queued request without resuming running state
            s.permission = next
          } else {
            s.permission = undefined
          }
        }),
      )
      break

    case "set-compacting":
      setStore("compacting", action.compacting)
      break
  }
}
