// @jsxImportSource @opentui/solid
// App — root TUI component (OpenTUI/SolidJS)
//
// Fullscreen layout: the app fills the entire terminal.
// Messages render in a native <scrollbox> with smooth scrolling.
// Input/autocomplete/footer are pinned at the bottom.

import type { Component } from "solid-js"
import { For, createSignal, Show } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { MacOSScrollAccel } from "@opentui/core"
import type { ScrollBoxRenderable, InputRenderable } from "@opentui/core"
import { createAppState, dispatch, type AppState } from "../state"
import { wireEvents } from "../events"
import { MessageItem } from "./message-item"
import { Prompt } from "./prompt"
import { Autocomplete, type PickerItem, type AutocompleteMode } from "./autocomplete"
import { PermissionPrompt } from "./permission-prompt"
import { FooterBar } from "./footer-bar"
import { colors } from "../theme"
import { respond as respondPermission } from "../../permission/permission"
import { getFiles, fuzzyFilter } from "../filelist"
import { filterCommands, type SlashCommand } from "../commands"
import { generateId } from "ai"
import * as fs from "fs"
import * as path from "path"

/** Command handler result */
export type CommandResult =
  | { handled: true }
  | { handled: false }

interface AppProps {
  onSubmit: (text: string, sessionId: string | null, context?: string) => void
  onCancel: (sessionId: string) => void
  onCommand?: (command: string, args: string, sessionId: string | null) => CommandResult | void
  getSessions?: () => { id: string; title: string | null; timeUpdated: number }[]
  getModels?: () => { id: string; name: string }[]
  getCurrentModel?: () => string
  initialSessionId?: string
  initialModelName?: string
  initialSkillCount?: number
}

// ---------------------------------------------------------------------------
// @ mention state machine
// ---------------------------------------------------------------------------

interface MentionState {
  active: boolean
  atIndex: number
  query: string
  items: string[]
  selectedIndex: number
}

const MENTION_INACTIVE: MentionState = {
  active: false,
  atIndex: -1,
  query: "",
  items: [],
  selectedIndex: 0,
}

// ---------------------------------------------------------------------------
// / slash command state machine
// ---------------------------------------------------------------------------

interface SlashState {
  active: boolean
  mode: "commands" | "sessions" | "models"
  query: string
  items: SlashCommand[]
  pickerItems: PickerItem[]
  selectedIndex: number
}

const SLASH_INACTIVE: SlashState = {
  active: false,
  mode: "commands",
  query: "",
  items: [],
  pickerItems: [],
  selectedIndex: 0,
}

const MAX_FILE_ITEMS = 5
const MAX_DROPDOWN_ITEMS = 15
const SCROLL_STEP = 3

export const App: Component<AppProps> = (props) => {
  const dims = useTerminalDimensions()

  // --- App-level state store (messages, session, running, status, etc.) ---
  const state = createAppState({
    sessionId: props.initialSessionId ?? null,
    modelName: props.initialModelName ?? "smart",
    skillCount: props.initialSkillCount ?? 0,
  })

  // Wire event bus to state store
  wireEvents(state)

  // --- Refs ---
  let scroll: ScrollBoxRenderable | undefined
  let inputRef: InputRenderable | undefined

  // --- Local UI signals (not in the global store — ephemeral) ---
  const [mention, setMention] = createSignal<MentionState>(MENTION_INACTIVE)
  const [slash, setSlash] = createSignal<SlashState>(SLASH_INACTIVE)
  // Mirror of input value (kept in sync with inputRef via onInput)
  const [inputValue, setInputValue] = createSignal("")

  // File cache (loaded lazily on first @ mention)
  let allFiles: string[] | null = null

  const ensureFilesLoaded = async (): Promise<string[]> => {
    if (allFiles) return allFiles
    const files = await getFiles()
    allFiles = files
    return files
  }

  // Whether any dropdown is active
  const dropdownActive = () => mention().active || slash().active

  // ---------------------------------------------------------------------------
  // Mention updater — called when input value changes
  // ---------------------------------------------------------------------------

  const updateMentionFromValue = async (newValue: string) => {
    const lastAt = newValue.lastIndexOf("@")
    if (lastAt === -1) {
      setMention(MENTION_INACTIVE)
      return
    }

    // @ must be at start or preceded by a space
    if (lastAt > 0 && newValue[lastAt - 1] !== " ") {
      setMention(MENTION_INACTIVE)
      return
    }

    const query = newValue.slice(lastAt + 1)

    // If there's a space after @query, mention is done
    if (query.includes(" ")) {
      setMention(MENTION_INACTIVE)
      return
    }

    const files = await ensureFilesLoaded()
    const filtered = fuzzyFilter(files, query, MAX_FILE_ITEMS)

    setMention({
      active: true,
      atIndex: lastAt,
      query,
      items: filtered,
      selectedIndex: 0,
    })
  }

  // ---------------------------------------------------------------------------
  // Slash updater — called when input value changes
  // ---------------------------------------------------------------------------

  const updateSlashFromValue = (newValue: string) => {
    if (!newValue.startsWith("/")) {
      setSlash(SLASH_INACTIVE)
      return
    }

    // If there's a space, the command part is done — dismiss dropdown
    const spaceIndex = newValue.indexOf(" ")
    if (spaceIndex !== -1) {
      setSlash(SLASH_INACTIVE)
      return
    }

    const query = newValue.slice(1)
    const filtered = filterCommands(query, MAX_DROPDOWN_ITEMS)

    setSlash({
      active: true,
      mode: "commands",
      query,
      items: filtered,
      pickerItems: [],
      selectedIndex: 0,
    })
  }

  // ---------------------------------------------------------------------------
  // Input change handler
  // ---------------------------------------------------------------------------

  const handleInputChange = (newValue: string) => {
    // When in picker mode (sessions/models), ignore input changes
    const s = slash()
    if (s.mode !== "commands" && s.active) {
      return
    }

    setInputValue(newValue)

    // Slash and mention are mutually exclusive — slash takes precedence
    if (newValue.startsWith("/")) {
      updateSlashFromValue(newValue)
      setMention(MENTION_INACTIVE)
    } else {
      setSlash(SLASH_INACTIVE)
      updateMentionFromValue(newValue)
    }
  }

  // ---------------------------------------------------------------------------
  // Set input value imperatively (after tab-completing a mention/command)
  // ---------------------------------------------------------------------------

  const setInputText = (text: string) => {
    if (inputRef) {
      inputRef.value = text
    }
    setInputValue(text)
  }

  // ---------------------------------------------------------------------------
  // Execute a slash command
  // ---------------------------------------------------------------------------

  const executeCommand = (commandId: string, args: string) => {
    if (commandId === "help") {
      const helpLines = filterCommands("", 99)
        .map((cmd) => `  /${cmd.id}${cmd.usage ? " " + cmd.usage : ""} — ${cmd.description}`)
        .join("\n")
      const helpText = `Available commands:\n${helpLines}`
      const msgId = generateId()
      dispatch(state, { type: "add-user-message", id: msgId, text: helpText })
      return
    }

    if (commandId === "exit") {
      if (state.store.running && state.store.sessionId) {
        props.onCancel(state.store.sessionId)
      }
      process.exit(0)
      return
    }

    // Delegate to backend handler
    if (props.onCommand) {
      props.onCommand(commandId, args, state.store.sessionId)
    }
  }

  // ---------------------------------------------------------------------------
  // Handle dropdown navigation (arrow keys, tab, enter, escape)
  // Called from the global keyboard handler when a dropdown is active.
  // Returns true if the key was consumed.
  // ---------------------------------------------------------------------------

  const handleDropdownKey = (name: string, isTab: boolean, isReturn: boolean, isEscape: boolean): boolean => {
    const s = slash()
    if (s.active) {
      if (name === "up") {
        setSlash((prev) => ({
          ...prev,
          selectedIndex: Math.max(0, prev.selectedIndex - 1),
        }))
        return true
      }

      if (name === "down") {
        const totalItems = s.mode === "commands" ? s.items.length : s.pickerItems.length
        setSlash((prev) => {
          if (totalItems === 0) return prev
          return {
            ...prev,
            selectedIndex: Math.min(totalItems - 1, prev.selectedIndex + 1),
          }
        })
        return true
      }

      if (isTab || isReturn) {
        // --- Session picker mode ---
        if (s.mode === "sessions") {
          const selected = s.pickerItems[s.selectedIndex]
          if (selected) {
            setSlash(SLASH_INACTIVE)
            setInputText("")
            if (props.onCommand) {
              props.onCommand("sessions", selected.id, state.store.sessionId)
            }
          }
          return true
        }

        // --- Model picker mode ---
        if (s.mode === "models") {
          const selected = s.pickerItems[s.selectedIndex]
          if (selected) {
            setSlash(SLASH_INACTIVE)
            setInputText("")
            if (props.onCommand) {
              props.onCommand("model", selected.id, state.store.sessionId)
            }
          }
          return true
        }

        // --- Command mode ---
        if (s.items.length > 0) {
          const selected = s.items[s.selectedIndex]
          if (selected) {
            // /sessions → transition to session picker
            if (selected.id === "sessions" && isReturn && props.getSessions) {
              const sessions = props.getSessions()
              const sid = state.store.sessionId
              const pickerItems: PickerItem[] = sessions.slice(0, 5).map((sess) => ({
                id: sess.id,
                label: sess.title ?? "(untitled)",
                detail: new Date(sess.timeUpdated).toLocaleString(),
                isCurrent: sess.id === sid,
              }))
              setSlash({
                active: true,
                mode: "sessions",
                query: "",
                items: [],
                pickerItems,
                selectedIndex: 0,
              })
              setInputText("")
              return true
            }

            // /model → transition to model picker
            if (selected.id === "model" && isReturn && props.getModels) {
              const currentModel = props.getCurrentModel?.() ?? ""
              const models = props.getModels()
              const pickerItems: PickerItem[] = models.map((m) => ({
                id: m.id,
                label: m.name,
                detail: "",
                isCurrent: m.id === currentModel,
              }))
              pickerItems.sort((a, b) => (a.isCurrent ? -1 : b.isCurrent ? 1 : 0))
              setSlash({
                active: true,
                mode: "models",
                query: "",
                items: [],
                pickerItems: pickerItems.slice(0, 10),
                selectedIndex: 0,
              })
              setInputText("")
              return true
            }

            // Normal command: insert the full command + space
            const newValue = `/${selected.id} `
            setInputText(newValue)
            setSlash(SLASH_INACTIVE)
          }
        }
        return true
      }

      if (isEscape) {
        setSlash(SLASH_INACTIVE)
        setInputText("")
        return true
      }

      return false
    }

    // --- @ mention dropdown ---
    const m = mention()
    if (!m.active) return false

    if (name === "up") {
      setMention((prev) => ({
        ...prev,
        selectedIndex: Math.max(0, prev.selectedIndex - 1),
      }))
      return true
    }

    if (name === "down") {
      setMention((prev) => {
        if (prev.items.length === 0) return prev
        return {
          ...prev,
          selectedIndex: Math.min(prev.items.length - 1, prev.selectedIndex + 1),
        }
      })
      return true
    }

    if (isTab || isReturn) {
      if (m.items.length > 0) {
        const selected = m.items[m.selectedIndex]
        if (selected) {
          const currentInput = inputValue()
          const before = currentInput.slice(0, m.atIndex)
          const newValue = `${before}@${selected} `
          setInputText(newValue)
          setMention(MENTION_INACTIVE)
        }
      }
      return true
    }

    if (isEscape) {
      setMention(MENTION_INACTIVE)
      return true
    }

    return false
  }

  // ---------------------------------------------------------------------------
  // Submit handler
  // ---------------------------------------------------------------------------

  const handleSubmit = (text: string) => {
    if (state.store.error) {
      dispatch(state, { type: "clear-error" })
    }

    setMention(MENTION_INACTIVE)
    setSlash(SLASH_INACTIVE)

    // Intercept slash commands: /command args
    if (text.startsWith("/")) {
      const spaceIndex = text.indexOf(" ")
      const commandId = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex)
      const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim()

      if (commandId) {
        executeCommand(commandId, args)
        setInputText("")
        return
      }
    }

    // Extract @file mentions and read their content
    const mentionedFiles = extractMentions(text)

    let context = ""
    for (const filePath of mentionedFiles) {
      try {
        const absPath = path.resolve(process.cwd(), filePath)
        const content = fs.readFileSync(absPath, "utf-8")
        context += `\n<file path="${filePath}">\n${content}\n</file>\n`
      } catch {
        // File not readable — skip silently
      }
    }

    const msgId = generateId()
    dispatch(state, { type: "add-user-message", id: msgId, text })

    setInputText("")

    // Auto-scroll to bottom
    scroll?.scrollBy({ x: 0, y: Infinity })

    props.onSubmit(text, state.store.sessionId, context || undefined)
  }

  // ---------------------------------------------------------------------------
  // Compute autocomplete mode for the Autocomplete component
  // ---------------------------------------------------------------------------

  const autocompleteMode = (): AutocompleteMode | null => {
    const s = slash()
    if (s.active) {
      if (s.mode === "sessions") {
        return { type: "sessions", items: s.pickerItems, selectedIndex: s.selectedIndex }
      }
      if (s.mode === "models") {
        return { type: "models", items: s.pickerItems, selectedIndex: s.selectedIndex }
      }
      return { type: "commands", items: s.items, selectedIndex: s.selectedIndex, query: s.query }
    }

    const m = mention()
    if (m.active) {
      return { type: "files", items: m.items, selectedIndex: m.selectedIndex, query: m.query }
    }

    return null
  }

  // ---------------------------------------------------------------------------
  // Global keyboard handler
  // ---------------------------------------------------------------------------

  useKeyboard((evt) => {
    // Permission mode: intercept a/o/r keys
    if (state.store.permission) {
      const lower = evt.name.toLowerCase()
      if (lower === "a") {
        respondPermission({ requestId: state.store.permission.requestId, reply: "always" })
        dispatch(state, { type: "clear-permission" })
        dispatch(state, { type: "set-running", running: true })
      } else if (lower === "o") {
        respondPermission({ requestId: state.store.permission.requestId, reply: "once" })
        dispatch(state, { type: "clear-permission" })
        dispatch(state, { type: "set-running", running: true })
      } else if (lower === "r") {
        respondPermission({ requestId: state.store.permission.requestId, reply: "reject" })
        dispatch(state, { type: "clear-permission" })
      }
      evt.preventDefault()
      return
    }

    // Dropdown navigation — intercept arrow/tab/enter/escape BEFORE input processes them
    if (dropdownActive()) {
      const consumed = handleDropdownKey(
        evt.name,
        evt.name === "tab",
        evt.name === "return",
        evt.name === "escape",
      )
      if (consumed) {
        evt.preventDefault()
        return
      }
    }

    // Arrow key scrolling (only when no dropdown is active)
    if (evt.name === "up") {
      scroll?.scrollBy(-SCROLL_STEP)
      evt.preventDefault()
      return
    }
    if (evt.name === "down") {
      scroll?.scrollBy(SCROLL_STEP)
      evt.preventDefault()
      return
    }

    // Esc cancels running agent (only when no dropdown)
    if (evt.name === "escape" && state.store.running && state.store.sessionId) {
      props.onCancel(state.store.sessionId)
      return
    }

    // Ctrl+C to cancel or exit
    if (evt.ctrl && evt.name === "c") {
      if (state.store.running && state.store.sessionId) {
        props.onCancel(state.store.sessionId)
      } else {
        process.exit(0)
      }
    }
  })

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <box flexDirection="column" width={dims().width} height={dims().height} paddingX={2}>
      {/* Message area — native scrollbox */}
      <scrollbox
        ref={(r: ScrollBoxRenderable) => { scroll = r }}
        stickyScroll={true}
        stickyStart="bottom"
        flexGrow={1}
        scrollAcceleration={new MacOSScrollAccel()}
        scrollbarOptions={{
          trackOptions: {
            backgroundColor: colors.scrollbarTrack,
            foregroundColor: colors.scrollbarThumb,
          },
        }}
      >
        <For each={state.store.messages}>
          {(msg) => <MessageItem message={msg} />}
        </For>
      </scrollbox>

      {/* Error display */}
      <Show when={state.store.error}>
        <box>
          <text fg={colors.error} bold>Error: </text>
          <text fg={colors.error}>{state.store.error}</text>
        </box>
      </Show>

      {/* Permission prompt */}
      <Show when={state.store.permission}>
        {(perm) => <PermissionPrompt request={perm()} />}
      </Show>

      {/* Autocomplete dropdown — absolute overlay, does NOT shrink scrollbox */}
      <Autocomplete mode={autocompleteMode()} />

      {/* Input area */}
      <Prompt
        onSubmit={handleSubmit}
        onInput={handleInputChange}
        onRef={(r: InputRenderable) => { inputRef = r }}
        disabled={state.store.running || !!state.store.permission}
        placeholder=""
        tokensUsed={state.store.status.tokensUsed}
        tokenLimit={state.store.status.tokenLimit}
        cost={state.store.status.cost}
        modelName={state.store.status.modelName}
        skillCount={state.store.status.skillCount}
      />

      {/* Footer bar */}
      <FooterBar running={state.store.running} />
    </box>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract @file_path mentions from text */
function extractMentions(text: string): string[] {
  const regex = /@([\w.\/\-]+)/g
  const mentions: string[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) mentions.push(match[1])
  }
  return mentions
}
