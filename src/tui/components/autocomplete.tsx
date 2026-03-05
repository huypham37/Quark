// @jsxImportSource @opentui/solid
// Autocomplete — dropdown for @ file mentions, / slash commands, and pickers
//
// Renders above the Prompt component. Controlled entirely by App.tsx.
// Replaces both FileDropdown and CommandDropdown from the React TUI.

import type { Component } from "solid-js"
import { Show, For } from "solid-js"
import { colors } from "../theme"
import type { SlashCommand } from "../commands"

export interface PickerItem {
  id: string
  label: string
  detail: string
  isCurrent?: boolean
}

export type AutocompleteMode =
  | { type: "files"; items: string[]; selectedIndex: number; query: string }
  | { type: "commands"; items: SlashCommand[]; selectedIndex: number; query: string }
  | { type: "sessions"; items: PickerItem[]; selectedIndex: number }
  | { type: "models"; items: PickerItem[]; selectedIndex: number }

export interface AutocompleteProps {
  mode: AutocompleteMode
}

export const Autocomplete: Component<AutocompleteProps> = (props) => {
  // Use simple conditional rendering — Switch/Match with keyed has
  // implicit-any issues in the current tsconfig setup.
  const m = () => props.mode

  return (
    <>
      {m().type === "files" && (
        <FileList
          items={(m() as Extract<AutocompleteMode, { type: "files" }>).items}
          selectedIndex={m().selectedIndex}
          query={(m() as Extract<AutocompleteMode, { type: "files" }>).query}
        />
      )}
      {m().type === "commands" && (
        <CommandList
          items={(m() as Extract<AutocompleteMode, { type: "commands" }>).items}
          selectedIndex={m().selectedIndex}
          query={(m() as Extract<AutocompleteMode, { type: "commands" }>).query}
        />
      )}
      {m().type === "sessions" && (
        <PickerList
          title="Sessions"
          hint="select and press Enter to switch"
          items={(m() as Extract<AutocompleteMode, { type: "sessions" }>).items}
          selectedIndex={m().selectedIndex}
          emptyText="No sessions found"
        />
      )}
      {m().type === "models" && (
        <PickerList
          title="Models"
          hint="select and press Enter to switch"
          items={(m() as Extract<AutocompleteMode, { type: "models" }>).items}
          selectedIndex={m().selectedIndex}
          emptyText="No models available"
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const FileList: Component<{ items: string[]; selectedIndex: number; query: string }> = (props) => {
  return (
    <Show
      when={props.items.length > 0}
      fallback={
        <box paddingX={1}>
          <text fg={colors.muted}>No files matching </text>
          <text fg={colors.primary}>@{props.query}</text>
        </box>
      }
    >
      <box flexDirection="column">
        <For each={props.items}>
          {(file, i) => {
            const isSelected = () => i() === props.selectedIndex
            return (
              <box paddingX={1}>
                <text
                  fg={isSelected() ? colors.primary : colors.textDim}
                  bold={isSelected()}
                >
                  {isSelected() ? "❯ " : "  "}{file}
                </text>
              </box>
            )
          }}
        </For>
      </box>
    </Show>
  )
}

const CommandList: Component<{ items: SlashCommand[]; selectedIndex: number; query: string }> = (props) => {
  return (
    <Show
      when={props.items.length > 0}
      fallback={
        <box paddingX={1}>
          <text fg={colors.muted}>No commands matching </text>
          <text fg={colors.primary}>/{props.query}</text>
        </box>
      }
    >
      <box flexDirection="column">
        <For each={props.items}>
          {(cmd, i) => {
            const isSelected = () => i() === props.selectedIndex
            return (
              <box paddingX={1} gap={1}>
                <text
                  fg={isSelected() ? colors.primary : colors.textDim}
                  bold={isSelected()}
                >
                  {isSelected() ? "❯" : " "} /{cmd.id}
                </text>
                <Show when={cmd.usage}>
                  <text fg={colors.muted}>{cmd.usage}</text>
                </Show>
                <text fg={colors.muted}>— {cmd.description}</text>
              </box>
            )
          }}
        </For>
      </box>
    </Show>
  )
}

const PickerList: Component<{
  title: string
  hint: string
  items: PickerItem[]
  selectedIndex: number
  emptyText: string
}> = (props) => {
  return (
    <Show
      when={props.items.length > 0}
      fallback={
        <box paddingX={1}>
          <text fg={colors.muted}>{props.emptyText}</text>
        </box>
      }
    >
      <box flexDirection="column">
        <box paddingX={1}>
          <text fg={colors.primary} bold>{props.title}</text>
          <text fg={colors.muted}> — {props.hint}</text>
        </box>
        <For each={props.items}>
          {(item, i) => {
            const isSelected = () => i() === props.selectedIndex
            return (
              <box paddingX={1}>
                <text
                  fg={isSelected() ? colors.primary : colors.textDim}
                  bold={isSelected()}
                >
                  {isSelected() ? "❯ " : "  "}{item.label}
                </text>
                <Show when={item.isCurrent}>
                  <text fg={colors.success}>  ← current</text>
                </Show>
              </box>
            )
          }}
        </For>
      </box>
    </Show>
  )
}
