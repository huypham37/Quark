export type PaletteEntityType = "command" | "model" | "skill" | "tool"

export type PaletteAction =
  | { type: "command"; commandId: string; args?: string }
  | { type: "model"; modelId: string }
  | { type: "skill"; skillId: string }
  | { type: "tool"; toolId: string }

export interface PaletteEntry {
  key: `${PaletteEntityType}:${string}`
  type: PaletteEntityType
  id: string
  label: string
  detail?: string
  /** Ordered search fields; the first is always the primary label. */
  searchText: string[]
  isCurrent?: boolean
  isUnavailable?: boolean
  action: PaletteAction
}

export interface PaletteCommandSource {
  id: string
  description?: string
  usage?: string
  aliases?: readonly string[]
  args?: string
  isUnavailable?: boolean
}

export interface PaletteModelSource {
  id: string
  name?: string
  provider?: string
  detail?: string
  isCurrent?: boolean
  isUnavailable?: boolean
}

export interface PaletteSkillSource {
  id: string
  name?: string
  description?: string
  isCurrent?: boolean
  isUnavailable?: boolean
}

export interface PaletteToolSource {
  id: string
  name?: string
  description?: string
  isUnavailable?: boolean
}

export interface PaletteSources {
  commands?: readonly PaletteCommandSource[]
  models?: readonly PaletteModelSource[]
  skills?: readonly PaletteSkillSource[]
  tools?: readonly PaletteToolSource[]
}

const MAX_LABEL_LENGTH = 200
const MAX_DETAIL_LENGTH = 500
const MAX_SEARCH_FIELD_LENGTH = 500
const MAX_SEARCH_FIELDS = 16

function text(value: unknown, maximumLength: number): string {
  if (typeof value !== "string") return ""
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim().slice(0, maximumLength)
}

function optionalText(value: unknown, maximumLength: number): string | undefined {
  const result = text(value, maximumLength)
  return result || undefined
}

function stringList(values: unknown, maximumLength: number): string[] {
  if (!Array.isArray(values)) return []
  return values
    .map((value) => text(value, maximumLength))
    .filter(Boolean)
    .slice(0, MAX_SEARCH_FIELDS)
}

function key(type: PaletteEntityType, id: string): `${PaletteEntityType}:${string}` {
  return `${type}:${id}`
}

function entrySearchText(label: string, id: string, ...metadata: (string | undefined)[]): string[] {
  return [label, id, ...metadata.filter((value): value is string => Boolean(value))].slice(0, MAX_SEARCH_FIELDS)
}

/**
 * Builds the bounded, UI-facing palette entries from source snapshots. It deliberately
 * accepts only summary fields, so skill bodies and session transcripts cannot enter the index.
 */
export function buildPaletteEntries(sources: PaletteSources): PaletteEntry[] {
  const entries: PaletteEntry[] = []

  for (const source of sources.commands ?? []) {
    const id = text(source?.id, MAX_SEARCH_FIELD_LENGTH)
    if (!id) continue
    const description = optionalText(source.description, MAX_DETAIL_LENGTH)
    const usage = optionalText(source.usage, MAX_SEARCH_FIELD_LENGTH)
    const aliases = stringList(source.aliases, MAX_SEARCH_FIELD_LENGTH)
    entries.push({
      key: key("command", id), type: "command", id, label: `/${id}`, detail: description,
      searchText: entrySearchText(`/${id}`, id, description, usage, ...aliases),
      isUnavailable: source.isUnavailable === true,
      action: source.args === undefined ? { type: "command", commandId: id } : { type: "command", commandId: id, args: text(source.args, MAX_SEARCH_FIELD_LENGTH) },
    })
  }

  for (const source of sources.models ?? []) {
    const id = text(source?.id, MAX_SEARCH_FIELD_LENGTH)
    if (!id) continue
    const label = text(source.name, MAX_LABEL_LENGTH) || id
    const provider = optionalText(source.provider, MAX_SEARCH_FIELD_LENGTH)
    const detail = optionalText(source.detail, MAX_DETAIL_LENGTH) ?? provider
    entries.push({
      key: key("model", id), type: "model", id, label, detail,
      searchText: entrySearchText(label, id, provider, detail),
      isCurrent: source.isCurrent === true, isUnavailable: source.isUnavailable === true,
      action: { type: "model", modelId: id },
    })
  }

  for (const source of sources.skills ?? []) {
    const id = text(source?.id, MAX_SEARCH_FIELD_LENGTH)
    if (!id) continue
    const label = text(source.name, MAX_LABEL_LENGTH) || id
    const description = optionalText(source.description, MAX_DETAIL_LENGTH)
    entries.push({
      key: key("skill", id), type: "skill", id, label, detail: description,
      searchText: entrySearchText(label, id, description),
      isCurrent: source.isCurrent === true, isUnavailable: source.isUnavailable === true,
      action: { type: "skill", skillId: id },
    })
  }

  for (const source of sources.tools ?? []) {
    const id = text(source?.id, MAX_SEARCH_FIELD_LENGTH)
    if (!id) continue
    const label = text(source.name, MAX_LABEL_LENGTH) || id
    const description = optionalText(source.description, MAX_DETAIL_LENGTH)
    entries.push({
      key: key("tool", id), type: "tool", id, label, detail: description,
      searchText: entrySearchText(label, id, description),
      isUnavailable: source.isUnavailable === true,
      action: { type: "tool", toolId: id },
    })
  }

  return deduplicatePaletteEntries(entries)
}

/** Normalizes query whitespace while leaving the palette input value untouched. */
export function normalizePaletteQuery(query: unknown): string[] {
  return text(query, MAX_SEARCH_FIELD_LENGTH).toLocaleLowerCase().split(/\s+/).filter(Boolean)
}

function wordBoundaryMatch(field: string, token: string): boolean {
  let position = field.indexOf(token)
  while (position >= 0) {
    if (position === 0 || !/[\p{L}\p{N}]/u.test(field[position - 1] ?? "")) return true
    position = field.indexOf(token, position + token.length)
  }
  return false
}

function tokenScore(entry: PaletteEntry, token: string): number | undefined {
  const label = text(entry.label, MAX_SEARCH_FIELD_LENGTH).toLocaleLowerCase()
  const id = text(entry.id, MAX_SEARCH_FIELD_LENGTH).toLocaleLowerCase()
  const fields = Array.isArray(entry.searchText)
    ? entry.searchText.map((field) => text(field, MAX_SEARCH_FIELD_LENGTH).toLocaleLowerCase()).filter(Boolean)
    : []
  const searchable = fields.length ? fields : [label, id].filter(Boolean)

  if (label === token) return 600
  if (id === token) return 500
  if (label.startsWith(token)) return 400
  if (id.startsWith(token)) return 300
  if (searchable.some((field) => wordBoundaryMatch(field, token))) return 200
  if (label.includes(token) || id.includes(token)) return 100
  return undefined
}

function compareEntries(a: { entry: PaletteEntry; score: number }, b: { entry: PaletteEntry; score: number }): number {
  if (a.score !== b.score) return b.score - a.score
  if (a.entry.isCurrent !== b.entry.isCurrent) return a.entry.isCurrent ? -1 : 1
  const byLabel = a.entry.label.localeCompare(b.entry.label, undefined, { sensitivity: "base" })
  return byLabel || a.entry.key.localeCompare(b.entry.key, undefined, { sensitivity: "base" })
}

/** Returns matching entries in deterministic relevance order. */
export function searchPaletteEntries(entries: readonly PaletteEntry[], query: unknown): PaletteEntry[] {
  const tokens = normalizePaletteQuery(query)
  if (!tokens.length) return []

  return deduplicatePaletteEntries(entries)
    .map((entry) => {
      let score = 0
      for (const token of tokens) {
        const matched = tokenScore(entry, token)
        if (matched === undefined) return undefined
        score += matched
      }
      return { entry, score }
    })
    .filter((result): result is { entry: PaletteEntry; score: number } => result !== undefined)
    .sort(compareEntries)
    .map(({ entry }) => entry)
}

/** Alias that makes ranking intent explicit at call sites. */
export const rankPaletteEntries = searchPaletteEntries

/** Keeps the first occurrence of each stable entry key. */
export function deduplicatePaletteEntries(entries: readonly PaletteEntry[]): PaletteEntry[] {
  const seen = new Set<string>()
  return entries.filter((entry): entry is PaletteEntry => {
    if (!entry || typeof entry !== "object" || typeof entry.key !== "string" || seen.has(entry.key)) return false
    seen.add(entry.key)
    return true
  })
}

/** Retains selection by stable key, or selects the first result when it disappeared. */
export function preservePaletteSelection(selectedKey: string | undefined, entries: readonly PaletteEntry[]): string | undefined {
  if (selectedKey && entries.some((entry) => entry.key === selectedKey)) return selectedKey
  return entries[0]?.key
}

/** Returns the selected result index after a refresh. */
export function preservePaletteSelectionIndex(selectedKey: string | undefined, entries: readonly PaletteEntry[]): number {
  const key = preservePaletteSelection(selectedKey, entries)
  return key === undefined ? -1 : entries.findIndex((entry) => entry.key === key)
}
