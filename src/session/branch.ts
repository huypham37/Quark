// Session branching — task-first replacement for automatic compaction

import { generateText, type LanguageModel, type ModelMessage } from "ai"
import { getTask } from "../task/task"
import { getContextWindow, getLastInputTokens, estimateTokens, isOverContextThreshold } from "./context"
import { createSession, getSession, listAllSessions, updateSession, type Session } from "./session"
import { saveUserMessage, type MessageRow, type PartRow } from "./message"

const SUMMARY_PROMPT = `Analyze this conversation and produce a continuation context for a child branch session.

1. Identify all relevant files that should be loaded into the next session's context. Include files that will be edited, dependencies being touched, relevant tests, configs, and key reference docs. Be generous—the cost of an extra file is low; missing a critical one means another archaeology dig. Target 8-15 files, up to 20 for complex work. List them under a "## Files" heading as bullet points with absolute paths when known, or relative paths from the project root.

2. Draft the context and goal description under a "## Context" heading. Describe what we're working on and provide whatever context helps continue the work. Preserve: decisions, constraints, user preferences, technical patterns. Exclude: conversation back-and-forth, dead ends, meta-commentary. Structure it based on what fits—could be tasks, findings, a simple paragraph, or detailed steps.

The user controls what context matters. If they mentioned something to preserve, include it—trust their judgment about their workflow.

Be factual and concise. The output will be frozen and reused for every subsequent sibling branch, so make it self-contained and durable.`

export interface BranchResult {
  sessionId: string
  created: boolean
  summary: string
}

export interface SummarizeForBranchInput {
  messages: MessageRow[]
  parts: PartRow[]
  model: LanguageModel
  abort?: AbortSignal
}

export interface AutoBranchInput extends SummarizeForBranchInput {
  sessionId: string
  profile: string
}

export interface CreateBranchInput {
  sessionId: string
  summary: string
  prompt?: string
  profile: string
  filesModified?: string[] | null
}

export function shouldBranchWithRealTokens(
  system: string | string[],
  modelMessages: ModelMessage[],
  modelLimit: { context: number; input?: number; output: number } | null,
  threshold: number,
  parts: PartRow[],
): boolean {
  const limit = getContextWindow(modelLimit)
  if (limit === 0) return false

  const realTokens = getLastInputTokens(parts)
  if (realTokens > 0) return isOverContextThreshold(realTokens, limit, threshold)

  const systemStr = Array.isArray(system) ? system.join("\n") : system
  return isOverContextThreshold(estimateTokens(systemStr, modelMessages), limit, threshold)
}

export function findSessionByPrefix(prefix: string): Session | null {
  const matches = listAllSessions().filter((session) => session.id.startsWith(prefix))
  if (matches.length > 1) {
    throw new Error(`Session prefix "${prefix}" is ambiguous`)
  }
  return matches[0] ?? null
}

export function getSessionLineage(sessionId: string): Session[] {
  const lineage: Session[] = []
  const seen = new Set<string>()
  let current: Session | null = getSession(sessionId)

  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    lineage.unshift(current)
    current = current.parentSessionId ? getSession(current.parentSessionId) : null
  }

  return lineage
}

export function buildLineageContext(sessionId: string): string {
  const session = getSession(sessionId)
  const task = session.taskId ? getTask(session.taskId) : null
  const lineage = getSessionLineage(sessionId)
  const lines: string[] = []

  if (task) {
    lines.push(`Task: ${task.description}`)
  }

  for (let i = 0; i < lineage.length; i++) {
    const node = lineage[i]!
    const child = lineage[i + 1]
    const summary = child?.parentSummary ?? node.summary
    if (summary) lines.push(`Session ${node.id.slice(0, 8)}: ${summary}`)
  }

  return lines.join("\n")
}

export function extractLastUserText(messages: MessageRow[], parts: PartRow[]): string {
  const byMessage = groupParts(parts)

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    if (msg.role !== "user") continue
    const text = textForMessage(msg.id, byMessage)
    if (text) return text
  }

  return ""
}

export function buildTextTranscript(
  messages: MessageRow[],
  parts: PartRow[],
  maxChars = 12000,
): string {
  const byMessage = groupParts(parts)
  const chunks: string[] = []
  let total = 0

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    const text = textForMessage(msg.id, byMessage)
    if (!text) continue

    const chunk = `${msg.role}: ${text}`
    total += chunk.length
    chunks.unshift(chunk)
    if (total >= maxChars) break
  }

  return chunks.join("\n\n")
}

/**
 * Signature: `summarizeForBranch(input: SummarizeForBranchInput): Promise<string>`
 *
 * @example
 * ```ts
 * const summary = await summarizeForBranch({ messages, parts, model })
 * ```
 */
export async function summarizeForBranch(input: SummarizeForBranchInput): Promise<string> {
  const transcript = buildTextTranscript(input.messages, input.parts)
  if (!transcript) return "No text transcript was available for this session."

  try {
    const result = await generateText({
      model: input.model,
      messages: [{ role: "user", content: `${SUMMARY_PROMPT}\n\n${transcript}` }],
      abortSignal: input.abort,
      maxRetries: 1,
    })
    const text = result.text.trim()
    return text || fallbackSummary(input.messages, input.parts)
  } catch {
    return fallbackSummary(input.messages, input.parts)
  }
}

/**
 * Signature: `autoBranch(input: AutoBranchInput): Promise<BranchResult>`
 *
 * @example
 * ```ts
 * const branch = await autoBranch({ sessionId, messages, parts, model, profile: "coder" })
 * ```
 */
export async function autoBranch(input: AutoBranchInput): Promise<BranchResult> {
  const parent = getSession(input.sessionId)
  const existing = parent.summary?.trim()
  const summary = existing && existing.length > 0 ? existing : await summarizeForBranch(input)
  return createBranch({
    sessionId: input.sessionId,
    summary,
    prompt: extractLastUserText(input.messages, input.parts),
    profile: input.profile,
  })
}

/**
 * Signature: `createBranch(input: CreateBranchInput): BranchResult`
 *
 * @example
 * ```ts
 * const branch = createBranch({
 *   sessionId,
 *   summary: "Implemented task metadata",
 *   prompt: "Continue with branch routing",
 *   profile: "coder",
 * })
 * ```
 */
export function createBranch(input: CreateBranchInput): BranchResult {
  const parent = getSession(input.sessionId)
  const taskId = parent.taskId
  if (!taskId) {
    throw new Error(
      `Cannot branch session ${parent.id}: parent has no taskId. ` +
        `initializeSessionFromMessage must run before branching.`,
    )
  }
  const filesModified = input.filesModified ?? parent.filesModified
  // Frozen-snapshot semantics: once the parent's summary is set, reuse it for
  // every subsequent child branch. Siblings share the same parentSummary.
  const existingParentSummary = parent.summary?.trim()
  const summary =
    existingParentSummary && existingParentSummary.length > 0
      ? existingParentSummary
      : input.summary.trim() || "No session summary available."

  const parentPatch: { summary?: string; filesModified?: string[] | null } = {
    filesModified,
  }
  // Only persist summary on the parent the first time it's frozen.
  if (!existingParentSummary) parentPatch.summary = summary
  updateSession(parent.id, parentPatch)

  const child = createSession({
    directory: parent.directory ?? undefined,
    parentSessionId: parent.id,
    kind: "main",
    taskId,
    parentSummary: summary,
    filesModified,
  })

  const prompt = input.prompt?.trim()
  if (prompt) {
    const context = buildLineageContext(child.id)
    saveUserMessage({
      sessionId: child.id,
      text: context ? `${context}\n\nCurrent prompt:\n${prompt}` : prompt,
    })
  }

  return { sessionId: child.id, created: true, summary }
}

function fallbackSummary(messages: MessageRow[], parts: PartRow[]): string {
  const lastUser = extractLastUserText(messages, parts)
  if (lastUser) return `Latest user request: ${lastUser.slice(0, 500)}`
  return "No text transcript was available for this session."
}

function groupParts(parts: PartRow[]): Map<string, PartRow[]> {
  const byMessage = new Map<string, PartRow[]>()
  for (const part of parts) {
    const list = byMessage.get(part.messageId) ?? []
    list.push(part)
    byMessage.set(part.messageId, list)
  }
  return byMessage
}

function textForMessage(messageId: string, byMessage: Map<string, PartRow[]>): string {
  const texts: string[] = []
  for (const part of byMessage.get(messageId) ?? []) {
    if (part.type !== "text" && part.type !== "summary") continue
    try {
      const data = JSON.parse(part.data) as { text?: string }
      if (data.text) texts.push(data.text)
    } catch {
      continue
    }
  }
  return texts.join("\n").trim()
}
