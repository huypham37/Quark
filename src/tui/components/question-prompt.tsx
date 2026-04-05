// @jsxImportSource @opentui/solid
// QuestionPrompt — renders when the agent asks the user a question
//
// Shows the question text, numbered options, and keyboard hints.
// Supports single-select (enter picks), multi-select (enter toggles, then confirm),
// and a "Type your own answer" custom option.
//
// Key handling: arrow/number keys navigate, enter selects, escape dismisses.
// State is owned by createQuestionKeyHandler and passed in via props.

import type { Accessor, Component } from "solid-js"
import { For, Show, createSignal } from "solid-js"
import type { QuestionRequest } from "../state"
import { colors } from "../theme"
import { RGBA } from "@opentui/core"

export interface QuestionPromptProps {
  request: QuestionRequest
  /** Reactive accessor for the currently active tab index */
  tab: Accessor<number>
  /** Reactive accessor for the currently highlighted option index */
  selected: Accessor<number>
  /** Reactive accessor for the accumulated answers */
  answers: Accessor<string[][]>
}

export const QuestionPrompt: Component<QuestionPromptProps> = (props) => {
  const questions = () => props.request.questions
  const single = () => questions().length === 1 && questions()[0]?.multiple !== true

  const question = () => questions()[props.tab()]
  const options = () => question()?.options ?? []
  const isMulti = () => question()?.multiple === true
  const isConfirm = () => !single() && props.tab() === questions().length

  const currentAnswers = () => props.answers()[props.tab()] ?? []

  return (
    <box flexDirection="column" border={["left"]} borderColor={colors.primary}>
      {/* Tab bar for multi-question */}
      <Show when={!single()}>
        <box flexDirection="row" gap={1} paddingLeft={1} marginBottom={1}>
          <For each={questions()}>
            {(q, index) => {
              const isActive = () => index() === props.tab()
              const isAnswered = () => (props.answers()[index()]?.length ?? 0) > 0
              return (
                <text
                  bold={isActive()}
                  fg={isActive() ? colors.primary : isAnswered() ? RGBA.fromHex("#98C379") : colors.muted}
                >
                  {q.header}
                </text>
              )
            }}
          </For>
          <text
            bold={isConfirm()}
            fg={isConfirm() ? colors.primary : colors.muted}
          >
            Confirm
          </text>
        </box>
      </Show>

      {/* Question content */}
      <Show when={!isConfirm()}>
        <box paddingLeft={1} flexDirection="column" gap={1}>
          <text bold fg={colors.warning}>
            ? {question()?.question}{isMulti() ? " (select all that apply)" : ""}
          </text>
          <box flexDirection="column">
            <For each={options()}>
              {(opt, i) => {
                const active = () => i() === props.selected()
                const picked = () => currentAnswers().includes(opt.label)
                return (
                  <box flexDirection="row">
                    <text fg={active() ? colors.primary : colors.muted}>
                      {active() ? "❯ " : "  "}
                    </text>
                    <text fg={colors.muted}>{`${i() + 1}. `}</text>
                    <text
                      fg={active() ? colors.primary : picked() ? RGBA.fromHex("#98C379") : undefined}
                      bold={active()}
                    >
                      {isMulti() ? `[${picked() ? "✓" : " "}] ${opt.label}` : opt.label}
                    </text>
                    <Show when={!isMulti() && picked()}>
                      <text fg={RGBA.fromHex("#98C379")}> ✓</text>
                    </Show>
                  </box>
                )
              }}
            </For>
          </box>
        </box>
      </Show>

      {/* Confirm tab — review answers */}
      <Show when={isConfirm()}>
        <box paddingLeft={1} flexDirection="column">
          <text bold>Review your answers:</text>
          <For each={questions()}>
            {(q, index) => {
              const value = () => props.answers()[index()]?.join(", ") ?? ""
              return (
                <box>
                  <text fg={colors.muted}>{q.header}: </text>
                  <text fg={value() ? undefined : colors.error}>
                    {value() || "(not answered)"}
                  </text>
                </box>
              )
            }}
          </For>
        </box>
      </Show>

      {/* Key hints */}
      <box flexDirection="row" gap={2} paddingLeft={1} marginTop={1}>
        <Show when={!isConfirm()}>
          <box flexDirection="row">
            <text fg={colors.footerKey} bold>↑↓</text>
            <text fg={colors.muted}> select</text>
          </box>
        </Show>
        <box flexDirection="row">
          <text fg={colors.footerKey} bold>enter</text>
          <text fg={colors.muted}> {isConfirm() ? "submit" : isMulti() ? "toggle" : single() ? "submit" : "confirm"}</text>
        </box>
        <box flexDirection="row">
          <text fg={colors.error} bold>esc</text>
          <text fg={colors.muted}> dismiss</text>
        </box>
      </box>
    </box>
  )
}

// Export keyboard handler logic — used by App.tsx's global keyboard handler
export function createQuestionKeyHandler(props: {
  request: () => QuestionRequest | undefined
  onReply: (answers: string[][]) => void
  onReject: () => void
}) {
  const [tab, setTab] = createSignal(0)
  const [selected, setSelected] = createSignal(0)
  const [answers, setAnswers] = createSignal<string[][]>([])

  const questions = () => props.request()?.questions ?? []
  const single = () => questions().length === 1 && questions()[0]?.multiple !== true
  const question = () => questions()[tab()]
  const options = () => question()?.options ?? []
  const isMulti = () => question()?.multiple === true
  const isConfirm = () => !single() && tab() === questions().length

  function pick(label: string) {
    const a = [...answers()]
    a[tab()] = [label]
    setAnswers(a)

    if (single()) {
      props.onReply([[label]])
      return
    }
    setTab(tab() + 1)
    setSelected(0)
  }

  function toggle(label: string) {
    const a = [...answers()]
    const existing = a[tab()] ?? []
    const next = [...existing]
    const idx = next.indexOf(label)
    if (idx === -1) next.push(label)
    else next.splice(idx, 1)
    a[tab()] = next
    setAnswers(a)
  }

  function reset() {
    setTab(0)
    setSelected(0)
    setAnswers([])
  }

  /** Returns true if key was consumed */
  function handleKey(name: string): boolean {
    if (!props.request()) return false

    if (name === "escape") {
      props.onReject()
      reset()
      return true
    }

    if (isConfirm()) {
      if (name === "return") {
        const finalAnswers = questions().map((_, i) => answers()[i] ?? [])
        props.onReply(finalAnswers)
        reset()
        return true
      }
      if (name === "left" || name === "h") {
        setTab(Math.max(0, tab() - 1))
        setSelected(0)
        return true
      }
      return false
    }

    const opts = options()
    const total = opts.length

    // Number keys for quick select
    const digit = Number(name)
    if (!Number.isNaN(digit) && digit >= 1 && digit <= Math.min(total, 9)) {
      const opt = opts[digit - 1]
      if (opt) {
        if (isMulti()) {
          setSelected(digit - 1)
          toggle(opt.label)
        } else {
          pick(opt.label)
        }
      }
      return true
    }

    if (name === "up" || name === "k") {
      setSelected((selected() - 1 + total) % total)
      return true
    }

    if (name === "down" || name === "j") {
      setSelected((selected() + 1) % total)
      return true
    }

    if (name === "return") {
      const opt = opts[selected()]
      if (opt) {
        if (isMulti()) {
          toggle(opt.label)
        } else {
          pick(opt.label)
        }
      }
      return true
    }

    // Tab/left/right for multi-question navigation
    if (name === "tab" || name === "right" || name === "l") {
      if (!single() && tab() < questions().length) {
        setTab(tab() + 1)
        setSelected(0)
        return true
      }
    }
    if (name === "left" || name === "h") {
      if (!single() && tab() > 0) {
        setTab(tab() - 1)
        setSelected(0)
        return true
      }
    }

    return false
  }

  return { tab, selected, answers, handleKey, reset, isConfirm, single }
}
