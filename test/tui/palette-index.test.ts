import { describe, expect, test } from "bun:test"
import {
  buildPaletteEntries,
  preservePaletteSelection,
  preservePaletteSelectionIndex,
  searchPaletteEntries,
  type PaletteEntry,
} from "../../src/tui/palette-index"

const sources = {
  commands: [{ id: "model", description: "Choose a model", usage: "/model <id>", aliases: ["models"] }],
  models: [{ id: "openai/gpt-5", name: "GPT-5", provider: "OpenAI", detail: "OpenAI · API key", isCurrent: true }],
  skills: [{ id: "teaching", name: "Teaching", description: "Teach concepts clearly" }],
  tools: [{ id: "todo", name: "Todo", description: "Track work items" }],
}

function entry(key: PaletteEntry["key"], label: string, id = label, overrides: Partial<PaletteEntry> = {}): PaletteEntry {
  const [type] = key.split(":") as [PaletteEntry["type"]]
  return {
    key, type, id, label, searchText: [label, id], action: { type: "tool", toolId: id }, ...overrides,
  }
}

describe("palette index", () => {
  test("returns no results for empty or whitespace-only queries", () => {
    const entries = buildPaletteEntries(sources)
    expect(searchPaletteEntries(entries, "")).toEqual([])
    expect(searchPaletteEntries(entries, "  \t\n ")).toEqual([])
  })

  test("returns no entries for a nonmatching query", () => {
    expect(searchPaletteEntries(buildPaletteEntries(sources), "missing")).toEqual([])
  })

  test("combines indexed entity types and searches their approved metadata case-insensitively", () => {
    const entries = buildPaletteEntries(sources)
    expect(new Set(entries.map((item) => item.type))).toEqual(new Set(["command", "model", "skill", "tool"]))
    expect(searchPaletteEntries(entries, "MODELS").map((item) => item.key)).toEqual(["command:model"])
    expect(searchPaletteEntries(entries, "openai").map((item) => item.key)).toEqual(["model:openai/gpt-5"])
    expect(searchPaletteEntries(entries, "concepts").map((item) => item.key)).toEqual(["skill:teaching"])
    expect(searchPaletteEntries(entries, "work items").map((item) => item.key)).toEqual(["tool:todo"])
  })

  test("does not accept skill bodies or sessions as index sources", () => {
    const entries = buildPaletteEntries({
      skills: [{ id: "safe", name: "Safe", description: "Summary", body: "secret instruction" } as never],
      sessions: [{ id: "safe", title: "Safe", transcript: "secret conversation" }] as never,
    })

    expect(searchPaletteEntries(entries, "secret")).toEqual([])
    expect(entries.some((item) => item.type === ("session" as never))).toBe(false)
  })

  test("orders exact, id exact, label prefix, id prefix, word-boundary, then substring matches", () => {
    const entries = [
      entry("tool:substring", "Alpha", "xxgptxx", { searchText: ["Alpha", "xxgptxx"] }),
      entry("tool:word", "Alpha GPT helper", "other", { searchText: ["Alpha GPT helper", "other"] }),
      entry("tool:id-prefix", "Alpha", "gpt-5", { searchText: ["Alpha", "gpt-5"] }),
      entry("tool:label-prefix", "GPT helper", "other", { searchText: ["GPT helper", "other"] }),
      entry("tool:id-exact", "Alpha", "gpt", { searchText: ["Alpha", "gpt"] }),
      entry("tool:label-exact", "GPT", "other", { searchText: ["GPT", "other"] }),
    ]

    expect(searchPaletteEntries(entries, "gpt").map((item) => item.key)).toEqual([
      "tool:label-exact", "tool:id-exact", "tool:label-prefix", "tool:id-prefix", "tool:word", "tool:substring",
    ])
  })

  test("requires every query token, allowing tokens to match different fields", () => {
    const entries = buildPaletteEntries(sources)
    expect(searchPaletteEntries(entries, "gpt openai").map((item) => item.key)).toEqual(["model:openai/gpt-5"])
    expect(searchPaletteEntries(entries, "gpt missing")).toEqual([])
  })

  test("does not match arbitrary substrings inside metadata words", () => {
    const entries = buildPaletteEntries({
      skills: [{ id: "teaching", description: "Teach clearly" }],
      tools: [
        { id: "bash", description: "Execute commands instead of typing" },
        { id: "look", description: "Inspect detailed images" },
      ],
    })

    expect(searchPaletteEntries(entries, "tea").map((item) => item.key)).toEqual(["skill:teaching"])
  })

  test("uses current state, label, and key as stable tie-breakers", () => {
    const entries = [
      entry("tool:z-last", "Zoo", "match"),
      entry("tool:a-first", "Alpha", "match"),
      entry("model:current", "Current", "match", { isCurrent: true }),
    ]

    expect(searchPaletteEntries(entries, "match").map((item) => item.key)).toEqual([
      "model:current", "tool:a-first", "tool:z-last",
    ])
  })

  test("keeps equal labels deterministic by key and keeps duplicate labels across types", () => {
    const entries = [
      entry("tool:two", "Same", "match"),
      entry("model:one", "Same", "match"),
    ]
    expect(searchPaletteEntries(entries, "match").map((item) => item.key)).toEqual(["model:one", "tool:two"])
  })

  test("deduplicates source records by key while preserving the first record", () => {
    const entries = buildPaletteEntries({
      tools: [
        { id: "todo", name: "First", description: "first" },
        { id: "todo", name: "Second", description: "second" },
      ],
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.label).toBe("First")
  })

  test("bounds and sanitizes long, Unicode, control-character, missing, and malformed metadata", () => {
    const entries = buildPaletteEntries({
      models: [{ id: "\0é".repeat(600), name: "\u0000Mödel\u0007", provider: 4 as never }],
      skills: [null as never, { id: 1 as never, name: "ignored" }],
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]?.id).not.toContain("\u0000")
    expect(entries[0]?.id.length).toBeLessThanOrEqual(500)
    expect(entries[0]?.label).toBe("Mödel")
  })

  test("preserves selection by stable key, otherwise selects the first result", () => {
    const entries = [entry("tool:first", "First"), entry("tool:second", "Second")]
    expect(preservePaletteSelection("tool:second", entries)).toBe("tool:second")
    expect(preservePaletteSelection("tool:missing", entries)).toBe("tool:first")
    expect(preservePaletteSelection(undefined, [])).toBeUndefined()
    expect(preservePaletteSelectionIndex("tool:second", entries)).toBe(1)
    expect(preservePaletteSelectionIndex("tool:missing", entries)).toBe(0)
    expect(preservePaletteSelectionIndex(undefined, [])).toBe(-1)
  })
})
