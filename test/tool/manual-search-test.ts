#!/usr/bin/env bun
/**
 * Manual test script for grep, glob, and websearch tools
 * 
 * Run with: bun test/tool/manual-search-test.ts
 */

import { grepTool } from "../../src/tool/grep"
import { globTool } from "../../src/tool/glob"
import { websearchTool } from "../../src/tool/websearch"
import type { ToolContext } from "../../src/tool/tool"

// Simple test context
function makeCtx(): ToolContext {
  return {
    sessionId: "manual-test",
    messageId: "msg-1",
    abort: new AbortController().signal,
    messages: [],
    async ask(permission: string, pattern: string) {
      console.log(`  [Permission] ${permission}: ${pattern}`)
    },
  }
}

function header(text: string) {
  console.log("\n" + "=".repeat(60))
  console.log(text)
  console.log("=".repeat(60))
}

function section(text: string) {
  console.log("\n--- " + text + " ---")
}

async function testGrep() {
  header("GREP TOOL TESTS")
  const cwd = process.cwd()

  section("1. Search for 'defineTool' in src/tool")
  try {
    const result = await grepTool.execute(
      { pattern: "defineTool", path: `${cwd}/src/tool` },
      makeCtx(),
    )
    console.log("Title:", result.title)
    console.log("Matches:", result.metadata.matches)
    console.log("Output (first 500 chars):")
    console.log(result.output.slice(0, 500))
  } catch (e) {
    console.error("Error:", e)
  }

  section("2. Search for 'export.*Tool' regex in *.ts files")
  try {
    const result = await grepTool.execute(
      { pattern: "export.*Tool", path: `${cwd}/src/tool`, include: "*.ts" },
      makeCtx(),
    )
    console.log("Title:", result.title)
    console.log("Matches:", result.metadata.matches)
    console.log("Output (first 500 chars):")
    console.log(result.output.slice(0, 500))
  } catch (e) {
    console.error("Error:", e)
  }

  section("3. Search for non-existent pattern")
  try {
    const result = await grepTool.execute(
      { pattern: "xyzNonExistent123", path: cwd },
      makeCtx(),
    )
    console.log("Output:", result.output)
  } catch (e) {
    console.error("Error:", e)
  }
}

async function testGlob() {
  header("GLOB TOOL TESTS")
  const cwd = process.cwd()

  section("1. Find all TypeScript files in src/tool")
  try {
    const result = await globTool.execute(
      { pattern: "*.ts", path: `${cwd}/src/tool` },
      makeCtx(),
    )
    console.log("Title:", result.title)
    console.log("Count:", result.metadata.count)
    console.log("Output:")
    console.log(result.output)
  } catch (e) {
    console.error("Error:", e)
  }

  section("2. Find all test files recursively")
  try {
    const result = await globTool.execute(
      { pattern: "**/*.test.ts", path: `${cwd}/test` },
      makeCtx(),
    )
    console.log("Title:", result.title)
    console.log("Count:", result.metadata.count)
    console.log("Output:")
    console.log(result.output)
  } catch (e) {
    console.error("Error:", e)
  }

  section("3. Find non-existent pattern")
  try {
    const result = await globTool.execute(
      { pattern: "*.xyz", path: cwd },
      makeCtx(),
    )
    console.log("Output:", result.output)
  } catch (e) {
    console.error("Error:", e)
  }
}

async function testWebsearch() {
  header("WEBSEARCH TOOL TESTS")

  section("1. Basic web search")
  try {
    const result = await websearchTool.execute(
      { query: "Bun JavaScript runtime", numResults: 3 },
      makeCtx(),
    )
    console.log("Title:", result.title)
    console.log("Output (first 1000 chars):")
    console.log(result.output.slice(0, 1000))
  } catch (e) {
    console.error("Error:", e)
  }

  section("2. Deep search")
  try {
    const result = await websearchTool.execute(
      { query: "TypeScript 5.0 new features", numResults: 2, type: "fast" },
      makeCtx(),
    )
    console.log("Title:", result.title)
    console.log("Output (first 1000 chars):")
    console.log(result.output.slice(0, 1000))
  } catch (e) {
    console.error("Error:", e)
  }
}

async function main() {
  console.log("Manual Search Tools Test")
  console.log("========================")
  console.log("Running from:", process.cwd())

  await testGrep()
  await testGlob()
  await testWebsearch()

  header("ALL TESTS COMPLETE")
}

main().catch(console.error)
