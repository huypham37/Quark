// @jsxImportSource @opentui/solid
// TUI entry point — renders the OpenTUI/SolidJS app and wires it to the backend
//
// Usage: bun src/tui/index.tsx

import { render } from "@opentui/solid"
import { App, type CommandResult } from "./components/App"
import { bootstrap } from "../bootstrap"
import { prompt, cancel, resolveModel } from "../session/prompt"
import { createSession, listSessions } from "../session/session"
import { loadMessages } from "../session/message"
import { compact } from "../session/compaction"
import { bus } from "../session/events"
import { defaultAgent } from "../agent"
import { discoverSkills } from "../skill/skill"
import { dbToTuiMessages } from "./state"
import { loadConfig } from "../config/config"

// Initialize the backend (DB + tools)
bootstrap()

// Create a session upfront so the TUI can subscribe to events immediately.
let currentSession = createSession()

// Discover skills and determine model name at startup
const skills = discoverSkills()
const modelName = defaultAgent.id

// Runtime-only model override — set by /model picker, NOT persisted to config
let modelOverride: string | null = null

function handleSubmit(text: string, sessionId: string | null, context?: string) {
  const sid = sessionId ?? currentSession.id

  const parts: { type: "text"; text: string }[] = []
  if (context) {
    parts.push({ type: "text", text: context })
  }
  parts.push({ type: "text", text })

  prompt({
    sessionId: sid,
    parts,
    model: modelOverride ? { provider: "copilot", model: modelOverride } : undefined,
  }).catch((err) => {
    bus.emit("error", { sessionId: sid, error: err })
  })
}

function handleCancel(sessionId: string) {
  cancel(sessionId)
}

function handleCommand(command: string, args: string, sessionId: string | null): CommandResult {
  const sid = sessionId ?? currentSession.id

  switch (command) {
    case "compact": {
      resolveModel().then((model) => {
        return compact({ sessionId: sid, model, abort: new AbortController().signal })
      }).catch((err) => {
        bus.emit("error", { sessionId: sid, error: err })
      })
      return { handled: true }
    }

    case "clear": {
      currentSession = createSession()
      bus.emit("session-reset", { sessionId: currentSession.id })
      return { handled: true }
    }

    case "sessions": {
      if (!args) {
        const sessions = listSessions()
        if (sessions.length === 0) {
          bus.emit("error", { sessionId: sid, error: new Error("No sessions found") })
          return { handled: true }
        }

        const lines = sessions.map((s) => {
          const isCurrent = s.id === sid
          const date = new Date(s.timeUpdated).toLocaleString()
          const title = s.title ?? "(untitled)"
          const marker = isCurrent ? " ← current" : ""
          return `  ${s.id.slice(0, 8)}  ${title}  ${date}${marker}`
        })
        const header = `Sessions (${sessions.length}):\n`
        bus.emit("user-message", {
          sessionId: sid,
          messageId: `sessions-list-${Date.now()}`,
          text: header + lines.join("\n") + "\n\nUse /sessions <id-prefix> to switch",
        })
        return { handled: true }
      }

      const sessions = listSessions()
      const match = sessions.find((s) => s.id.startsWith(args))
      if (!match) {
        bus.emit("error", { sessionId: sid, error: new Error(`No session matching "${args}"`) })
        return { handled: true }
      }

      currentSession = match
      const { messages, parts } = loadMessages(match.id)
      const tuiMessages = dbToTuiMessages(messages, parts)
      bus.emit("session-switch", { sessionId: match.id, messages: tuiMessages })
      return { handled: true }
    }

    case "model": {
      if (!args) {
        bus.emit("error", { sessionId: sid, error: new Error("Use /model to open the model picker") })
        return { handled: true }
      }
      modelOverride = args.trim()
      bus.emit("user-message", {
        sessionId: sid,
        messageId: `model-switch-${Date.now()}`,
        text: `Model switched to: ${modelOverride} (session only)`,
      })
      return { handled: true }
    }

    default:
      return { handled: false }
  }
}

function handleGetSessions() {
  return listSessions()
}

function handleGetModels() {
  const config = loadConfig()
  return config.models.map((id) => ({ id, name: id }))
}

function handleGetCurrentModel() {
  return modelOverride ?? loadConfig().main_model
}

// Render the OpenTUI/SolidJS app
render(() => (
  <App
    onSubmit={handleSubmit}
    onCancel={handleCancel}
    onCommand={handleCommand}
    getSessions={handleGetSessions}
    getModels={handleGetModels}
    getCurrentModel={handleGetCurrentModel}
    initialSessionId={currentSession.id}
    initialModelName={modelName}
    initialSkillCount={skills.length}
  />
), { targetFps: 60, exitOnCtrlC: false })
