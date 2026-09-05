import type { TuiPart } from "../state"

export type ToolPart = Extract<TuiPart, { type: "tool" }>
export type ToolActivityKind = "explore" | "modify" | "internet" | "command" | "other"

export type ToolActivityItem =
  | { type: "part"; part: TuiPart }
  | { type: "activity"; kind: ToolActivityKind; tools: ToolPart[] }

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
