import type { TuiMessage, TuiPart } from "../state"

export type ToolPart = Extract<TuiPart, { type: "tool" }>
export type ToolActivityKind = "explore" | "modify" | "internet" | "command" | "other"

export type ToolActivityItem =
  | { type: "part"; part: TuiPart }
  | { type: "activity"; kind: ToolActivityKind; tools: ToolPart[] }

/**
 * Keep the latest tool activity open between model steps. An empty assistant
 * message is only a streaming placeholder; any actual non-tool part closes it.
 */
export function getContinuingToolCallId(messages: TuiMessage[], running: boolean): string | null {
  if (!running) return null

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex]!
    if (message.role !== "assistant") return null

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex--) {
      const part = message.parts[partIndex]!
      if (part.type !== "tool" || part.subAgent) return null
      return part.callId
    }
  }

  return null
}

const ACTIVITY_TOOLS: Record<string, ToolActivityKind> = {
  read: "explore",
  grep: "explore",
  glob: "explore",
  write: "modify",
  edit: "modify",
  websearch: "internet",
  webfetch: "internet",
  "perplexity-search": "internet",
  bash: "command",
}

export const ACTIVITY_LABELS: Record<ToolActivityKind, { active: string; done: string }> = {
  explore: { active: "Exploring the codebase", done: "Explored the codebase" },
  modify: { active: "Modifying code", done: "Modified code" },
  internet: { active: "Searching the internet", done: "Searched the internet" },
  command: { active: "Running commands", done: "Ran commands" },
  other: { active: "Using tools", done: "Used tools" },
}

export function getToolActivityKind(tool: string): ToolActivityKind {
  return ACTIVITY_TOOLS[tool.toLowerCase()] ?? "other"
}

/** Collapse adjacent, same-purpose tool calls into a single progressive activity. */
export function groupMessageParts(parts: TuiPart[]): ToolActivityItem[] {
  const items: ToolActivityItem[] = []

  for (const part of parts) {
    if (part.type !== "tool" || part.subAgent) {
      items.push({ type: "part", part })
      continue
    }

    const kind = getToolActivityKind(part.tool)
    const previous = items[items.length - 1]
    if (previous?.type === "activity" && previous.kind === kind) {
      previous.tools.push(part)
    } else {
      items.push({ type: "activity", kind, tools: [part] })
    }
  }

  return items
}

/** A non-subagent tool can belong to a progressive activity. */
function isActivityTool(part: TuiPart | undefined): part is ToolPart {
  return part?.type === "tool" && !part.subAgent
}

/**
 * Join tool runs across model steps without crossing rendered content.
 *
 * A model step can contain both tool calls and reasoning/text. The former
 * all-or-nothing message rule treated that entire step as a boundary, which
 * split `grep → read → thinking`. Instead, move only a following message's
 * leading tool run into the prior message when its displayed tail is also a
 * tool run. Thinking, text, images, sub-agents, users, and steer dividers are
 * therefore reliable boundaries for every activity kind.
 */
export function mergeToolActivityMessages(
  messages: TuiMessage[],
  blockedInsertionIndexes: ReadonlySet<number> = new Set(),
): Array<TuiMessage | undefined> {
  const merged: Array<TuiMessage | undefined> = messages.map((message) => ({
    ...message,
    parts: [...message.parts],
  }))

  let activityTailIndex = merged[0]?.role === "assistant"
    && isActivityTool(merged[0].parts[merged[0].parts.length - 1]!)
    ? 0
    : undefined

  for (let index = 1; index < merged.length; index++) {
    const current = merged[index]!
    if (blockedInsertionIndexes.has(index) || current.role !== "assistant") {
      activityTailIndex = undefined
      continue
    }

    if (activityTailIndex !== undefined) {
      let end = 0
      while (end < current.parts.length && isActivityTool(current.parts[end]!)) end++
      if (end > 0) {
        const previous = merged[activityTailIndex]!
        previous.parts.push(...current.parts.splice(0, end))
        previous.streaming ||= current.streaming
      }
    }

    if (current.parts.length === 0) {
      merged[index] = undefined
    } else {
      activityTailIndex = isActivityTool(current.parts[current.parts.length - 1]!) ? index : undefined
    }
  }

  return merged
}
