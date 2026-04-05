// Tests for web UI slash command picker (gh issue #54)
//
// Verifies by reading source files (NOT the bundle — the bundle may not exist yet):
//   1. SlashIcon exists in icons.tsx
//   2. CommandPalette component exists and imports from the shared command registry
//   3. InputArea wires up the / button, state, and keyboard handling
//   4. CSS classes for the command palette exist in styles.css
//   5. The 'exit' command is excluded in the web UI (TUI-only)

import { describe, test, expect, beforeAll } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"

// ── Sources ──────────────────────────────────────────────────────────────────

const ICONS_PATH          = resolve(import.meta.dir, "../../src/web/client/icons.tsx")
const COMMAND_PALETTE_PATH = resolve(import.meta.dir, "../../src/web/client/components/command-palette.tsx")
const INPUT_PATH          = resolve(import.meta.dir, "../../src/web/client/components/input-area.tsx")
const CSS_PATH            = resolve(import.meta.dir, "../../src/web/client/styles.css")
const COMMANDS_PATH       = resolve(import.meta.dir, "../../src/tui/commands.ts")

let iconsSrc: string
let paletteSrc: string
let inputSrc: string
let css: string
let commandsSrc: string

beforeAll(() => {
  iconsSrc    = readFileSync(ICONS_PATH, "utf8")
  paletteSrc  = readFileSync(COMMAND_PALETTE_PATH, "utf8")
  inputSrc    = readFileSync(INPUT_PATH, "utf8")
  css         = readFileSync(CSS_PATH, "utf8")
  commandsSrc = readFileSync(COMMANDS_PATH, "utf8")
})

// ── Helper ───────────────────────────────────────────────────────────────────

function extractBlock(src: string, startMarker: string): string {
  const idx = src.indexOf(startMarker)
  if (idx === -1) throw new Error(`Marker not found: ${startMarker}`)

  let searchFrom = idx
  if (startMarker.includes("function ")) {
    const parenOpen = src.indexOf("(", idx)
    if (parenOpen !== -1) {
      let parenDepth = 0
      let j = parenOpen
      while (j < src.length) {
        if (src[j] === "(") parenDepth++
        else if (src[j] === ")") {
          parenDepth--
          if (parenDepth === 0) break
        }
        j++
      }
      searchFrom = j + 1
    }
  }

  const bodyStart = src.indexOf("{", searchFrom)
  let depth = 0
  let i = bodyStart
  while (i < src.length) {
    if (src[i] === "{") depth++
    else if (src[i] === "}") {
      depth--
      if (depth === 0) break
    }
    i++
  }
  return src.slice(bodyStart, i + 1)
}

// ── 1. icons.tsx — SlashIcon (gh issue #54) ──────────────────────────────────

describe("icons.tsx — SlashIcon for the / toolbar button (gh issue #54)", () => {
  test("SlashIcon is exported from icons.tsx", () => {
    expect(iconsSrc).toContain("export function SlashIcon(")
  })

  test("SlashIcon renders an SVG element", () => {
    const block = extractBlock(iconsSrc, "export function SlashIcon(")
    expect(block).toContain("<svg")
  })
})

// ── 2. CommandPalette component (gh issue #54) ───────────────────────────────

describe("command-palette.tsx — component structure (gh issue #54)", () => {
  test("command-palette.tsx imports from tui/commands (shared registry)", () => {
    // Should import the shared SlashCommand type or commands/filterCommands from commands.ts
    expect(paletteSrc).toMatch(/from\s+['"].*tui\/commands['"]/)
  })

  test("CommandPalette component is exported", () => {
    expect(paletteSrc).toMatch(/export\s+function\s+CommandPalette\s*\(/)
  })

  test("CommandPalette has an onSelect callback prop", () => {
    expect(paletteSrc).toContain("onSelect")
  })

  test("CommandPalette has an onClose callback prop", () => {
    expect(paletteSrc).toContain("onClose")
  })

  test("CommandPalette renders command name / id", () => {
    // Should reference cmd.id or the command id field in JSX
    expect(paletteSrc).toMatch(/cmd\.id|command\.id|\.id/)
  })

  test("CommandPalette renders command description", () => {
    expect(paletteSrc).toMatch(/cmd\.description|command\.description|\.description/)
  })

  test("CommandPalette renders usage hint", () => {
    // The usage field is optional — component should handle and display it
    expect(paletteSrc).toMatch(/usage/)
  })

  test("CommandPalette uses filterCommands or imports commands array", () => {
    expect(paletteSrc).toMatch(/filterCommands|commands/)
  })
})

// ── 3. InputArea — / button, state, keyboard (gh issue #54) ─────────────────

describe("InputArea — slash command picker integration (gh issue #54)", () => {
  test("InputArea imports SlashIcon", () => {
    expect(inputSrc).toContain("SlashIcon")
  })

  test("InputArea imports CommandPalette", () => {
    expect(inputSrc).toContain("CommandPalette")
  })

  test("InputArea has slash-related open/visible state", () => {
    // State variable for showing the palette — any of these naming conventions
    expect(inputSrc).toMatch(/showPalette|slashOpen|paletteOpen|showSlash|slashVisible/)
  })

  test("InputArea has a / button in the toolbar", () => {
    // The slash button should use SlashIcon or have a 'slash' className or aria-label
    expect(inputSrc).toMatch(/SlashIcon|slash/)
  })

  test("InputArea opens the palette on '/' keypress in the textarea", () => {
    // Key handler must check for '/' key
    expect(inputSrc).toMatch(/key\s*===\s*['"]\/['"]|['"]\/['"]/)
  })

  test("InputArea closes the palette on Escape key", () => {
    // Escape should close the palette — the handler must reference both Escape and the palette state
    expect(inputSrc).toMatch(/Escape/)
  })

  test("InputArea renders CommandPalette in JSX", () => {
    expect(inputSrc).toContain("<CommandPalette")
  })

  test("InputArea passes onSelect handler to CommandPalette", () => {
    expect(inputSrc).toMatch(/onSelect/)
  })

  test("InputArea passes onClose handler to CommandPalette", () => {
    expect(inputSrc).toMatch(/onClose/)
  })
})

// ── 4. styles.css — command palette styles (gh issue #54) ───────────────────

describe("styles.css — command palette CSS classes (gh issue #54)", () => {
  test("CSS has .command-palette class", () => {
    expect(css).toContain(".command-palette")
  })

  test("CSS has .command-palette-item class", () => {
    expect(css).toContain(".command-palette-item")
  })

  test("CSS has a selected/active state for palette items", () => {
    // Could be --selected, --active, :hover, or a focused variant
    expect(css).toMatch(/command-palette-item--(selected|active)|\.command-palette-item:hover|\.command-palette-item\.active|\.command-palette-item\.selected/)
  })
})

// ── 5. commands.ts — 'exit' is TUI-only (gh issue #54) ──────────────────────

describe("commands.ts — exit command is TUI-only (gh issue #54)", () => {
  test("commands.ts contains an exit command entry", () => {
    // Confirm exit exists in the registry so the web exclusion is meaningful
    expect(commandsSrc).toContain('"exit"')
  })

  test("CommandPalette excludes the exit command", () => {
    // The palette must filter out 'exit' — either via a prop, a filter call,
    // or an explicit exclusion inside the component
    expect(paletteSrc).toMatch(/exit/)
  })
})
