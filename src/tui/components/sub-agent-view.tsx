// @jsxImportSource @opentui/solid
// SubAgentView — renders sub-agent tool activity as a unified card
//
// Shows:
//   ⠋ Summoning Finder · 12.4k tokens (8%) · claude-sonnet-4.5
//   Task: "research auth flow and find the..." [expand]
//   ├── ✓ WebSearch "what is AI"
//   ├── ⠋ Read https://en.wikipedia...
//   └── ✨ Thinking out loud...
//
// When done:
//   ✓ Finder responded · 24.1k tokens (16%) · claude-sonnet-4.5
//   Task: "research auth flow..." [expand]
//
// When error:
//   ✗ Finder failed · claude-sonnet-4.5
//   Task: "research auth flow..." [expand]
//   (error message)

import type { Component } from "solid-js"
import { Show, For, createSignal, createEffect, onCleanup, onMount } from "solid-js"
import { colors, icons } from "../theme"
import { RGBA } from "@opentui/core"
import { BRAILLE_CYCLE_FRAMES, BRAILLE_CYCLE_INTERVAL_MS } from "../spinner"
import type { SubAgentState, SubAgentToolPart } from "../state"

interface SubAgentViewProps {
  subAgent: SubAgentState
  parentStatus: "pending" | "awaiting_approval" | "running" | "completed" | "error"
}

// ---------------------------------------------------------------------------
// Fun streaming labels — cycle every 3s
// ---------------------------------------------------------------------------

const STREAMING_LABELS = [
  "✨ Thinking out loud...",
  "🧠 Processing vibes...",
  "🔮 Divining answer...",
  "💭 Having thoughts...",
  "📡 Beaming back...",
  "🌀 Spinning up...",
] as const

const STREAMING_LABEL_INTERVAL_MS = 3_000

// ---------------------------------------------------------------------------
// Map tool IDs to display names (same as tool-result.tsx)
// ---------------------------------------------------------------------------

function getToolDisplayName(tool: string): string {
  const names: Record<string, string> = {
    read: "Read",
    write: "Write",
    edit: "Edit",
    bash: "Bash",
    skill: "Skill",
    todo: "Todo",
    grep: "Grep",
    glob: "Glob",
    websearch: "WebSearch",
  }
  return names[tool] ?? tool.charAt(0).toUpperCase() + tool.slice(1)
}

// ---------------------------------------------------------------------------
// Extract a short label from tool input
// ---------------------------------------------------------------------------

function getToolLabel(tool: string, input: Record<string, unknown>): string {
  const path = input.filePath ?? input.file_path ?? input.path
  if (typeof path === "string") {
    return path.replace(/^\/Users\/[^/]+\//, "~/")
  }

  const cmd = input.command ?? input.cmd
  if (typeof cmd === "string") {
    return cmd.length > 50 ? cmd.slice(0, 47) + "..." : cmd
  }

  const pattern = input.pattern
  if (typeof pattern === "string") {
    return pattern.length > 50 ? pattern.slice(0, 47) + "..." : pattern
  }

  const query = input.query
  if (typeof query === "string") {
    return query.length > 50 ? query.slice(0, 47) + "..." : query
  }

  const url = input.url
  if (typeof url === "string") {
    return url.length > 50 ? url.slice(0, 47) + "..." : url
  }

  const name = input.name ?? input.skill
  if (typeof name === "string") return name

  return ""
}

// ---------------------------------------------------------------------------
// Format token count: 1234 → "1.2k", 123456 → "123.5k"
// ---------------------------------------------------------------------------

function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10000) return (n / 1000).toFixed(1) + "k"
  return (n / 1000).toFixed(1) + "k"
}

// ---------------------------------------------------------------------------
// StatusIndicator — spinner/check/cross
// ---------------------------------------------------------------------------

const StatusIndicator: Component<{ status: "pending" | "awaiting_approval" | "running" | "completed" | "error" }> = (props) => {
  const [frameIndex, setFrameIndex] = createSignal(0)

  createEffect(() => {
    if (props.status === "running") {
      const id = setInterval(() => {
        setFrameIndex((i) => (i + 1) % BRAILLE_CYCLE_FRAMES.length)
      }, BRAILLE_CYCLE_INTERVAL_MS)
      onCleanup(() => clearInterval(id))
    }
  })

  const content = () => {
    switch (props.status) {
      case "running": return BRAILLE_CYCLE_FRAMES[frameIndex()] + " "
      case "pending": return "… "
      case "awaiting_approval": return "? "
      case "error": return icons.cross + " "
      default: return icons.checkmark + " "
    }
  }

  const color = () => {
    switch (props.status) {
      case "running": return colors.textBold
      case "pending": return colors.muted
      case "awaiting_approval": return colors.muted
      case "error": return colors.error
      default: return RGBA.fromHex("#98C379")
    }
  }

  return <text fg={color()}>{content()}</text>
}

// ---------------------------------------------------------------------------
// ChildToolLine — single tool in the tree
// ---------------------------------------------------------------------------

const ChildToolLine: Component<{ tool: SubAgentToolPart; isLast: boolean }> = (props) => {
  const displayName = getToolDisplayName(props.tool.tool)
  const label = () => getToolLabel(props.tool.tool, props.tool.input)
  const connector = () => props.isLast ? icons.treeCorner : icons.treeTee

  return (
    <box flexDirection="row">
      <text>  </text>
      <text fg={colors.muted}>{connector()} </text>
      <box flexShrink={0}>
        <StatusIndicator status={props.tool.status} />
      </box>
      <text>{displayName}</text>
      <text> </text>
      <Show when={label()}>
        <text fg={RGBA.fromHex("#365A61")}>{label()}</text>
      </Show>
      <Show when={props.tool.error}>
        <text> </text>
        <text fg={colors.error}>({props.tool.error})</text>
      </Show>
    </box>
  )
}

// ---------------------------------------------------------------------------
// FunStreamingLabel — cycles through quirky labels every 3s
// ---------------------------------------------------------------------------

const FunStreamingLabel: Component = () => {
  const [labelIdx, setLabelIdx] = createSignal(0)

  onMount(() => {
    const id = setInterval(() => {
      setLabelIdx((i) => (i + 1) % STREAMING_LABELS.length)
    }, STREAMING_LABEL_INTERVAL_MS)
    onCleanup(() => clearInterval(id))
  })

  return <text fg={colors.muted}>{STREAMING_LABELS[labelIdx()] ?? STREAMING_LABELS[0]}</text>
}

// ---------------------------------------------------------------------------
// SubAgentView — main component
// ---------------------------------------------------------------------------

export const SubAgentView: Component<SubAgentViewProps> = (props) => {
  const [expanded, setExpanded] = createSignal(true)

  const profileName = () => {
    const p = props.subAgent.profile
    return p.charAt(0).toUpperCase() + p.slice(1)
  }

  const isDone = () => props.subAgent.done
  const isError = () => props.parentStatus === "error"

  const headerStatus = (): "running" | "completed" | "error" => {
    if (isError()) return "error"
    if (!isDone()) return "running"
    return "completed"
  }

  const headerLabel = () => {
    const name = profileName()
    if (isError()) return name + " failed"
    if (isDone()) return name + " responded"
    return "Summoning " + name
  }

  const tokensUsed = () => props.subAgent.tokensUsed
  const tokenLimit = () => props.subAgent.tokenLimit
  const tokenPct = () => {
    if (tokenLimit() <= 0 || tokensUsed() <= 0) return ""
    const pct = Math.round((tokensUsed() / tokenLimit()) * 100)
    return ` (${pct}%)`
  }
  const hasTokens = () => tokensUsed() > 0
  const hasModel = () => !!props.subAgent.modelName

  const hasPrompt = () => !!props.subAgent.prompt
  const promptText = () => {
    const p = props.subAgent.prompt ?? ""
    if (expanded()) return p
    // Collapsed: truncate aggressively so prompt + toggle fit on one line.
    // Overhead: "  ├── Task: \"\" [collapse]" ≈ 26 cols. Target terminal ≈ 80 cols.
    return p.length > 50 ? p.slice(0, 47) + "..." : p
  }
  const toggleLabel = () => expanded() ? "collapse" : "expand"

  const hasTextPreview = () => !isDone() && !!props.subAgent.textPreview
  const hasChildren = () => props.subAgent.tools.length > 0 || hasTextPreview()
  const showTree = () => expanded() && hasChildren()

  return (
    <box flexDirection="column">
      {/* Header: status icon + verb + profile name + tokens + model */}
      <box flexDirection="row">
        <box flexShrink={0}>
          <StatusIndicator status={headerStatus()} />
        </box>
        <text fg={colors.text}>{headerLabel()}</text>
        <Show when={hasTokens()}>
          <text fg={colors.muted}>{" "}·{" "}{formatTokens(tokensUsed())} tokens{tokenPct()}</text>
        </Show>
        <Show when={hasModel()}>
          <text fg={colors.muted}>{" "}·{" "}{props.subAgent.modelName}</text>
        </Show>
      </box>

      {/* Body: prompt + tree as a single visual list with aligned connectors */}
      <box flexDirection="column">
        {/* Prompt line — aligned with header text (after spinner) */}
        <Show when={hasPrompt()}>
          <box flexDirection="row" onMouseUp={() => setExpanded((v) => !v)}>
            <text fg={colors.muted}>   Task: </text>
            <text fg={RGBA.fromHex("#365A61")} wrap="nowrap">"{promptText()}"</text>
            <text fg={colors.muted}> [{toggleLabel()}]</text>
          </box>
        </Show>

        {/* Tool tree (visible when expanded) */}
        <Show when={showTree()}>
          <box flexDirection="column">
            <For each={props.subAgent.tools}>
              {(tool, i) => (
                <ChildToolLine
                  tool={tool}
                  isLast={!hasTextPreview() && i() === props.subAgent.tools.length - 1}
                />
              )}
            </For>
            {/* Streaming text preview with fun labels */}
            <Show when={hasTextPreview()}>
              <box flexDirection="row">
                <text>  </text>
                <text fg={colors.muted}>{icons.treeCorner} </text>
                <FunStreamingLabel />
              </box>
            </Show>
          </box>
        </Show>
      </box>
    </box>
  )
}
