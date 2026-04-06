export interface SubAgentToolPart {
  tool: string
  callId: string
  status: 'pending' | 'running' | 'completed' | 'error'
  input: Record<string, unknown>
  error?: string
}

export interface SubAgentState {
  profile: string
  tools: SubAgentToolPart[]
  tokensUsed: number
  tokenLimit: number
  textPreview?: string
  done: boolean
}

export interface ToolPart {
  type: 'tool'
  tool: string
  callId: string
  status: 'running' | 'completed' | 'error'
  input: Record<string, unknown> | null
  output: string | null
  error: string | null
  subAgent?: SubAgentState
}

export interface TextPart {
  type: 'text'
  text: string
  partId?: string
  streaming?: boolean
}

export interface ThinkingPart {
  type: 'thinking'
  text: string
  partId?: string
  done: boolean
}

export interface ImagePart {
  type: 'image'
  mime: string
  data: string
}

export type MessagePart = TextPart | ToolPart | ThinkingPart | ImagePart

export interface Message {
  id: string
  role: 'user' | 'assistant'
  parts: MessagePart[]
}

export interface Toast {
  id: number
  title: string
  body: string
  kind: 'error' | 'warn'
}

export interface PermissionRequest {
  requestId: string
  tool: string
  input: Record<string, unknown>
}

export interface AppState {
  sessionId: string | null
  sessions: { id: string; title?: string }[]
  messages: Message[]
  running: boolean
  connected: boolean
  tokensUsed: number
  tokenLimit: number
  modelName: string
  models: string[]
  permission: PermissionRequest | null
  toasts: Toast[]
  sidebarOpen: boolean
  modelPickerOpen: boolean
  compacting: boolean
  showThinking: boolean
  /** Optimistic IDs that were already reconciled — ADD_USER_MSG should skip these */
  _reconciledOptIds: Set<string>
}

export const initialState: AppState = {
  sessionId: null,
  sessions: [],
  messages: [],
  running: false,
  connected: false,
  tokensUsed: 0,
  tokenLimit: 0,
  modelName: '—',
  models: [],
  permission: null,
  toasts: [],
  sidebarOpen: false,
  modelPickerOpen: false,
  compacting: false,
  showThinking: false,
  _reconciledOptIds: new Set(),
}

export type Action =
  | { type: 'SET'; payload: Partial<AppState> }
  | { type: 'ADD_TOAST'; id: number; title: string; body: string; kind?: 'error' | 'warn' }
  | { type: 'REMOVE_TOAST'; id: number }
  | { type: 'ADD_USER_MSG'; id: string; text: string; images?: { mime: string; data: string }[] }
  | { type: 'RECONCILE_USER_MSG'; optimisticId: string; realId: string; text: string }
  | { type: 'ENSURE_ASSISTANT'; id: string }
  | { type: 'UPDATE_MSG'; id: string; updater: (m: Message) => Message }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'LOAD_MESSAGES'; messages: Message[] }
  | { type: 'INIT_SUBAGENT'; messageId: string; callId: string; profile: string }
  | { type: 'SUBAGENT_EVENT'; messageId: string; parentCallId: string; profile: string; updater: (sa: SubAgentState) => void }

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'SET':
      return { ...s, ...a.payload }
    case 'ADD_TOAST':
      return { ...s, toasts: [...s.toasts, { id: a.id, title: a.title, body: a.body, kind: a.kind || 'error' }] }
    case 'REMOVE_TOAST':
      return { ...s, toasts: s.toasts.filter(t => t.id !== a.id) }
    case 'ADD_USER_MSG': {
      // Skip if already reconciled (RECONCILE_USER_MSG ran first in the race)
      if (s._reconciledOptIds.has(a.id)) return s
      if (s.messages.find(m => m.id === a.id)) return s
      const parts: MessagePart[] = [{ type: 'text', text: a.text }]
      if (a.images) {
        for (const img of a.images) {
          parts.push({ type: 'image', mime: img.mime, data: img.data })
        }
      }
      return { ...s, messages: [...s.messages, { id: a.id, role: 'user', parts }] }
    }
    case 'RECONCILE_USER_MSG': {
      // The WS user-message event fires the real server messageId.
      // If the optimistic message exists in state, rename it.
      // If React hasn't committed it yet (race), add with the real ID
      // and mark the optimistic ID so ADD_USER_MSG skips it later.
      if (s.messages.find(m => m.id === a.realId)) return s
      const optIdx = s.messages.findIndex(m => m.id === a.optimisticId)
      if (optIdx !== -1) {
        // Rename optimistic → real
        const updated = s.messages.map(m => m.id === a.optimisticId ? { ...m, id: a.realId } : m)
        return { ...s, messages: updated }
      }
      // Optimistic not committed yet — add with real ID and suppress the future ADD_USER_MSG
      const newReconciled = new Set(s._reconciledOptIds)
      newReconciled.add(a.optimisticId)
      return {
        ...s,
        messages: [...s.messages, { id: a.realId, role: 'user' as const, parts: [{ type: 'text' as const, text: a.text }] }],
        _reconciledOptIds: newReconciled,
      }
    }
    case 'ENSURE_ASSISTANT': {
      if (s.messages.find(m => m.id === a.id)) return s
      return { ...s, messages: [...s.messages, { id: a.id, role: 'assistant', parts: [] }] }
    }
    case 'UPDATE_MSG':
      return { ...s, messages: s.messages.map(m => m.id === a.id ? a.updater(m) : m) }
    case 'CLEAR_MESSAGES':
      return { ...s, messages: [] }
    case 'LOAD_MESSAGES':
      return { ...s, messages: a.messages }
    case 'INIT_SUBAGENT': {
      return { ...s, messages: s.messages.map(m => m.id !== a.messageId ? m : {
        ...m, parts: m.parts.map(p => {
          if (p.type !== 'tool' || p.callId !== a.callId || p.subAgent) return p
          return { ...p, subAgent: { profile: a.profile, tools: [], tokensUsed: 0, tokenLimit: 0, done: false } }
        })
      })}
    }
    case 'SUBAGENT_EVENT': {
      return { ...s, messages: s.messages.map(m => {
        if (m.id !== a.messageId) return m
        return { ...m, parts: m.parts.map(p => {
          if (p.type !== 'tool' || p.callId !== a.parentCallId) return p
          const sa: SubAgentState = p.subAgent
            ? { ...p.subAgent, tools: [...p.subAgent.tools] }
            : { profile: a.profile, tools: [], tokensUsed: 0, tokenLimit: 0, done: false }
          a.updater(sa)
          return { ...p, subAgent: sa }
        })}
      })}
    }
    default:
      return s
  }
}
