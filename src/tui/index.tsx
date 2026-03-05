// TUI entry point — renders the Ink app and wires it to the backend
//
// Usage: bun src/tui/index.tsx

import React from "react"
import { render } from "ink"
import { App, type CommandResult } from "./App"
import { bootstrap } from "../bootstrap"
import { prompt, cancel, resolveModel } from "../session/prompt"
import { createSession } from "../session/session"
import { compact } from "../session/compaction"
import { bus } from "../session/events"
import { defaultAgent } from "../agent"
import { discoverSkills } from "../skill/skill"

// Initialize the backend (DB + tools)
bootstrap()

// Create a session upfront so the TUI can subscribe to events immediately.
// This avoids the chicken-and-egg problem: if we waited for prompt() to create
// the session, the TUI would miss all streaming events because useEventBus
// only subscribes once it has a sessionId.
let currentSession = createSession()

// Discover skills and determine model name at startup
const skills = discoverSkills()
const modelName = defaultAgent.id // Use the agent id as the display name

function handleSubmit(text: string, sessionId: string | null, context?: string) {
  const sid = sessionId ?? currentSession.id

  // Build parts: optional file context + user text
  const parts: { type: "text"; text: string }[] = []
  if (context) {
    parts.push({ type: "text", text: context })
  }
  parts.push({ type: "text", text })

  // Run the agent loop in the background (don't await — TUI continues to be interactive)
  prompt({
    sessionId: sid,
    parts,
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
      const controller = new AbortController()
      resolveModel().then((model) => {
        return compact({ sessionId: sid, model, abort: controller.signal })
      }).catch((err) => {
        bus.emit("error", { sessionId: sid, error: err })
      })
      return { handled: true }
    }

    case "clear": {
      // Create a new session — the TUI will pick up the new sessionId
      currentSession = createSession()
      // Emit a special event so the TUI can reset
      bus.emit("session-reset", { sessionId: currentSession.id })
      return { handled: true }
    }

    case "model": {
      if (!args) {
        bus.emit("error", { sessionId: sid, error: new Error("Usage: /model <model-name>") })
        return { handled: true }
      }
      // Model switching is stored for the next prompt call
      // For now, just acknowledge it
      bus.emit("error", { sessionId: sid, error: new Error(`Model switching not yet implemented. Current model: ${modelName}`) })
      return { handled: true }
    }

    default:
      return { handled: false }
  }
}

// Render the TUI with the pre-created session
render(
  <App
    onSubmit={handleSubmit}
    onCancel={handleCancel}
    onCommand={handleCommand}
    initialSessionId={currentSession.id}
    initialModelName={modelName}
    initialSkillCount={skills.length}
  />,
)
