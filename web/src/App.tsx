import { Show, createSignal, onCleanup, onMount } from "solid-js"
import { createWebApp } from "./state"
import { Sidebar } from "./components/Sidebar"
import { Topbar } from "./components/Topbar"
import { Conversation } from "./components/Conversation"
import { Composer } from "./components/Composer"
import { QuestionPanel } from "./components/QuestionPanel"
import { CommandPalette, type PaletteEntry } from "./components/CommandPalette"
import { FolderIcon, BranchIcon } from "./icons"
import { findSlashCommand, slashCommands, slashParts } from "./slash"

export type PaletteMode = "commands" | "sessions" | "models" | "agents" | "skills"

const PALETTE_TITLES: Record<PaletteMode, { title: string; placeholder: string }> = {
  commands: { title: "Commands", placeholder: "Search commands" },
  sessions: { title: "Sessions", placeholder: "Search sessions" },
  models: { title: "Models", placeholder: "Search models" },
  agents: { title: "Agents", placeholder: "Search agents" },
  skills: { title: "Skills", placeholder: "Search skills" },
}

export function App() {
  const app = createWebApp()
  const [palette, setPalette] = createSignal<PaletteMode | null>(null)
  const [drawer, setDrawer] = createSignal(false)

  const folder = () => {
    const cwd = app.state.status.cwd
    const short = cwd.replace(/^\/Users\/[^/]+/, "~")
    return short.split("/").filter(Boolean).pop() ?? short
  }

  const openPalette = (mode: PaletteMode) => {
    if (mode === "models") void app.loadModels()
    setPalette(mode)
  }

  const selectSession = async (id: string) => {
    setDrawer(false)
    await app.selectSession(id)
  }

  const entries = (): PaletteEntry[] => {
    switch (palette()) {
      case "sessions":
        return app.state.sessions.map((session) => ({
          id: session.id,
          icon: "Q",
          label: session.title,
          detail: new Date(session.timeUpdated).toLocaleString(),
          run: () => void selectSession(session.id),
        }))
      case "models":
        return app.state.models.map((model) => ({
          id: model.id,
          icon: "M",
          label: model.name,
          detail: model.detail ?? model.id,
          run: () => void app.setModel(model.id),
        }))
      case "agents":
        return app.state.agents.map((agent) => ({
          id: agent,
          icon: "P",
          label: agent,
          detail: agent === app.state.status.agent ? "Active agent" : "Switch agent",
          run: () => void app.setAgent(agent),
        }))
      case "skills":
        return app.state.skills.map((skill) => ({
          id: skill,
          icon: "S",
          label: skill,
          detail: app.state.activeSkills.includes(skill) ? "Already available" : "Add skill",
          run: () => void app.activateSkill(skill),
        }))
      default:
        return [
          { id: "new", icon: "+", label: "New session", detail: "Start with a clean conversation", shortcut: "⌘ N", run: () => void app.newSession() },
          { id: "sessions", icon: "S", label: "Sessions", detail: "Open a recent conversation", run: () => openPalette("sessions") },
          { id: "models", icon: "M", label: "Models", detail: "Switch the active model", run: () => openPalette("models") },
          { id: "agents", icon: "A", label: "Agents", detail: "Switch agent", run: () => openPalette("agents") },
          { id: "skills", icon: "K", label: "Skills", detail: "Add a skill to the next turn", run: () => openPalette("skills") },
        ]
    }
  }

  const runSlash = (id: string, args: string) => {
    const command = findSlashCommand(id)
    if (!command) return app.showNotice(`Unknown command: /${id}`)
    switch (id) {
      case "help":
        return app.showNotice(`Commands: ${slashCommands.map((item) => `/${item.id}`).join("   ")}`)
      case "new":
        return void app.newSession()
      case "sessions":
        return openPalette("sessions")
      case "model":
        return args ? void app.setModel(args) : openPalette("models")
      case "agent":
        return args ? void app.setAgent(args) : openPalette("agents")
      case "skills":
        return args ? void app.activateSkill(args) : openPalette("skills")
      case "compact":
        return void app.branch("compact", args)
      case "steer":
        return void app.branch("steer", args)
      case "undo":
        return void app.undo()
      case "export":
        return void app.exportSession()
      case "reload-config":
        return void app.reloadConfig()
    }
  }

  const submit = (text: string) => {
    const parts = slashParts(text)
    if (parts) {
      runSlash(parts.id, parts.args)
      return Promise.resolve()
    }
    return app.send(text)
  }

  const keydown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault()
      setPalette((current) => current ? null : "commands")
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
      event.preventDefault()
      void app.newSession()
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
      event.preventDefault()
      setDrawer((open) => !open)
    }
  }

  onMount(() => {
    void app.init()
    document.addEventListener("keydown", keydown)
  })
  onCleanup(() => {
    document.removeEventListener("keydown", keydown)
    app.dispose()
  })

  return (
    <>
      <div class="app-shell">
        <Sidebar app={app} open={drawer()} onClose={() => setDrawer(false)} openSessions={() => openPalette("sessions")} />
        <section class="main-panel" classList={{ empty: !app.state.messages.length }}>
          <Topbar
            title={app.state.session?.title ?? "New session"}
            toggleSidebar={() => setDrawer((open) => !open)}
          />
          <Conversation messages={app.state.messages} />
          <section class="composer-region">
            <Show when={app.state.notice}><div class="notice" classList={{ error: app.state.noticeKind === "error" }} role="status">{app.state.notice}</div></Show>
            <Show when={app.state.question}>{(question) => <QuestionPanel request={question()} onReply={app.answer} />}</Show>
            <Composer
              running={app.state.running}
              tokensUsed={app.state.tokensUsed}
              status={app.state.status}
              onSubmit={submit}
              onCancel={app.cancel}
              onThinking={app.setThinking}
            />
            <div class="context-row">
              <span class="context-chip" title={app.state.status.cwd}><FolderIcon />{folder()}</span>
              <span class="context-chip">{app.state.status.agent}</span>
              <span class="context-chip branch" title="Git branch"><BranchIcon />{app.state.status.branch ?? "no branch"}</span>
            </div>
          </section>
        </section>
      </div>
      <Show when={palette()}>{(mode) => (
        <CommandPalette
          title={PALETTE_TITLES[mode()].title}
          placeholder={PALETTE_TITLES[mode()].placeholder}
          entries={entries()}
          onClose={() => setPalette(null)}
        />
      )}</Show>
    </>
  )
}
