// Tests for web UI image attachment pipeline (gh issue #51)
//
// Verifies by reading source files and the compiled bundle:
//   1. ImagePart type added to state.ts
//   2. ADD_USER_MSG action supports images
//   3. InputArea has file picker, preview, removal, and 5MB guard
//   4. sendMessage in app.tsx forwards images to /api/prompt
//   5. MessageItem renders image thumbnails in user bubbles
//   6. Icons: PaperclipIcon and XIcon for attachment UI
//   7. CSS styles for image preview chips

import { describe, test, expect, beforeAll } from "bun:test"
import { readFileSync } from "fs"
import { resolve } from "path"

// ── Sources ─────────────────────────────────────────────────────────────────

const BUNDLE_PATH    = resolve(import.meta.dir, "../../src/web/public/bundle.js")
const CSS_PATH       = resolve(import.meta.dir, "../../src/web/client/styles.css")
const STATE_PATH     = resolve(import.meta.dir, "../../src/web/client/state.ts")
const INPUT_PATH     = resolve(import.meta.dir, "../../src/web/client/components/input-area.tsx")
const APP_PATH       = resolve(import.meta.dir, "../../src/web/client/app.tsx")
const MSG_ITEM_PATH  = resolve(import.meta.dir, "../../src/web/client/components/message-item.tsx")
const ICONS_PATH     = resolve(import.meta.dir, "../../src/web/client/icons.tsx")

let bundle: string
let css: string
let stateSrc: string
let inputSrc: string
let appSrc: string
let msgItemSrc: string
let iconsSrc: string

beforeAll(() => {
  bundle     = readFileSync(BUNDLE_PATH, "utf8")
  css        = readFileSync(CSS_PATH, "utf8")
  stateSrc   = readFileSync(STATE_PATH, "utf8")
  inputSrc   = readFileSync(INPUT_PATH, "utf8")
  appSrc     = readFileSync(APP_PATH, "utf8")
  msgItemSrc = readFileSync(MSG_ITEM_PATH, "utf8")
  iconsSrc   = readFileSync(ICONS_PATH, "utf8")
})

// ── Helpers ─────────────────────────────────────────────────────────────────

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

// ── 1. State types — ImagePart (gh issue #51) ──────────────────────────────

describe("state.ts — ImagePart type (gh issue #51)", () => {
  test("ImagePart interface is declared", () => {
    expect(stateSrc).toContain("export interface ImagePart")
  })

  test("ImagePart has type field set to 'image'", () => {
    const block = extractBlock(stateSrc, "export interface ImagePart")
    expect(block).toContain("type: 'image'")
  })

  test("ImagePart has mime field", () => {
    const block = extractBlock(stateSrc, "export interface ImagePart")
    expect(block).toContain("mime:")
  })

  test("ImagePart has data field (base64)", () => {
    const block = extractBlock(stateSrc, "export interface ImagePart")
    expect(block).toContain("data:")
  })

  test("MessagePart union includes ImagePart", () => {
    expect(stateSrc).toMatch(/MessagePart\s*=.*ImagePart/)
  })

  test("ADD_USER_MSG action type includes optional images field", () => {
    expect(stateSrc).toMatch(/ADD_USER_MSG.*images\?/)
  })

  test("reducer ADD_USER_MSG case creates ImagePart entries when images provided", () => {
    const block = extractBlock(stateSrc, "case 'ADD_USER_MSG'")
    expect(block).toContain("image")
  })
})

// ── 2. InputArea — attachment UI (gh issue #51) ─────────────────────────────

describe("InputArea — file picker and image attachment UI (gh issue #51)", () => {
  test("InputArea has a hidden file input for images", () => {
    expect(inputSrc).toContain('type="file"')
    expect(inputSrc).toContain("image/*")
  })

  test("InputArea accepts multiple files", () => {
    expect(inputSrc).toContain("multiple")
  })

  test("onSend signature accepts images parameter", () => {
    expect(inputSrc).toMatch(/onSend.*images/)
  })

  test("InputArea has an attachment/paperclip button", () => {
    expect(inputSrc).toContain("PaperclipIcon")
  })

  test("InputArea renders image preview thumbnails", () => {
    expect(inputSrc).toContain("previewUrl")
  })

  test("InputArea has remove button (✕) per image", () => {
    expect(inputSrc).toContain("XSmallIcon")
  })

  test("InputArea enforces 5MB file size limit", () => {
    // 5 * 1024 * 1024 = 5242880
    expect(inputSrc).toMatch(/5\s*\*\s*1024\s*\*\s*1024|5242880/)
  })

  test("InputArea clears images after send", () => {
    expect(inputSrc).toContain("setImages([])")
  })

  test("InputArea allows sending with images even without text", () => {
    // The send button should be enabled when images are present
    expect(inputSrc).toContain("images.length")
  })

  test("InputArea reads files as base64 data URLs", () => {
    expect(inputSrc).toMatch(/FileReader|readAsDataURL|arrayBuffer/)
  })
})

// ── 3. App — sendMessage forwards images (gh issue #51) ────────────────────

describe("app.tsx — sendMessage forwards images to API (gh issue #51)", () => {
  test("sendMessage accepts images parameter", () => {
    expect(appSrc).toMatch(/sendMessage\(text.*images/)
  })

  test("sendMessage includes images in POST body", () => {
    expect(appSrc).toContain("body.images")
  })

  test("InputArea onSend prop passes sendMessage with images", () => {
    expect(appSrc).toMatch(/onSend=\{sendMessage\}/)
  })
})

// ── 4. MessageItem — render images in user bubble (gh issue #51) ────────────

describe("MessageItem — image rendering in user bubble (gh issue #51)", () => {
  test("message-item.tsx imports ImagePart from state", () => {
    expect(msgItemSrc).toContain("ImagePart")
  })

  test("MessageItem filters for image parts", () => {
    expect(msgItemSrc).toMatch(/type.*===.*'image'|type.*===.*"image"/)
  })

  test("MessageItem renders img elements for image parts", () => {
    expect(msgItemSrc).toContain("<img")
  })

  test("MessageItem uses data URL for image src", () => {
    // data:${mime};base64,${data} pattern
    expect(msgItemSrc).toMatch(/data:.*mime.*base64.*data|src=/)
  })
})

// ── 5. Icons — PaperclipIcon (gh issue #51) ────────────────────────────────

describe("icons.tsx — PaperclipIcon for attachment button (gh issue #51)", () => {
  test("PaperclipIcon function is exported from icons.tsx", () => {
    expect(iconsSrc).toContain("export function PaperclipIcon(")
  })

  test("PaperclipIcon renders an SVG element", () => {
    const block = extractBlock(iconsSrc, "export function PaperclipIcon(")
    expect(block).toContain("<svg")
  })
})

// ── 6. CSS — image preview styles (gh issue #51) ────────────────────────────

describe("styles.css — image attachment preview styles (gh issue #51)", () => {
  test("CSS contains image-preview-bar class", () => {
    expect(css).toContain(".image-preview-bar")
  })

  test("CSS contains image-thumb class for thumbnails", () => {
    expect(css).toContain(".image-thumb")
  })

  test("image-thumb has object-fit: cover for proper thumbnail sizing", () => {
    expect(css).toMatch(/\.image-thumb[^}]*object-fit:\s*cover/)
  })
})

// ── 7. Bundle integration (gh issue #51) ────────────────────────────────────

describe("bundle.js — image attachment integration (gh issue #51)", () => {
  test("bundle contains file input for image selection", () => {
    expect(bundle).toContain('type: "file"')
  })

  test("bundle contains image/* accept attribute", () => {
    expect(bundle).toContain("image/*")
  })

  test("bundle sendMessage function includes images in body", () => {
    expect(bundle).toContain("body.images")
  })

  test("bundle MessageItem renders img elements", () => {
    expect(bundle).toContain("<img")
  })

  test("bundle contains 5MB file size check", () => {
    expect(bundle).toMatch(/5\s*\*\s*1024\s*\*\s*1024|5242880/)
  })

  test("bundle contains PaperclipIcon", () => {
    expect(bundle).toContain("PaperclipIcon")
  })
})

// ── 8. Source file sanity (gh issue #51) ────────────────────────────────────

describe("source file sanity (gh issue #51)", () => {
  test("bundle.js is non-empty", () => {
    expect(bundle.length).toBeGreaterThan(1000)
  })

  test("bundle contains jsxDEV (React app scaffold)", () => {
    expect(bundle).toContain("jsxDEV")
  })

  test("input-area.tsx source file is non-empty", () => {
    expect(inputSrc.length).toBeGreaterThan(100)
  })

  test("state.ts source file is non-empty", () => {
    expect(stateSrc.length).toBeGreaterThan(100)
  })
})
