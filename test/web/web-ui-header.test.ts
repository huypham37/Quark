// Tests for web UI header fix — gh issue #44
//
// The header uses CSS classes (not inline styles) and the bundler emits
// jsxDEV() calls (not React.createElement).  These tests verify the fix
// by checking:
//   1. The CSS file contains the required fixed-position properties
//   2. The bundle references the correct class names
//   3. The switchSession function resets state correctly

import { describe, test, expect, beforeAll } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"

// ── Sources ─────────────────────────────────────────────────────────────────

const BUNDLE_PATH = resolve(import.meta.dir, "../../src/web/public/bundle.js")
const CSS_PATH = resolve(import.meta.dir, "../../src/web/client/styles.css")

let bundle: string
let css: string

beforeAll(() => {
  bundle = readFileSync(BUNDLE_PATH, "utf8")
  css = readFileSync(CSS_PATH, "utf8")
})

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Extract the body of a named `async function <name>(` from the bundle. */
function extractFunctionBody(src: string, name: string): string {
  const fnStart = src.indexOf(`async function ${name}(`)
  if (fnStart === -1) throw new Error(`Could not find async function ${name}() in bundle`)

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

// ── Tests: header CSS properties (gh issue #44 fix part 1) ─────────────────

describe("web UI header — CSS properties (gh issue #44)", () => {
  test("header element uses app-header class in the bundle", () => {
    expect(bundle).toContain('className: "app-header"')
  })

  test("app-header has position:fixed", () => {
    expect(css).toMatch(/\.app-header\s*\{[^}]*position:\s*fixed/)
  })

  test("app-header is pinned to top:0", () => {
    expect(css).toMatch(/\.app-header\s*\{[^}]*top:\s*0/)
  })

  test("app-header spans full width with left:0 and right:0", () => {
    expect(css).toMatch(/\.app-header\s*\{[^}]*left:\s*0/)
    expect(css).toMatch(/\.app-header\s*\{[^}]*right:\s*0/)
  })

  test("a header-spacer div exists in the bundle", () => {
    expect(bundle).toContain('className: "header-spacer"')
  })
})

// ── Tests: switchSession resets state (gh issue #44 fix part 2) ────────────

describe("switchSession function — state reset on session switch (gh issue #44)", () => {
  test("switchSession function exists in bundle", () => {
    expect(bundle).toContain("async function switchSession(")
  })

  test("switchSession resets tokensUsed to 0", () => {
    const body = extractFunctionBody(bundle, "switchSession")
    expect(body).toMatch(/tokensUsed\s*:\s*0/)
  })

  test("switchSession closes the sidebar (sidebarOpen:false)", () => {
    const body = extractFunctionBody(bundle, "switchSession")
    expect(body).toMatch(/sidebarOpen\s*:\s*false/)
  })

  test("switchSession sets the new sessionId", () => {
    const body = extractFunctionBody(bundle, "switchSession")
    expect(body).toMatch(/sessionId\s*:\s*id/)
  })

  test("switchSession resets tokensUsed, sessionId, and sidebarOpen in a single set() call", () => {
    const body = extractFunctionBody(bundle, "switchSession")

    const setStart = body.indexOf("set({")
    expect(setStart).toBeGreaterThan(-1)

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

    expect(firstSetArg).toMatch(/sessionId\s*:\s*id/)
    expect(firstSetArg).toMatch(/tokensUsed\s*:\s*0/)
    expect(firstSetArg).toMatch(/sidebarOpen\s*:\s*false/)
  })

  test("switchSession loads messages for the new session", () => {
    const body = extractFunctionBody(bundle, "switchSession")
    expect(body).toContain("/api/sessions/")
    expect(body).toContain("/messages")
  })

  test("switchSession dispatches LOAD_MESSAGES after fetching", () => {
    const body = extractFunctionBody(bundle, "switchSession")
    expect(body).toContain("LOAD_MESSAGES")
  })
})

// ── Regression guard ───────────────────────────────────────────────────────

describe("source file sanity", () => {
  test("bundle.js is non-empty", () => {
    expect(bundle.length).toBeGreaterThan(1000)
  })

  test("bundle contains the React app scaffold", () => {
    expect(bundle).toContain("jsxDEV")
    expect(bundle).toContain("react-dom")
  })
})
