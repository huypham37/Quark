// SolidJS state layer — replaces React useReducer with createStore
//
// Contains all TUI state types (formerly in tui/state/state.ts) and
// the SolidJS store + dispatch implementation.

import { createStore, produce, type SetStoreFunction } from "solid-js/store"
import type { MessageRow, PartRow, TextPartData, ToolPartData, ImagePartData, ReasoningPartData } from "../session/message"
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
  | { type: "tool"; tool: string; callId: string; status: "pending" | "running" | "completed" | "error"; input: Record<string, unknown>; output?: string; error?: string; diff?: string; streamingContent?: string; subAgent?: SubAgentState }
  | { type: "thinking"; done: boolean; text: string }
  | { type: "image"; mime: string; label: string }

// Sub-agent observability state — attached to tool parts that spawn sub-agents
export interface SubAgentToolPart {
  tool: string
  callId: string
  status: "pending" | "running" | "completed" | "error"
  input: Record<string, unknown>
  error?: string
}

export interface SubAgentState {
  profile: string
  tools: SubAgentToolPart[]
  // Token tracking for the sub-agent's context window
  tokensUsed: number
  tokenLimit: number
  // Streaming text preview from the sub-agent
  textPreview?: string
  done: boolean
}

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
  | { type: "reset-session"; sessionId: string | null }
  | { type: "load-session"; sessionId: string; messages: TuiMessage[] }
  | { type: "add-user-message"; id: string; text: string; images?: { mime: string; label: string }[] }
  | { type: "add-assistant-message"; id: string }
  | { type: "text-start"; messageId: string }
  | { type: "text-delta"; messageId: string; delta: string; text: string }
  | { type: "text-end"; messageId: string; text: string }
  | { type: "tool-start"; messageId: string; tool: string; callId: string }
  | { type: "tool-input"; messageId: string; callId: string; input: Record<string, unknown> }
  | { type: "tool-end"; messageId: string; callId: string; status: "completed" | "error"; output?: string; error?: string; diff?: string }
  | { type: "tool-stream-delta"; messageId: string; callId: string; content: string }
  | { type: "assistant-done"; messageId: string }
  | { type: "set-running"; running: boolean }
  | { type: "update-status"; partial: Partial<TuiStatus> }
  | { type: "set-error"; message: string }
  | { type: "clear-error" }
  | { type: "set-permission"; request: PermissionRequest }
  | { type: "clear-permission" }
  | { type: "set-compacting"; compacting: boolean }
  // Sub-agent observability actions
  | { type: "subagent-tool-start"; messageId: string; parentCallId: string; profile: string; tool: string; callId: string }
  | { type: "subagent-tool-input"; messageId: string; parentCallId: string; profile: string; tool: string; callId: string; input: Record<string, unknown> }
  | { type: "subagent-tool-end"; messageId: string; parentCallId: string; profile: string; tool: string; callId: string; status: "completed" | "error"; error?: string }
  | { type: "subagent-step-finish"; messageId: string; parentCallId: string; profile: string; tokens?: { input?: number; output?: number }; tokenLimit?: number }
  | { type: "subagent-text-delta"; messageId: string; parentCallId: string; profile: string; text: string }
  | { type: "subagent-done"; messageId: string; parentCallId: string; profile: string }
  | { type: "toggle-thinking" }
  | { type: "reasoning-start"; messageId: string }
  | { type: "reasoning-delta"; messageId: string; partId: string; delta: string; text: string }
  | { type: "reasoning-end"; messageId: string }

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
      } else if (p.type === "reasoning") {
        const d = JSON.parse(p.data) as ReasoningPartData
        if (d.text) {
          tuiParts.push({ type: "thinking", done: true, text: d.text })
        }
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
  thinkingEnabled: boolean
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
    thinkingEnabled: false,
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
            output: undefined,
            error: undefined,
            diff: undefined,
            subAgent: undefined,
          })
        }),
      )
      break

    case "tool-input": {
      // Find the part by index so we can use explicit setStore paths
      const tiMsgIdx = state.store.messages.findIndex((m) => m.id === action.messageId)
      if (tiMsgIdx === -1) break
      const tiPartIdx = state.store.messages[tiMsgIdx]!.parts.findIndex(
        (p) => p.type === "tool" && (p as Extract<TuiPart, { type: "tool" }>).callId === action.callId,
      )
      if (tiPartIdx === -1) break
      setStore("messages", tiMsgIdx, "parts", tiPartIdx, produce((part: TuiPart) => {
        if (part.type === "tool") {
          part.status = "running"
          part.input = action.input
        }
      }))
      // Eagerly initialize subAgent when the bash command is a sub-agent invocation.
      // This makes the Match condition in message-item.tsx switch to SubAgentView
      // immediately — before the child process boots and sends its first event.
      const tiPart = state.store.messages[tiMsgIdx]!.parts[tiPartIdx] as Extract<TuiPart, { type: "tool" }>
      if (tiPart.tool === "bash" && !tiPart.subAgent) {
        const cmd = action.input.command ?? action.input.cmd
        if (typeof cmd === "string" && /\bquark\b.*--sub-agent\b/.test(cmd)) {
          const profile = cmd.match(/--profile\s+(\S+)/)?.[1] ?? "sub-agent"
          setStore("messages", tiMsgIdx, "parts", tiPartIdx, "subAgent" as any, {
            profile,
            tools: [],
            tokensUsed: 0,
            tokenLimit: 0,
            done: false,
          })
        }
      }
      break
    }

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
            part.diff = action.diff
            part.streamingContent = undefined
          }
        }),
      )
      break

    case "tool-stream-delta":
      setStore(
        "messages",
        (m) => m.id === action.messageId,
        "parts",
        produce((parts: TuiPart[]) => {
          const part = parts.find((p) => p.type === "tool" && p.callId === action.callId)
          if (part && part.type === "tool") {
            part.streamingContent = action.content
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

    case "toggle-thinking":
      setStore("thinkingEnabled", (prev) => !prev)
      break

    case "reasoning-start":
      setStore(
        "messages",
        (m) => m.id === action.messageId,
        "parts",
        produce((parts: TuiPart[]) => {
          parts.push({ type: "thinking", done: false, text: "" })
        }),
      )
      break

    case "reasoning-delta":
      setStore(
        "messages",
        (m) => m.id === action.messageId,
        "parts",
        produce((parts: TuiPart[]) => {
          const last = parts[parts.length - 1]
          if (last && last.type === "thinking") {
            last.text = action.text
          }
        }),
      )
      break

    case "reasoning-end":
      setStore(
        "messages",
        (m) => m.id === action.messageId,
        "parts",
        produce((parts: TuiPart[]) => {
          const last = parts[parts.length - 1]
          if (last && last.type === "thinking") {
            last.done = true
          }
        }),
      )
      break

    // ------------------------------------------------------------------
    // Sub-agent observability — mutate the parent tool part's subAgent state
    //
    // All handlers use explicit setStore() path notation (never produce() for
    // the subAgent property itself). SolidJS tracks property paths set via
    // setStore(); assigning parent.subAgent = {} inside produce() on a
    // previously-undefined property does NOT reliably notify Match/Show
    // conditions watching that path.
    // ------------------------------------------------------------------

    case "subagent-tool-start": {
      const msgIdx = state.store.messages.findIndex((m) => m.id === action.messageId)
      if (msgIdx === -1) break
      const partIdx = state.store.messages[msgIdx]!.parts.findIndex(
        (p) => p.type === "tool" && (p as Extract<TuiPart, { type: "tool" }>).callId === action.parentCallId
      )
      if (partIdx === -1) break
      const existing = (state.store.messages[msgIdx]!.parts[partIdx] as Extract<TuiPart, { type: "tool" }>).subAgent
      if (!existing) {
        // First sub-agent event — initialize subAgent via explicit path so SolidJS
        // registers the new property and notifies all Match/Show watchers.
        setStore("messages", msgIdx, "parts", partIdx, "subAgent" as any, {
          profile: action.profile,
          tools: [],
          tokensUsed: 0,
          tokenLimit: 0,
          done: false,
        })
      }
      setStore(
        "messages", msgIdx, "parts", partIdx, "subAgent" as any,
        produce((sa: SubAgentState) => {
          sa.tools.push({ tool: action.tool, callId: action.callId, status: "pending", input: {} })
        }),
      )
      break
    }

    case "subagent-tool-input": {
      const msgIdx = state.store.messages.findIndex((m) => m.id === action.messageId)
      if (msgIdx === -1) break
      const partIdx = state.store.messages[msgIdx]!.parts.findIndex(
        (p) => p.type === "tool" && (p as Extract<TuiPart, { type: "tool" }>).callId === action.parentCallId
      )
      if (partIdx === -1) break
      const sa = (state.store.messages[msgIdx]!.parts[partIdx] as Extract<TuiPart, { type: "tool" }>).subAgent
      if (!sa) break
      const childIdx = sa.tools.findIndex((t) => t.callId === action.callId)
      if (childIdx === -1) break
      setStore(
        "messages", msgIdx, "parts", partIdx, "subAgent" as any,
        produce((s: SubAgentState) => {
          s.tools[childIdx]!.status = "running"
          s.tools[childIdx]!.input = action.input
        }),
      )
      break
    }

    case "subagent-tool-end": {
      const msgIdx = state.store.messages.findIndex((m) => m.id === action.messageId)
      if (msgIdx === -1) break
      const partIdx = state.store.messages[msgIdx]!.parts.findIndex(
        (p) => p.type === "tool" && (p as Extract<TuiPart, { type: "tool" }>).callId === action.parentCallId
      )
      if (partIdx === -1) break
      const sa = (state.store.messages[msgIdx]!.parts[partIdx] as Extract<TuiPart, { type: "tool" }>).subAgent
      if (!sa) break
      const childIdx = sa.tools.findIndex((t) => t.callId === action.callId)
      if (childIdx === -1) break
      setStore(
        "messages", msgIdx, "parts", partIdx, "subAgent" as any,
        produce((s: SubAgentState) => {
          s.tools[childIdx]!.status = action.status
          s.tools[childIdx]!.error = action.error
        }),
      )
      break
    }

    case "subagent-step-finish": {
      const msgIdx = state.store.messages.findIndex((m) => m.id === action.messageId)
      if (msgIdx === -1) break
      const partIdx = state.store.messages[msgIdx]!.parts.findIndex(
        (p) => p.type === "tool" && (p as Extract<TuiPart, { type: "tool" }>).callId === action.parentCallId
      )
      if (partIdx === -1) break
      const existing = (state.store.messages[msgIdx]!.parts[partIdx] as Extract<TuiPart, { type: "tool" }>).subAgent
      if (!existing) {
        setStore("messages", msgIdx, "parts", partIdx, "subAgent" as any, {
          profile: action.profile,
          tools: [],
          tokensUsed: 0,
          tokenLimit: 0,
          done: false,
        })
      }
      setStore(
        "messages", msgIdx, "parts", partIdx, "subAgent" as any,
        produce((sa: SubAgentState) => {
          if (action.tokens?.input) sa.tokensUsed = action.tokens.input
          if (action.tokenLimit && action.tokenLimit > 0) sa.tokenLimit = action.tokenLimit
        }),
      )
      break
    }

    case "subagent-text-delta": {
      const msgIdx = state.store.messages.findIndex((m) => m.id === action.messageId)
      if (msgIdx === -1) break
      const partIdx = state.store.messages[msgIdx]!.parts.findIndex(
        (p) => p.type === "tool" && (p as Extract<TuiPart, { type: "tool" }>).callId === action.parentCallId
      )
      if (partIdx === -1) break
      const existing = (state.store.messages[msgIdx]!.parts[partIdx] as Extract<TuiPart, { type: "tool" }>).subAgent
      if (!existing) {
        setStore("messages", msgIdx, "parts", partIdx, "subAgent" as any, {
          profile: action.profile,
          tools: [],
          tokensUsed: 0,
          tokenLimit: 0,
          done: false,
        })
      }
      const text = action.text
      const preview = text.length > 120 ? "…" + text.slice(-119) : text
      setStore("messages", msgIdx, "parts", partIdx, "subAgent" as any,
        produce((sa: SubAgentState) => { sa.textPreview = preview })
      )
      break
    }

    case "subagent-done": {
      const msgIdx = state.store.messages.findIndex((m) => m.id === action.messageId)
      if (msgIdx === -1) break
      const partIdx = state.store.messages[msgIdx]!.parts.findIndex(
        (p) => p.type === "tool" && (p as Extract<TuiPart, { type: "tool" }>).callId === action.parentCallId
      )
      if (partIdx === -1) break
      const existing = (state.store.messages[msgIdx]!.parts[partIdx] as Extract<TuiPart, { type: "tool" }>).subAgent
      if (!existing) {
        setStore("messages", msgIdx, "parts", partIdx, "subAgent" as any, {
          profile: action.profile,
          tools: [],
          tokensUsed: 0,
          tokenLimit: 0,
          done: false,
        })
      }
      setStore("messages", msgIdx, "parts", partIdx, "subAgent" as any,
        produce((sa: SubAgentState) => {
          sa.done = true
          sa.textPreview = undefined
        })
      )
      // Mark the parent tool part as completed so the InlineSpinner stops animating.
      setStore("messages", msgIdx, "parts", partIdx, produce((part: TuiPart) => {
        if (part.type === "tool") part.status = "completed"
      }))
      break
    }
  }
}
