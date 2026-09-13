import { For, Show, createEffect, createMemo, onCleanup, onMount } from "solid-js"
import { SearchIcon } from "../icons"
import type { SessionSummary } from "../types"

export type PaletteMode = "commands" | "sessions"

interface CommandPaletteProps {
  mode: PaletteMode
  query: string
  sessions: SessionSummary[]
  onQuery: (query: string) => void
  onClose: () => void
  onMode: (mode: PaletteMode) => void
  onNew: () => Promise<void>
  onSession: (id: string) => Promise<void>
}

interface Entry {
  id: string
  icon: string
  label: string
  detail: string
  shortcut?: string
  run: () => void
}

export function CommandPalette(props: CommandPaletteProps) {
  let input: HTMLInputElement | undefined
  const entries = createMemo<Entry[]>(() => {
    const source = props.mode === "commands"
      ? [
          { id: "new", icon: "+", label: "New session", detail: "Start with a clean conversation", shortcut: "⌘ N", run: () => void props.onNew() },
          { id: "sessions", icon: "S", label: "Sessions", detail: "Open a recent conversation", run: () => props.onMode("sessions") },
        ]
      : props.sessions.map((session) => ({
          id: session.id,
          icon: "Q",
          label: session.title,
          detail: new Date(session.timeUpdated).toLocaleString(),
          run: () => void props.onSession(session.id),
        }))
    const query = props.query.toLowerCase()
    return source.filter((entry) => `${entry.label} ${entry.detail}`.toLowerCase().includes(query))
  })

  const run = (entry: Entry) => {
    entry.run()
    if (entry.id !== "sessions") props.onClose()
  }

  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") props.onClose()
    const first = entries()[0]
    if (event.key === "Enter" && first) {
      event.preventDefault()
      run(first)
    }
  }

  onMount(() => document.addEventListener("keydown", keydown))
  onCleanup(() => document.removeEventListener("keydown", keydown))
  createEffect(() => { props.mode; queueMicrotask(() => input?.focus()) })

  return (
    <div class="palette-backdrop" onClick={(event) => { if (event.target === event.currentTarget) props.onClose() }}>
      <section class="command-palette" role="dialog" aria-modal="true" aria-labelledby="palette-title">
        <div class="palette-search">
          <SearchIcon />
          <input ref={input} aria-label="Search commands" placeholder={`Search ${props.mode}…`} value={props.query} onInput={(event) => props.onQuery(event.currentTarget.value)} />
          <kbd>esc</kbd>
        </div>
        <h2 id="palette-title">{props.mode === "commands" ? "Commands" : "Sessions"}</h2>
        <div class="palette-list">
          <For each={entries()} fallback={<p class="palette-empty">No matching {props.mode}</p>}>
            {(entry) => (
              <button type="button" onClick={() => run(entry)}>
                <span class="palette-icon">{entry.icon}</span>
                <span><strong>{entry.label}</strong><small>{entry.detail}</small></span>
                <Show when={entry.shortcut}><kbd>{entry.shortcut}</kbd></Show>
              </button>
            )}
          </For>
        </div>
        <div class="palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>↵</kbd> Select</span></div>
      </section>
    </div>
  )
}
