import type {
  ImagePartData,
  MessageRow,
  PartRow,
  ReasoningPartData,
  TextPartData,
  ToolPartData,
} from "../session/message"

export interface ConversationMessage {
  id: string
  role: "user" | "assistant"
  parts: ConversationPart[]
  streaming?: boolean
}

export type ConversationPart =
  | { type: "text"; text: string; streaming?: boolean }
  | { type: "tool"; tool: string; callId: string; status: "pending" | "awaiting_approval" | "running" | "completed" | "error"; input: Record<string, unknown>; output?: string; error?: string; diff?: string; streamingContent?: string; subAgent?: ConversationSubAgentState }
  | { type: "thinking"; done: boolean; text: string }
  | { type: "image"; mime: string; data: string; label: string }

export interface ConversationSubAgentToolPart {
  tool: string
  callId: string
  status: "pending" | "awaiting_approval" | "running" | "completed" | "error"
  input: Record<string, unknown>
  error?: string
}

export interface ConversationSubAgentState {
  profile: string
  modelName?: string
  prompt?: string
  tools: ConversationSubAgentToolPart[]
  tokensUsed: number
  tokenLimit: number
  textPreview?: string
  done: boolean
}

export function dbToConversationMessages(
  messages: MessageRow[],
  parts: PartRow[],
): ConversationMessage[] {
  const partsByMsg = new Map<string, PartRow[]>()
  for (const p of parts) {
    const list = partsByMsg.get(p.messageId) ?? []
    list.push(p)
    partsByMsg.set(p.messageId, list)
  }

  const result: ConversationMessage[] = []

  for (const msg of messages) {
    // Skip aborted assistant messages
    if (msg.finish === "aborted") continue
    const msgParts = partsByMsg.get(msg.id) ?? []
    const viewParts: ConversationPart[] = []

    for (const p of msgParts) {
      if (p.type === "text" || p.type === "summary") {
        const d = JSON.parse(p.data) as TextPartData
        // Skip model-only parts — lineage context and transferred messages
        // that should never appear in the TUI but are needed by the model.
        if (d.visibility === "model-only") continue
        if (d.text) viewParts.push({ type: "text", text: d.text })
      } else if (p.type === "tool") {
        const d = JSON.parse(p.data) as ToolPartData
        let subAgent: ConversationSubAgentState | undefined
        if (d.tool === "bash") {
          const cmd = (d.input as any)?.command ?? (d.input as any)?.cmd
          if (typeof cmd === "string" && /\bquark\b.*--sub-agent\b/.test(cmd)) {
            const { profile, prompt } = parseSubAgentCommand(cmd)
            subAgent = {
              profile,
              prompt,
              tools: [],
              tokensUsed: 0,
              tokenLimit: 0,
              done: d.status === "completed" || d.status === "error",
            }
          }
        }
        viewParts.push({
          type: "tool",
          tool: d.tool,
          callId: d.callId,
          status: d.status,
          input: d.input,
          output: d.output,
          error: d.error,
          ...(subAgent ? { subAgent } : {}),
        })
      } else if (p.type === "image") {
        const d = JSON.parse(p.data) as ImagePartData
        const idx = viewParts.filter((x) => x.type === "image").length + 1
        viewParts.push({ type: "image", mime: d.mime, data: d.data, label: `Image ${idx}` })
      } else if (p.type === "reasoning") {
        const d = JSON.parse(p.data) as ReasoningPartData
        if (d.text) viewParts.push({ type: "thinking", done: true, text: d.text })
      }
    }

    if (viewParts.length > 0) {
      result.push({
        id: msg.id,
        role: msg.role,
        parts: viewParts,
        streaming: false,
      })
    }
  }

  return result
}

function parseSubAgentCommand(cmd: string): { profile: string; prompt?: string } {
  const profile = cmd.match(/--profile\s+(\S+)/)?.[1] ?? "sub-agent"
  let prompt: string | undefined

  const pm = cmd.match(/--prompt\s+(['"])(.*?)\1/)
  if (pm) {
    prompt = pm[2]
  } else {
    const m2 = cmd.match(/--prompt\s+([^\s-][^;|&><]*?)(?:\s+-|$)/)
    prompt = m2?.[1]?.trim()
  }
  if (!prompt) {
    const m3 = cmd.match(/-m\s+(['"])(.*?)\1/)
    prompt = m3?.[2] ?? cmd.match(/-m\s+([^\s-][^;|&><]*?)(?:\s+-|$)/)?.[1]?.trim()
  }

  return { profile, prompt: prompt?.slice(0, 200) }
}
