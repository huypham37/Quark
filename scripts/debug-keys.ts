#!/usr/bin/env bun
// Debug script to see what key sequences are being sent
// Run: bun scripts/debug-keys.ts
// Press keys to see their raw sequences and parsed results

import { parseKeypress } from "@opentui/core"

process.stdin.setRawMode(true)
process.stdin.resume()
process.stdin.setEncoding("utf8")

console.log("Press keys to see their sequences. Ctrl+C to exit.\n")

process.stdin.on("data", (data: string) => {
  // Show raw bytes
  const bytes = [...data].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ")
  console.log(`Raw: "${data.replace(/\x1b/g, "ESC")}" (hex: ${bytes})`)

  // Parse with OpenTUI
  const parsed = parseKeypress(data)
  if (parsed) {
    console.log(`Parsed: name="${parsed.name}" ctrl=${parsed.ctrl} meta=${parsed.meta} shift=${parsed.shift} super=${parsed.super} option=${parsed.option}`)
  } else {
    console.log("Parsed: null (mouse/special sequence)")
  }
  console.log()

  // Exit on Ctrl+C
  if (data === "\x03") {
    process.exit()
  }
})
