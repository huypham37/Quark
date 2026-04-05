// Tests for web UI header fix — gh issue #44
//
// Bug: The header disappeared on mobile when switching sessions because:
//   1. The header element lacked position:sticky, top:0, zIndex:10, and flexShrink:0
//   2. The switchSession function didn't reset tokensUsed to 0 when switching sessions
//
// These tests verify the fix by parsing src/web/public/index.html structurally
// — no browser or DOM required. We inspect the raw source for the CSS properties
// and the switchSession call signature.

import { describe, test, expect, beforeAll } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"

// ── Helpers ──────────────────────────────────────────────────────────────────

const HTML_PATH = resolve(import.meta.dir, "../../src/web/public/index.html")

let source: string

beforeAll(() => {
  source = readFileSync(HTML_PATH, "utf8")
})

// Extract the style object literal from a React.createElement('header', ...) call.
// Returns the raw text of the object passed as the second argument to createElement.
function extractHeaderStyleObject(src: string): string {
  // Find the header element: React.createElement('header',{style:{...},...})
  const headerStart = src.indexOf("React.createElement('header',")
  if (headerStart === -1) throw new Error("Could not find React.createElement('header') in source")

  // Walk forward from the opening brace of the props object to find its closing brace
  const propStart = src.indexOf("{", headerStart + "React.createElement('header',".length - 1)
  let depth = 0
  let i = propStart
  while (i < src.length) {
    if (src[i] === "{") depth++
    else if (src[i] === "}") {
      depth--
      if (depth === 0) break
    }
    i++
  }
  return src.slice(propStart, i + 1)
}

// Extract the body of the switchSession function from the source.
function extractSwitchSessionBody(src: string): string {
  const fnStart = src.indexOf("async function switchSession(")
  if (fnStart === -1) throw new Error("Could not find switchSession function in source")

  const bodyStart = src.indexOf("{", fnStart)
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

// ── Tests: header CSS properties (gh issue #44 fix part 1) ───────────────────

describe("web UI header element — CSS properties (gh issue #44)", () => {
  test("header element exists in the render tree", () => {
    expect(source).toContain("React.createElement('header',")
  })

  test("header has position:fixed to stay visible regardless of scroll", () => {
    const propsBlock = extractHeaderStyleObject(source)
    expect(propsBlock).toMatch(/position\s*:\s*['"]fixed['"]/)
  })

  test("header is pinned to top:0", () => {
    const propsBlock = extractHeaderStyleObject(source)
    expect(propsBlock).toMatch(/top\s*:\s*0/)
  })

  test("header spans full width with left:0 and right:0", () => {
    const propsBlock = extractHeaderStyleObject(source)
    expect(propsBlock).toMatch(/left\s*:\s*0/)
    expect(propsBlock).toMatch(/right\s*:\s*0/)
  })

  test("header has zIndex to stay above content", () => {
    const propsBlock = extractHeaderStyleObject(source)
    expect(propsBlock).toMatch(/zIndex\s*:\s*10/)
  })

  test("a spacer div exists after the header to prevent content overlap", () => {
    // The spacer should have height:52 and flexShrink:0
    expect(source).toContain("Header spacer")
    expect(source).toMatch(/height:52,minHeight:52,flexShrink:0/)
  })

  test("header has all required fixed-position properties", () => {
    const propsBlock = extractHeaderStyleObject(source)
    expect(propsBlock).toMatch(/position\s*:\s*['"]fixed['"]/)
    expect(propsBlock).toMatch(/top\s*:\s*0/)
    expect(propsBlock).toMatch(/left\s*:\s*0/)
    expect(propsBlock).toMatch(/right\s*:\s*0/)
    expect(propsBlock).toMatch(/zIndex\s*:\s*10/)
  })
})

// ── Tests: switchSession resets state (gh issue #44 fix part 2) ──────────────

describe("switchSession function — state reset on session switch (gh issue #44)", () => {
  test("switchSession function exists in source", () => {
    expect(source).toContain("async function switchSession(")
  })

  test("switchSession resets tokensUsed to 0", () => {
    const body = extractSwitchSessionBody(source)
    // The fix requires tokensUsed:0 to be in the initial set() call
    expect(body).toMatch(/tokensUsed\s*:\s*0/)
  })

  test("switchSession closes the sidebar (sidebarOpen:false)", () => {
    const body = extractSwitchSessionBody(source)
    expect(body).toMatch(/sidebarOpen\s*:\s*false/)
  })

  test("switchSession sets the new sessionId", () => {
    const body = extractSwitchSessionBody(source)
    // The id parameter must be forwarded to set()
    expect(body).toMatch(/sessionId\s*:\s*id/)
  })

  test("switchSession resets tokensUsed, sessionId, and sidebarOpen in a single set() call", () => {
    const body = extractSwitchSessionBody(source)

    // Find the first set({ ... }) call in the function body
    const setStart = body.indexOf("set({")
    expect(setStart).toBeGreaterThan(-1)

    // Extract the argument object of the first set() call
    const objStart = setStart + "set(".length
    let depth = 0
    let i = objStart
    while (i < body.length) {
      if (body[i] === "{") depth++
      else if (body[i] === "}") {
        depth--
        if (depth === 0) break
      }
      i++
    }
    const firstSetArg = body.slice(objStart, i + 1)

    // All three required fields must be in the very first set() call so that
    // the reset is atomic — no flash of stale token count between calls.
    expect(firstSetArg).toMatch(/sessionId\s*:\s*id/)
    expect(firstSetArg).toMatch(/tokensUsed\s*:\s*0/)
    expect(firstSetArg).toMatch(/sidebarOpen\s*:\s*false/)
  })

  test("switchSession loads messages for the new session", () => {
    const body = extractSwitchSessionBody(source)
    // The function must fetch messages after switching
    expect(body).toContain("/api/sessions/")
    expect(body).toContain("/messages")
  })

  test("switchSession dispatches LOAD_MESSAGES after fetching", () => {
    const body = extractSwitchSessionBody(source)
    expect(body).toContain("LOAD_MESSAGES")
  })
})

// ── Regression guard: source file is readable and non-trivial ────────────────

describe("source file sanity", () => {
  test("index.html is non-empty", () => {
    expect(source.length).toBeGreaterThan(1000)
  })

  test("index.html contains the React app scaffold", () => {
    expect(source).toContain("React.createElement")
    expect(source).toContain("ReactDOM")
  })
})
