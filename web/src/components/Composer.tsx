import { Show, createEffect, createMemo, createSignal } from "solid-js"
import { SendIcon } from "../icons"
import { SlashPalette } from "./SlashPalette"
import { filterSlashCommands, slashQuery } from "../slash"
import type { AppStatus } from "../types"

interface ComposerProps {
  running: boolean
  tokensUsed: number
  status: AppStatus
  onSubmit: (text: string) => Promise<void>
  onCancel: () => Promise<void>
  onCommand: (id: string) => void
}

export function Composer(props: ComposerProps) {
  const [text, setText] = createSignal("")
  const [index, setIndex] = createSignal(0)
  let input: HTMLTextAreaElement | undefined

  const query = createMemo(() => slashQuery(text()))
  const entries = createMemo(() => query() === null ? [] : filterSlashCommands(query()!))
  const percent = createMemo(() => props.status.tokenLimit
    ? Math.min(100, Math.round(props.tokensUsed / props.status.tokenLimit * 1_000) / 10)
    : 0)

  createEffect(() => {
    query()
    setIndex(0)
  })

  const resize = () => {
    if (!input) return
    input.style.height = "auto"
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`
  }

  const reset = () => {
    setText("")
    queueMicrotask(resize)
  }

  const submit = async () => {
    if (props.running) return props.onCancel()
    const value = text().trim()
    if (!value) return
    reset()
    await props.onSubmit(value)
  }

  const keydown = (event: KeyboardEvent) => {
    if (query() === null) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault()
        void submit()
      }
      return
    }

    const list = entries()
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setIndex((value) => list.length ? (value + 1) % list.length : 0)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setIndex((value) => list.length ? (value - 1 + list.length) % list.length : 0)
    } else if (event.key === "Escape") {
      event.preventDefault()
      reset()
    } else if (event.key === "Enter" || event.key === "Tab") {
      const command = list[Math.min(index(), list.length - 1)]
      if (!command) return
      event.preventDefault()
      reset()
      props.onCommand(command.id)
    }
  }

  return (
    <form classList={{ composer: true, running: props.running }} onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <Show when={query() !== null}>
        <SlashPalette
          entries={entries()}
          index={index()}
          onHover={setIndex}
          onRun={(command) => { reset(); props.onCommand(command.id) }}
        />
      </Show>
      <textarea
        ref={input}
        rows="1"
        aria-label="Message Quark"
        placeholder={props.running ? "Quark is working…" : "Ask Quark to build, inspect, or explain…"}
        disabled={props.running}
        value={text()}
        onInput={(event) => { setText(event.currentTarget.value); resize() }}
        onKeyDown={keydown}
      />
      <div class="composer-actions">
        <div class="input-tools">
          <div class="context-status" title="Context window used">
            <span class="context-ring" aria-hidden="true" style={{ background: `conic-gradient(var(--green) 0 ${percent()}%, var(--line) ${percent()}%)` }}><span /></span>
            <strong>{percent()}%</strong>
          </div>
        </div>
        <div class="composer-controls">
          <div class="model-info" title="Active model">
            <span>{props.status.modelName}</span>
            <span class="thinking-badge">{props.status.thinkingEffort === "none" ? "thinking off" : `thinking ${props.status.thinkingEffort}`}</span>
          </div>
          <button class="send-button" type="submit" aria-label={props.running ? "Stop response" : "Send message"}>
            <SendIcon />
            <span class="stop-icon" aria-hidden="true" />
          </button>
        </div>
      </div>
    </form>
  )
}
