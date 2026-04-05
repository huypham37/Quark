// Tests for web UI sub-agent tree view and braille spinner (gh issue #49)
//
// Verifies by reading bundle.js (compiled output) and state.ts (source):
//   1. SubAgentState / SubAgentToolPart types in state.ts
//   2. BrailleSpinner component replaces old CSS circle spinner
//   3. SubAgentTree component structure and rendering logic
//   4. ToolCallPart renders SubAgentTree when part.subAgent exists
//   5. WebSocket event handler dispatches all six sub-agent events
//   6. Reducer handles INIT_SUBAGENT and SUBAGENT_EVENT actions

import { describe, test, expect, beforeAll } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"

// ── Sources ─────────────────────────────────────────────────────────────────

const BUNDLE_PATH   = resolve(import.meta.dir, "../../src/web/public/bundle.js")
const CSS_PATH      = resolve(import.meta.dir, "../../src/web/client/styles.css")
const STATE_PATH    = resolve(import.meta.dir, "../../src/web/client/state.ts")
const ICONS_PATH    = resolve(import.meta.dir, "../../src/web/client/icons.tsx")
const SUBTREE_PATH  = resolve(import.meta.dir, "../../src/web/client/components/sub-agent-tree.tsx")
const TOOLCALL_PATH = resolve(import.meta.dir, "../../src/web/client/components/tool-call.tsx")

let bundle: string
let css: string
let stateSrc: string
let iconsSrc: string
let subtreeSrc: string
let toolcallSrc: string

beforeAll(() => {
  bundle      = readFileSync(BUNDLE_PATH, "utf8")
  css         = readFileSync(CSS_PATH, "utf8")
  stateSrc    = readFileSync(STATE_PATH, "utf8")
  iconsSrc    = readFileSync(ICONS_PATH, "utf8")
  subtreeSrc  = readFileSync(SUBTREE_PATH, "utf8")
  toolcallSrc = readFileSync(TOOLCALL_PATH, "utf8")
})

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the body of a function / block from src, starting at startMarker.
 * For function declarations like `function Foo({ param }) { ... }`, we skip
 * past the parameter list `)` before looking for the opening `{` of the body.
 * For non-function markers (e.g. interfaces), we use the first `{`.
 */
function extractBlock(src: string, startMarker: string): string {
  const idx = src.indexOf(startMarker)
  if (idx === -1) throw new Error(`Marker not found: ${startMarker}`)

  let searchFrom = idx
  // If the marker is a function declaration, skip past the param list closing ')'
  if (startMarker.includes("function ")) {
    const parenOpen = src.indexOf("(", idx)
    if (parenOpen !== -1) {
      // Find the matching ')' by counting balanced parens
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

// ── 1. State types (source file) ─────────────────────────────────────────────

describe("state.ts — SubAgentState and SubAgentToolPart types (gh issue #49)", () => {
  test("SubAgentState interface is declared", () => {
    expect(stateSrc).toContain("export interface SubAgentState")
  })

  test("SubAgentState has required field: profile", () => {
    const block = extractBlock(stateSrc, "export interface SubAgentState")
    expect(block).toContain("profile:")
  })

  test("SubAgentState has required field: tools", () => {
    const block = extractBlock(stateSrc, "export interface SubAgentState")
    expect(block).toContain("tools:")
  })

  test("SubAgentState has required field: tokensUsed", () => {
    const block = extractBlock(stateSrc, "export interface SubAgentState")
    expect(block).toContain("tokensUsed:")
  })

  test("SubAgentState has required field: tokenLimit", () => {
    const block = extractBlock(stateSrc, "export interface SubAgentState")
    expect(block).toContain("tokenLimit:")
  })

  test("SubAgentState has optional field: textPreview", () => {
    const block = extractBlock(stateSrc, "export interface SubAgentState")
    expect(block).toContain("textPreview?:")
  })

  test("SubAgentState has required field: done", () => {
    const block = extractBlock(stateSrc, "export interface SubAgentState")
    expect(block).toContain("done:")
  })

  test("SubAgentToolPart interface is declared", () => {
    expect(stateSrc).toContain("export interface SubAgentToolPart")
  })

  test("SubAgentToolPart has required field: tool", () => {
    const block = extractBlock(stateSrc, "export interface SubAgentToolPart")
    expect(block).toContain("tool:")
  })

  test("SubAgentToolPart has required field: callId", () => {
    const block = extractBlock(stateSrc, "export interface SubAgentToolPart")
    expect(block).toContain("callId:")
  })

  test("SubAgentToolPart has required field: status with pending/running/completed/error values", () => {
    const block = extractBlock(stateSrc, "export interface SubAgentToolPart")
    expect(block).toContain("status:")
    expect(block).toContain("pending")
    expect(block).toContain("running")
    expect(block).toContain("completed")
    expect(block).toContain("error")
  })

  test("SubAgentToolPart has required field: input", () => {
    const block = extractBlock(stateSrc, "export interface SubAgentToolPart")
    expect(block).toContain("input:")
  })

  test("SubAgentToolPart has optional field: error", () => {
    const block = extractBlock(stateSrc, "export interface SubAgentToolPart")
    expect(block).toContain("error?:")
  })

  test("ToolPart has optional subAgent field typed as SubAgentState", () => {
    const block = extractBlock(stateSrc, "export interface ToolPart")
    expect(block).toContain("subAgent?:")
    expect(block).toContain("SubAgentState")
  })

  test("Action union includes INIT_SUBAGENT type", () => {
    expect(stateSrc).toContain("INIT_SUBAGENT")
  })

  test("Action union includes SUBAGENT_EVENT type", () => {
    expect(stateSrc).toContain("SUBAGENT_EVENT")
  })
})

// ── 2. BrailleSpinner (source + bundle) ──────────────────────────────────────

describe("BrailleSpinner component — braille-based spinner replacing CSS circle (gh issue #49)", () => {
  test("SPINNER_FRAMES constant is defined in icons.tsx", () => {
    expect(iconsSrc).toContain("SPINNER_FRAMES")
  })

  test("SPINNER_FRAMES contains all ten braille characters ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏", () => {
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    frames.forEach(char => expect(iconsSrc).toContain(char))
  })

  test("BrailleSpinner function is exported from icons.tsx", () => {
    expect(iconsSrc).toContain("export function BrailleSpinner(")
  })

  test("BrailleSpinner uses setInterval to advance frames", () => {
    expect(iconsSrc).toContain("setInterval")
    expect(iconsSrc).toContain("SPINNER_FRAMES.length")
  })

  test("BrailleSpinner clears the interval on unmount via useEffect cleanup", () => {
    const block = extractBlock(iconsSrc, "export function BrailleSpinner(")
    expect(block).toContain("clearInterval")
    expect(block).toContain("useEffect")
  })

  test("Spinner function is exported and delegates entirely to BrailleSpinner", () => {
    expect(iconsSrc).toMatch(/export function Spinner[^)]*\)/)
    expect(iconsSrc).toContain("return <BrailleSpinner")
  })

  // Bundle-level checks

  test("BrailleSpinner is present in compiled bundle", () => {
    expect(bundle).toContain("function BrailleSpinner(")
  })

  test("bundle SPINNER_FRAMES array contains all braille characters", () => {
    const framesMatch = bundle.match(/var SPINNER_FRAMES\s*=\s*\[([^\]]+)\]/)
    expect(framesMatch).not.toBeNull()
    const framesStr = framesMatch![1]
    const expected = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    expected.forEach(char => expect(framesStr).toContain(char))
  })

  test("bundle Spinner() calls BrailleSpinner rather than a bespoke spinner element", () => {
    const spinnerFn = extractBlock(bundle, "function Spinner(")
    expect(spinnerFn).toContain("BrailleSpinner")
  })

  test("BrailleSpinner in bundle does not use CSS animation or a spinner class", () => {
    const spinnerFn = extractBlock(bundle, "function BrailleSpinner(")
    expect(spinnerFn).not.toMatch(/animation.*spin|className.*spinner/)
  })

  test("@keyframes spin exists in CSS but no .spinner class selector is present", () => {
    // The keyframe can stay for other uses; the spinner must not use it via a class
    expect(css).toContain("@keyframes spin")
    expect(css).not.toMatch(/\.spinner\s*\{/)
  })
})

// ── 3. SubAgentTree component (source + bundle) ───────────────────────────────

describe("SubAgentTree component — tree view of sub-agent activity (gh issue #49)", () => {
  test("SubAgentTree is exported from sub-agent-tree.tsx", () => {
    expect(subtreeSrc).toContain("export function SubAgentTree(")
  })

  test("SubAgentTree capitalises the first letter of the profile name", () => {
    expect(subtreeSrc).toContain("subAgent.profile.charAt(0).toUpperCase()")
    expect(subtreeSrc).toContain("subAgent.profile.slice(1)")
  })

  test("SubAgentTree renders CheckIcon for the done state", () => {
    expect(subtreeSrc).toContain("CheckIcon")
    expect(subtreeSrc).toContain("subAgent.done")
  })

  test("SubAgentTree renders BrailleSpinner for the in-progress state", () => {
    expect(subtreeSrc).toContain("BrailleSpinner")
  })

  test("ChildToolLine uses '└' connector for the last child", () => {
    expect(subtreeSrc).toContain("└")
  })

  test("ChildToolLine uses '├' connector for non-last children", () => {
    expect(subtreeSrc).toContain("├")
  })

  test("SubAgentTree uses formatTokens to display token count", () => {
    expect(subtreeSrc).toContain("formatTokens")
    expect(subtreeSrc).toContain("subAgent.tokensUsed")
  })

  test("formatTokens returns raw string for values under 1000", () => {
    expect(subtreeSrc).toMatch(/if\s*\(n\s*<\s*1000\)/)
  })

  test("formatTokens formats values ≥1000 as '<x.x>k'", () => {
    expect(subtreeSrc).toMatch(/\/\s*1000[^;]*toFixed\(1\)[^;]*["']k["']/)
  })

  test("SubAgentTree shows StreamingDots when textPreview exists and agent is not done", () => {
    expect(subtreeSrc).toContain("StreamingDots")
    expect(subtreeSrc).toContain("hasTextPreview")
    expect(subtreeSrc).toContain("subAgent.textPreview")
  })

  test("streaming dots row always uses '└' connector (it is always last)", () => {
    const streamingBlock = subtreeSrc.slice(subtreeSrc.indexOf("hasTextPreview &&"))
    expect(streamingBlock).toContain("└")
  })

  // Bundle verification

  test("SubAgentTree function exists in compiled bundle", () => {
    expect(bundle).toContain("function SubAgentTree(")
  })

  test("bundle SubAgentTree capitalises profile name", () => {
    const block = extractBlock(bundle, "function SubAgentTree(")
    expect(block).toContain("subAgent.profile.charAt(0).toUpperCase()")
  })

  test("bundle SubAgentTree conditionally renders CheckIcon (done) vs BrailleSpinner (running)", () => {
    const block = extractBlock(bundle, "function SubAgentTree(")
    expect(block).toContain("CheckIcon")
    expect(block).toContain("BrailleSpinner")
    expect(block).toContain("subAgent.done")
  })

  test("bundle SubAgentTree renders formatTokens output for tokensUsed", () => {
    const block = extractBlock(bundle, "function SubAgentTree(")
    expect(block).toContain("formatTokens(subAgent.tokensUsed)")
  })

  test("bundle SubAgentTree renders '└' connector and ChildToolLine renders '├' connector", () => {
    const treeBlock = extractBlock(bundle, "function SubAgentTree(")
    expect(treeBlock).toContain("└")
    const childBlock = extractBlock(bundle, "function ChildToolLine(")
    expect(childBlock).toContain("├")
  })

  test("bundle SubAgentTree renders StreamingDots for text preview", () => {
    const block = extractBlock(bundle, "function SubAgentTree(")
    expect(block).toContain("StreamingDots")
  })
})

// ── 4. ToolCallPart renders SubAgentTree (source + bundle) ────────────────────

describe("ToolCallPart — renders SubAgentTree when subAgent data present (gh issue #49)", () => {
  test("tool-call.tsx imports SubAgentTree from sub-agent-tree", () => {
    expect(toolcallSrc).toContain("SubAgentTree")
    expect(toolcallSrc).toContain("sub-agent-tree")
  })

  test("tool-call.tsx derives hasSubAgent from part.subAgent", () => {
    expect(toolcallSrc).toContain("part.subAgent")
    expect(toolcallSrc).toContain("hasSubAgent")
  })

  test("tool-call.tsx renders <SubAgentTree> passing part.subAgent as prop", () => {
    expect(toolcallSrc).toContain("<SubAgentTree subAgent={part.subAgent!}")
  })

  test("bundle ToolCallPart function exists", () => {
    expect(bundle).toContain("function ToolCallPart(")
  })

  test("bundle ToolCallPart references SubAgentTree", () => {
    const block = extractBlock(bundle, "function ToolCallPart(")
    expect(block).toContain("SubAgentTree")
  })

  test("bundle ToolCallPart guards rendering of tree behind hasSubAgent check", () => {
    const block = extractBlock(bundle, "function ToolCallPart(")
    expect(block).toContain("hasSubAgent")
    expect(block).toContain("part.subAgent")
  })

  test("bundle ToolCallPart passes part.subAgent as the subAgent prop to SubAgentTree", () => {
    const block = extractBlock(bundle, "function ToolCallPart(")
    // In the bundle the jsxDEV call has SubAgentTree and subAgent: part.subAgent on separate lines;
    // verify both components appear and the prop is present somewhere in the block
    expect(block).toContain("SubAgentTree")
    expect(block).toContain("subAgent: part.subAgent")
  })
})

// ── 5. WebSocket event handling in app.tsx / bundle ──────────────────────────

describe("WebSocket event handler — sub-agent events (gh issue #49)", () => {
  test("bundle handles subagent-tool-start event", () => {
    expect(bundle).toContain('case "subagent-tool-start"')
  })

  test("subagent-tool-start dispatches SUBAGENT_EVENT and pushes a pending tool entry", () => {
    const idx = bundle.indexOf('case "subagent-tool-start"')
    const block = bundle.slice(idx, bundle.indexOf("break;", idx) + 6)
    expect(block).toContain("SUBAGENT_EVENT")
    expect(block).toContain('"pending"')
    expect(block).toContain("sa.tools.push")
  })

  test("bundle handles subagent-tool-input event", () => {
    expect(bundle).toContain('case "subagent-tool-input"')
  })

  test("subagent-tool-input transitions tool status to running and sets input", () => {
    const idx = bundle.indexOf('case "subagent-tool-input"')
    const block = bundle.slice(idx, bundle.indexOf("break;", idx) + 6)
    expect(block).toContain('"running"')
    expect(block).toContain("t.input = d.input")
  })

  test("bundle handles subagent-tool-end event", () => {
    expect(bundle).toContain('case "subagent-tool-end"')
  })

  test("subagent-tool-end resolves tool status to completed or error", () => {
    const idx = bundle.indexOf('case "subagent-tool-end"')
    const block = bundle.slice(idx, bundle.indexOf("break;", idx) + 6)
    expect(block).toContain('"completed"')
    expect(block).toContain('"error"')
  })

  test("bundle handles subagent-step-finish event", () => {
    expect(bundle).toContain('case "subagent-step-finish"')
  })

  test("subagent-step-finish updates both tokensUsed and tokenLimit on sub-agent state", () => {
    const idx = bundle.indexOf('case "subagent-step-finish"')
    const block = bundle.slice(idx, bundle.indexOf("break;", idx) + 6)
    expect(block).toContain("sa.tokensUsed")
    expect(block).toContain("sa.tokenLimit")
  })

  test("bundle handles subagent-text-delta event", () => {
    expect(bundle).toContain('case "subagent-text-delta"')
  })

  test("subagent-text-delta updates textPreview and truncates long text to 120 chars", () => {
    const idx = bundle.indexOf('case "subagent-text-delta"')
    const block = bundle.slice(idx, bundle.indexOf("break;", idx) + 6)
    expect(block).toContain("textPreview")
    expect(block).toContain("120")
  })

  test("bundle handles subagent-done event", () => {
    expect(bundle).toContain('case "subagent-done"')
  })

  test("subagent-done marks done=true and clears textPreview", () => {
    const idx = bundle.indexOf('case "subagent-done"')
    const block = bundle.slice(idx, bundle.indexOf("break;", idx) + 6)
    expect(block).toContain("sa.done = true")
    expect(block).toContain("sa.textPreview = undefined")
  })

  test("bundle dispatches INIT_SUBAGENT when bash tool-input command matches quark --sub-agent", () => {
    expect(bundle).toContain("/\\bquark\\b.*--sub-agent\\b/")
    expect(bundle).toContain('"INIT_SUBAGENT"')
  })

  test("INIT_SUBAGENT dispatch extracts --profile flag and falls back to 'sub-agent'", () => {
    const idx = bundle.indexOf("/\\bquark\\b.*--sub-agent\\b/")
    const block = bundle.slice(idx, bundle.indexOf("break;", idx) + 6)
    expect(block).toMatch(/--profile/)
    expect(block).toContain('"sub-agent"')
  })
})

// ── 6. Reducer handles INIT_SUBAGENT and SUBAGENT_EVENT ──────────────────────

describe("reducer — INIT_SUBAGENT and SUBAGENT_EVENT cases (gh issue #49)", () => {
  test("reducer has INIT_SUBAGENT case in bundle", () => {
    expect(bundle).toContain('case "INIT_SUBAGENT"')
  })

  test("INIT_SUBAGENT initialises SubAgentState with empty tools, zero counters, done:false", () => {
    const idx = bundle.indexOf('case "INIT_SUBAGENT"')
    const block = bundle.slice(idx, idx + 400)
    expect(block).toContain("tools: []")
    expect(block).toContain("tokensUsed: 0")
    expect(block).toContain("tokenLimit: 0")
    expect(block).toContain("done: false")
  })

  test("INIT_SUBAGENT is idempotent — skips initialisation when subAgent already set", () => {
    const idx = bundle.indexOf('case "INIT_SUBAGENT"')
    const block = bundle.slice(idx, idx + 400)
    expect(block).toContain("p.subAgent")
  })

  test("INIT_SUBAGENT stores the profile from the action payload", () => {
    const idx = bundle.indexOf('case "INIT_SUBAGENT"')
    const block = bundle.slice(idx, idx + 400)
    expect(block).toContain("profile: a.profile")
  })

  test("reducer has SUBAGENT_EVENT case in bundle", () => {
    expect(bundle).toContain('case "SUBAGENT_EVENT"')
  })

  test("SUBAGENT_EVENT invokes the updater function on the sub-agent state", () => {
    const idx = bundle.indexOf('case "SUBAGENT_EVENT"')
    const block = bundle.slice(idx, idx + 600)
    expect(block).toContain("a.updater(sa)")
  })

  test("SUBAGENT_EVENT creates a default SubAgentState when subAgent not yet initialised", () => {
    const idx = bundle.indexOf('case "SUBAGENT_EVENT"')
    const block = bundle.slice(idx, idx + 600)
    expect(block).toContain("tools: []")
    expect(block).toContain("tokensUsed: 0")
    expect(block).toContain("tokenLimit: 0")
    expect(block).toContain("done: false")
  })

  test("SUBAGENT_EVENT shallow-clones the tools array before mutating (immutability guard)", () => {
    const idx = bundle.indexOf('case "SUBAGENT_EVENT"')
    const block = bundle.slice(idx, idx + 600)
    expect(block).toContain("[...p.subAgent.tools]")
  })

  test("SUBAGENT_EVENT matches the tool part by parentCallId", () => {
    const idx = bundle.indexOf('case "SUBAGENT_EVENT"')
    const block = bundle.slice(idx, idx + 600)
    expect(block).toContain("a.parentCallId")
  })
})

// ── 7. Source file sanity ─────────────────────────────────────────────────────

describe("source file sanity (gh issue #49)", () => {
  test("bundle.js is non-empty", () => {
    expect(bundle.length).toBeGreaterThan(1000)
  })

  test("bundle contains jsxDEV (React app scaffold)", () => {
    expect(bundle).toContain("jsxDEV")
  })

  test("bundle contains react-dom", () => {
    expect(bundle).toContain("react-dom")
  })

  test("sub-agent-tree.tsx source file is non-empty", () => {
    expect(subtreeSrc.length).toBeGreaterThan(100)
  })

  test("state.ts source file is non-empty", () => {
    expect(stateSrc.length).toBeGreaterThan(100)
  })
})
