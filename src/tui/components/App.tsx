// @jsxImportSource @opentui/solid
// App — root TUI component (OpenTUI/SolidJS)
//
// Fullscreen layout: the app fills the entire terminal.
// Messages render in a native <scrollbox> with smooth scrolling.
// Input/autocomplete/footer are pinned at the bottom.

import type { Component } from "solid-js"
import { For, createSignal, createEffect, Show } from "solid-js"
import { useKeyboard, useTerminalDimensions, useRenderer } from "@opentui/solid"
import { MacOSScrollAccel } from "@opentui/core"
import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { createAppState, dispatch, type AppState } from "../state"
import { wireEvents } from "../events"
import { ready as modelsReady, getModelLimit } from "../../provider/models"
import { getModelId, loadConfig } from "../../config/config"
import { MessageItem } from "./message-item"
import { Prompt } from "./prompt"
import { Autocomplete, type PickerItem, type AutocompleteMode } from "./autocomplete"
import { PermissionPrompt } from "./permission-prompt"
import { QuestionPrompt, createQuestionKeyHandler } from "./question-prompt"
import { FooterBar } from "./footer-bar"
import { Notifications } from "./notifications"
import { colors } from "../theme"
import { respond as respondPermission } from "../../permission/permission"
import { respondQuestion } from "../../tool/question"
import { getFiles, fuzzyFilter } from "../filelist"
import { filterCommands, type SlashCommand } from "../commands"
import { generateId } from "ai"
import * as fs from "fs"
import * as path from "path"
import { readClipboard } from "../clipboard"
import { writeClipboard } from "../clipboard"
import { info as notifyInfo } from "../../notification/notification"
import { getNextModel, getPrevModel } from "../model-cycle"
import { setCopilotThinking } from "../../provider/provider"

/** Command handler result */
export type CommandResult =
  | { handled: true }
  | { handled: false }

interface AppProps {
  onSubmit: (text: string, sessionId: string | null, images?: { mime: string; data: string }[], context?: string) => void
  onCancel: (sessionId: string) => void
  onCommand?: (command: string, args: string, sessionId: string | null) => Promise<CommandResult> | CommandResult | void
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
  const renderer = useRenderer()

  // Wire up console copy-to-clipboard — also shows a toast on success
  renderer.console.onCopySelection = async (text: string) => {
    if (!text) return
    await writeClipboard(text)
      .then(() => notifyInfo("Clipboard", "Copied to clipboard", 2000))
      .catch((err) => console.error(`Failed to copy: ${err}`))
    renderer.clearSelection()
  }

  // Copy selection to clipboard helper — used by onMouseUp on the root box
  const copySelection = () => {
    const text = renderer.getSelection()?.getSelectedText()
    if (!text) return
    writeClipboard(text)
      .then(() => notifyInfo("Clipboard", "Copied to clipboard", 2000))
      .catch((err) => console.error(`Failed to copy: ${err}`))
    renderer.clearSelection()
  }

  function exitApp() {
    renderer.destroy()
    process.exit(0)
  }

  // --- App-level state store (messages, session, running, status, etc.) ---
  const state = createAppState({
    sessionId: props.initialSessionId ?? null,
    modelName: props.initialModelName ?? "smart",
    skillCount: props.initialSkillCount ?? 0,
  })

  // Wire event bus to state store
  wireEvents(state)

  // Question prompt key handler
  const questionHandler = createQuestionKeyHandler({
    request: () => state.store.question,
    onReply: (answers) => {
      const q = state.store.question
      if (!q) return
      respondQuestion({ requestId: q.requestId, answers })
      dispatch(state, { type: "clear-question" })
      dispatch(state, { type: "set-running", running: true })
    },
    onReject: () => {
      const q = state.store.question
      if (!q) return
      respondQuestion({ requestId: q.requestId, rejected: true })
      dispatch(state, { type: "clear-question" })
    },
  })

  // Update tokenLimit once models.dev data is available
  modelsReady.then(() => {
    const lim = getModelLimit(getModelId("main"))
    const limit = lim?.input ?? lim?.context
    if (limit) state.setStore("status", "tokenLimit", limit)
  })

  // --- Refs ---
  let scroll: ScrollBoxRenderable | undefined
  let inputRef: TextareaRenderable | undefined

  // --- Local UI signals (not in the global store — ephemeral) ---
  const [mention, setMention] = createSignal<MentionState>(MENTION_INACTIVE)
  const [slash, setSlash] = createSignal<SlashState>(SLASH_INACTIVE)
  // Mirror of input value (kept in sync with inputRef via onInput)
  const [inputValue, setInputValue] = createSignal("")

  // File cache (loaded lazily on first @ mention)
  let allFiles: string[] | null = null

  // Pending image attachments — cleared on submit
  const [pendingImages, setPendingImages] = createSignal<{ mime: string; data: string; label: string }[]>([])
  // Index of the chip currently selected for deletion (null = none)
  const [selectedImageIndex, setSelectedImageIndex] = createSignal<number | null>(null)

  // ---------------------------------------------------------------------------
  // Message history navigation (↑/↓ like a terminal shell)
  // historyIndex: -1 = not navigating (showing draft or current input)
  //               0  = most recent sent message
  //               n  = n-th message back in history
  // ---------------------------------------------------------------------------
  const [historyIndex, setHistoryIndex] = createSignal(-1)
  // Saved draft text — restored when the user presses ↓ past the most recent entry
  const [historyDraft, setHistoryDraft] = createSignal("")

  // Derive the ordered list of unique user message texts from the store
  // (oldest → newest, so index 0 in reversed view = most recent)
  const userHistory = (): string[] => {
    const texts: string[] = []
    for (const msg of state.store.messages) {
      if (msg.role !== "user") continue
      const textPart = msg.parts.find((p) => p.type === "text")
      if (textPart && textPart.type === "text" && textPart.text.trim()) {
        texts.push(textPart.text)
      }
    }
    // Return reversed so index 0 = most recent
    return texts.reverse()
  }

  // Auto-clear selection when all pending images are gone
  createEffect(() => {
    if (pendingImages().length === 0) setSelectedImageIndex(null)
  })

  // Reset history navigation when the session changes
  createEffect(() => {
    // Track sessionId — reset index and draft whenever it changes
    state.store.sessionId
    setHistoryIndex(-1)
    setHistoryDraft("")
  })

  const ensureFilesLoaded = async (): Promise<string[]> => {
    if (allFiles) return allFiles
    const files = await getFiles()
    allFiles = files
    return files
  }

  // Whether any dropdown is active
  const dropdownActive = () => mention().active || slash().active

  // ---------------------------------------------------------------------------
  // Pending image removal
  // ---------------------------------------------------------------------------

  const removeImage = (index: number) => {
    setPendingImages((prev) => {
      const next = prev.filter((_, i) => i !== index)
      // Renumber labels to keep them sequential (Image 1, Image 2, …)
      return next.map((img, i) => ({ ...img, label: `Image ${i + 1}` }))
    })
    setSelectedImageIndex(null)
  }

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

  const handleInputChange = () => {
    // Get the actual text from the textarea ref
    if (!inputRef) return
    const newValue = inputRef.plainText
    
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
      if (text === "") {
        inputRef.clear()
      } else {
        inputRef.setText(text)
        inputRef.gotoBufferEnd()
      }
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
      exitApp()
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
            state.setStore("status", "modelName", selected.id)
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
              const pickerItems: PickerItem[] = sessions.map((sess) => ({
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
                pickerItems,
                selectedIndex: 0,
              })
              setInputText("")
              return true
            }

            // Tab → fill in command + space for arg typing
            // Enter → execute the command directly (no second Enter required)
            if (isTab) {
              const newValue = `/${selected.id} `
              setInputText(newValue)
              setSlash(SLASH_INACTIVE)
            } else {
              // isReturn: execute immediately
              setSlash(SLASH_INACTIVE)
              setInputText("")
              executeCommand(selected.id, "")
            }
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
    setMention(MENTION_INACTIVE)
    setSlash(SLASH_INACTIVE)
    // Reset history navigation on submit
    setHistoryIndex(-1)
    setHistoryDraft("")

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

    // Extract @file and @directory mentions and read their content
    const mentionedPaths = extractMentions(text)

    let context = ""
    for (const mentionPath of mentionedPaths) {
      try {
        const absPath = path.resolve(process.cwd(), mentionPath)
        const stat = fs.statSync(absPath)
        if (stat.isDirectory()) {
          // Read directory listing and include shallow file contents
          const entries = fs.readdirSync(absPath)
          context += `\n<directory path="${mentionPath}">\n`
          for (const entry of entries) {
            const entryPath = path.join(absPath, entry)
            try {
              const entryStat = fs.statSync(entryPath)
              if (entryStat.isFile()) {
                const content = fs.readFileSync(entryPath, "utf-8")
                const relPath = path.join(mentionPath, entry)
                context += `<file path="${relPath}">\n${content}\n</file>\n`
              } else if (entryStat.isDirectory()) {
                context += `<subdirectory name="${entry}/" />\n`
              }
            } catch {
              // Entry not readable — skip
            }
          }
          context += `</directory>\n`
        } else {
          const content = fs.readFileSync(absPath, "utf-8")
          context += `\n<file path="${mentionPath}">\n${content}\n</file>\n`
        }
      } catch {
        // Path not readable — skip silently
      }
    }

    const imgs = pendingImages()

    setInputText("")
    setPendingImages([])

    // Auto-scroll to bottom
    scroll?.scrollBy({ x: 0, y: Infinity })

    props.onSubmit(
      text,
      state.store.sessionId,
      imgs.length > 0 ? imgs.map((img) => ({ mime: img.mime, data: img.data })) : undefined,
      context || undefined,
    )
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
    // Ctrl+Z / Cmd+Z — undo and move cursor to end
    if ((evt.ctrl || evt.meta || evt.super) && evt.name === "z" && !evt.shift) {
      if (inputRef && !state.store.running) {
        inputRef.undo()
        inputRef.gotoBufferEnd()
        evt.preventDefault()
      }
      return
    }

    // Ctrl+Shift+Z / Cmd+Shift+Z — redo and move cursor to end
    if ((evt.ctrl || evt.meta || evt.super) && (evt.name === "z" || evt.name === "Z") && evt.shift) {
      if (inputRef && !state.store.running) {
        inputRef.redo()
        inputRef.gotoBufferEnd()
        evt.preventDefault()
      }
      return
    }

    // Ctrl+V — check clipboard for image before terminal handles paste
    if (evt.ctrl && evt.name === "v") {
      readClipboard().then((content) => {
        if (!content) return
        setPendingImages((prev) => {
          const label = `Image ${prev.length + 1}`
          return [...prev, { mime: content.mime, data: content.data, label }]
        })
        evt.preventDefault()
      })
      return
    }

    // Image chip navigation — only when there are pending images and no dropdown/agent
    if (pendingImages().length > 0 && !dropdownActive() && !state.store.running) {
      const images = pendingImages()
      const current = selectedImageIndex()

      // Tab cycles through chips: null → 0 → 1 → … → n-1 → null
      if (evt.name === "tab") {
        if (current === null) {
          setSelectedImageIndex(0)
        } else if (current < images.length - 1) {
          setSelectedImageIndex(current + 1)
        } else {
          setSelectedImageIndex(null)
        }
        evt.preventDefault()
        return
      }

      // Backspace or Delete removes the selected chip
      if ((evt.name === "backspace" || evt.name === "delete") && current !== null) {
        removeImage(current)
        evt.preventDefault()
        return
      }

      // Escape clears selection (takes priority over agent-cancel when a chip is selected)
      if (evt.name === "escape" && current !== null) {
        setSelectedImageIndex(null)
        evt.preventDefault()
        return
      }
    }

    // Tab model cycling — when no images, no dropdown, not running
    if (evt.name === "tab" && !evt.shift && !dropdownActive() && !state.store.running && pendingImages().length === 0) {
      if (props.getModels && props.getCurrentModel) {
        const models = props.getModels()
        const next = getNextModel(models, props.getCurrentModel())
        if (next) {
          if (props.onCommand) {
            props.onCommand("model", next, state.store.sessionId)
          }
          state.setStore("status", "modelName", next)
        }
      }
      evt.preventDefault()
      return
    }

    // Shift+Tab model cycling (reverse) — when no images, no dropdown, not running
    if (evt.name === "tab" && evt.shift && !dropdownActive() && !state.store.running && pendingImages().length === 0) {
      if (props.getModels && props.getCurrentModel) {
        const models = props.getModels()
        const prev = getPrevModel(models, props.getCurrentModel())
        if (prev) {
          if (props.onCommand) {
            props.onCommand("model", prev, state.store.sessionId)
          }
          state.setStore("status", "modelName", prev)
        }
      }
      evt.preventDefault()
      return
    }

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

    // Question mode: intercept arrow/number/enter/escape keys
    if (state.store.question) {
      const consumed = questionHandler.handleKey(evt.name)
      if (consumed) {
        evt.preventDefault()
        return
      }
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
      // History navigation: intercept ↑ when not running, cursor is on line 1
      if (!state.store.running && !dropdownActive() && inputRef) {
        const text = inputRef.plainText
        const offset = inputRef.cursorOffset
        const cursorLine = text.slice(0, offset).split("\n").length - 1
        if (cursorLine === 0) {
          const history = userHistory()
          if (history.length > 0) {
            const next = historyIndex() + 1
            if (next < history.length) {
              if (historyIndex() === -1) setHistoryDraft(text)
              setHistoryIndex(next)
              setInputText(history[next])
            }
            evt.preventDefault()
            return
          }
        }
      }
      scroll?.scrollBy(-SCROLL_STEP)
      evt.preventDefault()
      return
    }
    if (evt.name === "down") {
      // History navigation: intercept ↓ when navigating history and cursor is on last line
      if (!state.store.running && !dropdownActive() && historyIndex() >= 0 && inputRef) {
        const text = inputRef.plainText
        const offset = inputRef.cursorOffset
        const lines = text.split("\n")
        const cursorLine = text.slice(0, offset).split("\n").length - 1
        if (cursorLine === lines.length - 1) {
          const prev = historyIndex() - 1
          if (prev < 0) {
            setHistoryIndex(-1)
            setInputText(historyDraft())
          } else {
            setHistoryIndex(prev)
            setInputText(userHistory()[prev])
          }
          evt.preventDefault()
          return
        }
      }
      scroll?.scrollBy(SCROLL_STEP)
      evt.preventDefault()
      return
    }

    // Esc clears any active selection (takes priority over agent cancel)
    if (evt.name === "escape" && renderer.getSelection()) {
      renderer.clearSelection()
      evt.preventDefault()
      evt.stopPropagation()
      return
    }

    // Esc cancels running agent (only when no dropdown)
    if (evt.name === "escape" && state.store.running && state.store.sessionId) {
      props.onCancel(state.store.sessionId)
      return
    }

    // Ctrl+T — toggle extended thinking (reasoning)
    if (evt.ctrl && evt.name === "t") {
      dispatch(state, { type: "toggle-thinking" })
      // Read AFTER dispatch — thinkingEnabled now reflects the new value
      setCopilotThinking(state.store.thinkingEnabled ? 10000 : 0)
      evt.preventDefault()
      return
    }

    // Ctrl+C — cancel agent or exit
    if (evt.ctrl && evt.name === "c") {
      if (renderer.getSelection()) {
        renderer.clearSelection()
        return
      }
      if (state.store.running && state.store.sessionId) {
        props.onCancel(state.store.sessionId)
      } else {
        exitApp()
      }
    }
  })

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <box flexDirection="column" width={dims().width} height={dims().height} paddingX={2}
      onMouseUp={() => copySelection()}
    >
      {/* Message area — native scrollbox */}
      <scrollbox
        ref={(r: ScrollBoxRenderable) => { scroll = r }}
        stickyScroll={true}
        stickyStart="bottom"
        flexGrow={1}
        flexBasis={0}
        minHeight={0}
        overflow="hidden"
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

      {/* Permission prompt */}
      <Show when={state.store.permission}>
        {(perm) => <PermissionPrompt request={perm()} />}
      </Show>

      {/* Question prompt */}
      <Show when={state.store.question}>
        {(q) => (
          <QuestionPrompt
            request={q()}
            onReply={(answers) => {
              respondQuestion({ requestId: q().requestId, answers })
              dispatch(state, { type: "clear-question" })
              dispatch(state, { type: "set-running", running: true })
            }}
            onReject={() => {
              respondQuestion({ requestId: q().requestId, rejected: true })
              dispatch(state, { type: "clear-question" })
            }}
          />
        )}
      </Show>

      {/* Autocomplete dropdown — absolute overlay, does NOT shrink scrollbox */}
      <Autocomplete mode={autocompleteMode()} />

      {/* Input area */}
      <Prompt
        onSubmit={handleSubmit}
        onContentChange={handleInputChange}
        onRef={(r: TextareaRenderable) => { inputRef = r }}
        disabled={state.store.running || !!state.store.permission || !!state.store.question}
        placeholder=""
        tokensUsed={state.store.status.tokensUsed}
        tokenLimit={state.store.status.tokenLimit}
        cost={state.store.status.cost}
        modelName={state.store.status.modelName}
        skillCount={state.store.status.skillCount}
        images={pendingImages()}
        selectedImageIndex={selectedImageIndex()}
        onRemoveImage={removeImage}
        thinkingEnabled={state.store.thinkingEnabled}
      />

      {/* Notifications overlay */}
      <Notifications />

      {/* Footer bar */}
      <FooterBar running={state.store.running} compacting={state.store.compacting} />
    </box>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract @file_path mentions from text */
function extractMentions(text: string): string[] {
  const regex = /@([\w.\/\-]+\/?)/g
  const mentions: string[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) mentions.push(match[1])
  }
  return mentions
}
