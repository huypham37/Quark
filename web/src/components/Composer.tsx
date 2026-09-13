import { createMemo, createSignal } from "solid-js"
import { SendIcon } from "../icons"
import type { AppStatus } from "../types"

interface ComposerProps {
  running: boolean
  tokensUsed: number
  status: AppStatus
  onSubmit: (text: string) => Promise<void>
  onCancel: () => Promise<void>
}

export function Composer(props: ComposerProps) {
  const [text, setText] = createSignal("")
  let input: HTMLTextAreaElement | undefined
  const percent = createMemo(() => props.status.tokenLimit
    ? Math.min(100, Math.round(props.tokensUsed / props.status.tokenLimit * 1_000) / 10)
    : 0)

  const resize = () => {
    if (!input) return
    input.style.height = "auto"
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`
  }

  const submit = async (event: Event) => {
    event.preventDefault()
    if (props.running) return props.onCancel()
    const value = text().trim()
    if (!value) return
    setText("")
    queueMicrotask(resize)
    await props.onSubmit(value)
  }

  return (
    <form classList={{ composer: true, running: props.running }} onSubmit={submit}>
      <textarea
        ref={input}
        rows="1"
        aria-label="Message Quark"
        placeholder={props.running ? "Quark is working…" : "Ask Quark to build, inspect, or explain…"}
        disabled={props.running}
        value={text()}
        onInput={(event) => { setText(event.currentTarget.value); resize() }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) void submit(event)
        }}
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
