// App — root TUI component
//
// Fullscreen layout: the app fills the entire terminal.
// Input/status/footer are pinned at the bottom.
// Message area fills the remaining space above with scrollable viewport.
// @ file mention autocomplete renders above the InputBox as a dropdown.
// / slash commands render a command dropdown above the InputBox.

import React, { useReducer, useCallback, useState, useEffect, useRef } from "react"
import { Box, Text, useApp, useInput, useStdin, useStdout } from "ink"
import { MessageList } from "./components/messages/MessageList"
import { InputBox, type InputKey } from "./components/bars/InputBox"
import { FooterBar } from "./components/bars/FooterBar"
import { PermissionPrompt } from "./components/bars/PermissionPrompt"
import { FileDropdown } from "./components/bars/FileDropdown"
import { CommandDropdown } from "./components/bars/CommandDropdown"
import { useEventBus } from "./hooks/useEventBus"
import { useMouseScroll } from "./hooks/useMouseScroll"
import { initialState, reduce } from "./state/state"
import { generateId } from "ai"
import { respond as respondPermission } from "../permission/permission"
import { getFiles, fuzzyFilter } from "./filelist"
import { filterCommands, type SlashCommand } from "./commands"
import { colors } from "./theme"
import * as fs from "fs"
import * as path from "path"

/** Command handler result — returned by onCommand for commands that need backend */
export type CommandResult =
  | { handled: true }
  | { handled: false }

interface AppProps {
  onSubmit: (text: string, sessionId: string | null, context?: string) => void
  onCancel: (sessionId: string) => void
  /** Handle slash commands that need backend access (compact, model, clear) */
  onCommand?: (command: string, args: string, sessionId: string | null) => CommandResult | void
  initialSessionId?: string
  initialModelName?: string
  initialSkillCount?: number
}

// @ mention state machine
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

// / slash command state machine
interface SlashState {
  active: boolean
  query: string
  items: SlashCommand[]
  selectedIndex: number
}

const SLASH_INACTIVE: SlashState = {
  active: false,
  query: "",
  items: [],
  selectedIndex: 0,
}

const MAX_DROPDOWN_ITEMS = 15
const SCROLL_STEP = 3

export function App({ onSubmit, onCancel, onCommand, initialSessionId, initialModelName, initialSkillCount }: AppProps) {
  const [state, dispatch] = useReducer(reduce, {
    ...initialState(),
    sessionId: initialSessionId ?? null,
    status: {
      ...initialState().status,
      modelName: initialModelName ?? "smart",
      skillCount: initialSkillCount ?? 0,
    },
  })
  const { exit } = useApp()
  const { isRawModeSupported } = useStdin()
  const { stdout } = useStdout()
  const [rows, setRows] = useState(stdout?.rows ?? 24)

  // Controlled input state (lifted from InputBox)
  const [inputValue, setInputValue] = useState("")

  // Scroll state: lines from bottom (0 = pinned to bottom)
  const [scrollOffset, setScrollOffset] = useState(0)

  // @ mention state
  const [mention, setMention] = useState<MentionState>(MENTION_INACTIVE)

  // / slash command state
  const [slash, setSlash] = useState<SlashState>(SLASH_INACTIVE)

  // Refs for stable access in callbacks (avoids stale closures)
  const inputValueRef = useRef(inputValue)
  inputValueRef.current = inputValue
  const mentionRef = useRef(mention)
  mentionRef.current = mention
  const slashRef = useRef(slash)
  slashRef.current = slash

  // File cache ref (loaded once lazily)
  const allFilesRef = useRef<string[] | null>(null)

  // Track whether the user has manually scrolled up.
  // When true, auto-scroll is suppressed so streaming doesn't yank the view.
  const userScrolledRef = useRef(false)

  // Re-render on terminal resize
  useEffect(() => {
    if (!stdout) return
    const onResize = () => setRows(stdout.rows)
    stdout.on("resize", onResize)
    return () => { stdout.off("resize", onResize) }
  }, [stdout])

  // Auto-scroll to bottom on new content — only if the user hasn't scrolled up
  useEffect(() => {
    if (!userScrolledRef.current) {
      setScrollOffset(0)
    }
  }, [state.messages])

  // Mouse wheel / trackpad scrolling (1 line per wheel tick — trackpad fires rapidly)
  const handleMouseScrollUp = useCallback(() => {
    userScrolledRef.current = true
    setScrollOffset((prev) => prev + 1)
  }, [])
  const handleMouseScrollDown = useCallback(() => {
    setScrollOffset((prev) => {
      const next = Math.max(0, prev - 1)
      if (next === 0) {
        userScrolledRef.current = false
      }
      return next
    })
  }, [])
  useMouseScroll({
    onScrollUp: handleMouseScrollUp,
    onScrollDown: handleMouseScrollDown,
    isActive: isRawModeSupported ?? false,
  })

  // Subscribe to backend events
  useEventBus(state.sessionId, dispatch)

  // Load file list lazily when mention first activates
  const ensureFilesLoaded = useCallback(async () => {
    if (allFilesRef.current) return allFilesRef.current
    const files = await getFiles()
    allFilesRef.current = files
    return files
  }, [])

  // Update mention state when input value changes
  const updateMentionFromValue = useCallback(async (newValue: string) => {
    const lastAt = newValue.lastIndexOf("@")
    if (lastAt === -1) {
      setMention(MENTION_INACTIVE)
      return
    }

    if (lastAt > 0 && newValue[lastAt - 1] !== " ") {
      setMention(MENTION_INACTIVE)
      return
    }

    const query = newValue.slice(lastAt + 1)

    if (query.includes(" ")) {
      setMention(MENTION_INACTIVE)
      return
    }

    const files = await ensureFilesLoaded()
    const filtered = fuzzyFilter(files, query, MAX_DROPDOWN_ITEMS)

    setMention({
      active: true,
      atIndex: lastAt,
      query,
      items: filtered,
      selectedIndex: 0,
    })
  }, [ensureFilesLoaded])

  // Update slash command state when input changes
  const updateSlashFromValue = useCallback((newValue: string) => {
    // Slash commands only trigger when / is at position 0
    if (!newValue.startsWith("/")) {
      setSlash(SLASH_INACTIVE)
      return
    }

    // Extract query: everything after / up to first space
    const spaceIndex = newValue.indexOf(" ")
    // If there's a space, the command part is done — dismiss dropdown
    if (spaceIndex !== -1) {
      setSlash(SLASH_INACTIVE)
      return
    }

    const query = newValue.slice(1)
    const filtered = filterCommands(query, MAX_DROPDOWN_ITEMS)

    setSlash({
      active: true,
      query,
      items: filtered,
      selectedIndex: 0,
    })
  }, [])

  // Handle input value changes
  const handleInputChange = useCallback((newValue: string) => {
    setInputValue(newValue)

    // Slash and mention are mutually exclusive — slash takes precedence
    if (newValue.startsWith("/")) {
      updateSlashFromValue(newValue)
      setMention(MENTION_INACTIVE)
    } else {
      setSlash(SLASH_INACTIVE)
      updateMentionFromValue(newValue)
    }
  }, [updateMentionFromValue, updateSlashFromValue])

  // Handle key presses from InputBox (for mention/slash navigation)
  const handleKeyPress = useCallback((input: string, key: InputKey) => {
    // --- Slash command dropdown navigation ---
    const s = slashRef.current
    if (s.active) {
      if (key.upArrow) {
        setSlash((prev) => ({
          ...prev,
          selectedIndex: Math.max(0, prev.selectedIndex - 1),
        }))
        return
      }

      if (key.downArrow) {
        setSlash((prev) => {
          if (prev.items.length === 0) return prev
          return {
            ...prev,
            selectedIndex: Math.min(prev.items.length - 1, prev.selectedIndex + 1),
          }
        })
        return
      }

      if (key.tab || key.return) {
        const currentSlash = slashRef.current
        if (currentSlash.items.length > 0) {
          const selected = currentSlash.items[currentSlash.selectedIndex]
          if (selected) {
            // Insert the full command and a trailing space
            const newValue = `/${selected.id} `
            setInputValue(newValue)
            setSlash(SLASH_INACTIVE)
          }
        }
        return
      }

      if (key.escape) {
        setSlash(SLASH_INACTIVE)
        return
      }
      return
    }

    // --- @ mention dropdown navigation ---
    const m = mentionRef.current
    if (!m.active) return

    if (key.upArrow) {
      setMention((prev) => ({
        ...prev,
        selectedIndex: Math.max(0, prev.selectedIndex - 1),
      }))
      return
    }

    if (key.downArrow) {
      setMention((prev) => {
        if (prev.items.length === 0) return prev
        return {
          ...prev,
          selectedIndex: Math.min(prev.items.length - 1, prev.selectedIndex + 1),
        }
      })
      return
    }

    if (key.tab || key.return) {
      const currentMention = mentionRef.current
      if (currentMention.items.length > 0) {
        const selected = currentMention.items[currentMention.selectedIndex]
        if (selected) {
          const currentInput = inputValueRef.current
          const before = currentInput.slice(0, currentMention.atIndex)
          const newValue = `${before}@${selected} `
          setInputValue(newValue)
          setMention(MENTION_INACTIVE)
        }
      }
      return
    }

    if (key.escape) {
      setMention(MENTION_INACTIVE)
      return
    }
  }, [])

  // Execute a slash command
  const executeCommand = useCallback((commandId: string, args: string) => {
    // Handle commands that are purely TUI-side
    if (commandId === "help") {
      // Show help as a system-like message in the UI
      const helpLines = filterCommands("", 99)
        .map((cmd) => `  /${cmd.id}${cmd.usage ? " " + cmd.usage : ""} — ${cmd.description}`)
        .join("\n")
      const helpText = `Available commands:\n${helpLines}`
      const msgId = generateId()
      dispatch({ type: "add-user-message", id: msgId, text: helpText })
      return
    }

    if (commandId === "exit") {
      if (state.running && state.sessionId) {
        onCancel(state.sessionId)
      }
      exit()
      return
    }

    // Delegate to backend handler
    if (onCommand) {
      onCommand(commandId, args, state.sessionId)
    }
  }, [state.running, state.sessionId, onCancel, onCommand, exit])

  // Handle user input submission
  const handleSubmit = useCallback((text: string) => {
    if (state.lastError) {
      dispatch({ type: "clear-error" })
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
        setInputValue("")
        return
      }
    }

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
    dispatch({ type: "add-user-message", id: msgId, text })

    setInputValue("")
    setScrollOffset(0) // snap to bottom on send
    userScrolledRef.current = false

    onSubmit(text, state.sessionId, context || undefined)
  }, [state.sessionId, state.lastError, onSubmit, executeCommand])

  // Global key handler: Esc to cancel, Ctrl+C to exit, arrow keys to scroll, permission keys
  useInput(
    (input, key) => {
      // Drop SGR mouse escape sequences — handled by useMouseScroll
      if (/\[<\d+;\d+;\d+[Mm]/.test(input)) return

      // Permission mode: intercept a/o/r keys
      if (state.permission) {
        const lower = input.toLowerCase()
        if (lower === "a") {
          respondPermission({ requestId: state.permission.requestId, reply: "always" })
          dispatch({ type: "clear-permission" })
          dispatch({ type: "set-running", running: true })
        } else if (lower === "o") {
          respondPermission({ requestId: state.permission.requestId, reply: "once" })
          dispatch({ type: "clear-permission" })
          dispatch({ type: "set-running", running: true })
        } else if (lower === "r") {
          respondPermission({ requestId: state.permission.requestId, reply: "reject" })
          dispatch({ type: "clear-permission" })
        }
        return
      }

      // Arrow key scrolling (only when no dropdown is active)
      if (!mentionRef.current.active && !slashRef.current.active) {
        if (key.upArrow) {
          userScrolledRef.current = true
          setScrollOffset((prev) => prev + SCROLL_STEP)
          return
        }
        if (key.downArrow) {
          setScrollOffset((prev) => {
            const next = Math.max(0, prev - SCROLL_STEP)
            if (next === 0) {
              userScrolledRef.current = false
            }
            return next
          })
          return
        }
      }

      // Esc cancels running agent (but not when a dropdown is open)
      if (key.escape && !mentionRef.current.active && !slashRef.current.active && state.running && state.sessionId) {
        onCancel(state.sessionId)
      }
      // Ctrl+C to exit
      if (input === "c" && key.ctrl) {
        if (state.running && state.sessionId) {
          onCancel(state.sessionId)
        }
        exit()
      }
    },
    { isActive: isRawModeSupported },
  )

  // Calculate bottom section height
  let bottomHeight = 5 + 1 // InputBox + FooterBar
  if (state.lastError) bottomHeight += 1
  if (state.permission) bottomHeight += 4
  const dropdownHeight = mention.active
    ? Math.max(1, mention.items.length)
    : slash.active
      ? Math.max(1, slash.items.length)
      : 0
  bottomHeight += dropdownHeight

  const messagesHeight = Math.max(1, rows - bottomHeight)

  return (
    <Box flexDirection="column" height={rows} paddingX={2}>
      {/* Message area — scrollable viewport */}
      <MessageList
        messages={state.messages}
        height={messagesHeight}
        scrollOffset={scrollOffset}
      />

      {/* Error display */}
      {state.lastError && (
        <Box>
          <Text color={colors.error} bold>Error: </Text>
          <Text color={colors.error}>{state.lastError}</Text>
        </Box>
      )}

      {/* Permission prompt */}
      {state.permission && (
        <PermissionPrompt request={state.permission} />
      )}

      {/* File mention dropdown (renders above input) */}
      {mention.active && (
        <FileDropdown
          items={mention.items}
          selectedIndex={mention.selectedIndex}
          query={mention.query}
        />
      )}

      {/* Slash command dropdown (renders above input) */}
      {slash.active && (
        <CommandDropdown
          items={slash.items}
          selectedIndex={slash.selectedIndex}
          query={slash.query}
        />
      )}

      {/* Input box with status in top border */}
      <InputBox
        value={inputValue}
        onChange={handleInputChange}
        onSubmit={handleSubmit}
        onKeyPress={handleKeyPress}
        mentionActive={mention.active || slash.active}
        disabled={state.running || !!state.permission}
        tokensUsed={state.status.tokensUsed}
        tokenLimit={state.status.tokenLimit}
        cost={state.status.cost}
        modelName={state.status.modelName}
        skillCount={state.status.skillCount}
      />

      {/* Footer bar (always rendered, empty when idle) */}
      <FooterBar running={state.running} />
    </Box>
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
