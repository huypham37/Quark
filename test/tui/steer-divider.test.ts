import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(
  resolve(import.meta.dir, "../../src/tui/components/steer-divider.tsx"),
  "utf8",
)

describe("SteerDivider", () => {
  test("renders an italic steer label with the goal", () => {
    expect(source).toContain("italic")
    expect(source).toContain("━━━━━━━━━━━━━━━━━━━━━ Steered · ${props.goal} ━━━━━━━━━━━━━━━━━━━━━")
  })
})
