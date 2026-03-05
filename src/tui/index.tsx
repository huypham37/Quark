// TUI entry point — renders the Ink app and wires it to the backend
//
// Usage: bun src/tui/index.tsx

import React from "react"
import { render } from "ink"
import { App } from "./App"
import { bootstrap } from "../bootstrap"
import { prompt, cancel } from "../session/prompt"
import { createSession } from "../session/session"
import { bus } from "../session/events"
import { defaultAgent } from "../agent"
import { discoverSkills } from "../skill/skill"

// Initialize the backend (DB + tools)
bootstrap()

// Create a session upfront so the TUI can subscribe to events immediately.
// This avoids the chicken-and-egg problem: if we waited for prompt() to create
// the session, the TUI would miss all streaming events because useEventBus
// only subscribes once it has a sessionId.
const session = createSession()

// Discover skills and determine model name at startup
const skills = discoverSkills()
const modelName = defaultAgent.id // Use the agent id as the display name

function handleSubmit(text: string, sessionId: string | null, context?: string) {
  const sid = sessionId ?? session.id

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

// Render the TUI with the pre-created session
render(
  <App
    onSubmit={handleSubmit}
    onCancel={handleCancel}
    initialSessionId={session.id}
    initialModelName={modelName}
    initialSkillCount={skills.length}
  />,
)
