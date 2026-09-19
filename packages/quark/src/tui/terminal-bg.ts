// terminal-bg.ts — detect the terminal's background color via OSC 11 query
//
// Tier 1: OSC 11 on stdin (works when stdin is a real TTY).
// Tier 2: Parse terminal config files (Ghostty, iTerm2, Kitty, etc.).
// Tier 3: macOS system dark-mode preference.
// Tier 4: Hard-coded fallback (#000000).

import { RGBA } from "@opentui/core"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const DEFAULT_BG = RGBA.fromHex("#000000")
const LIGHT_BG = RGBA.fromHex("#f0f0f0")
const TIMEOUT_MS = 500

/**
 * Query the terminal's background color using OSC 11.
 *
 * Returns the detected RGBA or a fallback (#000000) if the terminal
 * doesn't respond within TIMEOUT_MS.
 */
export function queryTerminalBackground(): Promise<RGBA> {
  return new Promise((resolve) => {
    let done = false
    let buf = ""

    const finish = (color: RGBA) => {
      if (done) return
      done = true
      try { process.stdin.setRawMode(false) } catch { /* ignore */ }
      process.stdin.pause()
      process.stdin.removeListener("data", onData)
      resolve(color)
    }

    const onData = (chunk: Buffer) => {
      buf += chunk.toString("latin1")
      const match = buf.match(/\x1b\]11;rgb:([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})/)
      if (!match) return
      const afterMatch = buf.slice(buf.indexOf(match[0]) + match[0].length)
      if (!afterMatch.includes("\x07") && !afterMatch.includes("\x1b\\")) return

      const r = normalizeChannel(match[1]!)
      const g = normalizeChannel(match[2]!)
      const b = normalizeChannel(match[3]!)
      finish(RGBA.fromInts(r, g, b, 255))
    }

    // Tier 1: stdin-based OSC 11
    try {
      process.stdin.setRawMode(true)
    } catch {
      // Not a TTY — fall through to config / OS detection
      finish(detectFromConfigOrOS())
      return
    }

    process.stdin.resume()
    process.stdin.on("data", onData)
    process.stdout.write("\x1b]11;?\x07")

    setTimeout(() => finish(detectFromConfigOrOS()), TIMEOUT_MS)
  })
}

/** Convert a 2-digit or 4-digit hex channel to 0–255 */
function normalizeChannel(hex: string): number {
  const value = parseInt(hex, 16)
  if (hex.length <= 2) return value
  return Math.round((value / 65535) * 255)
}

/**
 * Tier 2 + 3 fallback: try terminal config files, then macOS system theme.
 * Exported so the startup flow can call it after renderer.getPalette() fails.
 */
export function detectFromConfigOrOS(): RGBA {
  const configBg = parseTerminalConfig()
  if (configBg) return configBg

  const osBg = macOSThemeFallback()
  if (osBg) return osBg

  return DEFAULT_BG
}

// ---------------------------------------------------------------------------
// Tier 2: Terminal config file parsing
// ---------------------------------------------------------------------------

interface TerminalConfigPath {
  path: string
  parser: (content: string) => RGBA | undefined
}

const KNOWN_LIGHT_THEMES = new Set([
  "atom one light", "one light", "github light", "solarized light",
  "gruvbox light", "ayu light", "catppuccin latte", "rose-pine-dawn",
  "tokyo night light", "modus-operandi",
])

const KNOWN_DARK_THEMES = new Set([
  "atom one dark", "one dark", "github dark", "solarized dark",
  "gruvbox dark", "ayu dark", "catppuccin mocha", "catppuccin macchiato",
  "catppuccin frappe", "rose-pine", "rose-pine-moon", "tokyo night",
  "tokyo night storm", "dracula", "modus-vivendi", "night-owl",
])

function themeNameToBg(name: string): RGBA | undefined {
  const normalized = name.toLowerCase().replace(/[_-]/g, " ")
  if (KNOWN_LIGHT_THEMES.has(normalized)) return LIGHT_BG
  if (KNOWN_DARK_THEMES.has(normalized)) return DEFAULT_BG
  // Heuristic: theme name contains "light" → light, "dark" → dark
  if (normalized.includes("light")) return LIGHT_BG
  if (normalized.includes("dark")) return DEFAULT_BG
  return undefined
}

function parseGhosttyConfig(content: string): RGBA | undefined {
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*theme\s*=\s*(.+?)\s*$/)
    if (match && match[1]) return themeNameToBg(match[1])
  }
  return undefined
}

function parseKittyConfig(content: string): RGBA | undefined {
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*include\s+(.+?)\s*$/)
    if (match && match[1]) return themeNameToBg(match[1])
  }
  return undefined
}

function parseItermPlist(content: string): RGBA | undefined {
  // iTerm2 plist files contain theme name in the "Color Space" or theme metadata
  // Simplified: look for known theme names anywhere in the file
  const lower = content.toLowerCase()
  for (const theme of KNOWN_LIGHT_THEMES) {
    if (lower.includes(theme)) return LIGHT_BG
  }
  for (const theme of KNOWN_DARK_THEMES) {
    if (lower.includes(theme)) return DEFAULT_BG
  }
  return undefined
}

function getTerminalConfigs(): TerminalConfigPath[] {
  const home = os.homedir()
  return [
    {
      path: path.join(home, "Library/Application Support/com.mitchellh.ghostty/config"),
      parser: parseGhosttyConfig,
    },
    {
      path: path.join(home, ".config/ghostty/config"),
      parser: parseGhosttyConfig,
    },
    {
      path: path.join(home, ".config/kitty/kitty.conf"),
      parser: parseKittyConfig,
    },
    {
      path: path.join(home, "Library/Application Support/iTerm2/DynamicProfiles"),
      parser: (content) => parseItermPlist(content),
    },
  ]
}

function parseTerminalConfig(): RGBA | undefined {
  for (const cfg of getTerminalConfigs()) {
    try {
      const content = fs.readFileSync(cfg.path, "utf-8")
      const result = cfg.parser(content)
      if (result) return result
    } catch {
      // Config file doesn't exist or isn't readable — try next
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Tier 3: macOS system theme
// ---------------------------------------------------------------------------

/**
 * Read macOS system-wide dark-mode preference.
 * Returns light-gray when OS is in light mode, black when in dark mode.
 * Returns undefined on non-macOS platforms or if we can't determine.
 */
function macOSThemeFallback(): RGBA | undefined {
  if (process.platform !== "darwin") return undefined
  const result = Bun.spawnSync({
    cmd: ["defaults", "read", "-g", "AppleInterfaceStyle"],
    stdout: "pipe",
    stderr: "pipe",
  })
  const style = result.stdout.toString().trim().toLowerCase()
  // "Dark" explicitly → dark mode. Key missing (light mode) → light.
  return style === "dark" ? DEFAULT_BG : LIGHT_BG
}
