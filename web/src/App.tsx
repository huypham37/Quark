import { Show, createSignal, onCleanup, onMount } from "solid-js"
import { createWebApp } from "./state"
import { Sidebar } from "./components/Sidebar"
import { Topbar } from "./components/Topbar"
import { Conversation } from "./components/Conversation"
import { Composer } from "./components/Composer"
import { QuestionPanel } from "./components/QuestionPanel"
import { CommandPalette, type PaletteMode } from "./components/CommandPalette"
import { FolderIcon, BranchIcon } from "./icons"

export function App() {
  const app = createWebApp()
  const [palette, setPalette] = createSignal<PaletteMode | null>(null)
  const [query, setQuery] = createSignal("")
  const [drawer, setDrawer] = createSignal(false)

  const folder = () => {
    const cwd = app.state.status.cwd
    const short = cwd.replace(/^\/Users\/[^/]+/, "~")
    return short.split("/").filter(Boolean).pop() ?? short
  }

  const openPalette = (mode: PaletteMode) => {
    setQuery("")
    setPalette(mode)
  }

  const selectSession = async (id: string) => {
    setDrawer(false)
    await app.selectSession(id)
  }

  const keydown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault()
      setPalette((current) => current ? null : "commands")
      setQuery("")
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
            <Show when={app.state.notice}><div class="notice" role="status">{app.state.notice}</div></Show>
            <Show when={app.state.question}>{(question) => <QuestionPanel request={question()} onReply={app.answer} />}</Show>
            <Composer
              running={app.state.running}
              tokensUsed={app.state.tokensUsed}
              status={app.state.status}
              onSubmit={app.send}
              onCancel={app.cancel}
            />
            <div class="context-row">
              <span class="context-chip" title={app.state.status.cwd}><FolderIcon />{folder()}</span>
              <span class="context-chip branch" title="Git branch"><BranchIcon />{app.state.status.branch ?? "no branch"}</span>
            </div>
          </section>
        </section>
      </div>
      <Show when={palette()}>{(mode) => (
        <CommandPalette
          mode={mode()}
          query={query()}
          sessions={app.state.sessions}
          onQuery={setQuery}
          onClose={() => setPalette(null)}
          onMode={(next) => { setQuery(""); setPalette(next) }}
          onNew={async () => { await app.newSession() }}
          onSession={selectSession}
        />
      )}</Show>
    </>
  )
}
