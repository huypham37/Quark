#!/usr/bin/env bun
// count-tokens.ts — count GPT tokens for one or more files
//
// Usage:
//   bun scripts/count-tokens.ts <file> [file2] [file3] ...
//   bun scripts/count-tokens.ts --stdin          (reads from stdin)
//   cat prompt.txt | bun scripts/count-tokens.ts --stdin
//
// Uses the cl100k_base encoding (GPT-4 / GPT-3.5-turbo / text-embedding-ada-002)

import { encode } from "gpt-tokenizer"
import { readFileSync } from "fs"

const MODEL_CONTEXT = {
  "gpt-4o":           128_000,
  "gpt-4-turbo":      128_000,
  "gpt-4":             8_192,
  "gpt-3.5-turbo":   16_385,
  "claude-3-5-sonnet": 200_000,
  "claude-opus-4":     200_000,
}

function countTokens(text: string): number {
  return encode(text).length
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US")
}

function bar(used: number, total: number, width = 30): string {
  const filled = Math.round((used / total) * width)
  const pct = ((used / total) * 100).toFixed(1)
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}] ${pct}%`
}

function analyzeText(label: string, text: string) {
  const tokens = countTokens(text)
  const chars = text.length
  const lines = text.split("\n").length
  const words = text.trim().split(/\s+/).length
  const ratio = (chars / tokens).toFixed(2)

  console.log(`\n── ${label}`)
  console.log(`   Chars  : ${formatNumber(chars)}`)
  console.log(`   Words  : ${formatNumber(words)}`)
  console.log(`   Lines  : ${formatNumber(lines)}`)
  console.log(`   Tokens : ${formatNumber(tokens)}  (${ratio} chars/token)`)
  console.log("")
  console.log("   Context usage:")
  for (const [model, limit] of Object.entries(MODEL_CONTEXT)) {
    const fits = tokens <= limit ? "✓" : "✗ OVER"
    console.log(`   ${model.padEnd(22)} ${bar(Math.min(tokens, limit), limit)}  ${formatNumber(tokens)}/${formatNumber(limit)}  ${fits}`)
  }

  return tokens
}

const args = process.argv.slice(2)

if (args.length === 0) {
  console.error("Usage: bun scripts/count-tokens.ts <file> [file2...]")
  console.error("       bun scripts/count-tokens.ts --stdin")
  process.exit(1)
}

if (args[0] === "--stdin") {
  const text = readFileSync("/dev/stdin", "utf-8")
  analyzeText("stdin", text)
} else {
  const totals: { label: string; tokens: number }[] = []

  for (const file of args) {
    let text: string
    try {
      text = readFileSync(file, "utf-8")
    } catch (e) {
      console.error(`Error reading ${file}: ${e}`)
      continue
    }
    const tokens = analyzeText(file, text)
    totals.push({ label: file, tokens })
  }

  if (totals.length > 1) {
    const total = totals.reduce((s, t) => s + t.tokens, 0)
    console.log(`\n── COMBINED TOTAL`)
    console.log(`   Files  : ${totals.length}`)
    console.log(`   Tokens : ${formatNumber(total)}`)
    console.log("")
    console.log("   Context usage:")
    for (const [model, limit] of Object.entries(MODEL_CONTEXT)) {
      const fits = total <= limit ? "✓" : "✗ OVER"
      console.log(`   ${model.padEnd(22)} ${bar(Math.min(total, limit), limit)}  ${formatNumber(total)}/${formatNumber(limit)}  ${fits}`)
    }
  }
}
