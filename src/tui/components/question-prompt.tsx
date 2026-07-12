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
import { For, Show } from "solid-js"
import type { TextareaRenderable } from "@opentui/core"
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
  /** Whether the custom answer textarea is active */
  customMode: Accessor<boolean>
  /** Current custom answer text */
  customText: Accessor<string>
  /** Update custom answer text from the textarea */
  setCustomText: (text: string) => void
  /** Submit the custom answer */
  submitCustom: (text?: string) => void
  /** Expose the custom textarea for global key handling */
  onCustomRef?: (ref: TextareaRenderable) => void
}

export const QuestionPrompt: Component<QuestionPromptProps> = (props) => {
  const questions = () => props.request.questions
  const single = () => questions().length === 1 && questions()[0]?.multiple !== true

  const question = () => questions()[props.tab()]
  const options = () => question()?.options ?? []
  const isMulti = () => question()?.multiple === true
  const isConfirm = () => !single() && props.tab() === questions().length
  const customIndex = () => options().length

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
                      fg={active() ? colors.primary : picked() ? RGBA.fromHex("#98C379") : colors.text}
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
            <Show when={question()?.custom === true}>
              <box flexDirection="row">
                <text fg={props.selected() === customIndex() ? colors.primary : colors.muted}>
                  {props.selected() === customIndex() ? "❯ " : "  "}
                </text>
                <text fg={colors.muted}>{`${customIndex() + 1}. `}</text>
                <text
                  fg={props.selected() === customIndex() ? colors.primary : colors.text}
                  bold={props.selected() === customIndex()}
                >
                  Type your own answer
                </text>
              </box>
            </Show>
            <Show when={props.customMode()}>
              <text fg={colors.muted}>Custom answer:</text>
              <textarea
                ref={(ref: TextareaRenderable) => props.onCustomRef?.(ref)}
                focused={true}
                placeholder="Type your own answer..."
                textColor={colors.text}
                focusedTextColor={colors.text}
                placeholderColor={colors.textDim}
                cursorColor={colors.cursorColor}
                cursorStyle={{ style: "block", blinking: true }}
                onContentChange={(value: string) => props.setCustomText(value)}
                onSubmit={() => props.submitCustom()}
                keyBindings={[{ name: "return", action: "submit" }]}
              />
            </Show>
          </box>
        </box>
      </Show>

      {/* Confirm tab — review answers */}
      <Show when={isConfirm()}>
        <box paddingLeft={1} flexDirection="column">
          <text bold fg={colors.text}>Review your answers:</text>
          <For each={questions()}>
            {(q, index) => {
              const value = () => props.answers()[index()]?.join(", ") ?? ""
              return (
                <box>
                  <text fg={colors.muted}>{q.header}: </text>
                  <text fg={value() ? colors.text : colors.error}>
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

// Keyboard handling lives separately so it can be tested without rendering OpenTUI.
export { createQuestionKeyHandler } from "../question-key-handler"
