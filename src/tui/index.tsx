// @jsxImportSource @opentui/solid
// TUI entry point — renders the OpenTUI/SolidJS app and wires it to the backend
//
// Usage: bun src/tui/index.tsx
// Usage: bun src/tui/index.tsx --profile researcher

import { render } from "@opentui/solid"
import { createCliRenderer } from "@opentui/core"
import { App, type CommandResult } from "./components/App"
import { bootstrap } from "../bootstrap"
import { prompt, cancel, resolveModel } from "../session/prompt"
import { createSession, listProjectSessions, getSession } from "../session/session"
import { loadMessages, toModelMessages } from "../session/message"
import { buildSystem } from "../session/system"
import { getModelLimit, refreshLMStudio } from "../provider/models"
import { estimateTokens, getLastInputTokens } from "../session/context"
import { summarizeForBranch, createBranch } from "../session/branch"
import { bus } from "../session/events"
import { agentFromProfile, type AgentConfig } from "../agent"
import { discoverSkills } from "../skill/skill"
import { dbToTuiMessages } from "./state"
import { loadConfig, parseModelSpec, resetConfigCache, CONFIG_PATH } from "../config/config"
import { resolveProfile, readPromptFile, listProfiles, resetProfileCache } from "../profile/profile"
import { queryTerminalBackground } from "./terminal-bg"
import { setTerminalBg } from "./theme"
import { writeClipboard } from "./clipboard"
import { clearCache as clearSkillCache } from "../skill/skill"
import { register, clear as clearRegistry } from "../tool/registry"
import { buildSkillTool } from "../tool/skill"
import { resetBootstrap } from "../bootstrap"
import { info as notifyInfo } from "../notification/notification"
import { undoLatest } from "../commands/undo"
import { runGoal } from "../commands/goal/orchestrator"
import { listTasks } from "../task/task"

// Detect terminal background BEFORE the TUI takes over stdin/stdout,
// then pick dark or light theme based on background luminance.
const termBg = await queryTerminalBackground()
setTerminalBg(termBg)

// ---------------------------------------------------------------------------
// Parse --profile flag from CLI args
// ---------------------------------------------------------------------------
function parseProfileArg(): string | undefined {
  const args = process.argv.slice(2)
  const idx = args.indexOf("--profile")
  if (idx !== -1 && args[idx + 1]) return args[idx + 1]
  return undefined
}

// ---------------------------------------------------------------------------
// Profile-aware agent setup
// ---------------------------------------------------------------------------
const profileArg = parseProfileArg()
const profile = resolveProfile(profileArg)
const promptResult = readPromptFile(profile)
let activeAgent: AgentConfig = agentFromProfile(profile, promptResult.content)

// Initialize the backend (DB + tools) with profile-bound skills
await bootstrap({ profileTools: profile.tools, boundSkills: profile.skills })

// Session starts null — created lazily on first message by prompt()
let currentSession: { id: string } | null = null

// Listen for lazy session creation from prompt()
bus.on("session-created", ({ sessionId }) => {
  currentSession = { id: sessionId }
  process.env.QUARK_SESSION_ID = sessionId
})

// Discover skills and determine model name at startup
const skills = discoverSkills()
const modelName = loadConfig().main_model

// Populate LM Studio model cache (non-blocking)
refreshLMStudio()

// Runtime-only model override — set by /model picker, NOT persisted to config
let modelOverride: string | null = null

function handleSubmit(text: string, sessionId: string | null, images?: { mime: string; data: string }[], context?: string) {
  const sid = sessionId ?? currentSession?.id

  const parts: { type: "text"; text: string }[] = []
  if (context) {
    parts.push({ type: "text", text: context })
  }
  parts.push({ type: "text", text })

  prompt({
    sessionId: sid,
    parts,
    images,
    model: modelOverride ?? undefined,
    agent: activeAgent,
  }).catch((err) => {
    bus.emit("error", { sessionId: sid ?? "unknown", error: err })
  })
}

function handleCancel(sessionId: string) {
  cancel(sessionId)
}

async function handleCommand(command: string, args: string, sessionId: string | null): Promise<CommandResult> {
  const sid = sessionId ?? currentSession?.id ?? null

  // /new and /clear work even without an active session
  if (command === "new") {
    const newSession = createSession()
    currentSession = { id: newSession.id }
    process.env.QUARK_SESSION_ID = newSession.id
    bus.emit("session-reset", { sessionId: newSession.id })
    notifyInfo("Session", `New session started`, 2000)
    return { handled: true }
  }

  if (command === "clear") {
    currentSession = null
    bus.emit("session-reset", { sessionId: null })
    return { handled: true }
  }

  // /model and /profile work even without an active session
  if (command === "model") {
    if (!args) {
      bus.emit("error", { sessionId: sid ?? "unknown", error: new Error("Use /model to open the model picker") })
      return { handled: true }
    }
    modelOverride = args.trim()
    bus.emit("model-switched", { modelSpec: modelOverride })
    notifyInfo("Model", `Switched to: ${modelOverride}`, 3000)
    return { handled: true }
  }

  if (command === "profile") {
    if (!args) {
      const available = listProfiles()
      const current = activeAgent.id
      const lines = available.map((p) => {
        const marker = p === current ? " ← active" : ""
        return `${p}${marker}`
      })
      notifyInfo("Profiles", lines.join("\n"), 6000)
      return { handled: true }
    }

    const targetId = args.trim()
    const available = listProfiles()
    if (!available.includes(targetId)) {
      bus.emit("error", {
        sessionId: sid ?? "unknown",
        error: new Error(`Profile "${targetId}" not found. Available: ${available.join(", ")}`),
      })
      return { handled: true }
    }

    // Switch profile: resolve, rebuild agent, re-register skill tool
    // NOTE: We do NOT create a new session - messages are preserved
    resetProfileCache()
    clearSkillCache()
    const newProfile = resolveProfile(targetId)
    const newPromptResult = readPromptFile(newProfile)
    activeAgent = agentFromProfile(newProfile, newPromptResult.content)

    // Tear down and re-bootstrap with the new profile's tools and skills
    clearRegistry()
    resetBootstrap()
    await bootstrap({ profileTools: newProfile.tools, boundSkills: newProfile.skills })

    // Show toast notification for profile switch (no message in conversation)
    notifyInfo("Profile", `Switched to: ${newProfile.name}`, 3000)

    return { handled: true }
  }

  // /sessions works even without an active session (picker can be opened any time)
  if (command === "sessions") {
    if (!args) {
      const sessions = listProjectSessions()
      const tasks = new Map(listTasks().map((task) => [task.id, task]))
      if (sessions.length === 0) {
        bus.emit("error", { sessionId: sid ?? "unknown", error: new Error("No sessions found") })
        return { handled: true }
      }

      const lines = sessions.map((s) => {
        const isCurrent = s.id === sid
        const date = new Date(s.timeUpdated).toLocaleString()
        const title = s.title ?? "(untitled)"
        const task = s.taskId ? tasks.get(s.taskId)?.title : undefined
        const marker = isCurrent ? " ← current" : ""
        return `  ${s.id.slice(0, 8)}  ${title}${task ? `  ·  ${task}` : ""}  ${date}${marker}`
      })
      const header = `Sessions (${sessions.length}):\n`
      bus.emit("user-message", {
        sessionId: sid ?? "unknown",
        messageId: `sessions-list-${Date.now()}`,
        text: header + lines.join("\n") + "\n\nUse /sessions <id-prefix> to switch",
      })
      return { handled: true }
    }

    const sessions = listProjectSessions()
    const match = sessions.find((s) => s.id.startsWith(args))
    if (!match) {
      bus.emit("error", { sessionId: sid ?? "unknown", error: new Error(`No session matching "${args}"`) })
      return { handled: true }
    }

    currentSession = match
    process.env.QUARK_SESSION_ID = match.id
    const { messages, parts } = loadMessages(match.id)
    const tuiMessages = dbToTuiMessages(messages, parts)
    // Prefer real API token count from DB; fall back to chars/4 heuristic
    const lastReal = getLastInputTokens(parts)
    let switchEstimatedTokens: number
    if (lastReal > 0) {
      switchEstimatedTokens = lastReal
    } else {
      const switchModelMessages = toModelMessages(messages, parts)
      const switchSystem = buildSystem(activeAgent)
      const switchSystemStr = Array.isArray(switchSystem) ? switchSystem.join("\n") : switchSystem
      switchEstimatedTokens = estimateTokens(switchSystemStr, switchModelMessages)
    }
    bus.emit("session-switch", { sessionId: match.id, messages: tuiMessages, estimatedTokens: switchEstimatedTokens })
    return { handled: true }
  }

  // /settings — open config in $EDITOR (works without an active session)
  if (command === "settings") {
    await openEditor(sid)
    return { handled: true }
  }

  // /reload-config — reload config without restarting (works without an active session)
  if (command === "reload-config") {
    resetConfigCache()
    const currentModel = modelOverride ?? loadConfig().main_model
    bus.emit("model-switched", { modelSpec: currentModel })
    refreshLMStudio()
    notifyInfo("Config", "Config reloaded", 3000)
    return { handled: true }
  }

  // All other commands require an active session
  if (!sid) {
    bus.emit("error", { sessionId: "unknown", error: new Error("No active session — send a message first") })
    return { handled: true }
  }

  switch (command) {
    case "undo": {
      const result = await undoLatest(sid)
      if (!result) {
        notifyInfo("Undo", "Nothing to undo — no tracked file changes", 3000)
        return { handled: true }
      }

      const parts: string[] = []
      if (result.restored.length > 0) {
        parts.push(`${result.restored.length} file(s) restored`)
      }
      if (result.deleted.length > 0) {
        parts.push(`${result.deleted.length} file(s) deleted`)
      }

      bus.emit("undo-applied", {
        sessionId: sid,
        keepMessagesUpTo: result.messageId,
        restored: result.restored.length,
        deleted: result.deleted.length,
      })

      notifyInfo("Undo", parts.join(", "), 3000)
      return { handled: true }
    }

    case "steer": {
      if (!args.trim()) {
        bus.emit("error", { sessionId: sid, error: new Error("Usage: /steer <goal>") })
        return { handled: true }
      }

      bus.emit("steer-start", { sessionId: sid })
      let steeringEnded = false
      try {
        // Frozen-snapshot semantics: only summarize the parent the first time
        // it is branched. Subsequent steers reuse the already-frozen summary
        // so siblings share the same parentSummary and we skip a redundant
        // LLM call.
        const parent = getSession(sid)
        const existing = parent.summary?.trim()
        let summary: string
        if (existing && existing.length > 0) {
          summary = existing
        } else {
          const { messages, parts } = loadMessages(sid)
          const model = await resolveModel(loadConfig().small_model)
          summary = await summarizeForBranch({ messages, parts, model })
        }
        const branch = createBranch({
          sessionId: sid,
          summary,
          prompt: args.trim(),
          profile: activeAgent.id,
        })

        currentSession = { id: branch.sessionId }
        process.env.QUARK_SESSION_ID = branch.sessionId
        const { messages, parts } = loadMessages(branch.sessionId)
        const tuiMessages = dbToTuiMessages(messages, parts)
        const modelMessages = toModelMessages(messages, parts)
        const system = buildSystem(activeAgent)
        const systemStr = Array.isArray(system) ? system.join("\n") : system
        const estimatedTokens = estimateTokens(systemStr, modelMessages)
        bus.emit("steer-end", { sessionId: sid })
        steeringEnded = true
        bus.emit("session-switch", { sessionId: branch.sessionId, messages: tuiMessages, estimatedTokens })
        notifyInfo("Steer", `Branched to new session`, 3000)
      } catch (err) {
        bus.emit("error", {
          sessionId: sid,
          error: err instanceof Error ? err : new Error(String(err)),
        })
      } finally {
        if (!steeringEnded) bus.emit("steer-end", { sessionId: sid })
      }
      return { handled: true }
    }

    case "goal": {
      if (!args.trim()) {
        bus.emit("error", { sessionId: sid, error: new Error("Usage: /goal <goal description>") })
        return { handled: true }
      }

      bus.emit("steer-start", { sessionId: sid })
      try {
        await runGoal({ goal: args.trim() })
      } catch (err) {
        bus.emit("error", {
          sessionId: sid,
          error: err instanceof Error ? err : new Error(String(err)),
        })
      } finally {
        bus.emit("steer-end", { sessionId: sid })
      }
      return { handled: true }
    }

    default:
      return { handled: false }
  }
}

// Suspend the TUI, spawn $EDITOR (default nvim) on the config file, then resume
// and reload the config cache. The editor inherits the terminal directly, so it
// renders in the same window like `git commit` opening vim.
async function openEditor(sid: string | null): Promise<void> {
  const editor = process.env.EDITOR ?? process.env.VISUAL ?? "nvim"

  renderer.suspend()
  try {
    const proc = Bun.spawn([editor, CONFIG_PATH], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    const code = await proc.exited
    if (code !== 0) {
      // Editor exited non-zero — surface once TUI is back
      setImmediate(() => {
        bus.emit("error", {
          sessionId: sid ?? "unknown",
          error: new Error(`${editor} exited with code ${code}`),
        })
      })
    }
  } catch (err) {
    setImmediate(() => {
      bus.emit("error", {
        sessionId: sid ?? "unknown",
        error: err instanceof Error ? err : new Error(String(err)),
      })
    })
  } finally {
    renderer.resume()
  }
}

function handleGetSessions() {
  const tasks = new Map(listTasks().map((task) => [task.id, task]))
  return listProjectSessions().map((session) => ({
    ...session,
    taskTitle: session.taskId ? tasks.get(session.taskId)?.title : undefined,
  }))
}

function handleGetModels() {
  const config = loadConfig()
  return config.models.map((id) => ({ id, name: parseModelSpec(id).model }))
}

function handleGetCurrentModel() {
  return modelOverride ?? loadConfig().main_model
}

// Pre-create the renderer so module-level code (e.g. openEditor) can
// suspend/resume it when shelling out to an external editor.
const renderer = await createCliRenderer({
  targetFps: 60,
  exitOnCtrlC: false,
  consoleOptions: {
    keyBindings: [{ name: "y", ctrl: true, action: "copy-selection" }],
    onCopySelection: (text) => {
      writeClipboard(text).catch((err) => {
        console.error(`Failed to copy console selection: ${err}`)
      })
    },
  },
})

render(() => (
  <App
    onSubmit={handleSubmit}
    onCancel={handleCancel}
    onCommand={handleCommand}
    getSessions={handleGetSessions}
    getModels={handleGetModels}
    getCurrentModel={handleGetCurrentModel}
    initialSessionId={currentSession?.id}
    initialModelName={modelName}
    initialSkillCount={skills.length}
  />
), renderer)
